# Frontend - Three-Agent

## 目录结构

```
frontend/
├── src/
│   ├── components/     # React 组件
│   │   ├── ThreeScene.tsx     # Three.js 3D 场景组件
│   │   ├── ChatPanel.tsx      # 对话框组件
│   │   └── App.tsx            # 主应用组件
│   │
│   ├── utils/          # 工具函数
│   │   ├── sceneTools.ts      # 前端工具（getNearbyObjects 等）
│   │   └── renderer.ts        # 渲染函数（renderShape）
│   │
│   ├── types/          # TypeScript 类型定义
│   │   └── index.ts           # 类型定义
│   │
│   ├── main.tsx        # 主入口文件
│   └── App.tsx         # 根组件
│
├── public/             # 静态资源
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 技术栈

- React + TypeScript
- Three.js（3D 渲染）
- Vite（构建工具）
- LangGraph SDK Client（与后端通信）

## 功能

### 左侧：Three.js 3D 场景
- 3D 相机（可旋转、缩放视角）
- 2D 平面图形（正方形、圆形、三角形）
- 对象高亮和选中

### 右侧：对话框
- 用户输入
- Agent 回复
- 对话历史

## 启动命令

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview
```
