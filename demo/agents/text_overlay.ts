import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";

export function createTextOverlayAgent() {
  return async function textOverlayAgent(state: AgentState): Promise<Command<"supervisor">> {
    console.log("\n✍️ 文本叠加智能体：正在处理请求...");

    return new Command({
      goto: "supervisor",
      update: {
        processed_image_url: "mock_text_overlay_image.jpg",
        messages: [...state.messages, { role: "system", content: "文本叠加智能体：已在图像上添加文字" }]
      }
    });
  };
}