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
    temperature: 0.7,
    openAIApiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
  });

  const systemPrompt = `你是一个专门处理创建几何对象的智能体。
你可以创建：正方形（square）、圆形（circle）、三角形（triangle）。

重要：你必须只返回 JSON 格式，不要有任何其他文字！

解析用户请求，返回以下 JSON 格式：
{
  "type": "square",
  "params": {"sideLength": 5},
  "position": {"x": 0, "y": 0, "z": 0},
  "needsNearbyObjects": false
}

字段说明：
- type: "square"（正方形）| "circle"（圆形）| "triangle"（三角形）
- params:
  - square: {"sideLength": 数字}
  - circle: {"radius": 数字}
  - triangle: {"size": 数字}
- position: {"x": 数字, "y": 0, "z": 数字}
  - 如果用户没有指定位置，使用 {"x": 0, "y": 0, "z": 0}
- needsNearbyObjects:
  - true: 用户说"附近"、"旁边"等模糊位置
  - false: 其他情况

示例：
输入："画一个正方形，边长5"
输出：{"type": "square", "params": {"sideLength": 5}, "position": {"x": 0, "y": 0, "z": 0}, "needsNearbyObjects": false}

输入："创建一个圆形，半径10，位置在(5,0,5)"
输出：{"type": "circle", "params": {"radius": 10}, "position": {"x": 5, "y": 0, "z": 5}, "needsNearbyObjects": false}

输入："在附近画一个三角形"
输出：{"type": "triangle", "params": {"size": 5}, "position": {"x": 0, "y": 0, "z": 0}, "needsNearbyObjects": true}

记住：只返回 JSON，不要有任何解释！`;

  return async function createAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    console.log('\n🎨 CreateAgent: 处理创建对象请求...');

    const userRequest = state.messages[state.messages.length - 1].content;

    // 第一次进入：解析用户请求
    if (!state.tempData?.operationParams) {
      console.log('📝 解析用户请求...');

      const llmMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`用户请求：${userRequest}\n\n请解析并返回 JSON 格式的结果。`),
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

      console.log('✅ 解析结果:', parsedData);

      // 检查是否需要前端工具
      if (parsedData.needsNearbyObjects) {
        console.log('⏸️  需要前端工具获取附近对象，触发 interrupt...');

        // 触发 interrupt，调用前端工具
        return interrupt({
          action: 'getNearbyObjects',
          params: {
            x: parsedData.position?.x || 0,
            y: parsedData.position?.y || 0,
            z: parsedData.position?.z || 0,
            radius: 10,
          },
        });
      }

      // 不需要前端工具，继续创建
      return await executeCreate(state, parsedData);
    }

    // 第二次进入：从 interrupt 恢复，使用前端返回的数据
    console.log('▶️  从 interrupt 恢复，使用前端返回的数据');

    const nearbyObjects = state.tempData.nearbyObjects || [];
    const operationParams = state.tempData.operationParams!;

    // 找到一个合适的位置（避开已有对象）
    let position = operationParams.position;
    if (nearbyObjects.length > 0) {
      // 简单策略：在附近找一个空位
      const offset = 5;
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
      session_id: state.sessionId,
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
        tempData: {
          ...state.tempData,
          targetObjectId: id,
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
