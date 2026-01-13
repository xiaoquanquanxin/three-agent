import {StateGraph, START, MemorySaver, Annotation} from '@langchain/langgraph';
import {AgentState} from '../types';
import {createSupervisorAgent} from './supervisor';
import {createCreateAgent} from './createAgent';
import {createDeleteAgent} from './deleteAgent';
import {createModifyAgent} from './modifyAgent';
import {createQueryAgent} from './queryAgent';
import {MessagesAnnotation} from '@langchain/langgraph';

/**
 * LangGraph workflow for SDK server
 * 此文件由 langgraph.json 引用，供 LangGraph SDK 服务器使用
 */
console.log('🔧 构建 LangGraph workflow for SDK server...');

// 定义完整的 State Annotation
const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  sessionId: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => '',
  }),
  intent: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  tempData: Annotation<any>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

const builder = new StateGraph(StateAnnotation);

builder.addNode('supervisor', createSupervisorAgent(), {
  ends: ['create_agent', 'delete_agent', 'modify_agent', 'query_agent', '__end__'],
});
builder.addNode('create_agent', createCreateAgent(), {
  ends: ['supervisor', '__end__'],
});
builder.addNode('delete_agent', createDeleteAgent(), {
  ends: ['supervisor', '__end__'],
});
builder.addNode('modify_agent', createModifyAgent(), {
  ends: ['supervisor'],
});
builder.addNode('query_agent', createQueryAgent(), {
  ends: ['supervisor'],
});

builder.addEdge(START, 'supervisor');

const checkpointer = new MemorySaver();
export const graph = builder.compile({checkpointer});

console.log('✅ Graph 导出完成');
