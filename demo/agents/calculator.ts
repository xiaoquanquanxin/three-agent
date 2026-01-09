import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";

export function createCalculatorAgent() {
  const llm = new ChatOpenAI({
    modelName: "gpt-4",
    temperature: 0
  });

  const systemPrompt = `你是一个数学计算专家。
请分析用户的数学问题并给出准确的计算结果。
只返回计算过程和最终答案，保持简洁。`;

  return async function calculatorAgent(state: AgentState): Promise<Command<"supervisor">> {
    console.log("\n🧮 计算器智能体：正在处理计算...");
    
    const userMessage = state.messages[0].content as string;
    
    // 调用 LLM 处理数学问题
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`请计算：${userMessage}`)
    ];
    
    const response = await llm.invoke(messages);
    const result = response.content as string;

    return new Command({
      goto: "supervisor",
      update: {
        processed_image_url: `calculation_result: ${result}`,
        messages: [...state.messages, { 
          role: "system", 
          content: `计算器智能体：${result}` 
        }]
      }
    });
  };
}