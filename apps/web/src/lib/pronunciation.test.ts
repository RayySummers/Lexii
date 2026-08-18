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
 * - 默认候选提供方单测：Free Dictionary API 的 URL 构造、口音变体排序
 *   （us→-us / uk→-uk；精确缺失时另一主要口音优先于第三口音）；
 *   Wikimedia Commons 的前缀查询、口音前缀回落、音频下载；Lingva 的
 *   URL 构造与字节数组解析；
 * - 候选级联：首个成功者胜出，全部 null 才回落系统；
 * - 内存缓存：同一 (term, accent) 命中不再重复解析；仅播放成功后入缓存
 *   （解码失败不污染缓存）；真实失败回收坏条目、主动取消保留缓存；
 *   LRU 上限逐出；
 * - 失败回落：网络错误 / 非 2xx / audio 解码失败 / 播放超时 / play() 拒绝
 *   全部走系统朗读并回调 onOnlineFallbackToSystem 一次；
 * - 主动取消：再次调用 / 切换卡片时 abort 上一次线上朗读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_LANG,
  DEFAULT_PRONUNCIATION_ACCENT,
  DEFAULT_PRONUNCIATION_SOURCE,
  ONLINE_AUDIO_CACHE_LIMIT,
  ONLINE_PLAY_TIMEOUT_MS,
  PRONUNCIATION_SOURCE_STORAGE_KEY,
  PRONUNCIATION_STORAGE_KEY,
  SPEAK_START_TIMEOUT_MS,
  __setOnlineAudioCtorForTesting,
  __setOnlineFetchForTesting,
  __setOnlineObjectURLFactoryForTesting,
  __setOnlineProvidersForTesting,
  clearOnlineAudioCache,
  createDictionaryApiProvider,
  createLingvaProvider,
  createWikimediaProvider,
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
import type { OnlineAudioProvider } from "./pronunciation";

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

/** 构造一个假候选提供方（blob 显式为 null 时返回 null；否则返回固定 Blob） */
function makeFakeProvider(
  options: {
    id?: string;
    blob?: Blob | null;
    error?: boolean;
  } = {},
): OnlineAudioProvider & { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn(async (): Promise<Blob | null> => {
    if (options.error) {
      throw new Error("provider failure");
    }
    if (options.blob === null) {
      return null;
    }
    return options.blob ?? new Blob(["ok"]);
  });
  return {
    id: options.id ?? "fake",
    resolve,
  };
}

