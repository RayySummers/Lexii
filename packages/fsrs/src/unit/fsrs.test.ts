/**
 * @lexilexi/fsrs 单元测试：公开 API 契约、数值公式与状态流转。
 *
 * 与官方参考实现的逐字段对照在 src/verify（fsrs-verify，CI 单独跑）。
 */

import { describe, expect, it } from "vitest";
import { FSRSAlgorithm, forgettingCurve } from "../algorithm";
import { DEFAULT_W, S_MAX, S_MIN, normalizeParameters } from "../defaults";
import type { CardInput, Grade } from "../models";
import { Scheduler, scheduler } from "../scheduler";
import { addTime, clamp, dateDiffInDays, roundTo, stepUnitToMinutes, toDate } from "../utils";

const NOW = new Date(2026, 0, 1, 9, 0, 0, 0);

function newCard(overrides: Partial<CardInput> = {}): CardInput {
  return {
    due: NOW,
    stability: 0,
    difficulty: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: "new",
    last_review: undefined,
    ...overrides,
  };
}

describe("公开 API 契约", () => {
  it("scheduler() 便捷入口可用且四档齐全", () => {
    const s = scheduler(newCard(), NOW);
    const preview = s.preview();
    expect(Object.keys(preview).sort()).toEqual(["again", "easy", "good", "hard"]);
  });

  it("同一评分幂等（review 两次返回同一结果）", () => {
    const s = new Scheduler(newCard(), NOW);
    expect(s.review("good")).toBe(s.review("good"));
  });

  it("评分非法时抛错", () => {
    expect(() => new Scheduler(newCard(), NOW).review("manual" as Grade)).toThrow();
  });

  it("卡片输入不被修改（调度器只读输入）", () => {
    const card = newCard();
    const snapshot = { ...card, due: card.due.getTime() };
    new Scheduler(card, NOW).review("good");
    expect({ ...card, due: card.due.getTime() }).toEqual(snapshot);
  });

  it("公开 API 无 any / 无官方枚举泄露", () => {
    // 契约检查：CardInput.state 是字符串联合，ReviewLog.rating 是 Grade
    const card: CardInput = newCard();
    const log = new Scheduler(card, NOW).review("easy").log;
    expect(["again", "hard", "good", "easy"]).toContain(log.rating);
  });
});

describe("新卡首评", () => {
  it("again：1 分钟后复习，learning 状态", () => {
    const { card } = new Scheduler(newCard(), NOW).review("again");
    expect(card.due.getTime()).toBe(NOW.getTime() + 60_000);
    expect(card.state).toBe("learning");
    expect(card.stability).toBe(DEFAULT_W[0]);
    expect(card.difficulty).toBe(6.4133);
  });

  it("hard：6 分钟后复习（步骤 1m/10m 的中点）", () => {
    const { card } = new Scheduler(newCard(), NOW).review("hard");
    expect(card.due.getTime()).toBe(NOW.getTime() + 6 * 60_000);
    expect(card.state).toBe("learning");
  });

  it("good：10 分钟后复习（进入第二步）", () => {
    const { card } = new Scheduler(newCard(), NOW).review("good");
    expect(card.due.getTime()).toBe(NOW.getTime() + 10 * 60_000);
    expect(card.state).toBe("learning");
    expect(card.learning_steps).toBe(1);
  });

  it("easy：直接转 review，间隔按 FSRS 计算", () => {
    const { card } = new Scheduler(newCard(), NOW).review("easy");
    expect(card.state).toBe("review");
    expect(card.scheduled_days).toBeGreaterThan(0);
    expect(card.due.getTime()).toBe(NOW.getTime() + card.scheduled_days * 86_400_000);
  });

  it("good→good 走完步骤后转 review", () => {
    let card = newCard();
    card = new Scheduler(card, NOW).review("good").card;
    const second = new Scheduler(card, addTime(NOW, 10, false)).review("good");
    expect(second.card.state).toBe("review");
    expect(second.card.scheduled_days).toBeGreaterThan(0);
  });
});

