import { Request, Response } from 'express';
import { Client } from '@langchain/langgraph-sdk';
import { generateId } from '../utils/uuid';
import { z } from 'zod';

// 创建 SDK Client 连接到 langgraph dev
const client = new Client({ apiUrl: 'http://localhost:2024' });

// Assistant ID（在 langgraph dev 中注册的 graph ID）
const ASSISTANT_ID = 'agent';

// Zod Schema 定义（类型安全）
const CreatedObjectSchema = z.object({
  id: z.string(),
  type: z.enum(['square', 'circle', 'triangle']),
  vertexList: z.any(),
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  position_x: z.number().optional(),
  position_y: z.number().optional(),
  position_z: z.number().optional(),
});

const TempDataSchema = z.object({
  createdObject: CreatedObjectSchema.optional(),
  targetObjectId: z.string().optional(),
  modifiedObject: z.any().optional(),
});

// Action 映射（动态处理）
const ACTION_MAP = {
  create: (tempData: any) => {
    const result = TempDataSchema.safeParse(tempData);
    if (result.success && result.data.createdObject) {
      const obj = result.data.createdObject;
      const typeMap: Record<string, string> = { square: '正方形', circle: '圆形', triangle: '三角形' };
      return {
        action: 'create',
        data: obj,
        message: `已创建${typeMap[obj.type] || obj.type}`,
      };
    }
    return { action: 'none' };
  },
  delete: (tempData: any) => {
    const result = TempDataSchema.safeParse(tempData);
    if (result.success && result.data.targetObjectId) {
      return {
        action: 'delete',
        targetId: result.data.targetObjectId,
      };
    }
    return { action: 'none' };
  },
  modify: (tempData: any) => {
    const result = TempDataSchema.safeParse(tempData);
    if (result.success && result.data.modifiedObject) {
      return {
        action: 'modify',
        data: result.data.modifiedObject,
      };
    }
    return { action: 'none' };
  },
  default: () => ({ action: 'none' }),
};

/**
 * POST /api/chat-sdk
 * 使用 SDK 处理用户输入
 */
export async function handleChatSDK(req: Request, res: Response) {
  try {
    const { message, sessionId, threadId } = req.body;

    if (!message) {
      return res.status(400).json({ error: '缺少 message 参数' });
    }

    const actualSessionId = sessionId || generateId();

    // 如果没有提供 threadId，创建新的 thread
    let actualThreadId = threadId;
    if (!actualThreadId) {
      const thread = await client.threads.create();
      actualThreadId = thread.thread_id;
    }

    // 使用 SDK 调用 workflow
    const streamResponse = client.runs.stream(
      actualThreadId,
      ASSISTANT_ID,
      {
        input: { messages: [{ role: 'user', content: message }] },
        streamMode: ['values', 'updates'],  // 同时监听 values 和 updates
        multitaskStrategy: 'reject',
      }
    );

    let lastValue: any = null;
    let interruptData: any = null;

    // 处理流式响应
    for await (const chunk of streamResponse) {
      if (chunk.event === 'values') {
        lastValue = chunk.data;
        
        // 检查 values 中的 __interrupt__
        if (lastValue?.__interrupt__ && lastValue.__interrupt__.length > 0) {
          interruptData = lastValue.__interrupt__[0];
        }
      }

      if (chunk.event === 'updates') {
        // 检查 updates 中的 __interrupt__
        if (chunk.data?.__interrupt__ && chunk.data.__interrupt__.length > 0) {
          interruptData = chunk.data.__interrupt__[0];
        }
      }

      // 检测 interrupt event（兼容）
      if (chunk.event === 'interrupt') {
        interruptData = chunk.data;
        break;
      }
    }

    // 如果有 interrupt，返回给前端
    if (interruptData) {
      return res.json({
        status: 'interrupted',
        action: interruptData.value?.action || 'unknown',
        params: interruptData.value?.params || {},
        threadId: actualThreadId,
        sessionId: actualSessionId,
      });
    }

    // 正常完成，返回结果
    const intent = lastValue?.intent;
    const stateTempData = lastValue?.tempData;
    const messages = lastValue?.messages || [];

    // 检查 stateTempData 中是否有前端工具请求（兼容旧方式）
    if (stateTempData?.needsFrontendTool) {
      return res.json({
        status: 'interrupted',
        action: stateTempData.frontendToolAction || 'unknown',
        params: stateTempData.frontendToolParams || {},
        operationParams: stateTempData.operationParams || null,  // 返回给前端，resume 时需要传回
        intent,  // 返回 intent，resume 时需要传回
        threadId: actualThreadId,
        sessionId: actualSessionId,
      });
    }

    // 提取最后一条 assistant 消息
    let assistantMessage = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgType = msg.type || msg.role || msg._getType?.();
      if (msgType === 'assistant' || msgType === 'ai') {
        assistantMessage = String(msg.content);
        break;
      }
    }

    // 如果没有找到 assistant 消息，使用 action 生成默认消息
    if (!assistantMessage) {
      const typeMap: Record<string, string> = { square: '正方形', circle: '圆形', triangle: '三角形' };
      if (intent === 'create' && stateTempData?.createdObject) {
        const obj = stateTempData.createdObject;
        assistantMessage = `已创建${typeMap[obj.type] || obj.type}`;
      } else if (intent === 'delete' && stateTempData?.targetObjectId) {
        assistantMessage = `已删除对象`;
      } else if (intent === 'modify' && stateTempData?.modifiedObject) {
        assistantMessage = `已修改对象`;
      } else {
        assistantMessage = '执行完成';
      }
    }

    const response: any = {
      status: 'completed',
      message: assistantMessage,
      sessionId: actualSessionId,
      threadId: actualThreadId,
    };

    // 使用动态映射处理 action
    const handler = ACTION_MAP[intent as keyof typeof ACTION_MAP] || ACTION_MAP.default;
    Object.assign(response, handler(stateTempData));

    res.json(response);
  } catch (error: any) {
    console.error('❌ SDK 处理消息失败:', error);
    res.status(500).json({
      error: '处理消息失败',
      details: error.message,
    });
  }
}

