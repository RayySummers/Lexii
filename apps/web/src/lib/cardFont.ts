/**
 * 「卡片字体」偏好（RAY-323，RAY-359）。
 *
 * 产品口径：用户在设置里为复习卡片上的单词本体（sense.term）选择
 * 一种字体，共 4 档：现代简约（Inter Display ExtraBold）、现代圆润
 * （Google Sans Flex）、手写温润（Playpen Sans SemiBold）、优雅衬线
 * （Sentient Medium，RAY-359 由 Newsreader SemiBold 替换而来，见
 *  public/fonts/sentient.css 与 Fontshare 授权）。选择立即应用到当前与未来所有卡片。
 *
 * 存储走 localStorage（与主题、发音口音、生词本开关等偏好同一持久化
 * 模式）。4 种字体通过 index.html 引入的字体样式表在首帧渲染前到达——
 * 其中 inter 档主字体 Inter Display ExtraBold 自托管（public/fonts/，
 * RAY-338 A1），优雅衬线档 Sentient Medium 自托管（public/fonts/sentient.css，
 * RAY-359），其余两档走 Google Fonts <link>；CSS 端通过
 * <html data-card-font="..."> 切换到对应的 font-family（见
 * styles/tokens.css），卡片本体用 var(--lex-card-font) 应用字体，
 * 组件层不感知具体字体名。
 *
 * 偏好不是学习数据，不随 JSON 备份导出。解析失败 / 存储不可用一律
 * 回落默认值（inter，现代简约），绝不阻塞复习。
 */

/** 4 种卡片字体档位（按 settings 卡片展示顺序） */
export type CardFont = "inter" | "google-sans" | "playpen" | "sentient";

/** 偏好存储键 */
export const CARD_FONT_STORAGE_KEY = "lexii:card-font";

/** 默认档位：现代简约（Inter Display ExtraBold） */
export const DEFAULT_CARD_FONT: CardFont = "inter";

/** 判断 localStorage 原始值是否为合法档位 */
export function isCardFont(value: string | null | undefined): value is CardFont {
  return (
    value === "inter" || value === "google-sans" || value === "playpen" || value === "sentient"
  );
}

/**
 * 解析存储值 → 合法档位（纯函数，供测试与读写复用）：
 * 缺失 / 非法 / 损坏一律回落默认 modern（inter）。
 * RAY-359 迁移：旧存量 "newsreader"（Newsreader SemiBold）平滑映射到
 * "sentient"（Sentient Medium），避免已选优雅衬线的用户回落默认。
 */
export function parseCardFont(raw: string | null | undefined): CardFont {
  if (raw === null || raw === undefined) {
    return DEFAULT_CARD_FONT;
  }
  const trimmed = raw.trim();
  if (trimmed === "newsreader") {
    return "sentient";
  }
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
 *   包含空格被误解析；其他档名称无空格可省略引号但统一加引号保持稳定。
 *   RAY-338 A1：inter 档栈首为自托管 Inter Display（ExtraBold，见
 *   public/fonts/inter-display.css；Google Fonts 无 Inter Display，仅提供
 *   文本切 Inter），其后 Inter 为 Google Fonts 加载的回退。
 * - `fontWeight`：该档的字重，与加载源字重严格一致（Oscar 评审
 *   suggestion 2）：inter 800（ExtraBold 自托管 Inter Display）/
 *   sentient 500（Medium 自托管 Sentient，RAY-359）/ 其余 600（Google
 *   Fonts SemiBold）——不加载的字重会被浏览器合成，导致字面失真；
 *   tokens.css 的 --lex-card-font-weight 与本字段按同一口径取值
 */
export interface CardFontOption {
  id: CardFont;
  label: string;
  description: string;
  sampleText: string;
  fontFamily: string;
  fontWeight: number;
}

export const CARD_FONT_OPTIONS: ReadonlyArray<CardFontOption> = [
  {
    id: "inter",
    label: "现代简约",
    description: "笔触硬朗、信息密度高。",
    sampleText: "vocabulary",
    fontFamily: '"Inter Display", "Inter", system-ui, sans-serif',
    fontWeight: 800,
  },
  {
    id: "google-sans",
    label: "现代圆润",
    description: "柔性字形、几何感。",
    sampleText: "vocabulary",
    fontFamily: '"Google Sans Flex", system-ui, sans-serif',
    fontWeight: 600,
  },
  {
    id: "playpen",
    label: "手写温润",
    description: "笔画柔和。",
    sampleText: "vocabulary",
    fontFamily: '"Playpen Sans", "Comic Sans MS", cursive',
    fontWeight: 600,
  },
  {
    id: "sentient",
    label: "优雅衬线",
    description: "衬线端正、阅读稳重。",
    sampleText: "vocabulary",
    fontFamily: '"Sentient", Georgia, "Times New Roman", serif',
    fontWeight: 500,
  },
];
