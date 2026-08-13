/**
 * 首页：品牌与复习入口。
 *
 * 仅承载展示与导航，复习数据一律由 ReviewScreen 加载；
 * 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
export interface HomeScreenProps {
  onStartReview(): void;
}

const FEATURES = [
  { title: "本地优先", description: "词库与学习记录只存本机" },
  { title: "FSRS 排期", description: "间隔复习，按时再见面" },
  { title: "支持导入词库", description: "CSV 词表一键导入" },
] as const;

export function HomeScreen({ onStartReview }: HomeScreenProps) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">定制化背单词体验</h1>
      <p className="mt-4 text-lg text-text-muted">现代简洁 · 多语言 · 支持导入词库 · local-first</p>

      <button
        type="button"
        onClick={onStartReview}
        className="mt-10 rounded-full bg-primary px-8 py-3.5 text-base font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        开始复习
      </button>

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
