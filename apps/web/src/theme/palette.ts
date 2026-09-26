/**
 * M3 Tonal Spot palette for seed #4F46E5 — single source for tokens.css / docs/design-tokens.md
 *
 * 冻结口径：纯单 seed #4F46E5 Tonal spot（见 pure-palette.json，官方 Theme Builder 默认变体）。
 * P0 阶段收敛到 light/dark 两个 Record，供 tokens.css 与文档同源校验；
 * P1 将改为 generatePalette(seed) 运行时生成 + 首帧注入（沿用 index.html 内联脚本机制），
 * 因此此处接口形状刻意保持「Record<string,string>」以便平滑替换。
 *
 * 修改任何色值时必须同步：
 *  1. apps/web/src/theme/pure-palette.json（唯一真相源）
 *  2. apps/web/src/styles/tokens.css（CSS 变量）
 *  3. docs/design-tokens.md（文档表格）
 *  otherwise tokens-consistency.test.ts 会红。
 */

import purePalette from "./pure-palette.json";

export type Palette = Record<string, string>;

export const lightPalette: Palette = purePalette.light as Palette;
export const darkPalette: Palette = purePalette.dark as Palette;

export const palette = {
  light: lightPalette,
  dark: darkPalette,
} as const;

// P1 预留：运行时生成接口（当前仅透传 pure-palette，未来替换为 material-color-utilities 动态生成）
export function getPalette(theme: "light" | "dark"): Palette {
  return theme === "dark" ? darkPalette : lightPalette;
}

// --- Shape / Type / Motion 亦收敛至此，供一致性校验复用（与 tokens.css 同源） ---

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

/**
 * Type scale 15 档（M3 规范 sp → rem，通过 sp/16），每档 size/line-height/letter-spacing/weight
 * 中文场景 letter-spacing 按 0 处理（文档与 tokens.css 中已体现为独立 --lex-typescale-*-tracking 覆盖）。
 * 数值来源：M3 Type Scale 官方 spec（display/headline/title/body/label 各3档）。
 */
export const typeScaleTokens = {
  // display
  "--lex-typescale-display-large-size": "3.5625rem", // 57sp
  "--lex-typescale-display-large-line-height": "4rem", // 64sp
  "--lex-typescale-display-large-tracking": "-0.016rem", // -0.25sp ≈ -0.0156rem
  "--lex-typescale-display-large-weight": "400",
  "--lex-typescale-display-medium-size": "2.8125rem", // 45sp
  "--lex-typescale-display-medium-line-height": "3.25rem", // 52sp
  "--lex-typescale-display-medium-tracking": "0",
  "--lex-typescale-display-medium-weight": "400",
  "--lex-typescale-display-small-size": "2.25rem", // 36sp
  "--lex-typescale-display-small-line-height": "2.75rem", // 44sp
  "--lex-typescale-display-small-tracking": "0",
  "--lex-typescale-display-small-weight": "400",
  // headline
  "--lex-typescale-headline-large-size": "2rem", // 32sp
  "--lex-typescale-headline-large-line-height": "2.5rem", // 40sp
  "--lex-typescale-headline-large-tracking": "0",
  "--lex-typescale-headline-large-weight": "400",
  "--lex-typescale-headline-medium-size": "1.75rem", // 28sp
  "--lex-typescale-headline-medium-line-height": "2.25rem", // 36sp
  "--lex-typescale-headline-medium-tracking": "0",
  "--lex-typescale-headline-medium-weight": "400",
  "--lex-typescale-headline-small-size": "1.5rem", // 24sp
  "--lex-typescale-headline-small-line-height": "2rem", // 32sp
  "--lex-typescale-headline-small-tracking": "0",
  "--lex-typescale-headline-small-weight": "400",
  // title
  "--lex-typescale-title-large-size": "1.375rem", // 22sp
  "--lex-typescale-title-large-line-height": "1.75rem", // 28sp
  "--lex-typescale-title-large-tracking": "0",
  "--lex-typescale-title-large-weight": "400",
  "--lex-typescale-title-medium-size": "1rem", // 16sp
  "--lex-typescale-title-medium-line-height": "1.5rem", // 24sp
  "--lex-typescale-title-medium-tracking": "0.009rem", // 0.15sp
  "--lex-typescale-title-medium-weight": "500",
  "--lex-typescale-title-small-size": "0.875rem", // 14sp
  "--lex-typescale-title-small-line-height": "1.25rem", // 20sp
  "--lex-typescale-title-small-tracking": "0.006rem", // 0.1sp
  "--lex-typescale-title-small-weight": "500",
  // body
  "--lex-typescale-body-large-size": "1rem", // 16sp
  "--lex-typescale-body-large-line-height": "1.5rem", // 24sp
  "--lex-typescale-body-large-tracking": "0.031rem", // 0.5sp
  "--lex-typescale-body-large-weight": "400",
  "--lex-typescale-body-medium-size": "0.875rem", // 14sp
  "--lex-typescale-body-medium-line-height": "1.25rem", // 20sp
  "--lex-typescale-body-medium-tracking": "0.016rem", // 0.25sp
  "--lex-typescale-body-medium-weight": "400",
  "--lex-typescale-body-small-size": "0.75rem", // 12sp
  "--lex-typescale-body-small-line-height": "1rem", // 16sp
  "--lex-typescale-body-small-tracking": "0.025rem", // 0.4sp
  "--lex-typescale-body-small-weight": "400",
  // label
  "--lex-typescale-label-large-size": "0.875rem", // 14sp
  "--lex-typescale-label-large-line-height": "1.25rem", // 20sp
  "--lex-typescale-label-large-tracking": "0.006rem", // 0.1sp
  "--lex-typescale-label-large-weight": "500",
  "--lex-typescale-label-medium-size": "0.75rem", // 12sp
  "--lex-typescale-label-medium-line-height": "1rem", // 16sp
  "--lex-typescale-label-medium-tracking": "0.031rem", // 0.5sp
  "--lex-typescale-label-medium-weight": "500",
  "--lex-typescale-label-small-size": "0.6875rem", // 11sp
  "--lex-typescale-label-small-line-height": "1rem", // 16sp
  "--lex-typescale-label-small-tracking": "0.031rem", // 0.5sp
  "--lex-typescale-label-small-weight": "500",
} as const;

// 字体栈（与 tokens.css --lex-font-sans / --lex-font-mono 同源）
export const fontTokens = {
  "--lex-font-sans": `"MiSans", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif`,
  "--lex-font-mono": `ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace`,
} as const;
