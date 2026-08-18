/**
 * 「卡片字体」偏好（RAY-323）解析/读写测试。
 *
 * 纯函数（parseCardFont / isCardFont）直接测；localStorage 读写用 jsdom
 * 环境验证（损坏值回落默认，隐私模式抛错不炸）；CARD_FONT_OPTIONS 锁定
 * 4 档、id 与 CardFont 类型一一对应、每档都有示例文案与字重；最后一块
 * 校验 CARD_FONT_OPTIONS.fontWeight 与 index.html 的 Google Fonts URL
 * 加载字重严格一致（Oscar 评审 suggestion 2 的漂移防线）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CARD_FONT_OPTIONS,
  CARD_FONT_STORAGE_KEY,
  DEFAULT_CARD_FONT,
  isCardFont,
  parseCardFont,
  readCardFont,
  writeCardFont,
} from "./cardFont";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

describe("isCardFont（类型守卫）", () => {
  it("4 档合法值", () => {
    expect(isCardFont("inter")).toBe(true);
    expect(isCardFont("google-sans")).toBe(true);
    expect(isCardFont("playpen")).toBe(true);
    expect(isCardFont("newsreader")).toBe(true);
  });

  it("非法值拒绝（含空、含未知名、含大小写错误）", () => {
    expect(isCardFont(null)).toBe(false);
    expect(isCardFont(undefined)).toBe(false);
    expect(isCardFont("")).toBe(false);
    expect(isCardFont("Inter")).toBe(false); // 大小写敏感
    expect(isCardFont("roboto")).toBe(false);
    expect(isCardFont("Inter Display")).toBe(false);
  });
});

describe("parseCardFont（纯函数）", () => {
  it("缺失/空串回落默认现代简约", () => {
    expect(DEFAULT_CARD_FONT).toBe("inter");
    expect(parseCardFont(null)).toBe("inter");
    expect(parseCardFont(undefined)).toBe("inter");
    expect(parseCardFont("")).toBe("inter");
    expect(parseCardFont("   ")).toBe("inter");
  });

  it("合法值原样解析（含首尾空白）", () => {
    expect(parseCardFont("inter")).toBe("inter");
    expect(parseCardFont("google-sans")).toBe("google-sans");
    expect(parseCardFont("playpen")).toBe("playpen");
    expect(parseCardFont("newsreader")).toBe("newsreader");
    // 首尾空白 trim 后通过类型守卫
    expect(parseCardFont("  newsreader  ")).toBe("newsreader");
  });

  it("非法值回落默认", () => {
    expect(parseCardFont("garbage")).toBe("inter");
    expect(parseCardFont("INTER")).toBe("inter");
  });
});

describe("readCardFont / writeCardFont（localStorage 读写）", () => {
  it("未写入时读默认值；写入后读回写入值", () => {
    expect(readCardFont()).toBe("inter");
    expect(writeCardFont("newsreader")).toBe(true);
    expect(window.localStorage.getItem(CARD_FONT_STORAGE_KEY)).toBe("newsreader");
    expect(readCardFont()).toBe("newsreader");
    // 4 档都能写能读
    expect(writeCardFont("playpen")).toBe(true);
    expect(readCardFont()).toBe("playpen");
    expect(writeCardFont("google-sans")).toBe(true);
    expect(readCardFont()).toBe("google-sans");
  });

  it("存储值损坏回落默认", () => {
    window.localStorage.setItem(CARD_FONT_STORAGE_KEY, "garbage");
    expect(readCardFont()).toBe("inter");
  });

  it("localStorage 抛错（隐私模式）不炸：读回落默认、写返回 false", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readCardFont()).toBe("inter");
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(writeCardFont("playpen")).toBe(false);
  });
});

describe("CARD_FONT_OPTIONS（settings 卡片元数据单点来源）", () => {
  it("锁定 4 档、按 settings 卡片展示顺序排列", () => {
    expect(CARD_FONT_OPTIONS.map((option) => option.id)).toEqual([
      "inter",
      "google-sans",
      "playpen",
      "newsreader",
    ]);
  });

  it("每档都有中文短名 / 描述 / 示例文案 / 字体栈 / 字重", () => {
    for (const option of CARD_FONT_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
      expect(option.sampleText.length).toBeGreaterThan(0);
      expect(option.fontFamily.length).toBeGreaterThan(0);
      expect(Number.isInteger(option.fontWeight)).toBe(true);
      expect(option.fontWeight).toBeGreaterThan(0);
    }
  });

  it("字重口径（Oscar 评审 suggestion 2）：inter 800（ExtraBold），其余 600（SemiBold）", () => {
    expect(CARD_FONT_OPTIONS.find((option) => option.id === "inter")!.fontWeight).toBe(800);
    for (const option of CARD_FONT_OPTIONS) {
      if (option.id === "inter") continue;
      expect(option.fontWeight).toBe(600);
    }
  });

  it("id 与 CardFont 类型一一对应（无重复）", () => {
    const ids = new Set(CARD_FONT_OPTIONS.map((option) => option.id));
    expect(ids.size).toBe(CARD_FONT_OPTIONS.length);
  });
});

describe("CARD_FONT_OPTIONS 与 index.html 的 Google Fonts URL 同步（漂移校验）", () => {
  const INDEX_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.html");

  /** index.html 的 <link href> → 字体名 → 加载字重 的映射 */
  function loadFontWeightsFromIndexHtml(): Map<string, number> {
    const source = readFileSync(INDEX_PATH, "utf8");
    const hrefMatch = source.match(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/);
    expect(hrefMatch).not.toBeNull();
    const cssUrl = hrefMatch![1]!;
    const weights = new Map<string, number>();
    // family=Playpen+Sans:wght@600 —— 字体名中的 + 还原为空格
    for (const match of cssUrl.matchAll(/family=([^&:]+):wght@(\d+)/g)) {
      weights.set(match[1]!.replace(/\+/g, " "), Number(match[2]));
    }
    return weights;
  }

  /** CARD_FONT_OPTIONS 的 id → 字体名（fontFamily 第一个元素，去掉引号） */
  function fontNameOf(fontFamily: string): string {
    const first = fontFamily.split(",")[0]!.trim();
    return first.replace(/"/g, "");
  }

  it("每档 fontWeight 与 Google Fonts URL 中加载的字重严格一致（未加载字重会被合成）", () => {
    const loadedWeights = loadFontWeightsFromIndexHtml();
    expect(loadedWeights.size).toBe(CARD_FONT_OPTIONS.length);
    for (const option of CARD_FONT_OPTIONS) {
      const name = fontNameOf(option.fontFamily);
      expect(loadedWeights.has(name)).toBe(true);
      expect(loadedWeights.get(name)).toBe(option.fontWeight);
    }
  });
});
