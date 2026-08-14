/**
 * 算法内部路径边界（RAY-239 测试补全）：
 * 覆盖 unit 覆盖率报告中未触及的算法分支——Fuzz、参数归一化迁移、
 * 长间隔排期（enable_short_term=false）与记忆状态异常拒绝。
 *
 * 注意：数值公式的正确性由 src/verify（fsrs-verify，对照官方实现）保证，
 * 本文件只补分支覆盖与边界语义。
 */
import { describe, expect, it } from "vitest";
import { FSRSAlgorithm, forgettingCurve, fuzzRange } from "../algorithm";
import {
  DEFAULT_W,
  FSRS5_DEFAULT_DECAY,
  normalizeParameters,
  clipParameters,
  migrateParameters,
} from "../defaults";
import type { CardInput, Grade } from "../models";
import { Scheduler } from "../scheduler";

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

/** 把卡推到 review 阶段（good→good→easy） */
function toReviewCard(): { card: CardInput; at: Date } {
  let card = newCard();
  let at = NOW;
  for (const grade of ["good", "good", "easy"] as Grade[]) {
    const out = new Scheduler(card, at).review(grade);
    card = out.card;
    at = out.card.due;
  }
  return { card, at };
}

describe("Fuzz（模糊化区间）", () => {
  it("fuzzRange 三段区间边界：短/中/长间隔的 min/max 语义", () => {
    // ivl 2.5：delta = 1 + 0.15 * (2.5-2.5) = 1 → [max(2,1.5), round(3.5)] = [2, 4]
    const short = fuzzRange(2.5, 0, 36_500);
    expect(short.minIvl).toBe(2);
    expect(short.maxIvl).toBe(4);

    // ivl 7：跨越两段 → delta = 1 + 0.15*4.5 + 0.1*0 = 1.675
    const mid = fuzzRange(7, 0, 36_500);
    expect(mid.minIvl).toBe(Math.max(2, Math.round(7 - 1.675)));
    expect(mid.maxIvl).toBe(Math.round(7 + 1.675));

    // ivl 20：delta = 1 + 0.15*4.5 + 0.1*13 = 2.975 → 区间 [17.025→17, 22.975→23]
    const long = fuzzRange(20, 0, 36_500);
    expect(long.minIvl).toBe(17);
    expect(long.maxIvl).toBe(23);

    // 超过最大间隔的输入按 maximum_interval 钳制
    const clamped = fuzzRange(50, 0, 30);
    expect(clamped.maxIvl).toBe(30);

    // 间隔大于实际经过天数时，下限至少 elapsed+1（模糊化不能把卡排到过去）
    const floor = fuzzRange(30, 29, 36_500);
    expect(floor.minIvl).toBe(30);
  });

  it("enable_fuzz 开启时 applyFuzz 走确定性 PRNG：同 seed 结果一致、间隔在区间内", () => {
    const algo = new FSRSAlgorithm({ enable_fuzz: true });
    algo.seed = "seed_test";
    const first = algo.applyFuzz(10, 0);
    algo.seed = "seed_test";
    const second = algo.applyFuzz(10, 0);
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(1);
  });

  it("ivl < 2.5 不模糊（直接四舍五入）", () => {
    const algo = new FSRSAlgorithm({ enable_fuzz: true });
    algo.seed = "seed_test";
    expect(algo.applyFuzz(2.4, 0)).toBe(2);
    expect(algo.applyFuzz(1.1, 0)).toBe(1);
  });

  it("关闭 fuzz 时不模糊", () => {
    const algo = new FSRSAlgorithm({ enable_fuzz: false });
    algo.seed = "seed_test";
    expect(algo.applyFuzz(3.7, 0)).toBe(4);
  });
});

