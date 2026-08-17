/**
 * 生词本（Notebook）：独立于词书的个人生词集合（RAY-284）。
 *
 * 口径（Jack 拍板）：
 * - 生词本独立于词书：无论学什么词书，都可选择学习列表是否包含生词本；
 * - 生词进入现有调度（FSRS），不另起调度——加词即创建 Learning Item +
 *   Memory State（newCardFields 初始化，加入即到期），与词书条目同一套
 *   FSRS 学习回路；
 * - 导出/导入沿用现有数据格式：notebookEntries 表随 JSON 备份原样往返。
 *
 * 数据模型（docs/domain-model.md §4.1）：
 * - NotebookEntry 是「词条加入生词本」的记录，1─1 锚定其学习条目
 *   （itemId）；义项复用词库既有 Sense（senseId 不变，不复制内容），
 *   因此 Learning Item → Sense 由 1─1 放宽为 N─1（同一义项可被多个
 *   条目共享——词书条目与生词本条目各自独立调度）。
 * - 加词幂等：同一 senseId 的 active 条目已存在时直接返回既有记录，
 *   不重复创建条目（防止连点/重复加词产生重复调度）。
 * - 移出（remove）：条目标记 removed（保留为历史）+ 底层 Learning Item
 *   软删除（status = "deleted"，走既有 delete-item 语义与事件），
 *   词书中的同词条目不受影响（独立调度）。
 *
 * 本地优先：全部操作在本机 IndexedDB 事务内完成，无网络、无埋点。
 */
import type { IsoDate } from "./domain";
import { createId, toEventId, toItemId, toNotebookEntryId } from "./id";
import type { ItemId, NotebookEntryId, SenseId } from "./id";
import { toMemoryState } from "./importWords";
import type { LexiiDatabase } from "./persistence";

/** 生词本条目状态：active（在生词本中）⇢ removed（已移出，记录保留） */
export type NotebookEntryStatus = "active" | "removed";

/**
 * 生词本条目：一条「加入生词本」的记录。
 *
 * - itemId：该词的调度载体（Learning Item，生词本词条的独立调度实例）；
 * - senseId：义项快照引用（复用词库既有 Sense，不复制内容）；
 * - term：词条原文（列表展示用，冗余自 Sense 的 term）。
 */
export interface NotebookEntry {
  id: NotebookEntryId;
  itemId: ItemId;
  senseId: SenseId;
  term: string;
  addedAt: IsoDate;
  status: NotebookEntryStatus;
  /** 移出时刻（active 时恒为 null） */
  removedAt: IsoDate | null;
}

/** 生词本词条条目的来源标识（写入 LearningItem.source，与词书来源区分） */
export const NOTEBOOK_SOURCE = "生词本";

/** 加词输入 */
export interface AddToNotebookInput {
  /** 目标义项（必须已存在于词库；复习卡页/搜词页的加词均指向既有义项） */
  senseId: SenseId;
  /** 加词时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/** 移出生词本输入 */
export interface RemoveFromNotebookInput {
  /** 生词本条目 id（listNotebookEntries 返回的 id） */
  entryId: NotebookEntryId;
  /** 移出时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/**
 * 把义项加入生词本（单事务原子落库，幂等）。
 *
 * 事务内完成：查重（同 senseId 的 active 条目已存在 → 直接返回，幂等）→
 * 创建 Learning Item（source = "生词本"）+ Memory State（newCardFields，
 * 加入即到期、进入现有 FSRS 调度）+ import 事件（与词表导入同一事件
 * 类型，item 的 source 区分来源）+ NotebookEntry 记录。
 * 义项不存在时整个事务中止，不留下半条记录。
 */
export async function addToNotebook(
  db: LexiiDatabase,
  input: AddToNotebookInput,
): Promise<NotebookEntry> {
  const now = input.now ?? new Date().toISOString();
  return db.transaction(
    "rw",
    db.notebookEntries,
    db.senses,
    db.items,
    db.memoryStates,
    db.events,
    async () => {
      const existing = await db.notebookEntries
        .where("senseId")
        .equals(input.senseId)
        .filter((entry) => entry.status === "active")
        .first();
      if (existing) {
        return existing;
      }
      const sense = await db.senses.get(input.senseId);
      if (!sense) {
        throw new Error(`义项不存在：${input.senseId}`);
      }
      const itemId = toItemId(createId("item"));
      const entry: NotebookEntry = {
        id: toNotebookEntryId(createId("nb")),
        itemId,
        senseId: sense.id,
        term: sense.term,
        addedAt: now,
        status: "active",
        removedAt: null,
      };
      await db.items.put({
        id: itemId,
        createdAt: now,
        updatedAt: now,
        source: NOTEBOOK_SOURCE,
        senseId: sense.id,
        kind: "word",
        status: "active",
      });
      await db.memoryStates.put(toMemoryState(itemId, now));
      await db.events.put({
        id: toEventId(createId("evt", 12)),
        type: "import",
        time: now,
        itemId,
        senseId: sense.id,
        term: sense.term,
        lang: sense.lang,
      });
      await db.notebookEntries.put(entry);
      return entry;
    },
  );
}

/**
 * 把词条移出生词本（单事务原子落库）。
 *
 * 条目标记 removed（记录保留为历史）；其底层 Learning Item 软删除
 * （status = "deleted" + delete-item 事件，与 deleteItem 同语义）——
 * 移出即离开学习列表与调度。词书中的同词条目（独立调度实例）不受影响。
 * 重复移出报错；条目不存在报错，事务回滚。
 */
export async function removeFromNotebook(
  db: LexiiDatabase,
  input: RemoveFromNotebookInput,
): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  await db.transaction("rw", db.notebookEntries, db.items, db.memoryStates, db.events, async () => {
    const entry = await db.notebookEntries.get(input.entryId);
    if (!entry) {
      throw new Error(`生词本条目不存在：${input.entryId}`);
    }
    if (entry.status !== "active") {
      throw new Error(`生词本条目不可重复移出（当前状态：${entry.status}）`);
    }
    await db.notebookEntries.put({ ...entry, status: "removed", removedAt: now });
    const item = await db.items.get(entry.itemId);
    if (item && item.status !== "deleted") {
      await db.items.put({ ...item, status: "deleted", updatedAt: now });
      const memoryState = await db.memoryStates.get(entry.itemId);
      if (memoryState) {
        await db.memoryStates.put({ ...memoryState, updatedAt: now });
      }
      await db.events.put({
        id: toEventId(createId("evt", 12)),
        type: "delete-item",
        time: now,
        itemId: entry.itemId,
      });
    }
  });
}

/**
 * 列出当前生词本条目（仅 active，最新加入在前）。
 *
 * 列表展示按 addedAt 倒序（ISO-8601 同格式字符串可直接字典序比较）；
 * 词条内容（释义等）由调用方按 senseId 取义项。
 */
export async function listNotebookEntries(db: LexiiDatabase): Promise<NotebookEntry[]> {
  const entries = await db.notebookEntries.where("status").equals("active").toArray();
  return entries.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/**
 * 当前生词本（active 条目）覆盖的学习条目 id 集合。
 *
 * 供队列与到期查询按「学习列表是否包含生词本」过滤（includeNotebook
 * 关闭时排除这些条目）；查询走 status 索引，不整表扫描。
 */
export async function getActiveNotebookItemIds(db: LexiiDatabase): Promise<ItemId[]> {
  const entries = await db.notebookEntries.where("status").equals("active").toArray();
  return entries.map((entry) => entry.itemId);
}
