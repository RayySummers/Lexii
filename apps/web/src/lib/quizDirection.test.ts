/**
 * 「选择题出题方向」设置（RAY-293）解析/读写/方向解析测试。
 *
 * 纯函数（parseQuizDirectionPreference / isQuizDirectionPreference /
 * resolveQuizDirection）直接测；localStorage 读写用 jsdom 环境验证
 * （损坏/非法值回落默认，隐私模式抛错不炸）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_QUIZ_DIRECTION_PREFERENCE,
  isQuizDirectionPreference,
  parseQuizDirectionPreference,
  QUIZ_DIRECTION_STORAGE_KEY,
  readQuizDirectionPreference,
  resolveQuizDirection,
  writeQuizDirectionPreference,
} from "./quizDirection";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

describe("isQuizDirectionPreference（设置页选单校验）", () => {
  it("三档均为合法", () => {
    expect(isQuizDirectionPreference("en-zh")).toBe(true);
    expect(isQuizDirectionPreference("zh-en")).toBe(true);
    expect(isQuizDirectionPreference("mixed")).toBe(true);
  });

  it("非法值/空值不合法", () => {
    expect(isQuizDirectionPreference("zh-cn")).toBe(false);
    expect(isQuizDirectionPreference("")).toBe(false);
    expect(isQuizDirectionPreference(null)).toBe(false);
  });
});

describe("parseQuizDirectionPreference（纯函数）", () => {
  it("缺失/空串/垃圾值回落默认英译中", () => {
    expect(parseQuizDirectionPreference(null)).toBe(DEFAULT_QUIZ_DIRECTION_PREFERENCE);
    expect(parseQuizDirectionPreference(undefined)).toBe(DEFAULT_QUIZ_DIRECTION_PREFERENCE);
    expect(parseQuizDirectionPreference("")).toBe(DEFAULT_QUIZ_DIRECTION_PREFERENCE);
    expect(parseQuizDirectionPreference("random")).toBe(DEFAULT_QUIZ_DIRECTION_PREFERENCE);
  });

  it("合法档位原样解析", () => {
    expect(parseQuizDirectionPreference("zh-en")).toBe("zh-en");
    expect(parseQuizDirectionPreference("mixed")).toBe("mixed");
  });
});

describe("readQuizDirectionPreference / writeQuizDirectionPreference（localStorage）", () => {
  it("默认英译中且未写入存储", () => {
    expect(readQuizDirectionPreference()).toBe("en-zh");
    expect(window.localStorage.getItem(QUIZ_DIRECTION_STORAGE_KEY)).toBeNull();
  });

  it("写入后读取一致", () => {
    expect(writeQuizDirectionPreference("zh-en")).toBe(true);
    expect(readQuizDirectionPreference()).toBe("zh-en");
    expect(window.localStorage.getItem(QUIZ_DIRECTION_STORAGE_KEY)).toBe("zh-en");
  });

  it("损坏值回落默认", () => {
    window.localStorage.setItem(QUIZ_DIRECTION_STORAGE_KEY, "garbage");
    expect(readQuizDirectionPreference()).toBe("en-zh");
  });

  it("localStorage 抛错时读写不炸（隐私模式降级）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readQuizDirectionPreference()).toBe("en-zh");
    expect(writeQuizDirectionPreference("mixed")).toBe(false);
  });
});

describe("resolveQuizDirection（逐题方向解析）", () => {
  it("英译中/中译英直接返回偏好值（不消费随机源）", () => {
    const random = vi.fn<() => number>();
    expect(resolveQuizDirection("en-zh", random)).toBe("en-zh");
    expect(resolveQuizDirection("zh-en", random)).toBe("zh-en");
    expect(random).not.toHaveBeenCalled();
  });

  it("混合模式：随机数 < 0.5 出英译中，≥ 0.5 出中译英", () => {
    expect(resolveQuizDirection("mixed", () => 0)).toBe("en-zh");
    expect(resolveQuizDirection("mixed", () => 0.499)).toBe("en-zh");
    expect(resolveQuizDirection("mixed", () => 0.5)).toBe("zh-en");
    expect(resolveQuizDirection("mixed", () => 0.999)).toBe("zh-en");
  });
});
