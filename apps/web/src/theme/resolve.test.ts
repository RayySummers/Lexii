import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme } from "./resolve";

describe("resolveTheme", () => {
  it("持久化值 light 优先于系统深色偏好", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("持久化值 dark 优先于系统浅色偏好", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("偏好 system 时跟随系统深色", () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("偏好 system 时跟随系统浅色", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("无持久化值时跟随系统深色偏好", () => {
    expect(resolveTheme(null, true)).toBe("dark");
  });

  it("无持久化值且系统浅色时默认浅色", () => {
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("非法持久化值视为跟随系统（system）", () => {
    expect(resolveTheme("blue", true)).toBe("dark");
    expect(resolveTheme("blue", false)).toBe("light");
  });
});

describe("isThemePreference", () => {
  it("仅接受 light / dark / system 三档", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
  });

  it("拒绝非法值、缺失值与空串", () => {
    expect(isThemePreference("blue")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference("System")).toBe(false);
  });
});
