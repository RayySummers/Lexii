/**
 * 开发者面板解锁逻辑测试（RAY-297 任务 B）：
 * 连点计数状态转移（N=5 解锁 / 再连点 5 次折叠）与 localStorage 读写。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEV_PANEL_UNLOCK_STORAGE_KEY,
  DEV_PANEL_UNLOCK_TAPS,
  nextTapState,
  parseDevPanelUnlocked,
  readDevPanelUnlocked,
  writeDevPanelUnlocked,
} from "./unlock";

describe("nextTapState 连点状态转移", () => {
  it("未到阈值只累计计数，解锁状态不变", () => {
    let state = { unlocked: false, taps: 0 };
    for (let tap = 1; tap < DEV_PANEL_UNLOCK_TAPS; tap += 1) {
      state = nextTapState(state);
      expect(state).toEqual({ unlocked: false, taps: tap });
    }
  });

  it("第 N 次点击翻转解锁并清零计数", () => {
    let state = { unlocked: false, taps: DEV_PANEL_UNLOCK_TAPS - 1 };
    state = nextTapState(state);
    expect(state).toEqual({ unlocked: true, taps: 0 });
  });

  it("解锁后再连点 N 次折叠隐藏（对称 toggle）", () => {
    let state = { unlocked: true, taps: 0 };
    for (let tap = 1; tap <= DEV_PANEL_UNLOCK_TAPS; tap += 1) {
      state = nextTapState(state);
    }
    expect(state).toEqual({ unlocked: false, taps: 0 });
  });

  it("解锁状态下未到阈值的连点不折叠", () => {
    let state = { unlocked: true, taps: 0 };
    for (let tap = 1; tap < DEV_PANEL_UNLOCK_TAPS; tap += 1) {
      state = nextTapState(state);
    }
    expect(state).toEqual({ unlocked: true, taps: DEV_PANEL_UNLOCK_TAPS - 1 });
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
