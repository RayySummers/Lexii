/**
 * 开发者面板数据源测试（RAY-297 任务 B）：
 * 数据库现状（库名 / schema 版本 / 各表记录数）、FSRS 调试快照
 * （参数同源、状态计数、到期样例窗口与截断）、清库行为。
 *
 * 每个用例用独立 fake-indexeddb 实例（与 packages/core 测试同模式），
 * 不触碰真实 IndexedDB。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { DB_SCHEMA_VERSION, openDatabase } from "@lexii/core";
import type { LexiiDatabase } from "@lexii/core";
import { makeItem, makeMemory, makeSense } from "../../review/testFixtures";
import { createIndexedDbDeveloperDataProvider, loadDatabaseDebug, loadFsrsDebug } from "./data";

function makeOptions() {
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

describe("loadDatabaseDebug 数据库现状", () => {
  it("返回库名 / schema 版本（= core 的 DB_SCHEMA_VERSION）与各表记录数", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeItem(sense.id);
    const memory = makeMemory(item.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put(memory);
    await database.meta.put({ key: "preset:core-en-tier0:done", value: "1" });

    const debug = await loadDatabaseDebug(database);
    expect(debug.dbName).toBe("lexii");
    expect(debug.schemaVersion).toBe(DB_SCHEMA_VERSION);

    const byName = new Map(debug.tables.map((table) => [table.name, table.count]));
    expect(byName.get("items")).toBe(1);
    expect(byName.get("senses")).toBe(1);
    expect(byName.get("memoryStates")).toBe(1);
    expect(byName.get("events")).toBe(0);
    expect(byName.get("meta")).toBe(1);
  });
});

describe("loadFsrsDebug FSRS 调试快照", () => {
  it("参数与调度器默认参数同源（normalizeParameters 默认值）", async () => {
    const database = freshDatabase();
    const debug = await loadFsrsDebug(database);
    expect(debug.parameters.request_retention).toBe(0.9);
    expect(debug.parameters.maximum_interval).toBe(36_500);
    expect(debug.parameters.w).toHaveLength(21);
    expect(debug.parameters.learning_steps).toEqual(["1m", "10m"]);
    expect(debug.parameters.relearning_steps).toEqual(["10m"]);
  });

  it("按调度阶段计数，到期样例只含非 new 且在未来 30 天窗口内的条目（按 due 升序、截断 10 条）", async () => {
    const database = freshDatabase();
    const now = new Date("2026-08-01T00:00:00.000Z");
    const tomorrow = "2026-08-02T00:00:00.000Z";
    const beyondWindow = "2026-10-01T00:00:00.000Z";

    const entries: Array<{ term: string; status: string; due: string }> = [
      { term: "apple", status: "review", due: tomorrow },
      { term: "banana", status: "new", due: tomorrow },
      { term: "cherry", status: "review", due: beyondWindow },
      { term: "date", status: "learning", due: tomorrow },
      { term: "elderberry", status: "relearning", due: tomorrow },
    ];
    for (const entry of entries) {
      const sense = makeSense({ term: entry.term });
      const item = makeItem(sense.id);
      const memory = makeMemory(item.id, {
        status: entry.status as "review" | "new" | "learning" | "relearning",
        due: entry.due,
      });
      await database.senses.put(sense);
      await database.items.put(item);
      await database.memoryStates.put(memory);
    }

    const debug = await loadFsrsDebug(database, now);
    expect(debug.counts).toEqual({ new: 1, learning: 1, review: 2, relearning: 1 });
    // 排除 new 状态与超窗条目，只剩 apple / date / elderberry（due 均为明天）
    expect(debug.dueSample.map((entry) => entry.term).sort()).toEqual([
      "apple",
      "date",
      "elderberry",
    ]);
    const apple = debug.dueSample.find((entry) => entry.term === "apple");
    expect(apple?.due).toBe(tomorrow);
  });

  it("到期样例最多 10 条（按 due 升序截断）", async () => {
    const database = freshDatabase();
    const now = new Date("2026-08-01T00:00:00.000Z");
    for (let index = 0; index < 15; index += 1) {
      const due = new Date(now.getTime() + (index + 1) * 86_400_000).toISOString();
      const sense = makeSense({ term: `word-${index}` });
      const item = makeItem(sense.id);
      const memory = makeMemory(item.id, { status: "review", due });
      await database.senses.put(sense);
      await database.items.put(item);
      await database.memoryStates.put(memory);
    }

    const debug = await loadFsrsDebug(database, now);
    expect(debug.dueSample).toHaveLength(10);
    expect(debug.dueSample[0]?.term).toBe("word-0");
    expect(debug.dueSample[9]?.term).toBe("word-9");
  });
});

describe("createIndexedDbDeveloperDataProvider 清库", () => {
  it("clearDatabase 删除数据库：清库后表操作抛错（句柄失效）", async () => {
    const database = freshDatabase();
    const provider = createIndexedDbDeveloperDataProvider(database);
    const sense = makeSense();
    const item = makeItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);

    await provider.clearDatabase();
    await expect(database.items.count()).rejects.toThrow();
  });
});
