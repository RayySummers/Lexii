/**
 * 首页：品牌、今日到期徽标与复习入口。
 *
 * - 到期徽标数据经 StatsDataProvider（statsProvider 为 null 时不展示，
 *   如无 IndexedDB 的测试环境）；
 * - 仅承载展示与导航，复习数据一律由 ReviewScreen 加载；
 * - 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
import { useStats } from "./stats/useStats";
import type { StatsDataProvider } from "./stats/types";

export interface HomeScreenProps {
  onStartReview(): void;
  /** 统计数据源（今日到期徽标；null = 环境不支持，不展示徽标） */
  statsProvider: StatsDataProvider | null;
}

const FEATURES = [
  { title: "本地优先", description: "词库与学习记录只存本机" },
  { title: "FSRS 排期", description: "间隔复习，按时再见面" },
  { title: "支持导入词库", description: "CSV 词表一键导入" },
] as const;

export function HomeScreen({ onStartReview, statsProvider }: HomeScreenProps) {
  const { stats } = useStats(statsProvider);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">定制化背单词体验</h1>
      <p className="mt-4 text-lg text-text-muted">现代简洁 · 多语言 · 支持导入词库 · local-first</p>

      <div className="mt-10 flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={onStartReview}
          className="rounded-full bg-primary px-8 py-3.5 text-base font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          开始复习
        </button>
        <DueBadge
          dueCount={stats?.dueCount ?? null}
          hasReviewed={stats !== null && stats.reviewCount > 0}
        />
      </div>

      <section aria-labelledby="features-heading" className="mt-14 grid gap-4 sm:grid-cols-3">
        <h2 id="features-heading" className="sr-only">
          特性
        </h2>
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold">{feature.title}</h3>
            <p className="mt-1 text-sm text-text-muted">{feature.description}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

/**
 * 今日到期徽标：
 * - 有到期 → 强调徽标「今日到期 N 词」；
 * - 无到期但复习过 → 弱化文案「今日无到期词」；
 * - 数据未加载 / 无任何学习记录 → 不渲染（避免误导）。
 * 异步加载，容器用 aria-live 让读屏器能感知到变化。
 */
function DueBadge({ dueCount, hasReviewed }: { dueCount: number | null; hasReviewed: boolean }) {
  if (dueCount === null || (dueCount === 0 && !hasReviewed)) {
    return null;
  }
  if (dueCount > 0) {
    return (
      <span
        aria-live="polite"
        className="rounded-full border border-accent/40 bg-surface px-4 py-1.5 text-sm font-medium text-accent"
      >
        今日到期 {dueCount} 词
      </span>
    );
  }
  return (
    <span aria-live="polite" className="text-sm text-text-muted">
      今日无到期词，休息一下。
    </span>
  );
}
