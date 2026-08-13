import { newCardFields } from "@lexilexi/fsrs";
import { toItemId } from "@lexilexi/core";
import { describe, expect, it } from "vitest";
import {
  formatDueLabel,
  memoryFieldsToCardInput,
  previewGradeDueLabels,
  ratingFromKey,
} from "./grade";
import { makeMemory } from "./testFixtures";

const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("memoryFieldsToCardInput", () => {
  it("按 domain-model §6 换算：字段直映射、时间转 Date、scheduled_days 恒为 0", () => {
    const memory = makeMemory(toItemId("item_x"), {
      due: "2026-08-10T12:00:00.000Z",
      stabilityDays: 3.5,
      difficulty: 6,
      reps: 4,
      lapses: 1,
      status: "review",
      lastReviewAt: "2026-08-07T12:00:00.000Z",
      lastRating: "good",
      learningSteps: 2,
      elapsedDays: 3,
    });

    expect(memoryFieldsToCardInput(memory.fields)).toEqual({
      due: new Date("2026-08-10T12:00:00.000Z"),
      stability: 3.5,
      difficulty: 6,
      scheduled_days: 0,
      learning_steps: 2,
      reps: 4,
      lapses: 1,
      state: "review",
      last_review: new Date("2026-08-07T12:00:00.000Z"),
    });
  });

  it("旧版记录缺 learningSteps 时兜底为 0，lastReviewAt 为 null 时不传 last_review", () => {
    const memory = makeMemory(toItemId("item_x"), {
      learningSteps: undefined,
      lastReviewAt: null,
    });

    const input = memoryFieldsToCardInput(memory.fields);
    expect(input.learning_steps).toBe(0);
    expect(input.last_review).toBeUndefined();
  });
});

describe("previewGradeDueLabels", () => {
  it("新卡：again 回到第一步（1m），good 走第二步（10m），easy 直接转复习", () => {
    const fields = newCardFields({ now: NOW });
    const labels = previewGradeDueLabels(fields, NOW);
    const againMs = Date.parse(labels.again) - NOW.getTime();
    const goodMs = Date.parse(labels.good) - NOW.getTime();
    const easyMs = Date.parse(labels.easy) - NOW.getTime();

    expect(againMs).toBeGreaterThan(0);
    expect(againMs).toBeLessThanOrEqual(60_000 + 1_000); // ~1 分钟
    expect(goodMs).toBeGreaterThan(againMs);
    expect(goodMs).toBeLessThanOrEqual(10 * 60_000 + 1_000); // ~10 分钟
    expect(easyMs).toBeGreaterThan(24 * 60 * 60_000); // 复习间隔 > 1 天
  });

  it("复习卡：again < hard < good < easy 且 again 进入重学步骤（10m 内）", () => {
    const memory = makeMemory(toItemId("item_x"), {
      due: "2026-08-01T00:00:00.000Z",
      status: "review",
      stabilityDays: 5,
      difficulty: 4,
      reps: 2,
      lapses: 0,
      lastReviewAt: "2026-07-25T00:00:00.000Z",
      lastRating: "good",
      learningSteps: 0,
    });
    const labels = previewGradeDueLabels(memory.fields, NOW);
    const againMs = Date.parse(labels.again) - NOW.getTime();
    const hardMs = Date.parse(labels.hard) - NOW.getTime();
    const goodMs = Date.parse(labels.good) - NOW.getTime();
    const easyMs = Date.parse(labels.easy) - NOW.getTime();

    expect(againMs).toBeGreaterThan(0);
    expect(againMs).toBeLessThanOrEqual(10 * 60_000 + 1_000); // relearning 第一步 10m
    expect(hardMs).toBeGreaterThan(againMs);
    expect(goodMs).toBeGreaterThan(hardMs);
    expect(easyMs).toBeGreaterThan(goodMs);
  });
});

describe("formatDueLabel", () => {
  const cases: [string, string][] = [
    ["2026-08-09T12:00:00.000Z", "现在"], // 过去
    ["2026-08-10T12:00:30.000Z", "<1分钟"], // 30 秒
    ["2026-08-10T12:05:00.000Z", "5分钟"],
    ["2026-08-10T13:00:00.000Z", "1小时"], // 60 分钟
    ["2026-08-11T10:00:00.000Z", "22小时"],
    ["2026-08-11T12:00:00.000Z", "1天"],
    ["2026-08-20T12:00:00.000Z", "10天"],
    ["2026-09-09T12:00:00.000Z", "1个月"], // 30 天
    ["2027-08-10T12:00:00.000Z", "1年"],
    ["not-a-date", "现在"], // 非法时间防御
  ];

  it.each(cases)("due=%s → %s", (due, expected) => {
    expect(formatDueLabel(due, NOW)).toBe(expected);
  });
});

describe("ratingFromKey", () => {
  it("数字键 1-4 映射四档", () => {
    expect(ratingFromKey("1")).toBe("again");
    expect(ratingFromKey("2")).toBe("hard");
    expect(ratingFromKey("3")).toBe("good");
    expect(ratingFromKey("4")).toBe("easy");
  });

  it("字母别名 a/h/g/e 不区分大小写", () => {
    expect(ratingFromKey("a")).toBe("again");
    expect(ratingFromKey("H")).toBe("hard");
    expect(ratingFromKey("g")).toBe("good");
    expect(ratingFromKey("E")).toBe("easy");
  });

  it("无关按键返回 null", () => {
    expect(ratingFromKey(" ")).toBeNull();
    expect(ratingFromKey("Enter")).toBeNull();
    expect(ratingFromKey("5")).toBeNull();
  });
});
