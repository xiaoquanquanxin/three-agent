# Backend - Three-Agent

## 目录结构

```
backend/
├── src/
│   ├── agents/         # LangGraph Agent 实现
│   │   ├── supervisor.ts      # Supervisor Agent（意图识别和路由）
│   │   ├── createAgent.ts     # CreateAgent（创建对象，支持 interrupt）
│   │   ├── deleteAgent.ts     # DeleteAgent（删除对象，支持 interrupt）
│   │   ├── modifyAgent.ts     # ModifyAgent（修改对象，支持 interrupt）
│   │   └── queryAgent.ts      # QueryAgent（查询对象）
│   │
│   ├── types/          # TypeScript 类型定义
│   │   ├── state.ts           # AgentState 定义
│   │   └── index.ts           # 导出所有类型
│   │
│   ├── database/       # 数据库相关
│   │   ├── init.ts            # 数据库初始化和表创建
│   │   └── operations.ts      # 数据库操作封装
│   │
│   ├── api/            # Express API
│   │   ├── routes.ts          # 路由定义
│   │   └── handlers.ts        # 请求处理函数
│   │
│   ├── config/         # 配置文件
│   │   └── settings.ts        # 环境变量和配置
│   │
│   ├── utils/          # 工具函数
│   │   └── uuid.ts            # UUID 生成等
│   │
│   └── index.ts        # 主入口文件
│
├── package.json
├── tsconfig.json
└── README.md
```

## 技术栈

- Node.js + TypeScript
- LangGraph（Agent 框架）
- Express（Web 框架）
- SQLite（数据库）
- 阿里云通义千问（LLM）

## 启动命令

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 生产模式
npm start
```