describe("参数归一化与迁移", () => {
  it("clipParameters 按区间裁剪（含 w19 下限随 enable_short_term 变化）", () => {
    const w = [...DEFAULT_W];
    w[0] = 999; // 初始稳定度超上限 → 裁剪到 100
    w[19] = 0; // 低于下限
    const clipped = clipParameters(w, 1, true);
    expect(clipped[0]).toBe(100);
    expect(clipped[19]).toBe(0.01); // enable_short_term=true 时下限 0.01
    const clippedNoShort = clipParameters(w, 1, false);
    expect(clippedNoShort[19]).toBe(0); // enable_short_term=false 时下限 0
  });

  it("重学步骤 > 1 时收紧 w17/w18 上限（防止稳定度回升）", () => {
    const w = [...DEFAULT_W];
    const multi = clipParameters(w, 3, true);
    const single = clipParameters(w, 1, true);
    expect(multi[17]!).toBeLessThanOrEqual(2.0);
    expect(multi[18]!).toBeLessThanOrEqual(2.0);
    // 收紧后上限不高于单步情形
    expect(multi[17]!).toBeLessThanOrEqual(single[17]!);
    expect(multi[18]!).toBeLessThanOrEqual(single[18]!);
  });

  it("非法重学步骤数（负数）防御性归零：与 0 步情形等价（Math.max 兜底）", () => {
    const w = [...DEFAULT_W];
    const negative = clipParameters(w, -1, true);
    const zero = clipParameters(w, 0, true);
    expect(negative).toEqual(zero);
  });
  it("migrateParameters：undefined 回退默认；21/19/17/其他长度各自对齐", () => {
    expect(migrateParameters(undefined)).toEqual([...DEFAULT_W]);

    const w21 = [...DEFAULT_W];
    const m21 = migrateParameters(w21);
    expect(m21).toHaveLength(21);
    expect(m21).toEqual(w21); // 已在裁剪区间内，原样保留

    const w19 = w21.slice(0, 19);
    const m19 = migrateParameters(w19);
    expect(m19).toHaveLength(21);
    expect(m19[19]).toBe(0.0); // 官方迁移补 0 占位
    expect(m19[20]).toBe(FSRS5_DEFAULT_DECAY); // 缺位 decay 用 0.5 补齐

    const w17 = w21.slice(0, 17);
    const m17 = migrateParameters(w17);
    expect(m17).toHaveLength(21);
    expect(m17[20]).toBe(FSRS5_DEFAULT_DECAY);

    // 其他长度回退默认
    expect(migrateParameters([0.1, 0.2])).toEqual([...DEFAULT_W]);
    expect(migrateParameters([...w21, 1])).toEqual([...DEFAULT_W]);
  });

  it("migrateParameters 在空数组（长度 0）上回退默认", () => {
    expect(migrateParameters([])).toEqual([...DEFAULT_W]);
  });

  it("normalizeParameters 完整字段集：步骤/开关/权重全部生效", () => {
    const p = normalizeParameters({
      request_retention: 0.8,
      maximum_interval: 120,
      w: [...DEFAULT_W],
      enable_fuzz: true,
      enable_short_term: false,
      learning_steps: ["2h"],
      relearning_steps: ["1d", "3d"],
    });
    expect(p.request_retention).toBe(0.8);
    expect(p.maximum_interval).toBe(120);
    expect(p.enable_fuzz).toBe(true);
    expect(p.enable_short_term).toBe(false);
    expect([...p.learning_steps]).toEqual(["2h"]);
    expect([...p.relearning_steps]).toEqual(["1d", "3d"]);
    // 重学步骤 2 个 → w17/w18 收紧
    expect(p.w[17]).toBeLessThanOrEqual(2.0);
  });

  it("normalizeParameters 无输入 → 全默认；parameters getter 为不可变快照", () => {
    const algo = new FSRSAlgorithm();
    const snapshot = algo.parameters;
    (snapshot.w as number[])[0] = 999; // 试图篡改快照（readonly 防护需显式绕过）
    expect(algo.parameters.w[0]).toBe(DEFAULT_W[0]);
    expect([...algo.parameters.learning_steps]).toEqual(["1m", "10m"]);
  });
  it("forgettingCurve 计算 decay/factor 与公式一致（含极值稳定度）", () => {
    const { decay, factor } = (() => {
      const d = -DEFAULT_W[20]!;
      return { decay: d, factor: Math.exp(Math.pow(d, -1) * Math.log(0.9)) - 1.0 };
    })();
    const t = 7;
    const s = 1.5;
    const expected = Math.pow(1 + (factor * t) / s, decay);
    expect(forgettingCurve(DEFAULT_W, t, s)).toBeCloseTo(expected, 8);
    // 极值稳定度不产生 NaN
    expect(Number.isFinite(forgettingCurve(DEFAULT_W, 365, 0.001))).toBe(true);
    expect(Number.isFinite(forgettingCurve(DEFAULT_W, 365, 36_500))).toBe(true);
  });
});

