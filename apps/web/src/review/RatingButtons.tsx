/**
 * 四档评分按钮（Again / Hard / Good / Easy）。
 *
 * - 每档一个语义色（danger / accent / primary / success，全部走 design tokens，
 *   深浅两套自动生效，无硬编码颜色）；
 * - 副文案显示该档评分后的到期时间（previewGradeDueLabels 预览，与真实排期一致）；
 * - 右上角 kbd 提示快捷键（1–4，字母别名见 ReviewScreen 的键盘处理）；
 * - 移动端 2×2 网格，sm 以上一行四枚，触控目标 ≥ 48px。
 */
import type { ReviewRating } from "@lexilexi/core";
import { RATING_SHORTCUTS } from "./grade";

interface RatingButtonConfig {
  rating: ReviewRating;
  label: string;
  shortcut: string;
  textClass: string;
  hoverBorderClass: string;
  hoverBgClass: string;
}

const RATING_CONFIGS: readonly RatingButtonConfig[] = [
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
  /** 各档评分后的到期时间文案（已格式化，如 { again: "10分钟", good: "1天" }） */
  dueLabels: Record<ReviewRating, string>;
  onGrade(rating: ReviewRating): void;
}

export function RatingButtons({ dueLabels, onGrade }: RatingButtonsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="评分">
      {RATING_CONFIGS.map((config) => (
        <button
          key={config.rating}
          type="button"
          onClick={() => onGrade(config.rating)}
          aria-label={`评分：${config.label}，快捷键 ${config.shortcut}`}
          className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold transition-colors ${config.hoverBorderClass} ${config.hoverBgClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:scale-[0.98]`}
        >
          <span className={`text-base font-bold ${config.textClass}`}>{config.label}</span>
          <span className="text-xs text-text-muted">{dueLabels[config.rating]}</span>
          <kbd className="absolute right-2 top-2 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-normal text-text-muted">
            {config.shortcut}
          </kbd>
        </button>
      ))}
    </div>
  );
}
