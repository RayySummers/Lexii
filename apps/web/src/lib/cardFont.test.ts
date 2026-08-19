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
      // RAY-338 A1：inter 档主字体 Inter Display 为自托管（public/fonts/，
      // @font-face 800），Google Fonts 只加载其回退字体 Inter 800
      const loadedName = option.id === "inter" ? "Inter" : fontNameOf(option.fontFamily);
      expect(loadedWeights.has(loadedName)).toBe(true);
      expect(loadedWeights.get(loadedName)).toBe(option.fontWeight);
    }
  });

  it("inter 档主字体为自托管 Inter Display（RAY-338 A1），Inter 仅为栈内回退", () => {
    const inter = CARD_FONT_OPTIONS.find((option) => option.id === "inter")!;
    expect(fontNameOf(inter.fontFamily)).toBe("Inter Display");
    expect(inter.fontWeight).toBe(800);
  });
});

/**
 * 从 tokens.css 源码中解析 `--lex-card-font:` 声明栈（按文件顺序，trim 后）。
 *
 * 先剥注释再匹配（RAY-339 R4 Oscar 复核 suggestion 1）——避免注释里
 * 写出 `--lex-card-font:` 字面量被漂移校验误匹配；之后按文件顺序
 * 提取每条声明的字面值。
 *
 * 注释剥离覆盖两种形态（RAY-339 R5 Oscar 复核 nit）：CSS 块注释
 * （斜杠星号包裹）与 `//` 行注释——CSS 唯一合法注释为块注释，
 * 行注释剥离为未来预处理器场景的防御——本函数只解析 tokens.css 的
 * 变量声明栈、不处理 url()/其他可能含 `//` 的内容。当前 tokens.css
 * 无 `url(//…)` 形态；如未来加入，需在剥 `//` 后再做「url( 内 //
 * 还原」的保守处理（本函数 doc 注释同步更新）。
 *
 * 与 `tokens.css` 的顺序契约（顶部 RAY-323 注释段）以及合并形态锁定
 * 决策（详见本测试文件 `首条栈由 :root 与 [data-card-font="inter"]
 * 共享` it()）互锁：tokens.css 内 `--lex-card-font:` 出现顺序须与
 * `CARD_FONT_OPTIONS` 数组一致，便于按 index 对账。
 */
function parseCardFontStacks(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...stripped.matchAll(/--lex-card-font:\s*([^;]+);/g)].map((match) => match[1]!.trim());
}

describe("tokens.css 的字体栈与 CARD_FONT_OPTIONS 同步（RAY-338 A1 漂移校验）", () => {
  const TOKENS_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../styles/tokens.css",
  );

  /**
   * tokens.css 中 `--lex-card-font:` 的字面值按文件顺序：
   * 第 1 条 = 默认档 / inter（合并的 :root, [data-card-font="inter"] 块，Oscar 复核 suggestion 1）
   * 第 2–4 条 = google-sans / playpen / newsreader 各自档。
   * 与 CARD_FONT_OPTIONS 顺序一致，便于按 index 对账。
   */
  function loadStacksFromTokensCss(): string[] {
    return parseCardFontStacks(readFileSync(TOKENS_PATH, "utf8"));
  }

  it("每档栈字面值与 CARD_FONT_OPTIONS.fontFamily 一致（防字面量漂移）", () => {
    const stacks = loadStacksFromTokensCss();
    expect(stacks).toHaveLength(CARD_FONT_OPTIONS.length);
    for (const [index, option] of CARD_FONT_OPTIONS.entries()) {
      expect(stacks[index]).toBe(option.fontFamily);
    }
  });

  it("inter 档主字体为自托管 Inter Display（RAY-338 A1），Inter 仅为栈内回退", () => {
    const stacks = loadStacksFromTokensCss();
    const interStack = stacks[CARD_FONT_OPTIONS.findIndex((option) => option.id === "inter")]!;
    expect(interStack.startsWith('"Inter Display"')).toBe(true);
    expect(interStack).toContain('"Inter"');
  });

  it('首条栈由 :root 与 [data-card-font="inter"] 共享（合并声明，无重复）', () => {
    // 显式锁定合并结构：审阅时一眼看清两处选择器共享同一字面值，
    // 防回归到分写两份（Oscar 复核 suggestion 1）
    //
    // 形状锁定有意的（Oscar R3 复审 nit 1，写进代码作为决策记录）：
    // 正则要求 `:root,` 与 `[data-card-font="inter"]` 必须换行分开 + 共享 `{`。
    // 未来维护者若把两选择器压缩到同一行（`:root, [data-card-font="inter"] {`）
    // 以节省纵向空间，本断言会失败——这是预期行为，不是误伤；放宽正则
    // 会让「两处选择器共享同一字面量」的可视化信号变弱，回归到分写两份
    // 的风险上升。本断言与 tokens.css 顶部的顺序契约注释配合，构成
    // 「实测防线 + 文档级提醒」的双层兜底。
    //
    // 互相交叉指向（RAY-339 R4 复核 nit 1）：如调整本句措辞，请同步
    // tokens.css 顶部 RAY-323 注释段里的顺序契约条目；详见该条目末尾
    // 的反向交叉指向。
    const source = readFileSync(TOKENS_PATH, "utf8");
    expect(source).toMatch(/^:root,\s*\n\s*\[data-card-font="inter"\]\s*\{/m);
  });
});