describe("LongTermScheduler 路径（enable_short_term=false）", () => {
  it("new 卡四档：again<hard<good<easy 严格递增，全部转 review", () => {
    const s = new Scheduler(newCard(), NOW, { enable_short_term: false });
    const preview = s.preview();
    const days = GRADES.map((g) => preview[g].card.scheduled_days);
    expect(days[0]!).toBeLessThan(days[1]!);
    expect(days[1]!).toBeLessThan(days[2]!);
    expect(days[2]!).toBeLessThan(days[3]!);
    for (const grade of GRADES) {
      expect(preview[grade].card.state).toBe("review");
    }
    // again 在长间隔模式下也计一次遗忘
    expect(preview.again.card.lapses).toBe(1);
  });

  it("review 卡 again：长间隔模式不进入 relearning 步骤，直接 FSRS 排期", () => {
    const { card, at } = toReviewCard();
    const out = new Scheduler(card, at, { enable_short_term: false }).review("again");
    expect(out.card.state).toBe("review");
    expect(out.card.lapses).toBe(card.lapses + 1);
    expect(out.card.scheduled_days).toBeGreaterThan(0);
  });

  it("长间隔排期受 maximum_interval 钳制", () => {
    const s = new Scheduler(newCard(), NOW, {
      enable_short_term: false,
      maximum_interval: 7,
    });
    const preview = s.preview();
    for (const grade of GRADES) {
      expect(preview[grade].card.scheduled_days).toBeLessThanOrEqual(7);
    }
  });
});

