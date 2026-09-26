import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 直接读源文件：`?raw` 对 .css 会被 Vite 的 CSS 管线接管（测试环境下拿到空串）
const indexCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles/index.css"),
  "utf-8",
);

/**
 * RAY-489 护栏：Material Symbols 图标元素上的 display / 可见性工具类会被静默吞掉。
 *
 * 根因（线上实证见 styles/index.css 的「级联层约束」注释）：
 * Google Fonts 的 Material Symbols 样式表在 `.material-symbols-outlined` 上以
 * **未分层**规则声明 `display: inline-block`；Tailwind v4 的工具类都落在
 * `@layer utilities` 里，而级联层规则是「未分层声明 > 任何 @layer 中的声明」
 * （与特异性、书写顺序无关）。因此 `hidden` / `sm:hidden` / `inline-flex` 这类
 * 工具类只要写在带 `material-symbols-outlined` 的元素上就一律无效。
 *
 * 后果先例：稳定通道顶栏「自定义词单」用 `sm:hidden` 隐藏桌面端冗余图标，
 * 实际没生效 → 桌面宽度渲染两个图标（RAY-489）。
 *
 * 本护栏做两件事：
 * 1. 静态扫描 apps/web/src 全部 ts/tsx，禁止把 display / 可见性工具类作为
 *    className 传给图标组件（`*Icon`）；
 * 2. 锁住 styles/index.css 里「未分层 + display:inline-flex」这条覆盖规则，
 *    防止有人为了“让工具类生效”把它移进 @layer —— 那会让 Google 的
 *    inline-block 重新夺回控制权（RAY-373 的图标居中随之回归）。
 */

/** 会与未分层 `.material-symbols-outlined { display: inline-flex }` 打架的工具类 */
const DISPLAY_UTILITIES = new Set([
  "hidden",
  "block",
  "inline",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "flow-root",
  "contents",
  "table",
  "table-row",
  "table-cell",
  "list-item",
  "visible",
  "invisible",
  "collapse",
  "sr-only",
  "not-sr-only",
]);

/** 去掉变体前缀（sm: / hover: / group-hover: / dark: …）与 important 后缀，取出工具类本体 */
function baseUtility(token: string): string {
  const withoutImportant = token.endsWith("!") ? token.slice(0, -1) : token;
  const lastColon = withoutImportant.lastIndexOf(":");
  return lastColon === -1 ? withoutImportant : withoutImportant.slice(lastColon + 1);
}

/** 从一段 JSX 元素文本里取出 className 的字面量内容（支持 "..." 与 {`...`}） */
function classNameOf(element: string): string | null {
  const literal = element.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
  if (!literal) return null;
  return literal[1] ?? literal[2] ?? "";
}

const sourceFiles = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const scannedSources = Object.entries(sourceFiles).filter(
  ([path]) => !path.includes(".test.") && !path.includes("/test/"),
);

/** 大括号配对扫描：返回该选择器规则所在的 at-rule 前奏栈与规则体 */
function locateRule(css: string, selector: string): { enclosing: string[]; body: string } | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 源码（`.selector {`）与构建产物（`.selector{`）两种写法都接受
  const match = new RegExp(`${escaped}\\s*\\{`).exec(css);
  if (!match) return null;
  const selectorAt = match.index;
  const braceAt = selectorAt + match[0].length - 1;

  const stack: string[] = [];
  const enclosing: string[] = [];
  let buffer = "";
  let bodyStart = -1;
  let bodyEnd = -1;
  let ruleDepth = -1;

  for (let i = 0; i < css.length; i += 1) {
    if (i === selectorAt) enclosing.push(...stack);
    const char = css[i];
    if (char === "{") {
      if (i === braceAt) {
        ruleDepth = stack.length + 1;
        bodyStart = i + 1;
      }
      stack.push(buffer.trim());
      buffer = "";
      continue;
    }
    if (char === "}") {
      if (ruleDepth !== -1 && bodyEnd === -1 && stack.length === ruleDepth) bodyEnd = i;
      stack.pop();
      buffer = "";
      continue;
    }
    buffer += char;
  }

  if (bodyStart === -1 || bodyEnd === -1) return null;
  return { enclosing, body: css.slice(bodyStart, bodyEnd) };
}

describe("RAY-489 图标 className 护栏", () => {
  it("扫描范围有效（能读到源码，避免护栏空转）", () => {
    expect(scannedSources.length).toBeGreaterThan(20);
    expect(scannedSources.some(([path]) => path.endsWith("App.tsx"))).toBe(true);
  });

  it("没有把 display / 可见性工具类传给图标组件", () => {
    const violations: string[] = [];

    for (const [path, source] of scannedSources) {
      const iconElements = source.match(/<[A-Z][A-Za-z0-9]*Icon\b[^>]*>/g) ?? [];
      for (const element of iconElements) {
        const className = classNameOf(element);
        if (className === null) continue;
        for (const token of className.split(/\s+/).filter(Boolean)) {
          if (DISPLAY_UTILITIES.has(baseUtility(token))) {
            violations.push(`${path}: ${element.trim()} → 命中工具类 "${token}"`);
          }
        }
      }
    }

    expect(
      violations,
      [
        "图标组件（*.material-symbols-outlined）上的 display / 可见性工具类不会生效：",
        "Google Fonts 的未分层 display 规则优先于 Tailwind 的 @layer utilities（RAY-489）。",
        "修复：把显隐/布局分叉放到外层普通元素上，例如",
        '  <span className="hidden sm:inline-flex"><ListIcon className="h-5 w-5" /></span>',
      ].join("\n"),
    ).toEqual([]);
  });

  it("index.css 的 .material-symbols-outlined 覆盖规则保持未分层且声明 display:inline-flex", () => {
    const rule = locateRule(indexCss, ".material-symbols-outlined");
    expect(rule, "index.css 中未找到 .material-symbols-outlined 规则").not.toBeNull();
    expect(
      (rule?.enclosing ?? []).filter((prelude) => prelude.startsWith("@layer")),
      "该规则被移进了 @layer：未分层优先级丢失，Google 的 inline-block 会重新生效（RAY-489 回归）",
    ).toEqual([]);
    expect(rule?.body).toContain("display: inline-flex;");
  });
});
