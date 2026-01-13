import { StateGraph, START, MemorySaver } from '@langchain/langgraph';
import { AgentState } from '../types';
import { createSupervisorAgent } from './supervisor';
import { createCreateAgent } from './createAgent';
import { createDeleteAgent } from './deleteAgent';
import { createModifyAgent } from './modifyAgent';
import { createQueryAgent } from './queryAgent';

/**
 * LangGraph workflow for SDK server
 * 此文件由 langgraph.json 引用，供 LangGraph SDK 服务器使用
 */
console.log('🔧 构建 LangGraph workflow for SDK server...');

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
