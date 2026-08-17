/**
 * 首启预设词表引导测试（RAY-258 + RAY-319）。
 *
 * 覆盖产品口径：全新库安装、已有数据跳过、中断续装、幂等跳过。
 * 全部注入 fake-indexeddb 与小预设包，不依赖真实 Tier 0 数据。
 *
 * RAY-319：覆盖核心词书默认安装（bootstrapCoreWordbooks）。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LexiiDatabase, PresetPackage } from "@lexii/core";
import {
  enrichmentDoneKey,
  enrichmentProgressKey,
  importCsvWordlist,
  installPreset,
  openDatabase,
  parseEnrichmentPreset,
  presetProgressKey,
} from "@lexii/core";
import { bootstrapCoreWordbooks, bootstrapPresetData, bootstrapTier0Preset } from "./bootstrap";

// 富化子路径 mock（suggestion 3 入口测试）：避免在测试中装载 3.6MB 的
// 真实 enrichment.tier0.data.json，用覆盖词表首词 "a" 的小包替代。
vi.mock("@lexii/core/presets/enrichment", async () => {
  const { parseEnrichmentPreset } = await import("@lexii/core");
  return {
    ENRICHMENT_TIER0_PRESET: parseEnrichmentPreset(
      {
        id: "web-test-enrichment",
        version: "1.0.0",
        name: "测试富化包",
        generatedAt: "2026-08-15T00:00:00.000Z",
        source: "测试来源（CC BY）",
        entries: [["a", "/uˈes-mock/", "/uˈkeɪ-mock/", "", "", "", "", "", "", []]],
      },
      "web-test-enrichment.json",
    ),
  };
});

// RAY-319：词书子路径 mock——避免在测试中装载 ~2MB 的真实 books.data.json，
// 用小词书包替代（覆盖 bootstrapCoreWordbooks 的产品口径测试）。
vi.mock("@lexii/core/presets/books", async () => {
  const testWordbooks = [
    {
      id: "book-test-zk",
      name: "测试中考词书",
      description: "测试用中考词书",
      category: "exam",
      terms: ["testword0", "testword1", "testword2"],
    },
    {
      id: "book-test-gk",
      name: "测试高考词书",
      description: "测试用高考词书",
      category: "exam",
      terms: ["testword2", "testword3"],
    },
  ];
  const pool = new Map();
  for (const term of ["testword0", "testword1", "testword2", "testword3"]) {
    pool.set(term, {
      term,
      definitions: [`释义_${term}`],
      pos: "n.",
      ipa: "/test/",
      tags: [],
    });
  }
  return {
    WORDBOOK_CATALOG: testWordbooks,
    WORDBOOK_COUNT: testWordbooks.length,
    WORDBOOK_DATA_VERSION: "1.0.0-test",
    WORDBOOK_SOURCE: "测试来源",
    WORDBOOK_POOL: pool,
    getWordbookPackage(book: { id: string; name: string; description: string; terms: string[] }) {
      return {
        id: book.id,
        version: "1.0.0-test",
        name: book.name,
        description: book.description,
        source: "测试来源",
        lang: "en" as const,
        entries: book.terms.map((term) => pool.get(term)!),
      };
    },
  };
});

function makeOptions(): { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange } {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexiiDatabase | undefined;

function freshDatabase(): LexiiDatabase {
  db = openDatabase(makeOptions());
  return db;
}

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

function makePreset(count: number): PresetPackage {
  return {
    id: "web-test-tier0",
    version: "1.0.0",
    name: "测试核心词表",
    source: "测试来源（MIT）",
    lang: "en",
    entries: Array.from({ length: count }, (_, i) => ({
      term: `bootword${i}`,
      definitions: [`引导释义${i}`],
      pos: "n.",
      ipa: "/boot/",
      tags: ["高频"],
    })),
  };
}

describe("bootstrapPresetData（首启内置词表引导）", () => {
  it("全新库：安装内置词表，返回 installed 与数量", async () => {
    const database = freshDatabase();
    const outcome = await bootstrapPresetData(database, makePreset(50));
    expect(outcome).toEqual({ status: "installed", installedCount: 50 });
    expect(await database.items.count()).toBe(50);
    expect(await database.events.where("type").equals("import").count()).toBe(50);
  });

  it("已有数据（导入过词库）：跳过，绝不擅自塞词", async () => {
    const database = freshDatabase();
    await importCsvWordlist(database, "apple,苹果,n.", { source: "用户导入" });

    const outcome = await bootstrapPresetData(database, makePreset(50));
    expect(outcome).toEqual({ status: "skipped-existing-data" });
    expect(await database.items.count()).toBe(1);
  });

  it("已安装完成：幂等跳过", async () => {
    const database = freshDatabase();
    const preset = makePreset(10);
    await bootstrapPresetData(database, preset);

    const again = await bootstrapPresetData(database, preset);
    expect(again).toEqual({ status: "already-installed" });
    expect(await database.items.count()).toBe(10);
  });

  it("安装中曾中断：续装到完整（不重复导入）", async () => {
    const database = freshDatabase();
    const preset = makePreset(1200); // 跨 3 个分块（400/块）
    let yielded = 0;
    await expect(
      installPreset(database, preset, {
        yield: async () => {
          yielded += 1;
          throw new Error("模拟中断");
        },
      }),
    ).rejects.toThrow("模拟中断");
    expect(yielded).toBe(1);
    expect(await database.items.count()).toBe(400);
    expect((await database.meta.get(presetProgressKey(preset.id)))?.value).toBe("400");

    const outcome = await bootstrapPresetData(database, preset);
    expect(outcome.status).toBe("installed");
    expect(await database.items.count()).toBe(1200);
  });

  it("富化内联（RAY-268 新装路径）：引导安装时随词条填充富化字段", async () => {
    const database = freshDatabase();
    const enrichment = parseEnrichmentPreset(
      {
        id: "web-test-enrichment",
        version: "1.0.0",
        name: "测试富化包",
        generatedAt: "2026-08-15T00:00:00.000Z",
        source: "测试来源（CC BY）",
        entries: [
          [
            "bootword0",
            "/uˈes/",
            "/uˈkeɪ/",
            "syn-a\nsyn-b",
            "",
            "",
            "",
            "boot<词根>",
            "",
            [
              ["A boot sentence.", "引导句。"],
              ["More text.", ""],
            ],
          ],
        ],
      },
      "web-test-enrichment.json",
    );

    const outcome = await bootstrapPresetData(database, makePreset(3), enrichment);
    expect(outcome).toEqual({ status: "installed", installedCount: 3 });
    const sense = await database.senses.filter((s) => s.term === "bootword0").first();
    expect(sense?.ipaUs).toBe("/uˈes/");
    expect(sense?.ipaUk).toBe("/uˈkeɪ/");
    expect(sense?.synonyms).toEqual(["syn-a", "syn-b"]);
    expect(sense?.wordParts).toBe("boot<词根>");
    expect(sense?.examples).toEqual([
      { text: "A boot sentence.", translation: "引导句。" },
      { text: "More text.", translation: "" },
    ]);
    // 富化包覆盖不到的词条不受影响
    const other = await database.senses.filter((s) => s.term === "bootword1").first();
    expect(other?.ipaUs).toBeUndefined();
  });
});

describe("bootstrapTier0Preset（入口：新装写完成标记跳过存量回填，suggestion 3）", () => {
  it("全新库：安装内联富化后写完成标记，不再跑全量回填", async () => {
    const database = freshDatabase();
    bootstrapTier0Preset(database);
    // fire-and-forget 入口：等待完成标记落库（真实 Tier 0 全量安装，
    // fake-indexeddb 口径 ~1.3s；全套件并行下放宽到 60s）
    await vi.waitFor(
      async () => {
        const done = await database.meta.get(enrichmentDoneKey("web-test-enrichment"));
        expect(done?.value).toBe("1.0.0");
      },
      { timeout: 30_000, interval: 50 },
    );
    // mock 富化包覆盖词表首词 "a"：安装时已内联填充
    const sense = await database.senses.filter((s) => s.term === "a").first();
    expect(sense?.ipaUs).toBe("/uˈes-mock/");
    // 完成标记写入即清理残留进度
    const progress = await database.meta.get(enrichmentProgressKey("web-test-enrichment"));
    expect(progress).toBeUndefined();
  }, 60_000);
});

describe("bootstrapCoreWordbooks（RAY-319 核心词书默认安装）", () => {
  it("全新库：安装指定词书，返回每本的安装结果", async () => {
    const database = freshDatabase();
    const results = await bootstrapCoreWordbooks(database, ["book-test-zk", "book-test-gk"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ status: "installed", installedCount: 3 });
    // testword2 已被第一本词书安装（按 term 去重），第二本只新增 1 个词条
    expect(results[1]).toEqual({ status: "installed", installedCount: 1 });
    // testword0/1/2/3 共 4 个唯一词条
    expect(await database.items.count()).toBe(4);
  });

  it("已有数据（老用户）：跳过全部词书安装，绝不擅自塞词", async () => {
    const database = freshDatabase();
    await importCsvWordlist(database, "apple,苹果,n.", { source: "用户导入" });

    const results = await bootstrapCoreWordbooks(database, ["book-test-zk", "book-test-gk"]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "skipped-existing-data")).toBe(true);
    expect(await database.items.count()).toBe(1);
  });

  it("已安装完成：幂等跳过", async () => {
    const database = freshDatabase();
    await bootstrapCoreWordbooks(database, ["book-test-zk"]);

    const results = await bootstrapCoreWordbooks(database, ["book-test-zk"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ status: "already-installed" });
  });

  it("未知词书 id：返回 error 状态，不阻塞其余词书安装", async () => {
    const database = freshDatabase();
    const results = await bootstrapCoreWordbooks(database, [
      "book-nonexistent",
      "book-test-zk",
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ status: "error", message: expect.stringContaining("book-nonexistent") });
    expect(results[1]).toEqual({ status: "installed", installedCount: 3 });
  });
});
