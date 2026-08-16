/**
 * Feature flags（RAY-297 任务 B）：localStorage 持久化的布尔开关登记表，
 * 为下一期候选方向做 A/B 准备。
 *
 * 口径（对评审标准的自觉约束）：
 * - 当前版本所有 flag 均未接入任何功能逻辑——本模块只提供登记表、读写与
 *   校验，行为开关留待对应候选方向落地时接线；
 * - 存储只落本机 localStorage，不发起任何网络请求、不埋点上报；
 * - 未知 flag 的存量值原样保留（不丢用户数据），读取结果 = 默认值 ∪ 存量值。
 */

export const FEATURE_FLAGS_STORAGE_KEY = "lexilexi:feature-flags";

/** 单个 flag 的登记项 */
export interface FeatureFlagDefinition {
  /** 稳定标识（localStorage 键） */
  id: string;
  /** 面向用户的名称 */
  name: string;
  /** 候选方向说明（明确标注「尚未接入功能逻辑」） */
  description: string;
  /** 默认值（全部 false：候选方向一律默认关闭） */
  defaultValue: boolean;
}

/** flag 登记表（下一期候选方向，来自 ROADMAP；新增 flag 在此登记） */
export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: "dictation",
    name: "听写练习形式",
    description:
      "下一期候选：Recall / Production 之外的听写练习。当前仅为开关预留，尚未接入任何功能逻辑。",
    defaultValue: false,
  },
  {
    id: "evidence-model",
    name: "Evidence model 评分",
    description:
      "下一期候选：lexilexi_eval 证据模型参与复习评分。当前仅为开关预留，尚未接入任何功能逻辑。",
    defaultValue: false,
  },
  {
    id: "confusable-model",
    name: "易混词建模",
    description: "下一期候选：易混词与多义词认知建模。当前仅为开关预留，尚未接入任何功能逻辑。",
    defaultValue: false,
  },
];

/** 解析存储值 → 全部 flag 的开关表（默认值 ∪ 存量值；存量值优先） */
export function parseFeatureFlags(raw: string | null | undefined): Record<string, boolean> {
  const merged = Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag.id, flag.defaultValue]));
  if (!raw) {
    return merged;
  }
  try {
    const stored = JSON.parse(raw) as unknown;
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      return merged;
    }
    for (const flag of FEATURE_FLAGS) {
      const value = (stored as Record<string, unknown>)[flag.id];
      if (typeof value === "boolean") {
        merged[flag.id] = value;
      }
    }
    return merged;
  } catch {
    // 损坏的 JSON 不阻塞使用，回退默认值
    return merged;
  }
}

/** 读取全部 flag 开关（localStorage 不可用时回退默认值） */
export function readFeatureFlags(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return parseFeatureFlags(undefined);
  }
  try {
    return parseFeatureFlags(window.localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY));
  } catch {
    return parseFeatureFlags(undefined);
  }
}

/** 写入单个 flag（保留其余 flag 的存量值；localStorage 不可用时返回 false） */
export function writeFeatureFlag(id: string, value: boolean): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const next = readFeatureFlags();
    next[id] = value;
    window.localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** 查询单个 flag 是否开启（未登记的 flag 一律 false） */
export function isFeatureFlagEnabled(id: string): boolean {
  return readFeatureFlags()[id] === true;
}
