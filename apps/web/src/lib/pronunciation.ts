/**
 * 「发音口音」设置与朗读（RAY-265，手机端兼容修复 RAY-277）。
 * 「发音源选择」设置（RAY-324）：系统自带（SpeechSynthesis，离线）
 * 与线上发音二选一；线上失败时自动回落系统朗读，不阻塞复习。
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
 * 线上源按「提供方候选列表」顺序尝试（首个成功者胜出），全部失败才
 * 回落系统朗读：
 * 1. Free Dictionary API（api.dictionaryapi.dev）——维基词典真人录音，
 *    按口音选取 us/uk 变体，音质最佳、口音可控；
 * 2. Wikimedia Commons（commons.wikimedia.org）——同一批维基词典录音的
 *    上游存储，同样按口音选 us/uk 变体；当 dictionaryapi 的媒体 CDN
 *    抖动时（Oscar 复审观察 1）仍能提供带口音区分的真人录音；
 * 3. Lingva Translate（lingva.ml）——在线合成，任意词均可发音，
 *    覆盖真人录音缺失的生僻词（无 us/uk 区分）。
 * 三个端点均实测返回 `Access-Control-Allow-Origin: *`（2026-08-18 验证），
 * 可在纯 Web 部署（GitHub Pages）直接 fetch；有道 dictvoice 因无 CORS
 * 响应头已被移除（Oscar RAY-324 复审 blocking 1）。
 *
 * 线上音频（Blob → ObjectURL）仅播放成功后写入内存缓存（解码失败的坏
 * URL 不再污染缓存），缓存按 LRU 上限回收；同一 (term, accent) 命中缓存
 * 不再重复下载。线上失败（网络 / 非 2xx / 全部候选 null / 解码失败 /
 * 播放超时 / 播放被自动播放策略拒绝）自动回落系统朗读，并经
 * onOnlineFallbackToSystem 通知 UI 一次性提示「已自动切换到系统语音」；
 * 主动取消（切换卡片 / 重新点击）不视为失败，不回收已缓存条目
 * （Oscar 复审观察 3）。
 *
 * 存储走 localStorage（与主题 / 每日新卡上限同一持久化模式）。
 *
 * 测试接缝（仅测试 / 调试注入，生产路径不感知）：
 * - __setOnlineProvidersForTesting：替换线上候选提供方列表（默认三候选）；
 * - __setOnlineFetchForTesting：替换 fetch 实现（默认候选的 URL 构造与
 *   响应解析单测使用，jsdom 无法真实联网）；
 * - __setOnlineObjectURLFactoryForTesting：替换 createObjectURL（jsdom 下
 *   URL 静态方法在异步边界存在重置风险，工厂注入更稳定）；
 * - __setOnlineAudioCtorForTesting：替换 Audio 构造器（jsdom 无真实
 *   媒体播放能力，测试注入 FakeAudio 手动驱动事件）。
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
 * - online = 线上发音（候选列表见文件头），需联网；失败时自动回落系统源。
 */
export type PronunciationSource = "system" | "online";

export const PRONUNCIATION_SOURCE_STORAGE_KEY = "lexii:pronunciation-source";

/** 默认发音源：系统（保持 RAY-265 既有行为不变） */
export const DEFAULT_PRONUNCIATION_SOURCE: PronunciationSource = "system";

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

// ─── 线上音频缓存（LRU 上限，RAY-324 Oscar 复审 nit 3）────────────────────────

/** 缓存上限：会话内最多保留的 ObjectURL 数（超出按 LRU 逐出并 revoke） */
export const ONLINE_AUDIO_CACHE_LIMIT = 200;

interface OnlineAudioCacheEntry {
  objectUrl: string;
}

/** key = `${term.toLowerCase()}::${accent}`；Map 迭代顺序即插入顺序（LRU 逐出） */
const onlineAudioCache = new Map<string, OnlineAudioCacheEntry>();

function revokeObjectUrlSafe(objectUrl: string): void {
  try {
    URL.revokeObjectURL(objectUrl);
  } catch {
    // 静默：URL 已失效不影响清理
  }
}

/**
 * 写入缓存并执行 LRU 上限回收。命中已存在的 key 时先移除旧条目
 * （含 revoke 旧 ObjectURL，新的对象 URL 会替代它），再重新插入以刷新
 * 最近使用顺序。
 */
