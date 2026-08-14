/**
 * 统计数据源（IndexedDB 实现）。
 *
 * 聚合口径（对应 docs/domain-model.md §7 事件流唯一事实来源）：
 * - dueCount：getDueItemIds（core 公开 API，due <= now 的记忆状态数）
 * - reviewCount：countReviews（review 事件总数，@lexilexi/stats）
 * - streakDays：computeStreak（本地日历日连续天数，@lexilexi/stats）
 *
 * 性能说明（Oscar 评审 C1）：review 事件查询走 events 表的 type 索引
 * （where("type").equals("review")），不整表 toArray；事件数上万后
 * 只读取 review 子集，其他事件类型（import/edit/suspend…）不进入内存。
 */
import { getDueItemIds, isReviewEvent, openDatabase } from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { computeStreak, countReviews } from "@lexilexi/stats";
import type { StatsDataProvider, StatsSnapshot } from "./types";

/** 基于已打开的 Lexilexi 数据库创建统计数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbStatsDataProvider(db: LexilexiDatabase): StatsDataProvider {
  return {
    async loadStats(): Promise<StatsSnapshot> {
      const now = new Date().toISOString();
      const [dueIds, reviewEvents] = await Promise.all([
        getDueItemIds(db, now),
        db.events.where("type").equals("review").toArray(),
      ]);
      // where 查询返回 Event[]，经类型守卫收窄为 ReviewEvent[] 供 stats 纯函数使用
      const reviews = reviewEvents.filter(isReviewEvent);
      return {
        dueCount: dueIds.length,
        reviewCount: countReviews(reviews),
        streakDays: computeStreak(reviews, now),
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
      return { dueCount: 0, reviewCount: 0, streakDays: 0 };
    },
  };
}
