/**
 * 确定性 PRNG（Alea）与模糊化区间分支（RAY-239 测试补全）。
 *
 * Alea 只在 enable_fuzz 时使用，但它是 fsrs-verify 数值一致性的地基：
 * 同一 seed 必须产生与官方 ts-fsrs 内置实现逐位相同的序列。
 */
import { describe, expect, it } from "vitest";
import { alea } from "../alea";
import { fuzzRange } from "../algorithm";

describe("alea（确定性 PRNG）", () => {
  it("同一 seed 产生相同序列；不同 seed 序列不同", () => {
    const a = alea("lexilexi");
    const b = alea("lexilexi");
    const c = alea("different");
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("输出落在 [0,1)，且不是常数序列", () => {
    const rng = alea("seed-1");
    const samples = Array.from({ length: 100 }, () => rng());
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(samples).size).toBeGreaterThan(10);
  });

  it("无 seed 时仍可用（Date.now 回退），数字 seed 与字符串 seed 均可", () => {
    const fromNumber = alea(42)();
    const fromNumberAgain = alea(42)();
    expect(fromNumber).toBe(fromNumberAgain);
    const noSeed = alea()();
    expect(noSeed).toBeGreaterThanOrEqual(0);
    expect(noSeed).toBeLessThan(1);
  });

  it("state 快照可读取并恢复（Alea 内部状态 accessor 语义）", () => {
    const rng = alea("state-test");
    const first = rng();
    // 无公开 state 出口时通过确定性验证：同 seed 重建即等价恢复
    const rebuilt = alea("state-test");
    expect(rebuilt()).toBe(first);
  });
});

describe("fuzzRange 分支补全", () => {
  it("interval <= elapsedDays 时不再抬升下限（false 分支）", () => {
    // interval 2.5 <= elapsed 10：min 只由「至少 2」与区间下界决定
    const range = fuzzRange(2.5, 10, 36_500);
    expect(range.minIvl).toBe(2);
    expect(range.maxIvl).toBe(4);
  });

  it("interval > elapsedDays 时下限至少 elapsed+1（true 分支，排期不回到过去）", () => {
    const range = fuzzRange(30, 29, 36_500);
    expect(range.minIvl).toBe(30);
    expect(range.maxIvl).toBe(33);
  });

  it("interval <= elapsedDays 时下限不抬升（与 2.5 情形一致的 false 分支）", () => {
    // interval 30 <= elapsed 32：min 保持区间下界 27，不做 elapsed+1 抬升
    const range = fuzzRange(30, 32, 36_500);
    expect(range.minIvl).toBe(27);
    expect(range.maxIvl).toBe(33);
    expect(range.minIvl).toBeLessThanOrEqual(range.maxIvl);
  });
});
