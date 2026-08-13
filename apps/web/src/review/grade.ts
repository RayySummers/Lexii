/**
 * 评分预览与到期标签（纯函数，UI 副文案用）。
 *
 * 调度计算全部委托 @lexilexi/fsrs 的公开 API（Scheduler.preview），
 * 本模块只做：领域字段 → 调度器输入的结构换算（docs/domain-model.md §6），
 * 以及到期时间的中文相对标签格式化（纯展示）。
 */
import type { CardInput, DateInput } from "@lexilexi/fsrs";
import { Scheduler } from "@lexilexi/fsrs";
import type { IsoDate, MemoryStateFields, ReviewRating } from "@lexilexi/core";

/**
 * MemoryStateFields → 调度器卡片输入（docs/domain-model.md §6 换算约定）。
 *
 * 与 packages/core/src/studyLoop.ts 内部的 fieldsToCard 语义一致（学习步骤
 * 游标不在领域模型单独持久化，`scheduled_days` 只存在于调度过程中，输入恒为
 * 0；旧版记录缺 `learningSteps` 时防御性兜底为 0）。若 core 未来公开该换算
 * 函数，应替换本实现以免两处漂移。
 */
export function memoryFieldsToCardInput(fields: MemoryStateFields): CardInput {
  return {
    due: new Date(fields.due),
    stability: fields.stabilityDays,
    difficulty: fields.difficulty,
    scheduled_days: 0,
    learning_steps: fields.learningSteps ?? 0,
    reps: fields.reps,
    lapses: fields.lapses,
    state: fields.status,
    last_review: fields.lastReviewAt ? new Date(fields.lastReviewAt) : undefined,
  };
}

/** 四档评分的到期时间预览（评分按钮副文案，如 Again → 10分钟） */
export interface GradeDueLabels {
  again: IsoDate;
  hard: IsoDate;
  good: IsoDate;
  easy: IsoDate;
}

/**
 * 对当前记忆状态做四档评分预览，返回各档的到期时间（ISO）。
 * 纯计算不落库；与 core gradeReview 的排期共享同一调度器实现，因此
 * 按钮上展示的到期时间与真实评分结果一致。
 */
export function previewGradeDueLabels(fields: MemoryStateFields, now: DateInput): GradeDueLabels {
  const preview = new Scheduler(memoryFieldsToCardInput(fields), now).preview();
  return {
    again: preview.again.card.due.toISOString(),
    hard: preview.hard.card.due.toISOString(),
    good: preview.good.card.due.toISOString(),
    easy: preview.easy.card.due.toISOString(),
  };
}

/**
 * 到期时间的中文相对标签（评分按钮副文案）。
 *
 * 档位：<1分钟 / X分钟 / X小时 / X天 / X个月 / X年。
 * 过去或非法时间防御性返回「现在」（due 由调度器产出，正常不会出现，
 * 兜底仅为避免脏数据渲染成负数文案）。
 */
export function formatDueLabel(due: IsoDate, now: DateInput): string {
  const dueMs = Date.parse(due);
  const nowMs = new Date(now).getTime();
  const deltaMs = dueMs - nowMs;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return "现在";
  }
  const minutes = deltaMs / 60_000;
  if (minutes < 1) {
    return "<1分钟";
  }
  if (minutes < 60) {
    return `${Math.floor(minutes)}分钟`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${Math.floor(hours)}小时`;
  }
  const days = hours / 24;
  if (days < 30) {
    return `${Math.floor(days)}天`;
  }
  const months = days / 30;
  if (months < 12) {
    return `${Math.floor(months)}个月`;
  }
  return `${Math.floor(months / 12)}年`;
}

/** 评分档位 → 键盘快捷键（数字键为主，字母键为助记别名） */
export const RATING_SHORTCUTS: Record<ReviewRating, string> = {
  again: "1",
  hard: "2",
  good: "3",
  easy: "4",
};

/** 键盘事件 key（小写）→ 评分档位；1-4 与 a/h/g/e 等价 */
const KEY_TO_RATING: ReadonlyMap<string, ReviewRating> = new Map([
  ["1", "again"],
  ["a", "again"],
  ["2", "hard"],
  ["h", "hard"],
  ["3", "good"],
  ["g", "good"],
  ["4", "easy"],
  ["e", "easy"],
]);

/** 从键盘事件解析评分档位（无匹配返回 null；不区分大小写） */
export function ratingFromKey(key: string): ReviewRating | null {
  return KEY_TO_RATING.get(key.toLowerCase()) ?? null;
}
