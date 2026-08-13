import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, useTheme } from "./useTheme";

describe("useTheme", () => {
  const originalMatchMedia = window.matchMedia;
  const originalDataset = Object.getOwnPropertyDescriptor(document.documentElement, "dataset");

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalDataset) {
      Object.defineProperty(document.documentElement, "dataset", originalDataset);
    }
    delete document.documentElement.dataset.theme;
  });

  it("无持久化值时跟随系统深色偏好", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("localStorage 中的值优先于系统偏好", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("内联脚本已应用 data-theme 时直接采用，不按当前系统偏好重算", () => {
    // 模拟首帧渲染前内联脚本已按当时的系统深色偏好应用了 dark，
    // 而 React 挂载时系统偏好已变化——状态必须与已渲染的 DOM 一致，避免二次闪烁
    document.documentElement.dataset.theme = "dark";
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("DOM 上 data-theme 非法时回退到 localStorage / 系统偏好解析", () => {
    document.documentElement.dataset.theme = "blue";
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggleTheme 在浅色与深色之间切换并持久化", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("light");
    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
