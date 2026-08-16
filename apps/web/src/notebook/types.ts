/**
 * 生词本页面的数据契约（apps/web 内部，RAY-284）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `NotebookListItem`：生词本列表项（条目 + 义项内容）
 * - `AddToNotebookResult`：加词结果（added = 本次新建；already = 已在
 *   生词本，幂等返回既有条目）——搜词页 / 复习卡页的加词入口共用
 * - `NotebookDataProvider`：生词本页数据源（测试注入 mock，
 *   浏览器注入 IndexedDB 实现）
 *
 * 全部数据操作经由 @lexilexi/core 的公开 API（addToNotebook /
 * listNotebookEntries / removeFromNotebook），不在 apps/web 内实现任何
 * 生词本语义。
 */
import type { NotebookEntry, NotebookEntryId, Sense } from "@lexilexi/core";

/** 生词本列表项：条目记录 + 义项内容（展示释义/音标） */
export interface NotebookListItem {
  entry: NotebookEntry;
  sense: Sense;
}

/** 加词结果（搜词页与复习卡页共用同一口径） */
export type AddToNotebookResult = "added" | "already";

/** 生词本页数据源 */
export interface NotebookDataProvider {
  /** 列出当前生词本条目（仅 active，最新加入在前，含义项内容） */
  loadEntries(): Promise<NotebookListItem[]>;
  /** 移出生词本（底层学习条目软删除，不可逆；重复移出报错） */
  removeWord(entryId: NotebookEntryId): Promise<void>;
}
