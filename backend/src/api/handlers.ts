import { Request, Response } from 'express';
import { getAllShapes, executeUndo, executeRedo } from '../database/operations';

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

/**
 * POST /api/undo
 * 撤销上一步操作
 */
export async function handleUndo(req: Request, res: Response) {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: '缺少 sessionId 参数' });
    }

    const result = executeUndo(sessionId);
    res.json(result);
  } catch (error: any) {
    console.error('❌ Undo 失败:', error);
    res.status(500).json({
      error: 'Undo 失败',
      details: error.message,
    });
  }
}

/**
 * POST /api/redo
 * 重做上一步撤销的操作
 */
export async function handleRedo(req: Request, res: Response) {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: '缺少 sessionId 参数' });
    }

    const result = executeRedo(sessionId);
    res.json(result);
  } catch (error: any) {
    console.error('❌ Redo 失败:', error);
    res.status(500).json({
      error: 'Redo 失败',
      details: error.message,
    });
  }
}
