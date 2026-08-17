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
import { useCallback, useState } from "react";
import type { StudyMode } from "@lexii/core";
import { BookmarkIcon } from "./components/icons";
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
}

export function App({
  reviewProviderFactory = createDefaultReviewDataProvider,
  settingsProviderFactory = createDefaultSettingsDataProvider,
  statsProviderFactory = createDefaultStatsDataProvider,
  searchProviderFactory = createDefaultSearchDataProvider,
  notebookProviderFactory = createDefaultNotebookDataProvider,
}: AppProps) {
  const { preference, setPreference } = useTheme();
  // RAY-323: 卡片字体（App 级 useCardFont 单一数据源，复习卡与设置页共享），
  // 挂载即同步到 <html data-card-font>，CSS 变量单点切换字体栈；
  // setFont 下发到设置页，写入与 DOM 同步由本 hook 统一处理。
  const { font: cardFont, setFont: setCardFont } = useCardFont();
  // RAY-315: Hash-based routing so refresh preserves the current view.
  const [view, navigate] = useHashRoute();
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

  const openSettings = useCallback(() => {
    setSettingsProvider((current) => current ?? settingsProviderFactory());
    navigate("settings");
  }, [settingsProviderFactory, navigate]);

  const openSearch = useCallback(() => {
    setSearchProvider((current) => current ?? searchProviderFactory());
    navigate("search");
  }, [searchProviderFactory, navigate]);

  const openNotebook = useCallback(() => {
    setNotebookProvider((current) => current ?? notebookProviderFactory());
    navigate("notebook");
  }, [notebookProviderFactory, navigate]);

  const openStats = useCallback(() => {
    navigate("stats");
  }, [navigate]);

  const goHome = useCallback(() => {
    navigate("home");
  }, [navigate]);

  return (
    <div className="min-h-screen bg-bg text-text transition-colors">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-6 py-6">
        <button
          type="button"
          onClick={openSearch}
          aria-pressed={view === "search"}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          搜词
        </button>
        <button
          type="button"
          onClick={openNotebook}
          aria-pressed={view === "notebook"}
          aria-label="生词本"
          className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <BookmarkIcon className="h-4 w-4" />
          生词本
        </button>
        <button
          type="button"
          onClick={openStats}
          aria-pressed={view === "stats"}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          统计
        </button>
        <button
          type="button"
          onClick={openSettings}
          aria-pressed={view === "settings"}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          设置
        </button>
      </header>

      {view === "review" && reviewProvider ? (
        studyFormat === "quiz" ? (
          <QuizScreen provider={reviewProvider} mode={reviewMode} onExit={goHome} />
        ) : (
          <ReviewScreen provider={reviewProvider} mode={reviewMode} onExit={goHome} />
        )
      ) : view === "search" && searchProvider ? (
        <SearchScreen provider={searchProvider} onExit={goHome} />
      ) : view === "notebook" && notebookProvider ? (
        <NotebookScreen provider={notebookProvider} onExit={goHome} />
      ) : view === "settings" && settingsProvider ? (
        <SettingsScreen
          provider={settingsProvider}
          onExit={goHome}
          themePreference={preference}
          onThemePreferenceChange={setPreference}
          cardFont={cardFont}
          onCardFontChange={setCardFont}
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
