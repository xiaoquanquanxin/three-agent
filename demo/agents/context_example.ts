import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";

export function createContextExampleAgent() {
  const llm = new ChatOpenAI({
    modelName: "gpt-4",
    temperature: 0
  });

  return async function contextExampleAgent(state: AgentState): Promise<Command<"supervisor">> {
    console.log("\n📋 上下文示例智能体：展示两种上下文...");
    
    // ========== 全局上下文 (AgentState) ==========
    console.log("🌍 全局上下文内容：");
    console.log("- 原始请求:", state.messages[0].content);
    console.log("- 当前任务:", state.current_task);
    console.log("- 处理结果:", state.processed_image_url);
    console.log("- 历史消息数量:", state.messages.length);
    
    // ========== 子 Agent 上下文 (LLM Messages) ==========
    console.log("🤖 子 Agent 上下文构建：");
    
    // 从全局上下文中提取需要的信息
    const userRequest = state.messages[0].content as string;
    const taskHistory = state.messages.slice(1).map(msg => 
      typeof msg === 'object' && 'content' in msg ? msg.content : String(msg)
    ).join('; ');
    
    // 构建子 Agent 专用的上下文
    const agentMessages = [
      // 子 Agent 的系统提示（不是全局的）
      new SystemMessage(`你是一个任务总结专家。
你只需要关注任务执行情况，不需要了解其他 agents 的内部逻辑。`),
      
      // 子 Agent 的用户输入（从全局上下文提取）
      new HumanMessage(`
用户原始请求: ${userRequest}
已执行的任务: ${taskHistory}
请简要总结当前进度。`)
    ];
    
    console.log("- 系统提示:", agentMessages[0].content);
    console.log("- 用户输入:", agentMessages[1].content);
    
    // LLM 调用（使用子 Agent 上下文）
    const response = await llm.invoke(agentMessages);
    const summary = response.content as string;
    
    // 结果更新到全局上下文
    return new Command({
      goto: "supervisor",
      update: {
        // 更新全局上下文
        messages: [...state.messages, { 
          role: "system", 
          content: `任务总结：${summary}` 
        }]
      }
    });
  };
}