/**
 * 「学习列表是否包含生词本」偏好（RAY-284）。
 *
 * 产品口径：生词本独立于词书——无论学什么词书，都可选择学习列表是否
 * 包含生词本。默认包含（加词即想学）；关闭后生词本条目从学习/复习/混合
 * 队列与到期统计中排除（词书条目不受影响），下次进入队列/刷新统计即生效。
 *
 * 存储走 localStorage（与主题、每日新卡上限等偏好同一持久化模式，
 * 见 useTheme / dailyNewCardLimit）；偏好不是学习数据，不随 JSON 备份
 * 导出。解析失败 / 存储不可用一律回落默认值（true），绝不阻塞学习。
 */

/** 偏好存储键 */
export const INCLUDE_NOTEBOOK_STORAGE_KEY = "lexii:include-notebook";

/** 默认值：学习列表包含生词本 */
export const DEFAULT_INCLUDE_NOTEBOOK = true;

/**
 * 解析存储值 → 合法偏好（纯函数，供测试与读写复用）：
 * "0" / "false" → false；"1" / "true" → true；其余（含缺失/损坏）→ 默认值。
 */
export function parseIncludeNotebook(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) {
    return DEFAULT_INCLUDE_NOTEBOOK;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "0" || trimmed === "false") {
    return false;
  }
  if (trimmed === "1" || trimmed === "true") {
    return true;
  }
  return DEFAULT_INCLUDE_NOTEBOOK;
}

/** 读取当前偏好（localStorage 不可用 / 损坏时回落默认值） */
export function readIncludeNotebook(): boolean {
  if (typeof window === "undefined") {
    return DEFAULT_INCLUDE_NOTEBOOK;
  }
  try {
    return parseIncludeNotebook(window.localStorage.getItem(INCLUDE_NOTEBOOK_STORAGE_KEY));
  } catch {
    // 隐私模式等场景下 localStorage 不可用，视为默认
    return DEFAULT_INCLUDE_NOTEBOOK;
  }
}

/** 写入偏好（localStorage 不可用时返回 false，不抛错） */
export function writeIncludeNotebook(value: boolean): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(INCLUDE_NOTEBOOK_STORAGE_KEY, value ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}
