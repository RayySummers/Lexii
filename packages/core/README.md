# @lexilexi/core

Lexilexi 核心领域模型与本地数据层包。

## 职责

- 承载与 UI 无关的领域概念：Learning Item（学习条目）、Sense（义项）、Memory State（记忆状态）、Event（学习事件，event schema v0）。设计文档见 `docs/domain-model.md`。
- IndexedDB/Dexie 持久化层：数据库 `lexilexi`（表 `items` / `senses` / `memoryStates` / `events`），**schema 升级必须走版本迁移，禁止清库重来**。
- 持久化防线：`navigator.storage.persist()` / `persisted()` 申请与状态上报（`requestPersistence`，事件 `lexilexi:storage-permission`）。
- 导出/导入：完整可恢复 JSON（`exportLexilexiData` / `importLexilexiData` / `parseLexilexiExport`）。
- 词表导入/导出：CSV 解析与格式校验（`parseCsvWordlist`）、批量导入（`importCsvWordlist`）、CSV 导出（`serializeWordlistCsv` / `exportCsvWordlist`）、内置示例词表（`SAMPLE_WORDLIST_CSV`，许可干净）。
- 学习回路：评分 → FSRS 排期 → 事件落库（`gradeReview`）、到期队列（`getDueItemIds`）。
- **不包含**任何算法实现（FSRS 在 `@lexilexi/fsrs`，评测在 `@lexilexi/eval`，统计在 `@lexilexi/stats`）。

## 数据库 schema 版本链（升级必须走版本迁移，禁止清库重来）

| 版本 | 变更                                                                              | 来源    |
| ---- | --------------------------------------------------------------------------------- | ------- |
| v1   | 初始 schema：items / senses / memoryStates / events                               | RAY-242 |
| v2   | 新增 meta 表（预设词表安装进度/完成标记）                                         | RAY-258 |
| v3   | memoryStates 新增 `fields.due` 索引（到期查询由 filter 全表扫描改为索引区间查询） | RAY-260 |

到期查询（`getDueItemIds` / `getDueItemIdsInRange` / `getStudyQueueItemIds`）走
`where("fields.due")` 索引区间（`belowOrEqual` / `between`），与旧 filter 口径一致。
`getStudyQueueItemIds(db, now, mode, { newCardLimit })` 的 `newCardLimit` 为每日新卡
上限（按 due 升序截取前 N 条新词；产品默认值 20/日 与设置存储在 apps/web）。

## 领域模型（四个核心概念）

| 概念          | 类型           | 说明                                                                                                                                         |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Learning Item | `LearningItem` | 最小学习对象：一个词条的**一个词义**；`status` 流转 `active ⇄ suspended → deleted`（软删除，历史事件保留）                                   |
| Sense         | `Sense`        | 词义内容快照（词条、释义、例句），不含调度状态                                                                                               |
| Memory State  | `MemoryState`  | 1─1 锚定条目的 FSRS-7 调度状态（`MemoryStateFields` 与 ts-fsrs `Card` 字段同语义）                                                           |
| Event         | `Event`        | append-only 原始事件（`import` / `review` / `edit-item` / `edit-sense` / `delete-item` / `suspend` / `unsuspend`），统计与评分的唯一事实来源 |

### 与 @lexilexi/fsrs 的接口契约

- `MemoryStateFields` 是调度算法的输入/输出：`旧 fields + 评分 → 新 fields`（换算约定见设计文档 §6）。
- `ReviewRating = "again" | "hard" | "good" | "easy"`，与 FSRS 的 1/2/3/4 直映射。
- 恢复不变量：Memory State 必须是事件流的投影——在任意 ReviewEvent 序列前缀上重放调度，结果与库中一致。

## 数据层使用

```ts
import { openDatabase, recordReview } from "@lexilexi/core";

// 浏览器：直接用原生 IndexedDB
const db = openDatabase();

// 评分落库（原子：事件 + 新记忆状态同事务写入，失败整体回滚）
await recordReview(db, reviewEvent, nextMemoryState);
```

