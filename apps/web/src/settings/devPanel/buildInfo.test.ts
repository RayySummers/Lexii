/**
 * 构建信息常量测试（RAY-297 任务 B）：
 * __APP_BUILD__ 经 vitest 的 define 注入（与 vite build 同一来源），
 * 这里只断言结构有效性——具体值随构建环境变化，不做写死断言。
 */
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../lib/appVersion";
import { APP_BUILD } from "./buildInfo";

describe("APP_BUILD 构建信息", () => {
  it("通道取值合法（release / dev）", () => {
    expect(["release", "dev"]).toContain(APP_BUILD.channel);
  });

  it("SHA / 分支 / 时间为非空字符串，时间为合法 ISO 时间", () => {
    expect(APP_BUILD.sha.length).toBeGreaterThan(0);
    expect(APP_BUILD.branch.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(APP_BUILD.time))).toBe(true);
  });

  it("历史 Release 列表非空且首位恒为当前版本 tag，元素唯一", () => {
    expect(APP_BUILD.releaseTags.length).toBeGreaterThan(0);
    expect(APP_BUILD.releaseTags[0]).toBe(`v${APP_VERSION}`);
    expect(new Set(APP_BUILD.releaseTags).size).toBe(APP_BUILD.releaseTags.length);
    for (const tag of APP_BUILD.releaseTags) {
      expect(tag).toMatch(/^v/);
    }
  });
});
