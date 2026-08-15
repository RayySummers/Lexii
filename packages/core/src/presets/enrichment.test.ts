/**
 * 富化数据装载 / 合并 / 回填测试（RAY-268 批次 A）。
 *
 * 覆盖：
 * - parseEnrichmentPreset / resolveEnrichmentEntry：装载校验与词列表拆分；
 * - toEnrichmentMap：小写词条索引；
 * - mergeEnrichmentIntoContent / mergeEnrichmentIntoSense：只在目标字段
 *   缺失/为空时填充，绝不覆盖既有内容；
 * - backfillEnrichment：存量库回填（单次全量读建内存 Map 分块写回 /
 *   完成标记比对版本 / 幂等 / 进度断点续填 / 不改 schema / 不新增词条 /
 *   不触碰富化包覆盖不到的词条）；
 * - markEnrichmentDone：新装路径完成标记（含残留进度清理）。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { installPreset } from "./install";
import { toSense } from "../importWords";
import type { LexilexiDatabase } from "../persistence";
import { openDatabase } from "../persistence";
import {
  backfillEnrichment,
  ENRICHMENT_CHUNK_SIZE,
  enrichmentDoneKey,
  enrichmentProgressKey,
  markEnrichmentDone,
  mergeEnrichmentIntoContent,
  mergeEnrichmentIntoSense,
  parseEnrichmentPreset,
  resolveEnrichmentEntry,
  toEnrichmentMap,
} from "./enrichment";
import type { EnrichmentPresetPackage, PresetPackage, PresetWordEntry } from "./types";

function makeOptions(): DexieOptions {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

function freshDatabase(): LexilexiDatabase {
  db = openDatabase(makeOptions());
  return db;
}

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

/** 生成富化元组：[term, ipaUs, ipaUk, syn, ant, der, ety, wordParts, etyZh, examples] */
function enrichmentTuple(
  term: string,
): [string, string, string, string, string, string, string, string, string, [string, string][]] {
  return [
    term,
    `/uˈes-${term}/`,
    `/uˈkeɪ-${term}/`,
    `near-${term}-a\nnear-${term}-b`,
    `opp-${term}`,
    `derived-${term}`,
    `From Latin ${term}.`,
    `pre<前缀> · ${term}<词根>`,
    `${term} 的中文词源。`,
    [
      [`The ${term} is here.`, `${term} 在这里。`],
      [`Another ${term} sentence.`, ""],
    ],
  ];
}

function makeEnrichmentPreset(
  entries: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    [string, string][],
  ][],
  version = "1.0.0",
): EnrichmentPresetPackage {
  return parseEnrichmentPreset(
    {
      id: "test-enrichment",
      version,
      name: "测试富化包",
      generatedAt: "2026-08-15T00:00:00.000Z",
      source: "测试来源（CC BY）",
      entries,
    },
    "test-enrichment.json",
  );
}

/** 生成词表预设条目（与富化包 join 用） */
function makeWordEntries(count: number): PresetWordEntry[] {
  const entries: PresetWordEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      term: `testword${i}`,
      definitions: [`释义${i}`],
      pos: "n.",
      ipa: "/legacy/",
      tags: ["四级"],
    });
  }
  return entries;
}

function makeWordPreset(entries: PresetWordEntry[]): PresetPackage {
  return {
    id: "test-tier0",
    version: "1.0.0",
    name: "测试核心词表",
    source: "测试来源（MIT）",
    lang: "en",
    entries,
  };
}

