/**
 * 生词本数据源（IndexedDB 实现，RAY-284）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - loadEntries：listNotebookEntries（active、最新在前）→ senses.bulkGet
 *   （一次批量往返装配义项内容，不在循环里逐条查询）；
 * - removeWord：removeFromNotebook（条目标记 removed + 底层学习条目
 *   软删除 + delete-item 事件，单事务原子落库）。
 *
 * 加词入口（搜词页 / 复习卡页）分别由各自数据源调用 core 的
 * addToNotebook；本文件提供共用的幂等判定 helper（hasActiveEntryForSense）。
 */
import {
  addToNotebook,
  listNotebookEntries,
  openDatabase,
  removeFromNotebook,
} from "@lexilexi/core";
import type { LexilexiDatabase, NotebookEntryId, SenseId } from "@lexilexi/core";
import type { AddToNotebookResult, NotebookDataProvider, NotebookListItem } from "./types";

/**
 * 幂等加词（搜词页 / 复习卡页共用）：
 * 同义项的 active 生词本条目已存在 → "already"；否则创建并返回 "added"。
 * 存在性预查在 core 事务外，最终去重仍由 core 的 addToNotebook 事务保证
 * （并发窗口下不会产生重复条目）。
 */
export async function addWordToNotebook(
  db: LexilexiDatabase,
  senseId: SenseId,
): Promise<AddToNotebookResult> {
  const existing = await db.notebookEntries
    .where("senseId")
    .equals(senseId)
    .filter((entry) => entry.status === "active")
    .first();
  if (existing) {
    return "already";
  }
  await addToNotebook(db, { senseId });
  return "added";
}

/** 基于已打开的 Lexilexi 数据库创建生词本数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbNotebookDataProvider(db: LexilexiDatabase): NotebookDataProvider {
  return {
    async loadEntries(): Promise<NotebookListItem[]> {
      const entries = await listNotebookEntries(db);
      if (entries.length === 0) {
        return [];
      }
      const senses = await db.senses.bulkGet(entries.map((entry) => entry.senseId));
      const items: NotebookListItem[] = [];
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const sense = senses[i];
        if (entry && sense) {
          items.push({ entry, sense });
        }
      }
      return items;
    },

    async removeWord(entryId: NotebookEntryId): Promise<void> {
      await removeFromNotebook(db, { entryId });
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 mock / fake-indexeddb 实例绕过。
 */
export function createDefaultNotebookDataProvider(): NotebookDataProvider {
  return createIndexedDbNotebookDataProvider(openDatabase());
}
