import { describe, expect, it } from "vitest";
import { resolveTheme } from "./resolve";

describe("resolveTheme", () => {
  it("持久化值 light 优先于系统深色偏好", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("持久化值 dark 优先于系统浅色偏好", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("无持久化值时跟随系统深色偏好", () => {
    expect(resolveTheme(null, true)).toBe("dark");
  });

  it("无持久化值且系统浅色时默认浅色", () => {
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("非法持久化值视为无持久化值", () => {
    expect(resolveTheme("blue", true)).toBe("dark");
    expect(resolveTheme("blue", false)).toBe("light");
  });
});
