/**
 * fsrs-verify — 对照官方参考实现（ts-fsrs v5.4.1，FSRS-6.0 主分支）的差分验证。
 *
 * 验收红线：同一张卡片、同一时刻、同一评分序列，我们的输出必须与官方
 * 参考实现逐字段一致（浮点按官方 roundTo(8) 语义逐位比较）。
 *
 * 覆盖：默认参数 + 自定义参数（含 fuzz/空步骤/单步骤/多步重学）下，
 * 由固定 seed 生成的随机复习轨迹（含跨时区日期）与边界路径。
 * 本套用例在 CI 中单独运行（fsrs-verify job）。
 */

import { describe, expect, it } from "vitest";
import {
  createEmptyCard,
  fsrs as refFsrs,
  generatorParameters as refGeneratorParameters,
  type Card as RefCard,
  type Grade as RefGrade,
  type ReviewLog as RefReviewLog,
} from "ts-fsrs";
import { FSRSAlgorithm, forgettingCurve } from "../algorithm";
import {
  DEFAULT_LEARNING_STEPS,
  DEFAULT_RELEARNING_STEPS,
  DEFAULT_W,
  normalizeParameters,
} from "../defaults";
import type { Card, CardInput, Grade, FSRSParameters, ReviewLog } from "../models";
import { Scheduler } from "../scheduler";
import { roundTo } from "../utils";
import { GRADE_FROM_REF, GRADE_TO_REF, STATE_FROM_REF, emptyCard, paramsToRef } from "./bridge";

/** 固定 seed 的确定性 PRNG（不依赖 Math.random，保证失败可复现） */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const GRADES: Grade[] = ["again", "hard", "good", "easy"];
const DAY = 24 * 60 * 60 * 1000;

interface RunCase {
  name: string;
  params?: Partial<FSRSParameters>;
  grades: Grade[];
}

function randomGradeList(n: number, rng: () => number): Grade[] {
  return Array.from({ length: n }, () => GRADES[Math.floor(rng() * 4)]!);
}

function makeCases(): RunCase[] {
  const rng = makeRng(20260813);
  return [
    { name: "默认参数", grades: ["again", "hard", "good", "easy"] },
    { name: "默认参数-全 Good 长链", grades: Array.from({ length: 12 }, () => "good" as Grade) },
    { name: "默认参数-随机 30 次", grades: randomGradeList(30, rng) },
    { name: "全 Again 打回", grades: ["good", "again", "again", "again", "good", "again"] },
    {
      name: "关闭短期记忆",
      params: { enable_short_term: false },
      grades: randomGradeList(20, rng),
    },
    {
      name: "空学习步骤",
      params: { learning_steps: [], relearning_steps: [] },
      grades: randomGradeList(20, rng),
    },
    {
      name: "单步骤学习",
      params: { learning_steps: ["5m"], relearning_steps: ["2h"] },
      grades: ["again", "hard", "good", "again", "hard", "good", "easy", "again"],
    },
    {
      name: "多步重学(触发 w17/w18 收紧)",
      params: { relearning_steps: ["1m", "10m", "1d"] },
      grades: ["good", "again", "again", "again", "again", "good"],
    },
    {
      name: "自定义权重-21 参数",
      params: {
        w: [
          0.44, 1.6, 2.8, 9.1, 7.0, 0.9, 3.5, 0.05, 1.9, 0.2, 0.85, 1.6, 0.07, 0.3, 1.75, 0.7, 2.1,
          0.6, 0.11, 0.08, 0.2,
        ],
        request_retention: 0.85,
        maximum_interval: 1800,
      },
      grades: randomGradeList(20, rng),
    },
    {
      name: "自定义权重-19 参数(v5 迁移)",
      params: {
        w: [
          0.44, 1.6, 2.8, 9.1, 7.0, 0.9, 3.5, 0.05, 1.9, 0.2, 0.85, 1.6, 0.07, 0.3, 1.75, 0.7, 2.1,
          0.6, 0.11,
        ],
      },
      grades: randomGradeList(20, rng),
    },
    {
      name: "自定义权重-17 参数(v4 迁移)",
      params: {
        w: [
          0.44, 1.6, 2.8, 9.1, 7.0, 0.9, 3.5, 0.05, 1.9, 0.2, 0.85, 1.6, 0.07, 0.3, 1.75, 0.7, 2.1,
        ],
      },
      grades: randomGradeList(20, rng),
    },
    {
      name: "启用模糊化",
      params: { enable_fuzz: true },
      grades: randomGradeList(40, rng),
    },
    {
      name: "模糊化+自定义权重",
      params: {
        enable_fuzz: true,
        w: [
          0.5, 1.7, 3.0, 9.5, 7.2, 0.95, 3.6, 0.06, 2.0, 0.22, 0.9, 1.7, 0.08, 0.32, 1.8, 0.72, 2.2,
          0.62, 0.12, 0.09, 0.25,
        ],
      },
      grades: randomGradeList(40, rng),
    },
  ];
}

const RUN_CASES = makeCases();

