# 领域模型与数据层设计（v1）

> 状态：**已定稿**（对应 `packages/core` 的公开类型，任何接口变更需先更新本文档并通知 `@lexilexi/fsrs`）
> 关联 issue：RAY-244（领域模型与数据层）
> 数据设计原则来源：`INFO_260812.md` 第四、五节——「保存细粒度原始学习事件」「MVP 每个词义一个主 memory state」

## 1. 核心概念总览

| 概念              | 是什么                                                       | 生命周期                                               |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| **Learning Item** | 用户要掌握的最小学习对象：一个词条的**一个词义**             | 导入词库创建 → 用户删除                                |
| **Sense**         | 词义快照（词条、语言、释义），是 Learning Item 的内容部分    | 属于 Learning Item，随 item 删除                       |
| **Memory State**  | 该词义在 FSRS-7 下的记忆状态（稳定度、难度、下次复习时间等） | 每个 Learning Item 恰好一份，随复习更新                |
| **Event**         | 一次复习（或导入、删除等）产生的细粒度原始记录，append-only  | 永久保留（删除型事件除外），是统计与评分的唯一事实来源 |

关系：`Learning Item 1─1 Sense`，`Learning Item 1─1 Memory State`，`Learning Item 1─N Event`。

## 2. 设计取舍（与 FSRS-7 的对接契约）

- **FSRS 实现细节不进入领域模型。** 字段一律从用户/调度角度命名（`Due`、`StabilityDays`、`Difficulty`），内部再换算成 FSRS-7 的 `t`（天）与 `d ∈ [1,10]`（见 §6 换算约定）。`packages/fsrs` 的输入输出就是「旧 `MemoryStateFields` + 评分 → 新 `MemoryStateFields`」，不持有存储。
- **Memory State 字段与 ts-fsrs 官方 `Card` 的最小充分子集对应**：`due`、`stability`、`difficulty`、`elapsed_days`、`reps`、`lapses`。保留完整事件流，调度状态随时可从事件重放重建（`stats` 需要）。
- **同一词条多个词义 = 多个 Learning Item**，各自独立调度；多词义合并优化留给未来迭代（本决定与 RAY-236 的「先定接口再实现」一致）。

## 3. Learning Item

```ts
interface LearningItem {
  id: ItemId; // nanoid(10)，带类型前缀 "item"
  createdAt: IsoDate; // ISO-8601 毫秒时间戳（UTC）
  updatedAt: IsoDate;
  source: string; // 来源词库标识（如 "导入:四级词表.csv"），与词典来源/许可证溯源挂钩
  senseId: SenseId; // 1─1 指向 Sense
  kind: "word"; // MVP 仅词条；未来可扩展 "phrase" / "sentence"
  status: ItemStatus; // "active" | "suspended" | "deleted"
}
type ItemStatus = "active" | "suspended" | "deleted";
```

- 通过 `id` 寻址；`senseId` 不可变。
- `status` 流转：`active → suspended → active` 可逆；`→ deleted` 不可逆（软删除，历史事件永久保留，重复删除报错）。删除时仅更新 Memory State 的 `updatedAt`，不设删除标记字段——v0 靠 `item.status === "deleted"` 推导记忆状态已归档。

## 4. Sense

```ts
interface Sense {
  id: SenseId; // nanoid(10)，带类型前缀 "sense"
  lang: LanguageCode; // BCP 47（MVP 固定 "en"）
  term: string; // 词条原文
  definitions: string[]; // 中文释义，≥1 条（第一条为主释义）
  pos?: string; // 词性，如 "n." / "v."（导入词库通常有）
  ipa?: string; // 音标
  audioUrl?: string; // 发音文件（PWA 内本地 Blob URL）
  etymology?: string; // 词源（YAML 前端不导入则缺省）
  tags: string[]; // 如 ["四级", "高频"]
  examples: ExampleSentence[];
}
interface ExampleSentence {
  text: string; // 英文例句
  translation: string; // 中文翻译
}
```