## 词表导入与学习回路（RAY-242）

```ts
import { importCsvWordlist, gradeReview, getDueItemIds } from "@lexilexi/core";

// 1. 导入 CSV 词表（格式错误抛 CsvFormatError，带行号与原因；失败整体回滚）
const { itemIds } = await importCsvWordlist(db, csvText, { source: "导入:四级词表.csv" });

// 2. 到期队列（新卡 due = 导入时刻，导入即到期）
const dueIds = await getDueItemIds(db, new Date().toISOString());

// 3. 一次练习：评分 → FSRS 排期 → 事件落库（同事务原子）
const { reviewEvent, nextMemoryState } = await gradeReview(db, {
  itemId: dueIds[0],
  senseId: sense.id,
  exerciseType: "recall",
  rating: "good", // again / hard / good / easy
  reviewDurationMs: 3000,
  revealed: false,
  answerWasCorrect: true,
});
```

CSV 格式：`term,definition[,pos]`（两列/三列），或带表头（`term`/`definition`/`pos`
大小写不敏感、顺序任意）。详见 `docs/domain-model.md` §7。

词表导出（CSV 只承载词条三列，**常规词条**可经 `importCsvWordlist` 导回，
不含学习进度；完整备份请用上面的 `exportLexilexiData`）：

```ts
import { exportCsvWordlist, serializeWordlistCsv } from "@lexilexi/core";

// 从数据库导出未删除条目为 CSV 文本（按 createdAt 升序，RFC 4180 转义，
// 前置 UTF-8 BOM 供 Windows 中文版 Excel 识别编码）
const csv = await exportCsvWordlist(db);

// 或直接序列化词条列表（纯函数，无 BOM）
const csv2 = serializeWordlistCsv([{ term: "apple", definitions: ["苹果"], pos: "n." }]);
```

CSV 导回边界（详见 `docs/domain-model.md` §7）：释义含全角分号「；」的词条导回后
会被拆成多条、含换行的释义无法原样导回、词条须匹配英文字母/撇号/连字符/点模式；
特殊内容以 JSON 备份为准。

## 持久化防线（apps/web 消费）

```ts
import { requestPersistence, STORAGE_PERMISSION_EVENT } from "@lexilexi/core";

// 应用启动时调用一次；返回 persisted / granted / denied / unsupported
const status = await requestPersistence(navigator);

// 或监听事件（requestPersistence 内部会派发）：
window.addEventListener(STORAGE_PERMISSION_EVENT, (e) => {
  // e.detail.status === "denied" 时提示「当前数据可能被清理，建议导出」
});
```

不支持 StorageManager 的环境静默降级（返回 `"unsupported"`），绝不阻塞启动。

## 测试

数据层关键路径测试位于 `src/*.test.ts`，使用 fake-indexeddb 在 Node 环境运行：

- 迁移红线用例：v1 → v2 → v3 升级走 `version/upgrade`，旧数据原样保留、索引自动建立（`persistence.test.ts`）
- 原子事务、非法流转、导出 round-trip、结构校验
- 预设词表安装并发安全：progress=0 占位 + 块事务 check-and-set，双标签页同时首启不重复导入（`presets/install.test.ts`）
- Tier 0 数据形状锁定：词条数、排序、标签、词性/领域标记剥离、义项切分无损（`presets/tier0.test.ts`）

覆盖率报告（运行 `npx vitest run --coverage --coverage.include="src/**/*.ts" --coverage.exclude="src/**/*.test.ts" --coverage.exclude="src/index.ts" --coverage.exclude="src/helpers.ts"`）要求关键路径 100%。

## 开发约束

- strict TypeScript，零 `any`；`ItemId` / `SenseId` / `EventId` 为带前缀的 branded string。
- local-first：学习数据一律在 IndexedDB；不发送到任何外部服务（隐私红线）。
- 新事件类型或 schema 变更必须同步更新 `docs/domain-model.md` 并走版本迁移。
