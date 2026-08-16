/**
 * 首次打开弹窗（RAY-282）：local-first 说明 + 备份建议。
 *
 * - 只在首次打开出现：展示/隐藏由 App 级状态控制，已读标记读写走
 *   `lib/firstOpenDialog`（本组件自身不读存储，便于测试与复用）；
 * - 文案：Vega 产出（RAY-281），与设置页「导出数据」区同一口径；
 * - 浅色/深色两套：全部颜色走 design tokens（bg-surface / text-text 等），
 *   随 <html data-theme> 自动切换，不硬编码颜色；
 * - 无障碍：role="dialog" + aria-modal + aria-labelledby；打开时焦点落到
 *   「开始使用」按钮；单按钮弹窗内 Tab 保持焦点不外泄，Escape 与点击按钮
 *   行为一致（均由 onDismiss 关闭）。
 */
import { useEffect, useRef } from "react";

export interface FirstOpenDialogProps {
  /** 关闭回调：由调用方负责写已读标记并卸载本组件 */
  onDismiss(): void;
}

export function FirstOpenDialog({ onDismiss }: FirstOpenDialogProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      // 单焦点弹窗：拦截 Tab 避免焦点外泄到背景内容
      if (event.key === "Tab") {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-open-dialog-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 id="first-open-dialog-title" className="text-lg font-semibold text-text">
          学习数据只存本机
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          乐希是本地优先（local-first）应用：词书和学习记录都保存在这台设备上，不会上传到任何服务器。数据可能因清理浏览器数据或卸载而丢失，建议定期导出备份——设置页「导出数据」中随时可以导出，换设备时可原样导回。
        </p>
        <div className="mt-6 flex justify-end">
          <button
            ref={buttonRef}
            type="button"
            onClick={onDismiss}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
}
