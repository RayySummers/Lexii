/**
 * 「评分档位」设置（RAY-265）。
 *
 * 产品口径（Jack 拍板）：
 * - 默认三档：认识 / 模糊 / 不认识 → FSRS 评级 Good / Hard / Again（去掉 Easy）；
 * - 设置内可切回四档（Anki 传统：Again / Hard / Good / Easy）。
 *
 * 存储走 localStorage（与主题 / 每日新卡上限同一持久化模式）。
 * 解析失败 / 非法值一律回落到默认三档——设置损坏绝不阻塞复习。
 * 档位只影响 UI 提供的按钮与键盘映射；FSRS 算法核心不变。
 */
export type RatingTierMode = "three" | "four";

export const RATING_TIER_STORAGE_KEY = "lexii:rating-tiers";

/** 默认档位：三档（认识 / 模糊 / 不认识） */
export const DEFAULT_RATING_TIER_MODE: RatingTierMode = "three";

/** 判断 localStorage 原始值是否为合法档位 */
export function isRatingTierMode(value: string | null): value is RatingTierMode {
  return value === "three" || value === "four";
}

/** 解析存储值 → 合法档位（缺失 / 非法回落默认三档） */
export function parseRatingTierMode(raw: string | null | undefined): RatingTierMode {
  const value = raw ?? null;
  return isRatingTierMode(value) ? value : DEFAULT_RATING_TIER_MODE;
}

/** 读取当前档位设置（localStorage 不可用 / 损坏时回落默认值） */
export function readRatingTierMode(): RatingTierMode {
  if (typeof window === "undefined") {
    return DEFAULT_RATING_TIER_MODE;
  }
  try {
    return parseRatingTierMode(window.localStorage.getItem(RATING_TIER_STORAGE_KEY));
  } catch {
    return DEFAULT_RATING_TIER_MODE;
  }
}

/** 写入档位设置（值必须合法；localStorage 不可用时返回 false，不抛错） */
export function writeRatingTierMode(mode: RatingTierMode): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(RATING_TIER_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
