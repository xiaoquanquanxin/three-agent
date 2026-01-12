import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { updateShape, getShapeById, recordOperation } from '../database/operations';

/**
 * 创建 ModifyAgent（简化版，暂不支持 interrupt）
 * 职责：修改指定对象的属性
 */
export function createModifyAgent() {
  return async function modifyAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    console.log('\n✏️  ModifyAgent: 处理修改对象请求...');

    // 简化版：从 tempData 中获取目标对象和修改参数
    const targetId = state.tempData?.targetObjectId;
    const params = state.tempData?.operationParams;

    if (!targetId || !params) {
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: '请指定要修改的对象和参数',
            } as any,
          ],
        },
      });
    }

    try {
      // 获取原对象
      const beforeState = getShapeById(targetId);

      if (!beforeState) {
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

      // 更新对象
      updateShape(targetId, params);

      // 获取更新后的对象
      const afterState = getShapeById(targetId);

      // 记录操作历史
      recordOperation({
        session_id: state.sessionId,
        shape_id: targetId,
        operation: 'update',
        before_state: beforeState,
        after_state: afterState,
      });

      console.log(`✅ 修改成功: ${targetId}`);

      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: `已修改对象（ID: ${targetId}）`,
            } as any,
          ],
        },
      });
    } catch (error) {
      console.error('❌ 修改失败:', error);
      return new Command({
        goto: 'supervisor',
        update: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: `修改失败: ${error}`,
            } as any,
          ],
        },
      });
    }
  };
}