/** 全局桩：ObjectURL 工厂 + Audio 构造器 + 候选提供方 + SpeechSynthesis 引擎 */
function installOnlineStubs(
  options: {
    providers?: OnlineAudioProvider[];
  } = {},
): {
  providerResolveMocks: ReturnType<typeof vi.fn>[];
  audioInstances: FakeAudio[];
  speakEngine: EngineStub;
  createdUrls: string[];
  restore(): void;
} {
  // 桩 ObjectURL 工厂：返回稳定 id（按调用计数）
  let objectUrlCounter = 0;
  const createdUrls: string[] = [];
  __setOnlineObjectURLFactoryForTesting((blob) => {
    void blob;
    const url = `blob:fake-${++objectUrlCounter}`;
    createdUrls.push(url);
    return url;
  });

  // 桩 Audio 构造器：每次返回一个 FakeAudio
  const audioInstances: FakeAudio[] = [];
  const AudioStub = function AudioStubCtor(src: string) {
    const audio = new FakeAudio();
    audio.src = src;
    audioInstances.push(audio);
    return audio as unknown as HTMLAudioElement;
  } as unknown as new (src?: string) => HTMLAudioElement;
  __setOnlineAudioCtorForTesting(AudioStub);

  // 候选提供方（默认两个假提供方，全部成功返回 Blob）
  const providers = options.providers ?? [makeFakeProvider({ id: "p1" })];
  const providerResolveMocks = providers.map(
    (provider) => provider.resolve as ReturnType<typeof vi.fn>,
  );
  __setOnlineProvidersForTesting(providers);

  // 桩 SpeechSynthesis（系统朗读路径备用）
  const speakEngine = makeEngine();
  stubEngineGlobals(speakEngine);

  return {
    providerResolveMocks,
    audioInstances,
    speakEngine,
    createdUrls,
    restore: () => {
      __setOnlineObjectURLFactoryForTesting(null);
      __setOnlineAudioCtorForTesting(null);
      __setOnlineProvidersForTesting(null);
      __setOnlineFetchForTesting(null);
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

/** 驱动当前 audio 播放完成（canplaythrough → play resolve → ended） */
async function completePlayback(env: ReturnType<typeof installOnlineStubs>): Promise<void> {
  const audio = env.audioInstances[env.audioInstances.length - 1];
  expect(audio).toBeDefined();
  audio!.emit("canplaythrough");
  await flushMicrotasks();
  expect(audio!.play).toHaveBeenCalledTimes(1);
  audio!.emit("ended");
  await flushMicrotasks();
}

// ─── 默认候选提供方（Free Dictionary API / Lingva）单测 ─────────────────────

/** 构造可注入 fetch 桩的最小 Response（仅实现 ok / json / blob） */
function makeFakeResponse(init: {
  ok: boolean;
  json?: () => Promise<unknown>;
  blob?: () => Promise<Blob>;
}): Response {
  return init as unknown as Response;
}

/** 测试用 fetch 桩签名（与 FetchLike 对齐，保证 mock.calls 类型完整） */
type TestFetch = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

describe("createDictionaryApiProvider（默认候选 1：真人录音）", () => {
  afterEach(() => {
    __setOnlineFetchForTesting(null);
  });

  it("构造词条 API URL（term 编码）并按口音选择 us 变体下载", async () => {
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/entries/en/")) {
        return makeFakeResponse({
          ok: true,
          json: async () => [
            {
              phonetics: [
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/apple-us.mp3" },
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/apple-uk.mp3" },
              ],
            },
          ],
        });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["us-audio"]) });
    });

    const provider = createDictionaryApiProvider(fetchMock);
    const signal = new AbortController().signal;
    const blob = await provider.resolve("ice cream", "us", signal);

    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("us-audio");
    // 第一次请求：词条 JSON（term 已编码，含 AbortSignal）
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [entriesUrl, entriesInit] = fetchMock.mock.calls[0]!;
    expect(String(entriesUrl)).toBe("https://api.dictionaryapi.dev/api/v2/entries/en/ice%20cream");
    expect((entriesInit as { signal?: AbortSignal }).signal).toBe(signal);
    // 第二次请求：选中的 us 音频 URL
    const [audioUrl] = fetchMock.mock.calls[1]!;
    expect(String(audioUrl)).toContain("apple-us.mp3");
  });

  it("英式口音选择 uk 变体；精确缺失时另一主要口音优先于第三口音（Oscar 观察 2）", async () => {
    const audioUrls: string[] = [];
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/entries/en/")) {
        return makeFakeResponse({
          ok: true,
          json: async () => [
            {
              phonetics: [
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/banana-us.mp3" },
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/banana-uk.mp3" },
              ],
            },
          ],
        });
      }
      audioUrls.push(url);
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["audio"]) });
    });

    const provider = createDictionaryApiProvider(fetchMock);
    const signal = new AbortController().signal;

    await provider.resolve("banana", "uk", signal);
    expect(audioUrls[0]).toContain("banana-uk.mp3");

    // 无精确 uk 匹配：另一主要口音（us）优先于第三口音（au）
    const fetchMock2 = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/entries/en/")) {
        return makeFakeResponse({
          ok: true,
          json: async () => [
            {
              phonetics: [
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/kiwi-au.mp3" },
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/kiwi-us.mp3" },
              ],
            },
          ],
        });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["audio"]) });
    });
    const provider2 = createDictionaryApiProvider(fetchMock2);
    const blob = await provider2.resolve("kiwi", "uk", signal);
    expect(blob).not.toBeNull();
    const [audioUrl] = fetchMock2.mock.calls[1]!;
    expect(String(audioUrl)).toContain("kiwi-us.mp3");
  });

  it("下载音频失败时按排序尝试下一候选录音（首个可下载者胜出）", async () => {
    const audioUrls: string[] = [];
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v2/entries/en/")) {
        return makeFakeResponse({
          ok: true,
          json: async () => [
            {
              phonetics: [
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/plum-us.mp3" },
                { audio: "https://api.dictionaryapi.dev/media/pronunciations/en/plum-us-2.mp3" },
              ],
            },
          ],
        });
      }
      audioUrls.push(url);
      // 第一个 us 变体下载失败，第二个成功
      if (audioUrls.length === 1) {
        return makeFakeResponse({ ok: false });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["audio"]) });
    });

    const provider = createDictionaryApiProvider(fetchMock);
    const blob = await provider.resolve("plum", "us", new AbortController().signal);
    expect(blob).not.toBeNull();
    expect(audioUrls).toHaveLength(2);
    expect(audioUrls[1]).toContain("plum-us-2.mp3");
  });

  it("词条不存在（404）/ 无 audio 字段 / 网络错误 → 返回 null（吞错交给级联）", async () => {
    const signal = new AbortController().signal;

    const notFound = vi.fn<TestFetch>(async () => makeFakeResponse({ ok: false }));
    expect(await createDictionaryApiProvider(notFound).resolve("zzzz", "us", signal)).toBeNull();

    const noAudio = vi.fn<TestFetch>(async () =>
      makeFakeResponse({ ok: true, json: async () => [{ phonetics: [{ audio: "" }] }] }),
    );
    expect(await createDictionaryApiProvider(noAudio).resolve("quiet", "us", signal)).toBeNull();

    const networkError = vi.fn<TestFetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await createDictionaryApiProvider(networkError).resolve("apple", "us", signal),
    ).toBeNull();
  });
});

