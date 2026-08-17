/**
 * Tier 1/2 扩展词包安装、检索与管理测试（RAY-294）。
 *
 * - 分块落库（1 条记录/词条，与 installPreset 的 4 条对比）；
 * - 中断续装（进度标记与块同事务，不重复导入）；
 * - 幂等（完成标记命中即跳过）；
 * - 版本升级（增量替换，不清库）；
 * - Tier 1 ⊆ Tier 2 覆盖标记；
 * - 晋升（promoteDictionarySense）；
 * - 检索（searchDictionarySenses + searchAllSenses 跨层合并）。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { LexilexiDatabase } from "./persistence";
import { openDatabase } from "./persistence";
import {
  DICTIONARY_CHUNK_SIZE,
  dictionaryDoneKey,
  dictionaryProgressKey,
  dictionaryUpgradeLockKey,
  downloadAndVerifyPackage,
  getDictionaryPackageState,
  invalidateDictionaryCache,
  installDictionaryPackage,
  markTier1CoveredByTier2,
  promoteDictionarySense,
  resetDictionaryPackageInstall,
  searchDictionarySenses,
} from "./dictionary";
import type { DictionaryPackage, ManifestVariant } from "./dictionary";
import type { PresetWordEntry } from "./presets/types";
import { toSenseId } from "./id";
import { searchAllSenses } from "./search";
import { toSense } from "./importWords";
import type { Sense } from "./domain";

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

/** 生成 n 条测试词条 */
function makeEntries(count: number): PresetWordEntry[] {
  const entries: PresetWordEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      term: `word${i}`,
      definitions: [`定义${i}`, `第二义${i}`],
      pos: "n.",
      ipa: "/test/",
      tags: i % 2 === 0 ? ["四级"] : [],
    });
  }
  return entries;
}

function makePackage(
  entries: PresetWordEntry[],
  id = "core-en-tier1",
  version = "1.0.0",
): DictionaryPackage {
  return {
    id,
    version,
    name: "测试扩展词表",
    lang: "en",
    entries,
  };
}

