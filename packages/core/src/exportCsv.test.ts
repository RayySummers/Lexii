import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { CsvWordEntry } from "./csv";
import { parseCsvWordlist } from "./csv";
import { exportCsvWordlist, serializeWordlistCsv } from "./exportCsv";
import { makeLearningItem, makeSense } from "./helpers";
import { openDatabase } from "./persistence";

describe("serializeWordlistCsv", () => {
  it("输出表头与数据行，多条释义用全角分号连接", () => {
    const csv = serializeWordlistCsv([
      { term: "apple", definitions: ["苹果", "一种水果"] },
      { term: "book", definitions: ["书"], pos: "n." },
    ]);
    expect(csv).toBe(["term,definition,pos", "apple,苹果；一种水果,", "book,书,n."].join("\n"));
  });

  it("字段含逗号/引号时按 RFC 4180 加引号并转义，round-trip 一致", () => {
    const entries: CsvWordEntry[] = [
      { term: "hello", definitions: ["你好，打招呼"], pos: "int." },
      { term: "quote", definitions: ['含"引号"的释义'] },
    ];
    const parsed = parseCsvWordlist(serializeWordlistCsv(entries)).entries;
    expect(parsed).toEqual(entries);
  });

  it("空列表只输出表头，解析回空列表", () => {
    const csv = serializeWordlistCsv([]);
    expect(csv).toBe("term,definition,pos");
    expect(parseCsvWordlist(csv).entries).toEqual([]);
  });
});

describe("exportCsvWordlist", () => {
  it("只导出未删除条目，按 createdAt 升序，可经 parseCsvWordlist 导回", async () => {
    const db = openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    const apple = makeSense();
    apple.term = "apple";
    const book = makeSense();
    book.term = "book";
    const gone = makeSense();
    gone.term = "gone";
    await db.senses.bulkPut([apple, book, gone]);
    await db.items.bulkPut([
      { ...makeLearningItem(apple.id), createdAt: "2026-08-02T00:00:00.000Z", status: "active" },
      { ...makeLearningItem(book.id), createdAt: "2026-08-01T00:00:00.000Z", status: "suspended" },
      { ...makeLearningItem(gone.id), createdAt: "2026-08-03T00:00:00.000Z", status: "deleted" },
    ]);

    const csv = await exportCsvWordlist(db);
    const parsed = parseCsvWordlist(csv).entries;

    // gone 被排除；book（更早）排在 apple 之前
    expect(parsed.map((entry) => entry.term)).toEqual(["book", "apple"]);
    expect(csv.startsWith("term,definition,pos\n")).toBe(true);
    await db.delete();
  });

  it("义项缺失的脏数据被跳过，不产出空行", async () => {
    const db = openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    const sense = makeSense();
    sense.term = "apple";
    await db.senses.put(sense);
    // 一条指向存在的义项，一条指向不存在的义项（脏数据，未落库）
    const orphanSenseId = makeSense().id;
    await db.items.bulkPut([makeLearningItem(sense.id), makeLearningItem(orphanSenseId)]);

    const csv = await exportCsvWordlist(db);
    const parsed = parseCsvWordlist(csv).entries;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.term).toBe("apple");
    await db.delete();
  });

  it("空库导出仅表头", async () => {
    const db = openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    expect(await exportCsvWordlist(db)).toBe("term,definition,pos");
    await db.delete();
  });
});
