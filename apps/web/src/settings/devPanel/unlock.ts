/**
 * 开发者面板解锁逻辑（RAY-297 任务 B，触发方式）。
 *
 * 设置页底部版本号连续点击 N 次解锁「开发者」分组，再次连点 N 次折叠隐藏；
 * 解锁状态存 localStorage（刷新不丢、卸载即清）。计数与开关逻辑抽为纯函数
 * 供测试，读写层与其余设置项（每日新卡上限 / 主题等）同一 localStorage 模式。
 *
 * 连点时间窗（RAY-297 Oscar 评审 nit 2）：两次点击间隔超过
 * DEV_PANEL_TAP_WINDOW_MS 视为新的连点序列，计数从头开始——贴合彩蛋惯例，
 * 避免「隔天补点几下」意外解锁。时间戳由调用方传入（组件传 Date.now()，
 * 测试传固定值），转移函数保持纯函数。
 */

/** 解锁所需的连续点击数（彩蛋口径 N=5） */
export const DEV_PANEL_UNLOCK_TAPS = 5;

/** 连点时间窗（毫秒）：超过该间隔的两次点击视为新的连点序列 */
export const DEV_PANEL_TAP_WINDOW_MS = 3_000;

export const DEV_PANEL_UNLOCK_STORAGE_KEY = "lexii:dev-panel-unlocked";

/** 连点状态：是否已解锁 + 当前连续点击数 + 最近一次点击时间戳 */
export interface DevPanelTapState {
  unlocked: boolean;
  taps: number;
  /** 最近一次点击时间戳（毫秒）；初始 0（任何首击都视为序列起点） */
  lastTapAt: number;
}

/**
 * 连点一步的状态转移（纯函数，RAY-297 Oscar 评审 nit 2）：
 * - 距上次点击超过时间窗：计数重置为 1（新序列起点）；
 * - 未到 N 次：仅累计计数，解锁状态不变；
 * - 达到 N 次：翻转解锁状态并清零计数（解锁 ⇄ 折叠对称）。
 */
export function nextTapState(state: DevPanelTapState, now: number): DevPanelTapState {
  const withinWindow = state.taps === 0 || now - state.lastTapAt <= DEV_PANEL_TAP_WINDOW_MS;
  const taps = withinWindow ? state.taps + 1 : 1;
  if (taps >= DEV_PANEL_UNLOCK_TAPS) {
    return { unlocked: !state.unlocked, taps: 0, lastTapAt: now };
  }
  return { unlocked: state.unlocked, taps, lastTapAt: now };
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
