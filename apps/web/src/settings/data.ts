/**
 * 设置页数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - exportBackup：exportLexilexiData（完整 JSON 快照）
 * - exportWordlistCsv：exportCsvWordlist（词表 CSV，仅未删除条目）
 * - importBackup：parseLexilexiExport → importLexilexiData（单事务、同 id 覆盖）
 *
 * RAY-253 反馈 6：loadOverview（数据概览）已随设置页概览区删除。
 */
import {
  exportCsvWordlist,
  exportLexilexiData,
  importLexilexiData,
  openDatabase,
  parseLexilexiExport,
} from "@lexilexi/core";
import type { LexilexiDatabase, LexilexiExportData } from "@lexilexi/core";
import type { ImportBackupResult, SettingsDataProvider } from "./types";

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
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 mock / fake-indexeddb 实例绕过。
 */
export function createDefaultSettingsDataProvider(): SettingsDataProvider {
  return createIndexedDbSettingsDataProvider(openDatabase());
}
