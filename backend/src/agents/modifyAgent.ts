import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { config } from '../config/settings';
import { updateShape, getShapeById, recordOperation, getShapesByType } from '../database/operations';
import { generatePureId } from '../utils/uuid';

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
  "searchParams": {},
  "batchMode": false
}

字段说明：
- needsQuery: 是否需要查询对象
- queryType: 查询类型
  - "lastCreated": 按创建时间查询（"上一个正方形"、"最后创建的圆"）
  - "nearby": 按位置查询（"坐标附近的"、"(x,y,z)附近的"）
  - "all": 批量修改所有该类型（"所有三角形"、"全部正方形"）
- targetId: 如果用户直接指定 ID，填写这里
- modifications: 要修改的属性
  - sideLength: 正方形边长
  - radius: 圆形半径
  - size: 三角形边长
  - color: 颜色（十六进制）
  - move: 移动向量 {"x": 10, "y": 0, "z": 5}（所有顶点坐标 + 这个向量）
- searchParams: 查询参数
  - lastCreated: {"type": "square", "offset": 0}
  - nearby: {"x": 10, "y": 0, "z": 10, "radius": 5, "type": "triangle"}（type 可选）
  - all: {"type": "triangle"}
- batchMode: 是否批量修改（用户说"所有"、"全部"时为 true）

重要规则：
- 当用户说"所有"、"全部"时，queryType="all"，batchMode=true
- 当用户说"附近"、"坐标xxx"时，queryType="nearby"
- 当用户说"上一个"、"最后创建的"时，queryType="lastCreated"
- 移动对象时，使用 move 字段指定向量
  - "向右移动10" → move: {"x": 10, "y": 0, "z": 0}
  - "向上移动5" → move: {"x": 0, "y": 5, "z": 0}
  - "向前移动8" → move: {"x": 0, "y": 0, "z": 8}
  - "向 x 轴移动10" → move: {"x": 10, "y": 0, "z": 0}

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

示例 1 - 修改单个对象：
输入："修改上一个正方形的边长为 8"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "square", "offset": 0}, "modifications": {"sideLength": 8}, "batchMode": false}

示例 2 - 批量修改所有：
输入："把所有三角形改成红色"
输出：{"needsQuery": true, "queryType": "all", "searchParams": {"type": "triangle"}, "modifications": {"color": "#ff0000"}, "batchMode": true}

示例 3 - 批量移动：
输入："把所有三角形向 x 轴移动 10"
输出：{"needsQuery": true, "queryType": "all", "searchParams": {"type": "triangle"}, "modifications": {"move": {"x": 10, "y": 0, "z": 0}}, "batchMode": true}

示例 4 - 移动单个对象：
输入："把正方形向右移动10"
输出：{"needsQuery": true, "queryType": "lastCreated", "searchParams": {"type": "square", "offset": 0}, "modifications": {"move": {"x": 10, "y": 0, "z": 0}}, "batchMode": false}

示例 5 - 批量修改大小：
输入："把所有正方形边长改为 5"
输出：{"needsQuery": true, "queryType": "all", "searchParams": {"type": "square"}, "modifications": {"sideLength": 5}, "batchMode": true}

