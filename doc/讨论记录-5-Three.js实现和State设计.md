# 讨论记录 #5 - Three.js 实现和 State 设计

> 时间：2026-01-09
> 主题：Three.js 具体实现理解、LangGraph 配置确认、State 设计

---

## 一、我对 Three.js 需求的理解

### 1. 整体架构理解

**界面布局：**
```
+----------------------------------+
|  左侧：Three.js 场景 (70%)       |  右侧：对话框 (30%)
|                                  |
|  [3D 场景渲染区域]               |  [对话历史]
|                                  |  - 用户消息
|  - 正方形、圆形、三角形          |  - Agent 回复
|  - 可旋转、缩放视角              |
|  - 对象可高亮选中                |  [输入框]
|                                  |  > 用户输入...
+----------------------------------+
```

### 2. 核心功能理解

#### 功能 1：创建几何对象
**用户输入：** "画一个正方形，边长5，位置在 (10, 0, 10)"

**我的理解：**

**后端处理：**
1. LLM 解析：边长=5，位置=(10,0,10)
2. 生成 UUID：`square_001`
3. 计算四个顶点坐标（基于边长和中心位置）
4. 插入数据库

**前端渲染：**
```typescript
// 收到后端响应
{
  "action": "create",
  "data": {
    "id": "square_001",
    "type": "square",
    "geometry": {
      "sideLength": 5,
      "vertices": [
        [7.5, 0, 7.5],   // 左下
        [12.5, 0, 7.5],  // 右下
        [12.5, 0, 12.5], // 右上
        [7.5, 0, 12.5]   // 左上
      ]
    },
    "position": [10, 0, 10]
  }
}

// Three.js 渲染
const shape = new THREE.Shape();
shape.moveTo(7.5, 7.5);
shape.lineTo(12.5, 7.5);
shape.lineTo(12.5, 12.5);
shape.lineTo(7.5, 12.5);
shape.lineTo(7.5, 7.5);

const geometry = new THREE.ShapeGeometry(shape);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material);
mesh.rotation.x = -Math.PI / 2; // 平放在地面
mesh.userData.id = "square_001";
mesh.userData.type = "square";

scene.add(mesh);
```

#### 功能 2：删除对象（需要 interrupt）
**用户输入：** "删除坐标 (10, 0, 10) 附近的正方形"

**我的理解：**

**第一阶段（感知）：**
1. 后端 LLM 解析：需要查找坐标 (10,0,10) 附近的对象
2. 后端触发 interrupt：`interrupt({action: "getNearbyObjects", params: {x:10, y:0, z:10}})`
3. 前端收到 interrupt，执行空间查询
4. 前端返回结果：`[{id: "square_001", distance: 0}]`

**第二阶段（决策）：**
5. 后端恢复执行，获取到 `square_001`
6. 删除数据库记录
7. 返回给前端：`{action: "delete", targetId: "square_001"}`
8. 前端从场景中移除对象

#### 功能 3：修改对象
**用户输入：** "修改上一个正方形的边长为10"

**我的理解：**

**MVP 阶段（简单实现）：**
1. 后端查询数据库：`SELECT * FROM shapes WHERE type='square' ORDER BY created_at DESC LIMIT 1`
2. 获取 `square_001`
3. 更新数据库：修改 geometry 中的 sideLength 和 vertices
4. 返回给前端：`{action: "modify", targetId: "square_001", data: {...}}`
5. 前端重新渲染该对象（删除旧的，创建新的）

### 3. 前端工具函数实现

#### getNearbyObjects（空间查询）
```typescript
function getNearbyObjects(
  x: number, 
  y: number, 
  z: number, 
  radius: number = 5
) {
  const targetPos = new THREE.Vector3(x, y, z);
  const results = [];

  scene.children.forEach(obj => {
    if (obj.userData.id) {
      const distance = obj.position.distanceTo(targetPos);
      if (distance <= radius) {
        results.push({
          id: obj.userData.id,
          type: obj.userData.type,
          position: obj.position.toArray(),
          distance
        });
      }
    }
  });

  return results.sort((a, b) => a.distance - b.distance);
}
```

---

## 二、LangGraph 本地开发配置确认

### 用户确认：
- ✅ 不需要额外的环境配置或硬件配置
- ✅ 只需要：Checkpointer、Thread ID、Command Resume

### 我的理解：

**最小配置：**
```typescript
import { StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";

// 1. Checkpointer（内存存储，用于保存 checkpoint）
const checkpointer = new MemorySaver();

// 2. 创建 Graph
const graph = new StateGraph(AgentState)
  .addNode("supervisor", supervisorAgent)
  .addNode("create", createAgent)
  .compile({ checkpointer });

// 3. 使用 Thread ID 执行
const threadId = "thread_123";
const result = await graph.invoke(
  { messages: [...] },
  { configurable: { thread_id: threadId } }
);
```

**就这么简单！** 不需要其他配置。

---

## 三、AgentState 设计

### 用户需求：
- 维护当前对话的状态
- 历史记录（保留有限数量）
- 临时记录关键节点的数据或过程数据

### State 设计方案：

```typescript
interface AgentState {
  // 1. 基础信息
  sessionId: string;
  threadId: string;
  
  // 2. 对话历史（保留最近 20 条）
  messages: BaseMessage[];
  
  // 3. 当前对话状态
  currentIntent?: 'create' | 'delete' | 'modify' | 'query';
  currentAgent?: string;
  
  // 4. 临时数据（关键节点数据）
  tempData?: {
    // 感知阶段的结果
    nearbyObjects?: Array<{id: string; type: string; distance: number}>;
    lastCreated?: {id: string; type: string};
    
    // 当前操作的目标
    targetObjectId?: string;
    operationParams?: Record<string, any>;
  };
  
  // 5. 引用栈（用于"上一个正方形"，优化阶段添加）
  referencedObjects?: Array<{
    type: string;
    id: string;
    mentionedAt: number;
  }>;
}
```

### State 字段说明：

**1. messages（对话历史）**
- 保留最近 20 条消息
- 超过 20 条时，删除最旧的
- 用于 LLM 理解上下文

**2. currentIntent 和 currentAgent**
- 记录当前正在处理的意图
- 记录当前正在执行的 Agent
- 用于调试和日志
