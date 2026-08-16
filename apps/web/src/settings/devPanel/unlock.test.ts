/**
 * 开发者面板解锁逻辑测试（RAY-297 任务 B）：
 * 连点计数状态转移（N=5 解锁 / 再连点 5 次折叠）、时间窗重置（Oscar nit 2）
 * 与 localStorage 读写。时间戳由测试传入固定值，转移函数保持纯函数。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEV_PANEL_TAP_WINDOW_MS,
  DEV_PANEL_UNLOCK_STORAGE_KEY,
  DEV_PANEL_UNLOCK_TAPS,
  nextTapState,
  parseDevPanelUnlocked,
  readDevPanelUnlocked,
  writeDevPanelUnlocked,
} from "./unlock";

/** 初始连点状态（taps=0 时 lastTapAt 无意义，任何首击都视为序列起点） */
function freshState(
  overrides: Partial<{ unlocked: boolean; taps: number; lastTapAt: number }> = {},
) {
  return { unlocked: false, taps: 0, lastTapAt: 0, ...overrides };
}

describe("nextTapState 连点状态转移", () => {
  it("未到阈值只累计计数，解锁状态不变", () => {
    let state = freshState();
    for (let tap = 1; tap < DEV_PANEL_UNLOCK_TAPS; tap += 1) {
      state = nextTapState(state, tap * 100);
      expect(state).toEqual({ unlocked: false, taps: tap, lastTapAt: tap * 100 });
    }
  });

  it("第 N 次点击翻转解锁并清零计数", () => {
    let state = freshState({ taps: DEV_PANEL_UNLOCK_TAPS - 1, lastTapAt: 400 });
    state = nextTapState(state, 500);
    expect(state).toEqual({ unlocked: true, taps: 0, lastTapAt: 500 });
  });

  it("解锁后再连点 N 次折叠隐藏（对称 toggle）", () => {
    let state = freshState({ unlocked: true });
    for (let tap = 1; tap <= DEV_PANEL_UNLOCK_TAPS; tap += 1) {
      state = nextTapState(state, tap * 100);
    }
    expect(state).toEqual({ unlocked: false, taps: 0, lastTapAt: DEV_PANEL_UNLOCK_TAPS * 100 });
  });

  it("解锁状态下未到阈值的连点不折叠", () => {
    let state = freshState({ unlocked: true });
    for (let tap = 1; tap < DEV_PANEL_UNLOCK_TAPS; tap += 1) {
      state = nextTapState(state, tap * 100);
    }
    expect(state).toEqual({
      unlocked: true,
      taps: DEV_PANEL_UNLOCK_TAPS - 1,
      lastTapAt: (DEV_PANEL_UNLOCK_TAPS - 1) * 100,
    });
  });

  it("超过时间窗的点击开启新序列：计数重置为 1，不触发解锁（nit 2）", () => {
    let state = freshState({ taps: 4, lastTapAt: 1_000 });
    // 距上次点击恰好超过窗口（> 窗口即重置）
    state = nextTapState(state, 1_000 + DEV_PANEL_TAP_WINDOW_MS + 1);
    expect(state).toEqual({
      unlocked: false,
      taps: 1,
      lastTapAt: 1_000 + DEV_PANEL_TAP_WINDOW_MS + 1,
    });

    // 窗口内继续连点，序列累计
    for (let tap = 1; tap < DEV_PANEL_UNLOCK_TAPS - 1; tap += 1) {
      state = nextTapState(state, 1_000 + DEV_PANEL_TAP_WINDOW_MS + 1 + tap * 100);
    }
    expect(state.taps).toBe(DEV_PANEL_UNLOCK_TAPS - 1);
    expect(state.unlocked).toBe(false);
  });

  it("恰好等于窗口边界的点击仍视为同一序列", () => {
    let state = freshState({ taps: 2, lastTapAt: 1_000 });
    state = nextTapState(state, 1_000 + DEV_PANEL_TAP_WINDOW_MS);
    expect(state).toEqual({ unlocked: false, taps: 3, lastTapAt: 1_000 + DEV_PANEL_TAP_WINDOW_MS });
  });

  it("首击（taps=0）无论距 lastTapAt 多久都视为序列起点", () => {
    let state = freshState({ taps: 0, lastTapAt: 1 });
    state = nextTapState(state, 99_999);
    expect(state).toEqual({ unlocked: false, taps: 1, lastTapAt: 99_999 });
  });
});

describe("解锁状态持久化（localStorage）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('parseDevPanelUnlocked：仅 "1" 为 true，其余一律 false', () => {
    expect(parseDevPanelUnlocked("1")).toBe(true);
    expect(parseDevPanelUnlocked("0")).toBe(false);
    expect(parseDevPanelUnlocked("true")).toBe(false);
    expect(parseDevPanelUnlocked("")).toBe(false);
    expect(parseDevPanelUnlocked(null)).toBe(false);
    expect(parseDevPanelUnlocked(undefined)).toBe(false);
  });

  it("write / read 往返：写入后读回一致，键名稳定", () => {
    expect(writeDevPanelUnlocked(true)).toBe(true);
    expect(window.localStorage.getItem(DEV_PANEL_UNLOCK_STORAGE_KEY)).toBe("1");
    expect(readDevPanelUnlocked()).toBe(true);

    expect(writeDevPanelUnlocked(false)).toBe(true);
    expect(readDevPanelUnlocked()).toBe(false);
  });

  it("无存量时默认未解锁", () => {
    expect(readDevPanelUnlocked()).toBe(false);
  });
});
