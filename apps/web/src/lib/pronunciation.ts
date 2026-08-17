/**
 * 「发音口音」设置与朗读（RAY-265，手机端兼容修复 RAY-277）。
 * 「发音源选择」设置（RAY-324）：系统自带（SpeechSynthesis，离线）
 * 与线上发音（有道词典 dictvoice 公开接口，MP3 音频）二选一；
 * 线上失败时自动回落系统朗读，不阻塞复习。
 *
 * 发音引擎基线：浏览器语音合成（SpeechSynthesis）——
 * - 离线可用（本地系统语音包），不引入任何新数据源、不联网；
 * - 美式 en-US / 英式 en-GB 两种口音，设置内可选；
 * - 环境不支持（无 speechSynthesis / 无语音包）时朗读按钮降级为
 *   一次性提示，绝不抛错阻塞复习流程。
 *
 * RAY-277 手机端兼容修复（真机反馈：手机浏览器点击发音无效）：
 * - 语音包异步装载：Android Chrome / iOS 首次 `getVoices()` 返回空列表，
 *   通过 `primeSpeechEngine()` 提前触发装载（复习界面挂载时预热）；
 * - iOS cancel→speak 竞态：仅在队列非空（speaking / pending）时 cancel，
 *   空闲态直接朗读，避免 iOS 上同 tick 的 cancel 吞掉新朗读；
 * - Android Chrome paused 残留：引擎停在 paused 时 speak 静默无效，
 *   朗读前先 resume；
 * - 显式设置音量（部分 iOS 版本默认音量异常导致无声）；
 * - 口音优先匹配语音包（en-US / en-GB 精确匹配，回落同语系）；
 * - 异步失败兜底：utterance 报错（非取消类）或超时未开始朗读时，
 *   经 onUnavailable 回调给 UI 一次性提示，绝不静默无反馈。
 *
 * RAY-324 线上发音（用户反馈：系统语音漏字 / 发音错误）：
 * - 线上源走有道词典 dictvoice 公开接口下载 MP3（type=0 美 / type=1 英），
 *   经 HTMLAudioElement 播放；同一 (term, accent) 命中内存缓存，
 *   避免连续朗读同一词时反复下载；
 * - 线上失败（fetch 错误 / 非 2xx 响应 / audio 解码失败 / 播放超时）
 *   自动回落系统朗读，并经 onOnlineFallbackToSystem 通知 UI 一次性
 *   提示「已自动切换到系统语音」；用户切回系统源或再次点击线上
 *   朗读都会重新尝试，绝不静默无反馈。
 *
 * 存储走 localStorage（与主题 / 每日新卡上限同一持久化模式）。
 */
export type PronunciationAccent = "us" | "uk";

export const PRONUNCIATION_STORAGE_KEY = "lexii:pronunciation-accent";

/** 默认口音：美式（en-US） */
export const DEFAULT_PRONUNCIATION_ACCENT: PronunciationAccent = "us";

/** 口音 → SpeechSynthesis 语言标签 */
export const ACCENT_LANG: Readonly<Record<PronunciationAccent, string>> = {
  us: "en-US",
  uk: "en-GB",
};

// ─── RAY-324 发音源选择 ──────────────────────────────────────────────────────

/**
 * 发音源：
 * - system = 浏览器语音合成（SpeechSynthesis），离线；
 * - online = 线上 TTS（有道 dictvoice MP3），需联网；失败时自动回落系统源。
 */
export type PronunciationSource = "system" | "online";

export const PRONUNCIATION_SOURCE_STORAGE_KEY = "lexii:pronunciation-source";

/** 默认发音源：系统（保持 RAY-265 既有行为不变） */
export const DEFAULT_PRONUNCIATION_SOURCE: PronunciationSource = "system";

/** 口音 → 有道 dictvoice type 参数（0 = 美式 / 1 = 英式） */
const ONLINE_ACCENT_TYPE: Readonly<Record<PronunciationAccent, 0 | 1>> = {
  us: 0,
  uk: 1,
};

/** 判断 localStorage 原始值是否为合法发音源 */
export function isPronunciationSource(value: string | null): value is PronunciationSource {
  return value === "system" || value === "online";
}

