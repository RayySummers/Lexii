/**
 * 统计数值卡片（设置页概览与统计页共用）。
 *
 * 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{label}</p>
    </div>
  );
}
