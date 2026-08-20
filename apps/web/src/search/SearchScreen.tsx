/**
 * 搜词页（RAY-266 搜词，验收期优先项；RAY-292 未收录提示 + 搜词历史）。
 *
 * - 输入即检索：词条拼写 + 释义（中文关键词），全本地、离线、不新增数据源；
 * - 检索逻辑在 @lexii/core（searchLexiiSenses），本页只做输入、
 *   防抖（200ms）与结果展示；命中顺序由 core 决定（前缀 > 包含 > 释义）；
 * - 状态机：词库为空 → 无查询提示（有历史时先展示搜索历史）→ 检索中 →
 *   无命中（明确提示「库内无此词，可导入自建词库」）→ 结果列表（含
 *   结果计数 live region）；错误态单独展示，不影响输入框继续使用；
 *   词库为空但仍有历史时（RAY-292 评审 sug 1）：空库提示与搜索历史
 *   同时展示，历史照常可点选/单条删除；
 * - RAY-292 搜词历史：只存本地（localStorage，见 lib/searchHistory），
 *   仅记录有命中的检索（RAY-292 评审 sug 2：拼写错误 / 未收录等零命中
 *   查询不进历史，不积攒噪音词）；点击历史词条回填输入并重新检索，
 *   每条带叉叉可单条删除；历史上传/埋点一律不涉及（隐私红线）；
 * - 过期响应经请求序号丢弃（latest-request-wins）：查询变更（含清空）
 *   与组件卸载都在 effect 清理阶段递增序号，使在途响应到达后因序号
 *   不匹配被丢弃、不回写过期结果；清空输入同步复位检索区状态，二者
 *   配合保证清空后不残留上一轮结果（Oscar 评审 suggestion 1 修复口径）；
 * - 错误态：主提示为固定友好文案，原始错误信息折叠在「错误详情」中
 *   （与统计页同一模式），不直接透出内部实现细节；
 * - RAY-284 生词本加词入口：每条结果行带「加词」按钮（已在生词本的行
 *   显示「已在生词本」标记），幂等加词、反馈加词结果；生词本标记在
 *   进入页面时读一次（本页移出生词本后回到本页时以重新进入为准）。
 *   RAY-325：每条结果行额外提供「添加到列表」按钮，打开对话框把词
 *   加入用户自定义列表（多对一；列表不参与学习调度）。
 * - RAY-338 A1：结果行词条本体（sense.term）应用设置里的卡片字体
 *   （CSS 变量 --lex-card-font / --lex-card-font-weight，与复习卡同口径）。
 * - 全部颜色走 design tokens（浅色/深色自动生效），不硬编码颜色。
 *
 * 文案：Vega 产出（RAY-326）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Sense, SenseId } from "@lexii/core";
import { ScreenHeader } from "../components/ScreenHeader";
import { CheckIcon, CloseIcon, ListIcon, PlusIcon, SearchIcon } from "../components/icons";
import { AddToListsDialog } from "../customLists/AddToListsDialog";
import { NOOP_ADD_TO_LISTS_PROVIDER } from "../customLists/data";
import type { AddToListsDataProvider } from "../customLists/types";
import {
  loadSearchHistory,
  recordSearchHistory,
  removeSearchHistory,
  type SearchHistoryStorage,
} from "../lib/searchHistory";
import { getSynonymGroups, isSelfSynonym } from "../lib/synonymGroups";
import type { SearchDataProvider, SearchResult } from "./types";

/** 输入防抖间隔（毫秒） */
const DEBOUNCE_MS = 200;

