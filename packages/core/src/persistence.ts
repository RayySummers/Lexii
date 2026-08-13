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
import { DB_SCHEMA_VERSION } from "./constants";
import { createId, toEventId } from "./id";

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
 */
export function openLexilexiDatabase(db: Dexie): void {
  if (db.isOpen()) {
    return;
  }
  db.version(DB_SCHEMA_VERSION).stores({
    items: "id",
    senses: "id",
    memoryStates: "id",
    events: "id, time, type",
  });
}

export interface LexilexiTables {
  items: Table<LearningItem, string>;
  senses: Table<Sense, string>;
  memoryStates: Table<MemoryState, string>;
  events: Table<Event, string>;
}

export interface LexilexiDatabase extends Dexie {
  items: Table<LearningItem, string>;
  senses: Table<Sense, string>;
  memoryStates: Table<MemoryState, string>;
  events: Table<Event, string>;
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
