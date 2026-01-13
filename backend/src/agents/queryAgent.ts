import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { getAllShapes, getShapeById } from '../database/operations';

/**
 * 创建 QueryAgent
 * 职责：查询对象信息
 */
export function createQueryAgent() {
  return async function queryAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    try {
      const shapes = getAllShapes();

      const summary = shapes.reduce((acc, shape) => {
        acc[shape.type] = (acc[shape.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const message = `场景中共有 ${shapes.length} 个对象：
${Object.entries(summary)
  .map(([type, count]) => {
    const typeName = type === 'square' ? '正方形' : type === 'circle' ? '圆形' : '三角形';
    return `  - ${typeName}: ${count} 个`;
  })
  .join('\n')}`;

      console.log(`✅ QUERY: ${shapes.length} objects`);

      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: message,
            } as any,
          ],
        },
      });
    } catch (error) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: `查询失败: ${error}`,
            } as any,
          ],
        },
      });
    }
  };
}
