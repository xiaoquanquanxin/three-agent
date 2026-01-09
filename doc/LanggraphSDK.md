LangGraph SDK (@langchain/langgraph-sdk) 是 Node.js 客户端，用于与 LangSmith Deployment（部署的 LangGraph agents）交互，支持创建
threads、发送消息、处理 interrupts 和 streaming。

用于生产部署的 agent，与本地 LangGraph 不同（本地用 graph.invoke()）。

安装 & 初始化

```shell
npm install @langchain/langgraph-sdk
```

```ts
import {Client} from "@langchain/langgraph-sdk";

const client = new Client({
  apiUrl: "https://your-deployment-url.ai.langgraph.net",  // Deployment URL
// apiKey: "lsv2_..."  // 可选，如果需要
});
```

核心用法

1. 创建 Thread（会话）

```ts
const thread = await client.threads.create();
const threadId = thread.thread_id;  // 保存 threadId 用于恢复
```

2. 发送消息 & 运行 Graph

```ts
// 创建 run
const run = await client.runs.create(
  threadId,
  "your-agent-name",  // Deployment 中的 assistant_id
  {
    input: {
      messages: [{role: "human", content: "What's the weather?"}]
    }
  }
);

// 等待完成
await client.runs.join(threadId, run.run_id);
```

3. Streaming 支持

```ts
for await (const event of client.runs.stream(
  threadId,
  "agent",
  {input: {messages: [...]}},
  {streamMode: ["updates", "messages"]}
)) {
  console.log(event);
}
```

4. 处理 Interrupts（恢复）

```ts
// run 遇到 interrupt 时返回 __interrupt__
const result = await client.runs.wait(threadId, "agent", {input: {...}});
if (result.__interrupt__) {
  console.log("Paused:", result.__interrupt__);

// 恢复
  await client.runs.wait(
    threadId,
    "agent",
    {command: {resume: "approve"}}  // 或 edit/reject
  );
}
```

5. 查看 Thread State

```ts
```

const state = await client.threads.getState(threadId);
console.log(state.values.messages); // 当前消息历史

6. Double Texting（并发）

```ts

// 中断当前 run，运行新输入
await client.runs.create(threadId, "agent", {
input: { messages: [...] },
multitaskStrategy: "interrupt"  // enqueue/reject/rollback
});
```

React Hook（可选）

```shell
npm install @langchain/langgraph-sdk/react
```

```ts
import {useStream} from "@langchain/langgraph-sdk/react";

const {submit, messages} = useStream({
  apiUrl: "https://...",
  assistantId: "agent",
  threadId,  // 可选，自动管理
});
```

完整示例

```ts
async function chat() {
  const client = new Client({apiUrl: "https://..."});

// 新 thread
  const {thread_id} = await client.threads.create();

// 发送消息
  const run = await client.runs.create(thread_id, "agent", {
    input: {messages: [{role: "human", content: "Hi!"}]}
  });

// 等待结果
  const final = await client.runs.join(thread_id, run.run_id);
  console.log(final);
}
```
