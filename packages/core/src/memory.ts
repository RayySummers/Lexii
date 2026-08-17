/**
 * Memory State（记忆状态）：Learning Item 在 FSRS-7 下的调度状态。
 *
 * 对应 docs/domain-model.md §5、§6：
 * - 每个 Learning Item 恰好一份，id 与 itemId 相同（1─1 锚定）。
 * - FSRS 实现细节不进入领域模型：字段从调度角度命名，内部再换算为
 *   ts-fsrs 的 t（天）与 d ∈ [1,10]。stabilityDays / difficulty /
 *   elapsedDays 与 ts-fsrs 官方 Card.stability / difficulty / elapsed_days 同语义。
 * - 初始状态由 @lexii/fsrs 的 newCardFields() 创建（RAY-236 接口契约）。
 * - 恢复不变量：在任意 ReviewEvent 序列前缀上重放调度，得到的状态必须
 *   与库中 MemoryState 一致——MemoryState 是事件的投影，可随时重建。
 */
import type { ItemId } from "./id";
import type { IsoDate } from "./domain";
import type { ReviewRating } from "./events";

export type MemoryStatus = "new" | "learning" | "review" | "relearning";

/** FSRS 调度字段（MemoryState 的 payload，@lexii/fsrs 消费此类型） */
export interface MemoryStateFields {
  /** 调度状态机阶段 */
  status: MemoryStatus;
  /** 下次复习时间 */
  due: IsoDate;
  /** FSRS S：记忆稳定度（天），与 ts-fsrs Card.stability 同语义 */
  stabilityDays: number;
  /** FSRS D：难度，∈ [1, 10]，与 ts-fsrs Card.difficulty 同语义 */
  difficulty: number;
  /** 距上次复习经过的天数（FSRS elapsed_days） */
  elapsedDays: number;
  /** 学习步骤游标（当前处于 (re)learning 的第几步，0 = 不在步骤内） */
  learningSteps: number;
  /** 累计复习次数 */
  reps: number;
  /** 遗忘次数 */
  lapses: number;
  /** 首次评分前为 null */
  lastReviewAt: IsoDate | null;
  /** 首次评分前为 null */
  lastRating: ReviewRating | null;
}

/** 记忆状态记录：1─1 锚定 LearningItem（id === itemId） */
export interface MemoryState {
  id: ItemId;
  itemId: ItemId;
  fields: MemoryStateFields;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}
