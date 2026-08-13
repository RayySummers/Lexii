/**
 * 复习界面的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `ReviewCard`：队列中的一张卡（条目 + 义项内容 + 调度状态）
 * - `ReviewDataProvider`：数据源接口（测试注入 mock，浏览器注入 IndexedDB 实现）
 * - `GradeContext`：一次评分携带的会话上下文，与 @lexilexi/core 的
 *   `GradeReviewInput` 对应字段对齐
 */
import type { LearningItem, MemoryState, ReviewRating, Sense } from "@lexilexi/core";

/** 复习队列中的一张卡 */
export interface ReviewCard {
  item: LearningItem;
  sense: Sense;
  memory: MemoryState;
}

/** 一次评分所需的会话上下文（UI 采集，对应 core gradeReview 输入字段） */
export interface GradeContext {
  /** 卡片出现到评分（毫秒，非负） */
  reviewDurationMs: number;
  /** 评分前是否翻面看过答案 */
  revealed: boolean;
}

/**
 * 复习数据源。
 *
 * 职责边界：只做「加载到期队列 / 评分落库 / 词库状态查询 / 示例词表导入」，
 * 全部经由 @lexilexi/core 的公开 API（getDueItemIds / gradeReview /
 * importCsvWordlist），不在 apps/web 内实现任何调度算法。
 */
export interface ReviewDataProvider {
  /** 加载到期复习队列（due <= now，按 due 升序；不含 status 非 active 的条目） */
  loadQueue(): Promise<ReviewCard[]>;
  /** 评分并原子落库（排期由 @lexilexi/core 完成） */
  grade(card: ReviewCard, rating: ReviewRating, context: GradeContext): Promise<void>;
  /** 词库是否为空（决定空状态：无词导入 vs 今日无到期） */
  hasAnyItems(): Promise<boolean>;
  /** 导入内置示例词表（空状态一键体验），返回导入条数 */
  importSampleWordlist(): Promise<number>;
}
