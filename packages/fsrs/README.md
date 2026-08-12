# @lexilexi/fsrs

Lexilexi 的 FSRS-7 调度算法包。

## 职责

- 实现 FSRS-7 调度算法（记忆状态更新、间隔计算、到期复习调度）
- 替换传统 SM-2 类算法，是学习体验的核心引擎

## 当前状态（骨架）

仅声明与官方参考实现一致的领域常量与类型：

- `Rating` / `RATINGS` — again / hard / good / easy 四档评分
- `MemoryState` — new / learning / review / relearning

## 验证计划

- 算法实现后，对照 FSRS 官方参考实现（open-spaced-repetition/ts-fsrs）编写验证用例
- 验证用例以 **`fsrs-verify`** 标记，在 CI 中单独运行
- 验收红线：与官方参考实现输出一致才算通过
