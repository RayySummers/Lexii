/**
 * 「今日」的到期边界（RAY-276 诊断线 2 修复）。
 *
 * 队列与统计的「今日待学」按本地日历日口径判定：due <= 今日结束
 * （23:59:59.999 含）即视为「今天可学」，而不是精确到「due <= 当前时刻」。
 *
 * 背景：FSRS 排期把 due 记为精确时刻（复习时刻 + 间隔，间隔以天为单位时
 * 不向午夜对齐）。昨晚 21:00 学过的词，due 是今晚 21:00——按「due <= now」
 * 口径，今天上午打开应用会看到「今日无待学词」，晚上才能看到，与用户对
 * 「天」的直觉不符（真机复测 RAY-276 现象）。改为日历日口径后，这些词从
 * 当天早上起就进入「今日待学」与复习队列。
 *
 * 提前复习是 FSRS 允许的正常输入（调度器按实际经过天数排期），不改任何
 * 调度算法与 @lexii/fsrs 的差分验证口径；本边界只作用于「哪些卡今天
 * 出现」的查询层。
 *
 * 与 @lexii/stats 的 localDayBounds（明日到期统计）同源：均由本地日历
 * 分量构造，与夏令时无关。
 */
import type { IsoDate } from "./domain";

/** 某时刻所在本地日历日的结束时刻（23:59:59.999，含） */
export function endOfLocalDay(now: IsoDate): IsoDate {
  const ms = Date.parse(now);
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid date: ${now}`);
  }
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString();
}
