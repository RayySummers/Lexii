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
import type { Sense, SenseSearchHitKind } from "@lexilexi/core";

/** 一条搜索结果：义项 + 命中类型（命中类型供未来高亮等展示用，当前仅透传） */
export interface SearchResult {
  sense: Sense;
  kind: SenseSearchHitKind;
}

/**
 * 搜词数据源。
 *
 * 职责边界：只做「本地词库检索 / 词库是否为空」，全部经由 @lexilexi/core
 * 的公开 API（searchLexilexiSenses），不在 apps/web 内实现任何检索算法。
 */
export interface SearchDataProvider {
  /**
   * 全本地检索（词条拼写 + 释义，大小写不敏感）。
   * 空白查询返回空数组；命中顺序由 core 决定（前缀 > 包含 > 释义）。
   */
  search(query: string): Promise<SearchResult[]>;
  /** 词库是否有任何义项（决定空状态：词库空 vs 无命中） */
  hasAnySenses(): Promise<boolean>;
}
