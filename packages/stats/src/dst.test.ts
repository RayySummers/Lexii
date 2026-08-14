/**
 * 夏令时（DST）专项用例：固定 TZ=America/New_York 验证连击的日历日口径。
 *
 * 口径（docs/domain-model.md / packages/stats README）：
 * - 连击以「本地日历日」计，与 24h 毫秒差无关——DST 回拨日两个本地午夜
 *   相距 25h，拨快日相距 23h，任何毫秒差比较都会出错。
 * - 「今天还没复习不算断」：最近复习在昨天，连击不中断。
 *
 * 评审建议 #1 的回归用例：
 * 2026-11-01（周日）为美国 DST 回拨日；用例不依赖真实时区数据库的 2026
 * 规则（IANA 通常只内置到 2037 年，2026 规则已存在且为现行法规），
 * 若某平台无 2026 规则导致失败，说明该平台时区数据过旧，而非实现错误。
 */
import { afterEach, describe, expect, it } from "vitest";
import { toEventId, toItemId, toSenseId } from "@lexilexi/core";
import type { ReviewEvent, ReviewRating } from "@lexilexi/core";
import {
  computeLearnedTodayCount,
  computeReviewedTodayCount,
  computeStreak,
  computeTotalDays,
  localDayBounds,
} from "./index";

let eventSeq = 0;
function reviewAt(time: string, rating: ReviewRating = "good"): ReviewEvent {
  eventSeq += 1;
  return {
    id: toEventId(`evt_dst_${eventSeq}`),
    type: "review",
    time,
    itemId: toItemId("item_1"),
    senseId: toSenseId("sense_1"),
    exerciseType: "recall",
    rating,
    reviewDurationMs: 2000,
    revealed: false,
    answerWasCorrect: true,
    elapsedDays: 0,
  };
}

const PREVIOUS_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = PREVIOUS_TZ;
});

/**
 * 在指定时区下运行断言体（Node 的 Date 时区逻辑按进程级 TZ 生效）。
 * Windows 上 TZ 环境变量由 Node 原生支持（V8 自 2018 年起读取）。
 */
function withTimezone(timezone: string, body: () => void): void {
  process.env.TZ = timezone;
  body();
}

describe("computeStreak（夏令时口径，TZ=America/New_York）", () => {
  it("回拨日：昨天复习、今天没学，连击为 1（评审建议 #1 回归）", () => {
    withTimezone("America/New_York", () => {
      // 2026-11-01（周日）02:00 美东回拨一小时（EDT → EST，本地日 25h）
      const events = [
        reviewAt("2026-10-31T14:00:00.000Z"), // 本地 10-31 10:00 EDT
      ];
      expect(computeStreak(events, "2026-11-01T17:00:00.000Z")).toBe(1); // 本地 11-01 12:00 EST
    });
  });

  it("回拨日：昨天+今天复习，连击为 2", () => {
    withTimezone("America/New_York", () => {
      const events = [reviewAt("2026-10-31T14:00:00.000Z"), reviewAt("2026-11-01T15:00:00.000Z")];
      expect(computeStreak(events, "2026-11-01T17:00:00.000Z")).toBe(2);
    });
  });

  it("回拨日前多天连击跨越回拨日不中断", () => {
    withTimezone("America/New_York", () => {
      const events = [
        reviewAt("2026-10-29T14:00:00.000Z"),
        reviewAt("2026-10-30T14:00:00.000Z"),
        reviewAt("2026-10-31T14:00:00.000Z"),
        reviewAt("2026-11-01T15:00:00.000Z"),
        reviewAt("2026-11-02T15:00:00.000Z"),
      ];
      expect(computeStreak(events, "2026-11-02T17:00:00.000Z")).toBe(5);
    });
  });

  it("拨快日：昨天复习、今天没学，连击为 1（23h 本地日）", () => {
    withTimezone("America/New_York", () => {
      // 2026-03-08（周日）02:00 美东拨快一小时（EST → EDT，本地日 23h）
      const events = [
        reviewAt("2026-03-07T15:00:00.000Z"), // 本地 03-07 10:00 EST
      ];
      expect(computeStreak(events, "2026-03-08T16:00:00.000Z")).toBe(1); // 本地 03-08 12:00 EDT
    });
  });

  it("普通周对照：昨天复习、今天没学，连击为 1（非 DST 行为一致）", () => {
    withTimezone("America/New_York", () => {
      const events = [reviewAt("2026-08-12T14:00:00.000Z")];
      expect(computeStreak(events, "2026-08-13T16:00:00.000Z")).toBe(1);
    });
  });
});

