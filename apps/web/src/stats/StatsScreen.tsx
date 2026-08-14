/**
 * 统计页：8 项统计（RAY-252：统计面板扩充）。
 *
 * 连续天数 / 累计天数 / 今日已学习（次数）/ 今日已复习（次数）/
 * 今日到期（词条）/ 明日到期（词条）/ 累计已完成（次数）/ 累计已完成（词条）。
 *
 * - 数据经 StatsDataProvider 加载（IndexedDB 聚合，口径见 stats/data.ts 与
 *   packages/stats README）；统计数据全本地计算，不联网不上传；
 * - 加载中 / 加载失败（可重试）/ 无学习数据 三种状态有明确展示；
 * - 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
import { StatCard } from "../components/StatCard";
import { useStats } from "./useStats";
import type { StatsDataProvider, StatsSnapshot } from "./types";

export interface StatsScreenProps {
  provider: StatsDataProvider;
  onExit(): void;
}

/** 8 项统计的展示顺序与文案（口径与 packages/stats README 对齐） */
const STAT_ROWS: ReadonlyArray<{ label: string; value: (stats: StatsSnapshot) => number }> = [
  { label: "连续天数", value: (stats) => stats.streakDays },
  { label: "累计天数", value: (stats) => stats.totalDays },
  { label: "今日已学习（次数）", value: (stats) => stats.todayLearnCount },
  { label: "今日已复习（次数）", value: (stats) => stats.todayReviewCount },
  { label: "今日到期（词条）", value: (stats) => stats.dueCount },
  { label: "明日到期（词条）", value: (stats) => stats.dueTomorrowCount },
  { label: "累计已完成（次数）", value: (stats) => stats.reviewCount },
  { label: "累计已完成（词条）", value: (stats) => stats.completedWordCount },
];

export function StatsScreen({ provider, onExit }: StatsScreenProps) {
  const { stats, error, reload } = useStats(provider);

  const hasData =
    stats !== null && (stats.reviewCount > 0 || stats.dueCount > 0 || stats.dueTomorrowCount > 0);

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
          <p className="text-sm">无法读取本地数据，请重试。</p>
          <details className="text-xs text-text-muted">
            <summary>错误详情</summary>
            <p className="mt-1 whitespace-pre-wrap">{error}</p>
          </details>
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
      ) : !hasData ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-sm">还没有学习数据。</p>
          <p className="mt-1 text-sm text-text-muted">完成第一次复习后，这里会显示你的学习统计。</p>
        </div>
      ) : (
        <section aria-label="学习统计" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STAT_ROWS.map((row) => (
            <StatCard key={row.label} label={row.label} value={String(row.value(stats))} />
          ))}
        </section>
      )}
    </main>
  );
}
