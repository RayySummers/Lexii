/**
 * 内部页面统一导航头（RAY-253 反馈 5）。
 *
 * 用户偏好的导航样式：左侧放向左箭头返回上一页，标题右对齐。
 * 设置页与统计页采用同样式（复习页沿用该箭头按钮样式）。
 *
 * 可达性：返回按钮的可达名为「返回首页」（图标为装饰性，aria-hidden），
 * 与旧版文字按钮保持一致，读屏器与既有测试均不受影响。
 */
import { BackArrowIcon } from "./icons";

export interface ScreenHeaderProps {
  /** 页面标题（右对齐） */
  title: string;
  /** 返回上一页（返回首页） */
  onBack(): void;
}

export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回首页"
        className="rounded-full border border-border bg-surface p-2.5 text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <BackArrowIcon className="h-5 w-5" />
      </button>
      <h1 className="text-right text-xl font-bold tracking-tight">{title}</h1>
    </div>
  );
}
