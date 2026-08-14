import { describe, expect, it } from "vitest";
import { toEventId, toItemId, toSenseId } from "@lexilexi/core";
import type { ReviewEvent, ReviewRating } from "@lexilexi/core";
import {
  classifyReviewOutcome,
  computeCompletedWordCount,
  computeLearnedTodayCount,
  computeReviewedTodayCount,
  computeStreak,
  computeTotalDays,
  countReviewOutcomes,
  countReviewOutcomesByItem,
  countReviews,
  localDayBounds,
} from "./index";

/** 构造一个指定时刻的复习事件（序号保证 id 唯一） */
let eventSeq = 0;
function reviewAt(time: string): ReviewEvent {
  eventSeq += 1;
  return {
    id: toEventId(`evt_stats_${eventSeq}`),
    type: "review",
    time,
    itemId: toItemId("item_1"),
    senseId: toSenseId("sense_1"),
    exerciseType: "recall",
    rating: "good",
    reviewDurationMs: 2000,
    revealed: false,
    answerWasCorrect: true,
    elapsedDays: 0,
  };
}

describe("countReviews（已复习数）", () => {
  it("返回 review 事件总数", () => {
    expect(countReviews([])).toBe(0);
    expect(countReviews([reviewAt("2026-08-13T09:00:00.000Z")])).toBe(1);
    expect(
      countReviews([
        reviewAt("2026-08-13T09:00:00.000Z"),
        reviewAt("2026-08-13T10:00:00.000Z"),
        reviewAt("2026-08-12T10:00:00.000Z"),
      ]),
    ).toBe(3);
  });
});

/**
 * 连击口径用例统一固定在 UTC 时区：事件与基准都用纯 UTC 日期，
 * 且「同一本地日」选取 12:00Z（任何 UTC±14h 时区下 12:00Z 都落在同一
 * 本地日——除 +12 时区整 12:00Z 为本地次日 0 点，故用 11:00Z 更稳）。
 * 夏令时专项用例见 dst.test.ts。
 */
describe("computeStreak（连击，UTC 口径）", () => {
  it("无复习记录时连击为 0", () => {
    expect(computeStreak([], "2026-08-13T23:59:59.000Z")).toBe(0);
  });

  it("仅今天复习过，连击为 1", () => {
    const events = [reviewAt("2026-08-13T11:00:00.000Z")];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(1);
  });

  it("连续三天复习，连击为 3（含跨月）", () => {
    const events = [
      reviewAt("2026-07-31T11:00:00.000Z"),
      reviewAt("2026-08-01T11:00:00.000Z"),
      reviewAt("2026-08-02T11:00:00.000Z"),
    ];
    expect(computeStreak(events, "2026-08-02T12:00:00.000Z")).toBe(3);
  });

  it("昨天+今天复习：连击为 2", () => {
    const events = [reviewAt("2026-08-12T11:00:00.000Z"), reviewAt("2026-08-13T11:00:00.000Z")];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(2);
  });

  it("今天还没复习不算断：仅昨天复习，连击为 1", () => {
    const events = [reviewAt("2026-08-12T11:00:00.000Z")];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(1);
  });

  it("中断一天：连击从最新一段算起", () => {
    const events = [
      reviewAt("2026-08-10T11:00:00.000Z"),
      reviewAt("2026-08-11T11:00:00.000Z"),
      // 08-12 未复习（中断）
      reviewAt("2026-08-13T11:00:00.000Z"),
    ];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(1);
  });

  it("最近复习在两天前：连击为 0", () => {
    const events = [reviewAt("2026-08-11T11:00:00.000Z")];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(0);
  });

  it("一天内多次复习只计一天", () => {
    const events = [
      reviewAt("2026-08-12T11:00:00.000Z"),
      reviewAt("2026-08-12T20:00:00.000Z"),
      reviewAt("2026-08-13T11:00:00.000Z"),
    ];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(2);
  });

  it("事件乱序不影响结果", () => {
    const events = [
      reviewAt("2026-08-13T11:00:00.000Z"),
      reviewAt("2026-08-11T11:00:00.000Z"),
      reviewAt("2026-08-12T11:00:00.000Z"),
    ];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(3);
  });

  it("未来事件被忽略（跨到下一本地日才算未来）", () => {
    const events = [
      reviewAt("2026-08-13T11:00:00.000Z"),
      reviewAt("2026-08-15T11:00:00.000Z"), // 本地日的后天（真未来）
    ];
    expect(computeStreak(events, "2026-08-13T12:00:00.000Z")).toBe(1);
  });

  it("非法基准时刻抛错", () => {
    expect(() => computeStreak([], "not-a-date")).toThrow(RangeError);
  });
});

/**
 * 以下为 8 项统计与结果分类的新增用例。
 *
 * 时区安全约定（沿用文件头部说明）：「今天」的事件取 11:00Z、基准 now 取
 * 11:30Z——两者相隔仅 30 分钟，任何 UTC±14 时区下都不可能跨本地午夜，
 * 因此「事件在基准当天」的断言与时区无关。「昨天/前天」事件取前一天/前两天的
 * 11:00Z（极端时区下最多偏移 ±14h，同样不会跨出「相邻本地日」的范围）。
 */

