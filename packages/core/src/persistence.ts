/**
 * IndexedDB/Dexie 持久化层。
 *
 * 对应 docs/domain-model.md §9：
 * - 数据库 "lexilexi"，表 items / senses / memoryStates / events。
 * - schema 升级必须走 version(n).stores().upgrade() 迁移，禁止清库重来。
 * - 读写一律走显式事务；「评分 → 写状态 + 写事件」单事务原子落库。
 * - 允许注入 Dexie 实例（Node 测试用 fake-indexeddb，浏览器用 window.indexedDB）。
 *
 * 自动迁移示例：users 表拆为 people + pets 时，用 get({noCache: true}) 读取旧表，
 * 随后 stores({users: null}) 删除旧表。这是错误频发的路径，新增迁移必须带测试。
 */
import Dexie from "dexie";
import type { DexieOptions, Table } from "dexie";
import type { IsoDate, LearningItem, Sense } from "./domain";
import type { Event } from "./events";
import type { MemoryState } from "./memory";
import type { NotebookEntry } from "./notebook";
import { DB_SCHEMA_VERSION } from "./constants";
import { createId, toEventId } from "./id";

/**
 * 词典义项（RAY-294 Tier 1/2 扩展词包检索层）。
 *
 * 与 Sense 同构 + source 字段（所属包标识，如 "core-en-tier1"）。
 * 仅用于检索，不参与复习队列、统计、导出。
 * 不复用 Sense 类型——Sense 无 source 字段（已核实 domain.ts）。
 */
export interface DictionarySense extends Sense {
  /** 所属包标识（如 "core-en-tier1" / "core-en-tier2"），供增量替换按 source 范围删除 */
  source: string;
}

/** Dexie 构造函数（默认真实 Dexie，测试可注入自定义实现） */
export type DexieConstructor = new (databaseName: string, options?: DexieOptions) => Dexie;

/**
 * 数据库实例工厂：优先使用构造时注入的实例（同一实例复用），
 * 否则用默认构造函数创建；dexieOptions 可注入自定义 indexedDB
 * （Node 测试用 fake-indexeddb，浏览器用原生 window.indexedDB）。
 */
export function createLexilexiDatabase(
  dexieOptions: DexieOptions | undefined,
  injectedDexie?: Dexie,
  dexieConstructor?: DexieConstructor,
): Dexie {
  if (injectedDexie) {
    return injectedDexie;
  }
  const dexie = dexieConstructor ? dexieConstructor : Dexie;
  return new dexie("lexilexi", dexieOptions);
}

/**
 * 打开数据库并应用 schema（幂等）。
 *
 * 版本链：v1 为初始 schema；后续 schema 升级追加 version(n)，
 * 每个版本内先执行数据迁移、再 stores(...) 声明新表集合（见上方迁移示例）。
 * v2（RAY-258）：新增 meta 表（key → value 字符串，预设词表安装进度/完成标记
 * 与未来的扩展包元信息）。纯新增表，无数据迁移，存量数据原样保留。
 * v3（RAY-260）：memoryStates 增加 fields.due 索引（到期/明日到期查询由
 * filter 全表扫描改为索引区间查询，评审 suggestion 2 的「为 fields.due
 * 建索引」部分）；仅新增索引，无数据迁移，存量数据原样保留。
 * v4（RAY-262）：senses 增加 term 索引（预设词书安装按 term 查重去重，
 * 重叠词书与用户已导入词条不重复生成学习项）；仅新增索引，无数据迁移，
 * 存量数据原样保留。
 * v5（RAY-284）：新增 notebookEntries 表（生词本条目）。纯新增表，
 * 无数据迁移，存量数据原样保留；版本与 P0 数据任务错开（红线）。
 * v6（RAY-294）：新增 dictionarySenses 表（词典检索层）。纯新增表，
 *   无数据迁移，存量数据原样保留。
 */
export function openLexilexiDatabase(db: Dexie): void {
  if (db.isOpen()) {
    return;
  }
  db.version(1).stores({
    items: "id",
    senses: "id",
    memoryStates: "id",
    events: "id, time, type",
  });
  db.version(2).stores({
    items: "id",
    senses: "id",
    memoryStates: "id",
    events: "id, time, type",
    meta: "key",
  });
  db.version(3).stores({
    items: "id",
    senses: "id",
    memoryStates: "id, fields.due",
    events: "id, time, type",
    meta: "key",
  });
  db.version(4).stores({
    items: "id",
    senses: "id, term",
    memoryStates: "id, fields.due",
    events: "id, time, type",
    meta: "key",
  });
  db.version(5).stores({
    items: "id",
    senses: "id, term",
    memoryStates: "id, fields.due",
    events: "id, time, type",
    meta: "key",
    notebookEntries: "id, senseId, status",
  });
  db.version(DB_SCHEMA_VERSION).stores({
    items: "id",
    senses: "id, term",
    memoryStates: "id, fields.due",
    events: "id, time, type",
    meta: "key",
    notebookEntries: "id, senseId, status",
    dictionarySenses: "id, term, source",
  });
}

/** meta 表记录（key 唯一，value 为字符串——进度数字/版本号/JSON 均可） */
export interface MetaRecord {
  key: string;
  value: string;
}