function cacheOnlineAudio(key: string, objectUrl: string): void {
  const existing = onlineAudioCache.get(key);
  if (existing) {
    onlineAudioCache.delete(key);
    if (existing.objectUrl !== objectUrl) {
      revokeObjectUrlSafe(existing.objectUrl);
    }
  }
  onlineAudioCache.set(key, { objectUrl });
  while (onlineAudioCache.size > ONLINE_AUDIO_CACHE_LIMIT) {
    const oldestKey = onlineAudioCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = onlineAudioCache.get(oldestKey);
    onlineAudioCache.delete(oldestKey);
    if (oldest) {
      revokeObjectUrlSafe(oldest.objectUrl);
    }
  }
}

/** 移除缓存条目并释放其 ObjectURL（播放失败时回收坏条目，RAY-324 suggestion 3） */
function evictOnlineAudio(key: string, objectUrl: string): void {
  const existing = onlineAudioCache.get(key);
  if (existing && existing.objectUrl === objectUrl) {
    onlineAudioCache.delete(key);
    revokeObjectUrlSafe(existing.objectUrl);
  }
}

/** 清除线上 TTS 音频缓存（设置项变化或手动重置时调用；测试也可使用） */
export function clearOnlineAudioCache(): void {
  for (const entry of onlineAudioCache.values()) {
    revokeObjectUrlSafe(entry.objectUrl);
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
   * - "online" → 线上候选列表（见文件头），失败时自动回落系统源。
   */
  source?: PronunciationSource;
}

/** 朗读发起后等待开始的兜底窗口：超时未开始视为静默失败（RAY-277） */
export const SPEAK_START_TIMEOUT_MS = 2000;

/** 线上 MP3 播放超时：构造 audio 后此窗口内未成功开始播放视为失败（RAY-324） */
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

// ─── RAY-324 线上朗读（候选提供方级联）────────────────────────────────────────

/**
 * 线上发音提供方：解析并返回单词的发音 Blob；不可用 / 不适用时返回 null。
 * 单个提供方内部的任何失败（网络、非 2xx、无音频、解析失败）都应吞掉
 * 为 null——级联逻辑据此尝试下一个候选，全部 null 才回落系统。
 */
export interface OnlineAudioProvider {
  /** 稳定标识（仅用于调试与测试断言） */
  id: string;
  /**
   * 解析单词发音（返回音频 Blob；null = 该提供方无此词发音 / 请求失败）。
   * signal 用于取消（主动打断 / 切换卡片）。
   */
  resolve(term: string, accent: PronunciationAccent, signal: AbortSignal): Promise<Blob | null>;
}

/**
 * 可注入的 fetch 实现（默认走 window.fetch）。默认提供方的 URL 构造与
 * 响应解析单测经此接缝注入 fake（jsdom 无法真实联网）。
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

/** Free Dictionary API 词条响应（仅使用 phonetics[].audio 字段） */
interface DictionaryApiEntry {
  phonetics?: { audio?: string }[];
}

/**
 * 候选 1：Free Dictionary API（api.dictionaryapi.dev）——维基词典真人录音。
 * - 先请求词条 JSON（`GET /api/v2/entries/en/{term}`），收集全部非空 audio；
 * - 按口音偏好排序：URL 含 `-us`（美式）/ `-uk`（英式）后缀者优先；
 *   无精确匹配时按「另一主要口音优先于第三口音」排序（如请求英式却只有
 *   美式与澳式时取美式，Oscar 复审观察 2）；
 * - 再按序下载 MP3，首个成功的为 Blob。
 * 端点返回 `Access-Control-Allow-Origin: *`，可在浏览器直接 fetch。
 */
export function createDictionaryApiProvider(fetchFn?: FetchLike): OnlineAudioProvider {
  const fetchForProvider = fetchFn ?? resolveFetch();
  return {
    id: "dictionaryapi",
    async resolve(term, accent, signal) {
      const entriesUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
      let audioUrls: string[];
      try {
        const entriesResponse = await fetchForProvider(entriesUrl, { signal });
        if (!entriesResponse.ok) {
          return null;
        }
        const entries = (await entriesResponse.json()) as DictionaryApiEntry[];
        audioUrls = (entries ?? [])
          .flatMap((entry) => entry.phonetics ?? [])
          .map((phonetic) => phonetic.audio)
          .filter((audio): audio is string => typeof audio === "string" && audio.length > 0);
      } catch {
        return null;
      }
      if (audioUrls.length === 0) {
        return null;
      }
      const ordered = orderAudioUrlsByAccent(audioUrls, accent);
      for (const audioUrl of ordered) {
        try {
          const audioResponse = await fetchForProvider(audioUrl, { signal });
          if (audioResponse.ok) {
            return await audioResponse.blob();
          }
        } catch {
          // 尝试下一个候选录音
        }
      }
      return null;
    },
  };
}

/**
 * 按口音偏好对录音 URL 排序（Oscar 复审观察 2）：
 * 1. 请求口音的精确变体（us→`-us` / uk→`-uk`）；
 * 2. 另一主要口音变体（避免退回 `-au` 等第三口音）；
 * 3. 其余录音（第三口音 / 无标记）。
 */
function orderAudioUrlsByAccent(audioUrls: string[], accent: PronunciationAccent): string[] {
  const primarySuffix = accent === "us" ? "-us" : "-uk";
  const otherSuffix = accent === "us" ? "-uk" : "-us";
  const includes = (audio: string, suffix: string) => audio.toLowerCase().includes(suffix);
  const primaryMatches = audioUrls.filter((audio) => includes(audio, primarySuffix));
  const otherMatches = audioUrls.filter(
    (audio) => !includes(audio, primarySuffix) && includes(audio, otherSuffix),
  );
  const rest = audioUrls.filter(
    (audio) => !includes(audio, primarySuffix) && !includes(audio, otherSuffix),
  );
  return [...primaryMatches, ...otherMatches, ...rest];
}

/** Wikimedia Commons allimages 查询响应（仅使用 name / url 字段） */
interface WikimediaAllimagesResponse {
  query?: {
    allimages?: { name: string; url?: string }[];
  };
}

/**
 * 候选 2：Wikimedia Commons（commons.wikimedia.org）——维基词典真人录音
 * 的上游存储，与候选 1 同源、同样按口音选 us/uk 变体。当 dictionaryapi
 * 媒体 CDN 抖动时仍能提供带口音区分的真人录音（Oscar 复审观察 1）。
 * - 经 MediaWiki API 前缀查询文件：`En-us-{term}.ogg` / `En-uk-{term}.ogg`
 *   （term 小写、空格转下划线）；
 * - 首选请求口音的前缀；无结果时退回另一主要口音前缀；
 * - 同名多文件时取名字最短者（最接近精确发音文件）；
 * - 再下载音频（OGG）为 Blob。
 * API 需带 `origin=*` 参数返回 `Access-Control-Allow-Origin: *`；
 * upload.wikimedia.org 媒体文件同样返回 `access-control-allow-origin: *`。
 */
export function createWikimediaProvider(fetchFn?: FetchLike): OnlineAudioProvider {
  const fetchForProvider = fetchFn ?? resolveFetch();
  return {
    id: "wikimedia",
    async resolve(term, accent, signal) {
      const fileStem = `En-${accent}-${term.toLowerCase().trim().replace(/\s+/g, "_")}`;
      const otherFileStem = `En-${accent === "us" ? "uk" : "us"}-${term.toLowerCase().trim().replace(/\s+/g, "_")}`;
      for (const stem of [fileStem, otherFileStem]) {
        try {
          const apiUrl =
            `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
            `&list=allimages&aiprefix=${encodeURIComponent(stem)}&ailimit=5&origin=*`;
          const apiResponse = await fetchForProvider(apiUrl, { signal });
          if (!apiResponse.ok) {
            continue;
          }
          const payload = (await apiResponse.json()) as WikimediaAllimagesResponse;
          const files = (payload.query?.allimages ?? []).filter(
            (file): file is { name: string; url: string } =>
              typeof file.url === "string" && file.url.length > 0,
          );
          if (files.length === 0) {
            continue;
          }
          // 取名字最短的文件（最接近精确发音文件，避免 -2/-3 等变体）
          const best = files.reduce((shortest, file) =>
            file.name.length < shortest.name.length ? file : shortest,
          );
          const audioUrl = stripUtmParameters(best.url);
          const audioResponse = await fetchForProvider(audioUrl, { signal });
          if (audioResponse.ok) {
            return await audioResponse.blob();
          }
        } catch {
          // 尝试下一前缀 / 交给级联下一候选
        }
      }
      return null;
    },
  };
}

/** 去掉 allimages 返回 URL 上的统计参数（utm_*），保留纯媒体地址 */
function stripUtmParameters(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    return url.href;
  } catch {
    return rawUrl;
  }
}

/** Lingva Translate 音频响应（合成音频以字节数组返回） */
interface LingvaAudioResponse {
  audio?: number[];
}

/**
 * 候选 3：Lingva Translate（lingva.ml）——在线合成，任意词均可发音，
 * 覆盖真人录音缺失的生僻词。响应为 `{"audio":[bytes]}`（MP3 字节数组），
 * 无 us/uk 区分（合成音为通用英语发音）。
 * 端点返回 `Access-Control-Allow-Origin: *`，可在浏览器直接 fetch。
 */
export function createLingvaProvider(fetchFn?: FetchLike): OnlineAudioProvider {
  const fetchForProvider = fetchFn ?? resolveFetch();
  return {
    id: "lingva",
    async resolve(term, accent, signal) {
      // accent 仅供签名一致：合成音无区域变体
      void accent;
      const url = `https://lingva.ml/api/v1/audio/en/${encodeURIComponent(term)}`;
      try {
        const response = await fetchForProvider(url, { signal });
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as LingvaAudioResponse;
        if (!Array.isArray(payload.audio) || payload.audio.length === 0) {
          return null;
        }
        return new Blob([new Uint8Array(payload.audio)], { type: "audio/mpeg" });
      } catch {
        return null;
      }
    },
  };
}

/** 默认线上候选列表（按序尝试，首个成功者胜出） */
const DEFAULT_ONLINE_PROVIDERS: readonly OnlineAudioProvider[] = [
  createDictionaryApiProvider(),
  createWikimediaProvider(),
  createLingvaProvider(),
];

let onlineProviders: readonly OnlineAudioProvider[] = DEFAULT_ONLINE_PROVIDERS;

/** 测试 / 调试：替换线上候选提供方列表（null 恢复默认） */
export function __setOnlineProvidersForTesting(
  providers: readonly OnlineAudioProvider[] | null,
): void {
  onlineProviders = providers ?? DEFAULT_ONLINE_PROVIDERS;
}

/**
 * 可注入的 createObjectURL 实现（默认走 URL.createObjectURL）。
 * jsdom 下 URL 静态方法在异步边界存在重置风险，工厂注入更稳定。
 */
type ObjectURLFactory = (blob: Blob) => string;

let objectURLFactory: ObjectURLFactory | null = null;

export function __setOnlineObjectURLFactoryForTesting(factory: ObjectURLFactory | null): void {
  objectURLFactory = factory;
}

function resolveCreateObjectURL(blob: Blob): string {
  if (objectURLFactory) {
    return objectURLFactory(blob);
  }
  return URL.createObjectURL(blob);
}

/**
 * 可注入的 Audio 构造器（默认 window.Audio）。jsdom 无真实媒体播放能力，
 * 测试注入 FakeAudio 手动驱动事件。
 */
type AudioCtor = new (src?: string) => HTMLAudioElement;

let audioCtorOverride: AudioCtor | null = null;

/** 测试 / 调试：替换线上 Audio 构造器（生产环境无需调用） */
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

/**
 * 线上朗读（候选提供方级联，联网）：
 * - 同一 (term, accent) 命中内存缓存则直接播放；
 * - 否则按候选列表依次 resolve → Blob → ObjectURL → HTMLAudioElement 播放；
 * - 全部候选失败或播放失败（网络 / 解码 / 超时 / 自动播放策略拒绝）→
 *   自动回落系统朗读并经 options.onOnlineFallbackToSystem 回调通知 UI。
 *
 * 返回是否成功发起播放（含「成功发起但实际播放失败」的乐观值）：
 * - false = 环境完全不可用（无 window），同步层即失败；
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

  // 异步执行：命中缓存 / 候选级联 → blob → 播放 → 失败回落系统
  void playOnlineAudio(term, accent, cacheKey, controller.signal)
    .catch((err: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      // 线上失败：尝试系统朗读兜底。系统朗读失败时的 onUnavailable 已由
      // speakSystemWord 内部回调（保证一次），此处不再重复调用
      const fallbackStarted = speakSystemWord(term, accent, options);
      if (fallbackStarted) {
        options?.onOnlineFallbackToSystem?.();
      }
      // 记录原始错误，便于调试；不向用户暴露
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
 * 实际播放线上音频：命中缓存走 ObjectURL；未命中走候选级联 → Blob。
 * 任意失败抛错给上层自动回落系统。
 */
async function playOnlineAudio(
  term: string,
  accent: PronunciationAccent,
  cacheKey: string,
  signal: AbortSignal,
): Promise<void> {
  let objectUrl = onlineAudioCache.get(cacheKey)?.objectUrl ?? null;

  if (objectUrl === null) {
    let blob: Blob | null = null;
    for (const provider of onlineProviders) {
      if (signal.aborted) {
        return;
      }
      // 单个提供方抛错等同 null（防御性兜底；契约上提供方应自吞错误），
      // 级联继续尝试下一候选
      try {
        blob = await provider.resolve(term, accent, signal);
      } catch {
        blob = null;
      }
      if (blob !== null) {
        break;
      }
    }
    if (blob === null) {
      throw new Error("线上发音源均不可用");
    }
    objectUrl = resolveCreateObjectURL(blob);
  }

  if (signal.aborted) {
    return;
  }

  await playObjectUrl(objectUrl, signal, {
    // 仅播放成功开始后写入缓存：解码失败的坏 URL 不再污染缓存
    // （Oscar 复审 suggestion 3）
    onStarted: () => {
      cacheOnlineAudio(cacheKey, objectUrl);
    },
    // 真实失败（解码 / 超时 / 播放被拒）时回收缓存条目，避免坏 URL 无限复用；
    // 主动取消（切换卡片 / 重新点击）保留已缓存条目，下次朗读直接复用
    // （Oscar 复审观察 3）
    onFailed: (reason) => {
      if (reason !== "canceled") {
        evictOnlineAudio(cacheKey, objectUrl);
      }
    },
  });
}

/** 播放失败原因（onFailed 回调参数） */
export type PlaybackFailureReason = "canceled" | "failed";

/** 播放生命周期回调（playObjectUrl 内部使用，测试无需直接关注） */
interface PlaybackHooks {
  /** 音频成功开始播放（play() resolve）后回调一次 */
  onStarted?(): void;
  /** 任意失败后回调一次，携带失败原因（主动取消 vs 真实失败） */
  onFailed?(reason: PlaybackFailureReason): void;
}

/**
 * 在 HTMLAudioElement 上播放指定 ObjectURL。
 * - 解码失败（onerror）/ 播放超时（构造后 ONLINE_PLAY_TIMEOUT_MS 内未开始）/
 *   取消（abort）→ 抛错；
 * - play() 成功 resolve 后清除超时看门狗（弱网下缓冲接近 10s 时不再误判
 *   失败，Oscar 复审 suggestion 2）；
 * - 老 Safari 的 play() 可能返回 undefined，统一经 Promise.resolve 包裹
 *   （Oscar 复审 nit 6）。
 */
function playObjectUrl(
  objectUrl: string,
  signal: AbortSignal,
  hooks?: PlaybackHooks,
): Promise<void> {
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
    const fail = (message: string, hookReason: PlaybackFailureReason) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      hooks?.onFailed?.(hookReason);
      reject(new Error(message));
    };

    audio.oncanplaythrough = () => {
      Promise.resolve(audio.play())
        .then(() => {
          // 播放已开始：超时看门狗使命完成（弱网缓冲接近超时窗口时
          // 不再误判），后续失败由 onerror / onended 覆盖
          if (watchdog !== undefined) {
            window.clearTimeout(watchdog);
            watchdog = undefined;
          }
          hooks?.onStarted?.();
        })
        .catch((err: unknown) => {
          fail(`线上发音播放失败：${err instanceof Error ? err.message : String(err)}`, "failed");
        });
    };
    audio.onended = () => {
      succeed();
    };
    audio.onerror = () => {
      fail("线上音频解码失败", "failed");
    };

    watchdog = window.setTimeout(() => {
      fail("线上发音播放超时", "failed");
    }, ONLINE_PLAY_TIMEOUT_MS);

    signal.addEventListener(
      "abort",
      () => {
        // 主动取消（切换卡片 / 重新点击）：不视为失败，回调 canceled
        // 供缓存层保留已缓存条目（Oscar 复审观察 3）
        fail("线上朗读已被取消", "canceled");
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
 * - source="online" → 走线上候选级联，需联网；线上失败自动回落
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
