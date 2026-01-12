import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { deleteShape, getShapeById, recordOperation } from '../database/operations';

/**
 * 创建 DeleteAgent（简化版，暂不支持 interrupt）
 * 职责：删除指定 ID 的对象
 */
export function createDeleteAgent() {
  return async function deleteAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    console.log('\n🗑️  DeleteAgent: 处理删除对象请求...');

    // 简化版：从 tempData 中获取目标对象 ID
    const targetId = state.tempData?.targetObjectId;

    if (!targetId) {
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: '请指定要删除的对象 ID',
            } as any,
          ],
        },
      });
    }

    try {
      // 获取对象（用于记录历史）
      const shape = getShapeById(targetId);

      if (!shape) {
        return new Command({
          goto: 'supervisor',
          update: {
            messages: [
              ...state.messages,
              {
                role: 'assistant',
                content: `未找到对象: ${targetId}`,
              } as any,
            ],
          },
        });
      }

      // 删除
      deleteShape(targetId);

      // 记录操作历史
      recordOperation({
        session_id: state.sessionId,
        shape_id: targetId,
        operation: 'delete',
        before_state: shape,
        after_state: null,
      });

      console.log(`✅ 删除成功: ${targetId}`);

      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: `已删除对象（ID: ${targetId}）`,
            } as any,
          ],
        },
      });
    } catch (error) {
      console.error('❌ 删除失败:', error);
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: `删除失败: ${error}`,
            } as any,
          ],
        },
      });
    }
  };
}
