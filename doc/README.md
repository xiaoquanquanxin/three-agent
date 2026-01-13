# Three-Agent 项目文档索引

> 本文档为 AI 开发助手提供快速导航，按优先级和主题分类

---

## 🚀 快速开始（必读）

**新 AI 助手请先阅读这些文件：**

1. **项目需求** - `../README.md`
   - 核心业务需求和技术栈
   - 用户交互流程说明

2. **当前进度** - `开发日志/2026-01-13-Interrupt机制实现与DeleteAgent完成.md`
   - 最新开发状态
   - 已完成功能清单
   - 待完成任务

3. **技术决策** - `待确认问题清单.md`
   - 所有核心技术决策
   - 架构设计确认
   - 数据格式定义

---

## 📚 文档分类

### 1. 核心设计文档

**必读优先级：⭐⭐⭐**

- `待确认问题清单.md` - 所有技术决策汇总
- `讨论记录-7-最终架构确认和开发启动.md` - 最终架构设计
- `讨论记录-6-Three.js渲染和数据格式最终确认.md` - 渲染方案
- `讨论记录-4-技术方案最终确认.md` - 技术栈确认

### 2. 开发日志（按时间倒序）

**必读优先级：⭐⭐**

- `开发日志/2026-01-13-Interrupt机制实现与DeleteAgent完成.md` ⭐ **最新**
  - Interrupt 机制实现
  - DeleteAgent 完成
  - tempData 管理问题解决
  - 循环问题修复

- `开发日志/2026-01-13-SDK测试成功.md`
  - SDK 接入测试
  - 问题修复记录
  - 服务架构说明

- `开发日志/2026-01-13-代码调整记录.md`
  - 代码优化记录

- `开发日志/2026-01-12-SDK接入状态分析.md`
  - SDK 接入分析

- `开发日志/2026-01-12-MVP测试与问题修复.md`
  - MVP 测试记录

### 3. 技术讨论记录

**按需阅读优先级：⭐**

- `讨论记录-2-关于interrupt和undo机制.md` - Interrupt 机制讨论
- `讨论记录-3-interrupt示例分析和方案详解.md` - Interrupt 示例
- `讨论记录-5-Three.js实现和State设计.md` - State 设计

### 4. 参考资料

**按需查阅**

- `LanggraphSDK.md` - SDK 使用说明
- `interrupt/backend.ts` - Interrupt 后端示例
- `interrupt/frontend.tsx` - Interrupt 前端示例
- `sdk/问题.md` - SDK 常见问题

### 5. 历史记录（归档）

**不建议阅读，仅供参考**

- `讨论记录-1.md` - 早期讨论
- `我的回答.1-7.md` - 用户回答记录

---

## 🎯 按场景查找文档

### 场景 1：了解项目整体架构
1. `../README.md` - 需求说明
2. `待确认问题清单.md` - 技术决策
3. `讨论记录-7-最终架构确认和开发启动.md` - 架构设计

### 场景 2：实现新功能
1. `开发日志/2026-01-13-Interrupt机制实现与DeleteAgent完成.md` - 当前进度
2. `待确认问题清单.md` - 技术约束
3. 参考已实现的 Agent 代码

### 场景 3：修复 Bug
1. `开发日志/` - 查看最新日志中的已知问题
2. `讨论记录-3-interrupt示例分析和方案详解.md` - Interrupt 机制
3. 相关代码文件

### 场景 4：理解 Interrupt 机制
1. `开发日志/2026-01-13-Interrupt机制实现与DeleteAgent完成.md` - 实现细节
2. `讨论记录-3-interrupt示例分析和方案详解.md` - 原理说明
3. `interrupt/` - 示例代码

---

## 📊 当前项目状态

### ✅ 已完成
- CreateAgent（创建正方形、圆形、三角形）
- DeleteAgent（按类型删除、按位置删除）
- Interrupt 机制（前端工具调用）
- Continue 机制（恢复执行）
- State 管理（tempData 清理）
- 前端基础渲染

### 🚧 进行中
- 无

### 📋 待完成
- ModifyAgent（修改边长、半径、位置）
- QueryAgent（列举对象、统计数量）
- 前端 interrupt UI 优化
- 完整的端到端测试

---

## 🔑 关键概念速查

### Command 对象
- 用于控制 LangGraph 工作流路由
- `goto`: 下一个节点（'supervisor', 'create_agent', '__end__'）
- `update`: 更新 state 字段

### tempData 生命周期
- 用于 interrupt 暂停/恢复时传递数据
- 使用浅合并 reducer：`{ ...left, ...right }`
- 任务完成后需清空，避免污染下一个请求

### Interrupt 机制
- 不使用 `interrupt()` 函数（会循环）
- 使用 `goto: '__end__'` + `needsFrontendTool` 标记
- Continue 时传递 `operationParams: { resumed: true }`

### 防循环规则
- 所有错误情况直接 `goto: '__end__'`
- 不要 `goto: 'supervisor'`（会重新分析意图）
- 每次新请求创建新 thread

---

## 📝 文档维护规则

1. **开发日志命名**：`YYYY-MM-DD-主题.md`
2. **重要更新**：更新本 README 的"当前项目状态"
3. **新增文档**：在对应分类中添加索引
4. **归档规则**：超过 7 天且不再相关的文档移至"历史记录"

---

**最后更新**：2026-01-13 16:00  
**维护者**：Claude Code  
**版本**：v1.0
