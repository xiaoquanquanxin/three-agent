import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command, interrupt } from '@langchain/langgraph';
import { AgentState } from '../types';
import { config } from '../config/settings';
import { createShape, recordOperation } from '../database/operations';
import { generateId } from '../utils/uuid';

/**
 * 创建 CreateAgent
 * 职责：处理创建对象的请求（正方形、圆形、三角形）
 * 支持 interrupt：当需要"附近"的位置信息时，调用前端工具
 */
export function createCreateAgent() {
  const llm = new ChatOpenAI({
    modelName: config.modelName,
    temperature: 0.1, // 降低 temperature，让输出更稳定
    openAIApiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
  });

  const systemPrompt = `你是一个专门处理创建几何对象的智能体。

重要规则：
1. 必须只返回 JSON 格式，不要有任何其他文字！
2. type 字段必须是小写英文：square、circle 或 triangle
3. 识别规则：
   - 用户说"正方形"、"方形"、"四边形" → type 是 "square"
   - 用户说"圆形"、"圆"、"圆圈" → type 是 "circle"
   - 用户说"三角形" → type 是 "triangle"

返回 JSON 格式：
{
  "type": "square",
  "params": {"sideLength": 5},
  "position": {"x": 0, "y": 0, "z": 0},
  "needsNearbyObjects": false
}

字段说明：
- type: 必须是 "square" 或 "circle" 或 "triangle"（小写英文）
- params:
  - square: {"sideLength": 边长数字}
  - circle: {"radius": 半径数字}
  - triangle: {"size": 大小数字}
- position: {"x": 数字, "y": 0, "z": 数字}（默认原点）
- needsNearbyObjects: 用户是否说"附近"、"旁边"（true/false）

示例 1 - 正方形：
输入："画一个正方形，边长5"
输出：{"type": "square", "params": {"sideLength": 5}, "position": {"x": 0, "y": 0, "z": 0}, "needsNearbyObjects": false}

示例 2 - 圆形：
输入："创建一个圆形，半径10"
输出：{"type": "circle", "params": {"radius": 10}, "position": {"x": 0, "y": 0, "z": 0}, "needsNearbyObjects": false}

示例 3 - 圆形（另一种说法）：
输入："画个圆，半径3"
输出：{"type": "circle", "params": {"radius": 3}, "position": {"x": 0, "y": 0, "z": 0}, "needsNearbyObjects": false}

示例 4 - 三角形：
输入："在附近画一个三角形"
输出：{"type": "triangle", "params": {"size": 5}, "position": {"x": 0, "y": 0, "z": 0}, "needsNearbyObjects": true}

记住：仔细识别用户说的是哪种形状！type 必须是小写英文（square/circle/triangle）！`;

  return async function createAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    console.log('\n🎨 CreateAgent: 处理创建对象请求...');

    // 找到最后一条真正的用户消息（跳过系统消息和 Supervisor 的路由消息）
    let userRequest = '';
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      const role = msg.role || (msg as any)._getType?.();
      const content = String(msg.content);

      // 跳过系统消息和 Supervisor 的路由消息
      if (role === 'system' || content.includes('Supervisor: 路由到')) {
        continue;
      }

      // 找到用户消息
      if (role === 'user' || role === 'human') {
        userRequest = content;
        break;
      }
    }

    console.log(`👤 用户请求: "${userRequest.substring(0, 50)}..."`);

    // 如果没有找到用户请求，返回错误
    if (!userRequest) {
      console.error('❌ 未找到用户消息');
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: '抱歉，我无法找到你的请求内容。',
            } as any,
          ],
        },
      });
    }

    // 第一次进入：解析用户请求
    if (!state.tempData?.operationParams) {
      console.log('📝 解析用户请求...');

      const llmMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`用户说："${userRequest}"

请解析这个请求，返回 JSON 格式的结果。记住：type 必须是 square、circle 或 triangle（小写英文）。`),
      ];

      const response = await llm.invoke(llmMessages);
      const responseContent = response.content as string;

      // 解析 LLM 返回的 JSON
      let parsedData;
      try {
        // 提取 JSON（LLM 可能返回带解释的文本）
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
              {
                role: 'assistant',
                content: '抱歉，我无法理解你的请求。请明确对象类型和参数。',
              } as any,
            ],
          },
        });
      }

      console.log('✅ 解析结果:', parsedData.type, parsedData.params);

      // 规范化类型（处理可能的中文或其他变体）
      const typeMap: Record<string, string> = {
        '正方形': 'square',
        '方形': 'square',
        'square': 'square',
        '圆形': 'circle',
        '圆': 'circle',
        'circle': 'circle',
        '三角形': 'triangle',
        'triangle': 'triangle',
      };

      const normalizedType = typeMap[parsedData.type?.toLowerCase()] || parsedData.type;
      if (!['square', 'circle', 'triangle'].includes(normalizedType)) {
        console.error(`❌ 不支持的类型: ${parsedData.type}`);
        return new Command({
          goto: 'supervisor',
          update: {
            messages: [
              ...state.messages,
              {
                role: 'assistant',
                content: `不支持的形状类型: ${parsedData.type}。支持的类型：正方形、圆形、三角形。`,
              } as any,
            ],
          },
        });
      }

      parsedData.type = normalizedType;

      // 检查是否需要前端工具
      if (parsedData.needsNearbyObjects) {
        console.log('⏸️ 需要前端工具获取附近对象，标记需要 interrupt...');

        // 直接结束 workflow，让 API handler 返回 interrupted 状态
        return new Command({
          goto: '__end__',  // 直接结束，不回到 supervisor
          update: {
            intent: 'create',
            tempData: {
              ...state.tempData,
              // 标记需要前端工具
              needsFrontendTool: true,
              frontendToolAction: 'getNearbyObjects',
              frontendToolParams: {
                x: parsedData.position?.x || 0,
                y: parsedData.position?.y || 0,
                z: parsedData.position?.z || 0,
                radius: 10,
              },
              // 保存解析结果，等待恢复时使用
              operationParams: parsedData,
            },
            messages: [
              ...state.messages,
              {
                role: 'system',
                content: 'CreateAgent: 需要前端工具 getNearbyObjects',
              } as any,
            ],
          },
        });
      }

      // 不需要前端工具，继续创建
      return await executeCreate(state, parsedData);
    }

    // 第二次进入：收到前端工具结果，继续执行
    console.log('▶️ 收到前端工具结果，继续执行');

    const nearbyObjects = state.tempData.nearbyObjects || [];
    const operationParams = state.tempData.operationParams!;

    // 找到一个合适的位置（避开已有对象）
    let position = operationParams.position;
    if (nearbyObjects.length > 0) {
      // 简单策略：在附近找一个空位
      const offset = 8;
      position = {
        x: nearbyObjects[0].position[0] + offset,
        y: 0,
        z: nearbyObjects[0].position[2],
      };
      console.log(`📍 找到合适位置: (${position.x}, ${position.y}, ${position.z})`);
    }

    operationParams.position = position;

    return await executeCreate(state, operationParams);
  };
}

