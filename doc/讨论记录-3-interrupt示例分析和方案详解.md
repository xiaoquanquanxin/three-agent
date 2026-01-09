# 讨论记录 #3 - interrupt 示例分析和方案详解

> 时间：2026-01-09
> 主题：分析官方 interrupt 示例、详解"上一个正方形"方案、MVP 概念说明

---

## 一、MVP 是什么意思？

**MVP = Minimum Viable Product（最小可行产品）**

不是"最有价值球员"😄，而是软件开发中的一个概念：

### 定义：
用最少的功能和最简单的实现，快速验证核心想法是否可行。

### 在我们项目中的应用：
- **MVP 阶段**：先实现最基础的功能，能跑通流程就行
  - 例如："上一个正方形"用最简单的方式（查询数据库最新创建的）
  - 不考虑复杂的对话语境
  - 不考虑错误处理

- **优化阶段**：在 MVP 能跑通后，再升级到更智能的方案
  - 例如：升级到"引用栈"方案，支持对话语境

### 为什么要分阶段？
1. **快速验证**：先确认技术方案可行
2. **降低风险**：避免一开始就做复杂设计，结果发现方向错了
3. **迭代优化**：基于实际使用体验再改进

---

## 二、关于"上一个正方形"的三个方案（详细说明）

### 背景场景：
```
用户对话：
1. "画一个正方形，边长5"    → 创建 square_001 (10:00)
2. "画一个圆形，半径3"       → 创建 circle_001 (10:01)
3. "再画一个正方形，边长8"   → 创建 square_002 (10:02)
4. "修改上一个正方形的边长为10"

问题：第4句中的"上一个正方形"指的是哪个？
```

---

### 方案 A：基于创建时间（最简单）

#### 实现方式：
```sql
-- 查询最近创建的正方形
SELECT * FROM shapes
WHERE type = 'square'
ORDER BY created_at DESC
LIMIT 1;

-- 结果：square_002（10:02 创建的）
```

#### 优点：
- **实现简单**：一条 SQL 查询就搞定
- **不需要额外存储**：只依赖数据库的 created_at 字段
- **性能好**：有索引的话查询很快

#### 缺点：
- **不符合对话语境**：如果用户在第3步和第4步之间说了很多其他话，"上一个"的含义可能不是"最近创建的"

#### 适用场景：
- MVP 阶段
- 用户操作比较线性（创建 → 修改 → 创建 → 修改...）
- 对话中不会频繁切换话题

---

### 方案 B：基于会话引用栈（推荐）

#### 核心思想：
在对话过程中，维护一个"最近提到的对象"列表。

#### 数据结构：
```typescript
// 存储在 LangGraph State 中
interface AgentState {
  messages: Message[];

  // 引用栈
  referencedObjects: Array<{
    type: 'square' | 'circle' | 'triangle';
    id: string;
    mentionedAt: number;  // 第几轮对话提到的
  }>;
}
```

#### 实现逻辑：

**步骤 1：创建对象时，推入栈**
```typescript
// 用户说："画一个正方形，边长5"
// CreateAgent 创建对象后
state.referencedObjects.push({
  type: 'square',
  id: 'square_001',
  mentionedAt: 1  // 第1轮对话
});
```

**步骤 2：提到对象时，更新栈**
```typescript
// 用户说："把那个正方形移动到..."
// LLM 识别到用户提到了 square_001
const existingRef = state.referencedObjects.find(
  obj => obj.id === 'square_001'
);
if (existingRef) {
  existingRef.mentionedAt = 3;  // 更新为第3轮对话
} else {
  state.referencedObjects.push({
    type: 'square',
    id: 'square_001',
    mentionedAt: 3
  });
}
```

**步骤 3：查询"上一个正方形"**
```typescript
// 用户说："修改上一个正方形"
function getLastReferenced(type: string, state: AgentState) {
  return state.referencedObjects
    .filter(obj => obj.type === type)
    .sort((a, b) => b.mentionedAt - a.mentionedAt)[0];
}

const lastSquare = getLastReferenced('square', state);
// 结果：最近提到的正方形（可能是创建的，也可能是对话中提到的）
```

**步骤 4：栈的维护（防止无限增长）**
```typescript
// 保留最近 20 个引用
if (state.referencedObjects.length > 20) {
  state.referencedObjects = state.referencedObjects
    .sort((a, b) => b.mentionedAt - a.mentionedAt)
    .slice(0, 20);
}
```

#### 优点：
- **符合对话语境**：考虑了用户在对话中提到的对象
- **更智能**：不仅仅是"最近创建的"，而是"最近提到的"
- **灵活**：可以处理复杂的对话场景

#### 缺点：
- **实现复杂**：需要在 State 中维护引用栈
- **需要 LLM 识别**：需要 LLM 判断用户是否提到了某个对象
- **状态管理**：引用栈需要随着对话持久化

