import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { config } from '../config/settings';
import { updateShape, getShapeById, recordOperation } from '../database/operations';

export function createModifyAgent() {
  const llm = new ChatOpenAI({
    modelName: config.modelName,
    temperature: 0.1,
    openAIApiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
  });

  const systemPrompt = `你是一个专门处理修改几何对象的智能体。

必须只返回 JSON 格式，不要有任何其他文字！

返回 JSON 格式：
{
  "needsQuery": false,
  "queryType": null,
  "targetId": "shape_id",
  "modifications": {},
  "searchParams": {}
}

字段说明：
- needsQuery: 是否需要查询对象（"上一个正方形"、"最后创建的圆"、"三角形"等）
- queryType: 查询类型（"lastCreated" 按创建时间查询）
- targetId: 如果用户直接指定 ID，填写这里
- modifications: 要修改的属性（sideLength、radius、size、position 等）
- searchParams: 查询参数
  - lastCreated: {"type": "square", "offset": 0} （offset: 0=最后一个, 1=倒数第二个）

重要规则：
- 当用户只说"三角形"、"圆形"、"正方形"时，needsQuery=true，查询最后一个该类型的对象
- 三角形的属性是 "size"（无论用户说"大小"、"边长"、"尺寸"都用 size）
- 圆形的属性是 "radius"（无论用户说"半径"、"大小"都用 radius）
- 正方形的属性是 "sideLength"（无论用户说"边长"、"大小"都用 sideLength）

示例 1 - 直接指定 ID：
输入："修改 square_001 的边长为 10"
输出：{"needsQuery": false, "targetId": "square_001", "modifications": {"sideLength": 10}}

示例 2 - 查询最后创建的对象：
输入："修改上一个正方形的边长为 8"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "square", "offset": 0}, "modifications": {"sideLength": 8}}

示例 3 - 三角形（说"大小"）：
输入："三角形大小改为 10"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "triangle", "offset": 0}, "modifications": {"size": 10}}

示例 4 - 三角形（说"边长"）：
输入："三角形边长改为 10"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "triangle", "offset": 0}, "modifications": {"size": 10}}

示例 5 - 修改圆形：
输入："圆的半径改成 15"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "circle", "offset": 0}, "modifications": {"radius": 15}}`;

  return async function modifyAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    let userRequest = '';
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      const msgType = (msg as any).type || (msg as any)._getType?.();
      const content = String(msg.content);

      if (msgType === 'system' || content.includes('Supervisor: 路由到')) {
        continue;
      }

      if (msgType === 'user' || msgType === 'human') {
        userRequest = content;
        break;
      }
    }

    if (!userRequest) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: '抱歉，我无法找到你的请求内容。' } as any,
          ],
        },
      });
    }

    // 如果是 resumed 且有 operationParams，直接执行修改（跳过 LLM 解析）
    if (state.tempData?.resumed && state.tempData?.operationParams) {
      const lastCreated = state.tempData.lastCreated;
      const operationParams = state.tempData.operationParams;

      console.log('🔍 ModifyAgent resumed: lastCreated=', lastCreated);
      console.log('🔍 ModifyAgent resumed: operationParams=', operationParams);

      if (!lastCreated || !lastCreated.id) {
        console.log('❌ lastCreated 不存在或没有 id');
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
            messages: [
              ...state.messages,
              { role: 'assistant', content: '没有找到对象。' } as any,
            ],
          },
        });
      }

      const targetId = lastCreated.id;
      const modifications = operationParams?.modifications || {};

      console.log('➡️ resumed 执行 executeModify, targetId=', targetId, 'modifications=', modifications);

      return await executeModify(state, targetId, modifications);
    }

    if (!state.tempData?.operationParams) {
      const llmMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`用户说："${userRequest}"

请解析这个请求，返回 JSON 格式的结果。`),
      ];

      const response = await llm.invoke(llmMessages);
      const responseContent = response.content as string;

      let parsedData;
      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('无法解析 LLM 返回的 JSON');
        }
      } catch (error) {
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
            messages: [
              ...state.messages,
              { role: 'assistant', content: '抱歉，我无法理解你的请求。' } as any,
            ],
          },
        });
      }

      console.log('✅ 解析结果:', parsedData);

      if (parsedData.needsQuery && parsedData.queryType === 'lastCreated') {
        return new Command({
          goto: '__end__',
          update: {
            intent: 'modify',
            tempData: {
              ...state.tempData,
              needsFrontendTool: true,
              frontendToolAction: 'getLastCreated',
              frontendToolParams: parsedData.searchParams,
              operationParams: parsedData,
            },
            messages: [
              ...state.messages,
              { role: 'system', content: 'ModifyAgent: 需要前端工具 getLastCreated' } as any,
            ],
          },
        });
      }

      return await executeModify(state, parsedData.targetId, parsedData.modifications);
    }

    const lastCreated = state.tempData.lastCreated;
    const operationParams = state.tempData.operationParams!;

    console.log('🔍 ModifyAgent continue: lastCreated=', lastCreated);
    console.log('🔍 ModifyAgent continue: operationParams=', operationParams);
    console.log('🔍 ModifyAgent continue: tempData keys=', Object.keys(state.tempData));

    if (!lastCreated || !lastCreated.id) {
      console.log('❌ lastCreated 不存在或没有 id');
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: '没有找到对象。' } as any,
          ],
        },
      });
    }

    const targetId = lastCreated.id;
    const modifications = operationParams?.modifications || {};

    console.log('➡️ 准备调用 executeModify, targetId=', targetId, 'modifications=', modifications);

    return await executeModify(state, targetId, modifications);
  };
}

