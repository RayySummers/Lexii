/**
 * @lexilexi/stats — 学习统计（连击、累计天数、今日学习/复习、词条完成、结果分类）
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
 * - 累计天数 = 有复习记录的不同本地日历日数（未来日期的脏事件除外）。
 * - 今日已学习（次数）= 今天首次被复习（新学）的词条数。一个词条在
 *   事件流里的第一条 review 事件即其「学习」记录——可无损推导，无需
 *   改 event schema（老数据同样生效），与 MemoryState.status==="new"
 *   时刻的首次评分一一对应。
 * - 今日已复习（次数）= 今天对已学词条的复习次数：今天产生的 review
 *   事件中，去掉每个词条那条「首次复习」（今日已学习）后的余数。
 * - 累计已完成（词条）= 至少复习过一次的词条数（不要求 time 合法，
 *   记录存在即算完成过一次）。
 * - 复习结果分类（对/错/遗忘）：rating=again 视为遗忘（用户自评忘记）；
 *   否则按 answerWasCorrect 分对/错。为后续「最晚背到几点」「遗忘最多的
 *   单词」统计打底（时间戳与每词结果均已随 review 事件落库）。
 */
import type { EventId, IsoDate, ItemId, ReviewEvent } from "@lexilexi/core";

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
  const endOrdinal = dayOrdinal(now);
  let latestOrdinal: number | null = null;
  for (const event of events) {
    const ordinal = localDayOrdinalOrNull(event.time, endOrdinal);
    if (ordinal === null) {
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
    const ordinal = localDayOrdinalOrNull(event.time, endOrdinal);
    if (ordinal !== null) {
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
 * 累计天数：截止基准时刻，有复习记录的不同本地日历日数。
 *
 * @param events 复习事件（任意顺序；非法时间与未来日期的脏事件被忽略）
 * @param now 查询基准时刻（ISO；默认调用方当前时间）
 * @returns 0 = 没有任何（合法且不晚于基准的）复习记录
 */
export function computeTotalDays(
  events: readonly ReviewEvent[],
  now: IsoDate = new Date().toISOString(),
): number {
  const endOrdinal = dayOrdinal(now);
  const days = new Set<number>();
  for (const event of events) {
    const ordinal = localDayOrdinalOrNull(event.time, endOrdinal);
    if (ordinal !== null) {
      days.add(ordinal);
    }
  }
  return days.size;
}

/**
 * 今日已学习（次数）：今天首次被复习（新学）的词条数。
 *
 * 一个词条在事件流里时间最早的那条 review 事件即其「学习」记录；
 * 该记录落在今天的词条数即返回值。同时间戳并列时按事件 id 决胜，
 * 保证任意遍历顺序下「首次复习」的判定确定。
 *
 * @param events 复习事件（任意顺序）
 * @param now 查询基准时刻（ISO；默认调用方当前时间）
 */
export function computeLearnedTodayCount(
  events: readonly ReviewEvent[],
  now: IsoDate = new Date().toISOString(),
): number {
  const endOrdinal = dayOrdinal(now);
  let count = 0;
  for (const first of firstReviewByItem(events, endOrdinal).values()) {
    if (localDayOrdinal(Date.parse(first.time)) === endOrdinal) {
      count += 1;
    }
  }
  return count;
}

/**
 * 今日已复习（次数）：今天对已学词条的复习次数。
 *
 * = 今天产生的 review 事件数 − 今日已学习（次数）。
 * 即：落在今天的 review 事件里，去掉每个词条那条「首次复习」后的余数。
 * 昨天（或更早）学过的词条今天再复习、今天新学词条今天的后续评分，都计为复习。
 *
 * @param events 复习事件（任意顺序）
 * @param now 查询基准时刻（ISO；默认调用方当前时间）
 */
export function computeReviewedTodayCount(
  events: readonly ReviewEvent[],
  now: IsoDate = new Date().toISOString(),
): number {
  const endOrdinal = dayOrdinal(now);
  const firstByItem = firstReviewByItem(events, endOrdinal);
  let count = 0;
  for (const event of events) {
    if (localDayOrdinalOrNull(event.time, endOrdinal) !== endOrdinal) {
      continue; // 只数今天的复习
    }
    if (firstByItem.get(event.itemId)?.eventId === event.id) {
      continue; // 该词条今天的首次复习 = 学习（由今日已学习计数）
    }
    count += 1;
  }
  return count;
}

/**
 * 累计已完成（词条）：至少复习过一次的词条数。
 *
 * 按 review 事件的 itemId 去重；事件时间是否合法不影响计数（记录存在
 * 即证明该词条完成过至少一次复习，时钟异常的脏数据同样计入）。
 */
export function computeCompletedWordCount(events: readonly ReviewEvent[]): number {
  const words = new Set<ItemId>();
  for (const event of events) {
    words.add(event.itemId);
  }
  return words.size;
}

/**
 * 复习结果分类：对 / 错 / 遗忘。
 *
 * 口径：rating=again 视为遗忘（用户自评「忘记了」，需要重新学习）；
 * 否则按 answerWasCorrect 分对/错。对/错/遗忘三态是「遗忘最多的单词」等
 * 后续统计的基础分类，全部随 review 事件落库（时间戳 + 每词结果）。
 */
export type ReviewOutcome = "correct" | "wrong" | "forgotten";

/** 复习结果的逐档计数 */
export interface ReviewOutcomeCounts {
  correct: number;
  wrong: number;
  forgotten: number;
}

/**
 * 分类一次复习的结果（对/错/遗忘）。
 *
 * rating=again → forgotten（遗忘优先级最高：即便作答碰巧正确，
 * 自评「忘记」也按遗忘计）；否则 answerWasCorrect → correct / wrong。
 */
export function classifyReviewOutcome(event: ReviewEvent): ReviewOutcome {
  if (event.rating === "again") {
    return "forgotten";
  }
  return event.answerWasCorrect ? "correct" : "wrong";
}

/** 全部复习事件的对/错/遗忘计数 */
export function countReviewOutcomes(events: readonly ReviewEvent[]): ReviewOutcomeCounts {
  const counts: ReviewOutcomeCounts = { correct: 0, wrong: 0, forgotten: 0 };
  for (const event of events) {
    counts[classifyReviewOutcome(event)] += 1;
  }
  return counts;
}

/**
 * 按词条分组的结果计数（「遗忘最多的单词」统计的直接数据源）。
 *
 * 返回 Map：itemId → { correct, wrong, forgotten }；未复习过的词条不在 Map 中。
 */
export function countReviewOutcomesByItem(
  events: readonly ReviewEvent[],
): ReadonlyMap<ItemId, ReviewOutcomeCounts> {
  const byItem = new Map<ItemId, ReviewOutcomeCounts>();
  for (const event of events) {
    const counts = byItem.get(event.itemId) ?? { correct: 0, wrong: 0, forgotten: 0 };
    counts[classifyReviewOutcome(event)] += 1;
    byItem.set(event.itemId, counts);
  }
  return byItem;
}

/**
 * 某个本地日历日的半开区间边界（[start, end)）。
 *
 * 以「基准时刻所在本地日历日」为第 0 天，offsetDays 偏移后返回该天的
 * 00:00:00.000（含）到次日 00:00:00.000（不含）。用于把「今日/明日到期」
 * 换算成 due 时间区间查询（与 @lexilexi/core 的 getDueItemIdsInRange 对齐）。
 * 直接由本地日历分量构造 Date，与夏令时无关。
 */
export interface LocalDayBounds {
  /** 该本地日历日 00:00:00.000（含） */
  start: IsoDate;
  /** 次日 00:00:00.000（不含） */
  end: IsoDate;
}

export function localDayBounds(now: IsoDate, offsetDays = 0): LocalDayBounds {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new RangeError(`Invalid date: ${now}`);
  }
  const base = new Date(nowMs);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** 词条的首条复习记录（事件流里时间最早者；同时间戳按 id 决胜） */
interface FirstReview {
  eventId: EventId;
  time: IsoDate;
}

/** 每个词条的首条复习记录（只含合法且不晚于 endOrdinal 的事件） */
function firstReviewByItem(
  events: readonly ReviewEvent[],
  endOrdinal: number,
): ReadonlyMap<ItemId, FirstReview> {
  const first = new Map<ItemId, FirstReview>();
  for (const event of events) {
    if (localDayOrdinalOrNull(event.time, endOrdinal) === null) {
      continue;
    }
    const existing = first.get(event.itemId);
    if (
      !existing ||
      event.time < existing.time ||
      (event.time === existing.time && event.id < existing.eventId)
    ) {
      first.set(event.itemId, { eventId: event.id, time: event.time });
    }
  }
  return first;
}

/** 基准时刻的本地日历日序号（非法时间抛 RangeError） */
function dayOrdinal(now: IsoDate): number {
  const endMs = Date.parse(now);
  if (Number.isNaN(endMs)) {
    throw new RangeError(`Invalid date: ${now}`);
  }
  return localDayOrdinal(endMs);
}

/**
 * 事件时刻的本地日历日序号；非法时间或晚于 endOrdinal（未来脏事件）返回 null。
 */
function localDayOrdinalOrNull(time: IsoDate, endOrdinal: number): number | null {
  const ms = Date.parse(time);
  if (Number.isNaN(ms)) {
    return null;
  }
  const ordinal = localDayOrdinal(ms);
  return ordinal > endOrdinal ? null : ordinal;
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
