/**
 * fsrs-verify 差分验证桥接层（仅测试代码，不进公开 API）。
 *
 * 将我们的公开类型/输出映射到官方 ts-fsrs v5.4.1 的枚举形态，
 * 使两个实现能在同一输入上逐字段比对。
 */

import {
  Rating,
  State,
  type FSRSParameters as RefFSRSParameters,
  type Grade as RefGrade,
  type StepUnit,
} from "ts-fsrs";
import type {
  Card as OursCard,
  CardInput as OursCardInput,
  FSRSParameters as OursParams,
  Grade as OursGrade,
} from "../models";

/** 我们的评分档位 → 官方枚举（Grade 不含 Manual，映射永远成功） */
export const GRADE_TO_REF: Record<OursGrade, RefGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** 官方评分枚举 → 我们的档位（Manual 不会出现在复习日志中，用 undefined 表示） */
export const GRADE_FROM_REF = {
  [Rating.Again]: "again",
  [Rating.Hard]: "hard",
  [Rating.Good]: "good",
  [Rating.Easy]: "easy",
  [Rating.Manual]: undefined,
} as Record<Rating, OursGrade | undefined>;

/** 我们的状态 → 官方枚举 */
export const STATE_TO_REF: Record<OursCard["state"], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

/** 官方枚举 → 我们的状态 */
export const STATE_FROM_REF: Record<State, OursCard["state"]> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

/** 新卡默认字段（对齐官方 createEmptyCard） */
export function emptyCard(now: Date): OursCardInput {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: "new",
    last_review: undefined,
  };
}

/** 我们的参数 → 官方参数（undefined 表示「用官方默认」，交给官方归一化） */
export function paramsToRef(params?: Partial<OursParams>): Partial<RefFSRSParameters> {
  if (params === undefined) {
    return {};
  }
  return {
    request_retention: params.request_retention,
    maximum_interval: params.maximum_interval,
    w: params.w ? [...params.w] : undefined,
    enable_fuzz: params.enable_fuzz,
    enable_short_term: params.enable_short_term,
    learning_steps: params.learning_steps ? ([...params.learning_steps] as StepUnit[]) : undefined,
    relearning_steps: params.relearning_steps
      ? ([...params.relearning_steps] as StepUnit[])
      : undefined,
  };
}
