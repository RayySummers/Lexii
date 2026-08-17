/**
 * 「首次打开弹窗」已读标记（RAY-282，local-first 说明 + 备份建议）。
 *
 * 产品口径（Jack 2026-08-16 裁定）：弹窗只在首次打开出现、之后不再重复。
 * 标记持久化到 localStorage（与主题、发音口音等设置同一持久化模式）。
 *
 * 容错口径：
 * - 读取失败（隐私模式等 localStorage 不可用）→ 视为已看过、不弹窗：
 *   无法持久化时每次打开都弹窗更打扰；且同一口径的说明在设置页
 *   「导出数据」区始终可见，数据逃生门不因弹窗缺失而失守。
 * - 写入失败 → 静默忽略：本次会话内 React 状态已负责隐藏弹窗，
 *   不重复打扰用户。
 */

/** localStorage 键（沿用 lexii:* 命名空间） */
export const FIRST_OPEN_DIALOG_STORAGE_KEY = "lexii:first-open-dismissed";

/** 已读标记的存储值（存在即视为已看过，值内容不作强校验） */
export const FIRST_OPEN_DIALOG_DISMISSED_VALUE = "1";

/** 本次打开是否需要展示首次弹窗（true = 展示；标记存在即不再展示） */
export function shouldShowFirstOpenDialog(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(FIRST_OPEN_DIALOG_STORAGE_KEY) === null;
  } catch {
    // 隐私模式等场景下 localStorage 不可用，无法持久化 → 不弹窗（见文件头口径）
    return false;
  }
}

/** 写入已读标记；持久化失败静默忽略（会话内状态已隐藏弹窗） */
export function markFirstOpenDialogDismissed(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(FIRST_OPEN_DIALOG_STORAGE_KEY, FIRST_OPEN_DIALOG_DISMISSED_VALUE);
  } catch {
    // 忽略：隐私模式等场景下持久化不可用，本次会话不再重复展示即可
  }
}
