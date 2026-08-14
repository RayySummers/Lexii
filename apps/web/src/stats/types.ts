/**
 * 统计页与首页到期徽标的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `StatsSnapshot`：基础统计快照（今日到期 / 累计已复习 / 连续天数）
 * - `StatsDataProvider`：统计数据源（测试注入 mock，浏览器注入 IndexedDB 实现）
 */
/** 基础统计快照（统计页展示 + 首页到期徽标共用） */
export interface StatsSnapshot {
  /** 今日到期数（due <= now 的记忆状态数，含此前积压） */
  dueCount: number;
  /** 累计已复习数（review 事件总数） */
  reviewCount: number;
  /** 连续复习天数（0 = 无复习记录，口径见 @lexilexi/stats） */
  streakDays: number;
}

/**
 * 统计数据源。
 *
 * 职责边界：只做「到期数 / 已复习数 / 连续天数」的聚合，全部经由
 * @lexilexi/core 的公开 API（getDueItemIds）与 @lexilexi/stats 的纯函数
 * （countReviews / computeStreak），不在 apps/web 内实现任何统计算法。
 */
export interface StatsDataProvider {
  /** 加载统计快照；失败抛错（由调用方决定展示方式） */
  loadStats(): Promise<StatsSnapshot>;
}
