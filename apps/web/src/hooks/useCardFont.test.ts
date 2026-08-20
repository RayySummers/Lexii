/**
 * 卡片字体管理（RAY-323，RAY-359）测试。
 *
 * 覆盖：初始值读 localStorage（无值回落默认 modern）；setFont 写
 * localStorage 并同步到 <html data-card-font>；跨标签页 storage 事件
 * 让本页跟随；localStorage 抛错（隐私模式）不炸。
 * RAY-359：newsreader → sentient 迁移，旧存量读为 sentient。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_FONT_STORAGE_KEY, DEFAULT_CARD_FONT } from "../lib/cardFont";
import { useCardFont } from "./useCardFont";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
  // 重置 <html data-card-font> 防止用例间相互影响
  delete document.documentElement.dataset.cardFont;
});

describe("useCardFont（RAY-323）", () => {
  beforeEach(() => {
    // 确保每个用例从干净 DOM 开始
    delete document.documentElement.dataset.cardFont;
  });

  it("默认档位：localStorage 无值时读 DEFAULT_CARD_FONT（modern / inter）", () => {
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe(DEFAULT_CARD_FONT);
    expect(result.current.font).toBe("inter");
    // 挂载即同步到 <html>
    expect(document.documentElement.dataset.cardFont).toBe("inter");
  });

  it("读取已存储的档位（如 sentient）", () => {
    window.localStorage.setItem(CARD_FONT_STORAGE_KEY, "sentient");
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe("sentient");
    expect(document.documentElement.dataset.cardFont).toBe("sentient");
  });

  it("旧存量 newsreader 读取时迁移到 sentient（RAY-359）", () => {
    window.localStorage.setItem(CARD_FONT_STORAGE_KEY, "newsreader");
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe("sentient");
    expect(document.documentElement.dataset.cardFont).toBe("sentient");
  });

  it("setFont 写 localStorage 并同步到 <html data-card-font>，4 档都能切", () => {
    const { result } = renderHook(() => useCardFont());
    const sequence: Array<"inter" | "google-sans" | "playpen" | "sentient"> = [
      "google-sans",
      "playpen",
      "sentient",
      "inter",
    ];
    for (const next of sequence) {
      act(() => {
        result.current.setFont(next);
      });
      expect(result.current.font).toBe(next);
      expect(window.localStorage.getItem(CARD_FONT_STORAGE_KEY)).toBe(next);
      expect(document.documentElement.dataset.cardFont).toBe(next);
    }
  });

  it("localStorage 抛错（隐私模式）时 setFont 不炸：state 已更新、DOM 已同步", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useCardFont());
    expect(() => {
      act(() => {
        result.current.setFont("playpen");
      });
    }).not.toThrow();
    expect(result.current.font).toBe("playpen");
    expect(document.documentElement.dataset.cardFont).toBe("playpen");
  });

  it("跨标签页：其他标签页写合法档位 → 本页跟随", () => {
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe("inter");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CARD_FONT_STORAGE_KEY,
          newValue: "playpen",
          oldValue: "inter",
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.font).toBe("playpen");
    expect(document.documentElement.dataset.cardFont).toBe("playpen");
  });

  it("跨标签页：其他标签页清空（key 为 null）→ 本页回落默认", () => {
    window.localStorage.setItem(CARD_FONT_STORAGE_KEY, "sentient");
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe("sentient");
    act(() => {
      // 全清（key === null）时回落默认
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: null,
          newValue: null,
          oldValue: null,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.font).toBe(DEFAULT_CARD_FONT);
  });

  it("跨标签页：当前档位被移除（key 匹配 + newValue === null）→ 回落默认", () => {
    window.localStorage.setItem(CARD_FONT_STORAGE_KEY, "playpen");
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe("playpen");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CARD_FONT_STORAGE_KEY,
          newValue: null,
          oldValue: "playpen",
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.font).toBe(DEFAULT_CARD_FONT);
  });

  it("跨标签页：无关 key 写入被忽略", () => {
    const { result } = renderHook(() => useCardFont());
    expect(result.current.font).toBe("inter");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "lexii:unrelated",
          newValue: "noise",
          oldValue: null,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.font).toBe("inter");
  });

  it("跨标签页：写入非法值被忽略（不破坏当前档位）", () => {
    const { result } = renderHook(() => useCardFont());
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CARD_FONT_STORAGE_KEY,
          newValue: "garbage",
          oldValue: "inter",
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.font).toBe("inter");
  });
});
