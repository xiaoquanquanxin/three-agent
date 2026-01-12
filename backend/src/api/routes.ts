import { Router } from 'express';
import { handleChat, handleGetShapes } from './handlers';

const router = Router();

/**
 * POST /api/chat
 * 处理用户输入
 */
router.post('/chat', handleChat);

/**
 * GET /api/shapes
 * 获取所有形状
 */
router.get('/shapes', handleGetShapes);

export default router;
