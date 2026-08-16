/**
 * 数据导出 / 导入（完整可恢复 JSON）。
 *
 * 对应 docs/domain-model.md §11：
 * - 导出产物含 items / senses / memoryStates / events / notebookEntries 五张表
 *   + schema 版本号，能被 importLexilexiData() 原样导回（JSON round-trip
 *   测试保证）。notebookEntries 为 RAY-284 新增：格式版本不变（v1），
 *   旧备份（无该字段）导入时按空生词本处理，绝不因此拒绝恢复。
 * - 导入时同 id 冲突按「导入覆盖」处理；schema 版本不兼容时明确报错，
 *   绝不静默清库、绝不写半份数据（单事务）。
 */
import type { IsoDate, LearningItem, Sense } from "./domain";
import type { Event } from "./events";
import type { MemoryState } from "./memory";
import type { NotebookEntry } from "./notebook";
import { DB_SCHEMA_VERSION, EXPORT_FORMAT_VERSION } from "./constants";
import type { LexilexiDatabase } from "./persistence";

export interface LexilexiExportData {
  format: "lexilexi";
  /** 导出文件格式版本（独立于数据库 schema 版本，二者不绑定） */
  exportFormatVersion: number;
  /** 导出时数据库 schema 版本（导入时校验） */
  dbSchemaVersion: number;
  exportedAt: IsoDate;
  items: LearningItem[];
  senses: Sense[];
  memoryStates: MemoryState[];
  events: Event[];
  /** 生词本条目（RAY-284；旧备份缺失时按空数组导入） */
  notebookEntries: NotebookEntry[];
}

/**
 * 导出全部学习数据（单读事务快照）。
 *
 * 五张表在同一个只读事务内读取：与并发写入（评分、导入、加词等）串行化，
 * 不会拍到「items 已写、memoryStates 未写」这类跨表中间态（评审建议 C2）。
 */
export async function exportLexilexiData(
  db: LexilexiDatabase,
  now: IsoDate,
): Promise<LexilexiExportData> {
  const [items, senses, memoryStates, events, notebookEntries] = await db.transaction(
    "r",
    db.items,
    db.senses,
    db.memoryStates,
    db.events,
    db.notebookEntries,
    async () =>
      Promise.all([
        db.items.toArray(),
        db.senses.toArray(),
        db.memoryStates.toArray(),
        db.events.toArray(),
        db.notebookEntries.toArray(),
      ]),
  );
  return {
    format: "lexilexi",
    exportFormatVersion: EXPORT_FORMAT_VERSION,
    dbSchemaVersion: DB_SCHEMA_VERSION,
    exportedAt: now,
    items,
    senses,
    memoryStates,
    events,
    notebookEntries,
  };
}

/**
 * 导入导出数据（单事务、导入覆盖语义）。
 *
 * 失败（版本不兼容、数据非法）时整个事务中止，库保持原样。
 */
export async function importLexilexiData(
  db: LexilexiDatabase,
  data: LexilexiExportData,
): Promise<void> {
  if (data.format !== "lexilexi") {
    throw new Error(`导出文件格式未知：${String(data.format)}`);
  }
  if (data.exportFormatVersion !== EXPORT_FORMAT_VERSION) {
    throw new Error(
      `导出文件版本不兼容：${data.exportFormatVersion}（当前支持 ${EXPORT_FORMAT_VERSION}）`,
    );
  }
  if (data.dbSchemaVersion > DB_SCHEMA_VERSION) {
    throw new Error(
      `导出数据由更新版本的 Lexilexi 生成（schema v${data.dbSchemaVersion} > 当前 v${DB_SCHEMA_VERSION}），请先升级应用`,
    );
  }
  await db.transaction(
    "rw",
    db.items,
    db.senses,
    db.memoryStates,
    db.events,
    db.notebookEntries,
    async () => {
      for (const item of data.items) {
        await db.items.put(item);
      }
      for (const sense of data.senses) {
        await db.senses.put(sense);
      }
      for (const memoryState of data.memoryStates) {
        await db.memoryStates.put(memoryState);
      }
      for (const event of data.events) {
        await db.events.put(event);
      }
      for (const entry of data.notebookEntries) {
        await db.notebookEntries.put(entry);
      }
    },
  );
}

/** 字段级校验：仅结构（必需字段存在、类型正确），不做业务语义校验 */
function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`数据非法：${label} 必须是对象`);
  }
}

function assertArrayOfPlainObjects(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`数据非法：${label} 必须是数组`);
  }
  for (const entry of value) {
    assertPlainObject(entry, `${label} 的元素`);
  }
}

/**
 * 把未知 JSON 数据解析为导出数据结构。
 *
 * 只做结构校验（未知键保留），schema 版本校验由 importLexilexiData 负责；
 * 业务语义校验（必填字段缺失等）在导入事务内由 Dexie 约束抛出。
 *
 * notebookEntries（RAY-284）缺失时按空数组处理——旧备份（本字段引入前
 * 导出）可原样导入，绝不因备份格式升级拒绝恢复。
 */
export function parseLexilexiExport(json: string): LexilexiExportData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("导出文件不是合法 JSON");
  }
  assertPlainObject(raw, "导出数据");
  if (raw.format !== "lexilexi") {
    throw new Error(`导出文件格式未知：${String(raw.format)}`);
  }
  if (typeof raw.exportFormatVersion !== "number") {
    throw new Error("数据非法：exportFormatVersion 必须是数字");
  }
  if (typeof raw.dbSchemaVersion !== "number") {
    throw new Error("数据非法：dbSchemaVersion 必须是数字");
  }
  if (typeof raw.exportedAt !== "string") {
    throw new Error("数据非法：exportedAt 必须是字符串");
  }
  assertArrayOfPlainObjects(raw.items, "items");
  assertArrayOfPlainObjects(raw.senses, "senses");
  assertArrayOfPlainObjects(raw.memoryStates, "memoryStates");
  assertArrayOfPlainObjects(raw.events, "events");
  if (raw.notebookEntries !== undefined) {
    assertArrayOfPlainObjects(raw.notebookEntries, "notebookEntries");
  }
  return { ...raw, notebookEntries: raw.notebookEntries ?? [] } as unknown as LexilexiExportData;
}
