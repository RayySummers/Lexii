import type { DexieOptions } from "dexie";
import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { LexilexiDatabase } from "./persistence";
import {
  createLexilexiDatabase,
  deleteItem,
  openDatabase,
  openLexilexiDatabase,
  recordReview,
  suspendItem,
  unsuspendItem,
} from "./persistence";
import { makeLearningItem, makeMemoryState, makeReviewEvent, makeSense, now } from "./helpers";
import { toItemId, toSenseId } from "./id";

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

describe("数据层 CRUD", () => {
  it("学习条目、义项、记忆状态可写入并读回", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    const memoryState = makeMemoryState(item.id);

    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put(memoryState);

    expect(await database.senses.get(sense.id)).toEqual(sense);
    expect(await database.items.get(item.id)).toEqual(item);
    expect(await database.memoryStates.get(item.id)).toEqual(memoryState);
    expect((await database.memoryStates.get(item.id))?.id).toBe(item.id);
  });

  it("createLexilexiDatabase 注入实例时直接复用；openLexilexiDatabase 幂等", async () => {
    const injected = openDatabase(makeOptions());
    await injected.open();
    // 注入实例时复用同一个实例
    expect(createLexilexiDatabase(undefined, injected)).toBe(injected);
    // 已打开的库重复应用 schema 不报错
    openLexilexiDatabase(injected);
    expect(injected.isOpen()).toBe(true);
    await injected.delete();
  });

  it("createLexilexiDatabase 支持注入自定义 Dexie 构造函数", async () => {
    const database = createLexilexiDatabase(makeOptions(), undefined, Dexie);
    expect(database.name).toBe("lexilexi");
    // 裸实例需自行声明 schema；写入一条数据使数据库真实创建后再删除
    database.version(1).stores({ items: "id" });
    await database.open();
    await database.table("items").put({ id: "item_tmp" });
    await database.delete();
  });

  it("事件表按 id 和时间索引", async () => {
    const database = freshDatabase();
    const event = makeReviewEvent(toItemId("item_1"), toSenseId("sense_1"));
    await database.events.put(event);
    expect(await database.events.get(event.id)).toEqual(event);
  });
});

describe("recordReview（原子评分落库）", () => {
  it("单事务写入复习事件与新的记忆状态", async () => {
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

    await recordReview(database, event, next);

    expect(await database.events.get(event.id)).toEqual(event);
    expect(await database.memoryStates.get(item.id)).toEqual(next);
  });

  it("记忆状态不存在时整个事务中止，不留下孤儿事件", async () => {
    const database = freshDatabase();
    const missingId = toItemId("item_missing");
    const event = makeReviewEvent(missingId, toSenseId("sense_missing"));
    const next = makeMemoryState(missingId);

    await expect(recordReview(database, event, next)).rejects.toThrow("记忆状态不存在");
    expect(await database.events.get(event.id)).toBeUndefined();
  });

  it("事件与状态的条目不一致时在事务外直接拒绝", async () => {
    const database = freshDatabase();
    const event = makeReviewEvent(toItemId("item_a"), toSenseId("sense_a"));
    const next = makeMemoryState(toItemId("item_b"));

    await expect(recordReview(database, event, next)).rejects.toThrow("不一致");
    expect(await database.events.get(event.id)).toBeUndefined();
    expect(await database.memoryStates.get(next.itemId)).toBeUndefined();
  });
});

describe("suspendItem / unsuspendItem / deleteItem", () => {
  it("暂停：状态标记 + 事件，单事务", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.items.put(item);

    await suspendItem(database, item.id, "用户暂停", now());

    const stored = await database.items.get(item.id);
    expect(stored?.status).toBe("suspended");
    const events = await database.events.where("type").equals("suspend").toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ itemId: item.id, reason: "用户暂停" });
  });

  it("暂停不存在的条目报错", async () => {
    const database = freshDatabase();
    await expect(suspendItem(database, toItemId("item_missing"), "x", now())).rejects.toThrow(
      "学习条目不存在",
    );
  });

  it("重复暂停报错（非法流转）", async () => {
    const database = freshDatabase();
    const item = makeLearningItem(makeSense().id);
    await database.items.put(item);
    await suspendItem(database, item.id, "x", now());
    await expect(suspendItem(database, item.id, "x", now())).rejects.toThrow("不可暂停");
  });

  it("恢复：suspended → active，写 unsuspend 事件", async () => {
    const database = freshDatabase();
    const item = makeLearningItem(makeSense().id);
    await database.items.put(item);
    await suspendItem(database, item.id, "x", now());

    await unsuspendItem(database, item.id, "恢复", now());
    expect((await database.items.get(item.id))?.status).toBe("active");
    expect(await database.events.where("type").equals("unsuspend").count()).toBe(1);
  });

  it("恢复不存在的条目报错", async () => {
    const database = freshDatabase();
    await expect(unsuspendItem(database, toItemId("item_missing"), "x", now())).rejects.toThrow(
      "学习条目不存在",
    );
  });

  it("恢复 active 条目报错（非法流转）", async () => {
    const database = freshDatabase();
    const item = makeLearningItem(makeSense().id);
    await database.items.put(item);
    await expect(unsuspendItem(database, item.id, "x", now())).rejects.toThrow("不可恢复");
  });

  it("删除：软删除（历史事件保留，delete-item 事件落库）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.items.put(item);
    await database.memoryStates.put(makeMemoryState(item.id));
    await database.events.put(makeReviewEvent(item.id, sense.id));

    await deleteItem(database, item.id, now());

    expect((await database.items.get(item.id))?.status).toBe("deleted");
    expect(await database.memoryStates.get(item.id)).toBeDefined();
    expect(await database.events.where("type").equals("review").count()).toBe(1);
    expect(await database.events.where("type").equals("delete-item").count()).toBe(1);
  });

  it("删除不存在的条目报错", async () => {
    const database = freshDatabase();
    await expect(deleteItem(database, toItemId("item_missing"), now())).rejects.toThrow(
      "学习条目不存在",
    );
  });

  it("重复删除报错（→ deleted 不可逆，不产生第二条 delete-item 事件）", async () => {
    const database = freshDatabase();
    const item = makeLearningItem(makeSense().id);
    await database.items.put(item);
    await deleteItem(database, item.id, now());

    await expect(deleteItem(database, item.id, now())).rejects.toThrow("不可重复删除");
    expect(await database.events.where("type").equals("delete-item").count()).toBe(1);
  });

  it("删除无记忆状态的条目同样成功（记忆状态可选路径）", async () => {
    const database = freshDatabase();
    const item = makeLearningItem(makeSense().id);
    await database.items.put(item);

    await deleteItem(database, item.id, now());
    expect((await database.items.get(item.id))?.status).toBe("deleted");
    expect(await database.events.where("type").equals("delete-item").count()).toBe(1);
  });
});
