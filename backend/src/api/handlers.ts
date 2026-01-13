import { Request, Response } from 'express';
import { getAllShapes } from '../database/operations';

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
