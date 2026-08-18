import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHash, useHashRoute } from "./useHashRoute";

describe("parseHash", () => {
  const originalHash = window.location.hash;

  afterEach(() => {
    history.replaceState(null, "", originalHash);
  });

  it.each([
    "review",
    "search",
    "notebook",
    "custom-lists",
    "custom-list",
    "settings",
    "stats",
  ] as const)("#/%s → %s", (view) => {
    history.replaceState(null, "", `#/${view}`);
    expect(parseHash()).toBe(view);
  });

  it("空 hash → home", () => {
    history.replaceState(null, "", window.location.pathname);
    expect(parseHash()).toBe("home");
  });

  it("# 单独存在 → home", () => {
    history.replaceState(null, "", "#");
    expect(parseHash()).toBe("home");
  });

  it("未知 hash → home", () => {
    history.replaceState(null, "", "#/foobar");
    expect(parseHash()).toBe("home");
  });

  it("带 query string 的已知 hash → 正确视图", () => {
    history.replaceState(null, "", "#/review?mode=learn");
    expect(parseHash()).toBe("review");
  });

  it("带 query string 的空 hash → home", () => {
    history.replaceState(null, "", "#/?foo=bar");
    expect(parseHash()).toBe("home");
  });

  it("带 trailing path 的 hash → 取第一段", () => {
    history.replaceState(null, "", "#/settings/advanced");
    expect(parseHash()).toBe("settings");
  });
});

describe("useHashRoute", () => {
  const originalHash = window.location.hash;

  beforeEach(() => {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  });

  afterEach(() => {
    history.replaceState(null, "", originalHash);
  });

  it("初始 hash 为空时 view 为 home", () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe("home");
  });

  it("初始 hash 为 #/settings 时 view 为 settings", () => {
    history.replaceState(null, "", "#/settings");
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe("settings");
  });

  it("navigate 更新 view 状态", () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe("home");

    act(() => {
      result.current[1]("review");
    });
    expect(result.current[0]).toBe("review");

    act(() => {
      result.current[1]("settings");
    });
    expect(result.current[0]).toBe("settings");
  });

  it("navigate('home') 清除 URL hash", () => {
    const { result } = renderHook(() => useHashRoute());

    act(() => {
      result.current[1]("review");
    });
    expect(window.location.hash).toBe("#/review");

    act(() => {
      result.current[1]("home");
    });
    expect(result.current[0]).toBe("home");
    expect(window.location.hash).toBe("");
  });

  it("navigate('review') 后 URL 为 #/review", () => {
    const { result } = renderHook(() => useHashRoute());

    act(() => {
      result.current[1]("review");
    });
    expect(window.location.hash).toBe("#/review");
  });

  it("popstate 事件更新视图（浏览器后退/前进）", () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe("home");

    // 模拟浏览器前进到 #/settings
    history.pushState(null, "", "#/settings");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("settings");

    // 模拟浏览器后退到首页
    history.pushState(null, "", window.location.pathname);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("home");
  });

  it("popstate 到未知 hash 时回落 home", () => {
    const { result } = renderHook(() => useHashRoute());

    history.pushState(null, "", "#/unknown");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("home");
  });
});
