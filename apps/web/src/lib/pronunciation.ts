/**
 * 「发音口音」设置与朗读（RAY-265，手机端兼容修复 RAY-277）。
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

/**
 * 朗读不可用原因（降级提示分类）：
 * - unsupported = 环境没有 speechSynthesis / utterance 构造器；
 * - unavailable = 引擎存在但实际发声失败（语音包缺失、引擎报错、静默无响应）。
 */
export type SpeakUnavailableReason = "unsupported" | "unavailable";

export interface SpeakWordOptions {
  /** 朗读不可用（同步或异步）时回调，UI 据此给出一次性提示 */
  onUnavailable?(reason: SpeakUnavailableReason): void;
}

/** 朗读发起后等待开始的兜底窗口：超时未开始视为静默失败（RAY-277） */
export const SPEAK_START_TIMEOUT_MS = 2000;

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
 * 朗读单词（浏览器语音合成，离线可用）。
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
export function speakWord(
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
