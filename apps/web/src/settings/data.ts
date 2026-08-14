/**
 * 设置页数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - exportBackup：exportLexilexiData（完整 JSON 快照）
 * - exportWordlistCsv：exportCsvWordlist（词表 CSV，仅未删除条目）
 * - importBackup：parseLexilexiExport → importLexilexiData（单事务、同 id 覆盖）
 * - getPresetSummaries：内置词表安装状态（RAY-258「数据来源与许可」页）
 *
 * RAY-253 反馈 6：loadOverview（数据概览）已随设置页概览区删除。
 */
import {
  exportCsvWordlist,
  exportLexilexiData,
  getPresetInstallState,
  importLexilexiData,
  openDatabase,
  parseLexilexiExport,
  TIER0_PRESET,
} from "@lexilexi/core";
import type { LexilexiDatabase, LexilexiExportData, PresetPackage } from "@lexilexi/core";
import type { ImportBackupResult, PresetSummary, SettingsDataProvider } from "./types";

/** 随包内置的预设词表（Tier 0；未来扩展包接入时在此登记） */
const BUNDLED_PRESETS: readonly PresetPackage[] = [TIER0_PRESET];

/** 基于已打开的 Lexilexi 数据库创建设置页数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbSettingsDataProvider(db: LexilexiDatabase): SettingsDataProvider {
  return {
    async exportBackup(): Promise<LexilexiExportData> {
      return exportLexilexiData(db, new Date().toISOString());
    },

    async exportWordlistCsv(): Promise<string> {
      return exportCsvWordlist(db);
    },

    async importBackup(jsonText: string): Promise<ImportBackupResult> {
      const data = parseLexilexiExport(jsonText);
      await importLexilexiData(db, data);
      return {
        items: data.items.length,
        senses: data.senses.length,
        memoryStates: data.memoryStates.length,
        events: data.events.length,
      };
    },

    async getPresetSummaries(): Promise<PresetSummary[]> {
      return Promise.all(
        BUNDLED_PRESETS.map(async (preset) => {
          const state = await getPresetInstallState(db, preset);
          return {
            id: state.presetId,
            name: preset.name,
            status: state.status,
            installedCount: state.installedCount,
            totalCount: state.totalCount,
            ...(state.installedVersion ? { installedVersion: state.installedVersion } : {}),
          };
        }),
      );
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 mock / fake-indexeddb 实例绕过。
 */
export function createDefaultSettingsDataProvider(): SettingsDataProvider {
  return createIndexedDbSettingsDataProvider(openDatabase());
}
