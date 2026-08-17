/**
 * 生词本数据源集成测试（fake-indexeddb，RAY-284）。
 *
 * 走真实 @lexii/core 路径：加词（幂等）→ 列表装配（条目 + 义项内容，
 * 最新在前）→ 移出（条目 removed + 底层学习条目软删除）。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDatabase, toSenseId } from "@lexii/core";
import type { LexiiDatabase, Sense } from "@lexii/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addWordToNotebook, createIndexedDbNotebookDataProvider } from "./data";

function makeOptions(): Parameters<typeof openDatabase>[0] {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexiiDatabase | undefined;

beforeEach(() => {
  db = openDatabase(makeOptions());
});

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

/** 落库一个词书义项（加词只需义项存在，不要求有学习条目） */
function makeSense(term: string): Sense {
  return {
    id: toSenseId(`sense_data_${term}`),
    lang: "en",
    term,
    definitions: [`${term} 的释义`],
    tags: [],
    examples: [],
  };
}

describe("createIndexedDbNotebookDataProvider", () => {
  it("空生词本：loadEntries 返回空数组", async () => {
    const provider = createIndexedDbNotebookDataProvider(db!);
    expect(await provider.loadEntries()).toEqual([]);
  });

  it("loadEntries：按最新加入在前装配条目 + 义项内容", async () => {
    const provider = createIndexedDbNotebookDataProvider(db!);
    const senseA = makeSense("apple");
    const senseB = makeSense("book");
    await db!.senses.bulkPut([senseA, senseB]);
    await addWordToNotebook(db!, senseA.id);
    await addWordToNotebook(db!, senseB.id);

    const entries = await provider.loadEntries();
    expect(entries.map((item) => item.sense.term)).toEqual(["book", "apple"]);
    expect(entries.map((item) => item.sense.definitions.join())).toEqual([
      "book 的释义",
      "apple 的释义",
    ]);
    // 每个条目都有对应的义项内容
    for (const item of entries) {
      expect(item.entry.senseId).toBe(item.sense.id);
    }
  });

  it("义项缺失的条目被跳过（脏数据不产出空行）", async () => {
    const provider = createIndexedDbNotebookDataProvider(db!);
    const senseA = makeSense("apple");
    await db!.senses.put(senseA);
    await addWordToNotebook(db!, senseA.id);
    // 直接删掉义项模拟脏数据（仅测试场景）
    await db!.senses.delete(senseA.id);

    expect(await provider.loadEntries()).toEqual([]);
  });

  it("removeWord：条目移出 active 列表，底层学习条目软删除", async () => {
    const provider = createIndexedDbNotebookDataProvider(db!);
    const sense = makeSense("apple");
    await db!.senses.put(sense);
    await addWordToNotebook(db!, sense.id);
    const [item] = await provider.loadEntries();
    if (!item) {
      throw new Error("生词本应有一条条目");
    }

    await provider.removeWord(item.entry.id);

    expect(await provider.loadEntries()).toEqual([]);
    expect((await db!.items.get(item.entry.itemId))?.status).toBe("deleted");
    // 义项保留（词书条目仍引用）
    expect(await db!.senses.get(sense.id)).toBeDefined();
  });
});

describe("addWordToNotebook（幂等加词 helper）", () => {
  it("首次加词返回 added；重复加同一义项返回 already，不重复创建条目", async () => {
    const sense = makeSense("apple");
    await db!.senses.put(sense);
    expect(await addWordToNotebook(db!, sense.id)).toBe("added");
    expect(await addWordToNotebook(db!, sense.id)).toBe("already");
    expect(await db!.notebookEntries.count()).toBe(1);
    expect(await db!.items.count()).toBe(1);
  });

  it("加词创建的生词本条目 source = 生词本，记忆状态加入即到期", async () => {
    const sense = makeSense("apple");
    await db!.senses.put(sense);
    const before = Date.now();
    await addWordToNotebook(db!, sense.id);
    const after = Date.now();

    const entry = await db!.notebookEntries.toCollection().first();
    if (!entry) {
      throw new Error("生词本应有一条条目");
    }
    const item = await db!.items.get(entry.itemId);
    expect(item?.source).toBe("生词本");
    const memory = await db!.memoryStates.get(entry.itemId);
    expect(memory?.fields.reps).toBe(0);
    const dueMs = Date.parse(memory?.fields.due ?? "");
    expect(dueMs).toBeGreaterThanOrEqual(before);
    expect(dueMs).toBeLessThanOrEqual(after);
  });
});