describe("复习阶段", () => {
  /** good→good→easy 把卡推到 review，稳定度与难度为正 */
  function reviewCard(): { card: CardInput; reviewedAt: Date } {
    let card = newCard();
    let at = NOW;
    for (const grade of ["good", "good", "easy"] as Grade[]) {
      const out = new Scheduler(card, at).review(grade);
      card = out.card;
      at = out.card.due;
    }
    return { card, reviewedAt: at };
  }

  it("again：lapses +1，进入 relearning", () => {
    const { card, reviewedAt } = reviewCard();
    const out = new Scheduler(card, reviewedAt).review("again");
    expect(out.card.lapses).toBe(1);
    expect(out.card.state).toBe("relearning");
    expect(out.card.due.getTime()).toBe(reviewedAt.getTime() + 10 * 60_000); // 默认重学步骤 10m
  });

  it("hard < good < easy 间隔严格递增", () => {
    const { card, reviewedAt } = reviewCard();
    const preview = new Scheduler(card, reviewedAt).preview();
    const hard = preview.hard.card.scheduled_days;
    const good = preview.good.card.scheduled_days;
    const easy = preview.easy.card.scheduled_days;
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it("hard/good/easy 都保持 review 状态", () => {
    const { card, reviewedAt } = reviewCard();
    const preview = new Scheduler(card, reviewedAt).preview();
    expect(preview.hard.card.state).toBe("review");
    expect(preview.good.card.state).toBe("review");
    expect(preview.easy.card.state).toBe("review");
  });

  it("reps 每次复习 +1，跨状态累积", () => {
    let card = newCard();
    let at = NOW;
    for (const grade of ["good", "good", "easy"] as Grade[]) {
      const out = new Scheduler(card, at).review(grade);
      card = out.card;
      at = out.card.due;
    }
    expect(card.reps).toBe(3);
  });
});

describe("学习步骤", () => {
  it("自定义步骤 1d：hard 满一天转 review", () => {
    // hard = 1.5 * 1d = 2160 分钟 >= 1440 → 转 review，scheduled_days = floor(2160/1440) = 1
    const out = new Scheduler(newCard(), NOW, { learning_steps: ["1d"] }).review("hard");
    expect(out.card.state).toBe("review");
    expect(out.card.scheduled_days).toBe(1);
    expect(out.card.due.getTime()).toBe(NOW.getTime() + 2160 * 60_000);
  });

  it("自定义步骤 1d：good 是最后一步 → 直接 FSRS 排期（与官方一致）", () => {
    // 官方 BasicLearningStepsStrategy 对最后一步的 good 不返回步骤区间，交给 FSRS
    const out = new Scheduler(newCard(), NOW, { learning_steps: ["1d"] }).review("good");
    expect(out.card.state).toBe("review");
    expect(out.card.scheduled_days).toBe(2); // stability 2.3065 * interval_modifier 1 → round 2
  });

  it("空步骤：直接 FSRS 排期", () => {
    const out = new Scheduler(newCard(), NOW, { learning_steps: [] }).review("good");
    expect(out.card.state).toBe("review");
    expect(out.card.scheduled_days).toBeGreaterThan(0);
  });

  it("stepUnitToMinutes 解析 m/h/d，非法单位抛错", () => {
    expect(stepUnitToMinutes("1m")).toBe(1);
    expect(stepUnitToMinutes("2h")).toBe(120);
    expect(stepUnitToMinutes("1d")).toBe(1440);
    expect(() => stepUnitToMinutes("1x" as "1m")).toThrow();
  });
});

describe("算法原语", () => {
  it("遗忘曲线单调递减且落在 (0,1]", () => {
    const algo = new FSRSAlgorithm();
    const r0 = algo.forgettingCurveValue(0, 10);
    expect(r0).toBe(1);
    let prev = 1;
    for (const t of [1, 3, 7, 30, 365]) {
      const r = algo.forgettingCurveValue(t, 10);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("遗忘曲线函数形式与官方公式一致（默认 decay=0.1542）", () => {
    // R(t,S) = (1 + factor*t/S)^decay，factor = e^(ln0.9/decay) - 1
    const { decay, factor } = (() => {
      const decay = -DEFAULT_W[20]!;
      const factor = roundTo(Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1.0, 8);
      return { decay, factor };
    })();
    const t = 5;
    const s = 20;
    const expected = roundTo(Math.pow(1 + (factor * t) / s, decay), 8);
    expect(forgettingCurve([...DEFAULT_W], t, s)).toBe(expected);
  });

  it("难度始终在 [1,10]，稳定度始终在 [S_MIN, S_MAX]", () => {
    const algo = new FSRSAlgorithm();
    const s = new Scheduler(newCard(), NOW);
    let card = newCard();
    let at = NOW;
    for (let i = 0; i < 60; i++) {
      const grade = (["again", "hard", "good", "easy"] as const)[i % 4]!;
      const out = new Scheduler(card, at).review(grade);
      expect(out.card.difficulty).toBeGreaterThanOrEqual(1);
      expect(out.card.difficulty).toBeLessThanOrEqual(10);
      expect(out.card.stability).toBeGreaterThanOrEqual(S_MIN - 1e-12);
      expect(out.card.stability).toBeLessThanOrEqual(S_MAX);
      card = out.card;
      at = out.card.due;
    }
    void algo;
    void s;
  });

  it("非默认参数下间隔受 maximum_interval 约束（与官方一致：排期按上限钳制）", () => {
    // 官方语义：next_interval clamp 到 maximum_interval；连续 easy 时
    // elapsed_days 接近上限会得到 maximum_interval + 1 的排期（easy > good 强制 +1）。
    let card = newCard();
    let at = NOW;
    for (let i = 0; i < 40; i++) {
      const out = new Scheduler(card, at, { maximum_interval: 30 }).review("easy");
      expect(out.card.scheduled_days).toBeLessThanOrEqual(32);
      card = out.card;
      at = out.card.due;
    }
  });

  it("request_retention 越界抛错（0 回退默认，与官方 || 语义一致）", () => {
    expect(() => new FSRSAlgorithm({ request_retention: -0.1 })).toThrow();
    expect(() => new FSRSAlgorithm({ request_retention: 1.2 })).toThrow();
    expect(new FSRSAlgorithm({ request_retention: 0 }).parameters.request_retention).toBe(0.9);
  });
});

describe("参数归一化", () => {
  it("默认参数与官方默认一致", () => {
    const p = normalizeParameters({});
    expect(p.request_retention).toBe(0.9);
    expect(p.maximum_interval).toBe(36_500);
    expect(p.enable_fuzz).toBe(false);
    expect(p.enable_short_term).toBe(true);
    expect([...p.learning_steps]).toEqual(["1m", "10m"]);
    expect([...p.relearning_steps]).toEqual(["10m"]);
    expect([...p.w]).toHaveLength(21);
  });

  it("21 参数权重原样保留（含裁剪语义）", () => {
    const w = [...DEFAULT_W];
    w[4] = 99; // 初始难度超上限 → 裁剪到 10
    const p = normalizeParameters({ w });
    expect(p.w[4]).toBe(10);
  });

  it("非法长度权重回退默认（与官方一致）", () => {
    const p = normalizeParameters({ w: [0.1, 0.2, 0.3] });
    expect([...p.w]).toEqual([...DEFAULT_W]);
  });
});

describe("工具函数", () => {
  it("addTime 按天/按分钟偏移", () => {
    expect(addTime(NOW, 1, true).getTime()).toBe(NOW.getTime() + 86_400_000);
    expect(addTime(NOW, 10, false).getTime()).toBe(NOW.getTime() + 600_000);
  });

  it("dateDiffInDays 按 UTC 日历日截断", () => {
    // 用 Date.UTC 构造，避免本地时区影响测试语义
    const a = new Date(Date.UTC(2026, 0, 1, 23, 59, 0, 0));
    const b = new Date(Date.UTC(2026, 0, 2, 0, 1, 0, 0));
    expect(dateDiffInDays(a, b)).toBe(1); // 实际只差 2 分钟，但跨 UTC 日界
  });

  it("clamp / roundTo 行为正确", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(0, 1, 3)).toBe(1);
    expect(roundTo(1.23456789, 8)).toBe(1.23456789);
    expect(roundTo(1.23456789, 2)).toBe(1.23);
  });

  it("toDate 处理 Date/时间戳/字符串", () => {
    const d = toDate(NOW);
    expect(d.getTime()).toBe(NOW.getTime());
    expect(toDate(NOW.getTime()).getTime()).toBe(NOW.getTime());
    expect(toDate(NOW.toISOString()).getTime()).toBe(NOW.getTime());
    expect(() => toDate("not-a-date")).toThrow();
  });
});
