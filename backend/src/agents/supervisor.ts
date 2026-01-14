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
根据用户的请求，确定下一个应该执行的任务。

重要：你必须只返回任务名称，不要有任何其他文字！

可用任务：
1. create_agent - 创建/新增/绘制新对象（正方形、圆形、三角形）
2. delete_agent - 删除/移除对象
3. modify_agent - 修改/更改已有对象的属性
4. query_agent - 查询对象信息
5. __end__ - 非编辑任务或任务完成

关键区分：
- "新增"、"创建"、"画"、"绘制"、"添加" → create_agent（创建新对象）
- "修改"、"改成"、"改为"、"调整" → modify_agent（修改已有对象）

示例：
用户："画一个正方形" → create_agent
用户："创建一个圆形，半径10" → create_agent
用户："新增一个三角形，在 0,10,10 位置" → create_agent
用户："添加一个正方形，边长5" → create_agent
用户："删除附近的圆形" → delete_agent
用户："修改上一个正方形的边长" → modify_agent
用户："把三角形的边长改为10" → modify_agent
用户："场景中有几个对象？" → query_agent
用户："你好" → __end__

记住：只返回任务名称，不要有任何解释！`;

  return async function supervisorAgent(
    state: AgentState
  ): Promise<Command<NextAgent>> {
    console.log(`\n🎯 SUPERVISOR: intent=${state.intent}, operationParams=${!!state.tempData?.operationParams}`);

    const messages = state.messages;

    if (state.tempData?.operationParams) {
      const intent = state.intent;
      console.log(`🔄 CONTINUE -> ${intent}_agent`);
      
      const agentMap: Record<string, NextAgent> = {
        create: 'create_agent',
        delete: 'delete_agent',
        modify: 'modify_agent',
        query: 'query_agent',
      };
      
      const nextAgent = agentMap[intent as string] || '__end__';
      
      return new Command({
        goto: nextAgent,
        update: {
          intent: state.intent,
          tempData: state.tempData,
          messages: state.messages,
        },
      });
    }

    const userRequest = messages[messages.length - 1].content;

    // 构建 LLM 输入
    const llmMessages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`用户请求：${userRequest}

请只回复任务名称（create_agent、delete_agent、modify_agent、query_agent 或 __end__）`),
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

    console.log(`➡️  ROUTE -> ${nextAgent}`);

    const shouldShowHelp = nextAgent === '__end__' && !state.intent;
    const helpMessage = shouldShowHelp
      ? `抱歉，我只能帮你编辑 3D 场景。我可以做的事情包括：

✨ 创建对象
• "画一个正方形，边长 5"
• "创建一个圆形，半径 10"
• "绘制一个三角形"

🗑️ 删除对象
• "删除坐标 (10, 0, 10) 附近的对象"
• "移除最后创建的正方形"

✏️ 修改对象
• "修改上一个正方形的边长为 8"
• "把那个圆形的半径改成 15"

📊 查询信息
• "场景中有几个对象？"
• "列举所有的形状"

请告诉我你想做什么吧！`
      : `Supervisor: 路由到 ${nextAgent}`;

    // 返回 Command，路由到下一个 Agent
    return new Command({
      goto: nextAgent,
      update: {
        // 如果是 __end__ 且已有 intent，保留原 intent；否则使用新解析的 intent
        intent: nextAgent === '__end__' && state.intent ? state.intent : intent,
        next_agent: nextAgent,
        current_task: nextAgent === '__end__' ? undefined : nextAgent,
        // 保留 tempData（包含 createdObject 等数据）
        tempData: state.tempData,
        messages: [
          ...state.messages,
          {
            role: shouldShowHelp ? 'assistant' : 'system',
            content: helpMessage,
          } as any,
        ],
      },
    });
  };
}
