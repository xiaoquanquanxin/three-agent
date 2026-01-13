import { BaseMessage } from '@langchain/core/messages';

/**
 * Agent 状态定义
 * 参考 demo/agent_types/state.ts
 */
export interface AgentState {
  // ===== 对话历史 =====
  messages: BaseMessage[];

  // ===== 会话信息 =====
  sessionId: string;
  threadId?: string;

  // ===== 意图和任务管理 =====
  /**
   * 用户意图
   * - create: 创建对象
   * - delete: 删除对象
   * - modify: 修改对象
   * - query: 查询对象
   */
  intent?: 'create' | 'delete' | 'modify' | 'query';

  /**
   * 下一个要执行的 Agent
   */
  next_agent?: string;

  /**
   * 当前任务描述
   */
  current_task?: string;

  // ===== 临时数据（interrupt 恢复后的数据） =====
  tempData?: {
    // --- 前端工具返回的数据 ---
    /**
     * 附近的对象（getNearbyObjects 返回）
     */
    nearbyObjects?: Array<{
      id: string;
      type: string;
      position: [number, number, number];
      distance: number;
    }>;

    /**
     * 最近创建的对象（getLastCreated 返回）
     */
    lastCreated?: {
      id: string;
      type: string;
    };

    /**
     * 视野内的对象（getObjectsInView 返回）
     */
    objectsInView?: Array<{
      id: string;
      type: string;
    }>;

    // --- 当前操作的目标和参数 ---
    /**
     * 目标对象 ID
     */
    targetObjectId?: string;

    /**
     * 操作参数（如边长、半径、位置等）
     */
    operationParams?: Record<string, any>;

    // --- 已创建/修改的对象 ---
    /**
     * 已创建的对象
     */
    createdObject?: {
      id: string;
      type: 'square' | 'circle' | 'triangle';
      position: [number, number, number];
      [key: string]: any;
    };

    /**
     * 已修改的对象
     */
    modifiedObject?: {
      id: string;
      type: string;
      [key: string]: any;
    };
  };

  // ===== 引用栈（优化阶段添加，用于"上一个正方形"） =====
  /**
   * 对话中提到的对象引用栈
   */
  referencedObjects?: Array<{
    type: string;
    id: string;
    mentionedAt: number;  // 第几轮对话提到的
  }>;
}

/**
 * Supervisor Agent 可以路由到的下一个 Agent
 */
export type NextAgent =
  | 'create_agent'
  | 'delete_agent'
  | 'modify_agent'
  | 'query_agent'
  | '__end__';
