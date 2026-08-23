#!/usr/bin/env node
/**
 * 禁裸 hex / rgb 硬编码扫描（RAY-397）
 *
 * 规则：组件/逻辑代码中禁止直接写十六进制色值或 rgb()/hsl()，一律通过 tokens.css 的 --lex-* 语义 token。
 * 例外（白名单）：
 *   - tokens.css 本身（唯一颜色定义处）
 *   - pure-palette.json / palette.ts（调色板收敛，与 tokens.css 同源）
 *   - docs/design-tokens.md（文档表格展示）
 *   - scan-hardcoded-colors.mjs 自身（正则包含 # 示例）
 *   - *.test.ts / *.test.tsx 中可通过 `// allow-hardcoded-color` 行级豁免或整文件豁免（测试断言需要对比真实色值）
 *   - apps/web/scripts/generate-icons.mjs（图标生成脚本的品牌色常量，与 --lex-primary 同源，见文件内注释）
 *   - 任何行含 `allow-hardcoded-color` 标记的行
 *
 * 用法：
 *   node scripts/scan-hardcoded-colors.mjs                # 扫描全仓（默认）
 *   node scripts/scan-hardcoded-colors.mjs --fix --json out.json  # 输出报告（CI 用）
 *
 * 退出码：发现违规 → 1，全部通过 → 0（与 scan_traditional.mjs 同口径，接 CI）
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const allowHardcodedMarker = "allow-hardcoded-color";

// 白名单：相对于 repoRoot 的精确路径或 glob-like 前缀
const WHITELIST_EXACT = new Set([
  "apps/web/src/styles/tokens.css",
  "apps/web/src/theme/pure-palette.json",
  "apps/web/src/theme/palette.ts",
  "pure-palette.json",
  "docs/design-tokens.md",
  "scripts/scan-hardcoded-colors.mjs",
  "apps/web/scripts/generate-icons.mjs",
  "apps/web/index.html",
]);

const WHITELIST_PREFIX = [
  "apps/web/public/", // 生成的图标、字体
  "Lexii/apps/web/public/", // 兼容不同 cwd
  ".git/",
  "node_modules/",
  "dist/",
  "playwright-report/",
  "test-results/",
  ".vite/",
  "coverage/",
];

const WHITELIST_SUFFIX = [
  ".png",
  ".woff2",
  ".json", // 除 pure-palette 外的 json 允许（但仍会扫 ts/css）
];

function isWhitelisted(fileRel) {
  if (WHITELIST_EXACT.has(fileRel)) return true;
  for (const pref of WHITELIST_PREFIX) if (fileRel.startsWith(pref)) return true;
  // 测试文件整文件豁免（需色值断言），但仍支持行级 allow 标记以便更细
  if (fileRel.endsWith(".test.ts") || fileRel.endsWith(".test.tsx") || fileRel.endsWith(".spec.ts"))
    return true;
  // stylelint / docs 里的 json 示例？
  return false;
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
// 匹配 rgb/rgba/hsl/hsla/oklch/oklab 等硬编码颜色函数（不含 color-mix / var）
const COLOR_FUNC_RE = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/gi;

function collectFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = relative(repoRoot, full).replace(/\\/g, "/");
    // 跳过白名单前缀目录
    if (WHITELIST_PREFIX.some((p) => rel.startsWith(p))) continue;
    // 跳过隐藏与锁文件
    if (name === ".git" || name === "node_modules" || name === "dist") continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectFiles(full, out);
    } else if (stat.isFile()) {
      // 只扫前端代码
      if (/\.(ts|tsx|js|mjs|cjs|jsx|css|html)$/.test(name)) {
        out.push(full);
      }
    }
  }
  return out;
}

const files = collectFiles(repoRoot);
const hits = [];
let totalScanned = 0;

for (const full of files) {
  const rel = relative(repoRoot, full).replace(/\\/g, "/");
  if (isWhitelisted(rel)) continue;
  // 后缀白名单
  if (WHITELIST_SUFFIX.some((s) => rel.endsWith(s))) continue;

  let content;
  try {
    content = readFileSync(full, "utf8");
  } catch {
    continue;
  }
  totalScanned += 1;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(allowHardcodedMarker)) continue;
    // 跳过注释中对 tokens.css 变量名的示例？不，直接扫
    // 跳过 import 语句中的颜色？不存在

    let match;
    // hex
    HEX_RE.lastIndex = 0;
    while ((match = HEX_RE.exec(line))) {
      // 额外豁免：Tailwind 任意值中的 hex 会出现在 class 字符串里，如 bg-[#fff] — 同样禁止，应拦截
      // 但允许出现在注释中的 hex 示例（若行含 allow 标记已跳过）
      const hex = match[0];
      // 误伤排除：url(#...) 中的 svg 锚点（如 <svg><use href="#icon">）— 但本仓无此类，且 # 后跟字母非 hex 长度 3-8 已过滤
      // 额外：允许  `// #` 注释中的 hex 若该行被标为 allow，否则仍拦截
      hits.push({
        file: rel,
        line: i + 1,
        col: match.index + 1,
        snippet: line.trim().slice(0, 200),
        kind: "hex",
        value: hex,
      });
    }
    // color func
    COLOR_FUNC_RE.lastIndex = 0;
    while ((match = COLOR_FUNC_RE.exec(line))) {
      // 允许 color-mix 与 var() 已被正则排除；oklch 若用于 token 定义处？目前 tokens.css 是唯一允许处，已白名单
      // 故此处任何 rgb/hsl 均视为违规
      hits.push({
        file: rel,
        line: i + 1,
        col: match.index + 1,
        snippet: line.trim().slice(0, 200),
        kind: "color-func",
        value: match[0].trim(),
      });
    }
  }
}

// 输出
const report = {
  scanned_at: new Date().toISOString(),
  repo_root: repoRoot,
  total_scanned_files: totalScanned,
  total_hits: hits.length,
  hits: hits.slice(0, 200), // 截断防止过长
  zero_violations: hits.length === 0,
  whitelist: {
    exact: [...WHITELIST_EXACT],
    prefix: WHITELIST_PREFIX,
    note: "测试文件整文件豁免，另可用行级 // allow-hardcoded-color 豁免单行",
  },
};

const args = process.argv.slice(2);
const outJson = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const shouldWrite = args.includes("--write") || args.includes("--fix") || !!outJson;
const outPath =
  outJson || (shouldWrite ? join(repoRoot, "scan-hardcoded-colors.report.json") : null);

if (outPath) {
  try {
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`report written to ${relative(repoRoot, outPath)}`);
  } catch (e) {
    console.error(`write report failed: ${e.message}`);
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (hits.length > 0) {
  console.error(
    `\n✗ 发现 ${hits.length} 处硬编码颜色（hex/rgb/hsl），请改为引用 tokens.css 的 --lex-* 语义 token。`,
  );
  console.error(
    `  白名单：tokens.css / pure-palette.json / palette.ts / docs/design-tokens.md / *.test.* / generate-icons.mjs`,
  );
  console.error(`  单行豁免：在该行末尾追加  // ${allowHardcodedMarker}`);
  console.error(`  示例违规（前 20 行）：`);
  for (const h of hits.slice(0, 20)) {
    console.error(`    ${h.file}:${h.line}:${h.col}  ${h.kind} ${h.value}  →  ${h.snippet}`);
  }
  process.exit(1);
} else {
  console.log(`\n✓ 未发现硬编码颜色（扫描 ${totalScanned} 个文件）`);
  process.exit(0);
}
