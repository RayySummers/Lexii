/**
 * 「评分档位」设置（RAY-265）解析/读写测试。
 *
 * 纯函数（parseRatingTierMode）直接测；localStorage 读写用 jsdom 环境
 * 验证（缺失/非法值回落默认三档，隐私模式抛错不炸）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RATING_TIER_MODE,
  RATING_TIER_STORAGE_KEY,
  isRatingTierMode,
  parseRatingTierMode,
  readRatingTierMode,
  writeRatingTierMode,
} from "./ratingTiers";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

describe("parseRatingTierMode（纯函数）", () => {
  it("缺失/空串回落默认三档", () => {
    expect(parseRatingTierMode(null)).toBe("three");
    expect(parseRatingTierMode(undefined)).toBe("three");
    expect(parseRatingTierMode("")).toBe("three");
  });

  it("合法值原样解析", () => {
    expect(parseRatingTierMode("three")).toBe("three");
    expect(parseRatingTierMode("four")).toBe("four");
  });

  it("非法值回落默认三档", () => {
    expect(parseRatingTierMode("FOUR")).toBe("three");
    expect(parseRatingTierMode("two")).toBe("three");
    expect(parseRatingTierMode("3")).toBe("three");
  });
});

describe("isRatingTierMode", () => {
  it("仅 three / four 为合法", () => {
    expect(isRatingTierMode("three")).toBe(true);
    expect(isRatingTierMode("four")).toBe(true);
    expect(isRatingTierMode(null)).toBe(false);
    expect(isRatingTierMode("easy")).toBe(false);
  });
});

describe("localStorage 读写", () => {
  it("写入后读取一致；未写入时回落默认三档", () => {
    expect(readRatingTierMode()).toBe(DEFAULT_RATING_TIER_MODE);
    expect(writeRatingTierMode("four")).toBe(true);
    expect(window.localStorage.getItem(RATING_TIER_STORAGE_KEY)).toBe("four");
    expect(readRatingTierMode()).toBe("four");
  });

  it("存储值损坏回落默认", () => {
    window.localStorage.setItem(RATING_TIER_STORAGE_KEY, "garbage");
    expect(readRatingTierMode()).toBe("three");
  });

  it("localStorage 抛错（隐私模式）不炸，回落默认", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readRatingTierMode()).toBe("three");
    expect(writeRatingTierMode("four")).toBe(false);
  });
});