#### 适用场景：
- 优化阶段
- 用户对话比较复杂（频繁切换话题）
- 需要更自然的交互体验

---

### 方案 C：让 LLM 自己判断（最智能但不可控）

#### 核心思想：
不维护引用栈，而是让 LLM 根据对话历史自己推断"上一个正方形"指的是哪个。

#### 实现方式：
```typescript
// 用户说："修改上一个正方形"
// 把完整的对话历史和所有正方形列表都给 LLM
const allSquares = await db.query(
  'SELECT * FROM shapes WHERE type = "square"'
);

const prompt = `
对话历史：
1. 用户："画一个正方形，边长5" → 创建了 square_001
2. 用户："画一个圆形，半径3" → 创建了 circle_001
3. 用户："再画一个正方形，边长8" → 创建了 square_002
4. 用户："修改上一个正方形的边长为10"

场景中的所有正方形：
- square_001 (边长5, 创建于 10:00)
- square_002 (边长8, 创建于 10:02)

问题：第4句中的"上一个正方形"指的是哪个？
请只回答 ID。
`;

const response = await llm.invoke(prompt);
// LLM 回答："square_002"
```

#### 优点：
- **最智能**：LLM 可以理解复杂的语境
- **实现简单**：不需要维护额外的数据结构
- **灵活**：可以处理各种边缘情况

#### 缺点：
- **不稳定**：LLM 可能判断错误
- **成本高**：每次都要调用 LLM，消耗 token
- **不可控**：无法保证 LLM 的判断逻辑

#### 适用场景：
- 长期优化（当 LLM 足够智能时）
- 对准确性要求不高的场景
- 作为方案 B 的补充（当引用栈找不到时，用 LLM 兜底）

---

### 三个方案对比总结：

| 维度 | 方案 A（创建时间） | 方案 B（引用栈） | 方案 C（LLM 推断） |
|------|-------------------|-----------------|-------------------|
| 实现复杂度 | ⭐ 低 | ⭐⭐ 中 | ⭐ 低 |
| 准确性 | ⭐⭐ 中 | ⭐⭐⭐ 高 | ⭐⭐ 中（不稳定） |
| 性能 | ⭐⭐⭐ 高 | ⭐⭐ 中 | ⭐ 低（需调用 LLM） |
| 符合语境 | ⭐ 低 | ⭐⭐⭐ 高 | ⭐⭐⭐ 高 |
| 可控性 | ⭐⭐⭐ 高 | ⭐⭐⭐ 高 | ⭐ 低 |

### 我的建议：
1. **MVP 阶段**：用方案 A（快速验证）
2. **优化阶段**：升级到方案 B（更好的用户体验）
3. **长期**：方案 B + 方案 C 混合（引用栈找不到时用 LLM 兜底）

---

## 三、官方 interrupt 示例分析

### 示例代码结构：

你从 LangChain 官网 AI 获取的示例非常清晰！让我逐步分析。

### 后端部分（backend.ts）

#### 1. State 定义
```typescript
const State = z.object({
  messages: z.array(z.object({})),
  objects: z.record(z.string()).optional(),  // 前端返回的对象缓存
});
```

**关键点：**
- `objects` 字段用于存储前端返回的数据
- 这个字段在 interrupt 恢复后会被填充

#### 2. Agent 节点中触发 interrupt
```typescript
function threeAgentNode(state) {
  const intent = parseUserIntent(lastMessage.content);

  if (intent.action === "findObject") {
    // 关键：使用 interrupt() 函数暂停执行
    return interrupt({
      action: "findObject",
      params: {
        position: intent.position,
        type: intent.type || "circle"
      }
    });
  }

  // interrupt 后，执行会暂停
  // 等待前端调用 resume 后，才会继续执行下面的代码

  if (intent.action === "deleteObject" && state.objects) {
    // 这里可以使用前端返回的 objects 数据
    return {
      messages: [{role: "assistant", content: `已删除对象 ${intent.objectId}`}]
    };
  }
}
```

**关键发现：**
- 使用 `interrupt()` 函数（从 `@langchain/langgraph` 导入）
- interrupt 返回的数据会传递给前端
- 恢复后，state 中会有前端提供的数据（通过 `state.objects`）

---

### 前端部分（frontend.tsx）

#### 1. 检测 interrupt
```typescript
// 在 streaming 过程中检测 interrupt
for await (const chunk of client.runs.stream(threadId, run.run_id)) {
  if (chunk.__interrupt__) {
    setInterrupt(chunk.__interrupt__[0].value);
    return;  // 暂停，等待用户交互
  }

  setMessages(prev => [...prev, chunk]);
}
```