/** 新用例专用构造器：指定词条与时刻，可选评分与作答正确性 */
let itemEventSeq = 0;
function reviewEventFor(
  itemKey: string,
  time: string,
  rating: ReviewRating = "good",
  answerWasCorrect = true,
): ReviewEvent {
  itemEventSeq += 1;
  return {
    id: toEventId(`evt_new_${itemEventSeq}`),
    type: "review",
    time,
    itemId: toItemId(`item_${itemKey}`),
    senseId: toSenseId(`sense_${itemKey}`),
    exerciseType: "recall",
    rating,
    reviewDurationMs: 2000,
    revealed: false,
    answerWasCorrect,
    elapsedDays: 0,
  };
}

const NOW = "2026-08-13T11:30:00.000Z";
const TODAY = "2026-08-13T11:00:00.000Z";
const YESTERDAY = "2026-08-12T11:00:00.000Z";
const DAY_BEFORE = "2026-08-11T11:00:00.000Z";

describe("computeTotalDays（累计天数）", () => {
  it("无复习记录时为 0", () => {
    expect(computeTotalDays([], NOW)).toBe(0);
  });

  it("同一天多次复习只计一天", () => {
    const events = [
      reviewEventFor("a", TODAY),
      reviewEventFor("a", "2026-08-13T11:10:00.000Z"),
      reviewEventFor("b", "2026-08-13T11:20:00.000Z"),
    ];
    expect(computeTotalDays(events, NOW)).toBe(1);
  });

  it("跨天（含跨月）分别计数", () => {
    const events = [
      reviewEventFor("a", "2026-07-31T11:00:00.000Z"),
      reviewEventFor("a", "2026-08-01T11:00:00.000Z"),
      reviewEventFor("a", TODAY),
    ];
    expect(computeTotalDays(events, NOW)).toBe(3);
  });

  it("未来脏事件不计入", () => {
    const events = [reviewEventFor("a", TODAY), reviewEventFor("b", "2026-08-15T11:00:00.000Z")];
    expect(computeTotalDays(events, NOW)).toBe(1);
  });

  it("非法时间事件跳过", () => {
    const events = [reviewEventFor("a", TODAY), reviewEventFor("b", "not-a-date")];
    expect(computeTotalDays(events, NOW)).toBe(1);
  });

  it("非法基准时刻抛错", () => {
    expect(() => computeTotalDays([], "not-a-date")).toThrow(RangeError);
  });
});

describe("computeLearnedTodayCount（今日已学习，词条首次复习落在今天）", () => {
  it("今天首次复习的词条计为今天学习", () => {
    const events = [reviewEventFor("a", TODAY), reviewEventFor("b", TODAY)];
    expect(computeLearnedTodayCount(events, NOW)).toBe(2);
  });

  it("昨天已学、今天再复习的词条不计为今天学习", () => {
    const events = [reviewEventFor("a", YESTERDAY), reviewEventFor("a", TODAY)];
    expect(computeLearnedTodayCount(events, NOW)).toBe(0);
  });

  it("今天新学词条同一天的后续评分不再重复计学习", () => {
    const events = [reviewEventFor("a", TODAY), reviewEventFor("a", "2026-08-13T11:20:00.000Z")];
    expect(computeLearnedTodayCount(events, NOW)).toBe(1);
  });

  it("未来脏事件不算今天学习", () => {
    const events = [reviewEventFor("a", "2026-08-15T11:00:00.000Z")];
    expect(computeLearnedTodayCount(events, NOW)).toBe(0);
  });

  it("事件乱序不影响判定（最早事件才是首次复习）", () => {
    const events = [
      reviewEventFor("a", "2026-08-13T11:20:00.000Z"),
      reviewEventFor("a", TODAY),
      reviewEventFor("b", TODAY),
    ];
    expect(computeLearnedTodayCount(events, NOW)).toBe(2);
  });

  it("非法基准时刻抛错", () => {
    expect(() => computeLearnedTodayCount([], "not-a-date")).toThrow(RangeError);
  });
});

