/**
 * 应用外壳：品牌头部 + 主题切换 + 首页 / 复习 / 设置界面切换。
 *
 * 数据源注入：`reviewProviderFactory` / `settingsProviderFactory` 是测试接缝——
 * 测试传入 mock 工厂，生产环境使用默认工厂（浏览器 IndexedDB）。工厂在进入
 * 对应界面时才惰性创建，因此非浏览器环境（如仅渲染首页的测试）不会触碰 IndexedDB。
 */
import { useCallback, useState } from "react";
import { APP_NAME, APP_NAME_ZH } from "@lexilexi/core";
import { HomeScreen } from "./HomeScreen";
import { useTheme } from "./hooks/useTheme";
import { ReviewScreen } from "./review/ReviewScreen";
import { createDefaultReviewDataProvider } from "./review/data";
import type { ReviewDataProvider } from "./review/types";
import { SettingsScreen } from "./settings/SettingsScreen";
import { createDefaultSettingsDataProvider } from "./settings/data";
import type { SettingsDataProvider } from "./settings/types";

type View = "home" | "review" | "settings";

export interface AppProps {
  /** 复习数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  reviewProviderFactory?: () => ReviewDataProvider;
  /** 设置页数据源工厂（测试注入 mock；默认浏览器 IndexedDB） */
  settingsProviderFactory?: () => SettingsDataProvider;
}

export function App({
  reviewProviderFactory = createDefaultReviewDataProvider,
  settingsProviderFactory = createDefaultSettingsDataProvider,
}: AppProps) {
  const { theme, toggleTheme } = useTheme();
  const [reviewProvider, setReviewProvider] = useState<ReviewDataProvider | null>(null);
  const [settingsProvider, setSettingsProvider] = useState<SettingsDataProvider | null>(null);
  const [view, setView] = useState<View>("home");

  const startReview = useCallback(() => {
    setReviewProvider((current) => current ?? reviewProviderFactory());
    setView("review");
  }, [reviewProviderFactory]);

  const openSettings = useCallback(() => {
    setSettingsProvider((current) => current ?? settingsProviderFactory());
    setView("settings");
  }, [settingsProviderFactory]);

  const goHome = useCallback(() => {
    setView("home");
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text transition-colors">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight">{APP_NAME_ZH}</span>
          <span className="text-sm text-text-muted">{APP_NAME}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openSettings}
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            设置
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === "dark"}
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          </button>
        </div>
      </header>

      {view === "review" && reviewProvider ? (
        <ReviewScreen provider={reviewProvider} onExit={goHome} />
      ) : view === "settings" && settingsProvider ? (
        <SettingsScreen provider={settingsProvider} onExit={goHome} />
      ) : (
        <HomeScreen onStartReview={startReview} />
      )}
    </div>
  );
}