/** 解析存储值 → 合法发音源（缺失 / 非法回落默认系统） */
export function parsePronunciationSource(raw: string | null | undefined): PronunciationSource {
  const value = raw ?? null;
  return isPronunciationSource(value) ? value : DEFAULT_PRONUNCIATION_SOURCE;
}

/** 读取当前发音源设置（localStorage 不可用 / 损坏时回落默认值） */
export function readPronunciationSource(): PronunciationSource {
  if (typeof window === "undefined") {
    return DEFAULT_PRONUNCIATION_SOURCE;
  }
  try {
    return parsePronunciationSource(window.localStorage.getItem(PRONUNCIATION_SOURCE_STORAGE_KEY));
  } catch {
    return DEFAULT_PRONUNCIATION_SOURCE;
  }
}

/** 写入发音源设置（值必须合法；localStorage 不可用时返回 false，不抛错） */
export function writePronunciationSource(source: PronunciationSource): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(PRONUNCIATION_SOURCE_STORAGE_KEY, source);
    return true;
  } catch {
    return false;
  }
}

/** 清除线上 TTS 音频缓存（设置项变化或手动重置时调用；测试也可使用） */
export function clearOnlineAudioCache(): void {
  for (const entry of onlineAudioCache.values()) {
    try {
      URL.revokeObjectURL(entry.objectUrl);
    } catch {
      // 静默：URL 已失效不影响清理
    }
  }
  onlineAudioCache.clear();
}

/**
 * 朗读不可用原因（降级提示分类）：
 * - unsupported = 环境没有 speechSynthesis / utterance 构造器；
 * - unavailable = 引擎存在但实际发声失败（语音包缺失、引擎报错、
 *   静默无响应、线上源网络/播放失败且已自动回落系统后系统仍失败）。
 */
export type SpeakUnavailableReason = "unsupported" | "unavailable";

export interface SpeakWordOptions {
  /** 朗读不可用（同步或异步）时回调，UI 据此给出一次性提示 */
  onUnavailable?(reason: SpeakUnavailableReason): void;
  /**
   * 线上源自动回落系统源的回调：仅在 source="online" 且线上失败后
   * 自动改用系统朗读且系统朗读成功发起时回调一次，UI 据此给出
   * 「已自动切换到系统语音」的一次性提示。
   */
  onOnlineFallbackToSystem?(): void;
  /**
   * 发音源（RAY-324：系统 / 线上）。默认 `DEFAULT_PRONUNCIATION_SOURCE`（系统）。
   * - "system" → 浏览器 SpeechSynthesis，离线可用；
   * - "online" → 有道 dictvoice MP3，失败时自动回落系统源。
   */
  source?: PronunciationSource;
}

/** 朗读发起后等待开始的兜底窗口：超时未开始视为静默失败（RAY-277） */
export const SPEAK_START_TIMEOUT_MS = 2000;

/** 线上 MP3 播放超时（oncanplaythrough / onended 超时视为播放失败） */
export const ONLINE_PLAY_TIMEOUT_MS = 10_000;

// ─── 系统朗读（SpeechSynthesis，RAY-265 / RAY-277）──────────────────────────

/** 判断 localStorage 原始值是否为合法口音 */
export function isPronunciationAccent(value: string | null): value is PronunciationAccent {
  return value === "us" || value === "uk";
}

/** 解析存储值 → 合法口音（缺失 / 非法回落默认美式） */
export function parsePronunciationAccent(raw: string | null | undefined): PronunciationAccent {
  const value = raw ?? null;
  return isPronunciationAccent(value) ? value : DEFAULT_PRONUNCIATION_ACCENT;
}

/** 读取当前口音设置（localStorage 不可用 / 损坏时回落默认值） */
export function readPronunciationAccent(): PronunciationAccent {
  if (typeof window === "undefined") {
    return DEFAULT_PRONUNCIATION_ACCENT;
  }
  try {
    return parsePronunciationAccent(window.localStorage.getItem(PRONUNCIATION_STORAGE_KEY));
  } catch {
    return DEFAULT_PRONUNCIATION_ACCENT;
  }
}

