import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, useTheme } from "./useTheme";

type MediaQueryChangeHandler = (event: { matches: boolean }) => void;

/**
 * 可控的 matchMedia 假实现：
 * - `matches` 可随 setMatches 变化（模拟设备主题切换）
 * - 记录 change 监听器，setMatches 时同步触发（模拟 prefers-color-scheme 事件）
 */
function installMediaQuery(initialMatches: boolean) {
  const changeHandlers = new Set<MediaQueryChangeHandler>();
  let matches = initialMatches;
  const fake = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn((type: string, handler: MediaQueryChangeHandler) => {
      if (type === "change") {
        changeHandlers.add(handler);
      }
    }),
    removeEventListener: vi.fn((type: string, handler: MediaQueryChangeHandler) => {
      if (type === "change") {
        changeHandlers.delete(handler);
      }
    }),
  };
  window.matchMedia = vi.fn().mockReturnValue(fake) as unknown as typeof matchMedia;
  return {
    /** 模拟设备主题变化：更新 matches 并触发已注册的 change 监听器 */
    setMatches(next: boolean) {
      matches = next;
      for (const handler of [...changeHandlers]) {
        handler({ matches: next });
      }
    },
  };
}

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

  it("无持久化值时默认「跟随系统」档位，实际主题随系统偏好", () => {
    installMediaQuery(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // 默认档位同样持久化，显式存 "system"（而非解析出的实际主题）
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("localStorage 中的 light 优先于系统深色偏好", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    installMediaQuery(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("light");
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("localStorage 中的 dark 优先于系统浅色偏好", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    installMediaQuery(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("dark");
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("localStorage 中的 system：实际主题按系统偏好解析", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    installMediaQuery(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");
  });

  it("非法持久化值回落到「跟随系统」档位", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "blue");
    installMediaQuery(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");
  });

  it("内联脚本已应用 data-theme 时直接采用，不按当前系统偏好重算", () => {
    // 模拟首帧渲染前内联脚本已按当时的系统深色偏好应用了 dark，
    // 而 React 挂载时系统偏好已变化——状态必须与已渲染的 DOM 一致，避免二次闪烁
    document.documentElement.dataset.theme = "dark";
    installMediaQuery(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("DOM 上 data-theme 非法时回退到 localStorage / 系统偏好解析", () => {
    document.documentElement.dataset.theme = "blue";
    installMediaQuery(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("setPreference 应用并持久化：light / dark 档位直接生效", () => {
    installMediaQuery(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => {
      result.current.setPreference("dark");
    });
    expect(result.current.preference).toBe("dark");
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => {
      result.current.setPreference("light");
    });
    expect(result.current.preference).toBe("light");
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it('setPreference("system")：按当前系统偏好立即解析并持久化 system', () => {
    installMediaQuery(true);
    const { result } = renderHook(() => useTheme());
    // 默认已是 system + 系统深色 → dark；先切 light 再切回 system 验证立即解析
    act(() => {
      result.current.setPreference("light");
    });
    expect(result.current.theme).toBe("light");

    act(() => {
      result.current.setPreference("system");
    });
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("跟随系统档位：设备主题变化时自动切换实际主题", () => {
    const media = installMediaQuery(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => {
      media.setMatches(true); // 设备切到深色
    });
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    // 偏好仍是 system（持久化不变），不把解析结果写回偏好
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");

    act(() => {
      media.setMatches(false); // 设备切回浅色
    });
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("非跟随系统档位：设备主题变化不影响实际主题", () => {
    const media = installMediaQuery(false);
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference("light");
    });

    act(() => {
      media.setMatches(true);
    });
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("localStorage 写入被禁用时不崩溃，setPreference 照常生效", () => {
    installMediaQuery(false);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");

    act(() => {
      result.current.setPreference("dark");
    });
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    setItemSpy.mockRestore();
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
      installMediaQuery(false);
      document.documentElement.style.setProperty("--lex-bg", "#fafaf9");
      renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");
    });

    it("切换偏好后重新读取 token 并更新 meta", () => {
      installMediaQuery(false);
      document.documentElement.style.setProperty("--lex-bg", "#fafaf9");
      const { result } = renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");

      // 模拟 data-theme="dark" 下 tokens.css 的深色 --lex-bg 已生效
      document.documentElement.style.setProperty("--lex-bg", "#0c0a09");
      act(() => {
        result.current.setPreference("dark");
      });
      expect(result.current.theme).toBe("dark");
      expect(meta.content).toBe("#0c0a09");
    });

    it("跟随系统档位设备主题变化时同步 meta", () => {
      const media = installMediaQuery(false);
      document.documentElement.style.setProperty("--lex-bg", "#fafaf9");
      renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");

      document.documentElement.style.setProperty("--lex-bg", "#0c0a09");
      act(() => {
        media.setMatches(true);
      });
      expect(meta.content).toBe("#0c0a09");
    });

    it("token 不可用时保持 meta 原值且不抛错", () => {
      installMediaQuery(false);
      renderHook(() => useTheme());
      expect(meta.content).toBe("#fafaf9");
    });
  });
});
