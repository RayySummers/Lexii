/**
 * 设置页的数据契约（apps/web 内部）。
 *
 * UI 层只依赖本文件定义的接口，不直接触碰 IndexedDB：
 * - `SettingsDataProvider`：设置页数据源（测试注入 mock，浏览器注入 IndexedDB 实现）
 * - `ImportBackupResult`：JSON 备份恢复后的结果计数（供成功提示）
 * - `PresetSummary`：内置词表安装状态摘要（「数据来源与许可」页展示）
 * - `WordbookSummary` / `WordbookInstallResult`：词书库页状态与安装结果（RAY-262）
 *
 * RAY-253 反馈 6：`DataOverview` / `loadOverview` 已删除（设置页数据概览
 * 与统计页功能重复）。
 */
import type { DictionaryInstallStatus, PresetInstallStatus } from "@lexii/core";
import type { LexiiExportData } from "@lexii/core";

/** JSON 备份恢复后的计数（用于成功提示，映射自 LexiiExportData 各表长度） */
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

/** 词书安装状态摘要（RAY-262，供词书库页展示） */
export interface WordbookSummary {
  /** 词书稳定标识（如 "book-cet6"） */
  id: string;
  status: PresetInstallStatus;
  /** 已处理词条数（installing 时为断点进度） */
  installedCount: number;
  /** 词书词条总数 */
  totalCount: number;
  /** 已安装版本（status === "installed" 时有值） */
  installedVersion?: string;
}

/** 词书安装结果（供成功提示；词书间与用户数据重叠的词条跳过不计入新增） */
export interface WordbookInstallResult {
  /** 本次新安装词条数 */
  installedCount: number;
  /** 跳过的已存在词条数（来自重叠词书或用户已导入数据） */
  skippedCount: number;
}

// ─── 扩展词包（RAY-294）─────────────────────────────────────────────────────

/** 扩展词包摘要（供扩展词包设置页展示） */
export interface DictionaryPackageSummary {
  /** 包稳定标识（如 "core-en-tier1"） */
  id: string;
  /** 面向用户的名称 */
  name: string;
  /** 安装状态 */
  status: DictionaryInstallStatus;
  /** 已处理词条数（installing 时为进度游标，installed 时为总数） */
  installedCount: number;
  /** 包内词条总数 */
  totalCount: number;
  /** 已安装版本（status === "installed" 时有值；"covered" 时为 "covered-by-tier2"） */
  installedVersion?: string;
  /** 包体积（Brotli，字节；从 manifest 读取） */
  sizeBytes?: number;
}

/** 扩展词包安装结果 */
export interface DictionaryInstallResult {
  status: "installed" | "already-installed";
  installedCount?: number;
  skippedCount?: number;
  updatedCount?: number;
  deletedCount?: number;
  installedVersion?: string;
}

/** manifest 中的包信息（供下载确认界面展示） */
export interface DictionaryManifestInfo {
  id: string;
  version: string;
  sourceCommit: string;
  /** Brotli variant（优先）或最佳可用 variant */
  bestVariant?: { url: string; size: number; sha256: string };
}

/**
 * 设置页数据源。
 *
 * 职责边界：只做「导出 / 导入 / 内置词表状态 / 词书库状态与安装」，
 * 全部经由 @lexii/core 的公开 API，不在 apps/web 内实现任何算法。
 */
export interface SettingsDataProvider {
  /** 导出完整 JSON 备份（可原样导回） */
  exportBackup(): Promise<LexiiExportData>;
  /** 导出词表为 CSV 文本（term/definition/pos，可经 importCsvWordlist 导回） */
  exportWordlistCsv(): Promise<string>;
  /** 导入 JSON 备份（解析 + 落库，同 id 覆盖），返回恢复计数；失败抛错 */
  importBackup(jsonText: string): Promise<ImportBackupResult>;
  /** 内置词表安装状态（「数据来源与许可」页） */
  getPresetSummaries(): Promise<PresetSummary[]>;
  /** 全部词书安装状态（词书库页） */
  getWordbookSummaries(): Promise<WordbookSummary[]>;
  /** 安装一本词书（分块落库、可恢复、幂等、按 term 去重）；失败抛错 */
  installWordbook(bookId: string): Promise<WordbookInstallResult>;

  // ─── 扩展词包（RAY-294）─────────────────────────────────────────────────

  /** 获取全部扩展词包安装状态（进入设置页时读一次） */
  getDictionaryPackageSummaries(): Promise<DictionaryPackageSummary[]>;
  /**
   * 从远程 manifest 获取包信息（仅进入扩展词包设置页时调用，启动不联网）。
   * 返回 null 表示 manifest 不可用（网络错误等）。
   */
  fetchDictionaryManifest(): Promise<DictionaryManifestInfo[] | null>;
  /**
   * 下载并安装扩展词包（fetch → 校验 → 解压 → 落库）。
   * 失败抛错（网络/校验/安装错误）。
   * signal 可选，用于取消下载（AbortController）。
   */
  installDictionaryPackage(
    packageId: string,
    signal?: AbortSignal,
  ): Promise<DictionaryInstallResult>;
  /** Tier 2 安装完成后标记 Tier 1 为 covered */
  markTier1CoveredByTier2(): Promise<void>;
  /**
   * 取消安装后清除进度标记，使包状态回退到 `not-installed`。
   * 不影响已完成的 done 标记（已安装包不受影响）。
   */
  resetDictionaryPackageInstall(packageId: string): Promise<void>;
}
