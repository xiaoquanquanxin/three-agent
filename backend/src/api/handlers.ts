import { Request, Response } from 'express';
import { HumanMessage } from '@langchain/core/messages';
import { createWorkflow } from '../agents/workflow';
import { AgentState } from '../types';
import { generateId } from '../utils/uuid';
import { getAllShapes } from '../database/operations';

// 创建 workflow 实例
const workflow = createWorkflow();

/**
 * POST /api/chat
 * 处理用户输入，执行 workflow
 */
export async function handleChat(req: Request, res: Response) {
  try {
    const { message, sessionId, threadId } = req.body;

    if (!message) {
      return res.status(400).json({ error: '缺少 message 参数' });
    }

    const actualSessionId = sessionId || generateId();
    const actualThreadId = threadId || generateId();

    console.log(`\n📨 收到消息: "${message}"`);
    console.log(`   Session: ${actualSessionId}`);
    console.log(`   Thread: ${actualThreadId}`);

    // 初始化状态
    const initialState: AgentState = {
      messages: [new HumanMessage(message)],
      sessionId: actualSessionId,
      threadId: actualThreadId,
    };

    // 执行 workflow
    const result = await workflow.invoke(initialState, {
      configurable: { thread_id: actualThreadId },
    });

    console.log('✅ Workflow 执行完成');

    // 获取最后一条 assistant 消息（跳过系统消息）
    let responseMessage = '执行完成';
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      const role = (msg as any).role || (msg as any)._getType?.();
      if (role === 'assistant') {
        responseMessage = String(msg.content);
        break;
      }
    }

    // 构造响应（按照接口协议）
    const response: any = {
      status: 'completed',
      message: responseMessage,
      sessionId: actualSessionId,
      threadId: actualThreadId,
    };

    // 根据意图添加 action 和数据
    if (result.intent === 'create' && result.tempData?.createdObject) {
      response.action = 'create';
      response.data = result.tempData.createdObject;
    } else if (result.intent === 'delete' && result.tempData?.targetObjectId) {
      response.action = 'delete';
      response.targetId = result.tempData.targetObjectId;
    } else if (result.intent === 'modify' && result.tempData?.modifiedObject) {
      response.action = 'modify';
      response.data = result.tempData.modifiedObject;
    } else {
      response.action = 'none';
    }

    console.log('📤 返回响应:', JSON.stringify({
      status: response.status,
      action: response.action,
      hasData: !!response.data,
      message: response.message.substring(0, 50),
    }));

    // 返回响应
    res.json(response);
  } catch (error: any) {
    console.error('❌ 处理消息失败:', error);
    res.status(500).json({
      error: '处理消息失败',
      details: error.message,
    });
  }
}

/**
 * GET /api/shapes
 * 获取所有形状（用于前端初始化）
 */
export async function handleGetShapes(req: Request, res: Response) {
  try {
    const shapes = getAllShapes();
    res.json({ shapes });
  } catch (error: any) {
    console.error('❌ 获取形状失败:', error);
    res.status(500).json({
      error: '获取形状失败',
      details: error.message,
    });
  }
}