export interface SearchScreenProps {
  provider: SearchDataProvider;
  /** 返回首页 */
  onExit(): void;
  /** RAY-319：跳转设置页安装扩展词包 */
  onNavigateToSettings?(): void;
  /**
   * 搜词历史存储（测试注入内存 storage；默认 window.localStorage）。
   * 仅本地读写，绝不上传。
   */
  historyStorage?: SearchHistoryStorage;
  /**
   * 「添加到列表」对话框数据源工厂（RAY-325；按需惰性创建）。
   * 旧测试 / 旧调用方未传时退回 no-op 工厂，避免破坏既有测试。
   */
  getAddToListsProvider?: () => AddToListsDataProvider;
  /**
   * RAY-367：外部指定初始检索词（近义词点击跳转）。
   * 有值时进入页面即填入该词并检索；与受控输入共存，外部变更会同步到输入框。
   */
  initialQuery?: string;
}

/** 数据源错误 → 原始错误信息（仅供「错误详情」折叠区展示） */
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

export function SearchScreen({
  provider,
  onExit,
  onNavigateToSettings,
  historyStorage,
  getAddToListsProvider = () => NOOP_ADD_TO_LISTS_PROVIDER,
  initialQuery,
}: SearchScreenProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyLibrary, setEmptyLibrary] = useState(false);
  const [history, setHistory] = useState<string[]>(() =>
    loadSearchHistory(resolveHistoryStorage(historyStorage)),
  );
  // RAY-367：近义词跳转的返回栈（记录上一跳的 query，供返回按钮逐级回退；上限 20 避免无限增长）
  const [queryStack, setQueryStack] = useState<string[]>(() => []);
  const prevInitialRef = useRef<string | undefined>(initialQuery);

  // 外部 initialQuery 变更（近义词从复习卡或 App 导航）同步到输入框并入栈（循环跳转的进入口）
  useEffect(() => {
    if (initialQuery === undefined) {
      prevInitialRef.current = undefined;
      return;
    }
    if (prevInitialRef.current === initialQuery) {
      return;
    }
    prevInitialRef.current = initialQuery;
    const normalized = initialQuery.trim();
    // 首次进入（prev 为 undefined）不入栈；后续外部跳转把当前 query 压栈
    setQuery((current) => {
      const curTrim = current.trim();
      if (curTrim.length > 0 && curTrim.toLowerCase() !== normalized.toLowerCase()) {
        setQueryStack((prev) => [...prev, curTrim].slice(-20));
      }
      return initialQuery;
    });
    setError(null);
    setResults(null);
    setSearching(false);
  }, [initialQuery]);
  // 生词本覆盖的义项 id 集合（RAY-284：结果行「已在生词本」标记；进入页面读一次）
  const [notebookSenseIds, setNotebookSenseIds] = useState<ReadonlySet<string> | null>(null);
  // RAY-325: 「添加到列表」对话框（null = 关闭）。sense 与 provider 成对
  // 创建 / 清空：provider 只在打开时创建一次并存 state，避免 JSX 内联工厂
  // 每次渲染新建 provider → 对话框 refresh 身份变化 → 勾选状态被重置
  // （Oscar RAY-325 评审 blocking 2）。
  const [addToListsDialog, setAddToListsDialog] = useState<{
    sense: Sense;
    provider: AddToListsDataProvider;
  } | null>(null);
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

  // 生词本义项集合（RAY-284：结果行标记；失败静默按空集合处理，
  // 加词路径自有错误展示）
  useEffect(() => {
    let cancelled = false;
    void provider
      .getNotebookSenseIds()
      .then((ids) => {
        if (!cancelled) {
          setNotebookSenseIds(new Set(ids));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotebookSenseIds(new Set());
        }
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
  // 只有命中的检索才记入本地历史（RAY-292 评审 sug 2）：零命中
  // （拼写错误 / 未收录）查询不进历史，输入中途的字符更不记录。
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
            if (hits.length > 0) {
              setHistory(recordSearchHistory(resolveHistoryStorage(historyStorage), trimmed));
            }
          }
        })
        .catch((err: unknown) => {
          if (requestSeqRef.current === seq) {
            setError(toErrorMessage(err));
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      // 清理阶段递增序号，使在途响应失效（Oscar 评审 suggestion 1）：
      // 查询变更（含清空输入）与组件卸载都会走这里——在途响应返回后
      // 因序号不匹配被丢弃，不回写过期结果/错误。
      requestSeqRef.current += 1;
    };
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

  // 把义项加入 / 移出生词本（RAY-284 + RAY-302）：可撤销切换
  const handleToggleNotebook = useCallback(
    async (senseId: SenseId) => {
      const inNotebook = notebookSenseIds?.has(senseId) ?? false;
      try {
        if (inNotebook) {
          await provider.removeFromNotebookBySenseId(senseId);
          setNotebookSenseIds((previous) => {
            if (!previous) return previous;
            const next = new Set(previous);
            next.delete(senseId);
            return next;
          });
        } else {
          await provider.addToNotebook(senseId);
          setNotebookSenseIds((previous) => new Set([...(previous ?? []), senseId]));
        }
      } catch (err) {
        // 静默：按钮状态不变，用户可重试
        console.warn("生词本操作失败", err);
      }
    },
    [provider, notebookSenseIds],
  );

  // RAY-325: 打开「添加到列表」对话框（provider 打开时创建一次）
  const handleOpenAddToLists = useCallback(
    (sense: Sense) => {
      setAddToListsDialog({ sense, provider: getAddToListsProvider() });
    },
    [getAddToListsProvider],
  );

  const handleCloseAddToLists = useCallback(() => {
    setAddToListsDialog(null);
  }, []);

  // RAY-367：近义词点击 → 把当前 query 压栈后跳到该近义词（大小写去重，自身循环忽略）
  const handleSynonymSelect = useCallback(
    (term: string) => {
      const normalized = term.trim();
      if (normalized.length === 0) return;
      const currentTrim = query.trim();
      if (normalized.toLowerCase() === currentTrim.toLowerCase()) {
        return;
      }
      // 避免把重复的链路无限推高：若近义词已在栈内出现，先移除旧位置再压栈，避免 A→B→A 时栈里重复 A，且限制栈深
      setQueryStack((prev) => {
        const filtered = prev.filter(
          (item) => item.toLowerCase() !== normalized.toLowerCase(),
        );
        const next =
          currentTrim.length > 0 ? [...filtered, currentTrim] : filtered;
        return next.slice(-20);
      });
      setQuery(normalized);
      setError(null);
      setResults(null);
      setSearching(false);
      // 输入框聚焦，保持可继续编辑
      inputRef.current?.focus();
    },
    [query],
  );

  // RAY-367：返回按钮优先回退到上一跳的近义词，无栈才退出到首页
  const handleBack = useCallback(() => {
    if (queryStack.length > 0) {
      const previous = queryStack[queryStack.length - 1] ?? "";
      setQueryStack((prev) => prev.slice(0, -1));
      setQuery(previous);
      setError(null);
      setResults(null);
      setSearching(false);
      inputRef.current?.focus();
      return;
    }
    onExit();
  }, [queryStack, onExit]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="搜词" onBack={handleBack} />

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

      {queryStack.length > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-2 text-xs text-text-muted">
          <span className="truncate">
            来自「{queryStack[queryStack.length - 1]}」的近义词跳转
          </span>
          <button
            type="button"
            onClick={handleBack}
            className="ml-auto shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            返回
          </button>
        </div>
      ) : null}

      <SearchContent
        query={query.trim()}
        results={results}
        searching={searching}
        error={error}
        emptyLibrary={emptyLibrary}
        history={history}
        notebookSenseIds={notebookSenseIds}
        onSelectHistory={handleHistorySelect}
        onRemoveHistory={handleHistoryRemove}
        onToggleNotebook={handleToggleNotebook}
        onNavigateToSettings={onNavigateToSettings}
        onOpenAddToLists={handleOpenAddToLists}
        onSynonymSelect={handleSynonymSelect}
        currentQuery={query.trim()}
      />
      {addToListsDialog ? (
        <AddToListsDialog
          provider={addToListsDialog.provider}
          sense={addToListsDialog.sense}
          onClose={handleCloseAddToLists}
        />
      ) : null}
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
  /** 生词本覆盖的义项 id 集合（null = 尚未加载完成；RAY-284） */
  notebookSenseIds: ReadonlySet<string> | null;
  onSelectHistory(term: string): void;
  onRemoveHistory(term: string): void;
  onToggleNotebook(senseId: SenseId): void;
  /** RAY-319：跳转设置页安装扩展词包 */
  onNavigateToSettings?(): void;
  /** RAY-325：打开「添加到列表」对话框 */
  onOpenAddToLists(sense: Sense): void;
  /** RAY-367：近义词点击跳转搜词页 */
  onSynonymSelect?(term: string): void;
  /** 当前完整 query（用于循环检测，大小写去重） */
  currentQuery?: string;
}

/** 按状态渲染检索区内容（独立于容器，便于逐状态阅读与测试） */
function SearchContent({
  query,
  results,
  searching,
  error,
  emptyLibrary,
  history,
  notebookSenseIds,
  onSelectHistory,
  onRemoveHistory,
  onToggleNotebook,
  onNavigateToSettings,
  onOpenAddToLists,
  onSynonymSelect,
  currentQuery,
}: SearchContentProps) {
  if (error) {
    // 友好文案 + 原始信息折叠（与统计页同一模式，Oscar 评审 nit 1）：
    // 主提示固定、不暴露内部实现细节；原始错误信息收进「错误详情」折叠区
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface p-6">
        <p role="alert" className="text-sm">
          本地检索暂时不可用，请稍后重试。
        </p>
        <details className="text-xs text-text-muted">
          <summary>错误详情</summary>
          <p className="mt-1 whitespace-pre-wrap">{error}</p>
        </details>
      </div>
    );
  }
  if (emptyLibrary) {
    // RAY-292 评审 sug 1：词库为空但仍有历史时，空库提示与历史同时展示，
    // 历史照常可查看/点选/单条删除（仅输入为空时展示，保持既有交互节奏）
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">词库还是空的</h2>
          <p className="max-w-sm text-sm text-text-muted">
            还没有任何词可搜。可以到设置页导入 CSV 词表，或到词书库安装一本词书。
          </p>
        </div>
        {query.length === 0 && history.length > 0 ? (
          <SearchHistoryList
            history={history}
            onSelect={onSelectHistory}
            onRemove={onRemoveHistory}
          />
        ) : null}
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
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="text-xl font-semibold">库内无此词</h2>
        <p className="max-w-sm text-sm text-text-muted">
          词库里没有与「{query}」匹配的词条，可以导入自建词库再搜——到设置页导入 CSV
          词表，或到词书库安装更多词书，之后再试一次。
        </p>
        {onNavigateToSettings ? (
          <button
            type="button"
            onClick={onNavigateToSettings}
            className="mt-1 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            前往设置安装扩展词包
          </button>
        ) : null}
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
          <SearchResultRow
            key={result.sense.id}
            result={result}
            inNotebook={notebookSenseIds?.has(result.sense.id) ?? false}
            onToggleNotebook={onToggleNotebook}
            onOpenAddToLists={onOpenAddToLists}
            onSynonymSelect={onSynonymSelect}
            currentQuery={currentQuery}
          />
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
              title={term}
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

/** 单条结果：词条 + 词性/音标 + 释义 + 近义词（分组标注·可点击跳转）+ 加词入口 */
function SearchResultRow({
  result,
  inNotebook,
  onToggleNotebook,
  onOpenAddToLists,
  onSynonymSelect,
  currentQuery,
}: {
  result: SearchResult;
  /** 该义项是否已在生词本（标记集合加载完成前按 false 处理） */
  inNotebook: boolean;
  onToggleNotebook(senseId: SenseId): void;
  /** RAY-325：打开「添加到列表」对话框 */
  onOpenAddToLists(sense: Sense): void;
  /** RAY-367：近义词点击跳转（按义项分组，循环由外层栈处理） */
  onSynonymSelect?(term: string): void;
  currentQuery?: string;
}) {
  const { sense } = result;
  const synonymGroups = getSynonymGroups(sense);
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="text-lg"
          style={{
            fontFamily: "var(--lex-card-font)",
            fontWeight: "var(--lex-card-font-weight)",
          }}
        >
          {sense.term}
        </span>
        {sense.pos ? <span className="text-xs text-text-muted">{sense.pos}</span> : null}
        {sense.ipa ? <span className="text-xs text-text-muted">/{sense.ipa}/</span> : null}
        {result.source === "dictionary" ? (
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent">
            扩展词典
          </span>
        ) : null}
      </span>
      <p className="text-sm leading-relaxed text-text-muted">{sense.definitions.join("；")}</p>
      {synonymGroups.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-raised/40 px-3 py-2">
          <span className="text-xs font-medium text-text-muted">近义词</span>
          <div className="flex flex-col gap-2">
            {synonymGroups.map((group) => (
              <div key={group.definitionIndex} className="flex flex-col gap-1">
                <span className="flex items-center gap-1 text-xs text-text-muted">
                  {group.pos ? (
                    <span className="rounded-full border border-border bg-surface px-1.5 py-px text-xs">
                      {group.pos}
                    </span>
                  ) : null}
                  <span className="truncate">
                    释义 {group.definitionIndex + 1}
                    {group.definition ? ` · ${truncateForSearch(group.definition)}` : ""}
                  </span>
                </span>
                <ul className="flex flex-wrap gap-1.5">
                  {group.synonyms.map((word, index) => {
                    const isSelf = isSelfSynonym(word, sense.term);
                    const isLoop =
                      Boolean(currentQuery) &&
                      word.trim().toLowerCase() === currentQuery?.trim().toLowerCase();
                    const clickable = Boolean(onSynonymSelect) && !isSelf && !isLoop;
                    return (
                      <li key={`${index}:${word}`}>
                        {clickable ? (
                          <button
                            type="button"
                            onClick={() => onSynonymSelect?.(word)}
                            aria-label={`搜索近义词 ${word}`}
                            title={`搜索「${word}」`}
                            className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                          >
                            {word}
                          </button>
                        ) : (
                          <span
                            title={
                              isSelf
                                ? `${word}（当前词）`
                                : isLoop
                                  ? `${word}（已在当前检索中）`
                                  : word
                            }
                            className={`rounded-full border bg-surface px-2.5 py-0.5 text-xs ${
                              isSelf || isLoop
                                ? "cursor-not-allowed border-border text-text-muted opacity-60"
                                : "border-border"
                            }`}
                            aria-label={
                              isSelf || isLoop ? `${word}（当前词，无需跳转）` : undefined
                            }
                          >
                            {word}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenAddToLists(sense)}
          aria-label={`把「${sense.term}」添加到词单`}
          className="flex items-center gap-1 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <ListIcon className="h-3.5 w-3.5" />
          添加到词单
        </button>
        <button
          type="button"
          onClick={() => onToggleNotebook(sense.id)}
          aria-label={
            inNotebook ? `把「${sense.term}」移出生词本` : `把「${sense.term}」加入生词本`
          }
          className={`flex items-center gap-1 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
            inNotebook
              ? "border-success/40 bg-success/10 text-success hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
              : "border-border bg-surface text-text-muted hover:border-primary hover:text-primary"
          }`}
        >
          {inNotebook ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <PlusIcon className="h-3.5 w-3.5" />
          )}
          {inNotebook ? "已加" : "加词"}
        </button>
      </div>
    </li>
  );
}

function truncateForSearch(text: string, max = 16): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
