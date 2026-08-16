/**
 * Feature flags 测试（RAY-297 任务 B）：
 * 默认值 ∪ 存量值合并、损坏 JSON 回退、单 flag 写入保留其余存量、查询语义。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  FEATURE_FLAGS,
  FEATURE_FLAGS_STORAGE_KEY,
  isFeatureFlagEnabled,
  parseFeatureFlags,
  readFeatureFlags,
  writeFeatureFlag,
} from "./featureFlags";

describe("Feature flags 登记表", () => {
  it("所有候选 flag 默认关闭且标识唯一", () => {
    const ids = FEATURE_FLAGS.map((flag) => flag.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const flag of FEATURE_FLAGS) {
      expect(flag.defaultValue).toBe(false);
    }
  });
});

describe("parseFeatureFlags 解析与合并", () => {
  it("无存量时返回全部默认值（全 false）", () => {
    const flags = parseFeatureFlags(undefined);
    for (const flag of FEATURE_FLAGS) {
      expect(flags[flag.id]).toBe(false);
    }
  });

  it("存量值覆盖默认值，缺失项回落默认", () => {
    const first = FEATURE_FLAGS[0]!;
    const flags = parseFeatureFlags(JSON.stringify({ [first.id]: true }));
    expect(flags[first.id]).toBe(true);
    for (const flag of FEATURE_FLAGS.slice(1)) {
      expect(flags[flag.id]).toBe(false);
    }
  });

  it("损坏 JSON / 非对象 / 数组一律回退默认值", () => {
    expect(parseFeatureFlags("{not-json")).toEqual(parseFeatureFlags(undefined));
    expect(parseFeatureFlags('"string"')).toEqual(parseFeatureFlags(undefined));
    expect(parseFeatureFlags("[1,2]")).toEqual(parseFeatureFlags(undefined));
  });

  it("非布尔类型的存量值被忽略（不覆盖默认）", () => {
    const first = FEATURE_FLAGS[0]!;
    const flags = parseFeatureFlags(JSON.stringify({ [first.id]: "yes" }));
    expect(flags[first.id]).toBe(false);
  });
});

describe("localStorage 读写", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writeFeatureFlag 写入单个 flag 并保留其余存量值", () => {
    const first = FEATURE_FLAGS[0]!;
    const second = FEATURE_FLAGS[1]!;
    expect(writeFeatureFlag(first.id, true)).toBe(true);
    expect(writeFeatureFlag(second.id, true)).toBe(true);

    const stored = JSON.parse(window.localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY) ?? "{}");
    expect(stored[first.id]).toBe(true);
    expect(stored[second.id]).toBe(true);

    // 关闭 first，second 的存量值不受影响
    expect(writeFeatureFlag(first.id, false)).toBe(true);
    expect(readFeatureFlags()[first.id]).toBe(false);
    expect(readFeatureFlags()[second.id]).toBe(true);
  });

  it("readFeatureFlags 无存量时返回默认值", () => {
    const flags = readFeatureFlags();
    for (const flag of FEATURE_FLAGS) {
      expect(flags[flag.id]).toBe(false);
    }
  });

  it("isFeatureFlagEnabled：未登记的 flag 一律 false", () => {
    const first = FEATURE_FLAGS[0]!;
    expect(isFeatureFlagEnabled("not-registered")).toBe(false);
    writeFeatureFlag(first.id, true);
    expect(isFeatureFlagEnabled(first.id)).toBe(true);
  });
});