/** 写入口音设置（值必须合法；localStorage 不可用时返回 false，不抛错） */
export function writePronunciationAccent(accent: PronunciationAccent): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(PRONUNCIATION_STORAGE_KEY, accent);
    return true;
  } catch {
    return false;
  }
}

/** 已预热过的引擎（按实例幂等，避免重复注册 voiceschanged 监听） */
const primedEngines = new WeakSet<SpeechSynthesis>();

/**
 * 预热语音引擎（RAY-277）：挂载复习界面时调用一次。
 *
 * Android Chrome / iOS 的语音包列表是异步装载的，首次 `getVoices()`
 * 常返回空数组；主动调用一次并监听 `voiceschanged` 可提前触发装载，
 * 让用户点击朗读时语音包大概率已就绪。任何环境异常都静默忽略——
 * 朗读路径本身自带兜底（见 speakWord）。
 */
export function primeSpeechEngine(): void {
  if (typeof window === "undefined") {
    return;
  }
  const engine = window.speechSynthesis;
  if (!engine || primedEngines.has(engine)) {
    return;
  }
  primedEngines.add(engine);
  try {
    engine.getVoices();
  } catch {
    // 引擎不支持 getVoices：忽略，朗读路径自带兜底
  }
  try {
    engine.addEventListener("voiceschanged", () => {
      // 语音包装载完成；下次朗读时 getVoices 会读到完整列表，无需缓存
    });
  } catch {
    // 旧引擎无 addEventListener：忽略
  }
}

/**
 * 从可用语音包中为口音挑选最匹配的声音：
 * 精确语言标签（en-US / en-GB）优先，其次同语系（en-*），
 * 同档内优先本地语音包（localService，离线可用），找不到返回 null
 * （退回仅设置 lang 标签，交给浏览器默认语音）。
 */
function pickVoice(engine: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[];
  try {
    voices = engine.getVoices();
  } catch {
    return null;
  }
  if (voices.length === 0) {
    return null;
  }
  const target = lang.toLowerCase();
  const languagePart = target.split("-")[0] ?? "";
  const exact = voices.filter((voice) => voice.lang.toLowerCase() === target);
  const sameLanguage = voices.filter(
    (voice) =>
      voice.lang.toLowerCase() === target ||
      voice.lang.toLowerCase().startsWith(`${languagePart}-`),
  );
  const pool = exact.length > 0 ? exact : sameLanguage.length > 0 ? sameLanguage : voices;
  const local = pool.filter((voice) => voice.localService);
  const chosen = (local.length > 0 ? local : pool)[0];
  return chosen ?? null;
}

/**
 * 挂接朗读结果的异步兜底（RAY-277）：
 * - onstart / onend 正常则无事发生；
 * - 引擎报错（非 cancel / interrupt，那是自己取消造成的）→ 回调一次；
 * - 发起后 SPEAK_START_TIMEOUT_MS 内未开始（静默失败，部分手机引擎
 *   speak 后既不出声也不报错）→ 回调一次。
 * 回调保证最多一次，避免竞态重复提示。
 */
function attachUnavailableTracking(
  utterance: SpeechSynthesisUtterance,
  report: (reason: SpeakUnavailableReason) => void,
): void {
  let reported = false;
  let watchdog: number | undefined;

  const clearWatchdog = () => {
    if (watchdog !== undefined) {
      window.clearTimeout(watchdog);
      watchdog = undefined;
    }
  };

  utterance.onstart = () => {
    clearWatchdog();
  };
  utterance.onend = () => {
    clearWatchdog();
  };
  utterance.onerror = (event) => {
    clearWatchdog();
    if (event.error === "canceled" || event.error === "interrupted") {
      return;
    }
    if (!reported) {
      reported = true;
      report("unavailable");
    }
  };
  watchdog = window.setTimeout(() => {
    watchdog = undefined;
    if (!reported) {
      reported = true;
      report("unavailable");
    }
  }, SPEAK_START_TIMEOUT_MS);
}

