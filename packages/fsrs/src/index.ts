/**
 * @lexilexi/fsrs — FSRS-7 调度算法包（骨架）
 *
 * 骨架阶段仅声明与官方 FSRS-7 参考实现一致的领域常量与类型，
 * 调度算法（memory state 更新、间隔计算）将在后续迭代实现，
 * 并用 `fsrs-verify` 标记的对照用例验证（见 README）。
 */

/** FSRS 复习评分档位（与官方参考实现一致：again / hard / good / easy） */
export type Rating = "again" | "hard" | "good" | "easy";

/** 所有合法评分档位 */
export const RATINGS: readonly Rating[] = ["again", "hard", "good", "easy"];

/** 卡片记忆状态（骨架阶段仅声明，具体流转规则待算法实现） */
export type MemoryState = "new" | "learning" | "review" | "relearning";
