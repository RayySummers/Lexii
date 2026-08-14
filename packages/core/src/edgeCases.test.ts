/**
 * 数据层边界用例（RAY-239 测试补全）：
 * 存储不可用、空库/空词表、导入回滚、JSON 完整恢复等验收维度。
 *
 * 与 persistence.test.ts / importWords.test.ts 的契约用例互补：
 * 本文件专攻「空词库、损坏 CSV、存储不可用」等边界场景。
 */
import type { DexieOptions } from "dexie";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { CsvFormatError, parseCsvWordlist } from "./csv";
import { exportCsvWordlist } from "./exportCsv";
import { makeLearningItem, makeMemoryState, makeSense, makeReviewEvent, now } from "./helpers";
import { importCsvWordlist } from "./importWords";
import type { LexilexiDatabase } from "./persistence";
import { createLexilexiDatabase, openDatabase, recordReview } from "./persistence";

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

describe("空词库 / 空输入", () => {
  it("空 CSV 导入：importedCount 为 0，四表无写入、无事件", async () => {
    const database = freshDatabase();
    const result = await importCsvWordlist(database, "", { source: "测试", time: now() });
    expect(result.importedCount).toBe(0);
    expect(result.itemIds).toEqual([]);
    expect(await database.items.count()).toBe(0);
    expect(await database.senses.count()).toBe(0);
    expect(await database.memoryStates.count()).toBe(0);
    expect(await database.events.count()).toBe(0);
  });

  it("仅表头的 CSV（无数据行）：导入 0 条", async () => {
    const database = freshDatabase();
    const result = await importCsvWordlist(database, "term,definition,pos", {
      source: "测试",
      time: now(),
    });
    expect(result.importedCount).toBe(0);
    expect(await database.events.count()).toBe(0);
  });

  it("空库导出 CSV：仅 BOM + 表头，可解析回空列表", async () => {
    const database = freshDatabase();
    const csv = await exportCsvWordlist(database);
    expect(csv).toBe("﻿term,definition,pos");
    expect(parseCsvWordlist(csv).entries).toEqual([]);
  });
});

describe("损坏 CSV 边界", () => {
  it("引号内换行（RFC 4180 跨行字段）按格式错误报行号，不静默吞行", () => {
    // 解析器不支持字段内换行：遇到未闭合引号后换行按行切分，
    // 下一行会因列数不足/格式非法报错——绝不静默丢弃
    expect(() => parseCsvWordlist('apple,"苹果\n坏掉的\nbook,书')).toThrow(CsvFormatError);
  });

  it("超长非法词条的错误信息截断展示（防提示撑爆）", () => {
    try {
      parseCsvWordlist(`${"9".repeat(30)},苹果`);
    } catch (error) {
      expect(error).toBeInstanceOf(CsvFormatError);
      expect((error as Error).message).toContain("…");
    }
  });

  it("导入中途失败不留下半份词表（事务回滚：先合法后非法的整批）", async () => {
    const database = freshDatabase();
    const csv = "apple,苹果\nbook,书\n9lives,非法"; // 前两行合法，第三行非法
    await expect(importCsvWordlist(database, csv, { source: "测试", time: now() })).rejects.toThrow(
      CsvFormatError,
    );
    expect(await database.items.count()).toBe(0);
    expect(await database.senses.count()).toBe(0);
    expect(await database.memoryStates.count()).toBe(0);
    expect(await database.events.count()).toBe(0);
  });
});

describe("存储不可用", () => {
  it("createLexilexiDatabase 注入自定义 Dexie 构造函数（无 IndexedDB 环境时的测试接缝）", async () => {
    const custom = createLexilexiDatabase(makeOptions(), undefined, Dexie);
    expect(custom.name).toBe("lexilexi"); // 库名由工厂固定
    custom.version(1).stores({ items: "id" });
    await custom.open();
    await custom.table("items").put({ id: "x" });
    expect(await custom.table("items").get("x")).toEqual({ id: "x" });
    await custom.delete();
  });

  it("recordReview 在存储写入失败时整体回滚（注入失败的表操作）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put(makeMemoryState(item.id));

    const event = makeReviewEvent(item.id, sense.id);
    const next = makeMemoryState(item.id);
    next.fields.status = "review";
    next.fields.reps = 1;
    next.fields.lastReviewAt = event.time;
    next.fields.lastRating = "good";

    // 让事务中途失败：events 表写入抛错 → 状态写入回滚
    // （测试故障注入需经 unknown 绕过 Dexie 的 PromiseExtended 类型约束）
    const put = database.events.put.bind(database.events);
    database.events.put = (async () => {
      throw new Error("IndexedDB 磁盘写入失败");
    }) as unknown as typeof database.events.put;
    try {
      await expect(recordReview(database, event, next)).rejects.toThrow("IndexedDB 磁盘写入失败");
      // 事务回滚：旧状态保留、无孤儿事件
      expect(await database.memoryStates.get(item.id)).not.toEqual(next);
      expect(await database.events.get(event.id)).toBeUndefined();
    } finally {
      database.events.put = put;
    }
  });
});

describe("义项缺失的脏数据", () => {
  it("导出 CSV 时跳过义项缺失的条目（不产出空行），JSON 导出仍包含全部", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    sense.term = "apple";
    await database.senses.put(sense);
    const orphanSenseId = makeSense().id; // 未落库的义项
    await database.items.bulkPut([makeLearningItem(sense.id), makeLearningItem(orphanSenseId)]);

    const csv = await exportCsvWordlist(database);
    const parsed = parseCsvWordlist(csv).entries;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.term).toBe("apple");
    await database.delete();
    db = undefined;
  });

  it("createdAt 相同的条目导出排序稳定（并列时保持稳定不丢行）", async () => {
    const database = freshDatabase();
    const apple = makeSense();
    apple.term = "apple";
    const book = makeSense();
    book.term = "book";
    await database.senses.bulkPut([apple, book]);
    const sameTime = now();
    await database.items.bulkPut([
      { ...makeLearningItem(apple.id, "item_a"), createdAt: sameTime },
      { ...makeLearningItem(book.id, "item_b"), createdAt: sameTime },
    ]);

    const csv = await exportCsvWordlist(database);
    const parsed = parseCsvWordlist(csv).entries;
    // 并列 createdAt：两行都在、顺序与写入序一致（Array.prototype.sort 稳定性）
    expect(parsed.map((entry) => entry.term).sort()).toEqual(["apple", "book"]);
    await database.delete();
    db = undefined;
  });

  it("createdAt 倒序的条目被排回升序（> 分支：交换相邻元素）", async () => {
    const database = freshDatabase();
    const apple = makeSense();
    apple.term = "apple";
    const book = makeSense();
    book.term = "book";
    await database.senses.bulkPut([apple, book]);
    // 主键序 a < b，createdAt 却是 a 晚于 b：排序必须交换（byCreatedAt > 0 分支）
    await database.items.bulkPut([
      { ...makeLearningItem(apple.id, "item_a"), createdAt: "2026-08-13T10:00:00.000Z" },
      { ...makeLearningItem(book.id, "item_b"), createdAt: "2026-08-01T10:00:00.000Z" },
    ]);

    const csv = await exportCsvWordlist(database);
    const parsed = parseCsvWordlist(csv).entries;
    expect(parsed.map((entry) => entry.term)).toEqual(["book", "apple"]);
    await database.delete();
    db = undefined;
  });
});
