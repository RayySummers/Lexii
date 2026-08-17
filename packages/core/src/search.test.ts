/**
 * 本地词条检索测试（RAY-266 搜词）。
 *
 * 覆盖口径：拼写前缀 / 拼写包含 / 释义命中、大小写不敏感、优先级排序、
 * 去重、结果上限、空白与超长查询、空库。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./persistence";
import type { LexiiDatabase } from "./persistence";
import { DEFAULT_SEARCH_LIMIT, searchLexiiSenses, searchSenses } from "./search";
import type { Sense } from "./domain";
import { toSenseId } from "./id";

function makeSense(n: number, overrides: Partial<Sense> = {}): Sense {
  return {
    id: toSenseId(`sense_search_${n}`),
    lang: "en",
    term: `term-${n}`,
    definitions: [`释义 ${n}`],
    tags: [],
    examples: [],
    ...overrides,
  };
}

const SENSES: Sense[] = [
  makeSense(1, { term: "apple", definitions: ["苹果", "苹果公司"] }),
  makeSense(2, { term: "abandon", definitions: ["放弃；抛弃"] }),
  makeSense(3, { term: "apply", definitions: ["申请；应用", "涂抹"] }),
  makeSense(4, { term: "pineapple", definitions: ["菠萝"] }),
  makeSense(5, { term: "grape", definitions: ["葡萄", "苹果味糖果"] }),
];

describe("searchSenses（纯函数口径）", () => {
  it("空白查询返回空结果", () => {
    expect(searchSenses(SENSES, "")).toEqual([]);
    expect(searchSenses(SENSES, "   ")).toEqual([]);
  });

  it("拼写前缀命中：大小写不敏感，短词优先，同长按字典序", () => {
    const hits = searchSenses(SENSES, "app");
    expect(hits.map((hit) => hit.sense.term)).toEqual(["apple", "apply", "pineapple"]);
    expect(hits.map((hit) => hit.kind)).toEqual(["term-prefix", "term-prefix", "term-substring"]);
  });

  it("拼写前缀大小写不敏感（大写查询同样命中）", () => {
    const hits = searchSenses(SENSES, "APPLE");
    expect(hits.map((hit) => hit.sense.term)).toEqual(["apple", "pineapple"]);
  });

  it("拼写包含命中排在释义命中之前", () => {
    // 追加一条释义含 "apple" 的义项，构造三层命中
    const senses: Sense[] = [
      ...SENSES,
      makeSense(6, { term: "grape", definitions: ["apple candy"] }),
    ];
    const hits = searchSenses(senses, "apple");
    // apple（前缀）、pineapple（包含）、grape(6)（释义命中）
    expect(hits.map((hit) => hit.sense.term)).toEqual(["apple", "pineapple", "grape"]);
    expect(hits.map((hit) => hit.kind)).toEqual(["term-prefix", "term-substring", "definition"]);
  });

  it("释义命中：任一义项包含查询串（中文子串）", () => {
    const hits = searchSenses(SENSES, "苹果");
    expect(hits.map((hit) => hit.sense.term)).toEqual(["apple", "grape"]);
    expect(hits.every((hit) => hit.kind === "definition")).toBe(true);
  });

  it("无命中返回空结果", () => {
    expect(searchSenses(SENSES, "zzz")).toEqual([]);
  });

  it("同一义项只保留最高优先级命中类型，重复输入去重", () => {
    const duplicated: Sense[] = [
      makeSense(9, { term: "apple", definitions: ["苹果"] }),
      makeSense(9, { term: "apple", definitions: ["苹果"] }), // 同 id 重复
    ];
    const hits = searchSenses(duplicated, "app");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("term-prefix");
  });

  it("前缀优先于释义：同时可前缀与释义命中时只计前缀", () => {
    const senses: Sense[] = [
      makeSense(11, { term: "hand", definitions: ["手", "handsome 的缩写？不"] }),
    ];
    const hits = searchSenses(senses, "hand");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("term-prefix");
  });

  it("limit 截取结果；limit ≤ 0 视为不限制", () => {
    const hits = searchSenses(SENSES, "a", { limit: 2 });
    expect(hits).toHaveLength(2);
    expect(searchSenses(SENSES, "a", { limit: 0 }).length).toBeGreaterThan(2);
    // 默认上限
    const many = Array.from({ length: DEFAULT_SEARCH_LIMIT + 5 }, (_, i) =>
      makeSense(100 + i, { term: `w${i}` }),
    );
    expect(searchSenses(many, "w")).toHaveLength(DEFAULT_SEARCH_LIMIT);
  });

  it("查询串超长截断后仍可检索（防御脏输入，不抛错）", () => {
    const long = `a${"b".repeat(500)}`;
    expect(() => searchSenses(SENSES, long)).not.toThrow();
    // 截断后（前 100 字符）与词条/释义无交集 → 无命中
    expect(searchSenses(SENSES, long)).toEqual([]);
    // 截断保留前 100 字符：命中长释义中包含的重复串
    const longDefinition = `${"x".repeat(150)}苹果`;
    const longQuery = "x".repeat(200);
    const hits = searchSenses(
      [makeSense(200, { term: "longword", definitions: [longDefinition] })],
      longQuery,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("definition");
  });
});

describe("searchLexiiSenses（IndexedDB 只读检索）", () => {
  let db: LexiiDatabase | undefined;

  function makeOptions(): Parameters<typeof openDatabase>[0] {
    return { indexedDB: new IDBFactory(), IDBKeyRange };
  }

  beforeEach(() => {
    db = openDatabase(makeOptions());
  });

  afterEach(async () => {
    await db?.delete();
    db = undefined;
  });

  it("空库返回空结果", async () => {
    expect(await searchLexiiSenses(db!, "a")).toEqual([]);
  });

  it("在库内义项中检索并返回完整义项", async () => {
    await db!.senses.bulkPut(SENSES);
    const hits = await searchLexiiSenses(db!, "app", { limit: 5 });
    expect(hits.map((hit) => hit.sense.term)).toEqual(["apple", "apply", "pineapple"]);
    expect(hits[0]!.sense.definitions).toEqual(["苹果", "苹果公司"]);
    expect(hits[0]!.kind).toBe("term-prefix");
    expect(hits[2]!.kind).toBe("term-substring");
  });

  it("检索只读：不修改 senses 表内容", async () => {
    await db!.senses.bulkPut(SENSES);
    const before = await db!.senses.count();
    await searchLexiiSenses(db!, "apple");
    expect(await db!.senses.count()).toBe(before);
    const stored = await db!.senses.get(toSenseId("sense_search_1"));
    expect(stored?.term).toBe("apple");
  });
});
