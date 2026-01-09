import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";

export function createImageGenerationAgent() {
  return async function imageGenerationAgent(state: AgentState): Promise<Command<"supervisor">> {
    console.log("\n🎨 图像生成智能体：正在处理请求...");

    return new Command({
      goto: "supervisor",
      update: {
        processed_image_url: "mock_generated_image.jpg",
        messages: [...state.messages, { role: "system", content: "图像生成智能体：已生成新图像" }]
      }
    });
  };
}