- Sense 是**内容**，不含任何调度状态。内容修正（改释义、补例句）直接 `put`，不影响调度。
- `audioUrl` 不得指向外部服务（local-first 红线）。

## 5. Memory State

```ts
interface MemoryState {
  id: string; // 与 LearningItem.id 相同（1─1 锚定）
  itemId: ItemId;
  fields: MemoryStateFields;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}
interface MemoryStateFields {
  status: "new" | "learning" | "review" | "relearning";
  due: IsoDate; // 下次复习时间
  stabilityDays: number; // FSRS S（天），与 ts-fsrs Card.stability 同语义
  difficulty: number; // FSRS D ∈ [1,10]，与 ts-fsrs Card.difficulty 同语义
  elapsedDays: number; // FSRS elapsed_days
  reps: number; // 累计复习次数
  lapses: number; // 遗忘次数
  lastReviewAt: IsoDate | null; // 首次评分前为 null
  lastRating: ReviewRating | null;
  // 调度的不变量：reps = lapses + (state 内成功评分数)
}
```

- 每个 Learning Item 恰一份；由 `NewCardFields()`（`packages/fsrs` 公开 API）初始化。
- **恢复不变量（MemoryState 必须是事件的投影）**：在任一 `ReviewEvent` 序列前缀上重放调度，得到的状态必须与库中 MemoryState 一致。`delete-item` 事件后记录归档，重放跳过被删条目。
- 多词义合并（未来）若修改本结构，必须走 IndexedDB 版本迁移（红线）。

## 6. 与 FSRS-7 的换算约定

| MemoryStateFields           | ts-fsrs        | 换算                            |
| --------------------------- | -------------- | ------------------------------- |
| `stabilityDays`             | `S`（天）      | 直存                            |
| `difficulty`                | `D`            | 直存（FSRS 7 默认初值 `D₀(4)`） |
| `elapsedDays`               | `elapsed_days` | 直存                            |
| `due`                       | 下次复习日期   | 直存（ISO 字符串）              |
| 评分 `again/hard/good/easy` | `1/2/3/4`      | 直映射                          |

`packages/fsrs` 公开 API 即消费本类型：输入「旧 `MemoryStateFields` + 当前时间 + 评分」→ 输出新 `MemoryStateFields`。`ReviewRating = "again" | "hard" | "good" | "easy"`（数字映射 1–4 见 `ratingToNumber()` / `ratingFromNumber()`，在 `@lexilexi/fsrs` 实现）。

## 7. Event（schema v0，落库格式）

append-only、不可变（`deleted` 事件除外）。统一字段：

```ts
interface BaseEvent {
  id: EventId; // nanoid(12)，带类型前缀 "evt"
  type: string; // 即表名："import" | "review" | "edit-item" | "edit-sense" | "delete-item" | "suspend" | "unsuspend"
  time: IsoDate; // 发生时刻
}
```

| type                    | 额外字段（除标注可选外均必填，缺失即非法）                                                                                    | 与 Learning Item 关联 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `import`                | `itemId`、`term`、`lang`、`senseId`                                                                                           | 强（刚创建）          |
| `review`                | `itemId`、`senseId`、`exerciseType`、`rating`、`reviewDurationMs`、`revealed`、`answerWasCorrect`、`elapsedDays`，`response?` | 强                    |
| `edit-item`             | `itemId`、`diff`                                                                                                              | 强                    |
| `edit-sense`            | `senseId`、`diff`                                                                                                             | 经 senseId            |
| `delete-item`           | `itemId`                                                                                                                      | 强（事件保留）        |
| `suspend` / `unsuspend` | `itemId`、`reason`                                                                                                            | 强                    |

`review` 事件：

