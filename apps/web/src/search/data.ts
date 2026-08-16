/**
 * 搜词数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - search：searchLexilexiSenses（senses 表全量读入内存后按拼写 + 释义
 *   过滤排序，只读、离线、不上报；命中顺序由 core 决定）；
 * - hasAnySenses：senses 表计数（空状态判定）。
 *
 * 检索数据量口径与复习选择题混淆项加载一致（词库规模数千条，单次全量
 * 可接受），见 packages/core/src/search.ts 的说明。
 */
import { openDatabase, searchLexilexiSenses } from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import type { SearchDataProvider, SearchResult } from "./types";

/** 基于已打开的 Lexilexi 数据库创建搜词数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbSearchDataProvider(db: LexilexiDatabase): SearchDataProvider {
  return {
    async search(query: string): Promise<SearchResult[]> {
      const hits = await searchLexilexiSenses(db, query);
      return hits.map((hit) => ({ sense: hit.sense, kind: hit.kind }));
    },

    async hasAnySenses(): Promise<boolean> {
      return (await db.senses.count()) > 0;
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 mock / fake-indexeddb 实例绕过。
 */
export function createDefaultSearchDataProvider(): SearchDataProvider {
  return createIndexedDbSearchDataProvider(openDatabase());
}
