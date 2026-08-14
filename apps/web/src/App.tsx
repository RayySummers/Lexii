/**
 * 应用外壳：全局导航（统计 / 设置入口 + 主题图标切换）+ 首页 / 复习 / 设置 / 统计界面切换。
 *
 * RAY-253 导航改版：
 * - 头部不再显示品牌名（反馈 1），只保留统计 / 设置入口与主题图标（反馈 2）；
 * - 首页三模式按钮（学习 / 复习 / 混合）经 `reviewMode` 传入复习界面（反馈 1）。
 *
 * 数据源注入：`reviewProviderFactory` / `settingsProviderFactory` /
 * `statsProviderFactory` 是测试接缝——测试传入 mock 工厂，生产环境使用
 * 默认工厂（浏览器 IndexedDB）。复习/设置工厂在进入对应界面时才惰性创建；
 * 统计工厂在挂载时创建（首页默认视图的到期徽标需要），其默认实现自带
 * 无 IndexedDB 环境兜底，因此非浏览器环境（如仅渲染首页的测试）不会抛错。
 */
import { useCallback, useState } from "react";
import type { StudyMode } from "@lexilexi/core";
import { MoonIcon, SunIcon } from "./components/icons";
import { HomeScreen } from "./HomeScreen";
import { useTheme } from "./hooks/useTheme";
import { ReviewScreen } from "./review/ReviewScreen";
import { createDefaultReviewDataProvider } from "./review/data";
import type { ReviewDataProvider } from "./review/types";
import { SettingsScreen } from "./settings/SettingsScreen";
import { createDefaultSettingsDataProvider } from "./settings/data";
import type { SettingsDataProvider } from "./settings/types";
import { StatsScreen } from "./stats/StatsScreen";
import { createDefaultStatsDataProvider } from "./stats/data";
import { useStatsProvider } from "./stats/useStatsProvider";
import type { StatsDataProvider } from "./stats/types";

type View = "home" | "review" | "settings" | "stats";

export interface AppProps {
  /** 复习数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  reviewProviderFactory?: () => ReviewDataProvider;
  /** 设置页数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  settingsProviderFactory?: () => SettingsDataProvider;
  /** 统计页/首页徽标数据源工厂（测试注入 mock；默认浏览器 IndexedDB，无 IndexedDB 环境兜底） */
  statsProviderFactory?: () => StatsDataProvider;
}

export function App({
  reviewProviderFactory = createDefaultReviewDataProvider,
  settingsProviderFactory = createDefaultSettingsDataProvider,
  statsProviderFactory = createDefaultStatsDataProvider,
}: AppProps) {
  const { theme, toggleTheme } = useTheme();
  const [reviewProvider, setReviewProvider] = useState<ReviewDataProvider | null>(null);
  const [settingsProvider, setSettingsProvider] = useState<SettingsDataProvider | null>(null);
  const statsProvider = useStatsProvider(statsProviderFactory);
  const [view, setView] = useState<View>("home");
  const [reviewMode, setReviewMode] = useState<StudyMode>("review");

  const startStudy = useCallback(
    (mode: StudyMode) => {
      setReviewProvider((current) => current ?? reviewProviderFactory());
      setReviewMode(mode);
      setView("review");
    },
    [reviewProviderFactory],
  );

  const openSettings = useCallback(() => {
    setSettingsProvider((current) => current ?? settingsProviderFactory());
    setView("settings");
  }, [settingsProviderFactory]);

  const openStats = useCallback(() => {
    setView("stats");
  }, []);

  const goHome = useCallback(() => {
    setView("home");
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text transition-colors">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-6 py-6">
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
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          aria-pressed={theme === "dark"}
          className="rounded-full border border-border bg-surface p-2.5 text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {theme === "dark" ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
        </button>
      </header>

      {view === "review" && reviewProvider ? (
        <ReviewScreen provider={reviewProvider} mode={reviewMode} onExit={goHome} />
      ) : view === "settings" && settingsProvider ? (
        <SettingsScreen provider={settingsProvider} onExit={goHome} />
      ) : view === "stats" && statsProvider ? (
        <StatsScreen provider={statsProvider} onExit={goHome} />
      ) : (
        <HomeScreen onStart={startStudy} statsProvider={statsProvider} />
      )}
    </div>
  );
}