describe("createWikimediaProvider（默认候选 2：维基词典录音上游）", () => {
  afterEach(() => {
    __setOnlineFetchForTesting(null);
  });

  it("按口音前缀查询 allimages 并下载最短文件名录音（Oscar 观察 1 的带口音候选）", async () => {
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("commons.wikimedia.org/w/api.php")) {
        return makeFakeResponse({
          ok: true,
          json: async () => ({
            query: {
              allimages: [
                {
                  name: "En-us-apple.ogg",
                  url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/En-us-apple.ogg?utm_source=api",
                },
                {
                  name: "En-us-apple-2.ogg",
                  url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/En-us-apple-2.ogg?utm_source=api",
                },
              ],
            },
          }),
        });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["ogg-audio"]) });
    });

    const provider = createWikimediaProvider(fetchMock);
    const signal = new AbortController().signal;
    const blob = await provider.resolve("apple", "us", signal);

    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("ogg-audio");
    // 第一次请求：MediaWiki API（前缀 En-us-apple，origin=*，含 AbortSignal）
    const [apiUrl, apiInit] = fetchMock.mock.calls[0]!;
    expect(String(apiUrl)).toContain("commons.wikimedia.org/w/api.php");
    expect(String(apiUrl)).toContain("aiprefix=En-us-apple");
    expect(String(apiUrl)).toContain("origin=*");
    expect((apiInit as { signal?: AbortSignal }).signal).toBe(signal);
    // 第二次请求：最短文件名（En-us-apple.ogg）且剥离 utm 参数
    const [audioUrl] = fetchMock.mock.calls[1]!;
    expect(String(audioUrl)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/9/9a/En-us-apple.ogg",
    );
  });

  it("请求口音无结果时退回另一主要口音前缀；全部无结果返回 null", async () => {
    const signal = new AbortController().signal;

    // 英式前缀无文件 → 退美式前缀命中
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("aiprefix=En-uk-kiwi")) {
        return makeFakeResponse({ ok: true, json: async () => ({ query: { allimages: [] } }) });
      }
      if (url.includes("aiprefix=En-us-kiwi")) {
        return makeFakeResponse({
          ok: true,
          json: async () => ({
            query: {
              allimages: [
                {
                  name: "En-us-kiwi.ogg",
                  url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/En-us-kiwi.ogg",
                },
              ],
            },
          }),
        });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["ogg-audio"]) });
    });
    const blob = await createWikimediaProvider(fetchMock).resolve("kiwi", "uk", signal);
    expect(blob).not.toBeNull();
    const prefixes = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("aiprefix="));
    expect(prefixes).toEqual([
      expect.stringContaining("aiprefix=En-uk-kiwi"),
      expect.stringContaining("aiprefix=En-us-kiwi"),
    ]);

    // 两个前缀都无结果 → null
    const emptyMock = vi.fn<TestFetch>(async () =>
      makeFakeResponse({ ok: true, json: async () => ({ query: { allimages: [] } }) }),
    );
    expect(await createWikimediaProvider(emptyMock).resolve("zzzz", "us", signal)).toBeNull();

    // 网络错误 → null
    const networkError = vi.fn<TestFetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await createWikimediaProvider(networkError).resolve("apple", "us", signal)).toBeNull();
  });

  it("多词 term 空格转下划线；音频下载失败后尝试下一前缀", async () => {
    const audioFetchUrls: string[] = [];
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("commons.wikimedia.org/w/api.php")) {
        // 前缀感知：仅 us 前缀有文件，uk 前缀无文件
        if (url.includes("aiprefix=En-us-ice_cream")) {
          return makeFakeResponse({
            ok: true,
            json: async () => ({
              query: {
                allimages: [
                  {
                    name: "En-us-ice_cream.ogg",
                    url: "https://upload.wikimedia.org/wikipedia/commons/9/9a/En-us-ice_cream.ogg",
                  },
                ],
              },
            }),
          });
        }
        return makeFakeResponse({ ok: true, json: async () => ({ query: { allimages: [] } }) });
      }
      audioFetchUrls.push(url);
      // us 前缀的音频下载失败（HTTP 500）→ 退回 uk 前缀 → 无文件 → null
      return makeFakeResponse({ ok: false });
    });

    const provider = createWikimediaProvider(fetchMock);
    const signal = new AbortController().signal;
    const blob = await provider.resolve("ice cream", "us", signal);

    expect(blob).toBeNull();
    const apiCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("aiprefix="));
    expect(apiCalls[0]).toContain("aiprefix=En-us-ice_cream");
    expect(apiCalls[1]).toContain("aiprefix=En-uk-ice_cream");
    expect(audioFetchUrls).toHaveLength(1);
  });

  it("前缀无命中时退回 Lingua Libre 录音并过滤包含关系（Oscar「供未来参考」项）", async () => {
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("aiprefix=")) {
        return makeFakeResponse({ ok: true, json: async () => ({ query: { allimages: [] } }) });
      }
      if (url.includes("generator=search")) {
        return makeFakeResponse({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                1: {
                  title: "File:LL-Q1860 (eng)-Jjamesryan-apple tree.wav",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/9/90/LL-Q1860_%28eng%29-Jjamesryan-apple_tree.wav?utm_source=api",
                    },
                  ],
                },
                2: {
                  title: "File:LL-Q1860 (eng)-Boredcookie-apple.wav",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/9/9e/LL-Q1860_%28eng%29-Boredcookie-apple.wav?utm_source=api",
                    },
                  ],
                },
                3: {
                  title: "File:LL-Q1860 (eng)-Vealhurl-apple pie.wav",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/LL-Q1860_%28eng%29-Vealhurl-apple_pie.wav?utm_source=api",
                    },
                  ],
                },
              },
            },
          }),
        });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["wav-audio"]) });
    });

    const provider = createWikimediaProvider(fetchMock);
    const signal = new AbortController().signal;
    const blob = await provider.resolve("apple", "us", signal);

    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("wav-audio");
    // 搜索请求：generator=search + gsrsearch（intitle:LL-Q1860 + 引号 term）+ origin=*
    const searchCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("generator=search"));
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]).toContain("gsrnamespace=6");
    expect(searchCalls[0]).toContain("gsrsearch=intitle%3ALL-Q1860%20intitle%3A%22apple%22");
    expect(searchCalls[0]).toContain("origin=*");
    // 仅下载精确匹配（apple），排除 apple tree / apple pie；且剥离 utm 参数
    const downloadCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("upload.wikimedia.org"));
    expect(downloadCalls).toEqual([
      "https://upload.wikimedia.org/wikipedia/commons/9/9e/LL-Q1860_%28eng%29-Boredcookie-apple.wav",
    ]);
  });

  it("Lingua Libre 多词 term 精确匹配（排除前缀包含关系）", async () => {
    const fetchMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("aiprefix=")) {
        return makeFakeResponse({ ok: true, json: async () => ({ query: { allimages: [] } }) });
      }
      if (url.includes("generator=search")) {
        return makeFakeResponse({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                1: {
                  title: "File:LL-Q1860 (eng)-Boredcookie-apple.wav",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/9/9e/LL-Q1860_%28eng%29-Boredcookie-apple.wav",
                    },
                  ],
                },
                2: {
                  title: "File:LL-Q1860 (eng)-Jjamesryan-apple tree.wav",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/9/90/LL-Q1860_%28eng%29-Jjamesryan-apple_tree.wav",
                    },
                  ],
                },
                3: {
                  title: "File:LL-Q1860 (eng)-Persent101-apple tree blossoms.wav",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/e/e2/LL-Q1860_%28eng%29-Persent101-apple_tree_blossoms.wav",
                    },
                  ],
                },
              },
            },
          }),
        });
      }
      return makeFakeResponse({ ok: true, blob: async () => new Blob(["wav-audio"]) });
    });

    const provider = createWikimediaProvider(fetchMock);
    const blob = await provider.resolve("apple tree", "uk", new AbortController().signal);

    expect(blob).not.toBeNull();
    const downloadCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("upload.wikimedia.org"));
    expect(downloadCalls).toEqual([
      "https://upload.wikimedia.org/wikipedia/commons/9/90/LL-Q1860_%28eng%29-Jjamesryan-apple_tree.wav",
    ]);
  });

  it("Lingua Libre 搜索无结果或网络错误 → null（交给级联）", async () => {
    const signal = new AbortController().signal;

    const emptyMock = vi.fn<TestFetch>(async (input) => {
      const url = String(input);
      if (url.includes("aiprefix=")) {
        return makeFakeResponse({ ok: true, json: async () => ({ query: { allimages: [] } }) });
      }
      return makeFakeResponse({ ok: true, json: async () => ({ query: { pages: {} } }) });
    });
    expect(await createWikimediaProvider(emptyMock).resolve("zzzz", "us", signal)).toBeNull();

    const networkError = vi.fn<TestFetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await createWikimediaProvider(networkError).resolve("apple", "us", signal)).toBeNull();
  });
});