/**
 * 执行创建操作（计算顶点、插入数据库）
 */
async function executeCreate(
  state: AgentState,
  params: any
): Promise<Command<'supervisor'>> {
  console.log('🔨 执行创建操作...');

  const id = generateId();
  const { type, position } = params;

  let vertexList: any;

  // 根据类型计算顶点
  if (type === 'square') {
    const sideLength = params.params?.sideLength || 5;
    const halfSide = sideLength / 2;
    vertexList = [
      [position.x - halfSide, 0, position.z - halfSide], // 左下
      [position.x + halfSide, 0, position.z - halfSide], // 右下
      [position.x + halfSide, 0, position.z + halfSide], // 右上
      [position.x - halfSide, 0, position.z + halfSide], // 左上
    ];
  } else if (type === 'circle') {
    const radius = params.params?.radius || 5;
    vertexList = {
      center: [position.x, position.y, position.z],
      radius: radius,
    };
  } else if (type === 'triangle') {
    const size = params.params?.size || 5;
    vertexList = [
      [position.x, 0, position.z - size / 2],        // 顶点
      [position.x - size / 2, 0, position.z + size / 2], // 左下
      [position.x + size / 2, 0, position.z + size / 2], // 右下
    ];
  } else {
    throw new Error(`不支持的类型: ${type}`);
  }

  // 插入数据库
  try {
    createShape({
      id,
      type,
      vertexList,
      position_x: position.x,
      position_y: position.y || 0,
      position_z: position.z,
    });

    // 记录操作历史
    recordOperation({
      session_id: state.sessionId || 'default',  // 提供默认值避免 NOT NULL 错误
      shape_id: id,
      operation: 'create',
      before_state: null,
      after_state: { id, type, vertexList, position },
    });

    console.log(`✅ 创建成功: ${type} (ID: ${id})`);

    // 返回成功，回到 supervisor
    return new Command({
      goto: 'supervisor',
      update: {
        intent: 'create', // 保留 intent
        tempData: {
          targetObjectId: id,
          createdObject: {
            id,
            type,
            vertexList,
            position: [position.x, position.y || 0, position.z],
            position_x: position.x,
            position_y: position.y || 0,
            position_z: position.z,
          },
          // 清除所有中间状态，避免重复执行
          needsFrontendTool: false,
          frontendToolAction: undefined,
          frontendToolParams: undefined,
          operationParams: undefined,
          nearbyObjects: undefined,
        },
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: `已创建${type === 'square' ? '正方形' : type === 'circle' ? '圆形' : '三角形'}（ID: ${id}）`,
          } as any,
        ],
      },
    });
  } catch (error) {
    console.error('❌ 创建失败:', error);
    return new Command({
      goto: 'supervisor',
      update: {
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: `创建失败: ${error}`,
          } as any,
        ],
      },
    });
  }
}
