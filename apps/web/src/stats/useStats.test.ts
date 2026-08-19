/**
 * RAY-343 B1：useStats 跨午夜兜底
 *
 * 兜底机制（统一为同一路径，不再区分 A/B）：
 *   - 30s 周期 setInterval 比对当前本地日与 `loadedAtDateRef`：
 *     ref 缺失（首载失败）或与今日不同 → 触发 reload。
 *   - load 跨日时使用「开始日」而非「完成日」记 ref（避免在途竞态把 Day 1
 *     快照错记成 Day 2）。
 *   - 浏览器对 hidden 标签的 setInterval 节流到 ≥1 次/分钟仍能跨日触发；
 *     进程被杀 / 路由卸载重挂 → 首次 load 拿当日值。
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
import { localDateKey } from "@lexii/stats";
import { useStats } from "./useStats";
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

/**
 * S1 专用：可手动 resolve / reject 的 loadStats——让我们在 load「进行
 * 中」时把 fake clock 推过午夜、再 resolve，验证 ref 记的是开始日而不是
 * 完成日。`loadStats` 每次返回的 Promise 的 resolve/reject 在构造时
 * 闭包绑死，避免共享变量被后续调用覆盖。
 */
function makeControllableProvider() {
  type Pending = {
    resolve: (v: StatsSnapshot) => void;
    reject: (e: Error) => void;
  };
  const pending: Pending[] = [];
  const provider: StatsDataProvider = {
    loadStats: vi.fn(
      () =>
        new Promise<StatsSnapshot>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    ),
  };
  return {
    provider,
    // 测试侧用 resolveCall(callIndex, snapshot) 控制第 N 次 load 的结果
    resolveCall: (callIndex: number, snapshot: StatsSnapshot) => {
      pending[callIndex]!.resolve(snapshot);
    },
    rejectCall: (callIndex: number, err: Error) => {
      pending[callIndex]!.reject(err);
    },
  };
}

