import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { CsvFormatError, parseCsvWordlist } from "./csv";
import { isImportEvent } from "./events";
import { importCsvWordlist, toSense } from "./importWords";
import type { LexilexiDatabase } from "./persistence";
import { openDatabase } from "./persistence";
import { SAMPLE_WORDLIST, SAMPLE_WORDLIST_CSV, SAMPLE_WORDLIST_ROW_COUNT } from "./sampleWordlist";

/** 每个用例用独立的 fake-indexeddb 实例（互不干扰） */
function makeOptions(): DexieOptions {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

/** 每个用例用独立数据库实例，避免用例间残留状态 */
function freshDatabase(): LexilexiDatabase {
  db = openDatabase(makeOptions());
  return db;
}

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe("importCsvWordlist（CSV 词表导入）", () => {
  it("导入后在四张表中留下完整记录：sense/item/memoryState/import 事件", async () => {
    const database = freshDatabase();
    const result = await importCsvWordlist(database, "apple,苹果,n.\nbook,书,n.", {
      source: "导入:测试.csv",
      time: "2026-08-13T10:00:00.000Z",
    });

    expect(result.importedCount).toBe(2);
    expect(result.itemIds).toHaveLength(2);

    // 每个条目：sense + item + memoryState + import 事件各一份，且 1─1 锚定
    for (const itemId of result.itemIds) {
      const item = await database.items.get(itemId);
      expect(item?.source).toBe("导入:测试.csv");
      expect(item?.status).toBe("active");
      expect(item?.kind).toBe("word");

      const sense = await database.senses.get(item!.senseId);
      expect(sense?.lang).toBe("en");
      expect(sense?.definitions.length).toBeGreaterThan(0);

      const memoryState = await database.memoryStates.get(itemId);
      expect(memoryState).toBeDefined();
      expect(memoryState?.id).toBe(itemId);
      expect(memoryState?.fields.status).toBe("new");
      expect(memoryState?.fields.due).toBe("2026-08-13T10:00:00.000Z");
      expect(memoryState?.fields.learningSteps).toBe(0);
      expect(memoryState?.fields.lastReviewAt).toBeNull();

      const events = await database.events.where("type").equals("import").toArray();
      const importEvent = events.find((event) => isImportEvent(event) && event.itemId === itemId);
      expect(importEvent).toBeDefined();
      expect(importEvent).toMatchObject({
        type: "import",
        itemId,
        senseId: sense?.id,
        term: sense?.term,
        lang: "en",
        time: "2026-08-13T10:00:00.000Z",
      });
    }
    expect(await database.senses.count()).toBe(2);
    expect(await database.items.count()).toBe(2);
    expect(await database.memoryStates.count()).toBe(2);
    expect(await database.events.count()).toBe(2);
  });

  it("默认词条语言为 en，可覆盖", async () => {
    const database = freshDatabase();
    const result = await importCsvWordlist(database, "apple,苹果", { source: "测试" });
    const item = await database.items.get(result.itemIds[0]!);
    expect((await database.senses.get(item!.senseId))?.lang).toBe("en");
  });

  it("格式错误：不留下半份数据（事务回滚）", async () => {
    const database = freshDatabase();
    const csv = "apple,苹果\n只有一列\n,空单词"; // 第 2 行列数不足、第 3 行单词为空
    await expect(importCsvWordlist(database, csv, { source: "测试" })).rejects.toThrow(
      CsvFormatError,
    );
    await expect(importCsvWordlist(database, csv, { source: "测试" })).rejects.toThrow(/第 2 行/);
    await expect(importCsvWordlist(database, csv, { source: "测试" })).rejects.toThrow(/列数不足/);
    // 全部表保持为空
    expect(await database.senses.count()).toBe(0);
    expect(await database.items.count()).toBe(0);
    expect(await database.memoryStates.count()).toBe(0);
    expect(await database.events.count()).toBe(0);
  });

  it("重复导入同一词表：各行得到新条目（保留全部轨迹）", async () => {
    const database = freshDatabase();
    await importCsvWordlist(database, "apple,苹果", { source: "第一次" });
    await importCsvWordlist(database, "apple,苹果", { source: "第二次" });

    expect(await database.items.count()).toBe(2);
    expect(await database.senses.count()).toBe(2);
    expect(await database.memoryStates.count()).toBe(2);
    expect(await database.events.where("type").equals("import").count()).toBe(2);
  });
});

describe("内置示例词表（许可干净）", () => {
  it("CSV 文本可解析，行数与声明一致", () => {
    const { entries } = parseCsvWordlist(SAMPLE_WORDLIST_CSV);
    expect(entries).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
  });

  it("解析结果与内置列表一致，且每条都有释义", () => {
    expect(SAMPLE_WORDLIST).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    for (const entry of SAMPLE_WORDLIST) {
      expect(entry.term.length).toBeGreaterThan(0);
      expect(entry.definitions.length).toBeGreaterThan(0);
    }
    expect(SAMPLE_WORDLIST.map((entry) => entry.term)).toContain("apple");
    expect(SAMPLE_WORDLIST.map((entry) => entry.term)).toContain("memory");
  });

  it("示例词表可直接走导入接口（端到端）", async () => {
    const database = freshDatabase();
    const result = await importCsvWordlist(database, SAMPLE_WORDLIST_CSV, {
      source: "内置:示例词表.csv",
    });
    expect(result.importedCount).toBe(SAMPLE_WORDLIST_ROW_COUNT);
    expect(await database.items.count()).toBe(SAMPLE_WORDLIST_ROW_COUNT);
    expect(await database.events.where("type").equals("import").count()).toBe(
      SAMPLE_WORDLIST_ROW_COUNT,
    );
  });
});

describe("toSense（词条内容 → 义项快照，含 RAY-268 富化字段）", () => {
  it("基础字段直通，未提供的字段省略或缺省", () => {
    const sense = toSense({ term: "apple", definitions: ["苹果"] }, "en");
    expect(sense.term).toBe("apple");
    expect(sense.definitions).toEqual(["苹果"]);
    expect(sense.lang).toBe("en");
    expect(sense.ipa).toBeUndefined();
    expect(sense.ipaUs).toBeUndefined();
    expect(sense.tags).toEqual([]);
    expect(sense.examples).toEqual([]);
  });

  it("富化字段随内容快照直通（不丢字段、不改形态）", () => {
    const sense = toSense(
      {
        term: "abandon",
        definitions: ["放弃"],
        pos: "v.",
        ipa: "/əˈbændən/",
        ipaUs: "/əˈbændən/",
        ipaUk: "/əˈbændən/",
        synonyms: ["desert", "forsake"],
        antonyms: ["keep"],
        derived: ["abandonment"],
        etymology: "From Old French abandoner.",
        wordParts: "a<加强> · bandon<控制>",
        etymologyZh: "来自古法语 abandoner。",
        examples: [{ text: "He abandoned the car.", translation: "他遗弃了那辆车。" }],
      },
      "en",
    );
    expect(sense.ipaUs).toBe("/əˈbændən/");
    expect(sense.ipaUk).toBe("/əˈbændən/");
    expect(sense.synonyms).toEqual(["desert", "forsake"]);
    expect(sense.antonyms).toEqual(["keep"]);
    expect(sense.derived).toEqual(["abandonment"]);
    expect(sense.etymology).toBe("From Old French abandoner.");
    expect(sense.wordParts).toBe("a<加强> · bandon<控制>");
    expect(sense.etymologyZh).toBe("来自古法语 abandoner。");
    expect(sense.examples).toEqual([
      { text: "He abandoned the car.", translation: "他遗弃了那辆车。" },
    ]);
  });
});
