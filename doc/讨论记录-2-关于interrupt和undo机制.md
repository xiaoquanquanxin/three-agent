# 讨论记录 #2 - 关于 interrupt 和 undo 机制

> 时间：2026-01-09
> 主题：LangGraph interrupt 恢复机制、undo/redo 实现、"上一个正方形"的处理

---

## 一、关于 LangGraph 的 interrupt 和恢复机制

### 用户确认：
1. **使用 NodeInterrupt 来暂停执行** ✅
2. **checkpoint 自动保存** ✅（目前自动就足够）
3. **恢复机制**：
   - 不是 `resumeThread` API
   - 而是使用 `Command(resume=...)` 配合相同 `thread_id` 来恢复执行

### 从 LangGraph SDK 文档中的理解：

```typescript
// 1. 遇到 interrupt 时
const result = await client.runs.wait(threadId, "agent", {input: {...}});
if (result.__interrupt__) {
  console.log("Paused:", result.__interrupt__);

  // 2. 恢复执行
  await client.runs.wait(
    threadId,
    "agent",
    {command: {resume: "approve"}}  // 或 edit/reject
  );
}
```

### 从 demo/supervisor.ts 中的理解：

```typescript
// Supervisor Agent 使用 Command 进行路由
return new Command({
  goto: nextAgent,  // 跳转到下一个 Agent
  update: {         // 更新 State
    next_agent: nextAgent,
    current_task: nextAgent,
    messages: [...]
  }
});
```

**关键发现：**
- demo 中的 supervisor 使用的是 **goto 跳转**（不是 interrupt）
- supervisor 通过 `Command.goto` 来路由到子 Agent
- 子 Agent 也是 graph 中的 node

---

## 二、我们项目中如何使用 interrupt？

### 疑问：
在我们的项目中，后端需要前端提供数据时（如 `getNearbyObjects`），应该：

**方案 A：使用 NodeInterrupt（暂停图执行）**
```typescript
// 在子 Agent 中
async function deleteAgent(state: AgentState) {
  // 需要前端数据
  throw new NodeInterrupt({
    action: "getNearbyObjects",
    params: {x: 10, y: 0, z: 10}
  });

  // 执行被暂停，等待前端 continue 请求
}

// 前端调用 continue 后
{
  command: {
    resume: {
      toolResult: [{"id": "tri_789", ...}]
    }
  }
}
```

**方案 B：使用 Human-in-the-loop 节点**
```typescript
builder.addNode("waitForFrontend", async (state) => {
  // 返回需要前端执行的工具
  return {
    ...state,
    needsFrontendTool: {
      action: "getNearbyObjects",
      params: {...}
    }
  };
});

// 配置为 interrupt_before=["waitForFrontend"]
```

**方案 C：使用 Tool 的方式（结合 interrupt）**
```typescript
// 定义一个"虚拟 Tool"，实际由前端执行
const frontendTool = tool({
  name: "getNearbyObjects",
  schema: z.object({...}),
  func: async () => {
    throw new NodeInterrupt("waiting_for_frontend_data");
  }
});

// LLM 调用这个 tool 时会触发 interrupt
// 前端提供数据后，用 Command(resume=data) 恢复
```

### 需要明确：
- [ ] 我们应该用哪种方案？
- [ ] demo 中没有体现 interrupt，只是简单的 goto 路由
- [ ] 如果用 interrupt，前端的 continue 请求如何传递 toolResult？

---

## 三、关于 Undo/Redo 的数据库设计

### 用户疑问：
> "before_state 和 after_state 的设计看上去只能维护一步回退状态？"

### 解答：
不是的！这个设计可以支持**多步 undo/redo**。

#### 数据库中的记录示例：
```sql
-- 用户创建了一个正方形
INSERT INTO shape_operations (session_id, shape_id, operation, before_state, after_state)
VALUES ('session_123', 'sq_001', 'create', NULL, '{"type":"square", "geometry":{...}}');

-- 用户修改了这个正方形的边长
INSERT INTO shape_operations (session_id, shape_id, operation, before_state, after_state)
VALUES ('session_123', 'sq_001', 'update',
  '{"type":"square", "geometry":{"sideLength": 5}}',  -- 修改前
  '{"type":"square", "geometry":{"sideLength": 10}}'  -- 修改后
);

-- 用户又创建了一个圆形
INSERT INTO shape_operations (session_id, shape_id, operation, before_state, after_state)
VALUES ('session_123', 'ci_002', 'create', NULL, '{"type":"circle", "radius": 3}');

-- 用户删除了正方形
INSERT INTO shape_operations (session_id, shape_id, operation, before_state, after_state)
VALUES ('session_123', 'sq_001', 'delete',
  '{"type":"square", "geometry":{"sideLength": 10}}',  -- 删除前的状态
  NULL  -- 删除后没有状态
);
```