describe("installDictionaryPackage（分块安装扩展词包）", () => {
  it("跨分块完整落库：1 条记录/词条，source 字段正确", async () => {
    const database = freshDatabase();
    const total = DICTIONARY_CHUNK_SIZE * 2 + 50;
    const pkg = makePackage(makeEntries(total));

    const result = await installDictionaryPackage(database, pkg, {
      time: "2026-08-16T00:00:00.000Z",
      yield: async () => {},
    });

    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.installedCount).toBe(total);
    expect(result.skippedCount).toBe(0);

    // 验证 dictionarySenses 表
    const allSenses = await database.dictionarySenses.toArray();
    expect(allSenses).toHaveLength(total);
    // 验证 source 字段和词条存在（不假设 IDB 迭代顺序）
    expect(allSenses.every((s) => s.source === "core-en-tier1")).toBe(true);
    const terms = new Set(allSenses.map((s) => s.term));
    expect(terms.has("word0")).toBe(true);
    expect(terms.has(`word${total - 1}`)).toBe(true);

    // 验证完成标记
    const done = await database.meta.get(dictionaryDoneKey("core-en-tier1"));
    expect(done?.value).toBe("1.0.0");

    // 验证进度标记已清除
    const progress = await database.meta.get(dictionaryProgressKey("core-en-tier1"));
    expect(progress).toBeUndefined();
  });

  it("幂等：完成标记命中即跳过", async () => {
    const database = freshDatabase();
    const entries = makeEntries(10);
    const pkg = makePackage(entries);

    const first = await installDictionaryPackage(database, pkg, { yield: async () => {} });
    expect(first.status).toBe("installed");

    const second = await installDictionaryPackage(database, pkg, { yield: async () => {} });
    expect(second.status).toBe("already-installed");
    if (second.status === "already-installed") {
      expect(second.installedVersion).toBe("1.0.0");
    }
  });

  it("term 去重：同 term 词条跳过", async () => {
    const database = freshDatabase();
    // 先手动写入一个 apple 到 dictionarySenses
    await database.dictionarySenses.put({
      id: toSenseId("sense_existing"),
      lang: "en",
      term: "apple",
      definitions: ["已存在的苹果"],
      tags: [],
      examples: [],
      source: "core-en-tier1",
    });

    // 安装包含同 term 的包
    const entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果（新）"], pos: "n.", tags: [] },
      { term: "banana", definitions: ["香蕉"], pos: "n.", tags: [] },
    ];
    const pkg = makePackage(entries);

    const result = await installDictionaryPackage(database, pkg, { yield: async () => {} });
    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    // apple 已存在，跳过；banana 新增
    expect(result.installedCount).toBe(1);
    expect(result.skippedCount).toBe(1);

    // 总共 2 条（原 apple + 新 banana）
    const allSenses = await database.dictionarySenses.toArray();
    expect(allSenses).toHaveLength(2);
  });

  it("中断续装：进度标记与块同事务，不重复导入", async () => {
    const database = freshDatabase();
    const total = DICTIONARY_CHUNK_SIZE * 3;
    const pkg = makePackage(makeEntries(total));

    // yield 在每块提交后调用；第 2 次 yield 时前 2 块已提交（800 条）
    let callCount = 0;
    const failingYield = async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("模拟中断");
      }
    };

    await expect(installDictionaryPackage(database, pkg, { yield: failingYield })).rejects.toThrow(
      "模拟中断",
    );

    // 验证进度标记存在（2 块已提交 = 800）
    const progress = await database.meta.get(dictionaryProgressKey("core-en-tier1"));
    expect(progress).toBeDefined();
    expect(Number(progress!.value)).toBe(DICTIONARY_CHUNK_SIZE * 2);

    // 续装：从断点继续（第 3 块）
    const result = await installDictionaryPackage(database, pkg, { yield: async () => {} });
    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.installedCount).toBe(DICTIONARY_CHUNK_SIZE); // 剩余 1 块

    // 总数正确
    const allSenses = await database.dictionarySenses.toArray();
    expect(allSenses).toHaveLength(total);
  });
});

describe("getDictionaryPackageState（安装状态查询）", () => {
  it("未安装", async () => {
    const database = freshDatabase();
    const state = await getDictionaryPackageState(database, "core-en-tier1", 100);
    expect(state.status).toBe("not-installed");
    expect(state.installedCount).toBe(0);
  });

  it("已安装", async () => {
    const database = freshDatabase();
    const pkg = makePackage(makeEntries(10));
    await installDictionaryPackage(database, pkg, { yield: async () => {} });

    const state = await getDictionaryPackageState(database, "core-en-tier1", 10);
    expect(state.status).toBe("installed");
    expect(state.installedVersion).toBe("1.0.0");
  });

  it("被 Tier 2 覆盖", async () => {
    const database = freshDatabase();
    await markTier1CoveredByTier2(database);

    const state = await getDictionaryPackageState(database, "core-en-tier1", 100);
    expect(state.status).toBe("covered");
    expect(state.installedVersion).toBe("covered-by-tier2");
  });
});

describe("resetDictionaryPackageInstall（取消安装后清除进度）", () => {
  it("清除进度标记后状态回退到 not-installed", async () => {
    const database = freshDatabase();
    // 模拟安装中断：写入进度标记但不写完成标记
    await database.meta.put({ key: dictionaryProgressKey("core-en-tier1"), value: "500" });

    // 确认为 installing 状态
    const before = await getDictionaryPackageState(database, "core-en-tier1", 1000);
    expect(before.status).toBe("installing");
    expect(before.installedCount).toBe(500);

    // 取消安装：清除进度
    await resetDictionaryPackageInstall(database, "core-en-tier1");

    // 状态应回退到 not-installed
    const after = await getDictionaryPackageState(database, "core-en-tier1", 1000);
    expect(after.status).toBe("not-installed");
    expect(after.installedCount).toBe(0);
  });

  it("不影响已完成的安装（done 标记保留）", async () => {
    const database = freshDatabase();
    const pkg = makePackage(makeEntries(10));
    await installDictionaryPackage(database, pkg, { yield: async () => {} });

    // 确认为 installed 状态
    const before = await getDictionaryPackageState(database, "core-en-tier1", 10);
    expect(before.status).toBe("installed");

    // reset 不影响已完成的安装
    await resetDictionaryPackageInstall(database, "core-en-tier1");

    const after = await getDictionaryPackageState(database, "core-en-tier1", 10);
    expect(after.status).toBe("installed");
    expect(after.installedVersion).toBe("1.0.0");
  });
});

