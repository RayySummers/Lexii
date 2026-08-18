/**
 * 自定义单词列表（apps/web 内部，RAY-325）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `CustomListsDataProvider`：列表管理页与详情页的数据源
 * - `CustomListSummaryItem`：列表卡片（带 entryCount + latestAddedAt）
 * - `CustomListDetailItem`：详情页词条（条目 + 义项内容）
 * - `AddToListsResult`：加入列表操作的批量结果
 *
 * 全部数据操作经由 @lexii/core 的公开 API：
 * - listCustomListsWithSummary：卡片摘要（聚合 entryCount + latestAddedAt）
 * - createCustomList / updateCustomList / deleteCustomList：列表 CRUD
 * - addWordToCustomList / removeWordFromCustomList：词条归类
 * - getCustomListsContainingSense / listCustomListEntries：反查与详情
 */
import type { CustomList, CustomListId, CustomListEntryId, SenseId, Sense } from "@lexii/core";

/** 列表卡片展示项：列表元数据 + 统计聚合（单次取齐，避免 N+1） */
export interface CustomListSummaryItem {
  list: CustomList;
  entryCount: number;
  latestAddedAt: string | null;
}

/** 列表详情页词条项：条目记录 + 义项内容（释义 / 词性） */
export interface CustomListDetailItem {
  entry: { id: CustomListEntryId; listId: CustomListId; senseId: SenseId; addedAt: string };
  sense: Sense;
}

/** 列表元数据 + 列表条目 id（re-export，方便测试与 UI 共同引用） */
export type { CustomList, CustomListEntryId };

/** 加入列表的批量结果（按列表分组，便于反馈「已加入：X、Y」） */
export interface AddToListsResult {
  /** 本次新加入的列表 id 列表（addWordToCustomList 实际写入） */
  added: CustomListId[];
  /** 已在所选列表中、幂等返回的列表 id 列表（addWordToCustomList 返回既有记录） */
  already: CustomListId[];
}

/**
 * 列表管理数据源（含详情页）。
 *
 * 测试通过注入 mock；浏览器默认实现走 IndexedDB（见 data.ts）。
 */
export interface CustomListsDataProvider {
  /** 加载全部 active 列表摘要（按 createdAt 倒序，单次聚合统计） */
  loadSummaries(): Promise<CustomListSummaryItem[]>;
  /** 创建列表 */
  createList(input: { name: string; description?: string }): Promise<CustomList>;
  /** 更新列表（name / description 至少传一个） */
  updateList(input: {
    id: CustomListId;
    name?: string;
    description?: string | null;
  }): Promise<CustomList>;
  /** 删除列表（软删除 + 条目批量标记 removed） */
  deleteList(id: CustomListId): Promise<void>;
  /** 读取单个列表元数据 */
  getList(id: CustomListId): Promise<CustomList | undefined>;
  /** 加载列表详情下的 active 词条（按 addedAt 倒序） */
  loadListEntries(id: CustomListId): Promise<CustomListDetailItem[]>;
  /** 把词条从列表中移出 */
  removeWordFromList(entryId: CustomListEntryId): Promise<void>;
}

/**
 * 「添加到列表」对话框专用数据源（精简版，详情页无需此接口）。
 *
 * 用途：复习页 / 搜词页的「添加到列表」按钮 → 打开对话框 → 勾选/创建/确认。
 * 不复用 CustomListsDataProvider 是为了限制接口面积——详情页需要的
 * loadListEntries / removeWordFromList 等不在加入对话框路径上。
 */
export interface AddToListsDataProvider {
  /** 列出全部 active 列表（按 createdAt 倒序，对话框展示候选） */
  listLists(): Promise<CustomList[]>;
  /** 反查：哪些 active 列表已包含指定义项（默认勾选用） */
  getListsContainingSense(senseId: SenseId): Promise<CustomList[]>;
  /** 加入（幂等） */
  addWordToList(listId: CustomListId, senseId: SenseId): Promise<void>;
  /** 移出（供对话窗口中「已加入」复选项的取消操作） */
  removeWordFromList(listId: CustomListId, senseId: SenseId): Promise<void>;
  /**
   * 在对话框内一键创建列表并把当前义项加入（创建 + 加入两步合一）。
   * 返回新建列表的 id，供对话框自动勾选。
   */
  createListAndAdd(name: string, senseId: SenseId): Promise<CustomListId>;
}
