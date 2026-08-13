/**
 * 设置页的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `DataOverview`：数据概览（词条数 / 复习次数 / 连续天数），供统计空状态判断
 * - `SettingsDataProvider`：设置页数据源（测试注入 mock，浏览器注入 IndexedDB 实现）
 * - `ImportBackupResult`：JSON 备份恢复后的结果计数（供成功提示）
 */
import type { LexilexiExportData } from "@lexilexi/core";

/** 数据概览（词条数不含已删除；统计从事件流聚合，见 @lexilexi/stats） */
export interface DataOverview {
  /** 未删除条目数（active + suspended） */
  itemCount: number;
  /** 已复习次数（review 事件总数） */
  reviewCount: number;
  /** 当前连续复习天数（0 = 无复习记录） */
  streakDays: number;
}

/** JSON 备份恢复后的计数（用于成功提示，映射自 LexilexiExportData 各表长度） */
export interface ImportBackupResult {
  items: number;
  senses: number;
  memoryStates: number;
  events: number;
}

/**
 * 设置页数据源。
 *
 * 职责边界：只做「概览聚合 / 导出 / 导入」，全部经由 @lexilexi/core 的
 * 公开 API（exportLexilexiData / exportCsvWordlist / parseLexilexiExport /
 * importLexilexiData）与 @lexilexi/stats 的纯统计函数，不在 apps/web 内
 * 实现任何导出/导入/统计算法。
 */
export interface SettingsDataProvider {
  /** 加载数据概览（词条数 / 复习次数 / 连续天数） */
  loadOverview(): Promise<DataOverview>;
  /** 导出完整 JSON 备份（可原样导回） */
  exportBackup(): Promise<LexilexiExportData>;
  /** 导出词表为 CSV 文本（term/definition/pos，可经 importCsvWordlist 导回） */
  exportWordlistCsv(): Promise<string>;
  /** 导入 JSON 备份（解析 + 落库，同 id 覆盖），返回恢复计数；失败抛错 */
  importBackup(jsonText: string): Promise<ImportBackupResult>;
}