/** S2 专用：前 N 次失败、之后成功的 provider */
function makeFlakyProvider(failuresBeforeSuccess: number, snapshots: StatsSnapshot[]) {
  const calls: number[] = [];
  let i = 0;
  const provider: StatsDataProvider = {
    loadStats: vi.fn(async () => {
      calls.push(i);
      const idx = i;
      i += 1;
      if (idx < failuresBeforeSuccess) {
        throw new Error(`simulated failure #${idx}`);
      }
      return snapshots[idx - failuresBeforeSuccess] ?? snapshots[snapshots.length - 1]!;
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
  it("基础：挂载后 Day 1 → 跨过本地午夜后定时器自动 reload 到 Day 2", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1, SNAP_DAY_2]);

    const { result } = renderHook(() => useStats(provider));

    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);
    expect(result.current.stats?.newCardsRemainingToday).toBe(0);

    // 时钟前进到 Day 2 LOCAL 09:00
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));
    await tick(31_000);

    expect(calls.length).toBe(2);
    expect(result.current.stats?.todayLearnCount).toBe(0);
    expect(result.current.stats?.newCardsRemainingToday).toBe(20);
  });

  it("同日兜底：跨午夜后仍未跨日的 tick 不触发 reload（避免无谓 IO）", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1]);

    const { result } = renderHook(() => useStats(provider));
    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);

    // 仍在 Day 1 内
    vi.setSystemTime(new Date(2026, 7, 18, 22, 5, 0, 0));
    await tick(31_000);

    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);
  });

  it("S1 跨午夜在途竞态：load 在 Day 1 23:59 发起、跨日后完成 → ref 记开始日、下一 tick 补发 Day 2 快照", async () => {
    process.env.TZ = "Asia/Shanghai";
    // 挂载时刻：Day 1 LOCAL 23:59:00——load 在「跨午夜前」发起
    vi.setSystemTime(new Date(2026, 7, 18, 23, 59, 0, 0));

    const ctrl = makeControllableProvider();
    const { provider } = ctrl;
    const loadStats = provider.loadStats as ReturnType<typeof vi.fn>;

    const { result } = renderHook(() => useStats(provider));

    // 首次 load 已发起，pending 等待 resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loadStats).toHaveBeenCalledTimes(1);
    expect(result.current.stats).toBeNull();

    // 时钟跨过午夜到 Day 2 LOCAL 00:00:30；load 仍未 resolve
    vi.setSystemTime(new Date(2026, 7, 19, 0, 0, 30, 0));

    // 让首载以 Day 1 快照 resolve——注意是「开始日是 Day 1」，ref 应记 Day 1
    await act(async () => {
      ctrl.resolveCall(0, SNAP_DAY_1);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.stats?.todayLearnCount).toBe(20);
    expect(result.current.stats?.newCardsRemainingToday).toBe(0);
    // 没有第二次调用（ref 记 Day 1、stats 是 Day 1 一致）
    expect(loadStats).toHaveBeenCalledTimes(1);

    // 时钟再推 31s 让 interval 跑一次。ref 记 Day 1、today 是 Day 2，触发 reload
    // 第二次 load 也用 controllable——我们准备 SNAP_DAY_2 给它
    await act(async () => {
      // 让第二次 load（index 1）也进入 pending
      await vi.advanceTimersByTimeAsync(31_000);
      ctrl.resolveCall(1, SNAP_DAY_2);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(loadStats).toHaveBeenCalledTimes(2);
    expect(result.current.stats?.todayLearnCount).toBe(0);
    expect(result.current.stats?.newCardsRemainingToday).toBe(20);
  });

  it("S2 首载失败后 watchdog 自动重试：连续失败 N 次、下一 tick 仍触发 reload", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    // 前 2 次失败、第 3 次成功 → interval 兜底必须让 watchdog 持续尝试
    const { provider, calls } = makeFlakyProvider(2, [SNAP_DAY_1, SNAP_DAY_2]);
    const loadStats = provider.loadStats as ReturnType<typeof vi.fn>;

    const { result } = renderHook(() => useStats(provider));

    // 首次 load 失败；ref 仍为 null
    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats).toBeNull();
    expect(result.current.error).toMatch(/simulated failure #0/);

    // 推 31s 让 interval 跑一次 → 第 2 次 load（仍失败），ref 仍 null
    await tick(31_000);
    expect(calls.length).toBe(2);
    expect(result.current.stats).toBeNull();
    expect(result.current.error).toMatch(/simulated failure #1/);

    // 再推 31s → 第 3 次 load（成功），ref 写入 Day 1
    await tick(31_000);
    expect(calls.length).toBe(3);
    expect(loadStats).toHaveBeenCalledTimes(3);
    expect(result.current.stats?.todayLearnCount).toBe(20);
    expect(result.current.error).toBeNull();
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

  it("provider 由 null 切非 null：定时器重挂 + 首次 load 触发", async () => {
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

  it("provider A → B 切换：旧 interval 清理、新 interval 挂载、reload 立刻用新 provider 跑", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const providerA = makeProvider([SNAP_DAY_1, SNAP_DAY_1, SNAP_DAY_1]);
    const providerB = makeProvider([SNAP_DAY_2, SNAP_DAY_2]);
    const { result, rerender } = renderHook(({ p }: { p: StatsDataProvider }) => useStats(p), {
      initialProps: { p: providerA.provider },
    });

    // 用 A 加载 Day 1
    await tick(0);
    expect(providerA.calls.length).toBe(1);
    expect(providerB.calls.length).toBe(0);
    expect(result.current.stats?.todayLearnCount).toBe(20);

    // 切到 B；新 mount effect 立刻 load（不再走 A 的 interval）
    rerender({ p: providerB.provider });

    await tick(0);
    // A 不会被再调用（旧 interval 已清理），B 立刻 load
    expect(providerA.calls.length).toBe(1);
    expect(providerB.calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(0);
    expect(result.current.stats?.newCardsRemainingToday).toBe(20);

    // 跨日 → B 的 interval 触发 reload
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));
    await tick(31_000);
    // A.calls 仍为 1（已切走）；B.calls 应为 2（首次 + 跨日 reload）
    expect(providerA.calls.length).toBe(1);
    expect(providerB.calls.length).toBe(2);
  });

  it("unmount 清理：interval 停掉、unmount 后不再触发 load", async () => {
    process.env.TZ = "Asia/Shanghai";
    vi.setSystemTime(new Date(2026, 7, 18, 22, 0, 0, 0));

    const { provider, calls } = makeProvider([SNAP_DAY_1, SNAP_DAY_1, SNAP_DAY_1]);

    const { result, unmount } = renderHook(() => useStats(provider));
    await tick(0);
    expect(calls.length).toBe(1);
    expect(result.current.stats?.todayLearnCount).toBe(20);

    // 跨日 + unmount
    vi.setSystemTime(new Date(2026, 7, 19, 9, 0, 0, 0));
    unmount();

    // 即便跨日 + 推 31s，unmount 后的 interval 已清理，loadStats 不再被调
    await tick(31_000);
    expect(calls.length).toBe(1);
  });
});
