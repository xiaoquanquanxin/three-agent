import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { config } from '../config/settings';
import { deleteShape, getShapeById, recordOperation, getShapesByType, getShapeCounts, getLastCreatedShapes, getShapesByTypeAndColor } from '../database/operations';
import { generateId, generatePureId } from '../utils/uuid';

/**
 * 计算形状的中心点
 */
function getShapeCenter(shape: any): [number, number, number] {
  const vertexList = typeof shape.vertexList === 'string' 
    ? JSON.parse(shape.vertexList) 
    : shape.vertexList;

  if (shape.type === 'circle' && vertexList?.center) {
    return vertexList.center as [number, number, number];
  }

  if (Array.isArray(vertexList) && vertexList.length > 0) {
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const v of vertexList) {
      sumX += v[0];
      sumY += v[1];
      sumZ += v[2];
    }
    return [
      sumX / vertexList.length,
      sumY / vertexList.length,
      sumZ / vertexList.length,
    ];
  }

  return [0, 0, 0];
}

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
  "isAmbiguous": false,
  "ambiguousReason": null,
  "targets": [],
  "queryType": null,
  "searchParams": {}
}

字段说明：
- isAmbiguous: 用户意图是否模糊，需要追问
- ambiguousReason: 模糊原因（用于生成追问）
- targets: 明确的删除目标列表
  - 每个目标: {"type": "square", "selector": "all" | "last", "count": 1}
- queryType: 需要查询的类型
  - "nearby": 按坐标位置查询
  - "nearObject": 按相对对象位置查询（如"最接近某对象的"）
- searchParams: 查询参数

selector 说明：
- "all": 删除该类型的所有对象（用户明确说"所有"、"全部"）
- "last": 删除最近创建的 N 个（用户说"最近的"、"上一个"、"刚才的"、"最近创建的N个"）
  - 配合 count 使用，默认 count=1
- 如果用户只说"删除三角形"但没说哪个，isAmbiguous=true

示例 1 - 明确删除所有：
输入："删除所有正方形"
输出：{"isAmbiguous": false, "targets": [{"type": "square", "selector": "all"}]}

示例 2 - 明确删除最近的一个：
输入："删除最近创建的三角形"
输出：{"isAmbiguous": false, "targets": [{"type": "triangle", "selector": "last", "count": 1}]}

示例 3 - 明确删除最近的多个：
输入："删除最近创建的两个三角形"
输出：{"isAmbiguous": false, "targets": [{"type": "triangle", "selector": "last", "count": 2}]}

示例 4 - 模糊请求：
输入："删除三角形"
输出：{"isAmbiguous": true, "ambiguousReason": "未指定删除哪个三角形", "targets": [{"type": "triangle"}]}

示例 5 - 按坐标位置删除：
输入："删除坐标 (10, 0, 10) 附近的对象"
输出：{"isAmbiguous": false, "queryType": "nearby", "searchParams": {"x": 10, "y": 0, "z": 10, "radius": 10}}

示例 6 - 按相对位置删除（最接近某对象的）：
输入："删除最接近黄色圆形的三角形"
输出：{"isAmbiguous": false, "queryType": "nearObject", "searchParams": {"referenceType": "circle", "referenceColor": "黄色", "targetType": "triangle", "count": 1}}

示例 7 - 多类型删除（明确）：
输入："删除所有三角形和所有圆形"
输出：{"isAmbiguous": false, "targets": [{"type": "triangle", "selector": "all"}, {"type": "circle", "selector": "all"}]}

示例 8 - 删除最近的多个不同类型：
输入："删除最近创建的三个三角形和两个圆形"
输出：{"isAmbiguous": false, "targets": [{"type": "triangle", "selector": "last", "count": 3}, {"type": "circle", "selector": "last", "count": 2}]}

示例 9 - 删除某对象附近的：
输入："删除红色正方形附近的圆形"
输出：{"isAmbiguous": false, "queryType": "nearObject", "searchParams": {"referenceType": "square", "referenceColor": "红色", "targetType": "circle", "count": 1}}`;

  return async function deleteAgent(
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

    // 如果是从 interrupt 恢复（nearby 查询）
    if ((state.tempData as any)?.resumed && state.tempData?.operationParams) {
      const nearbyObjects = state.tempData.nearbyObjects || [];
      
      if (nearbyObjects.length === 0) {
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

      // 删除找到的对象
      const targetIds = nearbyObjects.map((obj: any) => obj.id);
      return await executeDelete(state, targetIds);
    }

    // 首次请求，解析用户意图
    const shapeCounts = getShapeCounts();
    const countsInfo = Object.entries(shapeCounts)
      .map(([type, count]) => `${type}: ${count}个`)
      .join(', ') || '场景为空';

    const llmMessages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`当前场景中的对象: ${countsInfo}

