/**
 * 「发音口音」设置与朗读（RAY-265）测试。
 *
 * 纯函数（parsePronunciationAccent / ACCENT_LANG）直接测；localStorage
 * 读写用 jsdom 环境验证；speakWord 用 stub 的 SpeechSynthesis 引擎验证
 * 语言标签、取消排队与不支持环境降级（jsdom 原生无此 API）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_LANG,
  DEFAULT_PRONUNCIATION_ACCENT,
  PRONUNCIATION_STORAGE_KEY,
  parsePronunciationAccent,
  readPronunciationAccent,
  speakWord,
  writePronunciationAccent,
} from "./pronunciation";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

describe("parsePronunciationAccent（纯函数）", () => {
  it("缺失/空串回落默认美式", () => {
    expect(parsePronunciationAccent(null)).toBe("us");
    expect(parsePronunciationAccent(undefined)).toBe("us");
    expect(parsePronunciationAccent("")).toBe("us");
  });

  it("合法值原样解析", () => {
    expect(parsePronunciationAccent("us")).toBe("us");
    expect(parsePronunciationAccent("uk")).toBe("uk");
  });

  it("非法值回落默认美式", () => {
    expect(parsePronunciationAccent("US")).toBe("us");
    expect(parsePronunciationAccent("british")).toBe("us");
  });
});

describe("ACCENT_LANG", () => {
  it("美式 en-US / 英式 en-GB", () => {
    expect(ACCENT_LANG.us).toBe("en-US");
    expect(ACCENT_LANG.uk).toBe("en-GB");
  });
});

describe("localStorage 读写", () => {
  it("写入后读取一致；未写入时回落默认美式", () => {
    expect(readPronunciationAccent()).toBe(DEFAULT_PRONUNCIATION_ACCENT);
    expect(writePronunciationAccent("uk")).toBe(true);
    expect(window.localStorage.getItem(PRONUNCIATION_STORAGE_KEY)).toBe("uk");
    expect(readPronunciationAccent()).toBe("uk");
  });

  it("存储值损坏回落默认", () => {
    window.localStorage.setItem(PRONUNCIATION_STORAGE_KEY, "garbage");
    expect(readPronunciationAccent()).toBe("us");
  });

  it("localStorage 抛错（隐私模式）不炸，回落默认", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPronunciationAccent()).toBe("us");
    expect(writePronunciationAccent("uk")).toBe(false);
  });
});

describe("speakWord（浏览器语音合成）", () => {
  it("按口音设置语言标签并朗读", () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    class FakeUtterance {
      text: string;
      lang = "";
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    expect(speakWord("apple", "us")).toBe(true);
    const us = speak.mock.calls[0]![0] as FakeUtterance;
    expect(us.text).toBe("apple");
    expect(us.lang).toBe("en-US");
    expect(cancel).toHaveBeenCalledTimes(1);

    expect(speakWord("apple", "uk")).toBe(true);
    const uk = speak.mock.calls[1]![0] as FakeUtterance;
    expect(uk.lang).toBe("en-GB");
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("环境不支持 speechSynthesis：返回 false，不抛错", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    expect(speakWord("apple", "us")).toBe(false);
  });

  it("引擎抛错：返回 false，不抛错", () => {
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      speak: vi.fn(() => {
        throw new Error("no voice");
      }),
    });
    class FakeUtterance {
      lang = "";
      constructor(public text: string) {}
    }
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    expect(speakWord("apple", "us")).toBe(false);
  });
});
