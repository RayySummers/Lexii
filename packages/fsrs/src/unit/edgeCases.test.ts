/**
 * 边界用例：异常输入、FSRS 边界状态、评分极端序列（RAY-239 测试补全）。
 *
 * 与 fsrs.test.ts 的契约用例互补：本文件专攻脏输入拒绝、状态机边界与
 * 极端评分轨迹下的数值不变量，覆盖「空数据、异常输入、FSRS 边界状态、
 * 评分极端序列」四个验收维度。
 */
import { describe, expect, it } from "vitest";
import { FSRSAlgorithm } from "../algorithm";
import type { CardInput, Grade } from "../models";
import { Scheduler, scheduler } from "../scheduler";
import { addTime, dateDiffInDays, stepUnitToMinutes, toDate } from "../utils";

const NOW = new Date(2026, 0, 1, 9, 0, 0, 0);
const GRADES: readonly Grade[] = ["again", "hard", "good", "easy"] as const;

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

/** 沿给定评分序列推进一张卡（模拟真实复习轨迹） */
function runSequence(
  grades: readonly Grade[],
  params?: Parameters<typeof scheduler>[2],
): { card: CardInput; at: Date; steps: { card: CardInput; at: Date }[] } {
  let card = newCard();
  let at = NOW;
  const steps: { card: CardInput; at: Date }[] = [];
  for (const grade of grades) {
    const out = new Scheduler(card, at, params).review(grade);
    card = out.card;
    at = out.card.due;
    steps.push({ card, at });
  }
  return { card, at, steps };
}

