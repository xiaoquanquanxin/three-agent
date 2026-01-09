import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";

export function createBackgroundRemovalAgent() {
  return async function backgroundRemovalAgent(state: AgentState): Promise<Command<"supervisor">> {
    console.log("\n✂️ 背景移除智能体：正在处理请求...");

    return new Command({
      goto: "supervisor",
      update: {
        processed_image_url: "mock_bg_removed_image.jpg",
        messages: [...state.messages, { role: "system", content: "背景移除智能体：已移除图像背景" }]
      }
    });
  };
}