/**
 * 系统朗读（浏览器语音合成，离线可用）。
 *
 * 手机端兼容（RAY-277）：
 * - 引擎 paused 时先 resume（Android Chrome 残留态，否则 speak 静默无效）；
 * - 仅在队列非空（speaking / pending）时 cancel 排队中的 utterance，
 *   避免 iOS 上 cancel→speak 同 tick 竞态吞掉新朗读；连续点击时仍保持
 *   「取消未播队列」的 Anki 同款交互；
 * - 显式 volume / rate（部分 iOS 版本默认音量异常导致无声）；
 * - 口音优先匹配语音包，找不到时退回 lang 标签。
 *
 * 返回是否成功发起朗读：
 * - false = 环境不支持（无 speechSynthesis / utterance 构造器）或引擎
 *   同步抛错，同时经 options.onUnavailable 回调（如提供）降级提示，
 *   不视为错误；
 * - true = 已发起；后续实际失败（语音包缺失 / 静默无响应）经
 *   options.onUnavailable 异步回调一次。
 */
function speakSystemWord(
  term: string,
  accent: PronunciationAccent,
  options?: SpeakWordOptions,
): boolean {
  if (typeof window === "undefined") {
    options?.onUnavailable?.("unsupported");
    return false;
  }
  const engine = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!engine || !Utterance) {
    options?.onUnavailable?.("unsupported");
    return false;
  }
  const lang = ACCENT_LANG[accent];
  try {
    if (engine.paused) {
      engine.resume();
    }
    if (engine.speaking || engine.pending) {
      engine.cancel();
    }
    const utterance = new Utterance(term);
    utterance.lang = lang;
    utterance.volume = 1;
    utterance.rate = 1;
    const voice = pickVoice(engine, lang);
    if (voice) {
      utterance.voice = voice;
    }
    engine.speak(utterance);
    attachUnavailableTracking(utterance, (reason) => options?.onUnavailable?.(reason));
    return true;
  } catch {
    options?.onUnavailable?.("unavailable");
    return false;
  }
}

// ─── RAY-324 线上朗读（有道 dictvoice MP3）────────────────────────────────────

/**
 * 线上音频内存缓存：key = `${term.toLowerCase()}::${accent}`，
 * value = 已就绪的 ObjectURL（命中即直接播放，不再 fetch）。
 * 仅在当前会话有效；浏览器刷新或清缓存后下次朗读重新下载。
 */
interface OnlineAudioCacheEntry {
  status: "ready";
  objectUrl: string;
}
const onlineAudioCache = new Map<string, OnlineAudioCacheEntry>();

/**
 * 取消当前进行中的线上朗读（用于切换卡片 / 重新点击时打断上次播放）。
 * 当前仅维护一个 in-flight 槽位——简单够用，避免与多 audio 元素交互的复杂度。
 */
let onlinePlaybackAbortController: AbortController | null = null;
let activeOnlineAudio: HTMLAudioElement | null = null;

function cancelActiveOnlinePlayback(): void {
  // 先捕获当前活动 audio 引用：abort() 会同步触发播放器的 abort 监听器，
  // 该监听器清理时会把 activeOnlineAudio 重置为 null，导致后续 pause()
  // 失效。先抓住引用再 abort，最后再统一清理。
  const previousAudio = activeOnlineAudio;
  activeOnlineAudio = null;
  onlinePlaybackAbortController?.abort();
  onlinePlaybackAbortController = null;
  if (previousAudio) {
    try {
      previousAudio.pause();
      previousAudio.src = "";
    } catch {
      // 静默：清理旧元素失败不影响下一次朗读
    }
  }
}

/** 在测试与浏览器之间安全地构造 URL（允许测试注入构造器） */
type UrlFactory = (parts: { pathname: string; query: URLSearchParams }) => string;

/** 默认 URL 构造：dictvoice 公开接口，type=0 美 / type=1 英 */
function defaultBuildOnlineAudioUrl(parts: {
  pathname: string;
  query: URLSearchParams;
}): string {
  const search = parts.query.toString();
  return `https://dict.youdao.com${parts.pathname}?${search}`;
}

/** 可注入的 URL 构造器（默认走有道 dictvoice） */
let urlFactory: UrlFactory = defaultBuildOnlineAudioUrl;

