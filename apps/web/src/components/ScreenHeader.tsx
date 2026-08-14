/**
 * 内部页面统一导航头（RAY-253 反馈 5）。
 *
 * 用户偏好的导航样式：左侧放向左箭头返回上一页，标题右对齐。
 * 设置页与统计页采用同样式（复习页沿用该箭头按钮样式）。
 * 返回按钮可达名默认「返回首页」（顶层页面）；二级页面（如设置页内的
 * 「数据来源与许可」）经 backLabel 覆盖为「返回设置」。
 *
 * 可达性：返回按钮的可达名为 backLabel（图标为装饰性，aria-hidden）。
 */
import { BackArrowIcon } from "./icons";

export interface ScreenHeaderProps {
  /** 页面标题（右对齐） */
  title: string;
  /** 返回上一页 */
  onBack(): void;
  /** 返回按钮可达名（默认「返回首页」，与旧版文字按钮一致） */
  backLabel?: string;
}

export function ScreenHeader({ title, onBack, backLabel = "返回首页" }: ScreenHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="rounded-full border border-border bg-surface p-2.5 text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <BackArrowIcon className="h-5 w-5" />
      </button>
      <h1 className="text-right text-xl font-bold tracking-tight">{title}</h1>
    </div>
  );
}
