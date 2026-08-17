/**
 * 统计页与首页到期徽标的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `StatsSnapshot`：10 项统计快照（RAY-252：统计面板扩充 + 时间维度；
 *   RAY-270：新增今日/累计学习时长）
 * - `StatsDataProvider`：统计数据源（测试注入 mock，浏览器注入 IndexedDB 实现）
 */
/** 统计快照（统计页 10 项展示 + 首页到期徽标共用） */
export interface StatsSnapshot {
  /** 连续复习天数（0 = 无复习记录，口径见 @lexii/stats） */
  streakDays: number;
  /** 累计学习天数（有复习记录的不同本地日历日数） */
  totalDays: number;
  /** 今日已学习（次数）：今天首次被复习（新学）的词条数 */
  todayLearnCount: number;
  /** 今日已复习（次数）：今天对已学词条的复习次数（不含今天首次学习） */
  todayReviewCount: number;
  /** 今日待学（词条）：due <= 今日结束的记忆状态数（日历日口径，含此前积压与今天稍后到期的卡；未截断，首页徽标用） */
  dueCount: number;
  /**
   * 今日剩余新卡（词条，RAY-295 统计页「今日待学」口径）：
   * min(每日新卡上限, 今日新卡池) − 今日已学习，下限 0——等价于
   * min(每日新卡上限 − 今日已学习, 当前剩余新卡数)。
   * 统计页按每日新卡上限过滤，不再显示全部未学新卡总数；
   * 首页徽标仍使用未截断的 dueCount（RAY-260 口径，另有额度提示说明）。
   */
  newCardsRemainingToday: number;
  /** 明日到期（词条）：due 落在明天本地日历日内的记忆状态数 */
  dueTomorrowCount: number;
  /** 累计已完成（次数）：review 事件总数 */
  reviewCount: number;
  /** 累计已完成（词条）：至少复习过一次的词条数（itemId 去重） */
  completedWordCount: number;
  /** 今日学习时长（毫秒，RAY-270）：今天产生的复习事件的有效时长之和（单卡超上限截断，闲置不计） */
  todayStudyDurationMs: number;
  /** 累计学习时长（毫秒，RAY-270）：全部有效复习时长之和（非法时间与未来脏事件不计） */
  totalStudyDurationMs: number;
}

/**
 * 统计数据源。
 *
 * 职责边界：只做到期数与事件流的读取聚合，全部经由 @lexii/core 的
 * 公开 API（getDueItemIds / getDueItemIdsInRange）与 @lexii/stats 的
 * 纯函数（computeStreak / computeTotalDays / computeLearnedTodayCount /
 * computeReviewedTodayCount / computeCompletedWordCount / localDayBounds），
 * 不在 apps/web 内实现任何统计算法。统计数据全本地计算，不联网不上传。
 */
export interface StatsDataProvider {
  /** 加载统计快照；失败抛错（由调用方决定展示方式） */
  loadStats(): Promise<StatsSnapshot>;
}
