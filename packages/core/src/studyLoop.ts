/**
 * 学习回路：练习 → 评分 → FSRS 排期 → 事件落库（端到端）。
 *
 * 对应 docs/domain-model.md §5、§6、§7：
 * - 评分从四档自我评分直映射到 FSRS 评分（v0 按键直映射，评测在 @lexilexi/eval）；
 * - 排期输出写回 Memory State，复习记录写为 review 事件——
 *   同一次 Dexie 事务原子落库（与 recordReview 的原子性契约一致，任一环节失败整体回滚）。
 * - MemoryStateFields 与 ts-fsrs Card 的字段换算见 domain-model.md §6。
 */
import { Scheduler, dateDiffInDays } from "@lexilexi/fsrs";
import type { CardInput, RecordLogItem } from "@lexilexi/fsrs";
import type { IsoDate } from "./domain";
import type { ExerciseType, ReviewEvent, ReviewRating } from "./events";
import { createId, toEventId } from "./id";
import type { ItemId, SenseId } from "./id";
import type { MemoryState, MemoryStateFields } from "./memory";
import type { LexilexiDatabase } from "./persistence";

/** 一次复习的输入（练习会话提供） */
export interface GradeReviewInput {
  /** 学习条目 */
  itemId: ItemId;
  /** 义项（事件的 senseId 定位用） */
  senseId: SenseId;
  /** 练习形式（MVP：recall） */
  exerciseType: ExerciseType;
  /** 自我评分四档（MVP 由按键直接映射，不经过评测） */
  rating: ReviewRating;
  /** 卡片出现到评分（毫秒；非负有限值，运行时校验） */
  reviewDurationMs: number;
  /** 是否先翻面看了答案 */
  revealed: boolean;
  /** 本次作答是否正确（练习界面给出的判定） */
  answerWasCorrect: boolean;
  /** 用户输入（可选；recall 形式下即输入的拼写，不含答案口令类内容；超长截断） */
  response?: string;
  /** 评分发生时刻（ISO；默认调用方当前时间） */
  time?: IsoDate;
}

/** 一次复习的落库结果 */
export interface GradeReviewResult {
  /** 落库的复习事件 */
  reviewEvent: ReviewEvent;
  /** 排期后的新记忆状态（已原子落库） */
  nextMemoryState: MemoryState;
}

/** response 字段长度上限（防御脏输入；recall 拼写输入远超此值无意义） */
const MAX_RESPONSE_LENGTH = 200;

/** 与 persistence.ts recordReview 的分工：
 *  recordReview 只做「事件 + 新状态」的原子写入（输入已算好，事务内校验存在性）；
 *  gradeReview 负责「事务内读旧状态 → FSRS 排期 → 调用同一原子写入契约」。
 *  改动任何一处落库路径时，必须同步检查另一处（见 persistence.ts 对应注释）。 */

/**
 * 字段换算：领域状态 → 调度器卡片输入（对应 domain-model.md §6）。
 *
 * 公开 API：apps/web 复习界面的评分预览（Scheduler.preview）复用同一换算，
 * 避免界面层再维护一份逐字段重复的实现（RAY-237 评审建议 C1）。
 *
 * `learningSteps ?? 0` 为防御性兜底：本字段引入（RAY-242）之前落库的
 * MemoryState（或旧版本导出回导）可能缺失该字段，直接传 undefined 会让
 * 调度器内部 Math.max(0, undefined) 得 NaN（评审建议 #2）。MemoryState
 * 是可重放的事件投影，任何前缀序列都必须能安全通过调度器。
 */
export function memoryFieldsToCardInput(fields: MemoryStateFields): CardInput {
  return {
    due: new Date(fields.due),
    stability: fields.stabilityDays,
    difficulty: fields.difficulty,
    scheduled_days: 0,
    learning_steps: fields.learningSteps ?? 0,
    reps: fields.reps,
    lapses: fields.lapses,
    state: fields.status,
    last_review: fields.lastReviewAt ? new Date(fields.lastReviewAt) : undefined,
  };
}

/** 字段换算：调度器输出 → 新记忆状态字段（due 存 ISO；elapsedDays 由上次复习时间推算） */
function fieldsFromScheduled(item: RecordLogItem, lastReviewAt: IsoDate | null): MemoryStateFields {
  const card = item.card;
  return {
    status: card.state,
    due: card.due.toISOString(),
    stabilityDays: card.stability,
    difficulty: card.difficulty,
    elapsedDays: elapsedDaysSince(lastReviewAt, item.log.review),
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewAt: item.log.review.toISOString(),
    lastRating: item.log.rating,
  };
}

