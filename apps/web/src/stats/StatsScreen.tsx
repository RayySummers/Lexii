/**
 * 统计页：连续天数 / 今日到期 / 已复习（RAY-240）。
 *
 * - 数据经 StatsDataProvider 加载（IndexedDB 聚合，口径见 stats/data.ts）；
 * - 加载中 / 加载失败（可重试）/ 无学习数据 三种状态有明确展示；
 * - 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
import { StatCard } from "../components/StatCard";
import { useStats } from "./useStats";
import type { StatsDataProvider } from "./types";

export interface StatsScreenProps {
  provider: StatsDataProvider;
  onExit(): void;
}

export function StatsScreen({ provider, onExit }: StatsScreenProps) {
  const { stats, error, reload } = useStats(provider);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">统计</h1>
        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          返回首页
        </button>
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface p-6">
          <p className="text-sm">无法读取本地数据：{error}</p>
          <button
            type="button"
            onClick={reload}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            重试
          </button>
        </div>
      ) : !stats ? (
        <p role="status" className="text-sm text-text-muted">
          正在加载…
        </p>
      ) : stats.reviewCount === 0 && stats.dueCount === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-sm">还没有学习数据。</p>
          <p className="mt-1 text-sm text-text-muted">完成第一次复习后，这里会显示你的学习统计。</p>
        </div>
      ) : (
        <section aria-label="学习统计" className="grid grid-cols-3 gap-3">
          <StatCard label="连续天数" value={String(stats.streakDays)} />
          <StatCard label="今日到期" value={String(stats.dueCount)} />
          <StatCard label="已复习" value={String(stats.reviewCount)} />
        </section>
      )}
    </main>
  );
}
