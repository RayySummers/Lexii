/**
 * 「每日新卡上限」设置（RAY-260 评审 suggestion 2 的「每日新卡上限」部分）。
 *
 * 产品口径：默认 20/日、设置页可调；存储走 localStorage（与主题设置同一
 * 持久化模式，见 useTheme）。解析失败 / 越界一律回落到默认值——设置损坏
 * 绝不阻塞复习队列。
 *
 * 设置值只影响「新卡」的数量上限：学习/混合队列中当日可引入的新词数。
 * 已学过的复习卡不受任何限制（复习不能欠账）。
 */
export const DAILY_NEW_CARD_LIMIT_STORAGE_KEY = "lexii:daily-new-card-limit";

/** 默认每日新卡上限（RAY-260 口径） */
export const DEFAULT_DAILY_NEW_CARD_LIMIT = 20;

/** 允许的取值区间（含边界） */
export const DAILY_NEW_CARD_LIMIT_MIN = 1;
export const DAILY_NEW_CARD_LIMIT_MAX = 999;

/**
 * 解析存储值 → 合法上限（纯函数，供测试与读写复用）：
 * - 非整数 / 越界 / 缺失 → 回落默认值；
 * - 数字字符串（如 "50"、" 50 "）→ 解析并夹取到 [MIN, MAX]。
 */
export function parseDailyNewCardLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) {
    return DEFAULT_DAILY_NEW_CARD_LIMIT;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return DEFAULT_DAILY_NEW_CARD_LIMIT;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value)) {
    return DEFAULT_DAILY_NEW_CARD_LIMIT;
  }
  return Math.min(DAILY_NEW_CARD_LIMIT_MAX, Math.max(DAILY_NEW_CARD_LIMIT_MIN, value));
}

/** 读取当前设置（localStorage 不可用 / 损坏时回落默认值） */
export function readDailyNewCardLimit(): number {
  if (typeof window === "undefined") {
    return DEFAULT_DAILY_NEW_CARD_LIMIT;
  }
  try {
    return parseDailyNewCardLimit(window.localStorage.getItem(DAILY_NEW_CARD_LIMIT_STORAGE_KEY));
  } catch {
    // 隐私模式等场景下 localStorage 不可用，视为未设置
    return DEFAULT_DAILY_NEW_CARD_LIMIT;
  }
}

/** 写入设置（值必须已在 [MIN, MAX]；localStorage 不可用时返回 false，不抛错） */
export function writeDailyNewCardLimit(value: number): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(DAILY_NEW_CARD_LIMIT_STORAGE_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

/** 严格校验：整数且在 [MIN, MAX] 内（设置页输入框逐字校验用） */
export function isValidDailyNewCardLimit(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= DAILY_NEW_CARD_LIMIT_MIN &&
    value <= DAILY_NEW_CARD_LIMIT_MAX
  );
}