/**
 * 距上次复习的天数（重放恢复用；首次复习为 0）。
 * 与调度器内部的 elapsed_days 口径一致：按 UTC 日历日向下取整
 * （dateDiffInDays），保证事件重放时排期结果可复现。
 */
function elapsedDaysSince(lastReviewAt: IsoDate | null, review: Date): number {
  if (!lastReviewAt) {
    return 0;
  }
  return dateDiffInDays(new Date(lastReviewAt), review);
}

/**
 * 对一次复习评分并落库：FSRS 排期 + review 事件 + 新记忆状态。
 *
 * 读旧记忆状态、排期、事件与状态写入在同一个 Dexie 事务内完成，
 * 任一环节失败整体回滚（不产生半次评分）。条目或记忆状态不存在、
 * 评分非法等错误由底层抛出，调用方直接透传。
 */
export async function gradeReview(
  db: LexilexiDatabase,
  input: GradeReviewInput,
): Promise<GradeReviewResult> {
  validateGradeReviewInput(input);
  const time = input.time ?? new Date().toISOString();
  return db.transaction("rw", db.memoryStates, db.events, async () => {
    const previous = await db.memoryStates.get(input.itemId);
    if (!previous) {
      throw new Error(`记忆状态不存在：${input.itemId}`);
    }
    const { card, log } = new Scheduler(
      memoryFieldsToCardInput(previous.fields),
      new Date(time),
    ).review(input.rating);
    const reviewEvent: ReviewEvent = {
      id: toEventId(createId("evt", 12)),
      type: "review",
      time,
      itemId: input.itemId,
      senseId: input.senseId,
      exerciseType: input.exerciseType,
      rating: input.rating,
      reviewDurationMs: input.reviewDurationMs,
      revealed: input.revealed,
      answerWasCorrect: input.answerWasCorrect,
      ...(input.response !== undefined
        ? { response: input.response.slice(0, MAX_RESPONSE_LENGTH) }
        : {}),
      elapsedDays: elapsedDaysSince(previous.fields.lastReviewAt, new Date(time)),
    };
    const nextMemoryState: MemoryState = {
      ...previous,
      fields: fieldsFromScheduled({ card, log }, previous.fields.lastReviewAt),
      updatedAt: time,
    };
    // 与 recordReview 相同的原子性契约：事件 + 状态同一事务写入，二者必同时生效
    await db.events.put(reviewEvent);
    await db.memoryStates.put(nextMemoryState);
    return { reviewEvent, nextMemoryState };
  });
}

/**
 * 输入校验（防御式，拒绝绕过类型检查的脏输入）：
 * - reviewDurationMs 必须为非负有限数（负数/NaN/Infinity 说明调用方有 bug）；
 * - time 若提供必须是合法时间（非法串会污染事件时间轴）。
 * 评分档位由调度器入口校验（RangeError）；response 超长截断不报错。
 */
function validateGradeReviewInput(input: GradeReviewInput): void {
  if (!Number.isFinite(input.reviewDurationMs) || input.reviewDurationMs < 0) {
    throw new RangeError(`Invalid reviewDurationMs: ${input.reviewDurationMs}`);
  }
  if (input.time !== undefined && Number.isNaN(Date.parse(input.time))) {
    throw new RangeError(`Invalid time: ${input.time}`);
  }
}

/**
 * 查询到期条目 id（due <= now 的全部记忆状态；MVP 新卡 due 为导入时刻，
 * 导入即到期。学习步骤中的卡片到期时间由 FSRS 排期决定）。
 *
 * 性能说明（评审建议 #4）：filter 是 Dexie 全表扫描，MVP 词库规模（数百条目）
 * 无碍；词库变大后应给 fields.due 建索引（需走 DB schema 版本迁移）或改
 * bounds 查询，届时本条注释随实现一起更新。
 */
export async function getDueItemIds(db: LexilexiDatabase, now: IsoDate): Promise<ItemId[]> {
  const due = await db.memoryStates.filter((state) => state.fields.due <= now).toArray();
  return due.map((state) => state.itemId);
}

