import { StateGraph, START, MemorySaver } from '@langchain/langgraph';
import { AgentState } from '../types';
import { createSupervisorAgent } from './supervisor';
import { createCreateAgent } from './createAgent';
import { createDeleteAgent } from './deleteAgent';
import { createModifyAgent } from './modifyAgent';
import { createQueryAgent } from './queryAgent';

/**
 * 创建 Three-Agent workflow
 * 注意：此文件用于 LangGraph SDK 服务器（langgraph dev）
 * 前端通过 SDK 调用，不再直接使用 createWorkflow()
 * 参考：demo/supervisor.ts
 */
export function createWorkflow() {
  console.log('🔧 构建 LangGraph workflow...');

  // 创建图，定义 State channels
  const builder = new StateGraph<AgentState>({
    channels: {
      messages: {
        reducer: (x, y) => x.concat(y),
        default: () => [],
      },
      sessionId: {
        default: () => '',
      },
      threadId: null,
      intent: null,
      next_agent: null,
      current_task: null,
      tempData: null,
      referencedObjects: null,
    },
  });

  // 添加 Agent 节点（使用 Command 时需要指定 ends）
  builder.addNode('supervisor', createSupervisorAgent(), {
    ends: ['create_agent', 'delete_agent', 'modify_agent', 'query_agent', '__end__'],
  });
  builder.addNode('create_agent', createCreateAgent(), {
    ends: ['supervisor', '__end__'],  // 允许直接结束（用于 interrupt）
  });
  builder.addNode('delete_agent', createDeleteAgent(), {
    ends: ['supervisor'],
  });
  builder.addNode('modify_agent', createModifyAgent(), {
    ends: ['supervisor'],
  });
  builder.addNode('query_agent', createQueryAgent(), {
    ends: ['supervisor'],
  });

  // 添加起始边：从 START 到 supervisor
  builder.addEdge(START, 'supervisor');

  // 编译图（使用 MemorySaver 作为 checkpoint）
  const checkpointer = new MemorySaver();
  const compiledGraph = builder.compile({ checkpointer });

  console.log('✅ LangGraph workflow 构建完成');

  return compiledGraph;
}

// 导出 graph 供 langgraph dev 使用
console.log('🔧 构建 LangGraph workflow for langgraph dev...');

const builder = new StateGraph<AgentState>({
  channels: {
    messages: {
      reducer: (x, y) => x.concat(y),
      default: () => [],
    },
    sessionId: {
      default: () => '',
    },
    threadId: null,
    intent: null,
    next_agent: null,
    current_task: null,
    tempData: null,
    referencedObjects: null,
  },
});

builder.addNode('supervisor', createSupervisorAgent(), {
  ends: ['create_agent', 'delete_agent', 'modify_agent', 'query_agent', '__end__'],
});
builder.addNode('create_agent', createCreateAgent(), {
  ends: ['supervisor', '__end__'],
});
builder.addNode('delete_agent', createDeleteAgent(), {
  ends: ['supervisor'],
});
builder.addNode('modify_agent', createModifyAgent(), {
  ends: ['supervisor'],
});
builder.addNode('query_agent', createQueryAgent(), {
  ends: ['supervisor'],
});

builder.addEdge(START, 'supervisor');

const checkpointer = new MemorySaver();
export const graph = builder.compile({ checkpointer });

console.log('✅ Graph 导出完成');