/** 复习时刻序列：新卡首评 + 跨时区/跨月的确定性偏移（严格递增，对齐官方 elapsed 取整语义） */
function reviewTimes(count: number): Date[] {
  const base = new Date(2026, 1, 3, 15, 30, 0, 0).getTime();
  const offsets = [
    1 * 60_000,
    6 * 60_000,
    10 * 60_000,
    24 * 60_000,
    2 * DAY + 3 * 60_000,
    4 * DAY,
    8 * DAY + 12 * 60_000,
    15 * DAY,
    30 * DAY,
    61 * DAY,
    120 * DAY,
    200 * DAY,
    366 * DAY,
  ];
  const times: Date[] = [new Date(base)];
  for (let i = 1; i < count; i++) {
    const prev = times[i - 1]!.getTime();
    times.push(new Date(prev + offsets[(i - 1) % offsets.length]!));
  }
  return times;
}

describe("fsrs-verify: 复习轨迹对照官方参考实现", () => {
  for (const runCase of RUN_CASES) {
    it(runCase.name, () => {
      const refF = refFsrs(paramsToRef(runCase.params));
      const times = reviewTimes(runCase.grades.length);

      let oursCard: CardInput = emptyCard(times[0]!);
      let refCard = createEmptyCard(times[0]!);

      runCase.grades.forEach((grade, i) => {
        const now = times[i]!;
        const ours = new Scheduler(oursCard, now, runCase.params).review(grade);
        const ref = refF.next(refCard, now, GRADE_TO_REF[grade]);

        expectRefLogMatches(ours.log, ref.log);
        expectRefCardMatches(ours.card, ref.card);

        oursCard = ours.card;
        refCard = ref.card;
      });
    });
  }
});

describe("fsrs-verify: 同一时刻四档预览对照", () => {
  RUN_CASES.slice(0, 6).forEach((runCase, caseIndex) => {
    it(`${runCase.name} / 随机起点卡片`, () => {
      const rng = makeRng(987654321 + caseIndex);
      const dates = randomDates(rng, 5);
      const refF = refFsrs(paramsToRef(runCase.params));
      const start = dates[0]!;
      let oursCard: CardInput = emptyCard(start);
      let refCard = createEmptyCard(start);
      // 先用同一轨迹把卡片推到 review 阶段
      for (const grade of ["good", "good", "easy"] as Grade[]) {
        oursCard = new Scheduler(oursCard, start, runCase.params).review(grade).card;
        refCard = refF.next(refCard, start, GRADE_TO_REF[grade]).card;
      }
      const later = dates[4]!;
      const ours = new Scheduler(oursCard, later, runCase.params).preview();
      const ref = refF.repeat(refCard, later);
      for (const grade of GRADES) {
        expectRefLogMatches(ours[grade].log, ref[GRADE_TO_REF[grade]].log);
        expectRefCardMatches(ours[grade].card, ref[GRADE_TO_REF[grade]].card);
      }
    });
  });
});