**关键点：**
- `chunk.__interrupt__` 包含后端返回的 interrupt 数据
- `chunk.__interrupt__[0].value` 就是后端 `interrupt({...})` 中的对象

#### 2. 执行前端工具
```typescript
const handleInterrupt = async () => {
  if (interrupt.action === "findObject") {
    // 执行前端的 Three.js 查询
    const result = findNearestCircle(interrupt.params.position);

    // 高亮找到的对象（可选）
    const target = sceneRef.current.objects.find(o => o.uuid === result.id);
    target.material.color.setHex(0xff0000);

    // 关键：恢复 agent 执行，传递结果
    await client.runs.wait(threadId, "your-agent", {
      command: {resume: {foundObject: result}}
    });

    setInterrupt(null);
  }
};
```

**关键点：**
- 前端执行工具（`findNearestCircle`）
- 使用 `command: {resume: {...}}` 恢复执行
- `resume` 中的数据会合并到 State 中

---

### 完整流程图

```
用户："删除坐标 (10,0,10) 附近的圆形"
  ↓
前端：POST /api/chat (通过 LangGraph SDK)
  ↓
后端：LangGraph Agent 开始执行
  ↓
后端：parseUserIntent() → 识别为 "findObject"
  ↓
后端：return interrupt({action: "findObject", params: {...}})
  ↓
后端：执行暂停，checkpoint 自动保存
  ↓
前端：检测到 chunk.__interrupt__
  ↓
前端：setInterrupt(chunk.__interrupt__[0].value)
  ↓
前端：显示 interrupt 信息（可选）
  ↓
前端：执行 findNearestCircle() → 得到 result
  ↓
前端：client.runs.wait(threadId, "agent", {command: {resume: {foundObject: result}}})
  ↓
后端：从 checkpoint 恢复执行
  ↓
后端：state.objects = {foundObject: result}（resume 的数据合并到 State）
  ↓
后端：继续执行 threeAgentNode，这次 state.objects 有值了
  ↓
后端：执行删除逻辑
  ↓
前端：收到最终结果
```

---

## 四、应用到我们项目的方案

基于官方示例，我们项目的 interrupt 实现方案：

### 后端实现（Node.js + LangGraph）

#### 1. State 定义
```typescript
interface AgentState {
  messages: BaseMessage[];
  sessionId: string;
  threadId: string;

  // 前端工具返回的数据
  frontendToolResult?: {
    nearbyObjects?: Array<{id: string; type: string; position: [number, number, number]}>;
    lastCreated?: {id: string; type: string};
    objectsInView?: Array<{id: string; type: string}>;
  };

  // 业务数据
  targetObjectId?: string;
  operationParams?: Record<string, any>;
}
```

#### 2. DeleteAgent 中使用 interrupt
```typescript
import { interrupt } from "@langchain/langgraph";

async function deleteAgent(state: AgentState) {
  const userMessage = state.messages[state.messages.length - 1].content;

  // LLM 解析用户意图
  const intent = await parseDeleteIntent(userMessage);

  if (intent.needsFrontendData) {
    // 需要前端提供附近的对象
    return interrupt({
      action: "getNearbyObjects",
      params: {
        x: intent.position[0],
        y: intent.position[1],
        z: intent.position[2],
        radius: 5
      }
    });
  }

  // 恢复后，使用前端返回的数据
  if (state.frontendToolResult?.nearbyObjects) {
    const targetId = state.frontendToolResult.nearbyObjects[0].id;

    // 删除数据库记录
    await db.query('DELETE FROM shapes WHERE id = ?', [targetId]);

    return {
      messages: [...state.messages, {role: "assistant", content: `已删除对象 ${targetId}`}],
      targetObjectId: targetId
    };
  }
}
```

### 前端实现（React + Three.js）

#### 1. 检测 interrupt
```typescript
const [interrupt, setInterrupt] = useState(null);

const sendMessage = async (content: string) => {
  const run = await client.runs.create(threadId, "three-agent", {
    input: { messages: [{ role: "human", content }] }
  });

  for await (const chunk of client.runs.stream(threadId, run.run_id)) {
    if (chunk.__interrupt__) {
      setInterrupt(chunk.__interrupt__[0].value);
      return;
    }
  }
};
```

#### 2. 执行前端工具
```typescript
// Three.js 场景中查找附近的对象
const getNearbyObjects = (x: number, y: number, z: number, radius: number = 5) => {
  const targetPos = new THREE.Vector3(x, y, z);
  const results = [];

  scene.current.children.forEach(obj => {
    const distance = obj.position.distanceTo(targetPos);
    if (distance <= radius) {
      results.push({
        id: obj.userData.id,
        type: obj.userData.type,
        position: obj.position.toArray(),
        distance
      });
    }
  });

  return results.sort((a, b) => a.distance - b.distance);
};
```