/** 仅供测试 / 调试使用：替换线上 URL 构造器（生产环境无需调用） */
export function __setOnlineUrlFactoryForTesting(factory: UrlFactory | null): void {
  urlFactory = factory ?? defaultBuildOnlineAudioUrl;
}

/**
 * 可注入的 fetch 实现（默认走 window.fetch）。便于 jsdom 环境验证
 * URL、请求参数与错误分支；浏览器环境无需设置。
 */
type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

let fetchImpl: FetchLike | null = null;

export function __setOnlineFetchForTesting(implementation: FetchLike | null): void {
  fetchImpl = implementation;
}

function resolveFetch(): FetchLike {
  if (fetchImpl) {
    return fetchImpl;
  }
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    throw new Error("当前环境不支持网络请求，无法使用线上发音");
  }
  return window.fetch.bind(window);
}

/**
 * 可注入的 createObjectURL / revokeObjectURL 实现（默认走 URL 的静态方法）。
 * 测试可注入 fake，避免 jsdom 下 URL 静态属性在异步边界被重置的兼容问题。
 */
type ObjectURLFactory = (blob: Blob) => string;

let objectURLFactory: ObjectURLFactory | null = null;

export function __setOnlineObjectURLFactoryForTesting(
  factory: ObjectURLFactory | null,
): void {
  objectURLFactory = factory;
}

function resolveCreateObjectURL(blob: Blob): string {
  if (objectURLFactory) {
    return objectURLFactory(blob);
  }
  return URL.createObjectURL(blob);
}

/**
 * 解析当前可用的 Audio 构造器：优先使用测试注入（便于 jsdom 替换），
 * 否则回落到全局 Audio；浏览器环境应取到 window.Audio。
 */
type AudioCtor = new (src?: string) => HTMLAudioElement;

let audioCtorOverride: AudioCtor | null = null;

/** 仅供测试 / 调试使用：替换线上 Audio 构造器（生产环境无需调用） */
export function __setOnlineAudioCtorForTesting(ctor: AudioCtor | null): void {
  audioCtorOverride = ctor;
}

function resolveAudioCtor(): AudioCtor {
  if (audioCtorOverride) {
    return audioCtorOverride;
  }
  if (typeof window === "undefined" || typeof window.Audio !== "function") {
    throw new Error("当前环境不支持 HTMLAudioElement，无法播放线上发音");
  }
  return window.Audio;
}

/**
 * 线上朗读（有道 dictvoice MP3，联网）：
 * - 同一 (term, accent) 命中内存缓存则直接播放；
 * - 否则 fetch 下载 → Blob → ObjectURL → HTMLAudioElement 播放；
 * - 任意阶段失败（网络 / 非 2xx / 解码 / 播放超时）→ 自动回落系统朗读
 *   并经 options.onOnlineFallbackToSystem 回调通知 UI。
 *
 * 返回是否成功发起播放（含「成功发起但实际播放失败」的乐观值）：
 * - false = 环境完全不可用（无 fetch / 无 window），同步层即失败；
 * - true = 已发起线上播放（异步失败会自动回落系统）。
 */
function speakOnlineWord(
  term: string,
  accent: PronunciationAccent,
  options?: SpeakWordOptions,
): boolean {
  if (typeof window === "undefined") {
    options?.onUnavailable?.("unsupported");
    return false;
  }

  // 打断前一次线上朗读；与系统朗读的 cancel/speak 语义保持一致
  cancelActiveOnlinePlayback();
  const controller = new AbortController();
  onlinePlaybackAbortController = controller;

  const cacheKey = `${term.toLowerCase()}::${accent}`;

  // 异步执行：命中缓存 / fetch → blob → 播放 → 失败回落系统
  void playOnlineAudio(term, accent, cacheKey, controller.signal)
    .then(() => {
      // 线上播放成功：无需任何回调（成功即用户预期的结果）
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      // 线上失败：尝试系统朗读兜底，并在系统朗读成功发起时通知 UI
      const fallbackStarted = speakSystemWord(term, accent, options);
      if (fallbackStarted) {
        options?.onOnlineFallbackToSystem?.();
      } else {
        // 系统朗读也失败（环境不支持或同步抛错）：onUnavailable 已由
        // speakSystemWord 内部回调，此处无需重复
        options?.onUnavailable?.("unavailable");
      }
      // 记录原始错误，便于调试；不向用户暴露
      // eslint-disable-next-line no-console
      console.warn("线上朗读失败，已回落系统朗读：", err);
    })
    .finally(() => {
      if (onlinePlaybackAbortController === controller) {
        onlinePlaybackAbortController = null;
      }
    });

  // 乐观返回 true——失败由异步层处理（onUnavailable / onOnlineFallbackToSystem）
  return true;
}

