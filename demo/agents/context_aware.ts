import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";

export function createContextAwareAgent() {
  const llm = new ChatOpenAI({
    modelName: "gpt-4",
    temperature: 0
  });

  return async function contextAwareAgent(state: AgentState): Promise<Command<"supervisor">> {
    console.log("\n🧠 上下文感知智能体：分析历史对话...");
    
    // 1. 获取原始用户请求
    const originalRequest = state.messages[0].content as string;
    
    // 2. 获取所有历史消息
    const conversationHistory = state.messages.map(msg => 
      typeof msg === 'object' && 'content' in msg ? msg.content : String(msg)
    ).join('\n');
    
    // 3. 获取当前处理状态
    const currentImageUrl = state.processed_image_url || "无";
    const currentTask = state.current_task || "未知";
    
    // 4. 构建包含完整上下文的提示
    const contextPrompt = `
原始请求: ${originalRequest}
当前任务: ${currentTask}
当前图像: ${currentImageUrl}
对话历史:
${conversationHistory}

基于以上上下文，请总结当前的处理进度。`;

    const messages = [
      new SystemMessage("你是一个上下文分析专家，能够理解多轮对话的完整上下文。"),
      new HumanMessage(contextPrompt)
    ];
    
    const response = await llm.invoke(messages);
    const analysis = response.content as string;

    return new Command({
      goto: "supervisor",
      update: {
        // 5. 更新状态，保留所有历史信息
        messages: [...state.messages, { 
          role: "system", 
          content: `上下文分析：${analysis}` 
        }]
      }
    });
  };
}