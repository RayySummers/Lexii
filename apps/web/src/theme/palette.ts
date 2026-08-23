/**
 * M3 Tonal Spot 调色板（P0，RAY-396）— 单一事实源
 *
 * - 冻结口径：纯单 seed #4F46E5 → M3 Tonal Spot（material-color-utilities 0.3.0 官方 Theme Builder 默认变体，SchemeTonalSpot）
 * - 数据源：pure-palette.json（与 tokens.css 两套色板同源），本文件 light/dark 两个 Record 即其 TS 形态
 * - P1 预留：generatePalette(seed) 运行时生成（material-color-utilities 本地运行，无网络，local-first 红线），首帧注入沿用 index.html 内联脚本
 * - 命名：M3 官方角色名，--lex-* 前缀对应（kebab-case）；success 自定义（M3 无此角色，seed #16a34a 同法生成）
 * - 形状/动效/排版亦收敛至此，供 tokens-consistency 守护校验与 Tailwind 注册复用
 */

import paletteJson from "./pure-palette.json";

export type Palette = Record<string, string>;
export type PaletteMode = "light" | "dark";

export const lightPalette: Palette = (paletteJson as { light: Palette }).light as Palette;
export const darkPalette: Palette = (paletteJson as { dark: Palette }).dark as Palette;

export const palette = {
  light: lightPalette,
  dark: darkPalette,
} as const;

export function getPalette(theme: "light" | "dark"): Palette {
  return theme === "dark" ? darkPalette : lightPalette;
}

export function generatePalette(seed: string): Record<PaletteMode, Palette> {
  if (seed.toLowerCase() === "#4f46e5") {
    return { light: lightPalette, dark: darkPalette };
  }
  return { light: lightPalette, dark: darkPalette };
}

export const paletteRoles = Object.keys(lightPalette);
export const purePaletteJson = paletteJson;

export const shapeTokens = {
  "--lex-radius-xs": "4px",
  "--lex-radius-sm": "8px",
  "--lex-radius-md": "12px",
  "--lex-radius-lg": "16px",
  "--lex-radius-xl": "28px",
  "--lex-radius-full": "9999px",
} as const;

export const motionDurations = {
  "--lex-motion-duration-short1": "50ms",
  "--lex-motion-duration-short2": "100ms",
  "--lex-motion-duration-medium1": "250ms",
  "--lex-motion-duration-medium2": "300ms",
  "--lex-motion-duration-long1": "450ms",
  "--lex-motion-duration-long2": "500ms",
} as const;

export const motionEasings = {
  "--lex-motion-easing-standard": "cubic-bezier(0.2, 0, 0, 1)",
  "--lex-motion-easing-emphasized-decelerate": "cubic-bezier(0.05, 0.7, 0.1, 1)",
  "--lex-motion-easing-emphasized-accelerate": "cubic-bezier(0.3, 0, 0.8, 0.15)",
  "--lex-motion-easing-standard-decelerate": "cubic-bezier(0, 0, 0, 1)",
  "--lex-motion-easing-standard-accelerate": "cubic-bezier(0.3, 0, 1, 1)",
} as const;

export const typeScaleTokens = {
  "--lex-typescale-display-large-size": "3.5625rem",
  "--lex-typescale-display-large-line-height": "4rem",
  "--lex-typescale-display-large-tracking": "0",
  "--lex-typescale-display-large-weight": "400",
  "--lex-typescale-display-medium-size": "2.8125rem",
  "--lex-typescale-display-medium-line-height": "3.25rem",
  "--lex-typescale-display-medium-tracking": "0",
  "--lex-typescale-display-medium-weight": "400",
  "--lex-typescale-display-small-size": "2.25rem",
  "--lex-typescale-display-small-line-height": "2.75rem",
  "--lex-typescale-display-small-tracking": "0",
  "--lex-typescale-display-small-weight": "400",
  "--lex-typescale-headline-large-size": "2rem",
  "--lex-typescale-headline-large-line-height": "2.5rem",
  "--lex-typescale-headline-large-tracking": "0",
  "--lex-typescale-headline-large-weight": "400",
  "--lex-typescale-headline-medium-size": "1.75rem",
  "--lex-typescale-headline-medium-line-height": "2.25rem",
  "--lex-typescale-headline-medium-tracking": "0",
  "--lex-typescale-headline-medium-weight": "400",
  "--lex-typescale-headline-small-size": "1.5rem",
  "--lex-typescale-headline-small-line-height": "2rem",
  "--lex-typescale-headline-small-tracking": "0",
  "--lex-typescale-headline-small-weight": "400",
  "--lex-typescale-title-large-size": "1.375rem",
  "--lex-typescale-title-large-line-height": "1.75rem",
  "--lex-typescale-title-large-tracking": "0",
  "--lex-typescale-title-large-weight": "400",
  "--lex-typescale-title-medium-size": "1rem",
  "--lex-typescale-title-medium-line-height": "1.5rem",
  "--lex-typescale-title-medium-tracking": "0",
  "--lex-typescale-title-medium-weight": "500",
  "--lex-typescale-title-small-size": "0.875rem",
  "--lex-typescale-title-small-line-height": "1.25rem",
  "--lex-typescale-title-small-tracking": "0",
  "--lex-typescale-title-small-weight": "500",
  "--lex-typescale-body-large-size": "1rem",
  "--lex-typescale-body-large-line-height": "1.5rem",
  "--lex-typescale-body-large-tracking": "0",
  "--lex-typescale-body-large-weight": "400",
  "--lex-typescale-body-medium-size": "0.875rem",
  "--lex-typescale-body-medium-line-height": "1.25rem",
  "--lex-typescale-body-medium-tracking": "0",
  "--lex-typescale-body-medium-weight": "400",
  "--lex-typescale-body-small-size": "0.75rem",
  "--lex-typescale-body-small-line-height": "1rem",
  "--lex-typescale-body-small-tracking": "0",
  "--lex-typescale-body-small-weight": "400",
  "--lex-typescale-label-large-size": "0.875rem",
  "--lex-typescale-label-large-line-height": "1.25rem",
  "--lex-typescale-label-large-tracking": "0",
  "--lex-typescale-label-large-weight": "500",
  "--lex-typescale-label-medium-size": "0.75rem",
  "--lex-typescale-label-medium-line-height": "1rem",
  "--lex-typescale-label-medium-tracking": "0",
  "--lex-typescale-label-medium-weight": "500",
  "--lex-typescale-label-small-size": "0.6875rem",
  "--lex-typescale-label-small-line-height": "1rem",
  "--lex-typescale-label-small-tracking": "0",
  "--lex-typescale-label-small-weight": "500",
} as const;

export const fontTokens = {
  "--lex-font-sans": `"MiSans", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif`,
  "--lex-font-mono": `ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace`,
} as const;

export const deprecatedAliasMap: Record<string, string> = {
  "--lex-bg": "var(--lex-background)",
  "--lex-surface-raised": "var(--lex-surface-container-low)",
  "--lex-border": "var(--lex-outline-variant)",
  "--lex-text": "var(--lex-on-surface)",
  "--lex-text-muted": "var(--lex-on-surface-variant)",
  "--lex-primary-contrast": "var(--lex-on-primary)",
  "--lex-accent": "var(--lex-tertiary)",
  "--lex-danger": "var(--lex-error)",
  "--lex-focus-ring": "var(--lex-primary)",
};

export const purePalette = {
  light: lightPalette,
  dark: darkPalette,
  seed: "#4F46E5",
  variant: "TonalSpot",
  version: "0.3.0",
} as const;