/**
 * 实际播放线上 MP3：命中缓存走 ObjectURL；未命中走 fetch → Blob。
 * 任意失败抛错给上层自动回落系统。
 */
async function playOnlineAudio(
  term: string,
  accent: PronunciationAccent,
  cacheKey: string,
  signal: AbortSignal,
): Promise<void> {
  let objectUrl: string | null = null;

  const cached = onlineAudioCache.get(cacheKey);
  if (cached) {
    objectUrl = cached.objectUrl;
  } else {
    const query = new URLSearchParams({
      audio: term,
      type: String(ONLINE_ACCENT_TYPE[accent]),
    });
    const url = urlFactory({ pathname: "/dictvoice", query });

    const response = await resolveFetch()(url, { signal });
    if (!response.ok) {
      throw new Error(`线上发音下载失败：HTTP ${response.status}`);
    }
    const blob = await response.blob();
    objectUrl = resolveCreateObjectURL(blob);
    onlineAudioCache.set(cacheKey, { status: "ready", objectUrl });
  }

  if (signal.aborted) {
    return;
  }

  await playObjectUrl(objectUrl, signal);
}

/** 在 HTMLAudioElement 上播放指定 ObjectURL；超时 / 解码失败抛错 */
function playObjectUrl(objectUrl: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const AudioCtor = resolveAudioCtor();
    const audio = new AudioCtor(objectUrl);
    audio.preload = "auto";
    activeOnlineAudio = audio;

    let settled = false;
    let watchdog: number | undefined;
    const cleanup = () => {
      if (watchdog !== undefined) {
        window.clearTimeout(watchdog);
        watchdog = undefined;
      }
      audio.oncanplaythrough = null;
      audio.onended = null;
      audio.onerror = null;
      if (activeOnlineAudio === audio) {
        activeOnlineAudio = null;
      }
    };
    const succeed = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (reason: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(reason));
    };

    audio.oncanplaythrough = () => {
      audio.play().catch((err: unknown) => {
        fail(`线上发音播放失败：${err instanceof Error ? err.message : String(err)}`);
      });
    };
    audio.onended = () => {
      succeed();
    };
    audio.onerror = () => {
      fail("线上音频解码失败");
    };

    watchdog = window.setTimeout(() => {
      fail("线上发音播放超时");
    }, ONLINE_PLAY_TIMEOUT_MS);

    signal.addEventListener(
      "abort",
      () => {
        fail("线上朗读已被取消");
      },
      { once: true },
    );
  });
}

// ─── 公开入口：发音源分发 ────────────────────────────────────────────────────

/**
 * 朗读单词（按 options.source 分发到系统或线上发音源）。
 *
 * - 未指定 source → 走默认系统源（SpeechSynthesis，离线可用，保持
 *   RAY-265 / RAY-277 既有行为不变）；
 * - source="online" → 走有道 dictvoice MP3，需联网；线上失败自动回落
 *   系统朗读并回调 onOnlineFallbackToSystem 一次。
 *
 * 任何路径下朗读不可用均经 options.onUnavailable 兜底（一次性），与
 * RAY-265 / RAY-277 既有行为保持一致。
 */
export function speakWord(
  term: string,
  accent: PronunciationAccent,
  options?: SpeakWordOptions,
): boolean {
  const source = options?.source ?? DEFAULT_PRONUNCIATION_SOURCE;
  if (source === "online") {
    return speakOnlineWord(term, accent, options);
  }
  return speakSystemWord(term, accent, options);
}