describe("resolveEnrichmentEntry / parseEnrichmentPreset（装载校验）", () => {
  it("元组解析：换行词列表拆分、空串字段缺失、例句数组直通", () => {
    const entry = resolveEnrichmentEntry(enrichmentTuple("testword"), 0, "test.json");
    expect(entry.term).toBe("testword");
    expect(entry.ipaUs).toBe("/uˈes-testword/");
    expect(entry.ipaUk).toBe("/uˈkeɪ-testword/");
    expect(entry.synonyms).toEqual(["near-testword-a", "near-testword-b"]);
    expect(entry.antonyms).toEqual(["opp-testword"]);
    expect(entry.derived).toEqual(["derived-testword"]);
    expect(entry.etymology).toBe("From Latin testword.");
    expect(entry.wordParts).toBe("pre<前缀> · testword<词根>");
    expect(entry.etymologyZh).toBe("testword 的中文词源。");
    expect(entry.examples).toEqual([
      { text: "The testword is here.", translation: "testword 在这里。" },
      { text: "Another testword sentence.", translation: "" },
    ]);
  });

  it("空字段词条只携带非空字段；全空词条在包装载时抛错", () => {
    const emptyEntry = resolveEnrichmentEntry(
      ["bare", "", "", "", "", "", "", "", "", []],
      0,
      "test.json",
    );
    expect(emptyEntry).toEqual({ term: "bare", examples: [] });
    expect(() =>
      parseEnrichmentPreset(
        {
          id: "t",
          version: "1",
          name: "n",
          generatedAt: "g",
          source: "s",
          entries: [["bare", "", "", "", "", "", "", "", "", []]],
        },
        "test.json",
      ),
    ).toThrow(/无任何富化字段/);
  });

  it("形状非法立即抛错：缺少 id / 元组长度不符 / 词条为空 / entries 为空", () => {
    const base = {
      id: "t",
      version: "1",
      name: "n",
      generatedAt: "g",
      source: "s",
      entries: [enrichmentTuple("a")],
    };
    expect(() => parseEnrichmentPreset({ ...base, id: "" }, "test.json")).toThrow(/缺少富化包 id/);
    expect(() => parseEnrichmentPreset({ ...base, entries: [["short"]] }, "test.json")).toThrow(
      /元组长度非法/,
    );
    expect(() =>
      parseEnrichmentPreset(
        { ...base, entries: [["", "/i/", "", "", "", "", "", "", "", []]] },
        "test.json",
      ),
    ).toThrow(/词条为空/);
    expect(() => parseEnrichmentPreset({ ...base, entries: [] }, "test.json")).toThrow(
      /词条为空或格式非法/,
    );
  });
});

describe("toEnrichmentMap / 合并口径", () => {
  const pkg = makeEnrichmentPreset([enrichmentTuple("testword"), enrichmentTuple("other")]);

  it("toEnrichmentMap 按小写词条建索引（防御性规范化）", () => {
    const map = toEnrichmentMap(pkg);
    expect(map.size).toBe(2);
    expect(map.get("testword")?.ipaUs).toBe("/uˈes-testword/");
  });

  it("mergeEnrichmentIntoContent：目标字段缺失时填充，已有内容不覆盖", () => {
    const map = toEnrichmentMap(pkg);
    const enrichment = map.get("testword")!;
    // 空内容 → 全量填充
    const filled = mergeEnrichmentIntoContent(
      { term: "testword", definitions: ["释义"] },
      enrichment,
    );
    expect(filled.ipaUs).toBe("/uˈes-testword/");
    expect(filled.synonyms).toEqual(["near-testword-a", "near-testword-b"]);
    expect(filled.examples).toHaveLength(2);
    expect(filled.wordParts).toBe("pre<前缀> · testword<词根>");
    // 已有内容 → 保持原样（用户编辑 / 其它词库导入不被富化覆盖）
    const preserved = mergeEnrichmentIntoContent(
      {
        term: "testword",
        definitions: ["释义"],
        ipaUs: "/custom/",
        synonyms: ["mine"],
        examples: [{ text: "My sentence.", translation: "我的句子。" }],
      },
      enrichment,
    );
    expect(preserved.ipaUs).toBe("/custom/");
    expect(preserved.synonyms).toEqual(["mine"]);
    expect(preserved.examples).toEqual([{ text: "My sentence.", translation: "我的句子。" }]);
    expect(preserved.ipaUk).toBe("/uˈkeɪ-testword/"); // 未提供的字段仍填充
    expect(preserved.derived).toEqual(["derived-testword"]);
  });

  it("mergeEnrichmentIntoSense：无变化返回原引用，有变化返回新对象", () => {
    const map = toEnrichmentMap(pkg);
    const enrichment = map.get("testword")!;
    const bare = toSense({ term: "testword", definitions: ["释义"] }, "en");
    const filled = mergeEnrichmentIntoSense(bare, enrichment);
    expect(filled).not.toBe(bare);
    expect(filled.ipaUs).toBe("/uˈes-testword/");
    expect(filled.examples).toHaveLength(2);
    // 已填充过的 Sense 再合并 → 原引用（无变化）
    expect(mergeEnrichmentIntoSense(filled, enrichment)).toBe(filled);
    // 无对应富化词条 → 原引用
    expect(mergeEnrichmentIntoSense(bare, undefined)).toBe(bare);
  });
});

