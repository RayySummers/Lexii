/**
 * 每日新卡额度耗尽时的空状态文案（RAY-276 诊断线 3）。
 *
 * ReviewScreen 与 QuizScreen 共用（Oscar 评审 PR #41 suggestion 1）：
 * 文案口径单点维护，避免改文案只改到一处。队列为空 + 剩余额度 0 +
 * 词库仍有未学新词时展示，明确告知「顺延」，而不是暗示词库没有新词可学。
 * review 模式不含新词，返回 null（界面回落默认空状态文案）。
 */
import type { StudyMode } from "@lexilexi/core";

/** 空状态文案（title + body） */
export interface EmptyStateCopy {
  title: string;
  body: string;
}

/**
 * 按模式返回额度耗尽文案；review 模式返回 null（不适用）。
 *
 * @param mode 学习模式（learn / mixed 触发额度语义；review 为 null）
 * @param limit 每日新卡上限（写入文案的数字，来自 readDailyNewCardLimit）
 */
export function quotaExhaustedCopy(mode: StudyMode, limit: number): EmptyStateCopy | null {
  if (mode === "review") {
    return null;
  }
  return mode === "learn"
    ? {
        title: "今日新词额度已用完",
        body: `每日新词上限 ${limit} 张已经学完，剩余新词顺延到明天。想继续学习请返回首页试试「复习」或「混合」模式。`,
      }
    : {
        title: "今日新词额度已用完",
        body: `今天没有到期的复习卡，每日新词上限 ${limit} 张也已学完。休息一下，明天再来。`,
      };
}
