/**
 * 搜词数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：写入义项 → searchAllSenses 检索 →
 * 命中顺序（前缀 > 包含 > 释义）与词库空判定。与 review/data.test.ts
 * 使用同一 fake-indexeddb 注入方式，不依赖浏览器环境。
 *
 * RAY-294：词典来源的 addToNotebook 测试（promote 后再加词）。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDatabase, toSenseId } from "@lexilexi/core";
import type { LexilexiDatabase, Sense } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbSearchDataProvider } from "./data";

function makeSense(n: number, overrides: Partial<Sense> = {}): Sense {
  return {
    id: toSenseId(`sense_web_search_${n}`),
    lang: "en",
    term: `term-${n}`,
    definitions: [`释义 ${n}`],
    tags: [],
    examples: [],
    ...overrides,
  };
}

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

describe("createIndexedDbSearchDataProvider", () => {
  it("空库：search 返回空数组，hasAnySenses 为 false", async () => {
    const provider = createIndexedDbSearchDataProvider(db!);
    expect(await provider.search("a")).toEqual([]);
    expect(await provider.hasAnySenses()).toBe(false);
  });

  it("空白查询返回空数组（不触碰检索逻辑）", async () => {
    await db!.senses.bulkPut([makeSense(1, { term: "apple", definitions: ["苹果"] })]);
    const provider = createIndexedDbSearchDataProvider(db!);
    expect(await provider.search("")).toEqual([]);
    expect(await provider.search("   ")).toEqual([]);
  });

  it("命中顺序由 core 决定：前缀 > 包含 > 释义，返回完整义项", async () => {
    await db!.senses.bulkPut([
      makeSense(1, { term: "apple", definitions: ["苹果", "苹果公司"] }),
      makeSense(2, { term: "pineapple", definitions: ["菠萝"] }),
      makeSense(3, { term: "grape", definitions: ["葡萄", "apple candy"] }),
    ]);
    const provider = createIndexedDbSearchDataProvider(db!);

    const results = await provider.search("apple");
    expect(results.map((result) => result.sense.term)).toEqual(["apple", "pineapple", "grape"]);
    expect(results.map((result) => result.kind)).toEqual([
      "term-prefix",
      "term-substring",
      "definition",
    ]);
    // 释义原文完整透传给 UI 展示
    expect(results[0]!.sense.definitions).toEqual(["苹果", "苹果公司"]);
    expect(await provider.hasAnySenses()).toBe(true);
  });

  it("中文释义关键词命中（大小写不敏感对中文无影响，子串匹配）", async () => {
    await db!.senses.bulkPut([
      makeSense(1, { term: "apple", definitions: ["苹果", "苹果公司"] }),
      makeSense(2, { term: "grape", definitions: ["葡萄"] }),
    ]);
    const provider = createIndexedDbSearchDataProvider(db!);

    const results = await provider.search("苹果");
    expect(results.map((result) => result.sense.term)).toEqual(["apple"]);
    expect(results[0]!.kind).toBe("definition");
  });
});

describe("搜词页生词本加词入口（RAY-284，数据源集成）", () => {
  it("getNotebookSenseIds：空生词本返回空；加词后返回对应义项 id", async () => {
    const sense = makeSense(9, { term: "apple", definitions: ["苹果"] });
    await db!.senses.put(sense);
    const provider = createIndexedDbSearchDataProvider(db!);

    expect(await provider.getNotebookSenseIds()).toEqual([]);

    expect(await provider.addToNotebook(sense.id)).toBe("added");
    expect(await provider.getNotebookSenseIds()).toEqual([sense.id]);
    // 幂等：重复加词返回 already
    expect(await provider.addToNotebook(sense.id)).toBe("already");
  });

  it("词典来源的 senseId 自动 promote 后加入生词本（RAY-294 晋升路径）", async () => {
    // 写入一个 dictionarySense（模拟词典来源）
    const dictSenseId = toSenseId("sense_dict_kaleidoscope");
    await db!.dictionarySenses.put({
      id: dictSenseId,
      lang: "en",
      term: "kaleidoscope",
      definitions: ["万花筒"],
      tags: [],
      examples: [],
      source: "core-en-tier2",
    });
    const provider = createIndexedDbSearchDataProvider(db!);

    // addToNotebook 应自动 promote 到 senses 表再加词
    const result = await provider.addToNotebook(dictSenseId);
    expect(result).toBe("added");

    // senses 表应有 promoted 副本（新 id，非原始 dictSenseId）
    const senses = await db!.senses.toArray();
    expect(senses).toHaveLength(1);
    expect(senses[0]!.term).toBe("kaleidoscope");
    expect(senses[0]!.id).not.toBe(dictSenseId); // promote 生成新 SenseId

    // 生词本应包含 promoted 的 senseId
    expect(await provider.getNotebookSenseIds()).toEqual([senses[0]!.id]);

    // 幂等：再次加词（此时 senses 表已有该 term）返回 already
    const result2 = await provider.addToNotebook(dictSenseId);
    expect(result2).toBe("already");
  });
});
