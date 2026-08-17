/**
 * 设置页数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入词表 → 导出/导入 round-trip。
 * 与 review/data.test.ts 使用同一 fake-indexeddb 注入方式。
 * RAY-253 反馈 6：loadOverview（数据概览）已随设置页概览区删除，无相关用例。
 * RAY-294：扩展词包数据源测试（getDictionaryPackageSummaries /
 * fetchDictionaryManifest / installDictionaryPackage / markTier1CoveredByTier2）。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  SAMPLE_WORDLIST_CSV,
  SAMPLE_WORDLIST_ROW_COUNT,
  dictionaryDoneKey,
  importCsvWordlist,
  openDatabase,
  parseCsvWordlist,
} from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexedDbSettingsDataProvider } from "./data";

// 富化子路径 mock（RAY-276）：词书安装会内联加载富化数据包填充富化字段，
// 测试用覆盖词书词条的小包替代 3.6MB 真实 enrichment.tier0.data.json，
// 避免装载与解析拖慢用例（与 presets/bootstrap.test.ts 同口径）。
vi.mock("@lexilexi/core/presets/enrichment", async () => {
  const { parseEnrichmentPreset } = await import("@lexilexi/core");
  return {
    ENRICHMENT_TIER0_PRESET: parseEnrichmentPreset(
      {
        id: "web-test-enrichment",
        version: "1.1.0",
        name: "测试富化包",
        generatedAt: "2026-08-16T00:00:00.000Z",
        source: "测试来源（CC BY）",
        entries: [
          [
            "ability",
            "/uˈes-mock/",
            "/uˈkeɪ-mock/",
            "",
            "",
            "",
            "",
            "abilit<能力> · y<后缀>",
            "",
            [],
          ],
        ],
      },
      "web-test-enrichment.json",
    ),
  };
});

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

    // RAY-276 修复范围 2：词书安装内联填充富化字段（mock 富化包覆盖 ability）
    const ability = await db!.senses.filter((sense) => sense.term === "ability").first();
    expect(ability?.ipaUs).toBe("/uˈes-mock/");
    expect(ability?.wordParts).toBe("abilit<能力> · y<后缀>");

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
    { timeout: 60000 },
    async () => {
      const provider = createIndexedDbSettingsDataProvider(db!);

      // 先装六级（5406 词），再装专四冲刺（8733 词）
      // RAY-274 GRE 剔除使 132 个带 GRE 标签的六级词从专四词书中移除，
      // 但 PR2 P1.5 基础词补入有 4 词同时带六级标签（净回流），
      // 因此重叠 = 5406 - 132 + 4 = 5278；去重后总数 = 5406 + (8733 - 5278) = 8861
      await provider.installWordbook("book-cet6");
      const tem4 = await provider.installWordbook("book-tem4");

      expect(tem4.skippedCount).toBe(5278);
      expect(tem4.installedCount).toBe(8733 - 5278);
      expect(await db!.items.count()).toBe(8861);

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

// ─── RAY-294 扩展词包数据源测试 ──────────────────────────────────────────────

describe("扩展词包（RAY-294）", () => {
  it("getDictionaryPackageSummaries：初始全部未安装", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    const summaries = await provider.getDictionaryPackageSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries[0]!.id).toBe("core-en-tier1");
    expect(summaries[0]!.status).toBe("not-installed");
    expect(summaries[0]!.totalCount).toBe(58_244);
    expect(summaries[1]!.id).toBe("core-en-tier2");
    expect(summaries[1]!.status).toBe("not-installed");
    expect(summaries[1]!.totalCount).toBe(401_222);
  });

  it("getDictionaryPackageSummaries：手动写入 done 标记后状态变 installed", async () => {
    // 手动写入 done 标记模拟已安装
    await db!.meta.put({ key: dictionaryDoneKey("core-en-tier1"), value: "1.0.0" });
    const provider = createIndexedDbSettingsDataProvider(db!);
    const summaries = await provider.getDictionaryPackageSummaries();
    const tier1 = summaries.find((s) => s.id === "core-en-tier1");
    expect(tier1?.status).toBe("installed");
    expect(tier1?.installedVersion).toBe("1.0.0");
    const tier2 = summaries.find((s) => s.id === "core-en-tier2");
    expect(tier2?.status).toBe("not-installed");
  });

  it("markTier1CoveredByTier2：Tier 1 状态变为 covered", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    await provider.markTier1CoveredByTier2();
    const summaries = await provider.getDictionaryPackageSummaries();
    const tier1 = summaries.find((s) => s.id === "core-en-tier1");
    expect(tier1?.status).toBe("covered");
    expect(tier1?.installedVersion).toBe("covered-by-tier2");
  });

  it("fetchDictionaryManifest：网络不可用时抛出可读错误", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    // 在测试环境中 fetch 会失败（无本地 manifest 文件），应抛出包含"无法获取词包信息"的错误
    await expect(provider.fetchDictionaryManifest()).rejects.toThrow(/无法获取词包信息/);
  });

  it("installDictionaryPackage：未知包 id 抛错", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    await expect(provider.installDictionaryPackage("unknown-package")).rejects.toThrow(
      "未知扩展词包",
    );
  });

  it("installDictionaryPackage：manifest 不可用时抛出可读错误", async () => {
    const provider = createIndexedDbSettingsDataProvider(db!);
    // fetchDictionaryManifest 抛错（网络不可达）→ installDictionaryPackage 应抛错
    await expect(provider.installDictionaryPackage("core-en-tier1")).rejects.toThrow(
      /无法获取词包信息/,
    );
  });
});
