/**
 * 评分按钮（RAY-265：默认三档，设置可切四档）。
 *
 * - 三档（默认）：认识 / 模糊 / 不认识 → FSRS Good / Hard / Again；
 *   一档一个语义色（primary / accent / danger，全部走 design tokens，
 *   深浅两套自动生效，无硬编码颜色）；
 * - 四档（Anki 传统）：Again / Hard / Good / Easy，沿用既有样式与快捷键；
 * - 副文案显示该档评分后的到期时间（previewGradeDueLabels 预览，与真实排期一致）；
 *   分钟级（「X 分钟后复习」类，RAY-279 真机反馈）为 null，不渲染副文案；
 * - 右上角 kbd 提示快捷键（三档 1–3，四档 1–4）；
 * - 三档（默认）全视口一排三个（RAY-278 返工：手机端此前 2×2 缺右下角）；
 *   四档移动端 2×2、sm 以上一排四个；网格等宽，触控目标 ≥ 48px。
 */
import type { ReviewRating } from "@lexilexi/core";
import type { RatingTierMode } from "../lib/ratingTiers";
import { RATING_SHORTCUTS } from "./grade";

interface RatingButtonConfig {
  rating: ReviewRating;
  label: string;
  shortcut: string;
  textClass: string;
  hoverBorderClass: string;
  hoverBgClass: string;
}

/** 三档（默认）：认识 / 模糊 / 不认识 → Good / Hard / Again */
const THREE_TIER_CONFIGS: readonly RatingButtonConfig[] = [
  {
    rating: "again",
    label: "不认识",
    shortcut: RATING_SHORTCUTS.again,
    textClass: "text-danger",
    hoverBorderClass: "hover:border-danger",
    hoverBgClass: "hover:bg-danger/10",
  },
  {
    rating: "hard",
    label: "模糊",
    shortcut: RATING_SHORTCUTS.hard,
    textClass: "text-accent",
    hoverBorderClass: "hover:border-accent",
    hoverBgClass: "hover:bg-accent/10",
  },
  {
    rating: "good",
    label: "认识",
    shortcut: RATING_SHORTCUTS.good,
    textClass: "text-primary",
    hoverBorderClass: "hover:border-primary",
    hoverBgClass: "hover:bg-primary/10",
  },
];

/** 四档（Anki 传统）：Again / Hard / Good / Easy */
const FOUR_TIER_CONFIGS: readonly RatingButtonConfig[] = [
  {
    rating: "again",
    label: "Again",
    shortcut: RATING_SHORTCUTS.again,
    textClass: "text-danger",
    hoverBorderClass: "hover:border-danger",
    hoverBgClass: "hover:bg-danger/10",
  },
  {
    rating: "hard",
    label: "Hard",
    shortcut: RATING_SHORTCUTS.hard,
    textClass: "text-accent",
    hoverBorderClass: "hover:border-accent",
    hoverBgClass: "hover:bg-accent/10",
  },
  {
    rating: "good",
    label: "Good",
    shortcut: RATING_SHORTCUTS.good,
    textClass: "text-primary",
    hoverBorderClass: "hover:border-primary",
    hoverBgClass: "hover:bg-primary/10",
  },
  {
    rating: "easy",
    label: "Easy",
    shortcut: RATING_SHORTCUTS.easy,
    textClass: "text-success",
    hoverBorderClass: "hover:border-success",
    hoverBgClass: "hover:bg-success/10",
  },
];

export interface RatingButtonsProps {
  /**
   * 各档评分后的到期时间文案（已格式化，如 { again: "10分钟", good: "1天" }）；
   * null = 该档不展示副文案（分钟级「X 分钟后复习」文案，RAY-279 起移除）。
   */
  dueLabels: Record<ReviewRating, string | null>;
  /** 评分档位模式（三档默认 / 四档 Anki 传统） */
  mode: RatingTierMode;
  onGrade(rating: ReviewRating): void;
}

export function RatingButtons({ dueLabels, onGrade, mode }: RatingButtonsProps) {
  const configs = mode === "three" ? THREE_TIER_CONFIGS : FOUR_TIER_CONFIGS;
  // 类名必须字面量出现（Tailwind 编译期扫描），动态拼接会丢样式。
  // 三档：全视口一排三个（RAY-278 返工，手机端不再 2×2 缺右下角）；
  // 四档：移动端 2×2 等宽、sm 以上一排四个。
  const gridClass = mode === "three" ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  return (
    <div className={`grid gap-2 ${gridClass}`} role="group" aria-label="评分">
      {configs.map((config) => {
        const dueLabel = dueLabels[config.rating];
        return (
          <button
            key={config.rating}
            type="button"
            onClick={() => onGrade(config.rating)}
            aria-label={`评分：${config.label}，快捷键 ${config.shortcut}`}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold transition-colors ${config.hoverBorderClass} ${config.hoverBgClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:scale-[0.98]`}
          >
            <span className={`text-base font-bold ${config.textClass}`}>{config.label}</span>
            {dueLabel !== null ? <span className="text-xs text-text-muted">{dueLabel}</span> : null}
            <kbd className="absolute right-2 top-2 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-normal text-text-muted">
              {config.shortcut}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
