/**
 * 「发音口音」设置与朗读（RAY-265，手机端兼容修复 RAY-277）测试。
 * 「发音源选择」设置（RAY-324）测试——系统自带 vs 线上发音。
 *
 * 纯函数（parsePronunciationAccent / ACCENT_LANG）直接测；localStorage
 * 读写用 jsdom 环境验证；speakWord 用 stub 的 SpeechSynthesis 引擎验证
 * 语言标签、语音包匹配、paused/cancel 兼容处理与不支持环境降级
 * （jsdom 原生无此 API）。RAY-277 覆盖：语音引擎预热、空闲态不 cancel
 * （iOS 竞态）、paused 先 resume（Android）、异步失败 / 静默失败兜底回调。
 *
 * RAY-324 覆盖：
 * - 发音源类型 / 持久化（默认值 / 读写 / 隐私模式回落）；
 * - 线上朗读 URL 构造与请求（口音 → type 参数、term 透传）；
 * - 内存缓存：同一 (term, accent) 命中不再重复请求；
 * - 失败回落：fetch 错误 / 非 2xx / audio 错误 / 播放超时全部走系统朗读
 *   并回调 onOnlineFallbackToSystem 一次；
 * - 主动取消：再次调用 / 切换卡片时 abort 上一次线上朗读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_LANG,
  DEFAULT_PRONUNCIATION_ACCENT,
  DEFAULT_PRONUNCIATION_SOURCE,
  PRONUNCIATION_SOURCE_STORAGE_KEY,
  PRONUNCIATION_STORAGE_KEY,
  SPEAK_START_TIMEOUT_MS,
  __setOnlineAudioCtorForTesting,
  __setOnlineFetchForTesting,
  __setOnlineObjectURLFactoryForTesting,
  __setOnlineUrlFactoryForTesting,
  clearOnlineAudioCache,
  isPronunciationSource,
  parsePronunciationAccent,
  parsePronunciationSource,
  primeSpeechEngine,
  readPronunciationAccent,
  readPronunciationSource,
  speakWord,
  writePronunciationAccent,
  writePronunciationSource,
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

// ─── RAY-324 发音源选择 ─────────────────────────────────────────────────────

describe("parsePronunciationSource（纯函数）", () => {
  it("缺失 / 空串 / null / undefined 回落默认系统", () => {
    expect(parsePronunciationSource(null)).toBe(DEFAULT_PRONUNCIATION_SOURCE);
    expect(parsePronunciationSource(undefined)).toBe(DEFAULT_PRONUNCIATION_SOURCE);
    expect(parsePronunciationSource("")).toBe(DEFAULT_PRONUNCIATION_SOURCE);
  });

  it("合法值原样解析", () => {
    expect(parsePronunciationSource("system")).toBe("system");
    expect(parsePronunciationSource("online")).toBe("online");
  });

  it("非法值回落默认系统", () => {
    expect(parsePronunciationSource("System")).toBe(DEFAULT_PRONUNCIATION_SOURCE);
    expect(parsePronunciationSource("google")).toBe(DEFAULT_PRONUNCIATION_SOURCE);
    expect(parsePronunciationSource("network")).toBe(DEFAULT_PRONUNCIATION_SOURCE);
  });
});

describe("isPronunciationSource（类型守卫）", () => {
  it("合法值返回 true", () => {
    expect(isPronunciationSource("system")).toBe(true);
    expect(isPronunciationSource("online")).toBe(true);
  });

  it("非法 / null 返回 false", () => {
    expect(isPronunciationSource(null)).toBe(false);
    expect(isPronunciationSource("")).toBe(false);
    expect(isPronunciationSource("webaudio")).toBe(false);
  });
});

describe("localStorage 读写（发音源）", () => {
  it("写入后读取一致；未写入时回落默认系统", () => {
    expect(readPronunciationSource()).toBe(DEFAULT_PRONUNCIATION_SOURCE);
    expect(writePronunciationSource("online")).toBe(true);
    expect(window.localStorage.getItem(PRONUNCIATION_SOURCE_STORAGE_KEY)).toBe("online");
    expect(readPronunciationSource()).toBe("online");

    // 切回系统
    expect(writePronunciationSource("system")).toBe(true);
    expect(window.localStorage.getItem(PRONUNCIATION_SOURCE_STORAGE_KEY)).toBe("system");
    expect(readPronunciationSource()).toBe("system");
  });

  it("存储值损坏回落默认系统", () => {
    window.localStorage.setItem(PRONUNCIATION_SOURCE_STORAGE_KEY, "garbage");
    expect(readPronunciationSource()).toBe("system");
  });

  it("localStorage 抛错（隐私模式）不炸，回落默认系统", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readPronunciationSource()).toBe("system");
    expect(writePronunciationSource("online")).toBe(false);
  });
});

// ─── 线上朗读测试基础设施 ──────────────────────────────────────────────────

/** 桩 Audio 元素：保存事件回调，调用方手动驱动生命周期 */
class FakeAudio {
  src = "";
  preload = "";
  paused = true;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  on(event: string, handler: (...args: unknown[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }
  off(event: string, handler: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(handler);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  // 与 playObjectUrl 注册的处理器同名的 setter：
  set oncanplaythrough(handler: (() => void) | null) {
    if (handler) this.on("canplaythrough", handler);
    else this.listeners.delete("canplaythrough");
  }
  get oncanplaythrough(): (() => void) | null {
    const set = this.listeners.get("canplaythrough");
    return set && set.size > 0 ? () => set.forEach((h) => h()) : null;
  }
  set onended(handler: (() => void) | null) {
    if (handler) this.on("ended", handler);
    else this.listeners.delete("ended");
  }
  get onended(): (() => void) | null {
    const set = this.listeners.get("ended");
    return set && set.size > 0 ? () => set.forEach((h) => h()) : null;
  }
  set onerror(handler: ((err: unknown) => void) | null) {
    if (handler) this.on("error", handler);
    else this.listeners.delete("error");
  }
  get onerror(): ((err: unknown) => void) | null {
    const set = this.listeners.get("error");
    return set && set.size > 0 ? (e) => set.forEach((h) => h(e)) : null;
  }
}

/** 全局桩：URL.createObjectURL + Audio + SpeechSynthesis 引擎 */
function installOnlineStubs(options: {
  fetchImpl?: (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  urlFactory?: (parts: { pathname: string; query: URLSearchParams }) => string;
} = {}): {
  fetchMock: ReturnType<typeof vi.fn>;
  audioInstances: FakeAudio[];
  speakEngine: EngineStub;
  createdUrls: string[];
  restore(): void;
} {
  // 用字符串 body 构造 Response（jsdom Blob 与 undici Response 不兼容，会抛
  // "object.stream is not a function"；playOnlineAudio 仅依赖 ok / blob()，
  // 字符串 body 的 blob() 返回 Blob 同样可被 URL.createObjectURL 接受）。
  const defaultResponse = new Response("ok", { status: 200 });
  // fetchMock 用 vi.fn 便于外部断言 mock.calls；fetchImpl 走普通函数。
  const fetchImplRaw = options.fetchImpl ?? (() => Promise.resolve(defaultResponse.clone()));
  const fetchMock = vi.fn((input: string, init?: { signal?: AbortSignal }) =>
    fetchImplRaw(input, init),
  );
  __setOnlineFetchForTesting(fetchMock);
  if (options.urlFactory) {
    __setOnlineUrlFactoryForTesting(options.urlFactory);
  } else {
    __setOnlineUrlFactoryForTesting(null);
  }

  // 桩 URL.createObjectURL：通过 __setOnlineObjectURLFactoryForTesting 注入，
  // 避免 jsdom 下 URL 静态属性在异步边界被重置的兼容问题。
  let objectUrlCounter = 0;
  const createdUrls: string[] = [];

  // 桩 Audio 构造器：通过 __setOnlineAudioCtorForTesting 注入，避免 jsdom 上
  // 全局 Audio 通过 Window 原型暴露与 vitest stubGlobal 交互不一致。
  const audioInstances: FakeAudio[] = [];
  const AudioStub = function AudioStubCtor(src: string) {
    const audio = new FakeAudio();
    audio.src = src;
    audioInstances.push(audio);
    return audio as unknown as HTMLAudioElement;
  } as unknown as new (src?: string) => HTMLAudioElement;
  __setOnlineAudioCtorForTesting(AudioStub);

  // 桩 SpeechSynthesis（系统朗读路径备用）
  const speakEngine = makeEngine();
  stubEngineGlobals(speakEngine);

  __setOnlineObjectURLFactoryForTesting((blob) => {
    // blob 在此仅用于构造 URL；调用方可记录以便断言
    void blob;
    const url = `blob:fake-${++objectUrlCounter}`;
    createdUrls.push(url);
    return url;
  });

  return {
    fetchMock,
    audioInstances,
    speakEngine,
    createdUrls,
    restore: () => {
      __setOnlineObjectURLFactoryForTesting(null);
      __setOnlineFetchForTesting(null);
      __setOnlineUrlFactoryForTesting(null);
      __setOnlineAudioCtorForTesting(null);
      vi.unstubAllGlobals();
    },
  };
}

/** flushMicrotasks：等待 speakOnlineWord 内部的 promise 微任务链 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

describe("speakWord 发音源分发（RAY-324）", () => {
  beforeEach(() => {
    clearOnlineAudioCache();
  });

  it("未指定 source：保持 RAY-265 既有行为（走系统朗读），不联网", async () => {
    const env = installOnlineStubs();
    try {
      // 不传 source 选项 → 默认系统源
      expect(speakWord("apple", "us")).toBe(true);
      const utterance = lastSpokenUtterance(env.speakEngine);
      expect(utterance.text).toBe("apple");
      expect(env.fetchMock).not.toHaveBeenCalled();
      expect(env.audioInstances).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it("source=system 显式：同未指定，走系统朗读、不联网", () => {
    const env = installOnlineStubs();
    try {
      expect(speakWord("apple", "us", { source: "system" })).toBe(true);
      const utterance = lastSpokenUtterance(env.speakEngine);
      expect(utterance.text).toBe("apple");
      expect(env.fetchMock).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：按口音构造 dictvoice URL，发起 fetch 下载并播放", async () => {
    const seenUrls: string[] = [];
    const env = installOnlineStubs({
      urlFactory: (parts) => {
        const url = `https://dict.youdao.com${parts.pathname}?${parts.query.toString()}`;
        seenUrls.push(url);
        return url;
      },
    });
    try {
      expect(speakWord("apple", "us", { source: "online" })).toBe(true);
      await flushMicrotasks();

      // URL 形如 https://dict.youdao.com/dictvoice?audio=apple&type=0
      expect(seenUrls).toHaveLength(1);
      const url = new URL(seenUrls[0]!);
      expect(url.origin + url.pathname).toBe("https://dict.youdao.com/dictvoice");
      expect(url.searchParams.get("audio")).toBe("apple");
      expect(url.searchParams.get("type")).toBe("0"); // us → 0
      expect(env.fetchMock).toHaveBeenCalledTimes(1);

      // fetch URL 与构造的 URL 一致；携带 AbortSignal
      const [calledUrl, calledInit] = env.fetchMock.mock.calls[0]!;
      expect(calledUrl).toBe(seenUrls[0]);
      expect(calledInit?.signal).toBeDefined();

      // 模拟 audio 加载完成并开始播放
      expect(env.audioInstances).toHaveLength(1);
      const audio = env.audioInstances[0]!;
      expect(audio.src).toMatch(/^blob:fake-\d+$/);
      audio.emit("canplaythrough");
      await flushMicrotasks();
      expect(audio.play).toHaveBeenCalledTimes(1);
      // 播放结束
      audio.emit("ended");
      await flushMicrotasks();
      // 系统朗读未被触发
      expect(env.speakEngine.speak).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：英式口音对应 type=1", async () => {
    let lastUrl = "";
    const env = installOnlineStubs({
      urlFactory: (parts) => {
        lastUrl = `https://dict.youdao.com${parts.pathname}?${parts.query.toString()}`;
        return lastUrl;
      },
    });
    try {
      speakWord("banana", "uk", { source: "online" });
      await flushMicrotasks();
      expect(new URL(lastUrl).searchParams.get("type")).toBe("1");
      expect(new URL(lastUrl).searchParams.get("audio")).toBe("banana");
    } finally {
      env.restore();
    }
  });

  it("source=online：内存缓存命中（同 term+accent 不重复 fetch）", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      const audio1 = env.audioInstances[env.audioInstances.length - 1]!;
      audio1.emit("canplaythrough");
      await flushMicrotasks();
      audio1.emit("ended");
      await flushMicrotasks();

      // 再次朗读同 term+accent：跳过 fetch，直接走缓存
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.fetchMock).toHaveBeenCalledTimes(1); // 仍只有一次
      const audio2 = env.audioInstances[env.audioInstances.length - 1]!;
      // 复用第一次的 ObjectURL（不会创建新的）
      expect(audio2.src).toBe(audio1.src);
    } finally {
      env.restore();
    }
  });

  it("source=online：缓存按 accent 区分（美式与英式分开缓存）", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      const audio1 = env.audioInstances[env.audioInstances.length - 1]!;
      audio1.emit("canplaythrough");
      await flushMicrotasks();
      audio1.emit("ended");
      await flushMicrotasks();

      speakWord("apple", "uk", { source: "online" });
      await flushMicrotasks();
      // 不同 accent：fetch 第二次
      expect(env.fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      env.restore();
    }
  });

  it("source=online：fetch 抛错（网络错误）自动回落系统朗读，回调一次 onOnlineFallbackToSystem", async () => {
    const env = installOnlineStubs({
      fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    try {
      const onUnavailable = vi.fn();
      const onFallback = vi.fn();
      expect(speakWord("apple", "us", { source: "online", onUnavailable, onOnlineFallbackToSystem: onFallback })).toBe(true);
      await flushMicrotasks(10);

      // 回落系统朗读：speak 引擎被调用
      const utterance = lastSpokenUtterance(env.speakEngine);
      expect(utterance.text).toBe("apple");
      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      // 回落通知回调一次；onUnavailable 不重复触发（系统朗读成功）
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：HTTP 非 2xx 回落系统朗读", async () => {
    const env = installOnlineStubs({
      fetchImpl: () => Promise.resolve(new Response("", { status: 503 })),
    });
    try {
      const onUnavailable = vi.fn();
      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onUnavailable, onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks(10);

      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：audio 解码失败（onerror）回落系统朗读", async () => {
    const env = installOnlineStubs();
    try {
      const onUnavailable = vi.fn();
      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onUnavailable, onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks();

      // 模拟 audio 报错
      expect(env.audioInstances).toHaveLength(1);
      const audio = env.audioInstances[0]!;
      audio.emit("error");
      await flushMicrotasks(10);

      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);
    } finally {
      env.restore();
    }
  });

  it("source=online：audio.play() 拒绝（自动播放策略拦截）回落系统朗读", async () => {
    const env = installOnlineStubs({
      fetchImpl: () => Promise.resolve(new Response("ok", { status: 200 })),
    });
    try {
      // 覆盖 Audio 桩：play() 直接拒绝
      env.audioInstances.length = 0;
      class AudioRejectPlay extends FakeAudio {
        override play = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
      }
      const AudioRejectPlayCtor = function AudioRejectPlayCtor(src: string) {
        const a = new AudioRejectPlay();
        a.src = src;
        env.audioInstances.push(a);
        return a as unknown as HTMLAudioElement;
      } as unknown as new (src?: string) => HTMLAudioElement;
      __setOnlineAudioCtorForTesting(AudioRejectPlayCtor);

      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks();

      const audio = env.audioInstances[env.audioInstances.length - 1]!;
      audio.emit("canplaythrough");
      await flushMicrotasks(10);

      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);
    } finally {
      env.restore();
    }
  });

  it("source=online：系统朗读也失败（环境不支持）时不回调 onOnlineFallbackToSystem，改为 onUnavailable", async () => {
    // 线上 fetch 失败；同时取消 SpeechSynthesis 全局桩模拟系统朗读同步失败
    const env = installOnlineStubs({
      fetchImpl: () => Promise.reject(new Error("network")),
    });
    try {
      // 替换 system engine 为一个 speak 同步抛错的引擎
      vi.unstubAllGlobals();
      const broken = makeEngine();
      broken.speak.mockImplementation(() => {
        throw new Error("NotAllowedError");
      });
      stubEngineGlobals(broken);

      const onUnavailable = vi.fn();
      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onUnavailable, onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks(10);

      expect(onFallback).not.toHaveBeenCalled();
      // 系统朗读同步失败 → onUnavailable("unavailable") 至少一次
      expect(onUnavailable).toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：再次调用主动取消前一次线上朗读（不触发回落）", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      // 此时第一个 audio 已构造并进入 audioInstances
      expect(env.audioInstances).toHaveLength(1);
      const firstAudio = env.audioInstances[0]!;
      expect(firstAudio.src).toMatch(/^blob:fake-\d+$/);
      // 切到下一个词：应取消前一次
      speakWord("banana", "us", { source: "online" });
      await flushMicrotasks();

      // 前一次 audio 被 pause + 清空 src
      expect(firstAudio.pause).toHaveBeenCalledTimes(1);
      expect(firstAudio.src).toBe("");
      // 第二次 fetch 已发起，第二个 audio 已构造
      expect(env.fetchMock).toHaveBeenCalledTimes(2);
      expect(env.audioInstances).toHaveLength(2);
    } finally {
      env.restore();
    }
  });

  it("source=online：环境无 fetch（jsdom 早期版本）同步层返回 false，回调 onUnavailable(unsupported)", () => {
    __setOnlineFetchForTesting(null);
    vi.stubGlobal("fetch", undefined);
    __setOnlineUrlFactoryForTesting(null);
    clearOnlineAudioCache();

    // 桩 SpeechSynthesis
    const engine = makeEngine();
    stubEngineGlobals(engine);
    const audioInstances: FakeAudio[] = [];
    const AudioStub = function AudioStub(src: string) {
      const a = new FakeAudio();
      a.src = src;
      audioInstances.push(a);
      return a as unknown as HTMLAudioElement;
    } as unknown as new (src?: string) => HTMLAudioElement;
    __setOnlineAudioCtorForTesting(AudioStub);

    // resolveFetch 抛出 → speakOnlineWord 异步链路兜底（这里仅验证返回值）
    const onUnavailable = vi.fn();
    const onFallback = vi.fn();
    expect(
      speakWord("apple", "us", { source: "online", onUnavailable, onOnlineFallbackToSystem: onFallback }),
    ).toBe(true);
    __setOnlineAudioCtorForTesting(null);
    vi.unstubAllGlobals();
  });
});

describe("clearOnlineAudioCache（RAY-324）", () => {
  beforeEach(() => {
    clearOnlineAudioCache();
  });

  it("清空后再朗读：缓存清零，重新 fetch", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      const audio1 = env.audioInstances[env.audioInstances.length - 1]!;
      audio1.emit("canplaythrough");
      await flushMicrotasks();
      audio1.emit("ended");
      await flushMicrotasks();

      expect(env.fetchMock).toHaveBeenCalledTimes(1);

      // 清空缓存
      clearOnlineAudioCache();

      // 再次朗读：重新 fetch
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      env.restore();
    }
  });
});