用户说："${userRequest}"

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

    console.log('✅ DeleteAgent 解析结果:', parsedData);

    // 如果意图模糊，追问用户
    if (parsedData.isAmbiguous) {
      const targets = parsedData.targets || [];
      let clarifyMessage = '请明确你要删除哪些对象：\n';
      
      for (const target of targets) {
        const type = target.type;
        const count = shapeCounts[type] || 0;
        
        if (count === 0) {
          clarifyMessage += `• 场景中没有${typeToName(type)}\n`;
        } else if (count === 1) {
          clarifyMessage += `• 场景中只有 1 个${typeToName(type)}，要删除它吗？\n`;
        } else {
          clarifyMessage += `• 场景中有 ${count} 个${typeToName(type)}，你要删除哪个？（全部 / 最近创建的 / 指定数量）\n`;
        }
      }

      return new Command({
        goto: '__end__',
        update: {
          intent: 'delete',
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: clarifyMessage.trim() } as any,
          ],
        },
      });
    }

    // 如果需要按位置查询
    if (parsedData.queryType === 'nearby') {
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

    // 如果需要按相对对象位置查询（如"最接近黄色圆形的三角形"）
    if (parsedData.queryType === 'nearObject') {
      const { referenceType, referenceColor, targetType, count = 1 } = parsedData.searchParams;
      
      // 先找到参考对象
      let referenceShapes;
      if (referenceColor) {
        referenceShapes = getShapesByTypeAndColor(referenceType, referenceColor);
      } else {
        referenceShapes = getShapesByType(referenceType);
      }
      
      if (referenceShapes.length === 0) {
        const colorDesc = referenceColor ? `${referenceColor}` : '';
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
            messages: [
              ...state.messages,
              { role: 'assistant', content: `没有找到${colorDesc}${typeToName(referenceType)}。` } as any,
            ],
          },
        });
      }
      
      // 获取参考对象的中心点（取第一个）
      const refShape = referenceShapes[0];
      const refCenter = getShapeCenter(refShape);
      
      // 找到目标类型的所有对象
      const targetShapes = getShapesByType(targetType);
      
      if (targetShapes.length === 0) {
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
            messages: [
              ...state.messages,
              { role: 'assistant', content: `没有找到${typeToName(targetType)}。` } as any,
            ],
          },
        });
      }
      
      // 计算每个目标对象到参考对象的距离，排序后取最近的 N 个
      const targetsWithDistance = targetShapes.map(shape => {
        const center = getShapeCenter(shape);
        const distance = Math.sqrt(
          Math.pow(center[0] - refCenter[0], 2) +
          Math.pow(center[1] - refCenter[1], 2) +
          Math.pow(center[2] - refCenter[2], 2)
        );
        return { shape, distance };
      });
      
      targetsWithDistance.sort((a, b) => a.distance - b.distance);
      const closestTargets = targetsWithDistance.slice(0, count);
      const targetIds = closestTargets.map(t => t.shape.id);
      
      return await executeDelete(state, targetIds);
    }

    // 收集要删除的对象 ID
    const targetIds: string[] = [];
    const targets = parsedData.targets || [];

    for (const target of targets) {
      if (target.selector === 'id' && target.id) {
        targetIds.push(target.id);
      } else if (target.selector === 'all' && target.type) {
        const shapes = getShapesByType(target.type);
        targetIds.push(...shapes.map(s => s.id));
      } else if (target.selector === 'last' && target.type) {
        // 支持删除最近的 N 个
        const count = target.count || 1;
        const shapes = getLastCreatedShapes(target.type, count);
        targetIds.push(...shapes.map(s => s.id));
      }
    }

    if (targetIds.length === 0) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: '没有找到要删除的对象。' } as any,
          ],
        },
      });
    }

    return await executeDelete(state, targetIds);
  };
}

function typeToName(type: string): string {
  const map: Record<string, string> = {
    square: '正方形',
    circle: '圆形',
    triangle: '三角形',
  };
  return map[type] || type;
}

async function executeDelete(
  state: AgentState,
  targetIds: string[]
): Promise<Command<'supervisor'>> {
  if (targetIds.length === 0) {
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: '请指定要删除的对象。' } as any,
        ],
      },
    });
  }

  try {
    const deletedShapes: any[] = [];
    const batchId = targetIds.length > 1 ? generatePureId() : undefined;

    for (const targetId of targetIds) {
      const shape = getShapeById(targetId);

      if (!shape) {
        console.log(`⚠️ 未找到对象: ${targetId}`);
        continue;
      }

      deleteShape(targetId);

      recordOperation({
        session_id: state.sessionId || 'default',
        shape_id: targetId,
        operation: 'delete',
        before_state: shape,
        after_state: null,
        batch_id: batchId,
      });

      deletedShapes.push({
        id: targetId,
        type: shape.type,
      });

      console.log(`✅ DELETE: ${targetId} (${shape.type})`);
    }

    if (deletedShapes.length === 0) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: '未找到要删除的对象。' } as any,
          ],
        },
      });
    }

    const message = deletedShapes.length === 1
      ? `已删除 1 个${typeToName(deletedShapes[0].type)}（ID: ${deletedShapes[0].id}）`
      : `已删除 ${deletedShapes.length} 个对象`;

    return new Command({
      goto: '__end__',
      update: {
        intent: 'delete',
        tempData: {
          deletedObjects: deletedShapes,
        },
        messages: [
          ...state.messages,
          { role: 'assistant', content: message } as any,
        ],
      },
    });
  } catch (error) {
    console.error('❌ executeDelete error:', error);
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: `删除失败: ${error}` } as any,
        ],
      },
    });
  }
}
