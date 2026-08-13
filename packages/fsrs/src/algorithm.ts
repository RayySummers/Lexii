/**
 * FSRS-7 核心算法：遗忘曲线、初始值、稳定性/难度更新、间隔计算与模糊化。
 *
 * 公式与官方参考实现 ts-fsrs v5.4.1（FSRS-6.0 主分支）逐项对齐，详见
 * README「FSRS-7 版本口径」。本模块是 fsrs-verify 差分验证的核心对象。
 */

import { alea } from "./alea";
import { S_MAX, S_MIN, normalizeParameters } from "./defaults";
import type { FSRSParameters } from "./models";
import { clamp, roundTo } from "./utils";

/** 遗忘曲线指数（取自 w[20]）：decay = -w20 */
export function computeDecay(parameters: number[] | readonly number[]): {
  decay: number;
  factor: number;
} {
  const decay = -parameters[20]!;
  const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1.0;
  return { decay, factor: roundTo(factor, 8) };
}

/**
 * 遗忘曲线 R(t,S) = (1 + factor * t / S)^decay
 * @param elapsedDays 距上次复习的天数 t
 * @param stability 记忆稳定性 S
 * @returns 记忆可提取性 R
 */
export function forgettingCurve(
  parameters: number[] | readonly number[],
  elapsedDays: number,
  stability: number,
): number {
  const { decay, factor } = computeDecay(parameters);
  return roundTo(Math.pow(1 + (factor * elapsedDays) / stability, decay), 8);
}

/**
 * FSRS 核心算法。一次构造对应一组参数；
 * 公开 API 通过 `scheduler(params)` / `Scheduler` 类使用。
 */
export class FSRSAlgorithm {
  private readonly params: FSRSParameters;
  private intervalModifier: number;
  private seedValue?: string;

  constructor(params?: Partial<FSRSParameters>) {
    this.params = normalizeParameters(params);
    this.intervalModifier = this.calculateIntervalModifier(this.params.request_retention);
  }

  /** 只读参数集（不可变快照） */
  get parameters(): FSRSParameters {
    return {
      ...this.params,
      w: [...this.params.w],
      learning_steps: [...this.params.learning_steps],
      relearning_steps: [...this.params.relearning_steps],
    };
  }

  get intervalModifierValue(): number {
    return this.intervalModifier;
  }

  set seed(seed: string) {
    this.seedValue = seed;
  }

  /**
   * 间隔修正系数 I(r) = (r^(1/DECAY) - 1) / FACTOR
   * @throws request_retention 超出 (0,1] 时报错
   */
  calculateIntervalModifier(requestRetention: number): number {
    if (requestRetention <= 0 || requestRetention > 1) {
      throw new RangeError("Requested retention rate should be in the range (0,1]");
    }
    const { decay, factor } = computeDecay(this.params.w);
    return roundTo((Math.pow(requestRetention, 1 / decay) - 1) / factor, 8);
  }

  /** 初始稳定性 S0(G) = max(w[G-1], 0.1)，g 为 1..4 的档位编号 */
  initStability(g: number): number {
    return Math.max(this.params.w[g - 1]!, 0.1);
  }

  /** 初始难度 D0(G) = w4 - e^((G-1)*w5) + 1，g 为 1..4 的档位编号 */
  initDifficulty(g: number): number {
    const w = this.params.w;
    const d = w[4]! - Math.exp((g - 1) * w[5]!) + 1;
    return roundTo(d, 8);
  }

  /**
   * 间隔模糊化：仅当 enable_fuzz 且 ivl >= 2.5 时生效，
   * 使用确定性 PRNG（seed 由调度器设置），保证可复现。
   */
  applyFuzz(ivl: number, elapsedDays: number): number {
    if (!this.params.enable_fuzz || ivl < 2.5) return Math.round(ivl);
    const random = alea(this.seedValue)();
    const { minIvl, maxIvl } = fuzzRange(ivl, elapsedDays, this.params.maximum_interval);
    return Math.floor(random * (maxIvl - minIvl + 1) + minIvl);
  }

  /** 下次间隔 I(S, t) = clamp(round(S * modifier), 1, maximum_interval)，再过模糊化 */
  nextInterval(s: number, elapsedDays: number): number {
    const newInterval = Math.min(
      Math.max(1, Math.round(s * this.intervalModifier)),
      this.params.maximum_interval,
    );
    return this.applyFuzz(newInterval, elapsedDays);
  }

  /** 线性阻尼：把难度变化量按当前难度缩放 */
  linearDamping(deltaD: number, oldD: number): number {
    return roundTo((deltaD * (10 - oldD)) / 9, 8);
  }

  /** 难度更新 D'(D,G) = clamp(w7 * D0(4) + (1 - w7) * nextD, 1, 10) */
  nextDifficulty(d: number, g: number): number {
    const w = this.params.w;
    const deltaD = -w[6]! * (g - 3);
    const nextD = d + this.linearDamping(deltaD, d);
    return clamp(this.meanReversion(this.initDifficulty(4), nextD), 1, 10);
  }

