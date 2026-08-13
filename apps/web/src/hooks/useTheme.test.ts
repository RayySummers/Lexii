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

  it("localStorage 写入被禁用时不崩溃，主题切换照常生效", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    setItemSpy.mockRestore();
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

  describe("meta theme-color 同步", () => {
    let meta: HTMLMetaElement;

    beforeEach(() => {
      document.head.innerHTML = "";
      document.documentElement.removeAttribute("style");
      meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = "#fafaf9";
      document.head.appendChild(meta);
    });

    afterEach(() => {
      document.head.innerHTML = "";
      document.documentElement.removeAttribute("style");
    });

    it("挂载时按当前 --lex-bg token 同步 meta", () => {
      window.matchMedia = vi
        .fn()
        .mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
      document.documentElement.style.setProperty("--lex-bg", "#fafaf9");
      renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");
    });

    it("切换主题后重新读取 token 并更新 meta", () => {
      window.matchMedia = vi
        .fn()
        .mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
      document.documentElement.style.setProperty("--lex-bg", "#fafaf9");
      const { result } = renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");

      // 模拟 data-theme="dark" 下 tokens.css 的深色 --lex-bg 已生效
      document.documentElement.style.setProperty("--lex-bg", "#0c0a09");
      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe("dark");
      expect(meta.content).toBe("#0c0a09");
    });

    it("token 不可用时保持 meta 原值且不抛错", () => {
      window.matchMedia = vi
        .fn()
        .mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
      renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");
    });
  });
});
