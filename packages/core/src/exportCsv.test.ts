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

  it("纯序列化不输出 BOM（BOM 由导出入口添加，属文件编码层）", () => {
    const csv = serializeWordlistCsv([{ term: "apple", definitions: ["苹果"] }]);
    expect(csv.startsWith("term,definition,pos")).toBe(true);
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

    // gone 被排除；book（更早）排在 apple 之前；解析器忽略 BOM，round-trip 不受影响
    expect(parsed.map((entry) => entry.term)).toEqual(["book", "apple"]);
    expect(csv.startsWith("\uFEFFterm,definition,pos\n")).toBe(true);
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

  it("导出文本前置 UTF-8 BOM（Windows Excel 中文不乱码）", async () => {
    const db = openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    const sense = makeSense();
    sense.term = "apple";
    await db.senses.put(sense);
    await db.items.put(makeLearningItem(sense.id));

    const csv = await exportCsvWordlist(db);
    expect(csv.startsWith("\uFEFFterm,definition,pos\n")).toBe(true);
    // BOM 之后的内容与纯序列化一致
    expect(csv.slice(1)).toBe(
      serializeWordlistCsv([{ term: "apple", definitions: ["你好；打招呼"], pos: "int." }]),
    );
    await db.delete();
  });

  it("空库导出仅 BOM + 表头", async () => {
    const db = openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    expect(await exportCsvWordlist(db)).toBe("\uFEFFterm,definition,pos");
    await db.delete();
  });

  it("同一义项被多个条目共享（生词本复用词库义项，RAY-284）时按 senseId 去重，一词一行", async () => {
    const db = openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    const apple = makeSense();
    apple.term = "apple";
    const book = makeSense();
    book.term = "book";
    await db.senses.bulkPut([apple, book]);
    // 词书条目 + 生词本条目共享同一义项；book 一条正常
    await db.items.bulkPut([
      {
        ...makeLearningItem(apple.id),
        createdAt: "2026-08-01T00:00:00.000Z",
        source: "导入:词书.csv",
      },
      { ...makeLearningItem(apple.id), createdAt: "2026-08-02T00:00:00.000Z", source: "生词本" },
      { ...makeLearningItem(book.id), createdAt: "2026-08-03T00:00:00.000Z" },
    ]);

    const csv = await exportCsvWordlist(db);
    const parsed = parseCsvWordlist(csv).entries;
    expect(parsed.map((entry) => entry.term)).toEqual(["apple", "book"]);
    await db.delete();
  });
});
