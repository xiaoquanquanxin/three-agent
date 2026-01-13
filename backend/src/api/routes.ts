import { Router } from 'express';
import { handleChatSDK, handleChatSDKContinue } from './handlers-sdk';
import { handleGetShapes } from './handlers';

const router = Router();

/**
 * POST /api/chat-sdk
 * 处理用户输入（SDK 方式）
 */
router.post('/chat-sdk', handleChatSDK);

/**
 * POST /api/chat-sdk/continue
 * 处理 SDK interrupt 后的 continue 请求
 */
router.post('/chat-sdk/continue', handleChatSDKContinue);

/**
 * GET /api/shapes
 * 获取所有形状
 */
router.get('/shapes', handleGetShapes);

export default router;