/**
 * POST /api/chat-sdk/continue
 * 处理 interrupt 后的 continue 请求
 */
export async function handleChatSDKContinue(req: Request, res: Response) {
  try {
    const { threadId, sessionId, toolResult, operationParams, intent } = req.body;

    console.log('📥 Continue 请求:');
    console.log('  - threadId:', threadId);
    console.log('  - toolResult:', JSON.stringify(toolResult));
    console.log('  - operationParams:', JSON.stringify(operationParams));
    console.log('  - intent:', intent);

    if (!threadId || !toolResult) {
      return res.status(400).json({ error: '缺少 threadId 或 toolResult 参数' });
    }

    // Resume workflow - 将 toolResult 和 operationParams 合并到 tempData
    const inputData = {
      intent,  // 恢复 intent
      tempData: {
        nearbyObjects: toolResult,
        objectsByType: toolResult,
        lastCreated: toolResult,
        operationParams,  // 恢复原来的 operationParams
        resumed: true,
      },
    };
    console.log('📤 发送到 LangGraph 的 input:', JSON.stringify(inputData, null, 2));

    const streamResponse = client.runs.stream(
      threadId,
      ASSISTANT_ID,
      {
        input: inputData,
        streamMode: ['values', 'updates'],
        multitaskStrategy: 'reject',
      }
    );

    let lastValue: any = null;

    for await (const chunk of streamResponse) {
      if (chunk.event === 'values') {
        lastValue = chunk.data;
      }
    }

    // 返回结果
    const resultIntent = lastValue?.intent;
    const tempData = lastValue?.tempData;
    const messages = lastValue?.messages || [];

    console.log('📊 LangGraph 返回结果:');
    console.log('  - resultIntent:', resultIntent);
    console.log('  - tempData:', JSON.stringify(tempData));
    console.log('  - modifiedObject:', JSON.stringify(tempData?.modifiedObject));

    // 提取最后一条 assistant 消息
    let assistantMessage = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgType = msg.type || msg.role || msg._getType?.();
      if (msgType === 'assistant' || msgType === 'ai') {
        assistantMessage = String(msg.content);
        break;
      }
    }

    // 如果没有找到 assistant 消息，使用 action 生成默认消息
    if (!assistantMessage) {
      if (resultIntent === 'delete' && tempData?.targetObjectId) {
        assistantMessage = `已删除对象`;
      } else if (resultIntent === 'modify' && tempData?.modifiedObject) {
        assistantMessage = `已修改对象`;
      } else {
        assistantMessage = '执行完成';
      }
    }

    const response: any = {
      status: 'completed',
      message: assistantMessage,
      sessionId,
      threadId,
    };

    // 使用动态映射处理 action
    const handler = ACTION_MAP[resultIntent as keyof typeof ACTION_MAP] || ACTION_MAP.default;
    Object.assign(response, handler(tempData));

    res.json(response);
  } catch (error: any) {
    console.error('❌ SDK Continue 失败:', error);
    res.status(500).json({
      error: 'Continue 失败',
      details: error.message,
    });
  }
}
