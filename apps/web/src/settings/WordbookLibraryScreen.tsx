/**
 * 词书库页（RAY-262：应用内浏览分级词书 + 老用户手动安装入口）。
 *
 * - 词书目录来自 @lexilexi/core 的 WORDBOOK_CATALOG（随 PWA 打包的静态
 *   数据，零网络请求），按 category 分组展示（考试词汇 / 冲刺词书）；
 * - 安装状态四态：已装 / 未装 / 安装中（断点进度）/ 可装（= 未装，有
 *   「安装」按钮）；安装中展示进度并可「继续安装」（installPreset 从
 *   进度断点续装）；
 * - 安装是长任务（数千词分块落库）：点击后 fire-and-forget 调
 *   provider.installWordbook，同时每 800ms 轮询安装状态刷新进度；安装
 *   完成或失败给出提示（新增/跳过词数来自安装结果）；
 * - RAY-288：页首「词书库概览」展示词书总数 / 词条总数 / 已装词书 /
 *   已装词条。口径：词数一律按「词书规模」计（每本词书声明的词条数，
 *   与卡片 totalCount 同源，内置词书与已装词书口径一致），跨词书重叠
 *   词条分别计入——新用户能看到词书规模，老用户可核对导入的词书数量/总数；
 * - 全程离线（local-first）：不请求网络、不埋点；全部颜色走 design
 *   tokens（浅色/深色自动生效）。
 *
 * 说明文案为过渡版（Vega 的正式文案交付后替换）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WordbookCategory } from "@lexilexi/core";
import { WORDBOOK_CATALOG } from "@lexilexi/core/presets/books";
import { ScreenHeader } from "../components/ScreenHeader";
import { StatCard } from "../components/StatCard";
import type { SettingsDataProvider, WordbookSummary } from "./types";

export interface WordbookLibraryScreenProps {
  provider: SettingsDataProvider;
  /** 返回设置页 */
  onBack(): void;
}

/** 安装状态轮询间隔（安装进行中时刷新进度） */
const POLL_INTERVAL_MS = 800;

/** 分组标题（category → 面向用户的分组名） */
const CATEGORY_TITLES: Record<WordbookCategory, string> = {
  exam: "考试词汇",
  sprint: "冲刺词书",
};

/**
 * RAY-288：词书库总规模（词书总数 / 词条总数，供页首概览）。
 * 口径：词数一律按「词书规模」计——每本词书声明的词条数（terms.length），
 * 与卡片展示的 summary.totalCount 同源；跨词书重叠词条分别计入。
 */
const CATALOG_BOOK_COUNT = WORDBOOK_CATALOG.length;
const CATALOG_WORD_COUNT = WORDBOOK_CATALOG.reduce((sum, book) => sum + book.terms.length, 0);

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 安装状态 → 中文徽标文案 */
function statusLabel(summary: WordbookSummary): string {
  switch (summary.status) {
    case "installed":
      return "已安装";
    case "installing":
      return `安装中（${summary.installedCount}/${summary.totalCount}）`;
    case "not-installed":
      return "未安装";
  }
}