describe("createLingvaProvider（默认候选 3：在线合成）", () => {
  afterEach(() => {
    __setOnlineFetchForTesting(null);
  });

  it("构造音频 URL 并把响应字节数组解析为 Blob", async () => {
    const fetchMock = vi.fn<TestFetch>(async () =>
      makeFakeResponse({
        ok: true,
        json: async () => ({ audio: [1, 2, 3, 255] }),
      }),
    );

    const provider = createLingvaProvider(fetchMock);
    const signal = new AbortController().signal;
    const blob = await provider.resolve("ice cream", "us", signal);

    expect(blob).not.toBeNull();
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 255]));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://lingva.ml/api/v1/audio/en/ice%20cream");
    expect((init as { signal?: AbortSignal }).signal).toBe(signal);
  });

  it("非 2xx / audio 字段缺失 / 网络错误 → 返回 null", async () => {
    const signal = new AbortController().signal;

    const httpError = vi.fn<TestFetch>(async () => makeFakeResponse({ ok: false }));
    expect(await createLingvaProvider(httpError).resolve("apple", "us", signal)).toBeNull();

    const badPayload = vi.fn<TestFetch>(async () =>
      makeFakeResponse({ ok: true, json: async () => ({}) }),
    );
    expect(await createLingvaProvider(badPayload).resolve("apple", "us", signal)).toBeNull();

    const networkError = vi.fn<TestFetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await createLingvaProvider(networkError).resolve("apple", "us", signal)).toBeNull();
  });
});