/** 新增统计函数的夏令时口径：多词条场景（首次复习 = 学习） */
let itemSeq = 0;
function reviewEventForDst(itemKey: string, time: string): ReviewEvent {
  itemSeq += 1;
  return {
    id: toEventId(`evt_dst_item_${itemSeq}`),
    type: "review",
    time,
    itemId: toItemId(`item_${itemKey}`),
    senseId: toSenseId(`sense_${itemKey}`),
    exerciseType: "recall",
    rating: "good",
    reviewDurationMs: 2000,
    revealed: false,
    answerWasCorrect: true,
    elapsedDays: 0,
  };
}

describe("累计天数 / 今日学习 / 今日复习（夏令时口径，TZ=America/New_York）", () => {
  it("回拨日（本地日 25h）：跨日事件与今日事件分开计数", () => {
    withTimezone("America/New_York", () => {
      // 2026-11-01 02:00 美东回拨一小时（EDT → EST）
      const events = [
        reviewEventForDst("a", "2026-10-31T14:00:00.000Z"), // 本地 10-31 10:00 EDT
        reviewEventForDst("a", "2026-11-01T05:30:00.000Z"), // 本地 11-01 01:30 EDT（回拨前）
        reviewEventForDst("b", "2026-11-01T17:00:00.000Z"), // 本地 11-01 12:00 EST
      ];
      const now = "2026-11-01T18:00:00.000Z"; // 本地 11-01 13:00 EST
      expect(computeTotalDays(events, now)).toBe(2);
      // 词条 a 首次复习在 10-31：今天 11-01 的复习不算学习；词条 b 首次复习在今天
      expect(computeLearnedTodayCount(events, now)).toBe(1);
      expect(computeReviewedTodayCount(events, now)).toBe(1);
    });
  });

  it("拨快日（本地日 23h）：凌晨与正午同属一天", () => {
    withTimezone("America/New_York", () => {
      // 2026-03-08 02:00 美东拨快一小时（EST → EDT）
      const events = [
        reviewEventForDst("a", "2026-03-08T06:30:00.000Z"), // 本地 03-08 01:30 EST（拨快前）
        reviewEventForDst("b", "2026-03-08T16:00:00.000Z"), // 本地 03-08 12:00 EDT
      ];
      const now = "2026-03-08T17:00:00.000Z"; // 本地 03-08 13:00 EDT
      expect(computeTotalDays(events, now)).toBe(1);
      expect(computeLearnedTodayCount(events, now)).toBe(2);
      expect(computeReviewedTodayCount(events, now)).toBe(0);
    });
  });

  it("回拨日 localDayBounds：该本地日跨 25h（end − start = 25h）", () => {
    withTimezone("America/New_York", () => {
      const bounds = localDayBounds("2026-11-01T17:00:00.000Z"); // 本地 11-01 12:00 EST
      const spanMs = Date.parse(bounds.end) - Date.parse(bounds.start);
      expect(spanMs).toBe(25 * 3_600_000);
      // 本地 11-01 凌晨（回拨前 EDT 时刻）落在区间内
      const early = Date.parse("2026-11-01T05:30:00.000Z");
      expect(early).toBeGreaterThanOrEqual(Date.parse(bounds.start));
      expect(early).toBeLessThan(Date.parse(bounds.end));
    });
  });
});
