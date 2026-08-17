/**
 * 新卡初始状态工厂：把「无状态的条目」变成可调度的卡片状态。
 *
 * 对应 docs/domain-model.md §6 的接口契约（RAY-236）：
 * 「初始状态由 @lexii/fsrs 的 newCardFields() 创建」。
 * 纯函数，不持有存储；输入不携带调度状态，输出可直接作为
 * MemoryStateFields 持久化（due 为 ISO 字符串）。
 */
import { toDate } from "./utils";

/** 初始状态输入（不携带任何调度状态） */
export interface NewCardInput {
  now: Date | number | string;
}

/** 初始状态（可直接落库为 MemoryStateFields；due 为 ISO 字符串） */
export interface NewCardFields {
  status: "new";
  due: string;
  stabilityDays: number;
  difficulty: number;
  elapsedDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReviewAt: null;
  lastRating: null;
}

/**
 * 创建新卡片的初始状态。
 *
 * 新卡未评分：状态 new、难度与稳定度为 0（FSRS 首次评分时按档位初始化）、
 * 学习步骤游标为 0、未复习过（reps/lapses 为 0、lastReviewAt/lastRating 为 null），
 * due 为当前时刻（视为立即到期，进入学习队列）。
 */
export function newCardFields(input: NewCardInput): NewCardFields {
  const now = toDate(input.now);
  return {
    status: "new",
    due: now.toISOString(),
    stabilityDays: 0,
    difficulty: 0,
    elapsedDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReviewAt: null,
    lastRating: null,
  };
}
