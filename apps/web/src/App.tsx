/**
 * 应用外壳：全局导航（统计 / 设置入口）+ 首页 / 复习 / 设置 / 统计界面切换。
 *
 * RAY-253 导航改版：
 * - 头部不再显示品牌名（反馈 1），只保留统计 / 设置入口（反馈 2）；
 * - 首页三模式按钮（学习 / 复习 / 混合）经 `reviewMode` 传入复习界面（反馈 1）。
 *
 * RAY-261 主题改版：
 * - header 不再常驻主题开关；主题偏好（浅色 / 深色 / 跟随系统）改为
 *   设置页下拉选单，经 `useTheme`（App 级单一数据源）下发到设置页。
 *
 * RAY-315 路由改版：
 * - 用 `useHashRoute`（URL hash）替换 `useState<View>` 管理当前界面，
 *   解决 GitHub Pages 刷新回到首页的问题。刷新时浏览器保留 hash，
 *   无需服务端配置；视图内嵌数据源在初始化时自动创建（避免首页闪烁）。
 *
 * 数据源注入：`reviewProviderFactory` / `settingsProviderFactory` /
 * `statsProviderFactory` / `searchProviderFactory` 是测试接缝——测试传入
 * mock 工厂，生产环境使用默认工厂（浏览器 IndexedDB）。复习/设置/搜词工厂
 * 在进入对应界面时才惰性创建；统计工厂在挂载时创建（首页默认视图的到期
 * 徽标需要），其默认实现自带无 IndexedDB 环境兜底，因此非浏览器环境
 * （如仅渲染首页的测试）不会抛错。
 *
 * RAY-266：header 新增「搜词」入口（真机反馈找不到搜词入口，验收期优先项）。
 *
 * RAY-284：header 新增「生词本」入口（查看/移出已加词条；加词入口在
 * 搜词页结果行与复习卡页工具栏）；生词本工厂与其余工厂一样惰性创建。
 */
import { useCallback, useEffect, useState } from "react";
import type { CustomListId, StudyMode } from "@lexii/core";
import { BarChartIcon, BookmarkIcon, ListIcon, SearchIcon, SettingsIcon } from "./components/icons";
import { CustomListDetailScreen } from "./customLists/CustomListDetailScreen";
import { CustomListsScreen } from "./customLists/CustomListsScreen";
import {
  createDefaultAddToListsDataProvider,
  createDefaultCustomListsDataProvider,
} from "./customLists/data";
import type { AddToListsDataProvider, CustomListsDataProvider } from "./customLists/types";
import { FirstOpenDialog } from "./components/FirstOpenDialog";
import { HomeScreen, type StudyFormat } from "./HomeScreen";
import { useCardFont } from "./hooks/useCardFont";
import { useHashRoute } from "./hooks/useHashRoute";
import { useTheme } from "./hooks/useTheme";
import { markFirstOpenDialogDismissed, shouldShowFirstOpenDialog } from "./lib/firstOpenDialog";
import { NotebookScreen } from "./notebook/NotebookScreen";
import { createDefaultNotebookDataProvider } from "./notebook/data";
import type { NotebookDataProvider } from "./notebook/types";
import { QuizScreen } from "./review/QuizScreen";
import { ReviewScreen } from "./review/ReviewScreen";
import { createDefaultReviewDataProvider } from "./review/data";
import type { ReviewDataProvider } from "./review/types";
import { SearchScreen } from "./search/SearchScreen";
import { createDefaultSearchDataProvider } from "./search/data";
import type { SearchDataProvider } from "./search/types";
import { SettingsScreen } from "./settings/SettingsScreen";
import { parseSettingsAnchorFromHash } from "./settings/anchors";
import { createDefaultSettingsDataProvider } from "./settings/data";
import type { SettingsDataProvider } from "./settings/types";
import { StatsScreen } from "./stats/StatsScreen";
import { createDefaultStatsDataProvider } from "./stats/data";
import { useStatsProvider } from "./stats/useStatsProvider";
import type { StatsDataProvider } from "./stats/types";

export interface AppProps {
  /** 复习数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  reviewProviderFactory?: () => ReviewDataProvider;
  /** 设置页数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  settingsProviderFactory?: () => SettingsDataProvider;
  /** 统计页/首页徽标数据源工厂（测试注入 mock；默认浏览器 IndexedDB，无 IndexedDB 环境兜底） */
  statsProviderFactory?: () => StatsDataProvider;
  /** 搜词页数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  searchProviderFactory?: () => SearchDataProvider;
  /** 生词本页数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  notebookProviderFactory?: () => NotebookDataProvider;
  /** 自定义词单页数据源工厂（RAY-325；测试注入 mock；默认浏览器 IndexedDB） */
  customListsProviderFactory?: () => CustomListsDataProvider;
  /** 「添加到列表」对话框数据源工厂（RAY-325；默认浏览器 IndexedDB） */
  addToListsProviderFactory?: () => AddToListsDataProvider;
}

