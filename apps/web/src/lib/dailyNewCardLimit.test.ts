/**
 * 「每日新卡上限」设置（RAY-260 评审 suggestion 2）解析/读写测试。
 *
 * 纯函数（parseDailyNewCardLimit / isValidDailyNewCardLimit）直接测；
 * localStorage 读写用 jsdom 环境验证（损坏/越界值回落默认，隐私模式
 * 抛错不炸）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_NEW_CARD_LIMIT_MAX,
  DAILY_NEW_CARD_LIMIT_MIN,
  DAILY_NEW_CARD_LIMIT_STORAGE_KEY,
  DEFAULT_DAILY_NEW_CARD_LIMIT,
  isValidDailyNewCardLimit,
  parseDailyNewCardLimit,
  readDailyNewCardLimit,
  writeDailyNewCardLimit,
} from "./dailyNewCardLimit";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

describe("parseDailyNewCardLimit（纯函数）", () => {
  it("缺失/空串回落默认值", () => {
    expect(parseDailyNewCardLimit(null)).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
    expect(parseDailyNewCardLimit(undefined)).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
    expect(parseDailyNewCardLimit("")).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
    expect(parseDailyNewCardLimit("   ")).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
  });

  it("合法整数解析（含首尾空白）", () => {
    expect(parseDailyNewCardLimit("50")).toBe(50);
    expect(parseDailyNewCardLimit(" 50 ")).toBe(50);
    expect(parseDailyNewCardLimit("1")).toBe(1);
    expect(parseDailyNewCardLimit("999")).toBe(999);
  });

  it("越界夹取到 [MIN, MAX]", () => {
    expect(parseDailyNewCardLimit("0")).toBe(DAILY_NEW_CARD_LIMIT_MIN);
    expect(parseDailyNewCardLimit("-5")).toBe(DAILY_NEW_CARD_LIMIT_MIN);
    expect(parseDailyNewCardLimit("10000")).toBe(DAILY_NEW_CARD_LIMIT_MAX);
  });

  it("非数字/小数/垃圾值回落默认", () => {
    expect(parseDailyNewCardLimit("abc")).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
    expect(parseDailyNewCardLimit("12.5")).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
    expect(parseDailyNewCardLimit("20;drop table")).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
  });
});

describe("isValidDailyNewCardLimit（设置页输入校验）", () => {
  it("整数且区间内为合法", () => {
    expect(isValidDailyNewCardLimit(1)).toBe(true);
    expect(isValidDailyNewCardLimit(20)).toBe(true);
    expect(isValidDailyNewCardLimit(999)).toBe(true);
  });

  it("越界/非整数/NaN 为非法", () => {
    expect(isValidDailyNewCardLimit(0)).toBe(false);
    expect(isValidDailyNewCardLimit(1000)).toBe(false);
    expect(isValidDailyNewCardLimit(1.5)).toBe(false);
    expect(isValidDailyNewCardLimit(Number.NaN)).toBe(false);
  });
});

describe("readDailyNewCardLimit / writeDailyNewCardLimit（localStorage）", () => {
  it("未设置时读默认值；写入后可读回", () => {
    expect(readDailyNewCardLimit()).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);

    expect(writeDailyNewCardLimit(37)).toBe(true);
    expect(window.localStorage.getItem(DAILY_NEW_CARD_LIMIT_STORAGE_KEY)).toBe("37");
    expect(readDailyNewCardLimit()).toBe(37);
  });

  it("存储损坏值回落默认，不抛错", () => {
    window.localStorage.setItem(DAILY_NEW_CARD_LIMIT_STORAGE_KEY, "not-a-number");
    expect(readDailyNewCardLimit()).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
  });

  it("localStorage 抛错（隐私模式）时读写不炸", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readDailyNewCardLimit()).toBe(DEFAULT_DAILY_NEW_CARD_LIMIT);
    expect(writeDailyNewCardLimit(20)).toBe(false);
  });
});