#### Undo/Redo 的实现：
```typescript
// Undo（撤销最近一次操作）
async function undo(sessionId: string) {
  // 1. 找到最近一次操作（按时间倒序）
  const lastOp = await db.query(`
    SELECT * FROM shape_operations
    WHERE session_id = ?
    ORDER BY operated_at DESC
    LIMIT 1
  `, [sessionId]);

  if (!lastOp) return;

  // 2. 根据操作类型恢复
  if (lastOp.operation === 'create') {
    // 撤销创建 = 删除对象
    await db.query('DELETE FROM shapes WHERE id = ?', [lastOp.shape_id]);

  } else if (lastOp.operation === 'update') {
    // 撤销修改 = 恢复到 before_state
    await db.query('UPDATE shapes SET geometry = ? WHERE id = ?',
      [lastOp.before_state.geometry, lastOp.shape_id]);

  } else if (lastOp.operation === 'delete') {
    // 撤销删除 = 重新创建对象
    await db.query('INSERT INTO shapes (id, type, geometry, ...) VALUES (...)',
      [...lastOp.before_state]);
  }

  // 3. 标记这次操作为"已撤销"（可选，用于 redo）
  await db.query('UPDATE shape_operations SET is_undone = true WHERE id = ?',
    [lastOp.id]);
}

// Redo（重做上一次撤销的操作）
async function redo(sessionId: string) {
  // 找到最近一次被撤销的操作
  const lastUndoneOp = await db.query(`
    SELECT * FROM shape_operations
    WHERE session_id = ? AND is_undone = true
    ORDER BY operated_at DESC
    LIMIT 1
  `, [sessionId]);

  // 根据 after_state 恢复...
}
```

#### 完整的 undo 栈：
```
操作历史（从旧到新）：
[1] create square (sq_001)
[2] update square (sq_001, 边长 5→10)
[3] create circle (ci_002)
[4] delete square (sq_001)  ← 当前状态

用户点击 Undo：
- 查询最新的 operation [4]
- before_state = {"type":"square", ...}
- 执行：重新创建 sq_001
- 标记 [4] 为 is_undone = true

用户再次点击 Undo：
- 查询最新的未撤销 operation [3]
- 执行：删除 ci_002
- 标记 [3] 为 is_undone = true

用户点击 Redo：
- 查询最新的已撤销 operation [3]
- after_state = {"type":"circle", ...}
- 执行：重新创建 ci_002
- 标记 [3] 为 is_undone = false
```

**关键点：**
- **每次操作都插入一条新记录**（不是覆盖）
- **通过 `operated_at` 时间戳维护操作顺序**
- **通过 `is_undone` 标记区分当前状态和历史状态**
- 支持**无限次 undo/redo**（只要数据库中有记录）

### 用户确认：
- [x] JSON 存储坐标数据（一个字段存储所有顶点，而不是每个顶点一个字段）
- [x] 这个设计可以维护多步回退状态

---

## 四、关于"上一个正方形"的定义（补充说明）

### 用户反馈：
> "我没看懂，没有你第一次问这个问题的时候清晰"

### 更清晰的说明：

**场景：**
用户在对话中说："修改上一个正方形的边长"

**问题：**
"上一个正方形"指的是哪个？

#### 情况 1：如果只创建过一个正方形
```
对话历史：
- 用户："画一个正方形，边长5"
- 系统：创建了 square_001
- 用户："修改上一个正方形的边长为10"

结论：明确指向 square_001
```

#### 情况 2：如果创建过多个正方形
```
对话历史：
- 用户："画一个正方形，边长5"  → square_001 (10:00)
- 用户："画一个圆形"           → circle_001 (10:01)
- 用户："再画一个正方形，边长8" → square_002 (10:02)
- 用户："修改上一个正方形的边长"

问题："上一个正方形"是指：
  A) square_002（最近创建的正方形，10:02）✅ 推荐
  B) square_001（第一个正方形，10:00）
```