/** 学习模式：决定首页三个入口（学习 / 复习 / 混合）各加载哪类队列 */
export type StudyMode = "learn" | "review" | "mixed";

/** 混合模式穿插节奏：每 2 张复习卡之后穿插 1 张新词卡 */
export const INTERLEAVE_REVIEW_STEP = 2;

/**
 * 查询学习队列条目 id（按模式筛选与排序，RAY-253 三模式首页）。
 *
 * 「新词」口径：从未评分的卡，即 `fields.reps === 0`——与 MemoryState
 * 不变量一致（首次评分前 reps 恒为 0，评分后恒 > 0；`lastReviewAt === null`
 * 是等价口径）。到期口径沿用 getDueItemIds：`due <= now`。
 *
 * - learn：仅新词，按 due 升序（新卡 due = 导入时刻，即导入顺序）；
 * - review：仅已评分且到期的卡，按 due 升序；
 * - mixed：复习卡为主干，每 INTERLEAVE_REVIEW_STEP 张复习卡穿插 1 张
 *   新词卡；任一侧耗尽后按序补齐另一侧（interleaveCards 纯函数）。
 *
 * 排序为（due, createdAt）双键——新卡 due 与 createdAt 同源（导入时刻），
 * 同一批导入的新词按导入顺序稳定；同 due 的复习卡按记忆状态创建时间决胜，
 * 与 UI 层旧排序口径保持一致。
 */
export async function getStudyQueueItemIds(
  db: LexilexiDatabase,
  now: IsoDate,
  mode: StudyMode,
): Promise<ItemId[]> {
  const dueStates = await db.memoryStates.filter((state) => state.fields.due <= now).toArray();
  const newStates: MemoryState[] = [];
  const reviewStates: MemoryState[] = [];
  for (const state of dueStates) {
    if (state.fields.reps === 0) {
      newStates.push(state);
    } else {
      reviewStates.push(state);
    }
  }
  newStates.sort(compareStatesByDue);
  reviewStates.sort(compareStatesByDue);
  const newIds = newStates.map((state) => state.itemId);
  const reviewIds = reviewStates.map((state) => state.itemId);
  switch (mode) {
    case "learn":
      return newIds;
    case "review":
      return reviewIds;
    case "mixed":
      return interleaveCards(reviewIds, newIds);
  }
}

/**
 * 混合队列组装（纯函数）：复习 id 为主干，每 INTERLEAVE_REVIEW_STEP 张
 * 复习卡后穿插一张新词卡；复习卡耗尽后按序补齐剩余新词（复习为空时即
 * 纯新词队列），新词耗尽则保持复习序。
 */
export function interleaveCards(reviewIds: readonly ItemId[], newIds: readonly ItemId[]): ItemId[] {
  const result: ItemId[] = [];
  let newIndex = 0;
  for (let i = 0; i < reviewIds.length; i++) {
    result.push(reviewIds[i]!);
    if ((i + 1) % INTERLEAVE_REVIEW_STEP === 0 && newIndex < newIds.length) {
      result.push(newIds[newIndex]!);
      newIndex += 1;
    }
  }
  while (newIndex < newIds.length) {
    result.push(newIds[newIndex]!);
    newIndex += 1;
  }
  return result;
}

/** due 升序，同 due 按记忆状态创建时间决胜（ISO-8601 同格式字符串可直接字典序比较） */
function compareStatesByDue(a: MemoryState, b: MemoryState): number {
  const byDue = a.fields.due.localeCompare(b.fields.due);
  if (byDue !== 0) {
    return byDue;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * 查询到期时间落在半开区间 [from, to) 内的条目 id（due >= from 且 due < to）。
 *
 * 与 getDueItemIds 同口径（不过滤条目 status，由调用方如复习队列自行过滤），
 * 供统计「明日到期」等按本地日历日区间查询到期数的场景使用——区间边界由
 * @lexilexi/stats 的 localDayBounds 换算（本地日 00:00 到次日 00:00），
 * 与夏令时无关。
 *
 * 性能说明同 getDueItemIds：filter 为 Dexie 全表扫描，MVP 词库规模无碍。
 */
export async function getDueItemIdsInRange(
  db: LexilexiDatabase,
  from: IsoDate,
  to: IsoDate,
): Promise<ItemId[]> {
  const due = await db.memoryStates
    .filter((state) => state.fields.due >= from && state.fields.due < to)
    .toArray();
  return due.map((state) => state.itemId);
}
