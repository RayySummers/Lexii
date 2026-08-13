import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import html from "../../index.html?raw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncThemeColorMeta } from "./themeColor";
import themeColorSource from "./themeColor?raw";

// Vitest 的 CSS 插件会拦截 .css?raw 并返回空模块，改用 fs 直接读取 tokens.css 源码
// （vitest 运行时 cwd 固定为 apps/web 包目录，CI / 根目录递归执行均一致）
const tokensCss = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

// 提取 tokens.css 的 :root 块中浅色 --lex-bg 的值（design tokens 的唯一来源）
function extractLightBgToken(source: string): string {
  const rootBlock = source.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootBlock || rootBlock[1] === undefined) {
    throw new Error("tokens.css 中未找到 :root 块");
  }
  const match = rootBlock[1].match(/--lex-bg:\s*([^;]+);/);
  if (!match || match[1] === undefined) {
    throw new Error(":root 块中未找到 --lex-bg");
  }
  return match[1].trim();
}

// 提取 index.html 中随应用实际发布的 meta theme-color 初始值
function extractMetaContent(source: string): string {
  const match = source.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/);
  if (!match || match[1] === undefined) {
    throw new Error("index.html 中未找到 meta theme-color");
  }
  return match[1];
}

describe("themeColor（meta theme-color 同步）", () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("style");
    meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#fafaf9";
    document.head.appendChild(meta);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.documentElement.removeAttribute("style");
  });

  it("将 meta content 同步为当前 --lex-bg token 值", () => {
    document.documentElement.style.setProperty("--lex-bg", "#0c0a09");
    syncThemeColorMeta();
    expect(meta.content).toBe("#0c0a09");
  });

  it("token 不可用（CSS 未加载）时保持 meta 原值且不抛错", () => {
    expect(() => syncThemeColorMeta()).not.toThrow();
    expect(meta.content).toBe("#fafaf9");
  });

  it("页面不存在 meta 时不抛错", () => {
    document.head.innerHTML = "";
    document.documentElement.style.setProperty("--lex-bg", "#0c0a09");
    expect(() => syncThemeColorMeta()).not.toThrow();
  });

  it("模块源码不含十六进制颜色（颜色只来自 design tokens）", () => {
    expect(themeColorSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("index.html 初始值与 tokens.css 浅色 --lex-bg 一致（防漂移）", () => {
    expect(extractMetaContent(html)).toBe(extractLightBgToken(tokensCss));
  });
});
