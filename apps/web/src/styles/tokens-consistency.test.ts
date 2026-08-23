/**
 * tokens-consistency.test.ts — 三源一致性守护
 *
 * 校验 docs/design-tokens.md ↔ tokens.css ↔ palette.ts 三处数值一致（颜色/Shape/Type/Motion）
 * 与 docs/design-tokens.md 同源校验；单 seed #4F46E5 Tonal spot（pure-palette.json）为基准。
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  darkPalette,
  lightPalette,
  motionDurations,
  motionEasings,
  shapeTokens,
  typeScaleTokens,
} from "../theme/palette";

const tokensCss = readFileSync("src/styles/tokens.css", "utf8");

let docsContent = "";
let docsFound = false;
for (const p of [
  "docs/design-tokens.md",
  "../../docs/design-tokens.md",
  "../../../docs/design-tokens.md",
  "Lexii/docs/design-tokens.md",
]) {
  try {
    docsContent = readFileSync(p, "utf8");
    docsFound = true;
    break;
  } catch {
    // try next candidate
  }
}
if (!docsFound) {
  try {
    docsContent = readFileSync(new URL("../../../docs/design-tokens.md", import.meta.url), "utf8");
    docsFound = docsContent.length > 0;
  } catch {
    // ignore
  }
}
// 兜底：相对 cwd 尝试
if (!docsFound) {
  for (const cand of ["docs/design-tokens.md", "Lexii/docs/design-tokens.md"]) {
    if (existsSync(cand)) {
      docsContent = readFileSync(cand, "utf8");
      docsFound = true;
      break;
    }
  }
}

// 纯调色板（用于 seed 校验）
let purePaletteJson: unknown = null;
try {
  const purePaletteRaw = readFileSync("src/theme/pure-palette.json", "utf8");
  purePaletteJson = JSON.parse(purePaletteRaw);
} catch {
  // ignore, will be checked in test
}

// --- 解析 tokens.css ---
function extractVars(block: string): Map<string, string> {
  const map = new Map<string, string>();
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /--lex-([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    map.set(`--lex-${m[1]!}`, m[2]!.trim());
  }
  return map;
}

function extractThemeBlocks(css: string): {
  light: Map<string, string>;
  dark: Map<string, string>;
} {
  const rootBlocks = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((m) => m[1]!);
  const lightBlock =
    rootBlocks.find((b) => b.includes("--lex-primary") || b.includes("--lex-background")) ??
    rootBlocks[0] ??
    "";
  const darkMatch = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
  const darkBlock = darkMatch?.[1] ?? "";
  return { light: extractVars(lightBlock), dark: extractVars(darkBlock) };
}

const { light: lightVars, dark: darkVars } = extractThemeBlocks(tokensCss);

function normalizeHex(value: string): string {
  return value.trim().toLowerCase();
}

// 将 palette key（如 primaryContainer）转为 css var 名（--lex-primary-container）
// 规则：驼峰转 kebab，并处理特殊大小写
function paletteKeyToVar(key: string): string {
  const kebab = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return `--lex-${kebab}`;
}

describe("tokens-consistency（三源一致性）", () => {
  it("pure-palette.json 存在且 seed 为 #4F46E5 Tonal spot", () => {
    expect(purePaletteJson).not.toBeNull();
    const p = purePaletteJson as {
      seed: string;
      variant: string;
      light: Record<string, string>;
      dark: Record<string, string>;
    };
    expect(p.seed.toLowerCase()).toBe("#4f46e5");
    expect(p.variant.toLowerCase()).toContain("tonal");
    expect(p.light.primary).toBeDefined();
    expect(p.dark.primary).toBeDefined();
  });

  it("tokens.css 浅色与 palette.ts light 一致（颜色）", () => {
    const failures: string[] = [];
    for (const [key, expected] of Object.entries(lightPalette)) {
      const varName = paletteKeyToVar(key);
      const cssVal = lightVars.get(varName);
      if (!cssVal) {
        failures.push(`缺失 ${varName} (palette light.${key}=${expected})`);
        continue;
      }
      if (cssVal.includes("var(")) continue; // 别名不计
      if (normalizeHex(cssVal) !== normalizeHex(expected)) {
        failures.push(`${varName}: tokens.css ${cssVal} ≠ palette.ts ${expected}`);
      }
    }
    if (failures.length > 0)
      expect.fail(`浅色三源不一致 (${failures.length}):\n${failures.join("\n")}`);
  });

  it("tokens.css 深色与 palette.ts dark 一致（颜色）", () => {
    const failures: string[] = [];
    for (const [key, expected] of Object.entries(darkPalette)) {
      const varName = paletteKeyToVar(key);
      const cssVal = darkVars.get(varName);
      if (!cssVal) {
        failures.push(`缺失 ${varName} (palette dark.${key}=${expected})`);
        continue;
      }
      if (cssVal.includes("var(")) continue;
      if (normalizeHex(cssVal) !== normalizeHex(expected)) {
        failures.push(`${varName}: tokens.css ${cssVal} ≠ palette.ts ${expected}`);
      }
    }
    if (failures.length > 0)
      expect.fail(`深色三源不一致 (${failures.length}):\n${failures.join("\n")}`);
  });

  it("pure-palette.json 与 palette.ts 完全一致", () => {
    const p = purePaletteJson as { light: Record<string, string>; dark: Record<string, string> };
    expect(p).not.toBeNull();
    for (const [k, v] of Object.entries(p.light)) {
      expect(normalizeHex(lightPalette[k] ?? "")).toBe(normalizeHex(v));
    }
    for (const [k, v] of Object.entries(p.dark)) {
      expect(normalizeHex(darkPalette[k] ?? "")).toBe(normalizeHex(v));
    }
  });

  it("Shape token 与 palette.ts 一致", () => {
    for (const [varName, expected] of Object.entries(shapeTokens)) {
      const lightVal = lightVars.get(varName);
      expect(lightVal, `缺失 shape ${varName}`).toBeDefined();
      expect(lightVal!.trim()).toBe(expected);
    }
  });

  it("Motion durations/easings 与 palette.ts 一致", () => {
    for (const [varName, expected] of Object.entries({ ...motionDurations, ...motionEasings })) {
      const lightVal = lightVars.get(varName);
      expect(lightVal, `缺失 motion ${varName}`).toBeDefined();
      // 去除多余空白后对比
      expect(lightVal!.replace(/\s+/g, " ").trim()).toBe(expected.replace(/\s+/g, " ").trim());
    }
    // 全局 prefers-reduced-motion 必须存在
    expect(tokensCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("Type Scale 15 档 与 palette.ts 一致", () => {
    const failures: string[] = [];
    for (const [varName, expected] of Object.entries(typeScaleTokens)) {
      const cssVal = lightVars.get(varName);
      if (!cssVal) {
        failures.push(`缺失 ${varName}`);
        continue;
      }
      if (cssVal.trim() !== expected) {
        failures.push(`${varName}: tokens.css ${cssVal} ≠ palette.ts ${expected}`);
      }
    }
    if (failures.length > 0)
      expect.fail(`Type Scale 不一致 (${failures.length}):\n${failures.join("\n")}`);
  });

  it("docs/design-tokens.md 存在且包含关键 token 表", () => {
    expect(docsFound, "docs/design-tokens.md 未找到（应位于 docs/design-tokens.md）").toBe(true);
    expect(docsContent).toContain("--lex-primary");
    expect(docsContent).toContain("#313066");
    expect(docsContent).toContain("#dbd8ff");
    expect(docsContent).toContain("--lex-radius-");
    expect(docsContent).toContain("--lex-typescale-");
    expect(docsContent).toContain("--lex-motion-");
    expect(docsContent).toContain("pure-palette.json");
  });

  it("docs 表格数值与 tokens.css 一致（抽样）", () => {
    // 抽样若干关键色值在文档中出现且与 tokens.css 一致（MCU 0.3.0）
    const samples: Array<{ varName: string; lightVal: string; darkVal: string }> = [
      { varName: "--lex-primary", lightVal: "#313066", darkVal: "#dbd8ff" },
      { varName: "--lex-primary-container", lightVal: "#6867a1", darkVal: "#8c8bc8" },
      { varName: "--lex-background", lightVal: "#fcf8ff", darkVal: "#131318" },
      { varName: "--lex-surface-container", lightVal: "#eae7ef", darkVal: "#1f1f2a" },
      { varName: "--lex-error", lightVal: "#ba1a1a", darkVal: "#ffb4ab" },
      { varName: "--lex-success", lightVal: "#1b5c1a", darkVal: "#76db7a" },
    ];
    for (const s of samples) {
      const cssLight = lightVars.get(s.varName);
      const cssDark = darkVars.get(s.varName);
      expect(normalizeHex(cssLight ?? "")).toBe(normalizeHex(s.lightVal));
      expect(normalizeHex(cssDark ?? "")).toBe(normalizeHex(s.darkVal));
      expect(docsContent).toContain(s.lightVal);
      expect(docsContent).toContain(s.darkVal);
    }
  });

  it("Batch5 已删除 deprecated 别名（--lex-bg 等），仅保留 M3 角色", () => {
    const removedAliases = [
      "--lex-bg",
      "--lex-surface-raised",
      "--lex-border",
      "--lex-text",
      "--lex-text-muted",
      "--lex-primary-contrast",
      "--lex-accent",
      "--lex-danger",
      "--lex-focus-ring",
    ];
    for (const alias of removedAliases) {
      expect(lightVars.get(alias), `Batch5 后不应存在 deprecated 别名 ${alias}（light）`).toBeUndefined();
      expect(darkVars.get(alias), `Batch5 后不应存在 deprecated 别名 ${alias}（dark）`).toBeUndefined();
    }
    // M3 背景色仍存在，供 theme-color 同步
    expect(lightVars.get("--lex-background")?.toLowerCase()).toBe("#fcf8ff");
    expect(darkVars.get("--lex-background")?.toLowerCase()).toBe("#131318");
  });

  it("字体栈与 palette.ts 一致", () => {
    const sans = lightVars.get("--lex-font-sans");
    expect(sans).toBeDefined();
    expect(sans!).toContain("MiSans");
    expect(sans!).toContain("PingFang SC");
    // 深色不重复定义字体栈亦可，此处仅校验浅色存在
  });
});