```ts
type ExerciseType =
  "recall" | "production" | "cloze" | "multiple-choice" | "confusion-discrimination";

interface ReviewEvent extends BaseEvent {
  type: "review";
  itemId: ItemId;
  senseId: SenseId;
  exerciseType: ExerciseType;
  rating: ReviewRating; // 由 eval 产出（MVP：按键直接映射）
  reviewDurationMs: number; // 卡片出现到评分
  revealed: boolean; // 是否先翻面看了答案
  answerWasCorrect: boolean;
  response?: string; // 用户输入（不含答案口令类内容）
  elapsedDays: number; // 距上次复习的天数（重放恢复用）
}
```

其他事件的 `diff` 为 JSON Patch 风格的最小变更描述，v0 仅要求**结构化可解析**（数组），不要求可自动重放。所有类型均提供判别函数（`isReviewEvent` 等），零 `any`。

## 8. 存储决策（每个实体为什么存、存在哪、留多久）

| 实体          | 为什么存       | 存在哪                   | 保留                             | 是否共享          |
| ------------- | -------------- | ------------------------ | -------------------------------- | ----------------- |
| Learning Item | 学习对象主记录 | IndexedDB `items`        | 直到用户删除                     | 否（local-first） |
| Sense         | 词义内容       | IndexedDB `senses`       | 同 Learning Item                 | 否                |
| Memory State  | 调度状态       | IndexedDB `memoryStates` | 同 Learning Item                 | 否                |
| Event         | 唯一事实来源   | IndexedDB `events`       | **永久**（删除型事件本身是记录） | 否                |

- 事件永不压缩（不聚合为汇总行）；未来容量压力通过「冻结期 + 导出归档」处理，仍禁止静默丢弃。
- 默认 local-first：词库、FSRS 状态、学习历史、事件日志一律不出本地；任何外部发送能力若未来加入，需用户显式同意（隐私红线）。

## 9. 数据层与版本迁移

- Dexie 数据库 **`lexilexi`**，`SCHEMA_VERSION = 1`，表：`items`(`id`)、`senses`(`id`)、`memoryStates`(`id`)、`events`(`id`, `time`, `type`)。
- **schema 升级必须走 `db.version(n).stores(...).upgrade(...)` 迁移**，严禁 `db.delete()` / `db.close()` 后重建（清库重来是红线）。每版迁移函数带独立单元测试。
- 数据库操作一律走 `db.transaction("rw", ...)`；同一「评分 → 写状态 + 写事件」必须单事务原子落库。

## 10. 持久化防线（storage.persist）

- 启动时检查 `navigator.storage.persisted()`；返回 `false` 则调用 `navigator.storage.persist()` 申请，并触发 `lexilexi:storage-permission` 事件（前端设置页据此提示「当前数据可能被清理，建议导出」）。
- 不可用环境（不支持 StorageManager 的浏览器）静默降级，绝不阻塞启动、绝不抛错。
- 不写 cookie、不写 localStorage 学习数据；`localStorage` 仅存主题等非学习偏好。

## 11. 导出/导入

- **导出必须完整可恢复**：`exportLexilexiData()` 产出单文件 JSON，含 `items`、`senses`、`memoryStates`、`events` 四张表 + schema 版本号；`importLexilexiData()` 能将其原样导回（JSON round-trip 测试保证）。
- 导入时同 `id` 冲突按「导入覆盖」处理，版本高于当前的不合法数据明确报错，绝不静默清库。
- **低版本导入策略（v1 定稿，v0 无此字段）**：`dbSchemaVersion === 当前版本` 直接导入；`dbSchemaVersion < 当前版本` 允许导入，**不隐式迁移**——记录数据为 `put` 覆盖，未来 schema 升级时由数据库自身的 `version(n).upgrade()` 迁移链在打开时补齐（导入路径本身不做表结构改写）。若未来引入破坏性 schema 变更导致旧版无法安全导入，须在 `importLexilexiData` 显式拒绝并给出升级指引，且必须随新版本更新本文档。
