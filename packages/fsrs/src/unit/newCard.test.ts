import { describe, expect, it } from "vitest";
import { newCardFields } from "../newCard";
import { Scheduler } from "../scheduler";
import { toDate } from "../utils";

describe("newCardFields（新卡初始状态）", () => {
  it("返回可直接持久化的初始状态（due 为 ISO 字符串）", () => {
    const fields = newCardFields({ now: "2026-08-13T10:00:00.000Z" });
    expect(fields).toEqual({
      status: "new",
      due: "2026-08-13T10:00:00.000Z",
      stabilityDays: 0,
      difficulty: 0,
      elapsedDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReviewAt: null,
      lastRating: null,
    });
  });

  it("now 接受 Date 与毫秒时间戳", () => {
    const date = new Date("2026-08-13T10:00:00.000Z");
    expect(newCardFields({ now: date }).due).toBe("2026-08-13T10:00:00.000Z");
    expect(newCardFields({ now: date.getTime() }).due).toBe("2026-08-13T10:00:00.000Z");
  });

  it("非法时间输入抛错（与 toDate 边界一致）", () => {
    expect(() => newCardFields({ now: "not-a-date" })).toThrow(RangeError);
  });

  it("初始状态与 Scheduler 对接：new + 首次评分四档均可用", () => {
    const fields = newCardFields({ now: "2026-08-13T10:00:00.000Z" });
    const scheduler = new Scheduler(
      {
        due: toDate(fields.due),
        stability: fields.stabilityDays,
        difficulty: fields.difficulty,
        scheduled_days: 0,
        learning_steps: fields.learningSteps,
        reps: fields.reps,
        lapses: fields.lapses,
        state: fields.status,
      },
      new Date("2026-08-13T10:00:00.000Z"),
    );
    const preview = scheduler.preview();
    for (const grade of ["again", "hard", "good", "easy"] as const) {
      const item = preview[grade];
      expect(item.card.reps).toBe(1);
      expect(item.card.difficulty).toBeGreaterThan(0);
      expect(item.card.stability).toBeGreaterThan(0);
    }
  });
});
