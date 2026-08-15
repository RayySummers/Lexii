/**
 * 主题管理：浅色 / 深色 / 跟随系统（RAY-261 三档）
 *
 * - 偏好（ThemePreference）持久化到 localStorage；实际主题（Theme）由偏好 +
 *   系统 prefers-color-scheme 解析得出
 * - 「跟随系统」档位下监听设备主题变化，实际主题自动切换，无需手动操作
 * - 跨标签页同步（评审 suggestion 1）：监听 window storage 事件，其他标签页
 *   变更主题偏好时本页自动跟随；存储被清除时回落默认「跟随系统」
 * - 首帧渲染前的 data-theme 由 index.html 内联脚本设置，避免深色模式首帧闪烁（FOUC）
 * - 初始实际主题：DOM 已应用 data-theme 时直接采用（与内联脚本保持一致，防止二次闪烁），
 *   否则按 localStorage → 系统偏好 → 默认浅色解析（resolveTheme）
 * - 实际主题变化时写入 <html data-theme="..."> 并持久化偏好到 localStorage；
 *   同时同步 <meta name="theme-color">（浏览器外壳色，值取自 --lex-bg token）
 */
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from "../theme/resolve";
import { syncThemeColorMeta } from "../theme/themeColor";

export { THEME_STORAGE_KEY } from "../theme/resolve";
export type { Theme, ThemePreference } from "../theme/resolve";

export interface UseThemeResult {
  /** 实际应用的主题（浅色/深色；跟随系统档位下等于系统当前偏好） */
  theme: Theme;
  /** 用户选择的主题偏好（浅色 / 深色 / 跟随系统） */
  preference: ThemePreference;
  /** 设置主题偏好（会立即解析并应用实际主题，同时持久化偏好） */
  setPreference(preference: ThemePreference): void;
}

function readStoredPreference(): string | null {
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

function getInitialPreference(): ThemePreference {
  const stored = readStoredPreference();
  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
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
  return resolveTheme(readStoredPreference(), systemPrefersDark);
}

export function useTheme(): UseThemeResult {
  const [preference, setPreferenceState] = useState<ThemePreference>(getInitialPreference);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // 偏好持久化：跟随系统档位下存储 "system"，实际主题随设备变化，无需改写存储
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // 隐私模式 / storage 禁用时忽略持久化失败，主题切换本身不受影响
    }
  }, [preference]);

  // 实际主题应用到 DOM 并同步浏览器外壳色（颜色取自 tokens.css，不硬编码）
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    syncThemeColorMeta();
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(resolveTheme(next, systemPrefersDark));
  }, []);

  // 跟随系统：仅 system 档位注册设备主题变化监听（评审 nit 1），
  // 切到 light/dark 档位时卸载监听，不为无关档位保留回调
  useEffect(() => {
    if (preference !== "system") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [preference]);

  // 跨标签页同步（评审 suggestion 1）：storage 事件只在本页之外写入时触发，
  // 本页自身的持久化不会触发本页监听；键匹配时采用新偏好，键被清除时回落默认，
  // 非法值忽略。同值写入不会产生状态变化（React 状态相同即跳过）。
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) {
        return;
      }
      if (isThemePreference(event.newValue)) {
        setPreference(event.newValue);
      } else if (event.newValue === null) {
        setPreference(DEFAULT_THEME_PREFERENCE);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [setPreference]);

  return { theme, preference, setPreference };
}
