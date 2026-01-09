import { BaseMessage } from "@langchain/core/messages";

export interface AgentState {
  messages: BaseMessage[];
  next_agent?: string;
  current_task?: string;
  image_url?: string;
  processed_image_url?: string;
}