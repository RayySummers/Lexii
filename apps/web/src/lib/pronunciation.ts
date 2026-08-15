/**
 * 「发音口音」设置与朗读（RAY-265）。
 *
 * 发音引擎基线：浏览器语音合成（SpeechSynthesis）——
 * - 离线可用（本地系统语音包），不引入任何新数据源、不联网；
 * - 美式 en-US / 英式 en-GB 两种口音，设置内可选；
 * - 环境不支持（无 speechSynthesis / 无语音包）时朗读按钮静默降级为
 *   不可用提示，绝不抛错阻塞复习流程。
 *
 * 存储走 localStorage（与主题 / 每日新卡上限同一持久化模式）。
 */
export type PronunciationAccent = "us" | "uk";

export const PRONUNCIATION_STORAGE_KEY = "lexilexi:pronunciation-accent";

/** 默认口音：美式（en-US） */
export const DEFAULT_PRONUNCIATION_ACCENT: PronunciationAccent = "us";

/** 口音 → SpeechSynthesis 语言标签 */
export const ACCENT_LANG: Readonly<Record<PronunciationAccent, string>> = {
  us: "en-US",
  uk: "en-GB",
};

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

/**
 * 朗读单词（浏览器语音合成，离线可用）。
 *
 * 播放前先 cancel 队列中的未播 utterance，避免连续点击时朗读排队
 * （Anki 同款交互）；返回是否成功发起朗读：
 * - false = 环境不支持（无 speechSynthesis 或无 utterance 构造器），
 *   调用方据此降级提示，不视为错误。
 */
export function speakWord(term: string, accent: PronunciationAccent): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const engine = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!engine || !Utterance) {
    return false;
  }
  try {
    engine.cancel();
    const utterance = new Utterance(term);
    utterance.lang = ACCENT_LANG[accent];
    engine.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
