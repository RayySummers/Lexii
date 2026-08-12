# @lexilexi/core

Lexilexi 核心领域模型与共享类型包。

## 职责

- 承载与 UI 无关的领域概念：学习条目（item）、义项（sense）、记忆状态（memory state）等
- 全仓库唯一的基础层，被 `apps/web` 及其余 `packages/*` 依赖
- **不包含**任何算法实现（FSRS 在 `@lexilexi/fsrs`，评测在 `@lexilexi/eval`，统计在 `@lexilexi/stats`）

## 当前状态（骨架）

仅导出最稳定的常量与基础类型：

- `APP_NAME` / `APP_NAME_ZH` — 应用名
- `ItemId` / `SenseId` — 基础 id 类型

领域模型将在 MVP 迭代中逐步补充，并保持 strict TypeScript 约束。