#### 情况 3：如果提到过但没创建
```
对话历史：
- 用户："画一个正方形"         → square_001 (10:00)
- 用户："画一个圆形"           → circle_001 (10:01)
- 用户："把那个正方形移动到..."
  （LLM 识别到用户提到了 square_001）
- 用户："画一个新正方形"       → square_002 (10:02)
- 用户："修改上一个正方形"

问题："上一个正方形"是指：
  A) square_002（最近创建的，10:02）
  B) square_001（最近提到的，10:01 对话中）
```

### 三个方案对比：

| 方案 | 定义 | 优点 | 缺点 | 实现复杂度 |
|------|------|------|------|------------|
| A | 最近创建的正方形 | 简单，数据库查询即可 | 不符合自然对话语境 | 低 |
| B | 最近提到的正方形 | 更符合对话语境 | 需要维护引用栈 | 中 |
| C | 让 LLM 自己判断 | 最智能 | 不稳定，可能判断错 | 低（但不可控） |

### 建议的实施路径：
1. **MVP 阶段**：用方案 A（查询数据库 `SELECT * FROM shapes WHERE type='square' ORDER BY created_at DESC LIMIT 1`）
2. **优化阶段**：升级到方案 B（在 LangGraph State 中维护引用栈）

### 方案 B 的引用栈设计：
```typescript
// 在 AgentState 中
interface AgentState {
  messages: Message[];

  // 引用栈：记录对话中提到的对象
  referencedObjects: Array<{
    type: 'square' | 'circle' | 'triangle';
    id: string;
    mentionedAt: number;  // 第几轮对话
  }>;
}

// 当创建对象时
state.referencedObjects.push({
  type: 'square',
  id: 'square_001',
  mentionedAt: 1
});

// 当用户说"那个正方形"时，LLM 识别后
state.referencedObjects.push({
  type: 'square',
  id: 'square_001',
  mentionedAt: 3  // 更新为最新提到的轮次
});

// 当用户说"上一个正方形"时
const lastSquare = state.referencedObjects
  .filter(obj => obj.type === 'square')
  .sort((a, b) => b.mentionedAt - a.mentionedAt)[0];
```

**需要明确：**
- [ ] MVP 阶段用方案 A 是否可以接受？
- [ ] 引用栈应该存在 LangGraph State 中，还是数据库中？

---

## 五、沟通方式的约定

### 用户建议：
> "每次沟通都需要独立的一份文件，而不是对原有记录做修改。没必要'纠正'以往的错误或歧义，做单纯的记录就好。"

### 新的沟通约定：
1. **每次讨论创建新文件**（如本文件）
2. **不修改历史讨论文件**（保留原始思考过程）
3. **在主设计文档中只记录最终结论**

### 文件命名规范：
```
doc/
  ├── 设计讨论记录.md          # 主文档，记录最终结论
  ├── 讨论记录-1-xxx.md         # 第一次讨论的详细内容
  ├── 讨论记录-2-xxx.md         # 本次讨论（interrupt 和 undo）
  └── 讨论记录-3-xxx.md         # 未来的讨论...
```

---

## 六、当前阶段的约定

### 用户明确：
1. **错误处理先不考虑**（假设所有流程都正常）
2. **先不写代码**（继续交流设计）
3. **每次讨论独立记录**

---

## 七、待明确的问题（本次讨论遗留）

### 1. 关于 interrupt 的实现方式
- [ ] 我们应该用 NodeInterrupt、Human-in-the-loop 还是虚拟 Tool？
- [ ] demo 中的 goto 路由方式和我们的需求（等待前端数据）有什么区别？
- [ ] 前端的 continue 请求应该如何传递 toolResult？

**建议：**
可以找一个 LangGraph interrupt 的官方示例，看看如何处理"需要外部数据输入"的场景。

### 2. 关于"上一个正方形"
- [ ] MVP 阶段用"最近创建的"（数据库查询）可以吗？
- [ ] 引用栈存在哪里？State 还是数据库？

### 3. 关于 demo 代码
- [ ] demo 中的 supervisor 只做了简单的路由（goto），没有体现 interrupt
- [ ] 我们的项目需要在子 Agent 中"暂停等待前端数据"，这个机制需要进一步明确

---

## 八、下一步讨论方向

建议下一次讨论集中在：
1. **LangGraph interrupt 的具体实现**（找到官方示例或文档）
2. **前端工具调用的完整协议**（从后端 interrupt → 前端执行 → continue 请求 → 恢复执行）
3. **MVP 的最小功能集**（先跑通一个最简单的流程：创建正方形）
