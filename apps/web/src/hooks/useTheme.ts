/**
 * 主题管理：浅色 / 深色
 *
 * - 首帧渲染前的 data-theme 由 index.html 内联脚本设置，避免深色模式首帧闪烁（FOUC）
 * - 初始值：DOM 已应用 data-theme 时直接采用（与内联脚本保持一致，防止二次闪烁），
 *   否则按 localStorage → 系统偏好 → 默认浅色解析（resolveTheme）
 * - 切换时写入 <html data-theme="..."> 并持久化到 localStorage
 */
import { useCallback, useEffect, useState } from "react";
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from "../theme/resolve";

export { THEME_STORAGE_KEY } from "../theme/resolve";
export type { Theme } from "../theme/resolve";

function readStoredTheme(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // 隐私模式等场景下 localStorage 不可用，视为无持久化值
    return null;
  }
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "light";
  }
  // 内联脚本已在首帧渲染前应用 data-theme，优先采用以保证 React 状态与 DOM 一致
  const applied = document.documentElement.dataset.theme;
  if (applied === "light" || applied === "dark") {
    return applied;
  }
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return resolveTheme(readStoredTheme(), systemPrefersDark);
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // 隐私模式 / storage 禁用时忽略持久化失败，主题切换本身不受影响
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }, []);

  return { theme, toggleTheme };
}
