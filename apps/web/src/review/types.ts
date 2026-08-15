/**
 * 复习界面的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `ReviewCard`：队列中的一张卡（条目 + 义项内容 + 调度状态）
 * - `ReviewDataProvider`：数据源接口（测试注入 mock，浏览器注入 IndexedDB 实现）
 * - `GradeContext`：一次评分携带的会话上下文，与 @lexilexi/core 的
 *   `GradeReviewInput` 对应字段对齐
 */
import type {
  ExerciseType,
  LearningItem,
  LexilexiExportData,
  MemoryState,
  ReviewRating,
  Sense,
  StudyMode,
} from "@lexilexi/core";
import type { MultipleChoiceQuestion } from "./MultipleChoiceCard";

/** 复习队列中的一张卡 */
export interface ReviewCard {
  item: LearningItem;
  sense: Sense;
  memory: MemoryState;
}

/** 选择题队列（卡片 + 题目配对） */
export interface MultipleChoiceQueueResult {
  questions: MultipleChoiceQuestion[];
  cards: ReviewCard[];
}

/** 一次评分所需的会话上下文（UI 采集，对应 core gradeReview 输入字段） */
export interface GradeContext {
  /** 卡片出现到评分（毫秒，非负） */
  reviewDurationMs: number;
  /** 评分前是否翻面看过答案 */
  revealed: boolean;
  /** 练习形式（默认 recall；选择题传 multiple-choice） */
  exerciseType?: ExerciseType;
}

/**
 * 复习数据源。
 *
 * 职责边界：只做「按模式加载队列 / 评分落库 / 词库状态查询 / 示例词表导入」，
 * 全部经由 @lexilexi/core 的公开 API（getStudyQueueItemIds / gradeReview /
 * importCsvWordlist），不在 apps/web 内实现任何调度与队列组合算法。
 */
export interface ReviewDataProvider {
  /**
   * 按学习模式加载队列（RAY-253 三模式首页）：
   * - learn：未评分新词（reps === 0）
   * - review：已评分且到期的卡（reps > 0 && due <= now）
   * - mixed：复习卡穿插新词卡（每 2 张复习 1 张新词）
   * 顺序由 @lexilexi/core 的 getStudyQueueItemIds 决定（含混合穿插）。
   */
  loadQueue(mode: StudyMode): Promise<ReviewCard[]>;
  /**
   * 按学习模式加载选择题队列（RAY-269）。
   *
   * 返回与 loadQueue 相同的卡片队列，每张卡额外附带选择题题目
   * （1 正确 + 3 混淆项，来源：历史常错词 / 形近词 / 近义词）。
   * cards[i] 与 questions[i] 一一对应。
   */
  loadMultipleChoiceQueue(mode: StudyMode): Promise<MultipleChoiceQueueResult>;
  /** 评分并原子落库（排期由 @lexilexi/core 完成） */
  grade(card: ReviewCard, rating: ReviewRating, context: GradeContext): Promise<void>;
  /** 词库是否为空（决定空状态：无词导入 vs 今日无到期） */
  hasAnyItems(): Promise<boolean>;
  /** 导入内置示例词表（空状态一键体验），返回导入条数 */
  importSampleWordlist(): Promise<number>;
  /** 导出完整备份（items/senses/memoryStates/events 快照，可经 importLexilexiData 原样导回） */
  exportBackup(): Promise<LexilexiExportData>;
}
