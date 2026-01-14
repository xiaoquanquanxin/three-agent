import { Router } from 'express';
import { handleChatSDK, handleChatSDKContinue } from './handlers-sdk';
import { handleGetShapes, handleUndo, handleRedo } from './handlers';

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

/**
 * POST /api/undo
 * 撤销上一步操作
 */
router.post('/undo', handleUndo);

/**
 * POST /api/redo
 * 重做上一步撤销的操作
 */
router.post('/redo', handleRedo);

export default router;
