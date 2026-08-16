/**
 * 内联 SVG 图标（RAY-253 导航改版）。
 *
 * - stroke 继承 currentColor，颜色随文本 token（text-text 等）自动适配
 *   浅色/深色两套主题，不硬编码颜色；
 * - 全部为装饰性图标（aria-hidden），可达名由使用处按钮的
 *   aria-label / 文本内容提供。
 *
 * RAY-261：太阳/月亮主题图标已随 header 主题开关移除（主题改为设置页
 * 下拉选单）。RAY-265：新增发音（扬声器）与撤销（逆时针箭头）图标。
 * RAY-266：新增搜索（放大镜）图标（搜词页输入框）。
 * RAY-292：新增叉叉（关闭）图标（搜词历史单条删除）。
 */
interface IconProps {
  className?: string;
}

/** 向左箭头（返回上一页） */
export function BackArrowIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** 扬声器（朗读发音，RAY-265） */
export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

/** 逆时针箭头（撤销上一步，RAY-265） */
export function UndoIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 13" />
    </svg>
  );
}

/** 放大镜（搜词页输入框图标，RAY-266） */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

/** 叉叉（关闭，搜词历史单条删除，RAY-292） */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

/** 加号（加入生词本，RAY-284） */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** 书签（生词本入口与标记，RAY-284） */
export function BookmarkIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-6-4-6 4V3z" />
    </svg>
  );
}