describe("版本升级（增量替换）", () => {
  it("版本失配触发增量替换：新增词条写入，未变词条跳过，已移除词条删除", async () => {
    const database = freshDatabase();

    // 安装 v1
    const v1Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
      { term: "banana", definitions: ["香蕉"], pos: "n.", tags: [] },
      { term: "cherry", definitions: ["樱桃"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(v1Entries, "core-en-tier1", "1.0.0"), {
      yield: async () => {},
    });

    // 安装 v2（删除 cherry，新增 date，apple/banana 内容不变）
    const v2Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
      { term: "banana", definitions: ["香蕉"], pos: "n.", tags: [] },
      { term: "date", definitions: ["日期"], pos: "n.", tags: [] },
    ];
    const result = await installDictionaryPackage(
      database,
      makePackage(v2Entries, "core-en-tier1", "2.0.0"),
      { yield: async () => {} },
    );

    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.installedCount).toBe(1); // date 新增
    expect(result.skippedCount).toBe(2); // apple, banana 内容未变
    expect(result.updatedCount).toBe(0); // 无内容变更
    expect(result.deletedCount).toBe(1); // cherry 已移除

    // 验证 cherry 已删除
    const allSenses = await database.dictionarySenses.toArray();
    const terms = allSenses.map((s) => s.term);
    expect(terms).toContain("apple");
    expect(terms).toContain("banana");
    expect(terms).toContain("date");
    expect(terms).not.toContain("cherry");

    // 验证版本已更新
    const done = await database.meta.get(dictionaryDoneKey("core-en-tier1"));
    expect(done?.value).toBe("2.0.0");
  });

  it("v2 变更释义 → 落库内容已更新（blocking #2 核心用例）", async () => {
    const database = freshDatabase();

    // 安装 v1
    const v1Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
      { term: "banana", definitions: ["香蕉"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(v1Entries, "core-en-tier1", "1.0.0"), {
      yield: async () => {},
    });

    // 安装 v2：apple 释义变更，banana 不变
    const v2Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果", "苹果公司"], pos: "n.", tags: [] },
      { term: "banana", definitions: ["香蕉"], pos: "n.", tags: [] },
    ];
    const result = await installDictionaryPackage(
      database,
      makePackage(v2Entries, "core-en-tier1", "2.0.0"),
      { yield: async () => {} },
    );

    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.installedCount).toBe(0);
    expect(result.skippedCount).toBe(1); // banana 未变
    expect(result.updatedCount).toBe(1); // apple 释义变更
    expect(result.deletedCount).toBe(0);

    // 验证 apple 释义已更新
    const appleSense = await database.dictionarySenses
      .where("term")
      .equalsIgnoreCase("apple")
      .first();
    expect(appleSense).toBeDefined();
    expect(appleSense!.definitions).toEqual(["苹果", "苹果公司"]);
  });

  it("并发升级：只有一个成功，另一个抛 ConcurrentDictionaryInstallError", async () => {
    const database = freshDatabase();

    // 安装 v1
    const v1Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(v1Entries, "core-en-tier1", "1.0.0"), {
      yield: async () => {},
    });

    // 并发升级到 v2 和 v3
    const v2Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果", "苹果公司"], pos: "n.", tags: [] },
    ];
    const v3Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果（v3）"], pos: "n.", tags: [] },
    ];

    const results = await Promise.allSettled([
      installDictionaryPackage(database, makePackage(v2Entries, "core-en-tier1", "2.0.0"), {
        yield: async () => {},
      }),
      installDictionaryPackage(database, makePackage(v3Entries, "core-en-tier1", "3.0.0"), {
        yield: async () => {},
      }),
    ]);

    // 一个成功，一个失败
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // 失败的那个应该是 ConcurrentDictionaryInstallError
    const rejectedResult = rejected[0] as PromiseRejectedResult;
    expect(rejectedResult.reason).toBeInstanceOf(Error);
    expect((rejectedResult.reason as Error).name).toBe("ConcurrentDictionaryInstallError");

    // 数据库中 apple 只有一条（无重复记录）
    const appleSenses = await database.dictionarySenses
      .where("term")
      .equalsIgnoreCase("apple")
      .toArray();
    expect(appleSenses).toHaveLength(1);
  });

  it("预置过期锁（>10 分钟）→ 安装可正常接管完成", async () => {
    const database = freshDatabase();

    // 安装 v1
    const v1Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(v1Entries, "core-en-tier1", "1.0.0"), {
      yield: async () => {},
    });

    // 模拟崩溃：预置一个 15 分钟前的过期锁
    const expiredTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await database.meta.put({
      key: dictionaryUpgradeLockKey("core-en-tier1"),
      value: expiredTime,
    });

    // 升级到 v2 应能接管过期锁并完成
    const v2Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果", "苹果公司"], pos: "n.", tags: [] },
    ];
    const result = await installDictionaryPackage(
      database,
      makePackage(v2Entries, "core-en-tier1", "2.0.0"),
      { yield: async () => {} },
    );

    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.updatedCount).toBe(1);

    // 升级锁已清除
    const lock = await database.meta.get(dictionaryUpgradeLockKey("core-en-tier1"));
    expect(lock).toBeUndefined();

    // 版本已更新
    const done = await database.meta.get(dictionaryDoneKey("core-en-tier1"));
    expect(done?.value).toBe("2.0.0");
  });

  it("预置未过期锁 + done 已达标 → 返回 already-installed", async () => {
    const database = freshDatabase();

    // 安装 v1
    const v1Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(v1Entries, "core-en-tier1", "1.0.0"), {
      yield: async () => {},
    });

    // 模拟另一标签页正在升级且已完成：预置未过期锁 + done 已更新到 v2
    const recentTime = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    await database.meta.put({
      key: dictionaryUpgradeLockKey("core-en-tier1"),
      value: recentTime,
    });
    await database.meta.put({
      key: dictionaryDoneKey("core-en-tier1"),
      value: "2.0.0",
    });

    // 尝试升级到 v2 → 应返回 already-installed（另一标签页已完成）
    const v2Entries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果", "苹果公司"], pos: "n.", tags: [] },
    ];
    const result = await installDictionaryPackage(
      database,
      makePackage(v2Entries, "core-en-tier1", "2.0.0"),
      { yield: async () => {} },
    );

    expect(result.status).toBe("already-installed");
    if (result.status === "already-installed") {
      expect(result.installedVersion).toBe("2.0.0");
    }
  });
});

