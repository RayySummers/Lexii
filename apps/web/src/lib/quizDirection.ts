/**
 * 「选择题出题方向」设置（RAY-293）。
 *
 * 产品口径（Jack 拍板）：
 * - 三档：英译中（看单词选释义）/ 中译英（看释义选单词）/ 混合（逐题随机方向）；
 * - 默认英译中（RAY-269 既有行为不变）。
 *
 * 存储走 localStorage（与主题 / 评分档位 / 每日新卡上限同一持久化模式）。
 * 解析失败 / 非法值一律回落到默认英译中——设置损坏绝不阻塞选择题队列。
 *
 * 方向只改变题目呈现（题面与选项文本），不改变评分与 FSRS 调度
 * （见 docs/quiz-fsrs-mapping.md）。
 */
import type { QuizDirection } from "@lexilexi/core";

/** 设置档位：两方向 + 混合（逐题随机） */
export type QuizDirectionPreference = QuizDirection | "mixed";

export const QUIZ_DIRECTION_STORAGE_KEY = "lexilexi:quiz-direction";

/** 默认方向：英译中 */
export const DEFAULT_QUIZ_DIRECTION_PREFERENCE: QuizDirectionPreference = "en-zh";

/** 判断 localStorage 原始值是否为合法档位 */
export function isQuizDirectionPreference(value: string | null): value is QuizDirectionPreference {
  return value === "en-zh" || value === "zh-en" || value === "mixed";
}

/** 解析存储值 → 合法档位（缺失 / 非法回落默认英译中） */
export function parseQuizDirectionPreference(
  raw: string | null | undefined,
): QuizDirectionPreference {
  const value = raw ?? null;
  return isQuizDirectionPreference(value) ? value : DEFAULT_QUIZ_DIRECTION_PREFERENCE;
}

/** 读取当前方向设置（localStorage 不可用 / 损坏时回落默认值） */
export function readQuizDirectionPreference(): QuizDirectionPreference {
  if (typeof window === "undefined") {
    return DEFAULT_QUIZ_DIRECTION_PREFERENCE;
  }
  try {
    return parseQuizDirectionPreference(window.localStorage.getItem(QUIZ_DIRECTION_STORAGE_KEY));
  } catch {
    return DEFAULT_QUIZ_DIRECTION_PREFERENCE;
  }
}

/** 写入方向设置（值必须合法；localStorage 不可用时返回 false，不抛错） */
export function writeQuizDirectionPreference(preference: QuizDirectionPreference): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(QUIZ_DIRECTION_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

/**
 * 由设置档位解析出一道题的实际方向（逐题调用）：
 * - 非混合：直接返回偏好值；
 * - 混合：随机二选一（`random` 可注入以便测试确定性）。
 *
 * 逐题随机而非逐会话随机：混合模式下同一轮里两种方向都会出现。
 */
export function resolveQuizDirection(
  preference: QuizDirectionPreference,
  random: () => number = Math.random,
): QuizDirection {
  if (preference === "mixed") {
    return random() < 0.5 ? "en-zh" : "zh-en";
  }
  return preference;
}
