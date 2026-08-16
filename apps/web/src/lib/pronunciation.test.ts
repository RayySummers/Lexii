/**
 * 「发音口音」设置与朗读（RAY-265，手机端兼容修复 RAY-277）测试。
 *
 * 纯函数（parsePronunciationAccent / ACCENT_LANG）直接测；localStorage
 * 读写用 jsdom 环境验证；speakWord 用 stub 的 SpeechSynthesis 引擎验证
 * 语言标签、语音包匹配、paused/cancel 兼容处理与不支持环境降级
 * （jsdom 原生无此 API）。RAY-277 覆盖：语音引擎预热、空闲态不 cancel
 * （iOS 竞态）、paused 先 resume（Android）、异步失败 / 静默失败兜底回调。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_LANG,
  DEFAULT_PRONUNCIATION_ACCENT,
  PRONUNCIATION_STORAGE_KEY,
  SPEAK_START_TIMEOUT_MS,
  parsePronunciationAccent,
  primeSpeechEngine,
  readPronunciationAccent,
  speakWord,
  writePronunciationAccent,
} from "./pronunciation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

/** 构造 SpeechSynthesisVoice 测试桩（仅保留 speakWord 使用的字段） */
function makeVoice(lang: string, localService = true): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService,
    name: `voice-${lang}-${localService ? "local" : "remote"}`,
    voiceURI: `urn:voice:${lang}`,
  };
}

interface EngineStub {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  speaking: boolean;
  pending: boolean;
  paused: boolean;
}

function makeEngine(
  overrides: Partial<{
    speaking: boolean;
    pending: boolean;
    paused: boolean;
    voices: SpeechSynthesisVoice[];
  }> = {},
): EngineStub {
  return {
    speak: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => overrides.voices ?? []),
    addEventListener: vi.fn(),
    speaking: overrides.speaking ?? false,
    pending: overrides.pending ?? false,
    paused: overrides.paused ?? false,
  };
}

