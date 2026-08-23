/**
 * M3 Tonal Spot 调色板（P0，RAY-396）
 *
 * - 冻结口径：纯单 seed #4F46E5 → M3 Tonal Spot（material-color-utilities 0.3.0 官方 Theme Builder 默认变体）
 * - 数据源：pure-palette.json（与 tokens.css 两套色板同源，见 palette.test 守护）
 * - 本文件收敛为 light/dark 两个 Record，供 tokens.css 与后续 P1 的 generatePalette(seed) 复用；
 *   P1 将把写死的 light/dark 替换为运行时 generatePalette(seed)（material-color-utilities 本地运行，无网络，local-first 红线），
 *   首帧注入沿用 index.html 内联主题脚本机制。
 * - 命名：M3 官方角色名，--lex-* 前缀对应（kebab-case）；success 为 Lexii 自定义（M3 无此角色，seed #16a34a 同法生成）
 * - 对比度：所有 on* vs * ≥ 4.5:1（token-contrast.test.ts 自动校验）
 */

export type Palette = Record<string, string>;
export type PaletteMode = "light" | "dark";

/** 浅色调色板（M3 Tonal Spot，seed #4F46E5） */
export const lightPalette: Palette = {
  // 主色组
  primary: "#5a5892",
  "on-primary": "#ffffff",
  "primary-container": "#e2dfff",
  "on-primary-container": "#424178",
  // 次色组
  secondary: "#5e5c71",
  "on-secondary": "#ffffff",
  "secondary-container": "#e3e0f9",
  "on-secondary-container": "#464559",
  // 三级色组
  tertiary: "#7a5368",
  "on-tertiary": "#ffffff",
  "tertiary-container": "#ffd8ea",
  "on-tertiary-container": "#603c50",
  // 错误组
  error: "#ba1a1a",
  "on-error": "#ffffff",
  "error-container": "#ffdad6",
  "on-error-container": "#93000a",
  // 成功组（自定义）
  success: "#35693e",
  "on-success": "#ffffff",
  "success-container": "#b7f1ba",
  "on-success-container": "#1c5128",

  // 中性 16 角色
  background: "#fcf8ff",
  "on-background": "#1b1b21",
  surface: "#fcf8ff",
  "on-surface": "#1b1b21",
  "surface-variant": "#e4e1ec",
  "on-surface-variant": "#47464f",
  "surface-dim": "#dcd9e0",
  "surface-bright": "#fcf8ff",
  "surface-container-lowest": "#ffffff",
  "surface-container-low": "#f6f2fa",
  "surface-container": "#f0ecf4",
  "surface-container-high": "#eae7ef",
  "surface-container-highest": "#e5e1e9",
  outline: "#787680",
  "outline-variant": "#c8c5d0",
  scrim: "#000000",
  shadow: "#000000",
  "surface-tint": "#5a5892",

  // 逆色组
  "inverse-surface": "#313036",
  "inverse-on-surface": "#f3eff7",
  "inverse-primary": "#c3c0ff",
} as const;

/** 深色调色板（M3 Tonal Spot，seed #4F46E5） */
export const darkPalette: Palette = {
  // 主色组
  primary: "#c3c0ff",
  "on-primary": "#2b2a60",
  "primary-container": "#424178",
  "on-primary-container": "#e2dfff",
  // 次色组
  secondary: "#c7c4dd",
  "on-secondary": "#2f2e42",
  "secondary-container": "#464559",
  "on-secondary-container": "#e3e0f9",
  // 三级色组
  tertiary: "#eab9d1",
  "on-tertiary": "#472639",
  "tertiary-container": "#603c50",
  "on-tertiary-container": "#ffd8ea",
  // 错误组
  error: "#ffb4ab",
  "on-error": "#690005",
  "error-container": "#93000a",
  "on-error-container": "#ffdad6",
  // 成功组（自定义）
  success: "#9cd4a0",
  "on-success": "#003914",
  "success-container": "#1c5128",
  "on-success-container": "#b7f1ba",

  // 中性 16 角色
  background: "#131318",
  "on-background": "#e5e1e9",
  surface: "#131318",
  "on-surface": "#e5e1e9",
  "surface-variant": "#47464f",
  "on-surface-variant": "#c8c5d0",
  "surface-dim": "#131318",
  "surface-bright": "#39383f",
  "surface-container-lowest": "#0e0e13",
  "surface-container-low": "#1b1b21",
  "surface-container": "#201f25",
  "surface-container-high": "#2a292f",
  "surface-container-highest": "#35343a",
  outline: "#928f9a",
  "outline-variant": "#47464f",
  scrim: "#000000",
  shadow: "#000000",
  "surface-tint": "#c3c0ff",

  // 逆色组
  "inverse-surface": "#e5e1e9",
  "inverse-on-surface": "#313036",
  "inverse-primary": "#5a5892",
} as const;

/** 旧 token 映射（deprecated，别名保留至迁移完成） */
export const deprecatedAliasMap: Record<string, string> = {
  "--lex-bg": "var(--lex-background)",
  "--lex-surface": "var(--lex-surface)",
  "--lex-surface-raised": "var(--lex-surface-container-low)",
  "--lex-border": "var(--lex-outline-variant)",
  "--lex-text": "var(--lex-on-surface)",
  "--lex-text-muted": "var(--lex-on-surface-variant)",
  "--lex-primary": "var(--lex-primary)",
  "--lex-primary-contrast": "var(--lex-on-primary)",
  "--lex-accent": "var(--lex-tertiary)",
  "--lex-danger": "var(--lex-error)",
  "--lex-success": "var(--lex-success)",
  "--lex-focus-ring": "var(--lex-primary)",
};

/**
 * P1 预留：运行时由 seed 生成调色板
 * 当前 P0 为静态冻结色板（#4F46E5），P1 将接入 material-color-utilities 本地生成；
 * 签名保持与 P1 一致，调用方无需改动。
 */
export function generatePalette(seed: string): Record<PaletteMode, Palette> {
  // P0 冻结：仅 seed #4F46E5 有静态结果，其余 seed 透传相同结构（P1 再实现真实生成）
  if (seed.toLowerCase() === "#4f46e5") {
    return { light: lightPalette, dark: darkPalette };
  }
  // 占位：非冻结 seed 暂返回同一套（避免 P0 误用产生空白），P1 将替换为真实 tonal 生成
  return { light: lightPalette, dark: darkPalette };
}

/** 便于守护测试读取：所有角色名 */
export const paletteRoles = Object.keys(lightPalette);

/** 导出纯 JSON 源（与 pure-palette.json 同源，供测试对比） */
export const purePalette = {
  light: lightPalette,
  dark: darkPalette,
  seed: "#4F46E5",
  variant: "TonalSpot",
  version: "0.3.0",
} as const;
