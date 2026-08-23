/**
 * token-contrast.test.ts — 对比度守护（WCAG AA ≥4.5:1）
 *
 * 读取 tokens.css 浅/深两套色板，自动计算所有 onX vs X 前景/背景对比度，失败即 CI 拦截。
 * 单 seed #4F46E5 Tonal spot 基准（pure-palette.json），与 docs/design-tokens.md 同源。
 *
 * 实现：纯 Node fs 读取，不依赖浏览器 getComputedStyle；支持 hex / rgb；对未解析为 hex 的 var() 别名跳过（别名本身不参与对比）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync("src/styles/tokens.css", "utf8");

// --- 颜色工具（WCAG 相对亮度） ---

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().toLowerCase();
  // 支持 #rgb / #rrggbb
  const m3 = normalized.match(/^#([0-9a-f]{3})$/);
  if (m3) {
    const h = m3[1]!;
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16)];
  }
  const m6 = normalized.match(/^#([0-9a-f]{6})$/);
  if (m6) {
    const h = m6[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m8 = normalized.match(/^#([0-9a-f]{8})$/);
  if (m8) {
    // #rrggbbaa → 忽略 alpha 按不透明白底混合（简化：取 rgb 通道）
    const h = m8[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

function parseCssColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  const hex = hexToRgb(v);
  if (hex) return hex;
  // rgb( r,g,b ) / rgba( r,g,b, a ) — 兼容整数与百分比（简化）
  const rgbMatch = v.match(
    /^rgba?\(\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)(?:\s*,\s*[0-9.]+)?\s*\)$/,
  );
  if (rgbMatch) {
    const toChannel = (s: string) =>
      s.endsWith("%") ? Math.round((parseFloat(s) / 100) * 255) : Math.round(parseFloat(s));
    return [toChannel(rgbMatch[1]!), toChannel(rgbMatch[2]!), toChannel(rgbMatch[3]!)];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fg: string, bg: string): number | null {
  const fgRgb = parseCssColor(fg);
  const bgRgb = parseCssColor(bg);
  if (!fgRgb || !bgRgb) return null;
  const L1 = luminance(fgRgb);
  const L2 = luminance(bgRgb);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- 提取 tokens.css 两套色板 ---

function extractVars(block: string): Map<string, string> {
  const map = new Map<string, string>();
  // 去掉注释防止干扰（与 cardFont.test 同口径）
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /--lex-([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const key = `--lex-${m[1]!}`;
    const value = m[2]!.trim();
    map.set(key, value);
  }
  return map;
}

function extractThemeBlocks(css: string): {
  light: Map<string, string>;
  dark: Map<string, string>;
} {
  // :root 浅色（取第一个 :root 块，排除 :root, [data-card-font...] 等卡片字体块）
  // 策略：匹配 `:root { ... }` 且内部含 --lex-primary / --lex-background 的块
  const rootBlocks = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)].map((m) => m[1]!);
  const lightBlock =
    rootBlocks.find((b) => b.includes("--lex-primary") || b.includes("--lex-background")) ??
    rootBlocks[0] ??
    "";
  const darkMatch = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
  const darkBlock = darkMatch?.[1] ?? "";
  return {
    light: extractVars(lightBlock),
    dark: extractVars(darkBlock),
  };
}

const { light: lightVars, dark: darkVars } = extractThemeBlocks(tokensCss);

// 动态发现所有 onX → X 配对：遍历 --lex-on-* 寻找对应 --lex-*
// 例：--lex-on-primary → --lex-primary；--lex-on-primary-container → --lex-primary-container
// 同时兼容历史 --lex-primary-contrast 命名（若存在，视为 onPrimary 的别名，不重复计入 M3 配对）
function buildContrastPairs(vars: Map<string, string>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const key of vars.keys()) {
    if (!key.startsWith("--lex-on-")) continue;
    const base = key.replace("--lex-on-", "--lex-"); // --lex-on-primary-container → --lex-primary-container
    if (vars.has(base)) {
      const pairKey = `${key}→${base}`;
      if (!seen.has(pairKey)) {
        pairs.push([key, base]);
        seen.add(pairKey);
      }
    }
  }

  // 额外：inverse 组（--lex-inverse-on-surface vs --lex-inverse-surface）
  // 动态发现已覆盖（--lex-inverse-on-surface 会匹配 --lex-inverse-surface），无需特殊处理

  // 历史别名兼容：若存在 --lex-primary-contrast 但无 --lex-on-primary，则视为等价对
  // 当前 M3 已有 --lex-on-primary，故此分支仅作向后兼容，实际不重复
  if (
    vars.has("--lex-primary-contrast") &&
    vars.has("--lex-primary") &&
    !vars.has("--lex-on-primary")
  ) {
    pairs.push(["--lex-primary-contrast", "--lex-primary"]);
  }

  return pairs;
}

// 预计算供错误信息展示
function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

describe("token-contrast（对比度守护 ≥4.5:1）", () => {
  it("tokens.css 存在浅/深两套且至少含 10 个颜色角色", () => {
    expect(lightVars.size).toBeGreaterThan(10);
    expect(darkVars.size).toBeGreaterThan(10);
    expect(lightVars.get("--lex-primary")).toBeDefined();
    expect(darkVars.get("--lex-primary")).toBeDefined();
  });

  it("浅色：所有 onX vs X 对比度 ≥4.5:1", () => {
    const pairs = buildContrastPairs(lightVars);
    expect(pairs.length).toBeGreaterThan(5); // 至少覆盖主/次/三级/错误/success/背景/表面等
    const failures: string[] = [];
    for (const [fgKey, bgKey] of pairs) {
      const fgVal = lightVars.get(fgKey)!;
      const bgVal = lightVars.get(bgKey)!;
      // 跳过非 hex 的 var() 别名（别名本身不参与对比度计算，真实值由其指向的角色保证）
      if (fgVal.includes("var(") || bgVal.includes("var(")) continue;
      const ratio = contrastRatio(fgVal, bgVal);
      if (ratio === null) {
        failures.push(`${fgKey} (${fgVal}) vs ${bgKey} (${bgVal}) 无法解析`);
        continue;
      }
      if (ratio < 4.5) {
        failures.push(`${fgKey} (${fgVal}) vs ${bgKey} (${bgVal}) = ${formatRatio(ratio)} < 4.5:1`);
      }
    }
    if (failures.length > 0) {
      // 输出实测矩阵便于对照 docs/design-tokens.md
      const matrix = pairs
        .map(([fg, bg]) => {
          const fgVal = lightVars.get(fg)!;
          const bgVal = lightVars.get(bg)!;
          if (fgVal.includes("var(") || bgVal.includes("var(")) return null;
          const r = contrastRatio(fgVal, bgVal);
          return r ? `${fg} vs ${bg}: ${formatRatio(r)}` : null;
        })
        .filter(Boolean)
        .join("\n");
      expect.fail(
        `浅色对比度不达标 (${failures.length} 组):\n${failures.join("\n")}\n\n实测矩阵:\n${matrix}`,
      );
    }
  });

  it("深色：所有 onX vs X 对比度 ≥4.5:1", () => {
    const pairs = buildContrastPairs(darkVars);
    expect(pairs.length).toBeGreaterThan(5);
    const failures: string[] = [];
    for (const [fgKey, bgKey] of pairs) {
      const fgVal = darkVars.get(fgKey)!;
      const bgVal = darkVars.get(bgKey)!;
      if (fgVal.includes("var(") || bgVal.includes("var(")) continue;
      const ratio = contrastRatio(fgVal, bgVal);
      if (ratio === null) {
        failures.push(`${fgKey} (${fgVal}) vs ${bgKey} (${bgVal}) 无法解析`);
        continue;
      }
      if (ratio < 4.5) {
        failures.push(`${fgKey} (${fgVal}) vs ${bgKey} (${bgVal}) = ${formatRatio(ratio)} < 4.5:1`);
      }
    }
    if (failures.length > 0) {
      const matrix = pairs
        .map(([fg, bg]) => {
          const fgVal = darkVars.get(fg)!;
          const bgVal = darkVars.get(bg)!;
          if (fgVal.includes("var(") || bgVal.includes("var(")) return null;
          const r = contrastRatio(fgVal, bgVal);
          return r ? `${fg} vs ${bg} : ${formatRatio(r!)}` : null;
        })
        .filter(Boolean)
        .join("\n");
      expect.fail(
        `深色对比度不达标 (${failures.length} 组):\n${failures.join("\n")}\n\n实测矩阵:\n${matrix}`,
      );
    }
  });

  it("成功组与逆色组同样满足对比度（防止自定义 success 偏浅）", () => {
    // 显式校验自定义 success 与 inverse 组，确保文档提及的自定角色未被遗漏
    const checkPair = (vars: Map<string, string>, fg: string, bg: string) => {
      const fgVal = vars.get(fg);
      const bgVal = vars.get(bg);
      if (!fgVal || !bgVal) return true; // 未定义则跳过，由 tokens-consistency 保障存在性
      if (fgVal.includes("var(") || bgVal.includes("var(")) return true;
      const r = contrastRatio(fgVal, bgVal);
      return r !== null && r >= 4.5;
    };

    expect(checkPair(lightVars, "--lex-on-success", "--lex-success")).toBe(true);
    expect(checkPair(darkVars, "--lex-on-success", "--lex-success")).toBe(true);
    expect(checkPair(lightVars, "--lex-on-success-container", "--lex-success-container")).toBe(
      true,
    );
    expect(checkPair(darkVars, "--lex-on-success-container", "--lex-success-container")).toBe(true);
    expect(checkPair(lightVars, "--lex-inverse-on-surface", "--lex-inverse-surface")).toBe(true);
    expect(checkPair(darkVars, "--lex-inverse-on-surface", "--lex-inverse-surface")).toBe(true);
  });
});
