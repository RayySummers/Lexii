/**
 * 自定义列表数据源（IndexedDB 实现，RAY-325）。
 *
 * 所有数据操作经由 @lexii/core 的公开 API（createCustomList /
 * updateCustomList / deleteCustomList / listCustomListsWithSummary /
 * getCustomList / listCustomListEntries / getCustomListsContainingSense /
 * addWordToCustomList / removeWordFromCustomList），不在 apps/web 内实现
 * 任何列表语义。详情页 loadListEntries 一次取齐 active 条目，再批量
 * bulkGet 义项内容（不在循环内逐条查询，与 NotebookScreen 同口径）。
 */
import {
  addWordToCustomList,
  createCustomList,
  deleteCustomList,
  getCustomList,
  getCustomListsContainingSense,
  listCustomListEntries,
  listCustomLists,
  listCustomListsWithSummary,
  openDatabase,
  removeWordFromCustomList,
  updateCustomList,
} from "@lexii/core";
import type { CustomListId, CustomListEntryId, LexiiDatabase, SenseId } from "@lexii/core";
import type {
  AddToListsDataProvider,
  CustomListDetailItem,
  CustomListSummaryItem,
  CustomListsDataProvider,
} from "./types";

/** 详情页 / 列表页共用：按 senseId 反查条目 id 后移出（用于加入对话框的取消勾选） */
async function removeFromCustomListBySenseIdInDb(
  db: LexiiDatabase,
  listId: CustomListId,
  senseId: SenseId,
): Promise<void> {
  // 通过 listCustomListEntries 查找到该义项的 active 条目，再按 entryId 移出
  const entries = await listCustomListEntries(db, listId);
  const target = entries.find((entry) => entry.senseId === senseId);
  if (!target) {
    return;
  }
  await removeWordFromCustomList(db, { entryId: target.id });
}

/** 基于已打开的 Lexii 数据库创建完整数据源（列表页 + 详情页共用） */
export function createIndexedDbCustomListsDataProvider(db: LexiiDatabase): CustomListsDataProvider {
  return {
    async loadSummaries(): Promise<CustomListSummaryItem[]> {
      const summaries = await listCustomListsWithSummary(db);
      return summaries.map((summary) => ({
        list: summary.list,
        entryCount: summary.entryCount,
        latestAddedAt: summary.latestAddedAt,
      }));
    },

    async createList(input): Promise<Awaited<ReturnType<CustomListsDataProvider["createList"]>>> {
      return createCustomList(db, { name: input.name, description: input.description ?? "" });
    },

    async updateList(input) {
      return updateCustomList(db, {
        id: input.id,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
    },

    async deleteList(id: CustomListId): Promise<void> {
      await deleteCustomList(db, { id });
    },

    async getList(id: CustomListId) {
      return getCustomList(db, id);
    },

    async loadListEntries(id: CustomListId): Promise<CustomListDetailItem[]> {
      const entries = await listCustomListEntries(db, id);
      if (entries.length === 0) {
        return [];
      }
      const senses = await db.senses.bulkGet(entries.map((entry) => entry.senseId));
      const items: CustomListDetailItem[] = [];
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const sense = senses[i];
        if (entry && sense) {
          items.push({
            entry: {
              id: entry.id,
              listId: entry.listId,
              senseId: entry.senseId,
              addedAt: entry.addedAt,
            },
            sense,
          });
        }
      }
      return items;
    },

    async removeWordFromList(entryId: CustomListEntryId): Promise<void> {
      await removeWordFromCustomList(db, { entryId });
    },
  };
}

/**
 * 「添加到列表」对话框专用数据源（仅暴露加入流程所需的最小接口）。
 *
 * 默认指向同一个真实 IndexedDB；详情页无需此接口。
 */
export function createIndexedDbAddToListsDataProvider(db: LexiiDatabase): AddToListsDataProvider {
  return {
    async listLists() {
      return listCustomLists(db);
    },

    async getListsContainingSense(senseId: SenseId) {
      return getCustomListsContainingSense(db, senseId);
    },

    async addWordToList(listId: CustomListId, senseId: SenseId) {
      await addWordToCustomList(db, { listId, senseId });
    },

    async removeWordFromList(listId: CustomListId, senseId: SenseId) {
      await removeFromCustomListBySenseIdInDb(db, listId, senseId);
    },

    async createListAndAdd(name: string, senseId: SenseId): Promise<CustomListId> {
      // RAY-325 评审 nit 5：创建列表与加入义项是两笔独立事务——若第二步
      // 失败会留下一个空列表。当前对话框场景义项必存在于词库（复习卡 /
      // 搜索结果均来自词库），失败风险极低；且空列表可在管理页删除，
      // 故接受此取舍，不引入跨表补偿事务的复杂度。
      const list = await createCustomList(db, { name });
      await addWordToCustomList(db, { listId: list.id, senseId });
      return list.id;
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 fake-indexeddb 实例绕过。
 */
export function createDefaultCustomListsDataProvider(): CustomListsDataProvider {
  return createIndexedDbCustomListsDataProvider(openDatabase());
}

/** 「添加到列表」对话框浏览器默认数据源 */
export function createDefaultAddToListsDataProvider(): AddToListsDataProvider {
  return createIndexedDbAddToListsDataProvider(openDatabase());
}

/**
 * 「添加到列表」对话框 no-op 数据源（RAY-325 评审 nit 4）。
 *
 * 仅供 ReviewScreen / SearchScreen 在未注入工厂 prop 时兜底（保持既有
 * 测试与旧调用方不破坏）；createListAndAdd 抛出明确错误，其余方法静默
 * no-op。两处屏幕共用同一实例，避免逐字重复。
 */
export const NOOP_ADD_TO_LISTS_PROVIDER: AddToListsDataProvider = {
  async listLists() {
    return [];
  },
  async getListsContainingSense() {
    return [];
  },
  async addWordToList() {
    /* no-op */
  },
  async removeWordFromList() {
    /* no-op */
  },
  async createListAndAdd(): Promise<never> {
    throw new Error("未注入 AddToListsDataProvider 工厂");
  },
};
