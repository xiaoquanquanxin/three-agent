import { Router } from 'express';
// import { handleChat, handleGetShapes } from './handlers';  // 旧版 - 已注释
import { handleChatSDK, handleChatSDKContinue } from './handlers-sdk';
import { handleGetShapes } from './handlers';  // 保留 handleGetShapes，用于获取形状列表

const router = Router();

/**
 * POST /api/chat
 * 处理用户输入（旧版 - 直接 invoke）
 * 已注释，使用 SDK 方式
 */
// router.post('/chat', handleChat);

/**
 * POST /api/chat-sdk
 * 处理用户输入（新版 - 使用 SDK）
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
