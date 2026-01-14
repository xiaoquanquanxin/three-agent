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
  "color": "#00ff88",
  "needsNearbyObjects": false
}

字段说明：
- type: 必须是 "square" 或 "circle" 或 "triangle"（小写英文）
- params:
  - square 有两种方式：
    1. 指定顶点: {"vertices": [[x1,y1,z1], [x2,y2,z2], [x3,y3,z3], [x4,y4,z4]]}（4个顶点，支持任意平面）
    2. 指定边长: {"sideLength": 边长数字}（在 xz 平面上）
  - circle: {"radius": 半径数字}
  - triangle 有三种方式：
    1. 指定顶点: {"vertices": [[x1,y1,z1], [x2,y2,z2], [x3,y3,z3]]}（支持 3D 坐标）
    2. 指定三边长: {"sides": [a, b, c]}（会自动计算顶点）
    3. 等边三角形: {"size": 边长数字}
- position: {"x": 数字, "y": 数字, "z": 数字}（默认原点，仅当没有指定 vertices 时使用）
- color: 颜色（十六进制，默认 "#00ff88"）
- needsNearbyObjects: 用户是否说"附近"、"旁边"（true/false）

坐标系说明：
- x: 左右方向
- y: 上下方向（高度）
- z: 前后方向
- 默认 y=0 表示在地面上

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
- 默认 → "#00ff88"

示例 1 - 正方形（边长）：
输入："画一个正方形，边长5"
输出：{"type": "square", "params": {"sideLength": 5}, "position": {"x": 0, "y": 0, "z": 0}, "color": "#00ff88", "needsNearbyObjects": false}

示例 2 - 正方形（顶点，垂直平面）：
输入："画一个正方形，顶点是(0,0,0),(10,0,0),(10,10,0),(0,10,0)"
输出：{"type": "square", "params": {"vertices": [[0,0,0], [10,0,0], [10,10,0], [0,10,0]]}, "color": "#00ff88", "needsNearbyObjects": false}

示例 3 - 红色圆形：
输入："创建一个红色圆形，半径10"
输出：{"type": "circle", "params": {"radius": 10}, "position": {"x": 0, "y": 0, "z": 0}, "color": "#ff0000", "needsNearbyObjects": false}

示例 4 - 等边三角形：
输入："画一个蓝色三角形，边长8"
输出：{"type": "triangle", "params": {"size": 8}, "position": {"x": 0, "y": 0, "z": 0}, "color": "#0000ff", "needsNearbyObjects": false}

示例 5 - 指定 3D 顶点的三角形：
输入："画一个三角形，顶点是 (0,0,0), (10,5,0), (5,10,8)"
输出：{"type": "triangle", "params": {"vertices": [[0,0,0], [10,5,0], [5,10,8]]}, "color": "#00ff88", "needsNearbyObjects": false}

示例 6 - 指定三边长的三角形：
输入："画一个三角形，三边长分别是 3, 4, 5"
输出：{"type": "triangle", "params": {"sides": [3, 4, 5]}, "position": {"x": 0, "y": 0, "z": 0}, "color": "#00ff88", "needsNearbyObjects": false}

