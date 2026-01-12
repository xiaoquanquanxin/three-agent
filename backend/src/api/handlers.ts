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
    const { message, sessionId, threadId, toolResult, tempData } = req.body;

    if (!message && !toolResult) {
      return res.status(400).json({ error: '缺少 message 或 toolResult 参数' });
    }

    const actualSessionId = sessionId || generateId();
    // 重要：新消息时总是生成新的 threadId（避免消息累积）
    // 只有 continue 请求（有 toolResult）时才复用 threadId
    const actualThreadId = toolResult && threadId ? threadId : generateId();

    if (message) {
      console.log(`\n📨 收到消息: "${message.substring(0, 50)}..."`);
    } else {
      console.log(`\n🔄 收到 continue 请求`);
    }

    // 初始化状态
    let initialState: AgentState;

    if (toolResult) {
      // Continue 请求：恢复完整的 tempData（包括 operationParams 等）
      // 不传递 messages，让 workflow 从 checkpoint 恢复
      initialState = {
        messages: [],
        sessionId: actualSessionId,
        threadId: actualThreadId,
        tempData: tempData || {
          nearbyObjects: toolResult,
        },
      };
    } else {
      // 新请求：正常初始化
      initialState = {
        messages: [new HumanMessage(message)],
        sessionId: actualSessionId,
        threadId: actualThreadId,
      };
    }

    // 执行 workflow
    const result = await workflow.invoke(initialState, {
      configurable: { thread_id: actualThreadId },
    });

    console.log('✅ Workflow 执行完成');

    // 检查是否需要前端工具（简化的 interrupt）
    if (result.tempData?.needsFrontendTool) {
      console.log('⏸️ 需要前端工具，返回 interrupted 响应');

      return res.json({
        status: 'interrupted',
        action: result.tempData.frontendToolAction,
        params: result.tempData.frontendToolParams,
        threadId: actualThreadId,
        sessionId: actualSessionId,
        // 返回完整的 tempData，供前端 continue 时使用
        tempData: result.tempData,
      });
    }

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

    console.log(`✅ 返回响应: ${response.action}`);

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
