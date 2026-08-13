/**
 * Event（学习事件，event schema v0）：细粒度原始记录，append-only。
 *
 * 对应 docs/domain-model.md §7：
 * - 统一字段：id / type / time；按 type 分派 payload（全部必填，否则非法）。
 * - 每个事件都必须能定位到一条 Learning Item（直接 itemId 或经 senseId），
 *   除非语义上无关联（未来新增时说明理由）。
 * - 不可变（deleted 事件除外），是统计、评测与调度重放的唯一事实来源。
 */
import type { EventId, ItemId, SenseId } from "./id";
import type { IsoDate, LanguageCode } from "./domain";

/** 事件类型即事件表名 */
export type EventType =
  "import" | "review" | "edit-item" | "edit-sense" | "delete-item" | "suspend" | "unsuspend";

/** 练习形式（MVP 已支持 recall；其余由后续迭代启用） */
export type ExerciseType =
  "recall" | "production" | "cloze" | "multiple-choice" | "confusion-discrimination";

/** 复习评分，与 FSRS 的 1/2/3/4 直映射（换算函数在 @lexilexi/fsrs） */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** JSON Patch 风格的最小变更描述（v0 仅要求结构化可解析，不要求自动重放） */
export type Diff = Record<string, unknown>;

/** 所有事件的公共字段 */
export interface BaseEvent {
  id: EventId;
  /** 事件类型（即事件表名） */
  type: EventType;
  /** 发生时刻 */
  time: IsoDate;
}

/** 导入事件：新条目首次进入词库（事件保留为永久导入记录） */
export interface ImportEvent extends BaseEvent {
  type: "import";
  itemId: ItemId;
  senseId: SenseId;
  term: string;
  lang: LanguageCode;
}

/** 复习事件：一次评分落库（评分 → 写状态 + 写事件必须单事务原子落库） */
export interface ReviewEvent extends BaseEvent {
  type: "review";
  itemId: ItemId;
  senseId: SenseId;
  exerciseType: ExerciseType;
  /** 由 eval 产出（MVP：按键直接映射） */
  rating: ReviewRating;
  /** 卡片出现到评分 */
  reviewDurationMs: number;
  /** 是否先翻面看了答案 */
  revealed: boolean;
  answerWasCorrect: boolean;
  /** 用户输入（可选；不含答案口令类内容） */
  response?: string;
  /** 距上次复习的天数（重放恢复用；首次复习为 0） */
  elapsedDays: number;
}

/** 编辑条目事件（diff 为最小变更描述） */
export interface EditItemEvent extends BaseEvent {
  type: "edit-item";
  itemId: ItemId;
  diff: Diff;
}

/** 编辑义项事件 */
export interface EditSenseEvent extends BaseEvent {
  type: "edit-sense";
  senseId: SenseId;
  diff: Diff;
}

/** 删除条目事件（删除型事件本身是记录，永久保留） */
export interface DeleteItemEvent extends BaseEvent {
  type: "delete-item";
  itemId: ItemId;
}

/** 暂停 / 恢复条目事件 */
export interface SuspendEvent extends BaseEvent {
  type: "suspend";
  itemId: ItemId;
  reason: string;
}

export interface UnsuspendEvent extends BaseEvent {
  type: "unsuspend";
  itemId: ItemId;
  reason: string;
}

/** 全部事件（判别联合） */
export type Event =
  | ImportEvent
  | ReviewEvent
  | EditItemEvent
  | EditSenseEvent
  | DeleteItemEvent
  | SuspendEvent
  | UnsuspendEvent;

export function isReviewEvent(event: Event): event is ReviewEvent {
  return event.type === "review";
}

export function isImportEvent(event: Event): event is ImportEvent {
  return event.type === "import";
}

export function isEditItemEvent(event: Event): event is EditItemEvent {
  return event.type === "edit-item";
}

export function isEditSenseEvent(event: Event): event is EditSenseEvent {
  return event.type === "edit-sense";
}

export function isDeleteItemEvent(event: Event): event is DeleteItemEvent {
  return event.type === "delete-item";
}

export function isSuspendEvent(event: Event): event is SuspendEvent {
  return event.type === "suspend";
}

export function isUnsuspendEvent(event: Event): event is UnsuspendEvent {
  return event.type === "unsuspend";
}
