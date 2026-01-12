import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { AgentState, NextAgent } from '../types';
import { config } from '../config/settings';

/**
 * 创建 Supervisor Agent
 * 职责：分析用户意图，路由到对应的子 Agent
 * 参考：demo/agents/supervisor.ts
 */
export function createSupervisorAgent() {
  // 初始化 LLM（使用阿里云通义千问）
  const llm = new ChatOpenAI({
    modelName: config.modelName,
    temperature: 0.7,
    openAIApiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
  });

  const systemPrompt = `你是一个协调 Three.js 场景编辑任务的监督者智能体。
根据用户的请求和当前状态，确定下一个应该执行的任务。

可用任务：
1. create_agent - 当用户需要创建新对象时（正方形、圆形、三角形）
2. delete_agent - 当用户需要删除对象时
3. modify_agent - 当用户需要修改对象时
4. query_agent - 当用户需要查询对象信息时

规则：
- 分析用户输入，识别其意图（创建、删除、修改、查询）
- 只在确定用户想要执行某个操作时，才路由到对应的 Agent
- 如果用户的请求不明确，回复 '__end__' 并在 messages 中添加澄清信息
- 只有在任务完成或无法继续时，才回复 '__end__'

示例：
- "画一个正方形" → create_agent
- "删除附近的圆形" → delete_agent
- "修改上一个正方形的边长" → modify_agent
- "场景中有几个对象？" → query_agent
- "你好" → __end__ (不是编辑任务)`;

  return async function supervisorAgent(
    state: AgentState
  ): Promise<Command<NextAgent>> {
    console.log('\n🎯 Supervisor Agent: 分析用户意图...');

    const messages = state.messages;
    const userRequest = messages[messages.length - 1].content;

    // 构建 LLM 输入
    const llmMessages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`
用户请求：${userRequest}
当前任务：${state.current_task || '无'}

请分析用户意图，确定下一个应该执行的 Agent。
回复格式：只需要回复 Agent 名称，如 "create_agent" 或 "delete_agent" 或 "__end__"
`),
    ];

    // 调用 LLM
    const response = await llm.invoke(llmMessages);
    const responseContent = response.content as string;

    // 解析 LLM 回复，确定下一个 Agent
    let nextAgent: NextAgent;
    let intent: AgentState['intent'] | undefined;

    if (responseContent.toLowerCase().includes('create_agent')) {
      nextAgent = 'create_agent';
      intent = 'create';
    } else if (responseContent.toLowerCase().includes('delete_agent')) {
      nextAgent = 'delete_agent';
      intent = 'delete';
    } else if (responseContent.toLowerCase().includes('modify_agent')) {
      nextAgent = 'modify_agent';
      intent = 'modify';
    } else if (responseContent.toLowerCase().includes('query_agent')) {
      nextAgent = 'query_agent';
      intent = 'query';
    } else {
      nextAgent = '__end__';
      intent = undefined;
    }

    console.log(`➡️  下一个 Agent: ${nextAgent}`);
    if (intent) {
      console.log(`🎯 用户意图: ${intent}`);
    }

    // 返回 Command，路由到下一个 Agent
    return new Command({
      goto: nextAgent,
      update: {
        intent,
        next_agent: nextAgent,
        current_task: nextAgent === '__end__' ? undefined : nextAgent,
        messages: [
          ...state.messages,
          {
            role: 'system',
            content: `Supervisor: 路由到 ${nextAgent}`,
          } as any,
        ],
      },
    });
  };
}
