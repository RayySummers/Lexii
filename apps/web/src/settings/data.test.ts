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

  it("词书库（RAY-262）：10 本词书全部未安装 → 安装 book-zk → 状态变已装且落库", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);

    // 初始：全部未安装
    const before = await provider.getWordbookSummaries();
    expect(before).toHaveLength(10);
    for (const summary of before) {
      expect(summary.status).toBe("not-installed");
    }

    // 安装中考词书（book-zk，1602 词）
    const result = await provider.installWordbook("book-zk");
    expect(result.installedCount).toBe(1602);
    expect(result.skippedCount).toBe(0);
    expect(await db!.items.count()).toBe(1602);

    // 安装后：book-zk 已装，其余未装
    const after = await provider.getWordbookSummaries();
    const zk = after.find((summary) => summary.id === "book-zk");
    expect(zk?.status).toBe("installed");
    expect(zk?.installedCount).toBe(1602);
    const others = after.filter((summary) => summary.id !== "book-zk");
    for (const summary of others) {
      expect(summary.status).toBe("not-installed");
    }

    // 幂等：重复安装不再新增
    const again = await provider.installWordbook("book-zk");
    expect(again).toEqual({ installedCount: 0, skippedCount: 0 });
    expect(await db!.items.count()).toBe(1602);
  });

  it(
    "词书库（RAY-262）：安装重叠词书按 term 去重，不产生重复学习项",
    { timeout: 30000 },
    async () => {
      const provider = createIndexedDbSettingsDataProvider(db!);

      // 先装六级（5406 词），再装专四冲刺（9137 词，含全部六级词 + 托福词）
      await provider.installWordbook("book-cet6");
      const tem4 = await provider.installWordbook("book-tem4");

      // 专四冲刺新增 = 9137 - 5406 = 3731（toefl 独有部分），跳过 5406
      expect(tem4.skippedCount).toBe(5406);
      expect(tem4.installedCount).toBe(9137 - 5406);
      expect(await db!.items.count()).toBe(9137);

      // 两本词书状态均为已装
      const after = await provider.getWordbookSummaries();
      expect(after.find((summary) => summary.id === "book-cet6")?.status).toBe("installed");
      expect(after.find((summary) => summary.id === "book-tem4")?.status).toBe("installed");
    },
  );

  it("词书库（RAY-262）：未知词书 id 抛错", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    await expect(provider.installWordbook("book-unknown")).rejects.toThrow("未知词书");
  });
});
