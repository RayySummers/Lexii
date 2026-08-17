/**
 * 搜词页的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `SearchResult`：一条检索命中（义项 + 命中类型），供结果列表展示
 * - `SearchDataProvider`：数据源接口（测试注入 mock，浏览器注入 IndexedDB 实现）
 *
 * 检索口径（拼写 + 释义、离线、排序）由 @lexilexi/core 的
 * searchLexilexiSenses / searchSenses 实现，apps/web 不做任何检索算法。
 */
import type { Sense, SenseId, SenseSearchHitKind } from "@lexilexi/core";
import type { AddToNotebookResult } from "../notebook/types";

/** 一条搜索结果：义项 + 命中类型（命中类型供未来高亮等展示用，当前仅透传） */
export interface SearchResult {
  sense: Sense;
  kind: SenseSearchHitKind;
  /** 数据来源（"learning" = 学习表，"dictionary" = 扩展词典表） */
  source: "learning" | "dictionary";
}

/**
 * 搜词数据源。
 *
 * 职责边界：只做「本地词库检索 / 词库是否为空 / 生词本加词（RAY-284）」，
 * 全部经由 @lexilexi/core 的公开 API（searchLexilexiSenses /
 * addToNotebook），不在 apps/web 内实现任何检索算法或生词本语义。
 */
export interface SearchDataProvider {
  /**
   * 全本地检索（词条拼写 + 释义，大小写不敏感）。
   * 空白查询返回空数组；命中顺序由 core 决定（前缀 > 包含 > 释义）。
   */
  search(query: string): Promise<SearchResult[]>;
  /** 词库是否有任何义项（决定空状态：词库空 vs 无命中） */
  hasAnySenses(): Promise<boolean>;
  /**
   * 当前生词本（active 条目）覆盖的义项 id 列表（RAY-284）：
   * 结果行据此标记「已在生词本」，进入页面读一次。
   */
  getNotebookSenseIds(): Promise<readonly SenseId[]>;
  /**
   * 把义项加入生词本（RAY-284，搜词页加词入口）。
   * 幂等：同义项已在生词本时返回 "already"。
   */
  addToNotebook(senseId: SenseId): Promise<AddToNotebookResult>;
  /**
   * 把义项移出生词本（RAY-302，搜词页撤销加词入口）。
   * 通过 senseId 查找对应的 active 生词本条目并移出。
   */
  removeFromNotebookBySenseId(senseId: SenseId): Promise<void>;
}
