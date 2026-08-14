/**
 * 设置页的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `SettingsDataProvider`：设置页数据源（测试注入 mock，浏览器注入 IndexedDB 实现）
 * - `ImportBackupResult`：JSON 备份恢复后的结果计数（供成功提示）
 * - `PresetSummary`：内置词表安装状态摘要（「数据来源与许可」页展示）
 *
 * RAY-253 反馈 6：`DataOverview` / `loadOverview` 已删除（设置页数据概览
 * 与统计页功能重复）。
 */
import type { PresetInstallStatus } from "@lexilexi/core";
import type { LexilexiExportData } from "@lexilexi/core";

/** JSON 备份恢复后的计数（用于成功提示，映射自 LexilexiExportData 各表长度） */
export interface ImportBackupResult {
  items: number;
  senses: number;
  memoryStates: number;
  events: number;
}

/** 内置词表安装状态摘要（RAY-258，供「数据来源与许可」页展示） */
export interface PresetSummary {
  /** 包稳定标识（如 "core-en-tier0"） */
  id: string;
  /** 面向用户的名称 */
  name: string;
  status: PresetInstallStatus;
  /** 已安装词条数（installing 时为断点进度） */
  installedCount: number;
  /** 包内词条总数 */
  totalCount: number;
  /** 已安装版本（status === "installed" 时有值） */
  installedVersion?: string;
}

/**
 * 设置页数据源。
 *
 * 职责边界：只做「导出 / 导入 / 内置词表状态」，全部经由 @lexilexi/core
 * 的公开 API，不在 apps/web 内实现任何导出/导入算法。
 */
export interface SettingsDataProvider {
  /** 导出完整 JSON 备份（可原样导回） */
  exportBackup(): Promise<LexilexiExportData>;
  /** 导出词表为 CSV 文本（term/definition/pos，可经 importCsvWordlist 导回） */
  exportWordlistCsv(): Promise<string>;
  /** 导入 JSON 备份（解析 + 落库，同 id 覆盖），返回恢复计数；失败抛错 */
  importBackup(jsonText: string): Promise<ImportBackupResult>;
  /** 内置词表安装状态（「数据来源与许可」页） */
  getPresetSummaries(): Promise<PresetSummary[]>;
}
