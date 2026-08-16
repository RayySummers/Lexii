/**
 * 评分预览与到期标签（纯函数，UI 副文案用）。
 *
 * 调度计算全部委托 @lexilexi/fsrs 的公开 API（Scheduler.preview），
 * 领域字段 → 调度器输入的换算直接复用 @lexilexi/core 的公开函数
 * memoryFieldsToCardInput（docs/domain-model.md §6），
 * 本模块只做：到期时间的中文相对标签格式化（纯展示）。
 */
import type { DateInput } from "@lexilexi/fsrs";
import { Scheduler } from "@lexilexi/fsrs";
import { memoryFieldsToCardInput } from "@lexilexi/core";
import type { IsoDate, MemoryStateFields, ReviewRating } from "@lexilexi/core";
import type { RatingTierMode } from "../lib/ratingTiers";

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

/**
 * 背词页评分按钮的到期副文案（RAY-279 真机反馈收敛口径）。
 *
 * 分钟级文案（「X 分钟后复习」类）返回 null（不展示）：
 * 1/6/10 分钟只描述「不认识」的词在当次会话内的重出节奏，App 无后台
 * 推送、不会按分钟把人叫回来，这类文案容易被误读为定时提醒。
 * 小时及以上（真实到期排期）保留原文案。
 */
export function dueLabelForDisplay(due: IsoDate, now: DateInput): string | null {
  const label = formatDueLabel(due, now);
  return label.endsWith("分钟") ? null : label;
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

/**
 * 从键盘事件解析评分档位（无匹配返回 null；不区分大小写）。
 *
 * 三档模式（RAY-265 默认）：Easy 不提供，数字 4 与字母 E 不映射
 * （评分档位只影响 UI 提供的入口，FSRS 算法核心不变）。
 */
export function ratingFromKey(key: string, mode: RatingTierMode): ReviewRating | null {
  const rating = KEY_TO_RATING.get(key.toLowerCase()) ?? null;
  if (rating === "easy" && mode === "three") {
    return null;
  }
  return rating;
}