export interface LexilexiTables {
  items: Table<LearningItem, string>;
  senses: Table<Sense, string>;
  memoryStates: Table<MemoryState, string>;
  events: Table<Event, string>;
  meta: Table<MetaRecord, string>;
  notebookEntries: Table<NotebookEntry, string>;
  dictionarySenses: Table<DictionarySense, string>;
}

export interface LexilexiDatabase extends Dexie {
  items: Table<LearningItem, string>;
  senses: Table<Sense, string>;
  memoryStates: Table<MemoryState, string>;
  events: Table<Event, string>;
  meta: Table<MetaRecord, string>;
  notebookEntries: Table<NotebookEntry, string>;
  dictionarySenses: Table<DictionarySense, string>;
}

/**
 * 打开 Lexilexi 数据库。
 *
 * @param dexieOptions 构造选项（Node 测试注入 fake-indexeddb；浏览器省略即用原生）
 * @param injectedDexie 已配置好的 Dexie 实例（测试用）
 */
export function openDatabase(dexieOptions?: DexieOptions, injectedDexie?: Dexie): LexilexiDatabase {
  const dexie = createLexilexiDatabase(dexieOptions, injectedDexie);
  openLexilexiDatabase(dexie);
  return dexie as LexilexiDatabase;
}

/**
 * 原子操作：评分落库。
 *
 * 在同一次事务中写入复习事件与新的记忆状态——要么都成功，要么都不生效。
 * 若条目或记忆状态不存在则整个事务中止并抛出（防御式，不产生孤儿事件）。
 *
 * 与 studyLoop.gradeReview 的分工（评审建议 #6）：
 * 本函数只做「事件 + 新状态」的原子写入，输入（事件、排期后的状态）由调用方
 * 算好；gradeReview 在本函数的事务契约之上，负责「读旧状态 → FSRS 排期 →
 * 原子写入」的完整学习回路。改动任何一处落库路径时，必须同步检查另一处。
 */
export async function recordReview(
  db: LexilexiDatabase,
  reviewEvent: Extract<Event, { type: "review" }>,
  nextMemoryState: MemoryState,
): Promise<void> {
  if (nextMemoryState.itemId !== reviewEvent.itemId) {
    throw new Error(
      `记忆状态与复习事件的条目不一致：${nextMemoryState.itemId} !== ${reviewEvent.itemId}`,
    );
  }
  await db.transaction("rw", db.events, db.memoryStates, async () => {
    const memoryState = await db.memoryStates.get(reviewEvent.itemId);
    if (!memoryState) {
      throw new Error(`记忆状态不存在：${reviewEvent.itemId}`);
    }
    await db.events.put(reviewEvent);
    await db.memoryStates.put(nextMemoryState);
  });
}

/** 暂停条目（状态标记 + 事件，单事务） */
export async function suspendItem(
  db: LexilexiDatabase,
  itemId: LearningItem["id"],
  reason: string,
  now: IsoDate,
): Promise<void> {
  await db.transaction("rw", db.items, db.events, async () => {
    const item = await db.items.get(itemId);
    if (!item) {
      throw new Error(`学习条目不存在：${itemId}`);
    }
    if (item.status !== "active") {
      throw new Error(`学习条目不可暂停（当前状态：${item.status}）`);
    }
    await db.items.put({ ...item, status: "suspended", updatedAt: now });
    await db.events.put({
      id: toEventId(createId("evt", 12)),
      type: "suspend",
      time: now,
      itemId,
      reason,
    });
  });
}

/** 恢复暂停的条目（状态标记 + 事件，单事务） */
export async function unsuspendItem(
  db: LexilexiDatabase,
  itemId: LearningItem["id"],
  reason: string,
  now: IsoDate,
): Promise<void> {
  await db.transaction("rw", db.items, db.events, async () => {
    const item = await db.items.get(itemId);
    if (!item) {
      throw new Error(`学习条目不存在：${itemId}`);
    }
    if (item.status !== "suspended") {
      throw new Error(`学习条目不可恢复（当前状态：${item.status}）`);
    }
    await db.items.put({ ...item, status: "active", updatedAt: now });
    await db.events.put({
      id: toEventId(createId("evt", 12)),
      type: "unsuspend",
      time: now,
      itemId,
      reason,
    });
  });
}

/** 删除条目（软删除：标记状态 + 记忆状态 + 事件，历史事件永久保留；→ deleted 不可逆，重复删除报错） */
export async function deleteItem(
  db: LexilexiDatabase,
  itemId: LearningItem["id"],
  now: IsoDate,
): Promise<void> {
  await db.transaction("rw", db.items, db.memoryStates, db.events, async () => {
    const item = await db.items.get(itemId);
    if (!item) {
      throw new Error(`学习条目不存在：${itemId}`);
    }
    if (item.status === "deleted") {
      throw new Error(`学习条目不可重复删除（当前状态：${item.status}）`);
    }
    await db.items.put({ ...item, status: "deleted", updatedAt: now });
    const memoryState = await db.memoryStates.get(itemId);
    if (memoryState) {
      await db.memoryStates.put({ ...memoryState, updatedAt: now });
    }
    await db.events.put({
      id: toEventId(createId("evt", 12)),
      type: "delete-item",
      time: now,
      itemId,
    });
  });
}