记住：仔细识别用户说的是哪种形状和颜色！type 必须是小写英文（square/circle/triangle）！`;

  return async function createAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    if (state.intent !== 'create') {
      return new Command({
        goto: 'supervisor',
        update: { messages: state.messages },
      });
    }

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
            {
              role: 'assistant',
              content: '抱歉，我无法找到你的请求内容。',
            } as any,
          ],
        },
      });
    }

    if (!state.tempData?.operationParams || state.tempData.resumed) {

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
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
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
        return new Command({
          goto: '__end__',
          update: {
            intent: undefined,
            tempData: {},
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

      if (parsedData.needsNearbyObjects) {
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

      return await executeCreate(state, parsedData);
    }

    const nearbyObjects = state.tempData.nearbyObjects || [];
    const operationParams = state.tempData.operationParams!;

    // 找到一个合适的位置（避开已有对象）
    let position = operationParams.position;
    if (nearbyObjects.length > 0) {
      const offset = 8;
      position = {
        x: nearbyObjects[0].position[0] + offset,
        y: 0,
        z: nearbyObjects[0].position[2],
      };
    }

    operationParams.position = position;

    return await executeCreate(state, operationParams);
  };
}

/**
 * 创建错误响应
 */
function createErrorResponse(state: AgentState, message: string): Command<'supervisor'> {
  return new Command({
    goto: '__end__',
    update: {
      intent: undefined,
      tempData: {},
      messages: [
        ...state.messages,
        { role: 'assistant', content: message } as any,
      ],
    },
  });
}

/**
 * 执行创建操作（计算顶点、插入数据库）
 */
async function executeCreate(
  state: AgentState,
  params: any
): Promise<Command<'supervisor'>> {
  const id = generateId();
  const { type, position } = params;

  let vertexList: any;

  // 根据类型计算顶点（所有几何信息都在 vertexList 中）
  // 支持真正的 3D 坐标，y 是高度方向
  if (type === 'square') {
    const squareParams = params.params || {};
    
    if (squareParams.vertices) {
      // 方式1：直接指定 4 个顶点坐标
      vertexList = squareParams.vertices;
      
      // 验证：检查是否有4个顶点
      if (!Array.isArray(vertexList) || vertexList.length !== 4) {
        return createErrorResponse(state, '正方形需要4个顶点');
      }
    } else {
      // 方式2：指定边长，在 xz 平面上生成
      const sideLength = squareParams.sideLength || 5;
      const halfSide = sideLength / 2;
      const pos = position || { x: 0, y: 0, z: 0 };
      const y = pos.y || 0;
      vertexList = [
        [pos.x - halfSide, y, pos.z - halfSide], // 左下
        [pos.x + halfSide, y, pos.z - halfSide], // 右下
        [pos.x + halfSide, y, pos.z + halfSide], // 右上
        [pos.x - halfSide, y, pos.z + halfSide], // 左上
      ];
    }
  } else if (type === 'circle') {
    const radius = params.params?.radius || 5;
    const pos = position || { x: 0, y: 0, z: 0 };
    vertexList = {
      center: [pos.x, pos.y || 0, pos.z],
      radius: radius,
    };
  } else if (type === 'triangle') {
    // 三角形支持三种输入方式
    const triangleParams = params.params || {};
    
    if (triangleParams.vertices) {
      // 方式1：直接指定 3D 顶点坐标
      vertexList = triangleParams.vertices;
      
      // 验证：检查是否有3个顶点
      if (!Array.isArray(vertexList) || vertexList.length !== 3) {
        return createErrorResponse(state, '三角形需要3个顶点');
      }
    } else if (triangleParams.sides) {
      // 方式2：指定三边长，计算顶点（在 xz 平面上，y 使用 position.y）
      const sides = triangleParams.sides;
      
      // 验证：检查是否有3条边
      if (!Array.isArray(sides) || sides.length !== 3) {
        return createErrorResponse(state, '需要指定3条边的长度');
      }
      
      const [a, b, c] = sides;
      
      // 验证：三角形不等式（任意两边之和大于第三边）
      if (a + b <= c || a + c <= b || b + c <= a) {
        return createErrorResponse(state, `无法构成三角形：边长 ${a}, ${b}, ${c} 不满足三角形不等式`);
      }
      
      // 计算顶点（第一个顶点在原点，第二个在x轴上，第三个用余弦定理计算）
      const pos = position || { x: 0, y: 0, z: 0 };
      const y = pos.y || 0;
      // 使用余弦定理计算第三个顶点
      // cos(A) = (b² + c² - a²) / (2bc)，其中 A 是 a 对面的角
      const cosA = (b * b + c * c - a * a) / (2 * b * c);
      const sinA = Math.sqrt(1 - cosA * cosA);
      
      vertexList = [
        [pos.x, y, pos.z],                    // 第一个顶点
        [pos.x + c, y, pos.z],                // 第二个顶点（沿x轴）
        [pos.x + b * cosA, y, pos.z + b * sinA], // 第三个顶点
      ];
    } else {
      // 方式3：等边三角形（默认，在 xz 平面上）
      const size = triangleParams.size || 5;
      const pos = position || { x: 0, y: 0, z: 0 };
      const y = pos.y || 0;
      vertexList = [
        [pos.x, y, pos.z - size / 2],              // 顶点
        [pos.x - size / 2, y, pos.z + size / 2],   // 左下
        [pos.x + size / 2, y, pos.z + size / 2],   // 右下
      ];
    }
  } else {
    return createErrorResponse(state, `不支持的类型: ${type}`);
  }

  const color = params.color || '#00ff88';

  // 插入数据库
  try {
    createShape({
      id,
      type,
      vertexList,
      color,
    });

    // 记录操作历史
    recordOperation({
      session_id: state.sessionId || 'default',
      shape_id: id,
      operation: 'create',
      before_state: null,
      after_state: { id, type, vertexList, color },
    });

    console.log(`✅ CREATE: ${type} (${id}) color=${color}`);

    return new Command({
      goto: '__end__',
      update: {
        intent: 'create',
        tempData: {
          createdObject: {
            id,
            type,
            vertexList,
            color,
          },
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
    return new Command({
      goto: '__end__',
      update: {
        intent: undefined,
        tempData: {},
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