describe("computeReviewedTodayCount（今日已复习，不含今天首次学习）", () => {
  it("全部为今天首次学习时复习为 0", () => {
    const events = [reviewEventFor("a", TODAY), reviewEventFor("b", TODAY)];
    expect(computeReviewedTodayCount(events, NOW)).toBe(0);
  });

  it("昨天学过的词条今天再复习计为今天复习", () => {
    const events = [reviewEventFor("a", YESTERDAY), reviewEventFor("a", TODAY)];
    expect(computeReviewedTodayCount(events, NOW)).toBe(1);
  });

  it("今天新学词条的第二次评分计为复习，学习+复习=今天事件总数", () => {
    const events = [
      reviewEventFor("a", TODAY),
      reviewEventFor("a", "2026-08-13T11:20:00.000Z"),
      reviewEventFor("b", TODAY),
    ];
    expect(computeLearnedTodayCount(events, NOW)).toBe(2);
    expect(computeReviewedTodayCount(events, NOW)).toBe(1);
  });

  it("非今天的复习不计入", () => {
    const events = [reviewEventFor("a", YESTERDAY), reviewEventFor("a", DAY_BEFORE)];
    expect(computeReviewedTodayCount(events, NOW)).toBe(0);
  });

  it("非法基准时刻抛错", () => {
    expect(() => computeReviewedTodayCount([], "not-a-date")).toThrow(RangeError);
  });
});

describe("computeCompletedWordCount（累计已完成词条）", () => {
  it("无记录时为 0", () => {
    expect(computeCompletedWordCount([])).toBe(0);
  });

  it("按 itemId 去重，一个词条多次复习只计一次", () => {
    const events = [
      reviewEventFor("a", YESTERDAY),
      reviewEventFor("a", TODAY),
      reviewEventFor("b", TODAY),
    ];
    expect(computeCompletedWordCount(events)).toBe(2);
  });

  it("时间非法的记录同样计入（记录存在即完成过）", () => {
    const events = [reviewEventFor("a", "not-a-date"), reviewEventFor("b", TODAY)];
    expect(computeCompletedWordCount(events)).toBe(2);
  });
});

describe("classifyReviewOutcome / countReviewOutcomes / countReviewOutcomesByItem（对/错/遗忘）", () => {
  it("rating=again 判为遗忘（即使作答正确也按自评遗忘计）", () => {
    expect(classifyReviewOutcome(reviewEventFor("a", TODAY, "again", true))).toBe("forgotten");
    expect(classifyReviewOutcome(reviewEventFor("a", TODAY, "again", false))).toBe("forgotten");
  });

  it("非 again：按 answerWasCorrect 分对/错", () => {
    expect(classifyReviewOutcome(reviewEventFor("a", TODAY, "hard", true))).toBe("correct");
    expect(classifyReviewOutcome(reviewEventFor("a", TODAY, "good", false))).toBe("wrong");
  });

  it("countReviewOutcomes 全量汇总", () => {
    const events = [
      reviewEventFor("a", TODAY, "again", false),
      reviewEventFor("a", "2026-08-13T11:10:00.000Z", "good", true),
      reviewEventFor("b", TODAY, "hard", false),
    ];
    expect(countReviewOutcomes(events)).toEqual({ correct: 1, wrong: 1, forgotten: 1 });
  });

  it("countReviewOutcomesByItem 按词条分组（遗忘最多的单词的直接数据源）", () => {
    const events = [
      reviewEventFor("a", TODAY, "again", false),
      reviewEventFor("a", "2026-08-13T11:10:00.000Z", "again", false),
      reviewEventFor("b", TODAY, "good", true),
    ];
    const byItem = countReviewOutcomesByItem(events);
    expect(byItem.size).toBe(2);
    expect(byItem.get(toItemId("item_a"))).toEqual({ correct: 0, wrong: 0, forgotten: 2 });
    expect(byItem.get(toItemId("item_b"))).toEqual({ correct: 1, wrong: 0, forgotten: 0 });
  });
});

describe("localDayBounds（本地日历日半开区间，时区无关性质断言）", () => {
  /** 与实现同构的参考值：本地日历分量构造（时区相关，但断言在同一时区下成立） */
  function localMidnightMs(ms: number, offsetDays: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).getTime();
  }

  it("今天：start 为本地 00:00、end 为次日 00:00（半开区间）", () => {
    const bounds = localDayBounds(NOW);
    expect(Date.parse(bounds.start)).toBe(localMidnightMs(Date.parse(NOW), 0));
    expect(Date.parse(bounds.end)).toBe(localMidnightMs(Date.parse(NOW), 1));
  });

  it("offsetDays=1 为明天，且与今天的 end 无缝衔接", () => {
    const today = localDayBounds(NOW);
    const tomorrow = localDayBounds(NOW, 1);
    expect(tomorrow.start).toBe(today.end);
    expect(Date.parse(tomorrow.end)).toBe(localMidnightMs(Date.parse(NOW), 2));
  });

  it("跨月边界正确进位（1 月 31 日的明天是 2 月 1 日）", () => {
    const tomorrow = localDayBounds("2026-01-31T23:30:00.000Z", 1);
    expect(Date.parse(tomorrow.start)).toBe(
      localMidnightMs(Date.parse("2026-01-31T23:30:00.000Z"), 1),
    );
    expect(Date.parse(tomorrow.end)).toBe(
      localMidnightMs(Date.parse("2026-01-31T23:30:00.000Z"), 2),
    );
  });

  it("非法基准时刻抛错", () => {
    expect(() => localDayBounds("not-a-date")).toThrow(RangeError);
  });
});