示例 6 - 按位置查询：
输入："把坐标 (10, 0, 5) 附近的三角形边长改为 10"
输出：{"needsQuery": true, "queryType": "nearby", "searchParams": {"x": 10, "y": 0, "z": 5, "radius": 5, "type": "triangle"}, "modifications": {"size": 10}, "batchMode": false}`;

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

      // 批量修改所有该类型的对象
      if (parsedData.needsQuery && parsedData.queryType === 'all' && parsedData.batchMode) {
        const type = parsedData.searchParams?.type;
        if (!type) {
          return new Command({
            goto: '__end__',
            update: {
              intent: undefined,
              tempData: {},
              messages: [
                ...state.messages,
                { role: 'assistant', content: '请指定要修改的对象类型。' } as any,
              ],
            },
          });
        }

        const shapes = getShapesByType(type);
        if (shapes.length === 0) {
          const typeMap: Record<string, string> = { square: '正方形', circle: '圆形', triangle: '三角形' };
          return new Command({
            goto: '__end__',
            update: {
              intent: undefined,
              tempData: {},
              messages: [
                ...state.messages,
                { role: 'assistant', content: `场景中没有${typeMap[type] || type}。` } as any,
              ],
            },
          });
        }

        const targetIds = shapes.map(s => s.id);
        return await executeBatchModify(state, targetIds, parsedData.modifications);
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

    // 处理移动（所有顶点 + 向量偏移）
    if (modifications.move) {
      const { x = 0, y = 0, z = 0 } = modifications.move;
      
      if (type === 'circle') {
        // 圆形：移动中心点
        newVertexList = {
          center: [
            oldVertexList.center[0] + x,
            oldVertexList.center[1] + y,
            oldVertexList.center[2] + z,
          ],
          radius: oldVertexList.radius,
        };
      } else {
        // 正方形/三角形：移动所有顶点
        newVertexList = oldVertexList.map((v: number[]) => [
          v[0] + x,
          v[1] + y,
          v[2] + z,
        ]);
      }
      hasGeometryChange = true;
    }

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

/**
 * 批量修改多个对象
 */
async function executeBatchModify(
  state: AgentState,
  targetIds: string[],
  modifications: any
): Promise<Command<'supervisor'>> {
  console.log('🔧 executeBatchModify: targetIds=', targetIds, 'modifications=', modifications);

  if (targetIds.length === 0) {
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: '没有找到要修改的对象。' } as any,
        ],
      },
    });
  }

  try {
    const modifiedObjects: any[] = [];
    const batchId = targetIds.length > 1 ? generatePureId() : undefined;

    for (const targetId of targetIds) {
      const beforeState = getShapeById(targetId);
      if (!beforeState) continue;

      const type = beforeState.type;
      const oldVertexList = typeof beforeState.vertexList === 'string'
        ? JSON.parse(beforeState.vertexList)
        : beforeState.vertexList;

      let newVertexList = oldVertexList;
      let newColor = beforeState.color;
      let hasGeometryChange = false;

      // 处理移动
      if (modifications.move) {
        const { x = 0, y = 0, z = 0 } = modifications.move;
        if (type === 'circle') {
          newVertexList = {
            center: [
              oldVertexList.center[0] + x,
              oldVertexList.center[1] + y,
              oldVertexList.center[2] + z,
            ],
            radius: oldVertexList.radius,
          };
        } else {
          newVertexList = oldVertexList.map((v: number[]) => [
            v[0] + x,
            v[1] + y,
            v[2] + z,
          ]);
        }
        hasGeometryChange = true;
      }

      // 处理大小修改
      if (type === 'square' && modifications.sideLength) {
        const centerX = (oldVertexList[0][0] + oldVertexList[2][0]) / 2;
        const centerY = oldVertexList[0][1];
        const centerZ = (oldVertexList[0][2] + oldVertexList[2][2]) / 2;
        const halfSide = modifications.sideLength / 2;
        newVertexList = [
          [centerX - halfSide, centerY, centerZ - halfSide],
          [centerX + halfSide, centerY, centerZ - halfSide],
          [centerX + halfSide, centerY, centerZ + halfSide],
          [centerX - halfSide, centerY, centerZ + halfSide],
        ];
        hasGeometryChange = true;
      } else if (type === 'circle' && modifications.radius) {
        newVertexList = { center: oldVertexList.center, radius: modifications.radius };
        hasGeometryChange = true;
      } else if (type === 'triangle' && modifications.size) {
        const centerX = (oldVertexList[0][0] + oldVertexList[1][0] + oldVertexList[2][0]) / 3;
        const centerY = (oldVertexList[0][1] + oldVertexList[1][1] + oldVertexList[2][1]) / 3;
        const centerZ = (oldVertexList[0][2] + oldVertexList[1][2] + oldVertexList[2][2]) / 3;
        const size = modifications.size;
        newVertexList = [
          [centerX, centerY, centerZ - size / 2],
          [centerX - size / 2, centerY, centerZ + size / 2],
          [centerX + size / 2, centerY, centerZ + size / 2],
        ];
        hasGeometryChange = true;
      }

      // 处理颜色
      if (modifications.color) {
        newColor = modifications.color;
      }

      if (!hasGeometryChange && !modifications.color) continue;

      const updateParams: any = {};
      if (hasGeometryChange) updateParams.vertexList = newVertexList;
      if (modifications.color) updateParams.color = newColor;

      updateShape(targetId, updateParams);
      const afterState = getShapeById(targetId);

      recordOperation({
        session_id: state.sessionId || 'default',
        shape_id: targetId,
        operation: 'update',
        before_state: beforeState,
        after_state: afterState,
        batch_id: batchId,
      });

      modifiedObjects.push(afterState);
      console.log(`✅ BATCH MODIFY: ${targetId}`);
    }

    const message = modifiedObjects.length === 1
      ? `已修改 1 个对象`
      : `已修改 ${modifiedObjects.length} 个对象`;

    return new Command({
      goto: '__end__',
      update: {
        intent: 'modify',
        tempData: {
          modifiedObjects,
        },
        messages: [
          ...state.messages,
          { role: 'assistant', content: message } as any,
        ],
      },
    });
  } catch (error) {
    console.error('❌ executeBatchModify error:', error);
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
        messages: [
          ...state.messages,
          { role: 'assistant', content: `批量修改失败: ${error}` } as any,
        ],
      },
    });
  }
}
