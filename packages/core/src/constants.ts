/**
 * 领域模型 ID 与版本常量。
 *
 * 所有 id 为 nanoid 字符串，带类型前缀（见 id.ts），
 * 便于在事件流、日志与调试中一眼区分实体类型。
 */
import type { EventId, ItemId, SenseId } from "./id";

/** 应用名（英文） */
export const APP_NAME = "Lexii";

/** 应用名（中文） */
export const APP_NAME_ZH = "乐希";

/** 事件日志 schema 版本（event schema v0） */
export const EVENT_SCHEMA_VERSION = 0;

/**
 * IndexedDB 数据库 schema 版本。
 *
 * 红线：升级必须通过 Dexie version(n).stores().upgrade() 迁移，
 * 禁止删除数据库后重建（清库重来）。
 * v2（RAY-258）：新增 meta 表（预设词表安装进度/完成标记），纯新增无数据迁移。
 * v3（RAY-260）：memoryStates 新增 fields.due 索引（到期查询由全表 filter
 *   改为索引区间查询）；存量数据原样保留，Dexie 自动建索引。
 * v4（RAY-262）：senses 新增 term 索引（预设词书安装按 term 查重，避免
 *   重叠词书/用户已导入词条重复生成学习项）；纯新增索引无数据迁移，
 *   存量数据原样保留。
 * v5（RAY-284）：新增 notebookEntries 表（生词本条目：id 主键、
 *   senseId 索引按义项查重去重、status 索引按 active 列表）——
 *   纯新增表，无数据迁移，存量数据原样保留。schema 版本已与 P0 数据
 *   任务错开（RAY-288 纯展示、RAY-270 只读事件流，均不改 schema）。
 * v6（RAY-294）：新增 dictionarySenses 表（词典检索层：id 主键、
 *   term 索引供检索、source 索引供增量替换删除检测）——
 *   纯新增表，无数据迁移，存量数据原样保留。
 */
export const DB_SCHEMA_VERSION = 6;

/** 导出文件（完整可恢复 JSON）的格式版本 */
export const EXPORT_FORMAT_VERSION = 1;

export type { ItemId, SenseId, EventId };
