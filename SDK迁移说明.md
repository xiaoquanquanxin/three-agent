# SDK 迁移说明

## 概述
项目已完全迁移到使用 LangGraph SDK 方式，旧版直接 invoke 的代码已被注释。

## 后端变更

### 1. `backend/src/api/handlers.ts`
- ✅ **已注释**：`handleChat()` 函数（旧版直接 invoke 方式）
- ✅ **已注释**：相关导入（HumanMessage, createWorkflow, AgentState, generateId）
- ✅ **已注释**：workflow 实例创建
- ✅ **保留**：`handleGetShapes()` 函数（用于获取形状列表，SDK 和非 SDK 都需要）

### 2. `backend/src/api/routes.ts`
- ✅ **已注释**：`POST /api/chat` 路由（旧版）
- ✅ **使用中**：`POST /api/chat-sdk` 路由（新版 SDK）
- ✅ **使用中**：`POST /api/chat-sdk/continue` 路由（SDK interrupt 后继续）
- ✅ **使用中**：`GET /api/shapes` 路由（获取形状列表）

### 3. `backend/src/agents/workflow.ts`
- ✅ **保留**：整个文件（被 langgraph.json 引用，供 SDK 服务器使用）
- ✅ **添加注释**：说明此文件用于 LangGraph SDK 服务器

### 4. `backend/src/api/handlers-sdk.ts`
- ✅ **使用中**：`handleChatSDK()` - 处理新消息
- ✅ **使用中**：`handleChatSDKContinue()` - 处理 interrupt 后的继续请求

## 前端变更

### `frontend/src/components/ChatPanel.tsx`
- ✅ **使用中**：调用 `/api/chat-sdk` 接口
- ✅ **使用中**：调用 `/api/chat-sdk/continue` 接口
- ✅ **使用中**：处理 interrupt 响应和前端工具调用

## 启动方式

### 后端（LangGraph SDK 服务器）
```bash
cd backend
npx @langchain/langgraph-cli dev
```

### 前端
```bash
cd frontend
npm run dev
```

## 架构说明

### SDK 方式的优势
1. **标准化**：使用 LangGraph 官方 SDK，符合最佳实践
2. **Interrupt 支持**：原生支持 interrupt 机制，无需手动实现
3. **状态管理**：自动处理 checkpoint 和状态恢复
4. **可扩展性**：便于后期集成 MCP 等功能

### 数据流
```
用户输入 → 前端 ChatPanel
         ↓
    POST /api/chat-sdk (handlers-sdk.ts)
         ↓
    LangGraph SDK Client
         ↓
    LangGraph Server (npx @langchain/langgraph-cli dev)
         ↓
    workflow.ts → supervisor → 各个 agent
         ↓
    返回响应（可能是 interrupted 或 completed）
         ↓
    前端处理响应（执行前端工具或更新场景）
```

## 已删除/注释的代码

### 不再使用的代码
- ❌ `handleChat()` - 旧版直接 invoke 方式
- ❌ `POST /api/chat` - 旧版路由
- ❌ 旧版的 workflow 直接调用逻辑

### 保留但不直接使用的代码
- ⚠️ `createWorkflow()` - 仅供 SDK 服务器使用，不在应用代码中直接调用

## 注意事项

1. **不要删除 workflow.ts**：虽然应用代码不直接调用，但 LangGraph SDK 服务器需要它
2. **环境变量**：确保 `.env` 文件配置正确（OPENAI_API_KEY 等）
3. **端口配置**：
   - LangGraph Server: 默认 2024
   - Express Server: 3001
   - Frontend: 5173

## 后续计划

- [ ] 集成 MCP (Model Context Protocol)
- [ ] 优化 interrupt 机制
- [ ] 添加更多前端工具
- [ ] 完善错误处理