async function executeModify(
  state: AgentState,
  targetId: string,
  modifications: any
): Promise<Command<'supervisor'>> {
  console.log('🔧 executeModify: targetId=', targetId, 'modifications=', modifications);

  if (!targetId) {
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: '请指定要修改的对象。' } as any,
        ],
      },
    });
  }

  if (!modifications || Object.keys(modifications).length === 0) {
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: '请指定要修改的属性。' } as any,
        ],
      },
    });
  }

  try {
    const beforeState = getShapeById(targetId);

    if (!beforeState) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: `未找到对象: ${targetId}` } as any,
          ],
        },
      });
    }

    // 根据类型和修改内容重新计算 vertexList
    const type = beforeState.type;
    const oldVertexList = typeof beforeState.vertexList === 'string' 
      ? JSON.parse(beforeState.vertexList) 
      : beforeState.vertexList;
    let newVertexList = oldVertexList;
    let updateParams: any = {};

    if (type === 'square' && modifications.sideLength) {
      const sideLength = modifications.sideLength;
      const halfSide = sideLength / 2;
      const x = beforeState.position_x;
      const z = beforeState.position_z;
      newVertexList = [
        [x - halfSide, 0, z - halfSide],
        [x + halfSide, 0, z - halfSide],
        [x + halfSide, 0, z + halfSide],
        [x - halfSide, 0, z + halfSide],
      ];
      updateParams.vertexList = newVertexList;
    } else if (type === 'circle' && modifications.radius) {
      const radius = modifications.radius;
      newVertexList = {
        center: oldVertexList.center,
        radius: radius,
      };
      updateParams.vertexList = newVertexList;
    } else if (type === 'triangle' && modifications.size) {
      const size = modifications.size;
      const x = beforeState.position_x;
      const z = beforeState.position_z;
      newVertexList = [
        [x, 0, z - size / 2],
        [x - size / 2, 0, z + size / 2],
        [x + size / 2, 0, z + size / 2],
      ];
      updateParams.vertexList = newVertexList;
    } else {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: `不支持的修改类型: ${type} - ${JSON.stringify(modifications)}` } as any,
          ],
        },
      });
    }

    if (Object.keys(updateParams).length === 0) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: '没有需要更新的属性。' } as any,
          ],
        },
      });
    }

    updateShape(targetId, updateParams);

    const afterState = getShapeById(targetId);

    recordOperation({
      session_id: state.sessionId || 'default',
      shape_id: targetId,
      operation: 'update',
      before_state: beforeState,
      after_state: afterState,
    });

    console.log(`✅ MODIFY: ${targetId}, afterState=`, afterState);

    return new Command({
      goto: '__end__',
      update: {
        intent: 'modify',
        tempData: {
          modifiedObject: {
            id: afterState.id,
            type: afterState.type,
            vertexList: afterState.vertexList,
            position: [afterState.position_x, afterState.position_y, afterState.position_z],
            position_x: afterState.position_x,
            position_y: afterState.position_y,
            position_z: afterState.position_z,
            created_at: afterState.created_at,
            updated_at: afterState.updated_at,
          },
        },
        messages: [
          ...state.messages,
          { role: 'assistant', content: `已修改对象（ID: ${targetId}）` } as any,
        ],
      },
    });
  } catch (error) {
    console.error('❌ executeModify error:', error);
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: `修改失败: ${error}` } as any,
        ],
      },
    });
  }
}