export function WordbookLibraryScreen({ provider, onBack }: WordbookLibraryScreenProps) {
  const [summaries, setSummaries] = useState<WordbookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 有进行中安装 promise 的词书 id（用于「安装中…」按钮态与轮询续命） */
  const [pendingInstalls, setPendingInstalls] = useState<ReadonlySet<string>>(new Set());
  // 卸载保护（Oscar 评审 nit 3）：安装 promise 在组件卸载后仍可能 resolve，
  // 后续 setState / refresh 一律跳过，避免卸载组件上的状态更新。
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await provider.getWordbookSummaries();
    if (mountedRef.current) {
      setSummaries(result);
    }
  }, [provider]);

  // 首次进入读全部词书状态
  useEffect(() => {
    let cancelled = false;
    void provider
      .getWordbookSummaries()
      .then((result) => {
        if (!cancelled) {
          setSummaries(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(toErrorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // 安装进行中轮询：任一词书 installing 或有未完成的安装 promise 时每 800ms 刷新
  const anyInstalling = summaries?.some((summary) => summary.status === "installing") ?? false;

  // RAY-288：已装词书 / 已装词条（口径与卡片一致：按词书规模汇总，重叠分别计入；
  // 只计 status === "installed"，安装中的词书完成并刷新后才会进入统计）。
  const installedSummaries = summaries?.filter((summary) => summary.status === "installed");
  const installedBookCount = installedSummaries?.length;
  const installedWordCount = installedSummaries?.reduce(
    (sum, summary) => sum + summary.totalCount,
    0,
  );

  useEffect(() => {
    if (!anyInstalling && pendingInstalls.size === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      void refresh().catch(() => {
        // 轮询失败静默忽略：下一次轮询重试；初始加载已有错误展示路径
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [anyInstalling, pendingInstalls, refresh]);

  const handleInstall = useCallback(
    async (bookId: string) => {
      setError(null);
      setNotice(null);
      setPendingInstalls((current) => new Set(current).add(bookId));
      try {
        const result = await provider.installWordbook(bookId);
        if (!mountedRef.current) {
          return; // 组件已卸载：安装仍会落库完成，但不再更新 UI 状态
        }
        const skippedNote = result.skippedCount > 0 ? `，跳过已存在 ${result.skippedCount} 词` : "";
        setNotice(`词书已安装：新增 ${result.installedCount} 词${skippedNote}。`);
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        setError(`安装失败：${toErrorMessage(err)}`);
      } finally {
        if (mountedRef.current) {
          setPendingInstalls((current) => {
            const next = new Set(current);
            next.delete(bookId);
            return next;
          });
          void refresh().catch(() => {
            // 安装结束后的状态刷新失败静默忽略；用户手动操作会再触发
          });
        }
      }
    },
    [provider, refresh],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="词书库" onBack={onBack} backLabel="返回设置" />

      <p className="text-sm text-text-muted">
        浏览并安装考试分级词书（随应用内置，全程离线）。安装的词条进入学习队列，装什么学什么；与已学词条相同的词会自动跳过，不会重复学习。
      </p>

      {/* RAY-288：词书库概览——词书总数/词条总数（新用户看词书规模）
          + 已装词书/已装词条（老用户核对导入的词书数量/总数） */}
      <section aria-label="词书库概览" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="词书总数" value={`${CATALOG_BOOK_COUNT} 本`} />
        <StatCard label="词条总数" value={String(CATALOG_WORD_COUNT)} />
        <StatCard
          label="已装词书"
          value={installedBookCount === undefined ? "…" : `${installedBookCount} 本`}
        />
        <StatCard
          label="已装词条"
          value={installedWordCount === undefined ? "…" : String(installedWordCount)}
        />
      </section>
      <p className="text-xs text-text-muted">词数按词书规模计，跨词书重叠词条分别计入。</p>

      {(Object.keys(CATEGORY_TITLES) as WordbookCategory[]).map((category) => {
        const books = WORDBOOK_CATALOG.filter((book) => book.category === category);
        if (books.length === 0) {
          return null;
        }
        return (
          <section key={category} className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-base font-semibold">{CATEGORY_TITLES[category]}</h2>
            <div className="mt-4 flex flex-col gap-3">
              {books.map((book) => {
                const summary = summaries?.find((item) => item.id === book.id);
                return (
                  <WordbookCard
                    key={book.id}
                    bookId={book.id}
                    name={book.name}
                    description={book.description}
                    summary={summary}
                    installing={pendingInstalls.has(book.id)}
                    onInstall={handleInstall}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="rounded-xl border border-danger/40 bg-surface p-4 text-sm">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="rounded-xl border border-border bg-surface p-4 text-sm text-success"
          >
            {notice}
          </p>
        ) : null}
      </div>
    </main>
  );
}

interface WordbookCardProps {
  bookId: string;
  name: string;
  description: string;
  summary: WordbookSummary | undefined;
  /** 该词书有进行中的安装 promise（按钮显示「安装中…」） */
  installing: boolean;
  onInstall(bookId: string): void;
}

function WordbookCard({
  bookId,
  name,
  description,
  summary,
  installing,
  onInstall,
}: WordbookCardProps) {
  const status = summary?.status ?? "not-installed";
  const progressPercent =
    status === "installing" && summary && summary.totalCount > 0
      ? Math.round((summary.installedCount / summary.totalCount) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{name}</span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted">
          {summary ? statusLabel(summary) : "未安装"}
        </span>
      </span>
      <p className="text-xs leading-relaxed text-text-muted">{description}</p>
      <span className="text-xs text-text-muted">
        {summary ? summary.totalCount : "—"} 词条
        {status === "installed" && summary?.installedVersion
          ? ` · v${summary.installedVersion}`
          : ""}
      </span>
      {status === "installing" ? (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={summary?.totalCount ?? 0}
            aria-valuenow={summary?.installedCount ?? 0}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <button
            type="button"
            disabled={installing}
            onClick={() => void onInstall(bookId)}
            className="w-24 shrink-0 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing ? "安装中…" : "继续安装"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={status === "installed" || installing}
          onClick={() => void onInstall(bookId)}
          className="w-24 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "installed" ? "已安装" : "安装"}
        </button>
      )}
    </div>
  );
}
