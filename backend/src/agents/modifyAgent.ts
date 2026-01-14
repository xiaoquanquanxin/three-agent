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
- needsQuery: 是否需要查询对象
- queryType: 查询类型
  - "lastCreated": 按创建时间查询（"上一个正方形"、"最后创建的圆"）
  - "nearby": 按位置查询（"坐标附近的"、"(x,y,z)附近的"）
- targetId: 如果用户直接指定 ID，填写这里
- modifications: 要修改的属性（sideLength、radius、size、color）
- searchParams: 查询参数
  - lastCreated: {"type": "square", "offset": 0}
  - nearby: {"x": 10, "y": 0, "z": 10, "radius": 5, "type": "triangle"}（type 可选）

重要规则：
- 当用户说"附近"、"坐标xxx"时，queryType="nearby"
- 当用户说"上一个"、"最后创建的"时，queryType="lastCreated"
- 三角形的属性是 "size"
- 圆形的属性是 "radius"
- 正方形的属性是 "sideLength"
- 颜色属性是 "color"（十六进制，如 "#ff0000"）

颜色识别：
- 红色/红 → "#ff0000"
- 绿色/绿 → "#00ff00"
- 蓝色/蓝 → "#0000ff"
- 黄色/黄 → "#ffff00"
- 白色/白 → "#ffffff"
- 黑色/黑 → "#000000"
- 橙色/橙 → "#ff8800"
- 紫色/紫 → "#8800ff"
- 粉色/粉 → "#ff88ff"

示例 1 - 直接指定 ID：
输入："修改 square_001 的边长为 10"
输出：{"needsQuery": false, "targetId": "square_001", "modifications": {"sideLength": 10}}

示例 2 - 查询最后创建的对象：
输入："修改上一个正方形的边长为 8"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "square", "offset": 0}, "modifications": {"sideLength": 8}}

示例 3 - 修改颜色：
输入："把三角形改成红色"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "triangle", "offset": 0}, "modifications": {"color": "#ff0000"}}

示例 4 - 同时修改大小和颜色：
输入："把正方形边长改为 10，颜色改成蓝色"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "square", "offset": 0}, "modifications": {"sideLength": 10, "color": "#0000ff"}}

示例 5 - 按位置查询：
输入："把坐标 (10, 0, 5) 附近的三角形边长改为 10"
输出：{"needsQuery": true, "queryType": "nearby", "searchParams": {"x": 10, "y": 0, "z": 5, "radius": 5, "type": "triangle"}, "modifications": {"size": 10}}

示例 6 - 修改圆形：
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
    if ((state.tempData as any)?.resumed && state.tempData?.operationParams) {
      const operationParams = state.tempData.operationParams;
      let targetId: string | undefined;

      // 根据查询类型获取目标 ID
      if (operationParams.queryType === 'lastCreated') {
        const lastCreated = state.tempData.lastCreated;
        console.log('🔍 ModifyAgent resumed (lastCreated):', lastCreated);
        if (!lastCreated || !lastCreated.id) {
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
        targetId = lastCreated.id;
      } else if (operationParams.queryType === 'nearby') {
        const nearbyObjects = state.tempData.nearbyObjects;
        console.log('🔍 ModifyAgent resumed (nearby):', nearbyObjects);
        if (!nearbyObjects || nearbyObjects.length === 0) {
          return new Command({
            goto: '__end__',
            update: {
              intent: undefined,
              tempData: {},
              messages: [
                ...state.messages,
                { role: 'assistant', content: '附近没有找到对象。' } as any,
              ],
            },
          });
        }
        // 取最近的一个对象
        targetId = nearbyObjects[0].id;
      }

      if (!targetId) {
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
            messages: [
              ...state.messages,
              { role: 'assistant', content: '无法确定要修改的对象。' } as any,
            ],
          },
        });
      }

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

      if (parsedData.needsQuery && parsedData.queryType === 'nearby') {
        return new Command({
          goto: '__end__',
          update: {
            intent: 'modify',
            tempData: {
              ...state.tempData,
              needsFrontendTool: true,
              frontendToolAction: 'getNearbyObjects',
              frontendToolParams: parsedData.searchParams,
              operationParams: parsedData,
            },
            messages: [
              ...state.messages,
              { role: 'system', content: 'ModifyAgent: 需要前端工具 getNearbyObjects' } as any,
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
    let newColor = beforeState.color;
    let hasGeometryChange = false;

    // 处理几何属性修改（保持原有的 y 坐标）
    if (type === 'square' && modifications.sideLength) {
      const centerX = (oldVertexList[0][0] + oldVertexList[2][0]) / 2;
      const centerY = oldVertexList[0][1]; // 保持原有高度
      const centerZ = (oldVertexList[0][2] + oldVertexList[2][2]) / 2;
      const sideLength = modifications.sideLength;
      const halfSide = sideLength / 2;
      newVertexList = [
        [centerX - halfSide, centerY, centerZ - halfSide],
        [centerX + halfSide, centerY, centerZ - halfSide],
        [centerX + halfSide, centerY, centerZ + halfSide],
        [centerX - halfSide, centerY, centerZ + halfSide],
      ];
      hasGeometryChange = true;
    } else if (type === 'circle' && modifications.radius) {
      const radius = modifications.radius;
      newVertexList = {
        center: oldVertexList.center,
        radius: radius,
      };
      hasGeometryChange = true;
    } else if (type === 'triangle' && modifications.size) {
      const centerX = (oldVertexList[0][0] + oldVertexList[1][0] + oldVertexList[2][0]) / 3;
      const centerY = (oldVertexList[0][1] + oldVertexList[1][1] + oldVertexList[2][1]) / 3; // 保持原有高度
      const centerZ = (oldVertexList[0][2] + oldVertexList[1][2] + oldVertexList[2][2]) / 3;
      const size = modifications.size;
      newVertexList = [
        [centerX, centerY, centerZ - size / 2],
        [centerX - size / 2, centerY, centerZ + size / 2],
        [centerX + size / 2, centerY, centerZ + size / 2],
      ];
      hasGeometryChange = true;
    }

    // 处理颜色修改
    if (modifications.color) {
      newColor = modifications.color;
    }

    // 如果没有任何有效修改
    if (!hasGeometryChange && !modifications.color) {
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

    // 构建更新参数
    const updateParams: any = {};
    if (hasGeometryChange) {
      updateParams.vertexList = newVertexList;
    }
    if (modifications.color) {
      updateParams.color = newColor;
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
            color: afterState.color,
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
