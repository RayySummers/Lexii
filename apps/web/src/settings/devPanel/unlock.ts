/**
 * 开发者面板解锁逻辑（RAY-297 任务 B，触发方式）。
 *
 * 设置页底部版本号连续点击 N 次解锁「开发者」分组，再次连点 N 次折叠隐藏；
 * 解锁状态存 localStorage（刷新不丢、卸载即清）。计数与开关逻辑抽为纯函数
 * 供测试，读写层与其余设置项（每日新卡上限 / 主题等）同一 localStorage 模式。
 */

/** 解锁所需的连续点击数（彩蛋口径 N=5） */
export const DEV_PANEL_UNLOCK_TAPS = 5;

export const DEV_PANEL_UNLOCK_STORAGE_KEY = "lexilexi:dev-panel-unlocked";

/** 连点状态：是否已解锁 + 当前连续点击数（未到阈值时累计） */
export interface DevPanelTapState {
  unlocked: boolean;
  taps: number;
}

/**
 * 连点一步的状态转移（纯函数）：
 * - 未到 N 次：仅累计计数，解锁状态不变；
 * - 达到 N 次：翻转解锁状态并清零计数（解锁 ⇄ 折叠对称）。
 */
export function nextTapState(state: DevPanelTapState): DevPanelTapState {
  const taps = state.taps + 1;
  if (taps >= DEV_PANEL_UNLOCK_TAPS) {
    return { unlocked: !state.unlocked, taps: 0 };
  }
  return { unlocked: state.unlocked, taps };
}

/** 解析存储值 → 布尔（仅 "1" 为 true，其余一律 false，损坏绝不误解锁） */
export function parseDevPanelUnlocked(raw: string | null | undefined): boolean {
  return raw === "1";
}

/** 读取解锁状态（localStorage 不可用时视为未解锁） */
export function readDevPanelUnlocked(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return parseDevPanelUnlocked(window.localStorage.getItem(DEV_PANEL_UNLOCK_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** 写入解锁状态（localStorage 不可用时返回 false，不抛错） */
export function writeDevPanelUnlocked(unlocked: boolean): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(DEV_PANEL_UNLOCK_STORAGE_KEY, unlocked ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}