describe("promoteDictionarySense（晋升到 senses 表）", () => {
  it("晋升生成新 SenseId，字典条目保留", async () => {
    const database = freshDatabase();
    const entries: PresetWordEntry[] = [
      { term: "kaleidoscope", definitions: ["万花筒"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(entries), { yield: async () => {} });

    const dictSenses = await database.dictionarySenses.toArray();
    expect(dictSenses).toHaveLength(1);
    const dictSenseId = dictSenses[0]!.id;

    // 晋升
    const promoted = await promoteDictionarySense(database, dictSenseId);
    expect(promoted).not.toBeNull();
    expect(promoted!.term).toBe("kaleidoscope");
    expect(promoted!.id).not.toBe(dictSenseId); // 新 SenseId
    expect(promoted!.definitions).toEqual(["万花筒"]);

    // 字典条目仍在
    const stillThere = await database.dictionarySenses.get(dictSenseId);
    expect(stillThere).toBeDefined();

    // senses 表有晋升记录
    const sensesAll = await database.senses.toArray();
    expect(sensesAll).toHaveLength(1);
    expect(sensesAll[0]!.id).toBe(promoted!.id);
  });

  it("不存在的 id 返回 null", async () => {
    const database = freshDatabase();
    const result = await promoteDictionarySense(database, "sense_nonexistent");
    expect(result).toBeNull();
  });
});

describe("searchDictionarySenses（词典表检索）", () => {
  it("前缀命中", async () => {
    const database = freshDatabase();
    const entries: PresetWordEntry[] = [
      { term: "kaleidoscope", definitions: ["万花筒"], pos: "n.", tags: [] },
      { term: "kangaroo", definitions: ["袋鼠"], pos: "n.", tags: [] },
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(entries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchDictionarySenses(database, "kal");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sense.term).toBe("kaleidoscope");
    expect(hits[0]!.kind).toBe("term-prefix");
  });

  it("子串命中（词中匹配）", async () => {
    const database = freshDatabase();
    const entries: PresetWordEntry[] = [
      { term: "microscope", definitions: ["显微镜"], pos: "n.", tags: [] },
      { term: "kaleidoscope", definitions: ["万花筒"], pos: "n.", tags: [] },
      { term: "telescope", definitions: ["望远镜"], pos: "n.", tags: [] },
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(entries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchDictionarySenses(database, "scope");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const terms = hits.map((h) => h.sense.term);
    expect(terms).toContain("microscope");
    expect(terms).toContain("kaleidoscope");
    expect(terms).toContain("telescope");
    // scope 命中的 kind 应为 term-substring（非前缀）
    for (const hit of hits) {
      expect(hit.kind).toBe("term-substring");
    }
  });

  it("释义命中", async () => {
    const database = freshDatabase();
    const entries: PresetWordEntry[] = [
      { term: "microscope", definitions: ["显微镜"], pos: "n.", tags: [] },
      { term: "apple", definitions: ["苹果"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(entries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchDictionarySenses(database, "显微");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sense.term).toBe("microscope");
    expect(hits[0]!.kind).toBe("definition");
  });
});

describe("searchAllSenses（跨层合并检索）", () => {
  it("学习义项优先：同 term 在 senses 和 dictionarySenses 都有时保留学习版本", async () => {
    const database = freshDatabase();

    // 在 senses 表手动写入一个 apple
    const learningSense: Sense = toSense(
      { term: "apple", definitions: ["苹果（学习版）"], pos: "n.", tags: [] },
      "en",
    );
    await database.senses.put(learningSense);

    // 在 dictionarySenses 表写入同 term 的 apple
    const dictEntries: PresetWordEntry[] = [
      { term: "apple", definitions: ["苹果（词典版）"], pos: "n.", tags: [] },
      { term: "banana", definitions: ["香蕉"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(dictEntries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchAllSenses(database, "apple");
    // 应该只返回 1 条（term 去重），且是学习版本
    const appleHits = hits.filter((h) => h.sense.term.toLowerCase() === "apple");
    expect(appleHits).toHaveLength(1);
    expect(appleHits[0]!.sense.definitions[0]).toBe("苹果（学习版）");
  });

  it("词典独有词条也能搜到", async () => {
    const database = freshDatabase();

    // senses 表为空
    const dictEntries: PresetWordEntry[] = [
      { term: "kaleidoscope", definitions: ["万花筒"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(dictEntries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchAllSenses(database, "kaleidoscope");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sense.term).toBe("kaleidoscope");
  });

  it("层内同 term 多义项不折叠（回归 blocking #1）", async () => {
    const database = freshDatabase();

    // 在 senses 表写入同 term 的两个学习义项（CSV 导入可产生，importWords 无 term 查重）
    const sense1: Sense = toSense(
      { term: "bank", definitions: ["银行"], pos: "n.", tags: [] },
      "en",
    );
    const sense2: Sense = toSense(
      { term: "bank", definitions: ["河岸"], pos: "n.", tags: [] },
      "en",
    );
    await database.senses.put(sense1);
    await database.senses.put(sense2);

    // 在 dictionarySenses 表写入同 term 的词典义项（应被跨层过滤）
    const dictEntries: PresetWordEntry[] = [
      { term: "bank", definitions: ["银行（词典版）"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(dictEntries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchAllSenses(database, "bank");
    // 同 term 两个学习义项都应命中（层内按 sense.id 去重，各显一条）
    const bankHits = hits.filter((h) => h.sense.term.toLowerCase() === "bank");
    expect(bankHits).toHaveLength(2);
    // 词典义项应被跨层过滤（学习义项优先）
    expect(bankHits.every((h) => h.sense.definitions[0] !== "银行（词典版）")).toBe(true);
    // 两条都应是 term-prefix 命中
    expect(bankHits.every((h) => h.kind === "term-prefix")).toBe(true);
  });

  it("全局排序：前缀 > 子串 > 释义 → 词长 → 字典序", async () => {
    const database = freshDatabase();

    const dictEntries: PresetWordEntry[] = [
      { term: "scope", definitions: ["范围"], pos: "n.", tags: [] },
      { term: "microscope", definitions: ["显微镜"], pos: "n.", tags: [] },
      { term: "kaleidoscope", definitions: ["万花筒"], pos: "n.", tags: [] },
    ];
    await installDictionaryPackage(database, makePackage(dictEntries), { yield: async () => {} });
    invalidateDictionaryCache();

    const hits = await searchAllSenses(database, "scope");
    // scope 是前缀命中（最优先），其余是子串命中
    expect(hits[0]!.sense.term).toBe("scope");
    expect(hits[0]!.kind).toBe("term-prefix");
    // 后续按词长排序
    const substringHits = hits.slice(1);
    for (const hit of substringHits) {
      expect(hit.kind).toBe("term-substring");
    }
    expect(substringHits[0]!.sense.term.length).toBeLessThanOrEqual(
      substringHits[1]?.sense.term.length ?? Infinity,
    );
  });
});

describe("downloadAndVerifyPackage（元组转换）", () => {
  it("紧凑元组格式正确转换为 PresetWordEntry 对象", async () => {
    // 模拟打包侧输出：[term, definitions, pos, ipa, tags]
    const tuples = [
      ["kaleidoscope", "万花筒", "n.", "/kəˈlaɪdəskoʊp/", ""],
      ["menstrual", "月经的\n经期的", "a.", "/ˈmenstruəl/", "考研"],
    ];
    const jsonBytes = new TextEncoder().encode(JSON.stringify(tuples));

    // 计算 SHA-256
    const hashBuffer = await crypto.subtle.digest("SHA-256", jsonBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // 创建 Blob URL（模拟 fetch 返回）
    const blob = new Blob([jsonBytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const variant: ManifestVariant = {
      url,
      size: jsonBytes.length,
      sha256,
    };

    const entries = await downloadAndVerifyPackage(variant);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.term).toBe("kaleidoscope");
    expect(entries[0]!.definitions).toEqual(["万花筒"]);
    expect(entries[0]!.pos).toBe("n.");
    expect(entries[0]!.ipa).toBe("/kəˈlaɪdəskoʊp/");
    expect(entries[0]!.tags).toEqual([]);

    expect(entries[1]!.term).toBe("menstrual");
    expect(entries[1]!.definitions).toEqual(["月经的", "经期的"]);
    expect(entries[1]!.tags).toEqual(["考研"]);

    URL.revokeObjectURL(url);
  });

  it("build.mjs 结构化对象格式（{entries: [...]}）正确转换", async () => {
    // 模拟 build.mjs 实际输出：{ id, version, name, ..., entries: [[...], ...] }
    const payload = {
      id: "core-en-tier2",
      version: "1.0.0",
      name: "全量词表（清洗后全部词条）",
      generatedAt: "2026-08-17T00:00:00.000Z",
      source: "ECDICT (MIT)",
      entries: [
        ["kaleidoscope", "万花筒", "n.", "/kəˈlaɪdəskoʊp/", ""],
        ["menstrual", "月经的\n经期的", "a.", "/ˈmenstruəl/", "考研"],
      ],
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));

    const hashBuffer = await crypto.subtle.digest("SHA-256", jsonBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const blob = new Blob([jsonBytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const variant: ManifestVariant = {
      url,
      size: jsonBytes.length,
      sha256,
    };

    const entries = await downloadAndVerifyPackage(variant);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.term).toBe("kaleidoscope");
    expect(entries[0]!.definitions).toEqual(["万花筒"]);
    expect(entries[0]!.pos).toBe("n.");
    expect(entries[0]!.tags).toEqual([]);

    expect(entries[1]!.term).toBe("menstrual");
    expect(entries[1]!.definitions).toEqual(["月经的", "经期的"]);
    expect(entries[1]!.tags).toEqual(["考研"]);

    URL.revokeObjectURL(url);
  });

  it("顶层非数组且无 entries 字段时抛出格式错误", async () => {
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ foo: "bar" }));

    const hashBuffer = await crypto.subtle.digest("SHA-256", jsonBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const blob = new Blob([jsonBytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const variant: ManifestVariant = {
      url,
      size: jsonBytes.length,
      sha256,
    };

    await expect(downloadAndVerifyPackage(variant)).rejects.toThrow(
      "包文件格式非法：顶层不是数组且不含 entries 字段",
    );

    URL.revokeObjectURL(url);
  });

  it("entries 字段非数组时抛出格式错误", async () => {
    const jsonBytes = new TextEncoder().encode(
      JSON.stringify({ id: "test", entries: "not-an-array" }),
    );

    const hashBuffer = await crypto.subtle.digest("SHA-256", jsonBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const blob = new Blob([jsonBytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const variant: ManifestVariant = {
      url,
      size: jsonBytes.length,
      sha256,
    };

    await expect(downloadAndVerifyPackage(variant)).rejects.toThrow(
      "包文件格式非法：entries 字段不是数组",
    );

    URL.revokeObjectURL(url);
  });

  it("元组格式安装后可通过 searchDictionarySenses 检索到", async () => {
    const database = freshDatabase();

    // 模拟打包侧元组 → 转换 → 安装
    const tuples = [
      ["kaleidoscope", "万花筒", "n.", "/kəˈlaɪdəskoʊp/", ""],
      ["menstrual", "月经的", "a.", "/ˈmenstruəl/", "考研"],
    ];
    const entries: PresetWordEntry[] = tuples.map((t) => ({
      term: t[0]!,
      definitions: t[1]!.split("\n"),
      ...(t[2] !== "" ? { pos: t[2] } : {}),
      ...(t[3] !== "" ? { ipa: t[3] } : {}),
      tags: t[4]!.split(/\s+/).filter((s) => s !== ""),
    }));

    await installDictionaryPackage(database, makePackage(entries, "core-en-tier2", "1.0.0"), {
      yield: async () => {},
    });
    invalidateDictionaryCache();

    // 前缀命中
    const prefixHits = await searchDictionarySenses(database, "kaleidoscope");
    expect(prefixHits).toHaveLength(1);
    expect(prefixHits[0]!.sense.term).toBe("kaleidoscope");
    expect(prefixHits[0]!.kind).toBe("term-prefix");

    // 子串命中（搜索 "strual" 命中 "menstrual" 的子串）
    const substringHits = await searchDictionarySenses(database, "strual");
    expect(substringHits).toHaveLength(1);
    expect(substringHits[0]!.sense.term).toBe("menstrual");
    expect(substringHits[0]!.kind).toBe("term-substring");

    // 释义命中（中文）
    const defHits = await searchDictionarySenses(database, "万花筒");
    expect(defHits).toHaveLength(1);
    expect(defHits[0]!.sense.term).toBe("kaleidoscope");
    expect(defHits[0]!.kind).toBe("definition");
  });
});
