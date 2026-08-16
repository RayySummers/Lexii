/**
 * 搜词页（RAY-266 搜词，验收期优先项；RAY-292 未收录提示 + 搜词历史）。
 *
 * - 输入即检索：词条拼写 + 释义（中文关键词），全本地、离线、不新增数据源；
 * - 检索逻辑在 @lexilexi/core（searchLexilexiSenses），本页只做输入、
 *   防抖（200ms）与结果展示；命中顺序由 core 决定（前缀 > 包含 > 释义）；
 * - 状态机：词库为空 → 无查询提示（有历史时先展示搜索历史）→ 检索中 →
 *   无命中（明确提示「库内无此词，可导入自建词库」）→ 结果列表（含
 *   结果计数 live region）；错误态单独展示，不影响输入框继续使用；
 * - RAY-292 搜词历史：只存本地（localStorage，见 lib/searchHistory），
 *   仅记录实际执行的检索（防抖后发出的查询）；点击历史词条回填输入并
 *   重新检索，每条带叉叉可单条删除；历史上传/埋点一律不涉及（隐私红线）；
 * - 防抖期间的过期响应经请求序号丢弃（latest-request-wins），避免慢响应
 *   覆盖新结果；组件卸载后不再写状态；
 * - 全部颜色走 design tokens（浅色/深色自动生效），不硬编码颜色。
 *
 * 说明文案为过渡版（Vega 的正式文案交付后替换）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ScreenHeader } from "../components/ScreenHeader";
import { CloseIcon, SearchIcon } from "../components/icons";
import {
  loadSearchHistory,
  recordSearchHistory,
  removeSearchHistory,
  type SearchHistoryStorage,
} from "../lib/searchHistory";
import type { SearchDataProvider, SearchResult } from "./types";

/** 输入防抖间隔（毫秒） */
const DEBOUNCE_MS = 200;

export interface SearchScreenProps {
  provider: SearchDataProvider;
  /** 返回首页 */
  onExit(): void;
  /**
   * 搜词历史存储（测试注入内存 storage；默认 window.localStorage）。
   * 仅本地读写，绝不上传。
   */
  historyStorage?: SearchHistoryStorage;
}

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 解析历史存储（未注入且非浏览器环境 → 无历史，不抛错） */
function resolveHistoryStorage(storage?: SearchHistoryStorage): SearchHistoryStorage | null {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function SearchScreen({ provider, onExit, historyStorage }: SearchScreenProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyLibrary, setEmptyLibrary] = useState(false);
  const [history, setHistory] = useState<string[]>(() =>
    loadSearchHistory(resolveHistoryStorage(historyStorage)),
  );
  // 请求序号：只采纳最新一次检索的响应，过期响应丢弃
  const requestSeqRef = useRef(0);
  // 输入框引用：点选历史词条后焦点回到输入框（历史列表随输入卸载，避免焦点丢失）
  const inputRef = useRef<HTMLInputElement>(null);

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

  // 防抖检索：查询变化后 200ms 执行；卸载/重查时清理定时器。
  // 实际执行的检索同步记入本地历史（输入中途的字符不记录）。
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const seq = ++requestSeqRef.current;
    const timer = setTimeout(() => {
      setSearching(true);
      setHistory(recordSearchHistory(resolveHistoryStorage(historyStorage), trimmed));
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
  }, [query, provider, historyStorage]);

  // 点击历史词条：回填输入（防抖检索随之执行，该词条也会移到历史最前），
  // 焦点移回输入框，避免历史列表随输入卸载后键盘焦点丢失
  const handleHistorySelect = useCallback((term: string) => {
    setQuery(term);
    setError(null);
    inputRef.current?.focus();
  }, []);

  // 单条删除历史（叉叉）
  const handleHistoryRemove = useCallback(
    (term: string) => {
      setHistory(removeSearchHistory(resolveHistoryStorage(historyStorage), term));
    },
    [historyStorage],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="搜词" onBack={onExit} />

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          id="search-input"
          ref={inputRef}
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
        history={history}
        onSelectHistory={handleHistorySelect}
        onRemoveHistory={handleHistoryRemove}
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
  /** 本地搜索历史（最新在前；仅本地存储，不上传） */
  history: string[];
  onSelectHistory(term: string): void;
  onRemoveHistory(term: string): void;
}

/** 按状态渲染检索区内容（独立于容器，便于逐状态阅读与测试） */
function SearchContent({
  query,
  results,
  searching,
  error,
  emptyLibrary,
  history,
  onSelectHistory,
  onRemoveHistory,
}: SearchContentProps) {
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
    if (history.length > 0) {
      return (
        <SearchHistoryList
          history={history}
          onSelect={onSelectHistory}
          onRemove={onRemoveHistory}
        />
      );
    }
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
        <h2 className="text-xl font-semibold">库内无此词</h2>
        <p className="max-w-sm text-sm text-text-muted">
          词库里没有与「{query}」匹配的词条，可以导入自建词库再搜——在设置页导入 CSV
          词表，或到词书库安装更多词书。
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

interface SearchHistoryListProps {
  history: string[];
  onSelect(term: string): void;
  onRemove(term: string): void;
}

/**
 * 搜索历史（RAY-292）：最新在前；点击词条回填输入重新检索，
 * 每条带叉叉按钮可单条删除（历史仅存本机 localStorage，不上传）。
 */
function SearchHistoryList({ history, onSelect, onRemove }: SearchHistoryListProps) {
  return (
    <section aria-label="搜索历史" className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium text-text-muted">搜索历史</h2>
      <ul className="flex flex-col gap-2">
        {history.map((term) => (
          <li
            key={term}
            className="flex items-center gap-1 rounded-xl border border-border bg-surface py-1.5 pl-4 pr-1.5"
          >
            <button
              type="button"
              onClick={() => onSelect(term)}
              className="min-w-0 flex-1 truncate py-1 text-left text-base text-text transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {term}
            </button>
            <button
              type="button"
              onClick={() => onRemove(term)}
              aria-label={`删除搜索历史「${term}」`}
              className="shrink-0 rounded-full p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
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