  /** 均值回归 w7 * init + (1 - w7) * current */
  meanReversion(init: number, current: number): number {
    const w = this.params.w;
    return roundTo(w[7]! * init + (1 - w[7]!) * current, 8);
  }

  /** 回忆成功后的稳定性更新 S'(D,S,R,G)（含 Hard 惩罚 w15 / Easy 增益 w16） */
  nextRecallStability(d: number, s: number, r: number, g: number): number {
    const w = this.params.w;
    const hardPenalty = g === 2 ? w[15]! : 1;
    const easyBound = g === 4 ? w[16]! : 1;
    return roundTo(
      clamp(
        s *
          (1 +
            Math.exp(w[8]!) *
              (11 - d) *
              Math.pow(s, -w[9]!) *
              (Math.exp((1 - r) * w[10]!) - 1) *
              hardPenalty *
              easyBound),
        S_MIN,
        S_MAX,
      ),
      8,
    );
  }

  /** 遗忘后的稳定性更新 S'(D,S,R) = w11 * D^-w12 * ((S+1)^w13 - 1) * e^(w14*(1-R)) */
  nextForgetStability(d: number, s: number, r: number): number {
    const w = this.params.w;
    return roundTo(
      clamp(
        w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp((1 - r) * w[14]!),
        S_MIN,
        S_MAX,
      ),
      8,
    );
  }

  /** 短期稳定性更新 S'(S,G) = S * clamp(s^-w19 * e^(w17*(G-3+w18)), >=1（Hard 及以上）, S_MIN, S_MAX) */
  nextShortTermStability(s: number, g: number): number {
    const w = this.params.w;
    const sinc = Math.pow(s, -w[19]!) * Math.exp(w[17]! * (g - 3 + w[18]!));
    const maskedSinc = g >= 2 ? Math.max(sinc, 1.0) : sinc;
    return roundTo(clamp(s * maskedSinc, S_MIN, S_MAX), 8);
  }

  /** 以当前参数计算遗忘曲线 */
  forgettingCurveValue(elapsedDays: number, stability: number): number {
    return forgettingCurve(this.params.w, elapsedDays, stability);
  }

  /**
   * 记忆状态更新（难度 + 稳定性）：
   * - 初始状态（d=s=0）：返回按评分初始化的状态；
   * - g = 0（Manual）：原样返回；
   * - t = 0 且启用短期记忆：走短期稳定性公式；
   * - Again：遗忘稳定性，且不超过 s / e^(w17*w18)；
   * - 其余：回忆稳定性。
   */
  nextState(
    memoryState: { difficulty: number; stability: number } | null,
    t: number,
    g: number,
    r?: number,
  ): { difficulty: number; stability: number } {
    const { difficulty: d, stability: s } = memoryState ?? { difficulty: 0, stability: 0 };
    if (t < 0) {
      throw new RangeError(`Invalid delta_t "${t}"`);
    }
    if (g < 0 || g > 4) {
      throw new RangeError(`Invalid grade "${g}"`);
    }
    if (d === 0 && s === 0) {
      return {
        difficulty: clamp(this.initDifficulty(g), 1, 10),
        stability: this.initStability(g),
      };
    }
    if (g === 0) {
      return { difficulty: d, stability: s };
    }
    if (d < 1 || s < S_MIN) {
      throw new RangeError(`Invalid memory state { difficulty: ${d}, stability: ${s} }`);
    }
    const w = this.params.w;
    const retrieval = typeof r === "number" ? r : this.forgettingCurveValue(t, s);
    let newS: number;
    if (t === 0 && this.params.enable_short_term) {
      newS = this.nextShortTermStability(s, g);
    } else if (g === 1) {
      const sAfterFail = this.nextForgetStability(d, s, retrieval);
      const [w17, w18] = this.params.enable_short_term ? [w[17]!, w[18]!] : [0, 0];
      const nextSMin = s / Math.exp(w17 * w18);
      newS = clamp(roundTo(nextSMin, 8), S_MIN, sAfterFail);
    } else {
      newS = this.nextRecallStability(d, s, retrieval, g);
    }

    const newD = this.nextDifficulty(d, g);
    return { difficulty: newD, stability: newS };
  }
}

const FUZZ_RANGES = [
  { start: 2.5, end: 7.0, factor: 0.15 },
  { start: 7.0, end: 20.0, factor: 0.1 },
  { start: 20.0, end: Number.POSITIVE_INFINITY, factor: 0.05 },
] as const;

/** 模糊化区间：与官方 get_fuzz_range 一致 */
export function fuzzRange(
  interval: number,
  elapsedDays: number,
  maximumInterval: number,
): { minIvl: number; maxIvl: number } {
  let delta = 1.0;
  for (const range of FUZZ_RANGES) {
    delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0.0);
  }
  interval = Math.min(interval, maximumInterval);
  let minIvl = Math.max(2, Math.round(interval - delta));
  const maxIvl = Math.min(Math.round(interval + delta), maximumInterval);
  if (interval > elapsedDays) {
    minIvl = Math.max(minIvl, elapsedDays + 1);
  }
  minIvl = Math.min(minIvl, maxIvl);
  return { minIvl, maxIvl };
}
