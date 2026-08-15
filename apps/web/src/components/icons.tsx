/**
 * 内联 SVG 图标（RAY-253 导航改版）。
 *
 * - stroke 继承 currentColor，颜色随文本 token（text-text 等）自动适配
 *   浅色/深色两套主题，不硬编码颜色；
 * - 全部为装饰性图标（aria-hidden），可达名由使用处按钮的
 *   aria-label / 文本内容提供。
 *
 * RAY-261：太阳/月亮主题图标已随 header 主题开关移除（主题改为设置页
 * 下拉选单），当前仅剩返回箭头。
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
