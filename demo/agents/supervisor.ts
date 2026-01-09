import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Command } from "langgraph";
import { AgentState } from "../agent_types/state";
import { SUPERVISOR_MODEL, SUPERVISOR_TEMPERATURE } from "../config/settings";

type NextAgent = "image_generation" | "text_overlay" | "background_removal" | "__end__";

export function createSupervisorAgent() {
  const llm = new ChatOpenAI({
    modelName: SUPERVISOR_MODEL,
    temperature: SUPERVISOR_TEMPERATURE
  });

  const systemPrompt = `您是一个协调图像处理任务的监督者智能体。
根据用户的请求和当前状态，确定下一个应该执行的任务。

可用任务：
1. image_generation - 当用户需要创建新图像时
2. text_overlay - 当需要在图像上添加文本时
3. background_removal - 当需要从图像中移除背景时

规则：
- 按顺序处理任务，直到所有请求的操作都完成
- 如果请求提到创建/生成图像，从 'image_generation' 开始
- 在图像生成后，如果请求了文本/标题，使用 'text_overlay'
- 如果请求提到移除/删除背景，使用 'background_removal'
- 只有在所有请求的任务都完成时才回复 '__end__'
- 在决定下一个任务时，要同时考虑原始请求和当前任务状态

示例序列：
- "生成一张图片并添加文字" → image_generation → text_overlay → __end__
- "创建一张图片，移除背景，添加文字" → image_generation → background_removal → text_overlay → __end__`;

  return async function supervisorAgent(state: AgentState): Promise<Command<NextAgent>> {
    console.log("\n🎯 监督者智能体：决定下一个任务...");

    const messages = state.messages;
    const userRequest = messages[0].content;

    const llmMessages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`
原始请求： ${userRequest}
当前任务： ${state.current_task}

下一个任务应该是什么？
`)
    ];

    const response = await llm.invoke(llmMessages);
    const responseContent = response.content as string;

    let nextAgent: NextAgent;
    if (responseContent.toLowerCase().includes("image_generation")) {
      nextAgent = "image_generation";
    } else if (responseContent.toLowerCase().includes("text_overlay")) {
      nextAgent = "text_overlay";
    } else if (responseContent.toLowerCase().includes("background_removal")) {
      nextAgent = "background_removal";
    } else {
      nextAgent = "__end__";
    }

    console.log(`➡️ 下一个智能体： ${nextAgent}`);

    return new Command({
      goto: nextAgent,
      update: {
        next_agent: nextAgent,
        current_task: nextAgent,
        messages: [...state.messages, { role: "system", content: `监督者：路由到 ${nextAgent}` }]
      }
    });
  };
}