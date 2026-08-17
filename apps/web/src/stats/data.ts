/**
 * 统计数据源（IndexedDB 实现）。
 *
 * 聚合口径（对应 docs/domain-model.md §7 事件流唯一事实来源）：
 * - dueCount：getDueItemIds（core 公开 API，due <= 今日结束的记忆状态数，
 *   日历日口径含积压与今天稍后到期的卡，RAY-276；未截断，首页徽标用）；
 *   生词本开关关闭时排除生词本条目（RAY-284，与学习队列同口径）
 * - newCardsRemainingToday：getStudyQueueItemIds("learn")（未截断的新词队列
 *   长度，「剩余新卡数」与学习队列同口径）经 @lexii/stats 的
 *   computeNewCardsRemainingToday 按「每日新卡上限 − 今日已学」与剩余新卡
 *   数取较小者（RAY-295：统计页「今日待学」按每日新卡上限过滤，不再
 *   显示全部未学新卡总数）
 * - dueTomorrowCount：getDueItemIdsInRange + localDayBounds（明天本地日历日
 *   的半开区间 [start, end)，与「今日待学」同为记忆状态口径）
 * - reviewCount / streakDays / totalDays / todayLearnCount / todayReviewCount /
 *   completedWordCount / todayStudyDurationMs / totalStudyDurationMs：
 *   @lexii/stats 纯函数（口径见 packages/stats，学习时长口径 RAY-270）
 *
 * 性能说明（Oscar 评审 C1）：review 事件查询走 events 表的 type 索引
 * （where("type").equals("review")），不整表 toArray；事件数上万后
 * 只读取 review 子集，其他事件类型（import/edit/suspend…）不进入内存。
 * 到期查询为 Dexie filter 全表扫描，MVP 词库规模（数百条目）无碍
 * （与 core getDueItemIds 的既有说明一致）。newCardsRemainingToday 的
 * 新词计数（getStudyQueueItemIds("learn")）与 dueCount 同走 fields.due
 * 索引区间扫描，不引入新的全表扫描；两次扫描按词库规模线性，可接受。
 *
 * local-first 红线：所有聚合均在本机 IndexedDB 上完成，不发起任何网络请求。
 */
import {
  getDueItemIds,
  getDueItemIdsInRange,
  getStudyQueueItemIds,
  isReviewEvent,
  openDatabase,
} from "@lexii/core";
import type { LexiiDatabase } from "@lexii/core";
import {
  computeCompletedWordCount,
  computeLearnedTodayCount,
  computeNewCardsRemainingToday,
  computeReviewedTodayCount,
  computeStreak,
  computeStudyDurationMs,
  computeTodayStudyDurationMs,
  computeTotalDays,
  countReviews,
  localDayBounds,
} from "@lexii/stats";
import { readDailyNewCardLimit } from "../lib/dailyNewCardLimit";
import { readIncludeNotebook } from "../lib/notebookPreference";
import type { StatsDataProvider, StatsSnapshot } from "./types";

/** 基于已打开的 Lexii 数据库创建统计数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbStatsDataProvider(db: LexiiDatabase): StatsDataProvider {
  return {
    async loadStats(): Promise<StatsSnapshot> {
      const now = new Date().toISOString();
      const tomorrow = localDayBounds(now, 1);
      // 生词本开关（RAY-284）：到期/待学统计与学习队列同口径（调用时读取偏好）
      const includeNotebook = readIncludeNotebook();
      const [dueIds, dueTomorrowIds, newCardIds, reviewEvents] = await Promise.all([
        getDueItemIds(db, now, { includeNotebook }),
        getDueItemIdsInRange(db, tomorrow.start, tomorrow.end, { includeNotebook }),
        getStudyQueueItemIds(db, now, "learn", { includeNotebook }),
        db.events.where("type").equals("review").toArray(),
      ]);
      // where 查询返回 Event[]，经类型守卫收窄为 ReviewEvent[] 供 stats 纯函数使用
      const reviews = reviewEvents.filter(isReviewEvent);
      const todayLearnCount = computeLearnedTodayCount(reviews, now);
      return {
        streakDays: computeStreak(reviews, now),
        totalDays: computeTotalDays(reviews, now),
        todayLearnCount,
        todayReviewCount: computeReviewedTodayCount(reviews, now),
        dueCount: dueIds.length,
        dueTomorrowCount: dueTomorrowIds.length,
        newCardsRemainingToday: computeNewCardsRemainingToday(
          readDailyNewCardLimit(),
          newCardIds.length,
          todayLearnCount,
        ),
        reviewCount: countReviews(reviews),
        completedWordCount: computeCompletedWordCount(reviews),
        todayStudyDurationMs: computeTodayStudyDurationMs(reviews, now),
        totalStudyDurationMs: computeStudyDurationMs(reviews, now),
      };
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 *
 * 无 IndexedDB 的环境（如 jsdom 测试未注入、极端隐私模式）返回全零快照——
 * 首页到期徽标/统计页退化为「无数据」展示，与设置页 persistenceGuard 的
 * 「不支持的环境静默降级」策略一致，绝不抛错阻塞界面。
 */
export function createDefaultStatsDataProvider(): StatsDataProvider {
  if (typeof indexedDB === "undefined") {
    return createEmptyStatsDataProvider();
  }
  return createIndexedDbStatsDataProvider(openDatabase());
}

/** 全零快照数据源（无 IndexedDB 环境的降级兜底） */
export function createEmptyStatsDataProvider(): StatsDataProvider {
  return {
    async loadStats(): Promise<StatsSnapshot> {
      return EMPTY_STATS;
    },
  };
}

/** 全零快照（空数据源与空库共用，避免重复字面量漂移） */
export const EMPTY_STATS: StatsSnapshot = {
  streakDays: 0,
  totalDays: 0,
  todayLearnCount: 0,
  todayReviewCount: 0,
  dueCount: 0,
  dueTomorrowCount: 0,
  newCardsRemainingToday: 0,
  reviewCount: 0,
  completedWordCount: 0,
  todayStudyDurationMs: 0,
  totalStudyDurationMs: 0,
};
