import { describe, expect, it } from "vitest";
import { toEventId, toItemId, toSenseId } from "@lexilexi/core";
import type { ReviewEvent } from "@lexilexi/core";
import { computeStreak, countReviews } from "./index";

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