class FakeUtterance {
  text: string;
  lang = "";
  volume = 1;
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function stubEngineGlobals(engine: EngineStub): void {
  vi.stubGlobal("speechSynthesis", engine);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
}

function lastSpokenUtterance(engine: EngineStub): FakeUtterance {
  const calls = engine.speak.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as FakeUtterance;
}

describe("speakWord（浏览器语音合成）", () => {
  it("按口音设置语言标签并朗读；空闲态不 cancel（RAY-277 iOS 竞态防护）", () => {
    const engine = makeEngine();
    stubEngineGlobals(engine);

    expect(speakWord("apple", "us")).toBe(true);
    const us = lastSpokenUtterance(engine);
    expect(us.text).toBe("apple");
    expect(us.lang).toBe("en-US");
    expect(us.volume).toBe(1);
    expect(us.rate).toBe(1);
    // 队列空闲：不应调用 cancel（iOS 上 cancel→speak 同 tick 会吞掉新朗读）
    expect(engine.cancel).not.toHaveBeenCalled();
    expect(engine.resume).not.toHaveBeenCalled();

    expect(speakWord("apple", "uk")).toBe(true);
    const uk = lastSpokenUtterance(engine);
    expect(uk.lang).toBe("en-GB");
    expect(engine.speak).toHaveBeenCalledTimes(2);
  });

  it("正在朗读 / 有排队时先 cancel，保持连续点击只播最新（Anki 同款交互）", () => {
    const speakingEngine = makeEngine({ speaking: true });
    stubEngineGlobals(speakingEngine);
    expect(speakWord("apple", "us")).toBe(true);
    expect(speakingEngine.cancel).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();

    const pendingEngine = makeEngine({ pending: true });
    stubEngineGlobals(pendingEngine);
    expect(speakWord("apple", "us")).toBe(true);
    expect(pendingEngine.cancel).toHaveBeenCalledTimes(1);
  });

  it("引擎停在 paused 时先 resume（RAY-277 Android Chrome 静默失效防护）", () => {
    const engine = makeEngine({ paused: true });
    stubEngineGlobals(engine);
    expect(speakWord("apple", "us")).toBe(true);
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(engine.speak).toHaveBeenCalledTimes(1);
  });

  it("按口音优先匹配语音包：精确 en-US / en-GB，回落同语系，偏好本地语音", () => {
    const engine = makeEngine({
      voices: [
        makeVoice("en-US"),
        makeVoice("en-GB"),
        makeVoice("fr-FR"),
        makeVoice("en-GB", false),
      ],
    });
    stubEngineGlobals(engine);

    expect(speakWord("apple", "us")).toBe(true);
    expect(lastSpokenUtterance(engine).voice?.lang).toBe("en-US");

    // 精确 en-GB 有两个候选：偏好 localService 的本地语音
    expect(speakWord("apple", "uk")).toBe(true);
    expect(lastSpokenUtterance(engine).voice?.lang).toBe("en-GB");
    expect(lastSpokenUtterance(engine).voice?.localService).toBe(true);
  });

  it("语音包只有同语系（无精确口音）时回落同语系语音", () => {
    const engine = makeEngine({ voices: [makeVoice("en-AU")] });
    stubEngineGlobals(engine);
    expect(speakWord("apple", "uk")).toBe(true);
    expect(lastSpokenUtterance(engine).voice?.lang).toBe("en-AU");
  });

  it("语音包列表为空：退回仅设 lang 标签，仍发起朗读（不误报不可用）", () => {
    const engine = makeEngine({ voices: [] });
    stubEngineGlobals(engine);
    expect(speakWord("apple", "us")).toBe(true);
    expect(lastSpokenUtterance(engine).voice).toBeNull();
    expect(engine.speak).toHaveBeenCalledTimes(1);
  });

  it("环境不支持 speechSynthesis：返回 false，回调 unsupported，不抛错", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    const onUnavailable = vi.fn();
    expect(speakWord("apple", "us", { onUnavailable })).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("unsupported");
    // 不传回调同样安全
    expect(speakWord("apple", "us")).toBe(false);
  });

  it("引擎 speak 同步抛错：返回 false，回调 unavailable，不抛错", () => {
    const engine = makeEngine();
    engine.speak.mockImplementation(() => {
      throw new Error("NotAllowedError");
    });
    stubEngineGlobals(engine);
    const onUnavailable = vi.fn();
    expect(speakWord("apple", "us", { onUnavailable })).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("unavailable");
  });

  it("异步合成失败（非取消类错误）：回调一次 unavailable（RAY-277）", () => {
    const engine = makeEngine();
    stubEngineGlobals(engine);
    const onUnavailable = vi.fn();
    expect(speakWord("apple", "us", { onUnavailable })).toBe(true);
    const utterance = lastSpokenUtterance(engine);
    const event = { error: "synthesis-unavailable" } as SpeechSynthesisErrorEvent;
    utterance.onerror?.(event);
    utterance.onerror?.(event);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("unavailable");
  });

  it("自己取消 / 打断（canceled / interrupted）不视为不可用，也不触发兜底", () => {
    vi.useFakeTimers();
    const engine = makeEngine({ speaking: true });
    stubEngineGlobals(engine);
    const onUnavailable = vi.fn();
    expect(speakWord("apple", "us", { onUnavailable })).toBe(true);
    const utterance = lastSpokenUtterance(engine);
    utterance.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);
    utterance.onerror?.({ error: "canceled" } as SpeechSynthesisErrorEvent);
    vi.advanceTimersByTime(SPEAK_START_TIMEOUT_MS * 2);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("静默失败（发起后迟迟不开始）：超时回调一次 unavailable（RAY-277）", () => {
    vi.useFakeTimers();
    const engine = makeEngine();
    stubEngineGlobals(engine);
    const onUnavailable = vi.fn();
    expect(speakWord("apple", "us", { onUnavailable })).toBe(true);
    vi.advanceTimersByTime(SPEAK_START_TIMEOUT_MS);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("unavailable");
    vi.advanceTimersByTime(SPEAK_START_TIMEOUT_MS * 3);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("正常开始朗读（onstart / onend）：超时兜底不触发", () => {
    vi.useFakeTimers();
    const engine = makeEngine();
    stubEngineGlobals(engine);
    const onUnavailable = vi.fn();
    expect(speakWord("apple", "us", { onUnavailable })).toBe(true);
    const utterance = lastSpokenUtterance(engine);
    utterance.onstart?.();
    vi.advanceTimersByTime(SPEAK_START_TIMEOUT_MS * 3);
    utterance.onend?.();
    vi.advanceTimersByTime(SPEAK_START_TIMEOUT_MS * 3);
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

describe("primeSpeechEngine（RAY-277 语音引擎预热）", () => {
  it("调用 getVoices 触发语音包装载并注册 voiceschanged 监听", () => {
    const engine = makeEngine();
    vi.stubGlobal("speechSynthesis", engine);
    primeSpeechEngine();
    expect(engine.getVoices).toHaveBeenCalledTimes(1);
    expect(engine.addEventListener).toHaveBeenCalledTimes(1);
    expect(engine.addEventListener.mock.calls[0]![0]).toBe("voiceschanged");
    vi.unstubAllGlobals();
  });

  it("幂等：重复调用不重复注册；无引擎 / 无 addEventListener 不抛错", () => {
    const engine = makeEngine();
    vi.stubGlobal("speechSynthesis", engine);
    primeSpeechEngine();
    primeSpeechEngine();
    expect(engine.addEventListener).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();

    vi.stubGlobal("speechSynthesis", undefined);
    expect(() => primeSpeechEngine()).not.toThrow();
    vi.unstubAllGlobals();

    const minimal = makeEngine();
    minimal.addEventListener.mockImplementation(() => {
      throw new Error("not supported");
    });
    minimal.getVoices.mockImplementation(() => {
      throw new Error("not supported");
    });
    vi.stubGlobal("speechSynthesis", minimal);
    expect(() => primeSpeechEngine()).not.toThrow();
  });
});