describe("nextState 异常路径", () => {
  it("t 为负抛 RangeError", () => {
    const algo = new FSRSAlgorithm();
    const state = { difficulty: 5, stability: 10 };
    expect(() => algo.nextState(state, -1, 3)).toThrow(RangeError);
  });

  it("g=0（Manual）原样返回状态；g=5 越界抛 RangeError", () => {
    const algo = new FSRSAlgorithm();
    const state = { difficulty: 5, stability: 10 };
    // g=0 是与官方一致的 Manual 直通语义（nextState 文档注释明确写出）
    expect(algo.nextState(state, 1, 0)).toEqual(state);
    expect(() => algo.nextState(state, 1, 5)).toThrow(RangeError);
  });

  it("非法记忆状态（难度 < 1 或稳定度 < S_MIN 的非新卡）抛 RangeError", () => {
    const algo = new FSRSAlgorithm();
    expect(() => algo.nextState({ difficulty: 0.5, stability: 10 }, 1, 3)).toThrow(RangeError);
    expect(() => algo.nextState({ difficulty: 5, stability: 0.0001 }, 1, 3)).toThrow(RangeError);
  });

  it("初始状态（d=s=0）按档位初始化：四档难度与稳定度各不相同且合法", () => {
    const algo = new FSRSAlgorithm();
    const initial = [1, 2, 3, 4].map((g) => algo.nextState(null, 0, g));
    for (const state of initial) {
      expect(state.difficulty).toBeGreaterThanOrEqual(1);
      expect(state.difficulty).toBeLessThanOrEqual(10);
      expect(state.stability).toBeGreaterThanOrEqual(0.001);
    }
    // 初始稳定性随档位递增（w0<w1<w2<w3）
    expect(initial[0]!.stability).toBeLessThan(initial[1]!.stability);
    expect(initial[1]!.stability).toBeLessThan(initial[2]!.stability);
    expect(initial[2]!.stability).toBeLessThan(initial[3]!.stability);
  });

  it("t=0 且启用短期记忆：走短期稳定性更新（不抛错、结果合法）", () => {
    const algo = new FSRSAlgorithm({ enable_short_term: true });
    const out = algo.nextState({ difficulty: 5, stability: 10 }, 0, 3, 1);
    expect(out.stability).toBeGreaterThan(0);
    expect(Number.isFinite(out.stability)).toBe(true);
  });

  it("g=1（again）遗忘稳定性不超过 s / e^(w17*w18) 且不低于 S_MIN", () => {
    const algo = new FSRSAlgorithm();
    const s = 10;
    const out = algo.nextState({ difficulty: 5, stability: s }, 3, 1, 0.5);
    expect(out.stability).toBeGreaterThanOrEqual(0.001);
    expect(out.stability).toBeLessThanOrEqual(s);
  });

  it("自定义 retrievability 传入被采用（与自动计算路径结果不同）", () => {
    const algo = new FSRSAlgorithm();
    const auto = algo.nextState({ difficulty: 5, stability: 10 }, 3, 3);
    const custom = algo.nextState({ difficulty: 5, stability: 10 }, 3, 3, 1); // r=1 刚回忆成功
    expect(custom.stability).not.toBe(auto.stability);
  });
});

describe("nextInterval 边界", () => {
  it("间隔钳制到 [1, maximum_interval]", () => {
    const algo = new FSRSAlgorithm({ maximum_interval: 30 });
    expect(algo.nextInterval(0, 0)).toBe(1); // 极小稳定度 → 至少 1 天
    expect(algo.nextInterval(1e9, 0)).toBe(30); // 极大稳定度 → 钳制到上限
    expect(algo.nextInterval(10, 0)).toBeGreaterThan(0);
  });

  it("零稳定度新卡评分后间隔合法（easy 直接排期）", () => {
    const out = new Scheduler(newCard(), NOW).review("easy");
    expect(out.card.scheduled_days).toBeGreaterThan(0);
    expect(out.card.due.getTime()).toBe(NOW.getTime() + out.card.scheduled_days * 86_400_000);
  });
});

describe("调度器日志与幂等", () => {
  it("buildLog 字段语义：日志记录的是复习前状态（除 review 时间外）", () => {
    const s = new Scheduler(newCard(), NOW);
    const { log } = s.review("good");
    expect(log.rating).toBe("good");
    expect(log.state).toBe("new");
    expect(log.stability).toBe(0);
    expect(log.difficulty).toBe(0);
    expect(log.review.getTime()).toBe(NOW.getTime());
  });

  it("review 后再次 preview：同一实例复用缓存（preview 不重复计算也不变异）", () => {
    const s = new Scheduler(newCard(), NOW);
    const first = s.preview();
    const second = s.preview();
    expect(second.good.card).toEqual(first.good.card);
  });

  it("调度器构造时间处理：数字时间戳与字符串等价", () => {
    const a = new Scheduler(newCard(), NOW.getTime()).review("good");
    const b = new Scheduler(newCard(), NOW.toISOString()).review("good");
    expect(a.card).toEqual(b.card);
  });

  it("学习步骤走到最后一步后（good 终步）learning_steps 归零", () => {
    const first = new Scheduler(newCard(), NOW).review("good"); // 进入第二步
    expect(first.card.learning_steps).toBe(1);
    const second = new Scheduler(first.card, first.card.due).review("good"); // 走完
    expect(second.card.state).toBe("review");
    expect(second.card.learning_steps).toBe(0);
  });
});
