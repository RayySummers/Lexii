/**
 * 领域模型 ID 与版本常量。
 *
 * 所有 id 为 nanoid 字符串，带类型前缀（见 id.ts），
 * 便于在事件流、日志与调试中一眼区分实体类型。
 */
import type { EventId, ItemId, SenseId } from "./id";

/** 应用名（英文） */
export const APP_NAME = "Lexilexi";

/** 应用名（中文） */
export const APP_NAME_ZH = "乐希";

/** 事件日志 schema 版本（event schema v0） */
export const EVENT_SCHEMA_VERSION = 0;

/**
 * IndexedDB 数据库 schema 版本。
 *
 * 红线：升级必须通过 Dexie version(n).stores().upgrade() 迁移，
 * 禁止删除数据库后重建（清库重来）。
 */
export const DB_SCHEMA_VERSION = 1;

/** 导出文件（完整可恢复 JSON）的格式版本 */
export const EXPORT_FORMAT_VERSION = 1;

export type { ItemId, SenseId, EventId };
