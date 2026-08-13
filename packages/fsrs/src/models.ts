/**
 * @lexilexi/fsrs — FSRS-7 领域类型定义
 *
 * 命名与语义对齐官方参考实现 ts-fsrs v5.4.1（FSRS-6.0 主分支，FSRS-7 算法，
 * 见 README「FSRS-7 版本口径」），保证两个实现可以在同一输入上做差分验证。
 *
 * 与本包导出 API 的差异（面向 Lexilexi 的使用方式）：
 * - 通过包公开 API 使用时，`Card` 不携带 `elapsed_days` / `last_elapsed_days`
 *   （官方实现已标记 deprecated、将于 v6 移除；我们直接不引入）。
 * - 官方实现以枚举 `Rating`（Manual=0/Again=1/Hard=2/Good=3/Easy=4）做输入输出；
 *   本包公开 API 一律使用 `Grade`（"again" | "hard" | "good" | "easy"），
 *   枚举形态仅在 fsrs-verify 对照层内部使用。
 */

/** 评分档位（Again/Hard/Good/Easy 四档自我评分，不含 Manual） */
export type Grade = "again" | "hard" | "good" | "easy";

/** 卡片记忆状态 */
export type State = "new" | "learning" | "review" | "relearning";

/** 时间输入：Date、毫秒时间戳或可被 Date 解析的字符串 */
export type DateInput = Date | number | string;

/** 步骤时间单位：分钟 / 小时 / 天 */
export type TimeUnit = "m" | "h" | "d";

/** (re)learning 步骤，如 "1m"、"10m"、"1d" */
export type StepUnit = `${number}${TimeUnit}`;

/** (re)learning 步骤序列；空数组表示该阶段完全交给 FSRS 调度 */
export type Steps = StepUnit[] | readonly StepUnit[];

/** FSRS 参数集（字段名对齐官方参考实现 FSRSParameters） */
export interface FSRSParameters {
  /** 期望保持率，0 < request_retention <= 1 */
  request_retention: number;
  /** 最大间隔（天），默认 36500 */
  maximum_interval: number;
  /** FSRS 权重向量：17（v4）/ 19（v5）/ 21（v6，默认）个元素 */
  w: number[] | readonly number[];
  /** 是否对 >= 2.5 天的间隔做模糊化（默认 false） */
  enable_fuzz: boolean;
  /** 是否启用短期记忆调度（learning/relearning steps；默认 true） */
  enable_short_term: boolean;
  /** 新卡学习步骤（默认 ["1m", "10m"]） */
  learning_steps: Steps;
  /** 重学步骤（默认 ["10m"]） */
  relearning_steps: Steps;
}

/**
 * 调度用的卡片完整状态。
 *
 * 公开 API 通过 `CardInput` 接受不完整输入并转换为本结构。
 */
export interface Card {
  /** 到期时间 */
  due: Date;
  /** 记忆稳定性（R=90% 时的间隔，天） */
  stability: number;
  /** 难度 D ∈ [1,10]；新卡为 0 */
  difficulty: number;
  /** 本次排期天数（天）；分钟级学习步骤排期时为 0 */
  scheduled_days: number;
  /** 学习步骤游标（当前处于 (re)learning 的第几步） */
  learning_steps: number;
  /** 复习总次数 */
  reps: number;
  /** 遗忘次数 */
  lapses: number;
  /** 卡片状态 */
  state: State;
  /** 上次复习时间（新卡为 undefined） */
  last_review?: Date;
}

/**
 * 卡片输入：`state` 接受字符串形态，"new" | "learning" | "review" | "relearning"；
 * 其余同 Card。
 */
export type CardInput = Omit<Card, "state"> & { state: State };

/** 复习日志（落库/事件记录用，schema 见 packages/core 事件模型） */
export interface ReviewLog {
  /** 本次评分 */
  rating: Grade;
  /** 本次复习发生前卡片的记忆状态 */
  state: State;
  /** 上一次排期给出的到期时间 */
  due: Date;
  /** 本次复习前的记忆稳定性 */
  stability: number;
  /** 本次复习前的难度 */
  difficulty: number;
  /** 本次排期天数（天） */
  scheduled_days: number;
  /** 本次复习时的学习步骤游标 */
  learning_steps: number;
  /** 复习发生时间 */
  review: Date;
}

/** 一次调度结果：更新后的卡片 + 本次复习日志 */
export interface RecordLogItem {
  card: Card;
  log: ReviewLog;
}

/** 四档评分的完整预览（repeat 的返回值） */
export type RecordLog = Record<Grade, RecordLogItem>;