export function App({
  reviewProviderFactory = createDefaultReviewDataProvider,
  settingsProviderFactory = createDefaultSettingsDataProvider,
  statsProviderFactory = createDefaultStatsDataProvider,
  searchProviderFactory = createDefaultSearchDataProvider,
  notebookProviderFactory = createDefaultNotebookDataProvider,
  customListsProviderFactory = createDefaultCustomListsDataProvider,
  addToListsProviderFactory = createDefaultAddToListsDataProvider,
}: AppProps) {
  const { preference, setPreference } = useTheme();
  // RAY-323: 卡片字体（App 级 useCardFont 单一数据源，复习卡与设置页共享），
  // 挂载即同步到 <html data-card-font>，CSS 变量单点切换字体栈；
  // setFont 下发到设置页，写入与 DOM 同步由本 hook 统一处理。
  const { font: cardFont, setFont: setCardFont } = useCardFont();
  // RAY-315: Hash-based routing so refresh preserves the current view.
  const [view, navigate] = useHashRoute();
  // RAY-364 可持续锚点：搜词无结果 → 设置页「扩展词包」区块，基于稳定 id/data-anchor。
  // 初始值从 hash 解析（刷新/直链可持续），点击跳转时由 openSettings 写入。
  const [settingsAnchor, setSettingsAnchor] = useState<string | null>(() =>
    typeof window !== "undefined" ? parseSettingsAnchorFromHash(window.location.hash) : null,
  );
  // RAY-315: Auto-create providers for the initial hash-restored view to avoid
  // a flash of the home screen when the user navigates directly via URL.
  const [reviewProvider, setReviewProvider] = useState<ReviewDataProvider | null>(() =>
    view === "review" ? reviewProviderFactory() : null,
  );
  const [settingsProvider, setSettingsProvider] = useState<SettingsDataProvider | null>(() =>
    view === "settings" ? settingsProviderFactory() : null,
  );
  const [searchProvider, setSearchProvider] = useState<SearchDataProvider | null>(() =>
    view === "search" ? searchProviderFactory() : null,
  );
  const [notebookProvider, setNotebookProvider] = useState<NotebookDataProvider | null>(() =>
    view === "notebook" ? notebookProviderFactory() : null,
  );
  // RAY-325: 自定义词单数据源惰性创建；详情页 listId 由 URL search 段携带
  const [customListsProvider, setCustomListsProvider] = useState<CustomListsDataProvider | null>(
    () => (view === "custom-lists" || view === "custom-list" ? customListsProviderFactory() : null),
  );
  const [selectedListId, setSelectedListId] = useState<CustomListId | null>(() => {
    if (view !== "custom-list") return null;
    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    return (params.get("id") as CustomListId | null) ?? null;
  });

  // RAY-325 评审 suggestion 1：浏览器前进 / 后退时从 hash 同步详情页 id。
  // selectedListId 只在挂载时读一次 URL——用户从详情页返回列表后按「前进」
  // 回到 #/custom-list?id=X 时，view 是 custom-list 但 selectedListId 为
  // null，会误渲染 HomeScreen。这里与 useHashRoute 的 popstate 同源同步：
  // 每次 popstate 重新解析 hash，非 custom-list 视图时清空 id。
  useEffect(() => {
    function syncListIdFromHash() {
      const raw = window.location.hash.replace(/^#\/?/, "");
      const [pathPart, queryPart] = raw.split("?");
      if (pathPart !== "custom-list") {
        setSelectedListId(null);
        return;
      }
      const params = new URLSearchParams(queryPart ?? "");
      setSelectedListId((params.get("id") as CustomListId | null) ?? null);
    }
    window.addEventListener("popstate", syncListIdFromHash);
    return () => window.removeEventListener("popstate", syncListIdFromHash);
  }, []);

  // RAY-364 可持续锚点：浏览器前进/后退时同步设置页锚点，刷新与直链已在初始化时处理。
  // 同时处理“在非设置页时通过历史记录回到 #/settings?anchor=...”的惰性 provider 创建。
  useEffect(() => {
    function syncAnchorFromHash() {
      const next =
        typeof window !== "undefined" ? parseSettingsAnchorFromHash(window.location.hash) : null;
      setSettingsAnchor(next);
    }
    window.addEventListener("popstate", syncAnchorFromHash);
    return () => window.removeEventListener("popstate", syncAnchorFromHash);
  }, []);

  // RAY-364 + RAY-315：popstate 切换到 settings 但 provider 仍为 null 时补创建（惰性创建的兜底）。
  useEffect(() => {
    if (view === "settings" && !settingsProvider) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 惰性补创建：仅在外部路由同步后补齐 provider，避免闪烁，非级联渲染
      setSettingsProvider(settingsProviderFactory());
    }
  }, [view, settingsProvider, settingsProviderFactory]);
  const statsProvider = useStatsProvider(statsProviderFactory);
  const [reviewMode, setReviewMode] = useState<StudyMode>("review");
  const [studyFormat, setStudyFormat] = useState<StudyFormat>("card");
  // RAY-282 首次打开弹窗：仅无已读标记的首次打开展示（懒初始化只读一次）
  const [showFirstOpenDialog, setShowFirstOpenDialog] = useState(shouldShowFirstOpenDialog);

  const dismissFirstOpenDialog = useCallback(() => {
    markFirstOpenDialogDismissed();
    setShowFirstOpenDialog(false);
  }, []);

  const startStudy = useCallback(
    (mode: StudyMode, format: StudyFormat) => {
      setReviewProvider((current) => current ?? reviewProviderFactory());
      setReviewMode(mode);
      setStudyFormat(format);
      navigate("review");
    },
    [reviewProviderFactory, navigate],
  );

  /**
   * RAY-364 可持续锚点跳转：搜词无结果页「前往设置安装扩展词包」→ 设置页「扩展词包」区块。
   * @param anchor - 稳定的区块标识（如 extension-packages），基于 id / data-anchor 定位，禁止硬编码索引。
   *                 不传时为普通“设置”入口（header 按钮），不触发滚动。
   * 历史语义：`navigate("settings")` 先 `pushState #/settings`（与普通设置入口一致，保证后退回到上一视图），
   * 随后 `replaceState #/settings?anchor=...` 在同一历史条目上附加锚点，避免产生“空锚点 → 带锚点”的中间条目。
   * 刷新/分享时 `parseSettingsAnchorFromHash` 从 hash 恢复锚点，定位仍可持续。
   */
  const openSettings = useCallback(
    (anchor?: string) => {
      setSettingsProvider((current) => current ?? settingsProviderFactory());
      if (anchor) {
        setSettingsAnchor(anchor);
        navigate("settings");
        // 将锚点持久化到 URL（?anchor=），刷新/分享仍可定位；replace 避免多一次历史记录
        history.replaceState(null, "", `#/settings?anchor=${encodeURIComponent(anchor)}`);
      } else {
        setSettingsAnchor(null);
        navigate("settings");
      }
    },
    [settingsProviderFactory, navigate],
  );

  // RAY-367：近义词跳转的初始词（外部指定）与返回路径
  const [searchInitialQuery, setSearchInitialQuery] = useState<string | undefined>(undefined);
  const [searchReturnToReview, setSearchReturnToReview] = useState(false);

  const openSearch = useCallback(() => {
    setSearchProvider((current) => current ?? searchProviderFactory());
    setSearchInitialQuery(undefined);
    setSearchReturnToReview(false);
    navigate("search");
  }, [searchProviderFactory, navigate]);

  // RAY-367：从复习卡/搜词结果的近义词点击跳转到搜词页（带返回路径）
  const openSearchWithQuery = useCallback(
    (term: string) => {
      setSearchProvider((current) => current ?? searchProviderFactory());
      setSearchInitialQuery(term);
      // 若当前在复习页，返回应回到复习；否则按普通搜词处理（返回首页，内部栈优先）
      setSearchReturnToReview(view === "review");
      navigate("search");
    },
    [searchProviderFactory, navigate, view],
  );

  const handleSearchExit = useCallback(() => {
    if (searchReturnToReview) {
      setSearchReturnToReview(false);
      setSearchInitialQuery(undefined); // N4：同步清理，避免重进搜词时闪现旧词
      navigate("review");
      return;
    }
    setSearchInitialQuery(undefined);
    navigate("home");
  }, [searchReturnToReview, navigate]);

  const openNotebook = useCallback(() => {
    setNotebookProvider((current) => current ?? notebookProviderFactory());
    navigate("notebook");
  }, [notebookProviderFactory, navigate]);

  // RAY-325: 自定义词单列表管理
  const openCustomLists = useCallback(() => {
    setCustomListsProvider((current) => current ?? customListsProviderFactory());
    setSelectedListId(null);
    navigate("custom-lists");
  }, [customListsProviderFactory, navigate]);

  // RAY-325: 进入列表详情（携带 id）
  const openCustomList = useCallback(
    (id: CustomListId) => {
      setCustomListsProvider((current) => current ?? customListsProviderFactory());
      setSelectedListId(id);
      navigate("custom-list");
      // 详情页携带列表 id：用 history.replaceState 单独写入 URL（不破坏 hash view 解析）
      const url = `#/custom-list?id=${encodeURIComponent(id)}`;
      history.replaceState(null, "", url);
    },
    [customListsProviderFactory, navigate],
  );

  const openStats = useCallback(() => {
    navigate("stats");
  }, [navigate]);

  const goHome = useCallback(() => {
    navigate("home");
  }, [navigate]);

  // RAY-325: 复习 / 搜词页所需的「添加到列表」对话框 provider 惰性获取
  const getAddToListsProvider = useCallback(
    (): AddToListsDataProvider => addToListsProviderFactory(),
    [addToListsProviderFactory],
  );

  return (
    <div className="min-h-screen bg-bg text-text transition-colors">
      {/* RAY-373/374 header 契约：统一 h-10 高度（按钮 inline-flex h-10 w-10 shrink-0 leading-none，图标 h-5 w-5 → 20px，
           opsz 动态 24，Material Symbols），容器 flex-nowrap + shrink-0 保证 390px 单行不换行（OFFSET 86px）且 768px 不回归，
           focus-visible 完整保留；RAY-374 全量图标化 5 按钮（搜词/自定义词单/生词本/统计/设置，aria-label 可达名，图标 aria-hidden 装饰），
           词单仅单一图标无 h-5/h-4 双图标叠加，移除 sm 文字/图标分叉口径，桌面/移动一致。 */}
      <header className="mx-auto flex w-full max-w-3xl flex-nowrap items-center justify-end gap-1.5 px-4 py-6 sm:gap-2 sm:px-6">
        <button
          type="button"
          onClick={openSearch}
          aria-label="搜词"
          aria-pressed={view === "search"}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text leading-none transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <SearchIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={openNotebook}
          aria-pressed={view === "notebook"}
          aria-label="生词本"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text leading-none transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <BookmarkIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={openCustomLists}
          aria-pressed={view === "custom-lists" || view === "custom-list"}
          aria-label="自定义词单"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text leading-none transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <ListIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={openStats}
          aria-label="统计"
          aria-pressed={view === "stats"}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text leading-none transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <BarChartIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => openSettings()}
          aria-label="设置"
          aria-pressed={view === "settings"}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text leading-none transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </header>

      {view === "review" && reviewProvider ? (
        studyFormat === "quiz" ? (
          <QuizScreen provider={reviewProvider} mode={reviewMode} onExit={goHome} />
        ) : (
          <ReviewScreen
            provider={reviewProvider}
            mode={reviewMode}
            onExit={goHome}
            getAddToListsProvider={getAddToListsProvider}
            onSynonymSelect={openSearchWithQuery}
          />
        )
      ) : view === "search" && searchProvider ? (
        <SearchScreen
          provider={searchProvider}
          onExit={handleSearchExit}
          onNavigateToSettings={openSettings}
          getAddToListsProvider={getAddToListsProvider}
          initialQuery={searchInitialQuery}
        />
      ) : view === "notebook" && notebookProvider ? (
        <NotebookScreen provider={notebookProvider} onExit={goHome} />
      ) : view === "custom-lists" && customListsProvider ? (
        <CustomListsScreen
          provider={customListsProvider}
          onExit={goHome}
          onOpenList={openCustomList}
        />
      ) : view === "custom-list" && customListsProvider && selectedListId ? (
        <CustomListDetailScreen
          provider={customListsProvider}
          onExit={openCustomLists}
          listId={selectedListId}
        />
      ) : view === "settings" && settingsProvider ? (
        <SettingsScreen
          provider={settingsProvider}
          onExit={goHome}
          themePreference={preference}
          onThemePreferenceChange={setPreference}
          cardFont={cardFont}
          onCardFontChange={setCardFont}
          initialAnchor={settingsAnchor}
        />
      ) : view === "stats" && statsProvider ? (
        <StatsScreen provider={statsProvider} onExit={goHome} />
      ) : (
        <HomeScreen onStart={startStudy} statsProvider={statsProvider} />
      )}

      {showFirstOpenDialog && <FirstOpenDialog onDismiss={dismissFirstOpenDialog} />}
    </div>
  );
}
