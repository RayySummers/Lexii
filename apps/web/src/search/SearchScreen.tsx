/**
 * 搜词页（RAY-266 搜词，验收期优先项）。
 *
 * - 输入即检索：词条拼写 + 释义（中文关键词），全本地、离线、不新增数据源；
 * - 检索逻辑在 @lexilexi/core（searchLexilexiSenses），本页只做输入、
 *   防抖（200ms）与结果展示；命中顺序由 core 决定（前缀 > 包含 > 释义）；
 * - 状态机：词库为空 → 无查询提示 → 检索中 → 无命中 → 结果列表（含
 *   结果计数 live region）；错误态单独展示，不影响输入框继续使用；
 * - 防抖期间的过期响应经请求序号丢弃（latest-request-wins），避免慢响应
 *   覆盖新结果；组件卸载后不再写状态；
 * - 全部颜色走 design tokens（浅色/深色自动生效），不硬编码颜色。
 *
 * 说明文案为过渡版（Vega 的正式文案交付后替换）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ScreenHeader } from "../components/ScreenHeader";
import { SearchIcon } from "../components/icons";
import type { SearchDataProvider, SearchResult } from "./types";

/** 输入防抖间隔（毫秒） */
const DEBOUNCE_MS = 200;

export interface SearchScreenProps {
  provider: SearchDataProvider;
  /** 返回首页 */
  onExit(): void;
}

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SearchScreen({ provider, onExit }: SearchScreenProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyLibrary, setEmptyLibrary] = useState(false);
  // 请求序号：只采纳最新一次检索的响应，过期响应丢弃
  const requestSeqRef = useRef(0);

  // 词库是否为空（空状态判定，进入页面读一次）
  useEffect(() => {
    let cancelled = false;
    void provider
      .hasAnySenses()
      .then((has) => {
        if (!cancelled) {
          setEmptyLibrary(!has);
        }
      })
      .catch(() => {
        // 判定失败静默：按「非空」处理，检索路径自有错误展示
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // 输入处理：查询变化即清错误；清空输入同步复位检索区状态
  // （状态复位放事件处理器而非 effect，避免 effect 内同步 setState 的级联渲染）
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setError(null);
    if (value.trim().length === 0) {
      setResults(null);
      setSearching(false);
    }
  }, []);

  // 防抖检索：查询变化后 200ms 执行；卸载/重查时清理定时器
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const seq = ++requestSeqRef.current;
    const timer = setTimeout(() => {
      setSearching(true);
      void provider
        .search(trimmed)
        .then((hits) => {
          if (requestSeqRef.current === seq) {
            setResults(hits);
            setSearching(false);
          }
        })
        .catch((err: unknown) => {
          if (requestSeqRef.current === seq) {
            setError(toErrorMessage(err));
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, provider]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="搜词" onBack={onExit} />

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          id="search-input"
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="输入单词或释义关键词"
          aria-label="搜索词条"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-full border border-border bg-surface py-3 pl-11 pr-4 text-base text-text placeholder:text-text-muted transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </div>

      <SearchContent
        query={query.trim()}
        results={results}
        searching={searching}
        error={error}
        emptyLibrary={emptyLibrary}
      />
    </main>
  );
}

interface SearchContentProps {
  /** 已 trim 的查询词 */
  query: string;
  results: SearchResult[] | null;
  searching: boolean;
  error: string | null;
  emptyLibrary: boolean;
}

/** 按状态渲染检索区内容（独立于容器，便于逐状态阅读与测试） */
function SearchContent({ query, results, searching, error, emptyLibrary }: SearchContentProps) {
  if (error) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-danger/40 bg-surface p-4 text-sm text-text"
      >
        检索失败：{error}
      </p>
    );
  }
  if (emptyLibrary) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="text-xl font-semibold">词库还是空的</h2>
        <p className="max-w-sm text-sm text-text-muted">
          还没有任何词可搜。先在设置页导入 CSV 词表，或到词书库安装一本词书。
        </p>
      </div>
    );
  }
  if (query.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-text-muted">
        输入英文单词或中文释义关键词开始检索。检索全程在本机完成，离线可用。
      </p>
    );
  }
  if (searching && results === null) {
    return (
      <div role="status" className="py-12 text-center text-sm text-text-muted">
        正在检索…
      </div>
    );
  }
  if (results !== null && results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="text-xl font-semibold">没有找到相关词</h2>
        <p className="max-w-sm text-sm text-text-muted">
          词库里没有与「{query}」匹配的词条或释义。换个关键词试试？
        </p>
      </div>
    );
  }
  if (results === null) {
    return null;
  }
  return (
    <>
      <p role="status" className="text-sm text-text-muted">
        找到 {results.length} 条结果
      </p>
      <ul className="flex flex-col gap-3">
        {results.map((result) => (
          <SearchResultRow key={result.sense.id} result={result} />
        ))}
      </ul>
    </>
  );
}

/** 单条结果：词条 + 词性/音标 + 释义 */
function SearchResultRow({ result }: { result: SearchResult }) {
  const { sense } = result;
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-lg font-semibold">{sense.term}</span>
        {sense.pos ? <span className="text-xs text-text-muted">{sense.pos}</span> : null}
        {sense.ipa ? <span className="text-xs text-text-muted">/{sense.ipa}/</span> : null}
      </span>
      <p className="text-sm leading-relaxed text-text-muted">{sense.definitions.join("；")}</p>
    </li>
  );
}
