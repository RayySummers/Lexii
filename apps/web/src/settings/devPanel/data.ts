/**
 * 开发者面板数据源（IndexedDB 实现，RAY-297 任务 B）。
 *
 * - loadDatabaseDebug：库名 / schema 版本（Dexie verno）/ 各表记录数；
 * - clearDatabase：删除本地数据库（危险操作，UI 层二次确认后调用）；
 * - loadFsrsDebug：当前生效的 FSRS 参数（normalizeParameters，与调度器
 *   默认参数同源）、各调度阶段计数、未来 30 天内到期的样例（最多 10 条，
 *   含词条原文与稳定度/难度）。
 *
 * 全部读取都在本机 IndexedDB 上完成，不发起任何网络请求。
 * 数据量上限：到期样例只做一次全表 toArray + 截断（内存状态表为 MVP
 * 词库规模，数百至数千条，与 core 的既有说明口径一致）。
 */
import { openDatabase } from "@lexilexi/core";
import type { LexilexiDatabase, MemoryStatus } from "@lexilexi/core";
import { normalizeParameters } from "@lexilexi/fsrs";
import type {
  DatabaseDebug,
  DeveloperDataProvider,
  DueSampleEntry,
  FsrsDebug,
  MemoryStatusCounts,
} from "./types";

/** FSRS 调试的到期采样窗口（天）：只列未来窗口内到期的条目，避免大列表 */
const DUE_SAMPLE_WINDOW_DAYS = 30;

/** 到期采样条目数上限 */
const DUE_SAMPLE_LIMIT = 10;

/** 稳定度 / 难度展示精度（保留两位小数） */
const DEBUG_NUMBER_PRECISION = 2;

function roundForDebug(value: number): number {
  return Number(value.toFixed(DEBUG_NUMBER_PRECISION));
}

/** 读取数据库现状（供测试与默认工厂复用） */
export async function loadDatabaseDebug(db: LexilexiDatabase): Promise<DatabaseDebug> {
  const tables = [];
  for (const table of db.tables) {
    tables.push({ name: table.name, count: await table.count() });
  }
  return { dbName: db.name, schemaVersion: db.verno, tables };
}

/** 读取 FSRS 调试快照（供测试与默认工厂复用） */
export async function loadFsrsDebug(
  db: LexilexiDatabase,
  now: Date = new Date(),
): Promise<FsrsDebug> {
  // 与 core studyLoop 的 `new Scheduler(card, now)` 默认参数同源：
  // 不传参即 normalizeParameters(undefined) → 默认 FSRS-7 参数。
  const parameters = normalizeParameters();

  const states = await db.memoryStates.toArray();
  const counts: MemoryStatusCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
  const horizon = new Date(now.getTime() + DUE_SAMPLE_WINDOW_DAYS * 86_400_000).toISOString();
  for (const state of states) {
    const status = state.fields.status as MemoryStatus;
    counts[status] += 1;
  }
  const due = states
    .filter((state) => state.fields.status !== "new" && state.fields.due <= horizon)
    .sort((a, b) => a.fields.due.localeCompare(b.fields.due))
    .slice(0, DUE_SAMPLE_LIMIT);

  const items = await db.items.bulkGet(due.map((state) => state.itemId));
  const senseIds = items.flatMap((item) => (item ? [item.senseId] : []));
  const senses = await db.senses.bulkGet(senseIds);
  const termBySenseId = new Map(
    senses.flatMap((sense) => (sense ? [[sense.id, sense.term] as const] : [])),
  );

  const dueSample: DueSampleEntry[] = [];
  for (let index = 0; index < due.length; index += 1) {
    const state = due[index];
    if (!state) {
      continue;
    }
    const item = items[index];
    if (!item) {
      continue;
    }
    dueSample.push({
      itemId: state.itemId,
      term: termBySenseId.get(item.senseId) ?? "(义项缺失)",
      due: state.fields.due,
      stabilityDays: roundForDebug(state.fields.stabilityDays),
      difficulty: roundForDebug(state.fields.difficulty),
    });
  }

  return { parameters, counts, dueSample };
}

/** 基于已打开的 Lexilexi 数据库创建开发者面板数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbDeveloperDataProvider(db: LexilexiDatabase): DeveloperDataProvider {
  return {
    async loadDatabaseDebug(): Promise<DatabaseDebug> {
      return loadDatabaseDebug(db);
    },

    async clearDatabase(): Promise<void> {
      await db.delete();
    },

    async loadFsrsDebug(): Promise<FsrsDebug> {
      return loadFsrsDebug(db);
    },
  };
}

/**
 * 默认工厂：面板解锁时才惰性打开 IndexedDB（未解锁的普通用户零开销）。
 * IndexedDB 不可用时首个方法调用抛错，由面板展示错误文案。
 */
export function createDefaultDeveloperDataProvider(): DeveloperDataProvider {
  let dbPromise: Promise<LexilexiDatabase> | null = null;
  const getDb = (): Promise<LexilexiDatabase> => {
    dbPromise ??= Promise.resolve().then(() => openDatabase());
    return dbPromise;
  };
  return {
    async loadDatabaseDebug(): Promise<DatabaseDebug> {
      return loadDatabaseDebug(await getDb());
    },
    async clearDatabase(): Promise<void> {
      await (await getDb()).delete();
    },
    async loadFsrsDebug(): Promise<FsrsDebug> {
      return loadFsrsDebug(await getDb());
    },
  };
}
