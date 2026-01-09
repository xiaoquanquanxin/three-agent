import { StateGraph, START } from "langgraph";
import { HumanMessage } from "@langchain/core/messages";
import * as readline from "readline";
import { AgentState } from "./agent_types/state";
import { createSupervisorAgent } from "./agents/supervisor";
import { createImageGenerationAgent } from "./agents/image_generation";
import { createTextOverlayAgent } from "./agents/text_overlay";
import { createBackgroundRemovalAgent } from "./agents/background_removal";
import { OPENAI_API_KEY } from "./config/settings";

function createWorkflow() {
  // 创建图
  const builder = new StateGraph<AgentState>({
    channels: {
      messages: { reducer: (x, y) => x.concat(y) },
      next_agent: null,
      current_task: null,
      image_url: null,
      processed_image_url: null
    }
  });

  // 添加智能体节点
  builder.addNode("supervisor", createSupervisorAgent());
  builder.addNode("image_generation", createImageGenerationAgent());
  builder.addNode("text_overlay", createTextOverlayAgent());
  builder.addNode("background_removal", createBackgroundRemovalAgent());

  // 添加起始边
  builder.addEdge(START, "supervisor");

  const graph = builder.compile();
  return graph;
}

async function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function supervisor() {
  // 检查 OpenAI API 密钥
  if (!OPENAI_API_KEY) {
    console.log("错误：环境变量中未找到 OPENAI_API_KEY");
    return;
  }

  // 创建工作流
  const workflow = createWorkflow();

  // 获取用户输入
  console.log("\n🤖 图像处理多智能体系统");
  console.log("----------------------------------------");
  
  const userInstruction = await getUserInput(
    "\n您希望对图像进行什么操作？\n(例如：'生成一张日落图片并在上面添加文字')\n\n您的请求："
  );

  // 初始化状态
  const initialState: AgentState = {
    messages: [new HumanMessage(userInstruction)],
    next_agent: undefined,
    current_task: undefined,
    image_url: undefined,
    processed_image_url: undefined
  };

  console.log("\n🚀 启动工作流...");
  console.log("----------------------------------------");

  try {
    // 执行工作流
    const finalState = await workflow.invoke(initialState);

    // 打印结果
    console.log("\n✨ 工作流完成！");
    console.log("----------------------------------------");
    console.log("\n执行路径：");
    
    for (const msg of finalState.messages) {
      const content = typeof msg === 'object' && 'content' in msg ? msg.content : String(msg);
      console.log(`- ${content}`);
    }

    console.log(`\n最终图像URL：${finalState.processed_image_url}`);
  } catch (error) {
    console.error("执行工作流时出错：", error);
  }
}

if (require.main === module) {
  supervisor().catch(console.error);
}