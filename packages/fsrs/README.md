# @lexii/fsrs

Lexii 的 FSRS-7 调度算法包。

## 职责

- 实现 FSRS-7 调度算法（记忆状态更新、间隔计算、到期复习调度）
- 替换传统 SM-2 类算法，是学习体验的核心引擎
- 只负责「什么时候复习」；「这次表现意味着什么」由 `@lexii/eval` 负责

## FSRS-7 版本口径

> 重要：本包的目标算法是项目规划文档（INFO_260812.md）中选型的 **FSRS-7**。
> 截至 2026-08，FSRS 官方主分支（open-spaced-repetition/ts-fsrs v5.4.1）实现的是
> **FSRS-6.0** 算法（21 参数、可变遗忘曲线 decay），官方尚无 FSRS-7 发布。
>
> 因此本包采用以下口径，并在 `fsrs-verify` 中严格执行：
>
> - **实现目标**：FSRS 最新官方语义 = ts-fsrs v5.4.1（FSRS-6.0 主分支，21 参数）。
> - **对照验证**：同一卡片、同一时刻、同一评分序列，本包输出与官方 ts-fsrs v5.4.1
>   逐字段一致（含 17/19 参数自动迁移、fuzz、learning steps 全路径）。
> - **命名**：沿袭项目规划中的「FSRS-7」称呼，README 与 issue 均以此为准。
> - **升级路径**：官方发布 FSRS-7 后，升级 = 替换 `defaults.ts` 的默认权重 + 更新
>   本 README 的版本口径，调度器/公开 API 结构不变。届时对比基准切换到官方 FSRS-7
>   实现，差分验证用例自动续用。

## 与 #2 的接口约定（领域模型与数据层对接）

本包是纯算法包，**不持有任何数据**。上层（`packages/core` 数据层）负责持久化卡片
状态与复习日志，调用本包做排期。

### 输入输出契约

```ts
// 评分档位：复习界面的四个按钮
type Grade = "again" | "hard" | "good" | "easy";

// 卡片状态：core 数据层持久化的记忆状态
type State = "new" | "learning" | "review" | "relearning";

// 卡片（可持久化字段，全部是可序列化的 JSON 值）
interface Card {
  due: Date; // 到期时间
  stability: number; // 记忆稳定性（天），新卡为 0
  difficulty: number; // 难度 ∈ [1,10]，新卡为 0
  scheduled_days: number; // 本次排期天数
  learning_steps: number; // 学习步骤游标
  reps: number; // 复习次数
  lapses: number; // 遗忘次数
  state: State;
  last_review?: Date; // 上次复习时间，新卡为 undefined
}

// 复习日志（Event schema v0 的 learning 事件可直接落库的字段）
interface ReviewLog {
  rating: Grade;
  state: State; // 本次复习前的状态
  due: Date; // 上次排期的到期时间
  stability: number; // 本次复习前的稳定性
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  review: Date; // 复习发生时间
}
```

### 调用方式

```ts
import { Scheduler } from "@lexii/fsrs";

// 用户点「Good」：
const { card, log } = new Scheduler(persistedCard, new Date()).review("good");
// card → 写回 core 数据层；log → 追加 learning 事件
```

要点：

- `Scheduler` 是纯函数式排期：输入卡片不被修改，输出是新对象。
- 幂等：同一调度器上同一评分多次调用返回同一结果。
- 自定义参数（可选）：`new Scheduler(card, now, { request_retention: 0.9 })`，
  默认参数见 `defaults.ts`。
- 边界：评分非法（非四档）抛错；`t < 0`（复习时间早于上次复习）抛错。
- 本包不实现 rollback/forget/reschedule——core 数据层基于 Event 重放即可，需要时再谈。

### Date 字段的持久化形态（给 #2 的落库约束）

`Card` 的 `due` / `last_review` 与 `ReviewLog` 的 `due` / `review` 在内存中是 `Date`，
**持久化时必须显式转换**，二选一（推荐 ISO string）：

- **ISO string**：`JSON.stringify` 天然输出 ISO 8601 字符串；回读时用
  `new Date(value)` 或 JSON reviver 转换（本包的 `toDate` 接受这两种输入）。
- **epoch ms（number）**：`date.getTime()`；回读时 `new Date(ms)`。

无论哪种，**序列化后不得直接存 `Date` 对象**，且 round-trip 必须可逆
（导出 JSON 原样导回后 `new Scheduler(card, now)` 输出一致）。示例 reviver：

```ts
const revive = (key: string, value: unknown) =>
  key.endsWith("_at") || key === "due" || key === "review" || key === "last_review"
    ? new Date(value as string)
    : value;
```

### 对接状态

- #2（领域模型与数据层）进行中，Event schema v0 尚无落库格式。本契约的 `ReviewLog`
  即按 Event 可落库字段设计，若 #2 的 schema 定稿有变化，仅需改 `models.ts` 的字段映射。

## 公开 API

- `Scheduler` / `scheduler(card, now, params?)` — 单卡排期（`preview()` 四档预览 / `review(grade)`）
- `FSRSAlgorithm` — 算法原语（遗忘曲线、初始值、稳定性/难度更新、间隔与 fuzz）
- `forgettingCurve(params, elapsedDays, stability)` — 遗忘曲线 R(t,S)
- `normalizeParameters(props?)` — 参数归一化（对齐官方 generatorParameters）
- `defaults.ts` — 默认参数（21 权重、默认学习步骤、裁剪区间）

## 测试

- `pnpm test` — 单元测试（`src/unit`，快、不依赖 ts-fsrs）
- `pnpm test:verify` — **fsrs-verify** 差分验证（`src/verify`，对照官方 ts-fsrs v5.4.1）

### fsrs-verify 验证矩阵

差分验证在固定 seed 的随机复习轨迹（跨时区日期、跨月间隔）上逐字段比对：

- 默认参数全轨迹（含全 Good 长链、全 Again、随机 30 次）
- 自定义参数：enable_short_term=false（LongTermScheduler 路径）、空学习步骤、
  单步骤、多步重学（触发 w17/w18 收紧）
- 权重迁移：17（v4）/ 19（v5）/ 21（v6）参数自动补齐与裁剪
- enable_fuzz（确定性 seed，官方 Alea PRNG 逐位对齐；含 fuzz × 四档 preview 对照）
- 算法原语：遗忘曲线、间隔修正系数、参数归一化、非法输入报错行为
- 非法评分：new / learning / review / relearning × 默认步骤 / 空步骤下必须全部抛错

**验收红线：与官方参考实现输出一致才算通过。** CI 中作为独立 job 运行，结果单独可见。

## 参考

- 官方参考实现：[open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（MIT）
- 算法说明：[fsrs4anki wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- 本包为独立实现；内置 Alea PRNG 移植自 seedrandom（MIT，见 `alea.ts` 头注释）
