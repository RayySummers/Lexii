/**
 * 搜词历史（RAY-292 搜词体验改进）。
 *
 * 产品口径（Jack 裁定）：
 * - 历史只存本地（localStorage），不上传、不埋点——隐私红线；
 * - 不触碰 IndexedDB：历史不走词库数据库，绝不干扰数据迁移路径；
 * - 何时记录由调用方决定：搜词页只记录「有命中的检索」（RAY-292 评审
 *   sug 2），零命中（拼写错误 / 未收录）查询不进历史、不积攒噪音词；
 *   输入中途的字符（防抖前）更不记录。
 *
 * 存储格式：JSON 字符串数组，最新在前；大小写不敏感去重（保留最近一次
 * 输入的大小写形态）；条目上限 SEARCH_HISTORY_LIMIT，超出丢弃最旧。
 * 解析失败 / 存储不可用（隐私模式等）一律按「无历史」处理，绝不抛错、
 * 绝不阻塞检索（与 useTheme / dailyNewCardLimit 同一持久化口径）。
 */

/** localStorage 键（沿用 lexilexi:* 命名空间） */
export const SEARCH_HISTORY_STORAGE_KEY = "lexilexi:search-history";

/** 历史条目上限（超出丢弃最旧） */
export const SEARCH_HISTORY_LIMIT = 20;

/** 单条历史的最大长度（与 core 检索词长度上限对齐，防御超长输入） */
export const SEARCH_HISTORY_TERM_MAX_LENGTH = 100;

/** localStorage 的最小读取接口（组件与测试注入用） */
export interface SearchHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 规范化单条历史：trim + 截断到上限；空白结果 → null（不记录） */
function normalizeTerm(term: string): string | null {
  const trimmed = term.trim().slice(0, SEARCH_HISTORY_TERM_MAX_LENGTH);
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * 解析存储原文 → 历史数组（纯函数，供测试与读写复用）：
 * - 非法 JSON / 非字符串数组 → 空数组；
 * - 逐条 trim、丢弃空白、截断超长；
 * - 大小写不敏感去重（保留最先出现的形态，即存储中最新的形态）。
 */
export function parseSearchHistory(raw: string | null): string[] {
  if (raw === null || raw === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const seen = new Set<string>();
  const history: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") {
      continue;
    }
    const term = normalizeTerm(item);
    if (term === null) {
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    history.push(term);
  }
  return history.slice(0, SEARCH_HISTORY_LIMIT);
}

/** 读取历史（存储不可用 / 损坏时回落空数组，不抛错） */
export function loadSearchHistory(storage: SearchHistoryStorage | null): string[] {
  if (storage === null) {
    return [];
  }
  try {
    return parseSearchHistory(storage.getItem(SEARCH_HISTORY_STORAGE_KEY));
  } catch {
    // 隐私模式等场景下 localStorage 不可用，视为无历史
    return [];
  }
}

/** 序列化并写入（写失败静默：内存态照常返回，持久化失败不影响本次会话） */
function persistSearchHistory(storage: SearchHistoryStorage | null, history: string[]): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // quota / 隐私模式：本次会话内存态可用即可
  }
}

/**
 * 记录一次检索词，返回最新历史（最新在前）：
 * - 空白 / 仅空白 → 原样返回，不记录；
 * - 已存在（大小写不敏感）→ 移到最前，保留最近一次输入的形态；
 * - 超出上限 → 丢弃最旧条目。
 */
export function recordSearchHistory(storage: SearchHistoryStorage | null, term: string): string[] {
  const current = loadSearchHistory(storage);
  const normalized = normalizeTerm(term);
  if (normalized === null) {
    return current;
  }
  const key = normalized.toLowerCase();
  const rest = current.filter((item) => item.toLowerCase() !== key);
  const next = [normalized, ...rest].slice(0, SEARCH_HISTORY_LIMIT);
  persistSearchHistory(storage, next);
  return next;
}

/**
 * 删除一条历史（大小写不敏感匹配），返回最新历史；
 * 匹配不到时原样返回（不写存储）。
 */
export function removeSearchHistory(storage: SearchHistoryStorage | null, term: string): string[] {
  const current = loadSearchHistory(storage);
  const key = term.trim().toLowerCase();
  if (key.length === 0) {
    return current;
  }
  const next = current.filter((item) => item.toLowerCase() !== key);
  if (next.length === current.length) {
    return current;
  }
  persistSearchHistory(storage, next);
  return next;
}
