import { APP_NAME, APP_NAME_ZH } from "@lexilexi/core";
import { useTheme } from "./hooks/useTheme";

const PACKAGES = [
  { name: "@lexilexi/core", description: "核心领域模型与共享类型" },
  { name: "@lexilexi/fsrs", description: "FSRS-7 调度算法（骨架）" },
  { name: "@lexilexi/stats", description: "学习统计（骨架）" },
  { name: "@lexilexi/eval", description: "学习评测（骨架）" },
  { name: "@lexilexi/ai", description: "AI 能力（空壳，见 README）" },
];

export function App() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-bg text-text transition-colors">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight">{APP_NAME_ZH}</span>
          <span className="text-sm text-text-muted">{APP_NAME}</span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-pressed={theme === "dark"}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight">定制化背单词体验</h1>
        <p className="mt-4 text-lg text-text-muted">
          现代简洁 · 多语言 · 支持导入词库 · local-first
        </p>

        <section
          aria-labelledby="workspace-heading"
          className="mt-12 rounded-xl border border-border bg-surface p-6"
        >
          <h2 id="workspace-heading" className="text-lg font-semibold">
            Monorepo 工作区
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            pnpm workspace · apps/web + packages/* · TypeScript strict · Vitest
          </p>
          <ul className="mt-4 space-y-2">
            {PACKAGES.map((pkg) => (
              <li
                key={pkg.name}
                className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
              >
                <code className="text-sm font-medium text-primary">{pkg.name}</code>
                <span className="text-sm text-text-muted">{pkg.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
