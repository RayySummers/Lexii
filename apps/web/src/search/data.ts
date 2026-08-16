/**
 * 搜词数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - search：searchAllSenses（senses + dictionarySenses 跨层合并检索，
 *   term 去重、学习义项优先、全局排序；RAY-294 升级路径）；
 * - hasAnySenses：senses + dictionarySenses 双表计数（空状态判定）；
 * - getNotebookSenseIds / addToNotebook：生词本加词入口（RAY-284）——
 *   加词幂等判定与落库走 core 的 addToNotebook（notebook/data.ts 的
 *   addWordToNotebook helper）。
 *
 * 检索数据量口径与复习选择题混淆项加载一致（词库规模数千条，单次全量
 * 可接受），见 packages/core/src/search.ts 的说明。
 */
import { getActiveNotebookItemIds, openDatabase, searchAllSenses } from "@lexilexi/core";
import type { LexilexiDatabase, SenseId } from "@lexilexi/core";
import { addWordToNotebook } from "../notebook/data";
import type { AddToNotebookResult } from "../notebook/types";
import type { SearchDataProvider, SearchResult } from "./types";

/** 基于已打开的 Lexilexi 数据库创建搜词数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbSearchDataProvider(db: LexilexiDatabase): SearchDataProvider {
  return {
    async search(query: string): Promise<SearchResult[]> {
      const hits = await searchAllSenses(db, query);
      return hits.map((hit) => ({ sense: hit.sense, kind: hit.kind, source: hit.source }));
    },

    async hasAnySenses(): Promise<boolean> {
      const learningCount = await db.senses.count();
      if (learningCount > 0) return true;
      const dictCount = await db.dictionarySenses.count();
      return dictCount > 0;
    },

    async getNotebookSenseIds(): Promise<readonly SenseId[]> {
      // 生词本条目 itemId → items → senseId（生词本条目复用词库义项，
      // 结果行按义项标记「已在生词本」）
      const itemIds = await getActiveNotebookItemIds(db);
      if (itemIds.length === 0) {
        return [];
      }
      const items = await db.items.bulkGet(itemIds);
      const senseIds = items
        .filter((item): item is NonNullable<typeof item> => item !== undefined)
        .map((item) => item.senseId);
      return senseIds;
    },

    async addToNotebook(senseId: SenseId): Promise<AddToNotebookResult> {
      // 搜词页加词入口（RAY-284）：幂等加词，生词进入现有 FSRS 调度
      return addWordToNotebook(db, senseId);
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