describe("parseCardFontStacks（CSS 块注释剥除，RAY-339 R4 suggestion 1）", () => {
  it("剥 /* ... */ 注释后再匹配，注释里的 --lex-card-font: 字面量不会被误匹配", () => {
    const source = `
/* 注释里写了 --lex-card-font: fake-stack; 会被剥掉 */
:root {
  --lex-card-font: real-stack;
}
`;
    expect(parseCardFontStacks(source)).toEqual(["real-stack"]);
  });

  it("正常匹配 4 条声明；多个块注释里的字面量都被剥除", () => {
    const source = `
/* 这是一个注释，里面提到了 --lex-card-font: trap-inter; */
:root, [data-card-font="inter"] {
  --lex-card-font: stack-inter;
}
/* another --lex-card-font: trap-google; */
[data-card-font="google-sans"] {
  --lex-card-font: stack-google;
}
/* trap-playpen */
[data-card-font="playpen"] {
  --lex-card-font: stack-playpen;
}
/* trap-newsreader */
[data-card-font="newsreader"] {
  --lex-card-font: stack-newsreader;
}
`;
    expect(parseCardFontStacks(source)).toEqual([
      "stack-inter",
      "stack-google",
      "stack-playpen",
      "stack-newsreader",
    ]);
  });

  it("非贪婪匹配：相邻块注释各自独立剥除，不会跨注释合并", () => {
    // 防止有人误把 /* ... */ 改成 /*[\\s\\S]*\\*/ 贪婪匹配导致跨注释吃错
    const source = `
/* first --lex-card-font: hidden-1; */
:root { --lex-card-font: real-1; }
/* second --lex-card-font: hidden-2; */
[data-card-font="google-sans"] { --lex-card-font: real-2; }
`;
    expect(parseCardFontStacks(source)).toEqual(["real-1", "real-2"]);
  });

  it("裸 `--lex-card-font` 缺少冒号不匹配（仅 `--lex-card-font:` 才进入漂移校验）", () => {
    const source = `
/* 这里裸写变量名无冒号，本就不该匹配 */
--lex-card-font nope;
:root { --lex-card-font: real; }
`;
    expect(parseCardFontStacks(source)).toEqual(["real"]);
  });

  it("`//` 行注释里的字面量被剥除，真实 4 条声明仍正常解析（RAY-339 R5 Oscar 复核 nit）", () => {
    // `//` 在纯 CSS 非法，本行注释剥离覆盖的是未来预处理器场景的防御：
    // 有人误写 `// --lex-card-font: fake;` 也不得泄入栈对账
    const source = `
// --lex-card-font: fake-inter;
:root, [data-card-font="inter"] {
  --lex-card-font: stack-inter;
}
// another --lex-card-font: fake-google;
[data-card-font="google-sans"] {
  --lex-card-font: stack-google;
}
// fake-playpen
[data-card-font="playpen"] {
  --lex-card-font: stack-playpen;
}
// fake-newsreader
[data-card-font="newsreader"] {
  --lex-card-font: stack-newsreader;
}
`;
    expect(parseCardFontStacks(source)).toEqual([
      "stack-inter",
      "stack-google",
      "stack-playpen",
      "stack-newsreader",
    ]);
  });
});
