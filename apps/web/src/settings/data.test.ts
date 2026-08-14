/**
 * 设置页数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入词表 → 导出/导入 round-trip。
 * 与 review/data.test.ts 使用同一 fake-indexeddb 注入方式。
 * RAY-253 反馈 6：loadOverview（数据概览）已随设置页概览区删除，无相关用例。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  SAMPLE_WORDLIST_CSV,
  SAMPLE_WORDLIST_ROW_COUNT,
  importCsvWordlist,
  openDatabase,
  parseCsvWordlist,
} from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbSettingsDataProvider } from "./data";

function makeOptions(): Parameters<typeof openDatabase>[0] {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

beforeEach(() => {
  db = openDatabase(makeOptions());
});

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe("createIndexedDbSettingsDataProvider", () => {
  it("exportBackup → importBackup 原样导回（JSON round-trip）", async () => {
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "测试词表" });
    const provider = createIndexedDbSettingsDataProvider(db!);
    const backup = await provider.exportBackup();
    const json = JSON.stringify(backup);

    // 清空后导入（模拟恢复到新环境）
    await db!.transaction("rw", db!.items, db!.senses, db!.memoryStates, db!.events, async () => {
      await db!.items.clear();
      await db!.senses.clear();
      await db!.memoryStates.clear();
      await db!.events.clear();
    });

    const result = await provider.importBackup(json);
    expect(result.items).toBe(backup.items.length);
    expect(result.senses).toBe(backup.senses.length);
    expect(result.memoryStates).toBe(backup.memoryStates.length);
    expect(result.events).toBe(backup.events.length);

    expect(await db!.items.count()).toBe(SAMPLE_WORDLIST_ROW_COUNT);
  });

  it("exportWordlistCsv 可经 parseCsvWordlist 导回等量词条", async () => {
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "测试词表" });
    const provider = createIndexedDbSettingsDataProvider(db!);
    const csv = await provider.exportWordlistCsv();

    const parsed = parseCsvWordlist(csv).entries;
    expect(parsed).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    // 导出文件前置 UTF-8 BOM（Excel 兼容），解析器忽略 BOM
    expect(csv.startsWith("\uFEFFterm,definition,pos\n")).toBe(true);
  });

  it("importBackup 非法 JSON 抛错，库保持原样", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    await expect(provider.importBackup("not json")).rejects.toThrow("不是合法 JSON");
    expect(await db!.items.count()).toBe(0);
  });
});
