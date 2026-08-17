/**
 * 本地词条检索（RAY-266 搜词）。
 *
 * 口径（Jack 拍板，见 RAY-266）：
 * - 全本地检索：在本地词库（senses 表）内按拼写 + 释义检索；
 * - 离线、不新增数据源：不请求网络、不引入新数据包，只在用户已有数据内查找；
 * - 隐私红线：检索全程在本机内存/IndexedDB 完成，不上报任何数据。
 *
 * 匹配与排序（searchSenses 纯函数）：
 * - 命中范围：词条拼写（大小写不敏感子串，前缀命中优先）+ 释义（任一义项子串）；
 * - 一个义项只保留最高优先级命中类型，结果不重复（按 sense.id 去重）；
 * - 排序：命中类型升序（前缀 > 包含 > 释义）→ 词条长度升序（短词优先）→
 *   词条字典序（稳定决胜，ISO 语义下确定性可复现）。
 *
 * 检索数据量：词库规模数千条（与复习选择题混淆项加载同量级），单次全量
 * 读入内存过滤可接受；未来词库显著增大再评估索引 / 虚拟化（评审 C11）。
 */
import type { Sense } from "./domain";
import type { LexiiDatabase } from "./persistence";
import { searchDictionarySenses } from "./dictionary";

/** 命中类型：词条前缀 > 词条包含 > 释义包含（优先级从高到低） */
export type SenseSearchHitKind = "term-prefix" | "term-substring" | "definition";

/** 一条检索命中：义项 + 命中类型（同一义项至多出现一次，取最高优先级类型） */
export interface SenseSearchHit {
  sense: Sense;
  kind: SenseSearchHitKind;
  /** 数据来源（"learning" = senses 学习表，"dictionary" = dictionarySenses 词典表） */
  source: "learning" | "dictionary";
}

/** 检索选项 */
export interface SenseSearchOptions {
  /** 结果上限（默认 DEFAULT_SEARCH_LIMIT；≤ 0 视为不限制） */
  limit?: number;
}

/** 默认结果上限 */
export const DEFAULT_SEARCH_LIMIT = 50;

/** 检索词长度上限（防御脏输入；超长截断而非报错） */
const MAX_QUERY_LENGTH = 100;

/** 命中类型 → 排序权重（越小越靠前） */
const HIT_KIND_RANK: Record<SenseSearchHitKind, number> = {
  "term-prefix": 0,
  "term-substring": 1,
  definition: 2,
};

/**
 * 在义项集合内检索（纯函数）。
 *
 * - 空白查询（trim 后为空）返回空结果；
 * - 查询大小写不敏感（拼写与释义均按小写比较）；
 * - 释义命中 = 任一义项包含查询串（中文义项按子串匹配）。
 */
export function searchSenses(
  senses: readonly Sense[],
  query: string,
  options: SenseSearchOptions = {},
): SenseSearchHit[] {
  const q = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  if (q.length === 0) {
    return [];
  }
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const seen = new Set<string>();
  const hits: SenseSearchHit[] = [];
  for (const sense of senses) {
    if (seen.has(sense.id)) {
      continue; // 防御重复输入：同一义项至多命中一次
    }
    const term = sense.term.toLowerCase();
    let kind: SenseSearchHitKind | null = null;
    if (term.startsWith(q)) {
      kind = "term-prefix";
    } else if (term.includes(q)) {
      kind = "term-substring";
    } else if (sense.definitions.some((definition) => definition.toLowerCase().includes(q))) {
      kind = "definition";
    }
    if (kind !== null) {
      seen.add(sense.id);
      hits.push({ sense, kind, source: "learning" });
    }
  }
  hits.sort(compareHits);
  return limit > 0 ? hits.slice(0, limit) : hits;
}

/**
 * 检索本地词库（senses 表全量读入内存后过滤）。
 *
 * 只读操作，不修改任何数据；检索逻辑全部委托 searchSenses，
 * 便于测试直接以纯函数验证排序与命中口径。
 */
export async function searchLexiiSenses(
  db: LexiiDatabase,
  query: string,
  options: SenseSearchOptions = {},
): Promise<SenseSearchHit[]> {
  const senses = await db.senses.toArray();
  return searchSenses(senses, query, options);
}

/** 命中排序比较：类型升序 → 词条长度升序 → 词条字典序（确定性） */
function compareHits(a: SenseSearchHit, b: SenseSearchHit): number {
  const byKind = HIT_KIND_RANK[a.kind] - HIT_KIND_RANK[b.kind];
  if (byKind !== 0) {
    return byKind;
  }
  const byLength = a.sense.term.length - b.sense.term.length;
  if (byLength !== 0) {
    return byLength;
  }
  return a.sense.term.localeCompare(b.sense.term);
}

/**
 * 全局合并检索 senses + dictionarySenses（RAY-294）。
 *
 * 去重规则：
 * - 层内（senses 或 dictionarySenses 各自内部）：按 sense.id 去重
 *   （RAY-266 口径，searchSenses 已处理）；
 * - 跨层（dictionarySenses ↔ senses）：按 term（大小写不敏感）去重、
 *   学习义项优先（senses 表晋升后副本的 id 与 dictionarySenses 不同，
 *   但 term 相同，保留学习版本）。
 *
 * 两层完整取回 → 同一比较器全局排序 → 截断 DEFAULT_SEARCH_LIMIT。
 */
export async function searchAllSenses(
  db: LexiiDatabase,
  query: string,
  options: SenseSearchOptions = {},
): Promise<SenseSearchHit[]> {
  const q = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  if (q.length === 0) return [];
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  // 两层并行取回（学习表通常很小，词典表可能很大）
  const [learningHits, dictHits] = await Promise.all([
    searchLexiiSenses(db, q, { limit: 0 }), // 不截断，取全部命中
    searchDictionarySenses(db, q, { limit: 0 }),
  ]);

  // learningHits 已按 sense.id 去重（searchSenses 口径），同 term 多义项
  // 保留各自（RAY-266：层内按 sense.id 去重，各显一条）。
  // 仅用学习层的 term 集合过滤词典层命中（跨层按 term 去重，学习优先）。
  const learningTerms = new Set(learningHits.map((h) => h.sense.term.toLowerCase()));
  const result: SenseSearchHit[] = [...learningHits];
  for (const hit of dictHits) {
    if (!learningTerms.has(hit.sense.term.toLowerCase())) {
      result.push({ sense: hit.sense, kind: hit.kind, source: "dictionary" });
    }
    // 学习层已有同 term → 跳过词典义项（学习义项优先）
  }

  // 全局排序 → 截断
  result.sort(compareHits);
  return limit > 0 ? result.slice(0, limit) : result;
}