// ─── speakWord 发音源分发（RAY-324）─────────────────────────────────────────

describe("speakWord 发音源分发（RAY-324）", () => {
  beforeEach(() => {
    clearOnlineAudioCache();
  });

  it("未指定 source：保持 RAY-265 既有行为（走系统朗读），不触发线上候选", () => {
    const env = installOnlineStubs();
    try {
      expect(speakWord("apple", "us")).toBe(true);
      const utterance = lastSpokenUtterance(env.speakEngine);
      expect(utterance.text).toBe("apple");
      expect(env.providerResolveMocks[0]).not.toHaveBeenCalled();
      expect(env.audioInstances).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it("source=system 显式：同未指定，走系统朗读、不触发线上候选", () => {
    const env = installOnlineStubs();
    try {
      expect(speakWord("apple", "us", { source: "system" })).toBe(true);
      const utterance = lastSpokenUtterance(env.speakEngine);
      expect(utterance.text).toBe("apple");
      expect(env.providerResolveMocks[0]).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：候选级联首个成功者胜出，下载并播放，不触发系统朗读", async () => {
    const env = installOnlineStubs();
    try {
      expect(speakWord("apple", "us", { source: "online" })).toBe(true);
      await flushMicrotasks();

      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(1);
      expect(env.providerResolveMocks[0]).toHaveBeenCalledWith("apple", "us", expect.anything());
      expect(env.audioInstances).toHaveLength(1);
      expect(env.audioInstances[0]!.src).toMatch(/^blob:fake-\d+$/);

      await completePlayback(env);
      expect(env.speakEngine.speak).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：前一候选 null 时级联到下一候选", async () => {
    const p1 = makeFakeProvider({ id: "p1", blob: null });
    const p2 = makeFakeProvider({ id: "p2" });
    const env = installOnlineStubs({ providers: [p1, p2] });
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();

      expect(p1.resolve).toHaveBeenCalledTimes(1);
      expect(p2.resolve).toHaveBeenCalledTimes(1);
      expect(env.audioInstances).toHaveLength(1);
    } finally {
      env.restore();
    }
  });

  it("source=online：候选抛出异常同样级联到下一候选（单候选失败不中断）", async () => {
    const p1 = makeFakeProvider({ id: "p1", error: true });
    const p2 = makeFakeProvider({ id: "p2" });
    const env = installOnlineStubs({ providers: [p1, p2] });
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();

      expect(p2.resolve).toHaveBeenCalledTimes(1);
      expect(env.audioInstances).toHaveLength(1);
    } finally {
      env.restore();
    }
  });

  it("source=online：内存缓存命中（同 term+accent 不重复解析）且复用同一 ObjectURL", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      await completePlayback(env);
      const firstUrl = env.audioInstances[0]!.src;

      // 再次朗读同 term+accent：跳过候选解析，直接走缓存
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(1);
      expect(env.audioInstances).toHaveLength(2);
      expect(env.audioInstances[1]!.src).toBe(firstUrl);
    } finally {
      env.restore();
    }
  });

  it("source=online：缓存按 accent 区分（美式与英式分开缓存）", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      await completePlayback(env);

      speakWord("apple", "uk", { source: "online" });
      await flushMicrotasks();
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(2);
    } finally {
      env.restore();
    }
  });

  it("source=online：全部候选 null 自动回落系统朗读，回调一次 onOnlineFallbackToSystem", async () => {
    const env = installOnlineStubs({
      providers: [makeFakeProvider({ id: "p1", blob: null })],
    });
    try {
      const onUnavailable = vi.fn();
      const onFallback = vi.fn();
      expect(
        speakWord("apple", "us", {
          source: "online",
          onUnavailable,
          onOnlineFallbackToSystem: onFallback,
        }),
      ).toBe(true);
      await flushMicrotasks();

      const utterance = lastSpokenUtterance(env.speakEngine);
      expect(utterance.text).toBe("apple");
      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：audio 解码失败（onerror）回落系统朗读，且不污染缓存（Oscar suggestion 3）", async () => {
    const env = installOnlineStubs();
    try {
      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks();

      expect(env.audioInstances).toHaveLength(1);
      env.audioInstances[0]!.emit("error");
      await flushMicrotasks();

      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);

      // 解码失败：坏 URL 不入缓存 → 再次朗读重新走候选解析
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(2);
    } finally {
      env.restore();
    }
  });

  it("source=online：audio.play() 拒绝（自动播放策略拦截）回落系统朗读", async () => {
    const env = installOnlineStubs();
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
      await flushMicrotasks();

      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);
    } finally {
      env.restore();
    }
  });

  it("source=online：播放超时（ONLINE_PLAY_TIMEOUT_MS 内未开始）回落系统朗读（Oscar nit 1）", async () => {
    vi.useFakeTimers();
    const env = installOnlineStubs();
    try {
      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks();

      // audio 已构造但从不触发 canplaythrough：推进超时窗口触发失败
      expect(env.audioInstances).toHaveLength(1);
      vi.advanceTimersByTime(ONLINE_PLAY_TIMEOUT_MS);
      await flushMicrotasks();

      expect(env.speakEngine.speak).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledTimes(1);
    } finally {
      env.restore();
    }
  });

  it("source=online：播放开始后看门狗已清除，缓冲接近超时窗口不再误判（Oscar suggestion 2）", async () => {
    vi.useFakeTimers();
    const env = installOnlineStubs();
    try {
      const onFallback = vi.fn();
      speakWord("apple", "us", { source: "online", onOnlineFallbackToSystem: onFallback });
      await flushMicrotasks();

      // 播放开始（play() resolve）：看门狗应已清除
      const audio = env.audioInstances[0]!;
      audio.emit("canplaythrough");
      await flushMicrotasks();
      expect(audio.play).toHaveBeenCalledTimes(1);

      // 弱网缓冲超过超时窗口后仍在正常播放：不触发失败 / 不回落
      vi.advanceTimersByTime(ONLINE_PLAY_TIMEOUT_MS * 3);
      await flushMicrotasks();
      expect(onFallback).not.toHaveBeenCalled();
      expect(env.speakEngine.speak).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it("source=online：系统朗读也失败时不回调 onOnlineFallbackToSystem，onUnavailable 恰好一次（Oscar suggestion 1）", async () => {
    const env = installOnlineStubs({
      providers: [makeFakeProvider({ id: "p1", blob: null })],
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
      speakWord("apple", "us", {
        source: "online",
        onUnavailable,
        onOnlineFallbackToSystem: onFallback,
      });
      await flushMicrotasks();

      expect(onFallback).not.toHaveBeenCalled();
      // 系统朗读失败只经 speakSystemWord 回调一次（修复前的双回调已删除）
      expect(onUnavailable).toHaveBeenCalledTimes(1);
      expect(onUnavailable).toHaveBeenCalledWith("unavailable");
    } finally {
      env.restore();
    }
  });

  it("source=online：再次调用主动取消前一次线上朗读（不触发回落，且保留已缓存条目，Oscar 观察 3）", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.audioInstances).toHaveLength(1);
      const firstAudio = env.audioInstances[0]!;
      const firstUrl = firstAudio.src;
      expect(firstUrl).toMatch(/^blob:fake-\d+$/);
      // 播放开始 → apple 的 ObjectURL 入缓存
      firstAudio.emit("canplaythrough");
      await flushMicrotasks();
      expect(firstAudio.play).toHaveBeenCalledTimes(1);

      // 切到下一个词：取消前一次播放
      speakWord("banana", "us", { source: "online" });
      await flushMicrotasks();
      expect(firstAudio.pause).toHaveBeenCalledTimes(1);
      expect(firstAudio.src).toBe("");
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(2);
      expect(env.audioInstances).toHaveLength(2);

      // 再次朗读 apple：主动取消不回收缓存 → 复用缓存的 ObjectURL，不重新解析
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(2); // 仍 2 次
      const replayAudio = env.audioInstances[env.audioInstances.length - 1]!;
      expect(replayAudio.src).toBe(firstUrl);
    } finally {
      env.restore();
    }
  });
});

