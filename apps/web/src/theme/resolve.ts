/**
 * 主题解析（纯函数，RAY-261 起三档偏好）
 *
 * 供两处共用同一套规则：
 * - `index.html` 的内联脚本（首帧渲染前执行，避免深色模式首帧闪烁 FOUC）
 * - `useTheme` hook（React 状态初始化与切换）
 *
 * 偏好（ThemePreference，localStorage 持久化）三档：light / dark / system。
 * 解析优先级：light / dark 直接采用；system（或缺失、非法值）跟随系统
 * prefers-color-scheme；系统偏好不可用视为浅色兜底。
 * 修改本文件规则时，必须同步检查 index.html 内联脚本；
 * `themeInitScript.test.ts` 会校验两者行为一致。
 */
export type Theme = "light" | "dark";

/** 用户主题偏好三档：浅色 / 深色 / 跟随系统（RAY-261） */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "lexilexi:theme";

/** 无持久化偏好时的默认档位：跟随系统 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** 判断 localStorage 原始值是否为合法偏好（RAY-261 三档；旧版遗留值 light/dark 仍合法） */
export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** 偏好 → 实际主题：light/dark 直接采用；system 或非法/缺失值跟随系统偏好 */
export function resolveTheme(preference: string | null, systemPrefersDark: boolean): Theme {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return systemPrefersDark ? "dark" : "light";
}
