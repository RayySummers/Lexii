/**
 * 生词本（RAY-284）：addToNotebook / removeFromNotebook / listNotebookEntries /
 * getActiveNotebookItemIds 的数据层测试。
 *
 * 走真实 @lexii/core 路径（fake-indexeddb）：
 * - 加词：单事务创建 学习条目（source = 生词本）+ 记忆状态（newCardFields，
 *   加入即到期、进入现有 FSRS 调度）+ import 事件 + 生词本条目；
 *   义项复用词库既有 Sense（不复制内容）；
 * - 幂等：同一义项重复加词返回既有条目，不重复创建调度实例；
 * - 移出：条目标记 removed + 底层条目软删除（delete-item 事件），
 *   词书同词条目不受影响；
 * - 列表：仅 active、最新加入在前。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { makeLearningItem, makeMemoryState, makeSense, now } from "./helpers";
import { toNotebookEntryId, toSenseId } from "./id";
import { isDeleteItemEvent, isImportEvent } from "./events";
import {
  addToNotebook,
  getActiveNotebookItemIds,
  listNotebookEntries,
  NOTEBOOK_SOURCE,
  openDatabase,
  removeFromNotebook,
} from "./index";
import type { LexiiDatabase } from "./persistence";

/** 每个用例用独立的 fake-indexeddb 实例（互不干扰） */
function makeOptions(): DexieOptions {
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

/** 落库一个词书义项（带学习条目与记忆状态，模拟词库既有词条） */
async function seedSense(database: LexiiDatabase, senseId: string, term: string, itemId: string) {
  const sense = makeSense(senseId);
  sense.term = term;
  const item = makeLearningItem(sense.id, itemId);
  await database.senses.put(sense);
  await database.items.put(item);
  await database.memoryStates.put(makeMemoryState(item.id));
  return { sense, item };
}

describe("addToNotebook（加词）", () => {
  it("单事务创建 生词本条目 + 学习条目（source=生词本）+ 记忆状态 + import 事件，义项复用既有 Sense", async () => {
    const database = freshDatabase();
    const { sense } = await seedSense(database, "sense_seed", "hello", "item_seed");
    const sensesBefore = await database.senses.count();
    const time = now();

    const entry = await addToNotebook(database, { senseId: sense.id, now: time });

    expect(entry.status).toBe("active");
    expect(entry.removedAt).toBeNull();
    expect(entry.senseId).toBe(sense.id);
    expect(entry.term).toBe("hello");
    expect(entry.addedAt).toBe(time);
    // 义项复用：不新增 Sense 行
    expect(await database.senses.count()).toBe(sensesBefore);
    // 学习条目独立创建，来源 = 生词本
    const item = await database.items.get(entry.itemId);
    expect(item).toBeDefined();
    expect(item?.source).toBe(NOTEBOOK_SOURCE);
    expect(item?.senseId).toBe(sense.id);
    expect(item?.status).toBe("active");
    // 记忆状态 newCardFields 初始化：加入即到期（进入现有 FSRS 调度）
    const memory = await database.memoryStates.get(entry.itemId);
    expect(memory).toBeDefined();
    expect(memory?.fields.status).toBe("new");
    expect(memory?.fields.reps).toBe(0);
    expect(memory?.fields.due).toBe(time);
    // import 事件与词表导入同类型，定位到新条目
    const importEvents = (await database.events.toArray()).filter(isImportEvent);
    const importEvent = importEvents.find((event) => event.itemId === entry.itemId);
    expect(importEvent).toBeDefined();
    expect(importEvent?.term).toBe("hello");
    expect(importEvent?.senseId).toBe(sense.id);
  });

  it("同一义项重复加词幂等：返回既有 active 条目，不重复创建条目/事件", async () => {
    const database = freshDatabase();
    const { sense } = await seedSense(database, "sense_seed", "hello", "item_seed");

    const first = await addToNotebook(database, { senseId: sense.id, now: now() });
    const itemsAfterFirst = await database.items.count();
    const eventsAfterFirst = await database.events.count();

    const second = await addToNotebook(database, {
      senseId: sense.id,
      now: "2026-08-14T00:00:00.000Z",
    });

    expect(second.id).toBe(first.id);
    expect(second.itemId).toBe(first.itemId);
    expect(second.addedAt).toBe(first.addedAt);
    expect(await database.items.count()).toBe(itemsAfterFirst);
    expect(await database.events.count()).toBe(eventsAfterFirst);
    expect(await database.notebookEntries.count()).toBe(1);
  });

  it("义项不存在时整体回滚，不留下任何半条记录", async () => {
    const database = freshDatabase();
    const missingSenseId = toSenseId("sense_missing");

    await expect(addToNotebook(database, { senseId: missingSenseId })).rejects.toThrow(
      "义项不存在",
    );
    expect(await database.notebookEntries.count()).toBe(0);
    expect(await database.items.count()).toBe(0);
    expect(await database.memoryStates.count()).toBe(0);
    expect(await database.events.count()).toBe(0);
  });

  it("移出后重新加词：创建新条目与新记录（旧 removed 记录保留为历史）", async () => {
    const database = freshDatabase();
    const { sense } = await seedSense(database, "sense_seed", "hello", "item_seed");

    const first = await addToNotebook(database, { senseId: sense.id, now: now() });
    await removeFromNotebook(database, { entryId: first.id, now: "2026-08-15T00:00:00.000Z" });

    const second = await addToNotebook(database, {
      senseId: sense.id,
      now: "2026-08-16T00:00:00.000Z",
    });

    expect(second.id).not.toBe(first.id);
    expect(second.itemId).not.toBe(first.itemId);
    expect(second.status).toBe("active");
    // 历史保留：removed 记录仍在
    expect(await database.notebookEntries.get(first.id)).toMatchObject({
      status: "removed",
      removedAt: "2026-08-15T00:00:00.000Z",
    });
    // 旧条目软删除不可逆，新条目独立调度
    const oldItem = await database.items.get(first.itemId);
    expect(oldItem?.status).toBe("deleted");
    const newItem = await database.items.get(second.itemId);
    expect(newItem?.status).toBe("active");
    expect(newItem?.source).toBe(NOTEBOOK_SOURCE);
  });
});

describe("removeFromNotebook（移出生词本）", () => {
  it("条目标记 removed + 底层条目软删除 + delete-item 事件，词书同词条目不受影响", async () => {
    const database = freshDatabase();
    const { sense, item: wordbookItem } = await seedSense(
      database,
      "sense_seed",
      "hello",
      "item_seed",
    );
    const entry = await addToNotebook(database, { senseId: sense.id, now: now() });
    const time = "2026-08-15T00:00:00.000Z";

    await removeFromNotebook(database, { entryId: entry.id, now: time });

    expect(await database.notebookEntries.get(entry.id)).toMatchObject({
      status: "removed",
      removedAt: time,
    });
    const notebookItem = await database.items.get(entry.itemId);
    expect(notebookItem?.status).toBe("deleted");
    expect(notebookItem?.updatedAt).toBe(time);
    // 词书条目（同一义项的另一学习条目）不受影响
    expect((await database.items.get(wordbookItem.id))?.status).toBe("active");
    const deleteEvent = await database.events
      .where("type")
      .equals("delete-item")
      .filter(isDeleteItemEvent)
      .filter((event) => event.itemId === entry.itemId)
      .first();
    expect(deleteEvent).toBeDefined();
    // 义项保留（词书条目仍引用）
    expect(await database.senses.get(sense.id)).toBeDefined();
  });

  it("重复移出报错；条目不存在报错，事务回滚", async () => {
    const database = freshDatabase();
    const { sense } = await seedSense(database, "sense_seed", "hello", "item_seed");
    const entry = await addToNotebook(database, { senseId: sense.id, now: now() });
    await removeFromNotebook(database, { entryId: entry.id });

    await expect(removeFromNotebook(database, { entryId: entry.id })).rejects.toThrow(
      "不可重复移出",
    );
    await expect(
      removeFromNotebook(database, { entryId: toNotebookEntryId("nb_missing") }),
    ).rejects.toThrow("生词本条目不存在");
  });
});

describe("listNotebookEntries / getActiveNotebookItemIds（列表查询）", () => {
  it("仅返回 active 条目，最新加入在前", async () => {
    const database = freshDatabase();
    const { sense } = await seedSense(database, "sense_seed", "hello", "item_seed");

    const early = await addToNotebook(database, { senseId: sense.id, now: now() });
    // 移出后不再出现在列表中
    await removeFromNotebook(database, {
      entryId: early.id,
      now: "2026-08-14T00:00:00.000Z",
    });
    const later = await addToNotebook(database, {
      senseId: sense.id,
      now: "2026-08-16T00:00:00.000Z",
    });
    // 另一义项再加一词（时间介于两者之间）
    await seedSense(database, "sense_other", "world", "item_other");
    const middle = await addToNotebook(database, {
      senseId: toSenseId("sense_other"),
      now: "2026-08-15T00:00:00.000Z",
    });

    const entries = await listNotebookEntries(database);
    expect(entries.map((entry) => entry.id)).toEqual([later.id, middle.id]);
    expect(entries.every((entry) => entry.status === "active")).toBe(true);

    const itemIds = await getActiveNotebookItemIds(database);
    expect(itemIds.sort()).toEqual([later.itemId, middle.itemId].sort());
  });
});
