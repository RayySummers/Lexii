import html from "../../index.html?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY } from "./resolve";

// 提取 index.html 中随应用实际发布的内联主题初始化脚本
function extractInitScript(source: string): string {
  const match = source.match(/<script data-lexilexi-theme-init>([\s\S]*?)<\/script>/);
  if (!match || match[1] === undefined) {
    throw new Error("index.html 中未找到 data-lexilexi-theme-init 内联脚本");
  }
  return match[1];
}

const initScript = extractInitScript(html);

// jsdom 环境默认不执行 <script> 内容，这里手动执行以模拟浏览器首帧渲染前的行为
function runInitScript() {
  new Function(initScript)();
}

describe("index.html 主题初始化内联脚本", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
  });

  it("只操作 data-theme，不引入硬编码颜色", () => {
    expect(initScript).toMatch(/dataset\.theme/);
    expect(initScript).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  const cases: Array<[label: string, stored: string | null, prefersDark: boolean]> = [
    ["localStorage 存 light", "light", false],
    ["localStorage 存 dark", "dark", true],
    ["无持久化值且系统深色", null, true],
    ["无持久化值且系统浅色", null, false],
    ["非法持久化值且系统深色", "blue", true],
  ];

  it.each(cases)("%s：与 resolveTheme 行为一致", (_label, stored, prefersDark) => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: prefersDark }) as unknown as typeof matchMedia;
    if (stored !== null) {
      window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    }
    runInitScript();
    expect(document.documentElement.dataset.theme).toBe(resolveTheme(stored, prefersDark));
  });
});
