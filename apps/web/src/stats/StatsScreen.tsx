/**
 * 统计页：8 项统计（RAY-252：统计面板扩充）+ 导航改版（RAY-253）。
 *
 * 连续天数 / 累计天数 / 今日已学习（次数）/ 今日已复习（次数）/
 * 今日待学（词条）/ 明日到期（词条）/ 累计已完成（次数）/ 累计已完成（词条）。
 *
 * RAY-255：「今日到期（词条）」→「今日待学（词条）」（dueCount 含
 * reps===0 的新词）；统计口径（stats.dueCount 语义）不变。
 *
 * RAY-295：统计页「今日待学（词条）」改用 stats.newCardsRemainingToday——
 * min(每日新卡上限, 剩余新卡数) − 今日已学习（下限 0），按每日新卡上限
 * 过滤、不再显示全部未学新卡总数；首页徽标仍用未截断的 dueCount（RAY-260
 * 口径，另有额度提示说明二者关系）。
 *
 * - 数据经 StatsDataProvider 加载（IndexedDB 聚合，口径见 stats/data.ts 与
 *   packages/stats README）；统计数据全本地计算，不联网不上传；
 * - 加载中 / 加载失败（可重试）/ 无学习数据 三种状态有明确展示；
 * - RAY-253 反馈 5：统一导航头（左侧返回箭头、标题右对齐，同设置页）；
 * - 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
import { ScreenHeader } from "../components/ScreenHeader";
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
  { label: "今日待学（词条）", value: (stats) => stats.newCardsRemainingToday },
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
      <ScreenHeader title="统计" onBack={onExit} />

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
