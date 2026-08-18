/**
 * RAY-343 B1：useStats 跨午夜兜底
 *
 * 两条路径：
 *   A. 前台 + 跨午夜：应用一直保持前台可见，定时器触发 reload（不依赖
 *      visibilitychange/focus——用户在应用内不动、只是过了一夜）。
 *   B. 后台 → 回前台：定时器在跨过午夜的瞬间已经检测到 reload；用户
 *      切回前台时 stats 已是新值。
 *
 * 走 provider mock 路径（不依赖 IndexedDB）：直接给一个被 spy 的
 * StatsDataProvider，观察 loadStats() 调用次数 + 返回值。
 *
 * 时序策略：`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` 驱动
 * setInterval；所有 `setStats` 写入一律包在 `act()` 内，规避 React 的
 * "state update outside act" 警告。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDateKey, useStats } from "./useStats";
import type { StatsDataProvider, StatsSnapshot } from "./types";

/** 一个可 spy 的 provider（按调用顺序返回快照，并记录调用索引） */
function makeProvider(snapshots: StatsSnapshot[]) {
  const calls: number[] = [];
  let i = 0;
  const provider: StatsDataProvider = {
    loadStats: vi.fn(async () => {
      const snapshot = snapshots[i] ?? snapshots[snapshots.length - 1]!;
      calls.push(i);
      i += 1;
      return snapshot;
    }),
  };
  return { provider, calls };
}

const SNAP_DAY_1: StatsSnapshot = {
  streakDays: 1,
  totalDays: 1,
  todayLearnCount: 20,
  todayReviewCount: 0,
  dueCount: 14,
  dueTomorrowCount: 0,
  newCardsRemainingToday: 0,
  reviewCount: 20,
  completedWordCount: 14,
  todayStudyDurationMs: 60_000,
  totalStudyDurationMs: 60_000,
};

const SNAP_DAY_2: StatsSnapshot = {
  streakDays: 2,
  totalDays: 2,
  todayLearnCount: 0,
  todayReviewCount: 0,
  dueCount: 14,
  dueTomorrowCount: 0,
  newCardsRemainingToday: 20,
  reviewCount: 20,
  completedWordCount: 14,
  todayStudyDurationMs: 0,
  totalStudyDurationMs: 60_000,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * 推 fake 时钟并等所有微任务（含 Promise resolve）落地。
 * 二次包 act 是为了把 setStats 的写入纳入 React 的 act 边界，规避
 * "An update to TestComponent inside a test was not wrapped in act(...)"
 * 警告——单包 vi.advanceTimersByTimeAsync 在 vitest 4 + RTL 16 下仍会漏
 * 写 setInterval 回调里 setState 的那次。
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("localDateKey（本地日历日 YYYY-MM-DD）", () => {
  it("Asia/Shanghai：跨过本地午夜后日期变更", () => {
    process.env.TZ = "Asia/Shanghai";
    const day1 = new Date(2026, 7, 18, 23, 59, 0, 0);
    const day2 = new Date(2026, 7, 19, 0, 1, 0, 0);
    expect(localDateKey(day1)).toBe("2026-08-18");
    expect(localDateKey(day2)).toBe("2026-08-19");
  });

  it("UTC：跨过 UTC 午夜后日期变更", () => {
    process.env.TZ = "UTC";
    const day1 = new Date(Date.UTC(2026, 7, 18, 23, 59));
    const day2 = new Date(Date.UTC(2026, 7, 19, 0, 1));
    expect(localDateKey(day1)).toBe("2026-08-18");
    expect(localDateKey(day2)).toBe("2026-08-19");
  });
});

describe("useStats（跨午夜兜底）", () => {
  it("路径 A：前台 + 跨午夜——挂载后 Day 1 → 跨过本地午夜后定时器自动 reload 到 Day 2", async () => {
    process.env.TZ = "Asia/Shanghai";
    // 挂载时刻：Day 1 LOCAL 22:00 Asia/Shanghai
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1, SNAP_DAY_2]);

    const { result } = renderHook(() => useStats(provider));

    // 挂载 effect 触发首次 load；推 0 让首次 promise resolve + setStats 完成
    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);
    expect(result.current.stats?.newCardsRemainingToday).toBe(0);

    // 时钟前进到 Day 2 LOCAL 09:00（应用一直在前台）
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));

    // 推 31s 让 setInterval 跑一次回调
    await tick(31_000);

    // 定时器检测到本地日变更，触发 reload；stats 已是 Day 2 快照
    expect(calls.length).toBe(2);
    expect(result.current.stats?.todayLearnCount).toBe(0);
    expect(result.current.stats?.newCardsRemainingToday).toBe(20);
  });

  it("路径 A 兜底：跨午夜后仍未跨日的 tick 不触发 reload（避免无谓 IO）", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1]);

    const { result } = renderHook(() => useStats(provider));
    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);

    // 仍在 Day 1 内，时钟推 5 分钟 + 推定时器
    vi.setSystemTime(new Date(2026, 7, 18, 22, 5, 0, 0));
    await tick(31_000);

    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);
  });

  it("路径 B：后台 → 回前台——挂载 effect load 后，跨日定时器自动 reload；用户回前台时 stats 已是 Day 2", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1, SNAP_DAY_2]);

    const { result } = renderHook(() => useStats(provider));
    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);

    // 模拟「切后台后过夜到 Day 2」。定时器仍跑（应用在 React 树上挂着），
    // 用户没操作界面。
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));
    await tick(31_000);

    // 用户回到前台：定时器已 reload 完成，stats 是 Day 2 值
    expect(calls.length).toBe(2);
    expect(result.current.stats?.todayLearnCount).toBe(0);
    expect(result.current.stats?.newCardsRemainingToday).toBe(20);
  });

  it("reload() 手动调用同样刷新 loadedAtDate，再跨日仍能继续兜底", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1, SNAP_DAY_1, SNAP_DAY_2]);

    const { result } = renderHook(() => useStats(provider));
    await tick(0);
    expect(calls.length).toBe(1);

    // 手动 reload（仍在同一日内）——loadedAtDate 应被刷新
    await act(async () => {
      result.current.reload();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.length).toBe(2);

    // 再跨日
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));
    await tick(31_000);
    expect(calls.length).toBe(3);
    expect(result.current.stats?.todayLearnCount).toBe(0);
  });

  it("provider 为 null 时不挂定时器；切到非 null 后挂上并正常工作", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1, SNAP_DAY_2]);

    const { result, rerender } = renderHook(
      ({ p }: { p: StatsDataProvider | null }) => useStats(p),
      { initialProps: { p: null as StatsDataProvider | null } },
    );

    await tick(0);
    expect(calls.length).toBe(0);
    expect(result.current.stats).toBeNull();

    // 切到非 null
    rerender({ p: provider });

    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);

    // 跨日
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));
    await tick(31_000);
    expect(calls.length).toBe(2);
    expect(result.current.stats?.todayLearnCount).toBe(0);
  });
});