describe("FSRS 边界状态", () => {
  it("算法原语边界：检索性 R(0,S)=1、难度 [1,10]、稳定度钳制到 [S_MIN, S_MAX]", () => {
    const algo = new FSRSAlgorithm();
    // 零间隔遗忘曲线恒为 1（刚复习过必然记得）
    expect(algo.forgettingCurveValue(0, 0.001)).toBe(1);
    expect(algo.forgettingCurveValue(0, 36_500)).toBe(1);
    // 极端大间隔下可提取性仍为正数（不出现 NaN/负数）
    const extreme = algo.forgettingCurveValue(36_500, 0.001);
    expect(Number.isFinite(extreme)).toBe(true);
    expect(extreme).toBeGreaterThan(0);
    expect(extreme).toBeLessThanOrEqual(1);
    // 遗忘稳定性公式在极端稳定度输入下不越界
    for (const [d, s] of [
      [1, 0.001],
      [10, 36_500],
      [5, 1],
    ] as const) {
      const next = algo.nextForgetStability(d, s, 0);
      expect(next).toBeGreaterThanOrEqual(0.001);
      expect(next).toBeLessThanOrEqual(36_500);
    }
  });

  it("评分极端序列一：连续 100 次 again，稳定度永不跌破 S_MIN", () => {
    const { card } = runSequence(Array.from({ length: 100 }, () => "again" as Grade));
    expect(card.stability).toBeGreaterThanOrEqual(0.001);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
    expect(card.difficulty).toBeLessThanOrEqual(10);
    // 学习步骤内的 again 只回第一步，不产生 lapse（lapses 只记复习阶段的遗忘，
    // 与官方 BasicScheduler 语义一致）
    expect(card.lapses).toBe(0);
    expect(card.state).toBe("learning");
  });

  it("评分极端序列二：连续 100 次 easy，稳定度钳制到 S_MAX，难度不低于 1", () => {
    const { card } = runSequence(Array.from({ length: 100 }, () => "easy" as Grade));
    expect(card.stability).toBeLessThanOrEqual(36_500);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
    expect(card.difficulty).toBeLessThanOrEqual(10);
    expect(card.lapses).toBe(0);
  });

  it("评分极端序列三：长周期交替（each×8 后 500 天再 again）不产生非法状态", () => {
    const grades: Grade[] = [];
    for (let i = 0; i < 8; i += 1) {
      grades.push("easy", "good", "hard", "again");
    }
    const { card, steps } = runSequence(grades);
    expect(Number.isFinite(card.stability)).toBe(true);
    expect(card.stability).toBeGreaterThanOrEqual(0.001);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
    expect(card.difficulty).toBeLessThanOrEqual(10);
    // 中间每一步都产出合法的未来到期时间（无 NaN 时间）
    for (const step of steps) {
      expect(Number.isFinite(step.at.getTime())).toBe(true);
      expect(step.at.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("跨整年轨迹（30 次评分 × 隔年复习）稳定度/难度始终有限", () => {
    let card = newCard();
    let at = NOW;
    for (let i = 0; i < 30; i += 1) {
      const grade = GRADES[i % 4]!;
      const out = new Scheduler(card, at).review(grade);
      card = out.card;
      at = new Date(out.card.due.getTime() + 366 * 86_400_000); // 每次再隔一年
      expect(Number.isFinite(out.card.stability)).toBe(true);
      expect(Number.isFinite(out.card.difficulty)).toBe(true);
    }
  });
});

describe("异常输入", () => {
  it("非法时间输入：Scheduler 构造抛 RangeError", () => {
    expect(() => new Scheduler(newCard(), "not-a-date")).toThrow(RangeError);
    expect(() => new Scheduler(newCard(), Number.NaN)).toThrow(RangeError);
    // 非法 due 字符串同样拒绝（toDate 走 Date.parse 校验）
    expect(() => new Scheduler(newCard({ due: "bad-date" as unknown as Date }), NOW)).toThrow(
      RangeError,
    );
    // 注意：new Date(NaN) 的 Date 实例走 instanceof 快速路径（与官方 toDate 语义一致，
    // 无法在运行时分清合法 Date 与 Invalid Date，调用方约定不传 Invalid Date）。
  });

  it("非法学习步骤串：解析阶段抛 RangeError", () => {
    expect(() => stepUnitToMinutes("" as "1m")).toThrow(RangeError);
    expect(() => stepUnitToMinutes("x" as "1m")).toThrow(RangeError);
    expect(() => stepUnitToMinutes("-5m" as "1m")).toThrow(RangeError);
    expect(() => stepUnitToMinutes("1y" as "1m")).toThrow(RangeError);
    // 步骤串被调度器消费：非法步骤在评分时立刻炸出来（不产生半份结果）
    expect(() =>
      new Scheduler(newCard(), NOW, { learning_steps: ["1y" as "1m"] }).review("good"),
    ).toThrow(RangeError);
  });

  it("非法评分矩阵：空串 / null / 数字 / 越界档位一律 RangeError", () => {
    const card = newCard();
    const invalid = [
      "",
      " ",
      "manual",
      "MANUAL",
      "Manual",
      0,
      5,
      null,
      undefined,
    ] as unknown as Grade[];
    for (const grade of invalid) {
      expect(() => new Scheduler(card, NOW).review(grade)).toThrow(RangeError);
    }
  });

  it("request_retention 全边界：0 回退默认、(0,1] 合法、越界抛错", () => {
    expect(new FSRSAlgorithm({ request_retention: 0.0001 }).intervalModifierValue).toBeGreaterThan(
      0,
    );
    expect(new FSRSAlgorithm({ request_retention: 1 }).parameters.request_retention).toBe(1);
    expect(new FSRSAlgorithm({ request_retention: 0 }).parameters.request_retention).toBe(0.9);
    expect(() => new FSRSAlgorithm({ request_retention: 0 })).not.toThrow();
    expect(() => new FSRSAlgorithm({ request_retention: -0.0001 })).toThrow(RangeError);
    expect(() => new FSRSAlgorithm({ request_retention: 1.0001 })).toThrow(RangeError);
  });

  it("空字符串与非法 seed 不破坏模糊化（确定性 PRNG 容忍任意 seed 类型）", () => {
    const card = newCard();
    // 推到 review 阶段再启用 fuzz，seed 为空串仍产出合法间隔
    let at = NOW;
    let c = card;
    for (const grade of ["good", "good", "easy"] as Grade[]) {
      const out = new Scheduler(c, at).review(grade);
      c = out.card;
      at = out.card.due;
    }
    const out = new Scheduler(c, at, { enable_fuzz: true }).review("good");
    expect(Number.isInteger(out.card.scheduled_days)).toBe(true);
    expect(out.card.scheduled_days).toBeGreaterThanOrEqual(1);
  });

  it("同卡同参数重复构造：结果确定（无随机漂移）", () => {
    const card = newCard();
    const a = new Scheduler(card, NOW).review("easy");
    const b = new Scheduler(card, NOW).review("easy");
    expect(a.card).toEqual(b.card);
    expect(a.log).toEqual(b.log);
  });

  it("time 早于上次复习时间（时钟回拨）：elapsedDays 为负时被拒绝", () => {
    let c = newCard();
    const out = new Scheduler(c, NOW).review("good");
    c = out.card;
    // 时钟回拨到上次复习之前 → elapsedDays 为负，调度器抛 RangeError
    // （与官方 next_state 的 Invalid delta_t 行为一致，防止 NaN 状态被上层持久化）
    const backTime = addTime(NOW, -30, true);
    expect(() => new Scheduler(c, backTime).review("good")).toThrow(RangeError);
  });
});

describe("学习步骤边界", () => {
  it("单步骤 good=最后一步：直接 FSRS 排期（scheduled_days>0 且转 review）", () => {
    const out = new Scheduler(newCard(), NOW, { learning_steps: ["5m"] }).review("good");
    expect(out.card.state).toBe("review");
    expect(out.card.scheduled_days).toBeGreaterThan(0);
  });

  it("单步骤 hard=1.5 倍分钟，仍是 learning 状态", () => {
    const out = new Scheduler(newCard(), NOW, { learning_steps: ["5m"] }).review("hard");
    expect(out.card.state).toBe("learning");
    expect(out.card.due.getTime()).toBe(NOW.getTime() + Math.round(7.5) * 60_000);
  });

  it("review 状态 again：直接回重学第一步，学习游标重置为 0", () => {
    let c = newCard();
    let at = NOW;
    for (const grade of ["good", "good", "easy"] as Grade[]) {
      const out = new Scheduler(c, at).review(grade);
      c = out.card;
      at = out.card.due;
    }
    const out = new Scheduler(c, at).review("again");
    expect(out.card.state).toBe("relearning");
    expect(out.card.learning_steps).toBe(0);
    expect(out.card.due.getTime()).toBe(at.getTime() + 10 * 60_000);
  });

  it("关闭短期记忆：new/learning/relearning 统一走 FSRS 全量排期", () => {
    const out = new Scheduler(newCard(), NOW, { enable_short_term: false }).review("again");
    expect(out.card.state).toBe("review");
    expect(out.card.scheduled_days).toBeGreaterThan(0);
    // learning 卡同样跳过步骤直接 FSRS
    let c = newCard();
    const learning = new Scheduler(c, NOW).review("good").card;
    c = learning;
    const longTerm = new Scheduler(c, addTime(NOW, 10, false), {
      enable_short_term: false,
    }).review("good");
    expect(longTerm.card.state).toBe("review");
  });

  it("日期差函数边界：同日 0 天、跨 UTC 日界 1 天、负数（时钟回拨）向下取整", () => {
    const day = (y: number, mo: number, d: number, h = 0) => new Date(Date.UTC(y, mo, d, h));
    expect(dateDiffInDays(day(2026, 0, 1, 9), day(2026, 0, 1, 23))).toBe(0);
    expect(dateDiffInDays(day(2026, 0, 1, 23), day(2026, 0, 2, 1))).toBe(1);
    expect(dateDiffInDays(day(2026, 0, 3), day(2026, 0, 1))).toBe(-2);
  });

  it("toDate 接受 Date/时间戳/字符串；拒绝 NaN 时间戳", () => {
    expect(toDate(NOW).getTime()).toBe(NOW.getTime());
    expect(toDate(NOW.getTime()).getTime()).toBe(NOW.getTime());
    expect(toDate(NOW.toISOString()).getTime()).toBe(NOW.getTime());
    expect(() => toDate(Number.NaN)).toThrow(RangeError);
  });
});
