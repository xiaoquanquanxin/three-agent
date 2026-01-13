import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { config } from '../config/settings';
import { deleteShape, getShapeById, recordOperation, getAllShapes } from '../database/operations';

export function createDeleteAgent() {
  const llm = new ChatOpenAI({
    modelName: config.modelName,
    temperature: 0.1,
    openAIApiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
  });

  const systemPrompt = `你是一个专门处理删除几何对象的智能体。

必须只返回 JSON 格式，不要有任何其他文字！

返回 JSON 格式：
{
  "needsQuery": false,
  "queryType": null,
  "targetId": "shape_id",
  "searchParams": {}
}

字段说明：
- needsQuery: 是否需要查询（按类型删除、按位置删除等）
- queryType: 查询类型（"byType" 按类型、"byLocation" 按位置）
- targetId: 如果用户直接指定 ID，填写这里
- searchParams: 查询参数
  - byType: {"type": "square"} （square/circle/triangle）
  - byLocation: {"x": 10, "y": 0, "z": 10, "radius": 10}

示例 1 - 直接指定 ID：
输入："删除 square_001"
输出：{"needsQuery": false, "targetId": "square_001"}

示例 2 - 按类型删除：
输入："删除圆"
输出：{"needsQuery": true, "queryType": "byType", "searchParams": {"type": "circle"}}

示例 3 - 按类型删除：
输入："删除正方形"
输出：{"needsQuery": true, "queryType": "byType", "searchParams": {"type": "square"}}

示例 4 - 按位置删除：
输入："删除坐标 (10, 0, 10) 附近的对象"
输出：{"needsQuery": true, "queryType": "byLocation", "searchParams": {"x": 10, "y": 0, "z": 10, "radius": 10}}`;

  return async function deleteAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    console.log('\n🗑️  DeleteAgent: 处理删除对象请求...');
    console.log('🔍 state.tempData?.operationParams:', state.tempData?.operationParams);
    console.log('🔍 是否有 operationParams:', !!state.tempData?.operationParams);

    let userRequest = '';
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      const role = msg.role || (msg as any)._getType?.();
      const content = String(msg.content);

      if (role === 'system' || content.includes('Supervisor: 路由到')) {
        continue;
      }

      if (role === 'user' || role === 'human') {
        userRequest = content;
        break;
      }
    }

    console.log(`👤 用户请求: "${userRequest.substring(0, 50)}..."`);

    if (!userRequest) {
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            { role: 'assistant', content: '抱歉，我无法找到你的请求内容。' } as any,
          ],
        },
      });
    }

    if (!state.tempData?.operationParams) {
      console.log('📝 解析用户请求...');

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
        console.error('❌ 解析 LLM 返回失败:', responseContent);
        return new Command({
          goto: 'supervisor',
          update: {
            messages: [
              ...state.messages,
              { role: 'assistant', content: '抱歉，我无法理解你的请求。' } as any,
            ],
          },
        });
      }

      console.log('✅ 解析结果:', parsedData);

      if (parsedData.needsQuery) {
        if (parsedData.queryType === 'byType') {
          console.log('⏸️ 需要前端工具按类型查询对象...');

          return new Command({
            goto: '__end__',
            update: {
              intent: 'delete',
              tempData: {
                ...state.tempData,
                needsFrontendTool: true,
                frontendToolAction: 'getObjectsByType',
                frontendToolParams: parsedData.searchParams,
                operationParams: parsedData,
              },
              messages: [
                ...state.messages,
                { role: 'system', content: 'DeleteAgent: 需要前端工具 getObjectsByType' } as any,
              ],
            },
          });
        } else if (parsedData.queryType === 'byLocation') {
          console.log('⏸️ 需要前端工具按位置查询对象...');

          return new Command({
            goto: '__end__',
            update: {
              intent: 'delete',
              tempData: {
                ...state.tempData,
                needsFrontendTool: true,
                frontendToolAction: 'getNearbyObjects',
                frontendToolParams: parsedData.searchParams,
                operationParams: parsedData,
              },
              messages: [
                ...state.messages,
                { role: 'system', content: 'DeleteAgent: 需要前端工具 getNearbyObjects' } as any,
              ],
            },
          });
        }
      }

      return await executeDelete(state, parsedData.targetId);
    }

    console.log('▶️ 收到前端工具结果，继续执行');
    console.log('📦 完整 state:', JSON.stringify(state, null, 2));

    const nearbyObjects = state.tempData.nearbyObjects || [];
    const objectsByType = state.tempData.objectsByType || state.tempData.nearbyObjects || [];
    const results = objectsByType;

    console.log('🔍 nearbyObjects:', nearbyObjects);
    console.log('🔍 objectsByType:', objectsByType);
    console.log('🔍 results:', results);

    if (results.length === 0) {
      console.log('❌ 没有找到任何对象');
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            { role: 'assistant', content: '没有找到对象。' } as any,
          ],
        },
      });
    }

    const targetId = results[0].id;
    console.log(`🎯 找到目标对象: ${targetId}`);
    console.log(`🔍 准备删除，targetId 类型: ${typeof targetId}`);

    return await executeDelete(state, targetId);
  };
}

async function executeDelete(
  state: AgentState,
  targetId: string
): Promise<Command<'supervisor'>> {
  console.log(`🔨 执行删除操作: ${targetId}`);
  console.log(`🔍 targetId 类型: ${typeof targetId}, 值: "${targetId}"`);

  if (!targetId) {
    console.log('❌ targetId 为空');
    return new Command({
      goto: 'supervisor',
      update: {
        messages: [
          ...state.messages,
          { role: 'assistant', content: '请指定要删除的对象。' } as any,
        ],
      },
    });
  }

  try {
    console.log(`🔍 查询数据库中的对象: ${targetId}`);
    const shape = getShapeById(targetId);
    console.log(`🔍 查询结果:`, shape);

    if (!shape) {
      console.log(`❌ 数据库中未找到对象: ${targetId}`);
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            { role: 'assistant', content: `未找到对象: ${targetId}` } as any,
          ],
        },
      });
    }

    console.log(`🗑️ 开始删除对象: ${targetId}`);
    deleteShape(targetId);
    console.log(`✅ 数据库删除完成`);

    recordOperation({
      session_id: state.sessionId || 'default',
      shape_id: targetId,
      operation: 'delete',
      before_state: shape,
      after_state: null,
    });

    console.log(`✅ 删除成功: ${targetId}`);

    return new Command({
      goto: 'supervisor',
      update: {
        intent: 'delete',
        tempData: {
          targetObjectId: targetId,
          needsFrontendTool: false,
          frontendToolAction: undefined,
          frontendToolParams: undefined,
          operationParams: undefined,
          nearbyObjects: undefined,
        },
        messages: [
          ...state.messages,
          { role: 'assistant', content: `已删除对象（ID: ${targetId}）` } as any,
        ],
      },
    });
  } catch (error) {
    console.error('❌ 删除失败:', error);
    return new Command({
      goto: 'supervisor',
      update: {
        messages: [
          ...state.messages,
          { role: 'assistant', content: `删除失败: ${error}` } as any,
        ],
      },
    });
  }
}
