/**
 * 统计数据源（IndexedDB 实现）。
 *
 * 聚合口径（对应 docs/domain-model.md §7 事件流唯一事实来源）：
 * - dueCount：getDueItemIds（core 公开 API，due <= now 的记忆状态数，含积压）
 * - dueTomorrowCount：getDueItemIdsInRange + localDayBounds（明天本地日历日
 *   的半开区间 [start, end)，与「今日待学」同为记忆状态口径）
 * - reviewCount / streakDays / totalDays / todayLearnCount / todayReviewCount /
 *   completedWordCount：@lexilexi/stats 纯函数（口径见 packages/stats）
 *
 * 性能说明（Oscar 评审 C1）：review 事件查询走 events 表的 type 索引
 * （where("type").equals("review")），不整表 toArray；事件数上万后
 * 只读取 review 子集，其他事件类型（import/edit/suspend…）不进入内存。
 * 到期查询为 Dexie filter 全表扫描，MVP 词库规模（数百条目）无碍
 * （与 core getDueItemIds 的既有说明一致）。
 *
 * local-first 红线：所有聚合均在本机 IndexedDB 上完成，不发起任何网络请求。
 */
import { getDueItemIds, getDueItemIdsInRange, isReviewEvent, openDatabase } from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import {
  computeCompletedWordCount,
  computeLearnedTodayCount,
  computeReviewedTodayCount,
  computeStreak,
  computeTotalDays,
  countReviews,
  localDayBounds,
} from "@lexilexi/stats";
import type { StatsDataProvider, StatsSnapshot } from "./types";

/** 基于已打开的 Lexilexi 数据库创建统计数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbStatsDataProvider(db: LexilexiDatabase): StatsDataProvider {
  return {
    async loadStats(): Promise<StatsSnapshot> {
      const now = new Date().toISOString();
      const tomorrow = localDayBounds(now, 1);
      const [dueIds, dueTomorrowIds, reviewEvents] = await Promise.all([
        getDueItemIds(db, now),
        getDueItemIdsInRange(db, tomorrow.start, tomorrow.end),
        db.events.where("type").equals("review").toArray(),
      ]);
      // where 查询返回 Event[]，经类型守卫收窄为 ReviewEvent[] 供 stats 纯函数使用
      const reviews = reviewEvents.filter(isReviewEvent);
      return {
        streakDays: computeStreak(reviews, now),
        totalDays: computeTotalDays(reviews, now),
        todayLearnCount: computeLearnedTodayCount(reviews, now),
        todayReviewCount: computeReviewedTodayCount(reviews, now),
        dueCount: dueIds.length,
        dueTomorrowCount: dueTomorrowIds.length,
        reviewCount: countReviews(reviews),
        completedWordCount: computeCompletedWordCount(reviews),
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
  reviewCount: 0,
  completedWordCount: 0,
};
