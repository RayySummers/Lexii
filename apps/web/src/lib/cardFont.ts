/**
 * 「卡片字体」偏好（RAY-323）。
 *
 * 产品口径：用户在设置里为复习卡片上的单词本体（sense.term）选择
 * 一种字体，共 4 档：现代简约（Inter Display ExtraBold）、现代圆润
 * （Google Sans Flex）、手写温润（Playpen Sans SemiBold）、优雅衬线
 * （Newsreader SemiBold）。选择立即应用到当前与未来所有卡片。
 *
 * 存储走 localStorage（与主题、发音口音、生词本开关等偏好同一持久化
 * 模式）。4 种字体通过 index.html 引入的 Google Fonts <link> 在首帧
 * 渲染前到达；CSS 端通过 <html data-card-font="..."> 切换到对应的
 * font-family（见 styles/tokens.css），卡片本体用 var(--lex-card-font)
 * 应用字体，组件层不感知具体字体名。
 *
 * 偏好不是学习数据，不随 JSON 备份导出。解析失败 / 存储不可用一律
 * 回落默认值（inter，现代简约），绝不阻塞复习。
 */

/** 4 种卡片字体档位（按 settings 卡片展示顺序） */
export type CardFont = "inter" | "google-sans" | "playpen" | "newsreader";

/** 偏好存储键 */
export const CARD_FONT_STORAGE_KEY = "lexii:card-font";

/** 默认档位：现代简约（Inter Display ExtraBold） */
export const DEFAULT_CARD_FONT: CardFont = "inter";

/** 判断 localStorage 原始值是否为合法档位 */
export function isCardFont(value: string | null | undefined): value is CardFont {
  return (
    value === "inter" || value === "google-sans" || value === "playpen" || value === "newsreader"
  );
}

/**
 * 解析存储值 → 合法档位（纯函数，供测试与读写复用）：
 * 缺失 / 非法 / 损坏一律回落默认 modern（inter）。
 */
export function parseCardFont(raw: string | null | undefined): CardFont {
  if (raw === null || raw === undefined) {
    return DEFAULT_CARD_FONT;
  }
  const trimmed = raw.trim();
  return isCardFont(trimmed) ? trimmed : DEFAULT_CARD_FONT;
}

/** 读取当前偏好（localStorage 不可用 / 损坏时回落默认） */
export function readCardFont(): CardFont {
  if (typeof window === "undefined") {
    return DEFAULT_CARD_FONT;
  }
  try {
    return parseCardFont(window.localStorage.getItem(CARD_FONT_STORAGE_KEY));
  } catch {
    // 隐私模式等场景下 localStorage 不可用，视为默认
    return DEFAULT_CARD_FONT;
  }
}

/** 写入偏好（localStorage 不可用时返回 false，不抛错） */
export function writeCardFont(font: CardFont): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(CARD_FONT_STORAGE_KEY, font);
    return true;
  } catch {
    return false;
  }
}

/**
 * 4 种字体档位的展示元数据（settings 卡片渲染与示例文案单点来源）：
 * - `id`：与 CardFont 类型一一对应
 * - `label`：中文短名（卡片标题）
 * - `description`：一句中文描述（卡片副文案）
 * - `sampleText`：示例单词，覆盖常见形态（短词 / 长词 / 含连字符 / 含数字），
 *   让用户在选择时能直观看出字体的字面特征（粗细、字宽、笔画衬线等）
 * - `fontFamily`：卡片本体与设置示例都引用的 CSS font-family 值；
 *   Google Sans Flex 在 Google Fonts 的官方名为单段字符串，需带引号避免
 *   包含空格被误解析；其他三档名称无空格可省略引号但统一加引号保持稳定
 */
export interface CardFontOption {
  id: CardFont;
  label: string;
  description: string;
  sampleText: string;
  fontFamily: string;
}

export const CARD_FONT_OPTIONS: ReadonlyArray<CardFontOption> = [
  {
    id: "inter",
    label: "现代简约",
    description: "Inter Display ExtraBold，笔触硬朗、信息密度高。",
    sampleText: "vocabulary",
    fontFamily: '"Inter", "Inter Display", system-ui, sans-serif',
  },
  {
    id: "google-sans",
    label: "现代圆润",
    description: "Google Sans Flex，柔性字怀、几何感。",
    sampleText: "vocabulary",
    fontFamily: '"Google Sans Flex", system-ui, sans-serif',
  },
  {
    id: "playpen",
    label: "手写温润",
    description: "Playpen Sans SemiBold，笔画柔和。",
    sampleText: "vocabulary",
    fontFamily: '"Playpen Sans", "Comic Sans MS", cursive',
  },
  {
    id: "newsreader",
    label: "优雅衬线",
    description: "Newsreader SemiBold，衬线端正、阅读稳重。",
    sampleText: "vocabulary",
    fontFamily: '"Newsreader", Georgia, "Times New Roman", serif',
  },
];
