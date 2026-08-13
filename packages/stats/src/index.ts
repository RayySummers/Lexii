/**
 * @lexilexi/stats — 学习统计 v0（连击、已复习数）
 *
 * 从本地事件流聚合（事件是唯一事实来源，见 docs/domain-model.md §7），
 * 只依赖 @lexilexi/core 的领域类型，不碰 IndexedDB 表结构。
 * 全部函数为纯函数（输入事件数组 + 查询基准时刻）。
 *
 * 口径说明：
 * - 已复习数 = review 事件总数（一次评分一次复习）。
 * - 连击 = 以「本地日历日」计的连续复习天数：从最新一个有复习的日期
 *   向前数；允许基准当天尚未复习（今天还没学不算断）。未来若引入用户
 *   时区设置，日历日口径随之切换。
 */
import type { IsoDate, ReviewEvent } from "@lexilexi/core";

/** 一天的毫秒数 */
const DAY_MS = 86_400_000;

/**
 * 已复习数：review 事件总数。
 */
export function countReviews(events: readonly ReviewEvent[]): number {
  return events.length;
}

/**
 * 当前连击：截止基准时刻，以本地日历日计的连续复习天数。
 *
 * 日历日一律按「本地日历日序号」（localDayOrdinal）比较，不做毫秒差运算：
 * 夏令时切换日两个本地午夜相距 23h（拨快日）或 25h（回拨日），
 * 毫秒差会误判「昨天」或跳过一天（评审建议 #1 的 DST bug）。
 *
 * @param events 复习事件（任意顺序、可含未来事件——未来事件被忽略）
 * @param now 查询基准时刻（ISO；默认调用方当前时间）
 * @returns 0 = 没有任何复习记录；1 = 仅今天复习过（或昨天复习了但今天还没）
 */
export function computeStreak(
  events: readonly ReviewEvent[],
  now: IsoDate = new Date().toISOString(),
): number {
  const endMs = Date.parse(now);
  if (Number.isNaN(endMs)) {
    throw new RangeError(`Invalid date: ${now}`);
  }
  const endOrdinal = localDayOrdinal(endMs);
  let latestOrdinal: number | null = null;
  for (const event of events) {
    const ordinal = localDayOrdinal(Date.parse(event.time));
    if (Number.isNaN(ordinal) || ordinal > endOrdinal) {
      continue; // 非法或未来事件不参与
    }
    if (latestOrdinal === null || ordinal > latestOrdinal) {
      latestOrdinal = ordinal;
    }
  }
  if (latestOrdinal === null) {
    return 0; // 没有任何复习记录
  }
  // 允许基准当天尚未复习：最近复习在昨天（序号差 1）或今天，连击都未中断
  if (endOrdinal - latestOrdinal > 1) {
    return 0;
  }

  const days = new Set<number>();
  for (const event of events) {
    const ordinal = localDayOrdinal(Date.parse(event.time));
    if (!Number.isNaN(ordinal) && ordinal <= endOrdinal) {
      days.add(ordinal);
    }
  }

  let streak = 0;
  for (let cursor = latestOrdinal; days.has(cursor); cursor -= 1) {
    streak += 1;
  }
  return streak;
}

/**
 * 本地日历日序号：某时刻所在「本地日历日」的唯一递增整数（每天严格 +1）。
 *
 * 从本地日历分量（Y/M/D）构造 UTC 日号再除以一天的毫秒数——不用
 * 「epoch 毫秒 ÷ 86400000」（夏令时切换日会错位），因此与夏令时无关。
 */
function localDayOrdinal(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** 包名（保留原骨架导出的兼容） */
export const PACKAGE_NAME = "@lexilexi/stats";
