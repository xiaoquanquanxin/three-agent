// agent.js - 本地开发用
import {StateGraph, START} from "@langchain/langgraph";
import {interrupt} from "@langchain/langgraph";
import {z} from "zod";

const State = z.object({
  // BaseMessage
  messages: z.array(z.object({})),
  // 前端返回的对象缓存
  objects: z.record(z.string()).optional(),
});

function threeAgentNode(state) {
  const lastMessage = state.messages[state.messages.length - 1];

  // LLM 解析意图（简化，用 mock LLM）
  const intent = parseUserIntent(lastMessage.content);

  if (intent.action === "findObject") {
    // 中断等待前端执行
    return interrupt({
      action: "findObject",
      params: {
        position: intent.position,  // [0,0,0]
        type: intent.type || "circle"
      }
    });
  }

  if (intent.action === "deleteObject" && state.objects) {
    // 有对象ID，直接删除
    return {
      messages: [{role: "assistant", content: `已删除对象 ${intent.objectId}`}]
    };
  }

  return {messages: [{role: "assistant", content: "请描述操作"}]};
}

const workflow = new StateGraph(State)
  .addNode("agent", threeAgentNode)
  .addEdge(START, "agent");

export const app = workflow.compile();