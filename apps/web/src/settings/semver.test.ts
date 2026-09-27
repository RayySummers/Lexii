/**
 * RAY-494：`compareSemver` 预发布支持回归。
 *
 * 背景：扩展词包版本号按发版口径一律带 `-alpha`。旧实现用
 * `a.split(".").map(Number)`，`"1.1.0-alpha"` 的第三段 → `Number("0-alpha")` = NaN，
 * 两次比较都不成立 → 返回 0 → 设成「与已装版本一样新」→ 升级提示静默失效。
 *
 * 覆盖：核心段数值比较 / 缺段容错、预发布与正式版的大小关系（含验收场景
 * `1.0.0 < 1.1.0-alpha`、`1.1.0 < 1.1.1-alpha`、`1.0.0 > 1.0.0-alpha`）、
 * 预发布段之间的比较（数值 vs 字母数字、段数、ASCII 序）、build metadata 忽略、
 * 非法段容错（不返回 NaN）。
 */
import { describe, expect, it } from "vitest";
import { compareSemver } from "./semver";

describe("compareSemver", () => {
  it("核心三段按数值比较，缺段按 0 补齐", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.9.9", "2.0.0")).toBe(-1);
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("1.0.1", "1.0.0")).toBe(1);
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
  });

  it("同核心段：预发布版小于正式版", () => {
    expect(compareSemver("1.1.0-alpha", "1.1.0")).toBe(-1);
    expect(compareSemver("1.1.0", "1.1.0-alpha")).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareSemver("1.1.0-alpha.1", "1.1.0")).toBe(-1);
  });

  it("核心段不同时预发布不参与比较（1.0.0 < 1.1.0-alpha < 1.1.1-alpha）", () => {
    // 验收：装了 1.0.0 的实例收到 1.1.0-alpha 时必须判为「可升级」
    expect(compareSemver("1.0.0", "1.1.0-alpha")).toBe(-1);
    expect(compareSemver("1.1.0-alpha", "1.0.0")).toBe(1);
    // 验收：装了 1.1.0 的实例能看到后续 alpha 版本
    expect(compareSemver("1.1.0", "1.1.1-alpha")).toBe(-1);
    expect(compareSemver("1.1.1-alpha", "1.1.0")).toBe(1);
  });

  it('修复前会返回 0 的用例（旧实现 patch 段 Number("0-alpha") = NaN，两处比较都不成立）', () => {
    // 同核心段、patch 段不同：旧实现两处都是 NaN → 0 → 升级提示静默失效
    expect(compareSemver("1.1.0-alpha", "1.1.1-alpha")).toBe(-1);
    expect(compareSemver("1.1.1-alpha", "1.1.0-alpha")).toBe(1);
    // 同核心段、pre-release 不同：旧实现同样返回 0
    expect(compareSemver("1.1.0-alpha", "1.1.0-beta")).toBe(-1);
    // 旧实现返回 0（正式版与预发布版被当成一样新）；语义上正式版更新，不提示升级
    expect(compareSemver("1.0.0", "1.0.0-alpha")).toBe(1);
  });

  it("已装版本比 manifest 的预发布版更新时不产生升级提示（1.0.0 > 1.0.0-alpha）", () => {
    expect(compareSemver("1.0.0", "1.0.0-alpha")).toBe(1);
    expect(compareSemver("1.1.0", "1.1.0-alpha")).toBe(1);
  });

  it("预发布段逐段比较：字母数字 ASCII 序", () => {
    expect(compareSemver("1.1.0-alpha", "1.1.0-beta")).toBe(-1);
    expect(compareSemver("1.1.0-beta", "1.1.0-alpha")).toBe(1);
    // ASCII：大写字母（0x41）小于小写字母（0x61）
    expect(compareSemver("1.0.0-Alpha", "1.0.0-alpha")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha")).toBe(0);
  });

  it("预发布段逐段比较：数字标识符按数值比、数字段小于字母数字段", () => {
    expect(compareSemver("1.1.0-alpha.2", "1.1.0-alpha.10")).toBe(-1);
    expect(compareSemver("1.1.0-alpha.10", "1.1.0-alpha.2")).toBe(1);
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-1")).toBe(1);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.1")).toBe(0);
  });

  it("预发布段数不同：段数少的更小", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.0")).toBe(-1);
  });

  it("build metadata 不参与比较", () => {
    expect(compareSemver("1.0.0+build.1", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "1.0.0+20260927")).toBe(0);
    expect(compareSemver("1.1.0-alpha+b1", "1.1.0-alpha+b2")).toBe(0);
    expect(compareSemver("1.1.0-alpha+b1", "1.1.0")).toBe(-1);
    expect(compareSemver("1.0.0+build", "1.0.0-alpha")).toBe(1);
  });

  it("非法核心段按 0 处理（纯函数容错，不返回 NaN）", () => {
    expect(compareSemver("abc", "0.0.0")).toBe(0);
    expect(compareSemver("1.x.0", "1.0.0")).toBe(0);
    expect(compareSemver("", "0.0.0")).toBe(0);
  });
});
