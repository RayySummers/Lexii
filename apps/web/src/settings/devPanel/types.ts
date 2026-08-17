/**
 * 开发者面板的数据契约（apps/web 内部，RAY-297 任务 B）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `DeveloperDataProvider`：面板数据源（测试注入 mock，浏览器注入
 *   IndexedDB 实现，见 data.ts）；
 * - 数据库调试 / FSRS 调试的返回结构。
 *
 * 边界：面板只做「读取本机数据库现状 + 危险操作（清库）」，
 * 全部经由 @lexii/core / @lexii/fsrs 的公开 API，不在 apps/web
 * 内实现任何算法；不引入任何网络请求（local-first 红线）。
 */
import type { IsoDate } from "@lexii/core";
import type { FSRSParameters } from "@lexii/fsrs";

/** 单表记录数（表名 → 当前记录数） */
export interface DatabaseTableDebug {
  name: string;
  count: number;
}

/** 数据库调试快照 */
export interface DatabaseDebug {
  /** 数据库名（与 @lexii/core 的库名一致） */
  dbName: string;
  /** 当前 schema 版本（Dexie verno，即 core 的 DB_SCHEMA_VERSION） */
  schemaVersion: number;
  /** 各表记录数（按表声明顺序） */
  tables: DatabaseTableDebug[];
}

/** 记忆状态分布（按 FSRS 调度阶段计数） */
export interface MemoryStatusCounts {
  new: number;
  learning: number;
  review: number;
  relearning: number;
}

/** 到期采样条目（未来窗口内即将到期的卡片，最多 10 条） */
export interface DueSampleEntry {
  itemId: string;
  /** 词条原文（经 item → sense 关联） */
  term: string;
  /** 下次复习时间（ISO） */
  due: IsoDate;
  /** FSRS 稳定度 S（天） */
  stabilityDays: number;
  /** FSRS 难度 D ∈ [1, 10] */
  difficulty: number;
}

/** FSRS 调试快照 */
export interface FsrsDebug {
  /** 当前生效的 FSRS 参数（与调度器默认参数同源：normalizeParameters()） */
  parameters: FSRSParameters;
  /** 各调度阶段的记忆状态计数 */
  counts: MemoryStatusCounts;
  /** 即将到期样例（按 due 升序，最多 10 条） */
  dueSample: DueSampleEntry[];
}

/** 开发者面板数据源 */
export interface DeveloperDataProvider {
  /** 数据库现状（库名 / schema 版本 / 各表记录数） */
  loadDatabaseDebug(): Promise<DatabaseDebug>;
  /** 清空本地数据库（危险操作，调用方负责二次确认；成功后需刷新页面） */
  clearDatabase(): Promise<void>;
  /** FSRS 调试（当前参数 / 状态分布 / 到期样例） */
  loadFsrsDebug(): Promise<FsrsDebug>;
}
