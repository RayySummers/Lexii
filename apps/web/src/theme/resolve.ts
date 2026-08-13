/**
 * 主题解析（纯函数）
 *
 * 供两处共用同一套规则：
 * - `index.html` 的内联脚本（首帧渲染前执行，避免深色模式首帧闪烁 FOUC）
 * - `useTheme` hook（React 状态初始化）
 *
 * 优先级：持久化值（localStorage，合法值为 light / dark）→ 系统 prefers-color-scheme → 默认浅色。
 * 修改本文件规则时，必须同步修改 index.html 内联脚本；
 * `themeInitScript.test.ts` 会校验两者行为一致。
 */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "lexilexi:theme";

export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return systemPrefersDark ? "dark" : "light";
}