describe("backfillEnrichment（存量库回填）", () => {
  it("按 term join 回填既有 Sense：只补字段、不新增词条、不动覆盖外词条", async () => {
    const database = freshDatabase();
    await installPreset(database, makeWordPreset(makeWordEntries(3)), { yield: async () => {} });
    const pkg = makeEnrichmentPreset([
      enrichmentTuple("testword0"),
      enrichmentTuple("uninstalled"),
    ]);

    const result = await backfillEnrichment(database, pkg, { yield: async () => {} });

    expect(result).toEqual({ status: "backfilled", filledCount: 1 });
    expect(await database.senses.count()).toBe(3); // 未新增词条
    const sense0 = await database.senses.filter((s) => s.term === "testword0").first();
    expect(sense0?.ipaUs).toBe("/uˈes-testword0/");
    expect(sense0?.ipaUk).toBe("/uˈkeɪ-testword0/");
    expect(sense0?.synonyms).toEqual(["near-testword0-a", "near-testword0-b"]);
    expect(sense0?.wordParts).toBe("pre<前缀> · testword0<词根>");
    expect(sense0?.etymologyZh).toBe("testword0 的中文词源。");
    expect(sense0?.examples).toHaveLength(2);
    // 覆盖外词条不受影响（无任何富化字段）
    const sense1 = await database.senses.filter((s) => s.term === "testword1").first();
    expect(sense1?.ipaUs).toBeUndefined();
    expect(sense1?.examples).toEqual([]);
    // 原有 ipa（ECDICT 音标）保留
    expect(sense0?.ipa).toBe("/legacy/");
  });

  it("幂等：完成标记命中即跳过；标记为包版本，进度标记清理", async () => {
    const database = freshDatabase();
    await installPreset(database, makeWordPreset(makeWordEntries(1)), { yield: async () => {} });
    const pkg = makeEnrichmentPreset([enrichmentTuple("testword0")]);

    await backfillEnrichment(database, pkg, { yield: async () => {} });
    expect((await database.meta.get(enrichmentDoneKey(pkg.id)))?.value).toBe(pkg.version);
    expect(await database.meta.get(enrichmentProgressKey(pkg.id))).toBeUndefined();

    const again = await backfillEnrichment(database, pkg, { yield: async () => {} });
    expect(again).toEqual({ status: "already-backfilled", version: pkg.version });
  });

  it("完成标记比对版本（suggestion 2）：版本不一致重跑回填，一致才跳过", async () => {
    const database = freshDatabase();
    await installPreset(database, makeWordPreset(makeWordEntries(1)), { yield: async () => {} });
    // v1 只带 ipaUs
    const pkgV1 = makeEnrichmentPreset([
      ["testword0", "/uˈes-v1/", "", "", "", "", "", "", "", []],
    ]);
    await backfillEnrichment(database, pkgV1, { yield: async () => {} });

    // 同版本 → 跳过
    const same = await backfillEnrichment(database, pkgV1, { yield: async () => {} });
    expect(same).toEqual({ status: "already-backfilled", version: "1.0.0" });

    // v2 扩字段 → 版本不一致重跑，新字段补进存量词条（扩字段/换数据后
    // 存量用户能收到新回填；合并口径幂等，重跑安全）
    const pkgV2 = makeEnrichmentPreset(
      [["testword0", "/uˈes-v2/", "", "", "", "", "", "v2<词根>", "", []]],
      "2.0.0",
    );
    const rerun = await backfillEnrichment(database, pkgV2, { yield: async () => {} });
    expect(rerun).toEqual({ status: "backfilled", filledCount: 1 });
    const updated = await database.senses.filter((s) => s.term === "testword0").first();
    expect(updated?.wordParts).toBe("v2<词根>");
    expect(updated?.ipaUs).toBe("/uˈes-v1/"); // 已填字段不被覆盖（合并口径）
    expect((await database.meta.get(enrichmentDoneKey(pkgV2.id)))?.value).toBe("2.0.0");
    // 重跑后同版本再次跳过
    const after = await backfillEnrichment(database, pkgV2, { yield: async () => {} });
    expect(after).toEqual({ status: "already-backfilled", version: "2.0.0" });
  });

  it("进度断点续填：不重复处理已完成的词条", async () => {
    const database = freshDatabase();
    await installPreset(database, makeWordPreset(makeWordEntries(3)), { yield: async () => {} });
    const pkg = makeEnrichmentPreset([enrichmentTuple("testword0"), enrichmentTuple("testword1")]);
    // 模拟中断：进度已推进到 1（testword0 已完成）
    await database.meta.put({ key: enrichmentProgressKey(pkg.id), value: "1" });

    const result = await backfillEnrichment(database, pkg, { yield: async () => {} });

    expect(result).toEqual({ status: "backfilled", filledCount: 1 });
    const sense1 = await database.senses.filter((s) => s.term === "testword1").first();
    expect(sense1?.ipaUs).toBe("/uˈes-testword1/");
    // 进度断点前的词条未被回填（续填不重复处理）
    const sense0 = await database.senses.filter((s) => s.term === "testword0").first();
    expect(sense0?.ipaUs).toBeUndefined();
    expect((await database.meta.get(enrichmentDoneKey(pkg.id)))?.value).toBe(pkg.version);
  });

  it("已存在字段不覆盖：用户例句/编辑保留，富化只填空缺", async () => {
    const database = freshDatabase();
    await installPreset(database, makeWordPreset(makeWordEntries(1)), { yield: async () => {} });
    const sense = await database.senses.filter((s) => s.term === "testword0").first();
    await database.senses.put({
      ...sense!,
      examples: [{ text: "User sentence.", translation: "用户例句。" }],
      synonyms: ["user-synonym"],
    });
    const pkg = makeEnrichmentPreset([enrichmentTuple("testword0")]);

    const result = await backfillEnrichment(database, pkg, { yield: async () => {} });

    // 例句与近义词已有 → 不改写；其余字段照常填充
    expect(result).toEqual({ status: "backfilled", filledCount: 1 });
    const updated = await database.senses.filter((s) => s.term === "testword0").first();
    expect(updated?.examples).toEqual([{ text: "User sentence.", translation: "用户例句。" }]);
    expect(updated?.synonyms).toEqual(["user-synonym"]);
    expect(updated?.ipaUs).toBe("/uˈes-testword0/");
    expect(updated?.antonyms).toEqual(["opp-testword0"]);
  });

  it('大小写不敏感命中：用户词条 "Apple" 命中富化包小写词条', async () => {
    const database = freshDatabase();
    const appleSense = toSense({ term: "Apple", definitions: ["苹果"] }, "en");
    await database.senses.put(appleSense);
    const pkg = makeEnrichmentPreset([enrichmentTuple("apple")]);

    const result = await backfillEnrichment(database, pkg, { yield: async () => {} });

    expect(result).toEqual({ status: "backfilled", filledCount: 1 });
    const updated = await database.senses.get(appleSense.id);
    expect(updated?.term).toBe("Apple"); // 词条原文不动
    expect(updated?.ipaUs).toBe("/uˈes-apple/");
  });

  it("跨分块完整回填（超过 ENRICHMENT_CHUNK_SIZE 个词条）", async () => {
    const database = freshDatabase();
    const total = ENRICHMENT_CHUNK_SIZE + 2;
    const entries = makeWordEntries(total);
    await installPreset(database, makeWordPreset(entries), { yield: async () => {} });
    const pkg = makeEnrichmentPreset(
      entries.slice(0, total).map((entry) => enrichmentTuple(entry.term)),
    );

    const result = await backfillEnrichment(database, pkg, { yield: async () => {} });

    expect(result).toEqual({ status: "backfilled", filledCount: total });
    const last = await database.senses.filter((s) => s.term === `testword${total - 1}`).first();
    expect(last?.ipaUs).toBe(`/uˈes-testword${total - 1}/`);
  });
});

describe("markEnrichmentDone（新装路径完成标记，suggestion 3）", () => {
  it("写包版本完成标记并清理残留进度，之后回填直接跳过", async () => {
    const database = freshDatabase();
    const pkg = makeEnrichmentPreset([enrichmentTuple("testword0")]);
    // 残留进度（模拟中断续填留下的断点）
    await database.meta.put({ key: enrichmentProgressKey(pkg.id), value: "3" });

    await markEnrichmentDone(database, pkg);

    expect((await database.meta.get(enrichmentDoneKey(pkg.id)))?.value).toBe(pkg.version);
    expect(await database.meta.get(enrichmentProgressKey(pkg.id))).toBeUndefined();
    const result = await backfillEnrichment(database, pkg, { yield: async () => {} });
    expect(result).toEqual({ status: "already-backfilled", version: pkg.version });
  });
});