describe("fsrs-verify: 算法原语对照", () => {
  it("参数归一化与官方 generatorParameters 一致（默认）", () => {
    const ref = refGeneratorParameters({});
    const ours = normalizeParameters({});
    expect(ours.request_retention).toBe(ref.request_retention);
    expect(ours.maximum_interval).toBe(ref.maximum_interval);
    expect([...ours.w]).toEqual([...ref.w]);
    expect(ours.enable_fuzz).toBe(ref.enable_fuzz);
    expect(ours.enable_short_term).toBe(ref.enable_short_term);
    expect([...ours.learning_steps]).toEqual([...ref.learning_steps]);
    expect([...ours.relearning_steps]).toEqual([...ref.relearning_steps]);
  });

  it("参数归一化（0 值字段走官方 || 语义）与官方一致", () => {
    const w21 = [
      0.44, 1.6, 2.8, 9.1, 7.0, 0.9, 3.5, 0.05, 1.9, 0.2, 0.85, 1.6, 0.07, 0.3, 1.75, 0.7, 2.1, 0.6,
      0.11, 0.08, 0.2,
    ];
    const ref = refGeneratorParameters({ w: w21, maximum_interval: 0, request_retention: 0 });
    const ours = normalizeParameters({ w: w21, maximum_interval: 0, request_retention: 0 });
    expect(ours.maximum_interval).toBe(ref.maximum_interval);
    expect(ours.request_retention).toBe(ref.request_retention);
    expect([...ours.w]).toEqual([...ref.w]);
  });

  it("17/19 参数迁移与官方一致", () => {
    const w17 = [
      0.44, 1.6, 2.8, 9.1, 7.0, 0.9, 3.5, 0.05, 1.9, 0.2, 0.85, 1.6, 0.07, 0.3, 1.75, 0.7, 2.1,
    ];
    const w19 = [
      0.44, 1.6, 2.8, 9.1, 7.0, 0.9, 3.5, 0.05, 1.9, 0.2, 0.85, 1.6, 0.07, 0.3, 1.75, 0.7, 2.1, 0.6,
      0.11,
    ];
    for (const w of [w17, w19]) {
      const ref = refGeneratorParameters({ w });
      const ours = normalizeParameters({ w });
      expect([...ours.w]).toEqual([...ref.w]);
    }
  });

  it("默认权重与官方一致", () => {
    const ref = refGeneratorParameters({});
    expect([...DEFAULT_W]).toEqual([...ref.w]);
  });

  it("默认学习/重学步骤与官方一致", () => {
    const ref = refGeneratorParameters({});
    expect([...DEFAULT_LEARNING_STEPS]).toEqual([...ref.learning_steps]);
    expect([...DEFAULT_RELEARNING_STEPS]).toEqual([...ref.relearning_steps]);
  });

  it("遗忘曲线与官方一致（随机 stability/elapsed）", () => {
    const rng = makeRng(424242);
    const refW = [...refGeneratorParameters({}).w];
    for (let i = 0; i < 200; i++) {
      const stability = 0.1 + rng() * 10_000;
      const elapsed = rng() * 365;
      expect(forgettingCurve([...DEFAULT_W], elapsed, stability)).toBe(
        refForgettingCurve(refW, elapsed, stability),
      );
    }
  });

  it("间隔修正系数与官方一致", () => {
    for (const rr of [0.7, 0.8, 0.9, 0.95, 1.0]) {
      const refF = refFsrs({ request_retention: rr });
      const oursAlgo = new FSRSAlgorithm({ request_retention: rr });
      expect(oursAlgo.intervalModifierValue).toBe(refF.interval_modifier);
    }
  });

  it("非法 request_retention 与官方一致被拒绝（0 走 || 语义回退默认）", () => {
    // 官方 generatorParameters 用 `||` 兜底：0 回退 0.9；负值/大于 1 抛错
    for (const rr of [-0.5, 1.5]) {
      expect(() => refFsrs({ request_retention: rr })).toThrow();
      expect(() => new FSRSAlgorithm({ request_retention: rr })).toThrow();
    }
    expect(refFsrs({ request_retention: 0 }).parameters.request_retention).toBe(0.9);
    expect(new FSRSAlgorithm({ request_retention: 0 }).parameters.request_retention).toBe(0.9);
  });

  it("非法评分（Manual/越界）与官方一致被拒绝", () => {
    const now = new Date(2026, 0, 1, 9, 0, 0, 0);
    const refF = refFsrs({});
    const refCard = createEmptyCard(now);
    const oursCard = emptyCard(now);
    expect(() => refF.next(refCard, now, 0 as RefGrade)).toThrow();
    expect(() => refF.next(refCard, now, 5 as RefGrade)).toThrow();
    expect(() => new Scheduler(oursCard, now).review("manual" as Grade)).toThrow();
  });
});

/** 官方遗忘曲线（内联实现，与官方 algorithm.ts 一致） */
function refForgettingCurve(parameters: number[], elapsedDays: number, stability: number): number {
  const decay = -parameters[20]!;
  const factor = roundTo(Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1.0, 8);
  return roundTo(Math.pow(1 + (factor * elapsedDays) / stability, decay), 8);
}

/** 确定性日期序列（跨年/跨月/跨时区） */
function randomDates(rng: () => number, count: number): Date[] {
  const out: Date[] = [];
  let t = new Date(2025, 5, 15, 8, 0, 0, 0).getTime();
  for (let i = 0; i < count; i++) {
    out.push(new Date(t));
    t += Math.floor(rng() * 90 * DAY) + 10 * 60_000;
  }
  return out;
}

/** 逐字段比对复习日志 */
function expectRefLogMatches(oursLog: ReviewLog, refLog: RefReviewLog): void {
  expect(oursLog.rating).toBe(GRADE_FROM_REF[refLog.rating]);
  expect(oursLog.state).toBe(STATE_FROM_REF[refLog.state]);
  expect(oursLog.due.getTime()).toBe(refLog.due.getTime());
  expect(oursLog.stability).toBe(refLog.stability);
  expect(oursLog.difficulty).toBe(refLog.difficulty);
  expect(oursLog.scheduled_days).toBe(refLog.scheduled_days);
  expect(oursLog.learning_steps).toBe(refLog.learning_steps);
  expect(oursLog.review.getTime()).toBe(refLog.review.getTime());
}

/** 逐字段比对卡片 */
function expectRefCardMatches(oursCard: Card, refCard: RefCard): void {
  expect(oursCard.due.getTime()).toBe(refCard.due.getTime());
  expect(oursCard.stability).toBe(refCard.stability);
  expect(oursCard.difficulty).toBe(refCard.difficulty);
  expect(oursCard.scheduled_days).toBe(refCard.scheduled_days);
  expect(oursCard.learning_steps).toBe(refCard.learning_steps);
  expect(oursCard.reps).toBe(refCard.reps);
  expect(oursCard.lapses).toBe(refCard.lapses);
  expect(oursCard.state).toBe(STATE_FROM_REF[refCard.state]);
  expect(oursCard.last_review?.getTime()).toBe(refCard.last_review?.getTime());
}
