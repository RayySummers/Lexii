/**
 * 「学习列表是否包含生词本」偏好（RAY-284）解析/读写测试。
 *
 * 纯函数（parseIncludeNotebook）直接测；localStorage 读写用 jsdom 环境
 * 验证（损坏值回落默认，隐私模式抛错不炸）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INCLUDE_NOTEBOOK,
  INCLUDE_NOTEBOOK_STORAGE_KEY,
  parseIncludeNotebook,
  readIncludeNotebook,
  writeIncludeNotebook,
} from "./notebookPreference";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

describe("parseIncludeNotebook（纯函数）", () => {
  it("缺失/空串回落默认值（默认包含）", () => {
    expect(DEFAULT_INCLUDE_NOTEBOOK).toBe(true);
    expect(parseIncludeNotebook(null)).toBe(true);
    expect(parseIncludeNotebook(undefined)).toBe(true);
    expect(parseIncludeNotebook("")).toBe(true);
    expect(parseIncludeNotebook("   ")).toBe(true);
  });

  it("合法值解析（含首尾空白与大小写）", () => {
    expect(parseIncludeNotebook("1")).toBe(true);
    expect(parseIncludeNotebook(" 1 ")).toBe(true);
    expect(parseIncludeNotebook("true")).toBe(true);
    expect(parseIncludeNotebook("TRUE")).toBe(true);
    expect(parseIncludeNotebook("0")).toBe(false);
    expect(parseIncludeNotebook("false")).toBe(false);
    expect(parseIncludeNotebook("FALSE")).toBe(false);
  });

  it("垃圾值回落默认", () => {
    expect(parseIncludeNotebook("2")).toBe(true);
    expect(parseIncludeNotebook("abc")).toBe(true);
  });
});

describe("readIncludeNotebook / writeIncludeNotebook（localStorage 读写）", () => {
  it("未写入时读默认值；写入后读回写入值", () => {
    expect(readIncludeNotebook()).toBe(true);
    expect(writeIncludeNotebook(false)).toBe(true);
    expect(readIncludeNotebook()).toBe(false);
    expect(window.localStorage.getItem(INCLUDE_NOTEBOOK_STORAGE_KEY)).toBe("0");
    expect(writeIncludeNotebook(true)).toBe(true);
    expect(readIncludeNotebook()).toBe(true);
  });

  it("localStorage 抛错时不炸：读回落默认、写返回 false", () => {
    vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readIncludeNotebook()).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(writeIncludeNotebook(false)).toBe(false);
  });
});