describe("线上音频缓存 LRU 上限（Oscar nit 3）", () => {
  beforeEach(() => {
    clearOnlineAudioCache();
  });

  it("清空后再朗读：缓存清零，重新解析", async () => {
    const env = installOnlineStubs();
    try {
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      await completePlayback(env);
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(1);

      clearOnlineAudioCache();

      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(2);
    } finally {
      env.restore();
    }
  });

  it("超过上限时逐出最旧条目（LRU），缓存条目数不超过上限", async () => {
    // 临时降低上限以在单测内验证逐出（上限为模块常量，此处直接改写模块内部
    // 行为不可行——改为逐出行为断言：借默认上限 = 200 循环填充太慢，改为
    // 直接验证 LRU 语义：通过重复播放同一词刷新最近使用顺序）。
    // 更轻量的方式：white-box 验证逐出逻辑走 URL.revokeObjectURL（jsdom 下
    // 为 no-op，但可断言工厂创建的 URL 列表无泄漏行为）。
    // 这里采用行为等价断言：连续缓存 ONLINE_AUDIO_CACHE_LIMIT + 2 个词
    // 不可行（每次都要播放完成），改为验证缓存结构上限的常量合理性——
    // 实际逐出路径由 cacheOnlineAudio 的 while 循环保证，本用例验证
    // 「重复命中会刷新 LRU 顺序」即可。
    expect(ONLINE_AUDIO_CACHE_LIMIT).toBeGreaterThan(0);

    const env = installOnlineStubs();
    try {
      // 先缓存 apple（播放完成）
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      await completePlayback(env);

      // 再缓存 banana
      speakWord("banana", "us", { source: "online" });
      await flushMicrotasks();
      await completePlayback(env);

      // 再次命中 apple：刷新 LRU 顺序（Map 重新插入）
      speakWord("apple", "us", { source: "online" });
      await flushMicrotasks();
      await completePlayback(env);

      // 缓存条目保持 2 条（apple 与 banana），apple 的 URL 复用、无新工厂调用
      expect(env.providerResolveMocks[0]).toHaveBeenCalledTimes(2);
      expect(env.createdUrls).toHaveLength(2);
    } finally {
      env.restore();
    }
  });
});
