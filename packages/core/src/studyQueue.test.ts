/**
 * 三模式学习队列（RAY-253）：getStudyQueueItemIds + interleaveCards。
 *
 * 走真实 @lexilexi/core 路径：手工落库条目的记忆状态（reps / due），
 * 验证 learn / review / mixed 三种模式的筛选与排序、混合穿插节奏与
 * 任一侧耗尽时的补齐行为。
 *
 * RAY-284 生词本开关：includeNotebook === false 时生词本条目（及其独立
 * 调度实例）从三种模式与到期查询中排除，词书条目不受影响。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  addToNotebook,
  getActiveNotebookItemIds,
  getDueItemIds,
  removeFromNotebook,
} from "./index";
import type { IsoDate } from "./domain";
import { makeLearningItem, makeMemoryState, makeSense } from "./helpers";
import type { ItemId } from "./id";
import { openDatabase } from "./persistence";
import type { LexilexiDatabase } from "./persistence";
import { getStudyQueueItemIds, interleaveCards } from "./studyLoop";

/** 每个用例用独立的 fake-indexeddb 实例（互不干扰） */
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

/** 查询口径时刻：种子 due 相对该时刻分布在过去/未来 */
const NOW = "2026-08-14T00:00:00.000Z";

interface Seed {
  id: string;
  due: IsoDate;
  reps: number;
}

/** 按种子列表落库条目 + 义项 + 记忆状态（reps / due 覆写），返回条目 id 列表 */
async function seed(database: LexilexiDatabase, seeds: Seed[]): Promise<ItemId[]> {
  const ids: ItemId[] = [];
  for (const entry of seeds) {
    const sense = makeSense(`sense_${entry.id}`);
    const item = makeLearningItem(sense.id, `item_${entry.id}`);
    const state = makeMemoryState(item.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put({
      ...state,
      fields: { ...state.fields, due: entry.due, reps: entry.reps },
    });
    ids.push(item.id);
  }
  return ids;
}

function idOf(ids: readonly ItemId[], suffix: string): ItemId {
  const match = ids.find((id) => id.endsWith(`item_${suffix}`));
  if (!match) {
    throw new Error(`seed 不存在：${suffix}`);
  }
  return match;
}

describe("interleaveCards（混合穿插纯函数）", () => {
  it("每 2 张复习卡穿插 1 张新词卡，复习耗尽后补齐剩余新词", () => {
    const reviews = ["r1", "r2", "r3", "r4", "r5"].map((s) => `item_${s}` as ItemId);
    const news = ["n1", "n2"].map((s) => `item_${s}` as ItemId);

    expect(interleaveCards(reviews, news)).toEqual([
      "item_r1",
      "item_r2",
      "item_n1",
      "item_r3",
      "item_r4",
      "item_n2",
      "item_r5",
    ]);
  });

  it("新词多于穿插位：复习耗尽后按序补齐全部剩余新词", () => {
    const reviews = ["r1", "r2"].map((s) => `item_${s}` as ItemId);
    const news = ["n1", "n2", "n3", "n4"].map((s) => `item_${s}` as ItemId);

    expect(interleaveCards(reviews, news)).toEqual([
      "item_r1",
      "item_r2",
      "item_n1",
      "item_n2",
      "item_n3",
      "item_n4",
    ]);
  });

  it("复习为空：即纯新词队列；新词为空：即纯复习队列", () => {
    const news = ["n1", "n2"].map((s) => `item_${s}` as ItemId);
    const reviews = ["r1", "r2"].map((s) => `item_${s}` as ItemId);

    expect(interleaveCards([], news)).toEqual(["item_n1", "item_n2"]);
    expect(interleaveCards(reviews, [])).toEqual(["item_r1", "item_r2"]);
  });
});

describe("getStudyQueueItemIds（学习 / 复习 / 混合三模式）", () => {
  it("learn：仅从未评分的卡（reps === 0），按 due 升序；日历日口径——今天稍后到期的卡进入今日队列，明天起的未来卡排除", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
      { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
      { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
      { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
      { id: "e", due: "2026-08-14T12:00:00.000Z", reps: 0 }, // 今天 12:00 到期 → 今日可学
      { id: "f", due: "2026-08-15T08:00:00.000Z", reps: 0 }, // 明天到期 → 排除
    ]);

    expect(await getStudyQueueItemIds(database, NOW, "learn")).toEqual([
      idOf(ids, "a"),
      idOf(ids, "c"),
      idOf(ids, "e"),
    ]);
  });

  it("review：仅已评分且到期的卡（reps > 0 && due <= now），按 due 升序", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
      { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
      { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
      { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
      { id: "e", due: "2026-08-13T12:00:00.000Z", reps: 1 },
    ]);

    expect(await getStudyQueueItemIds(database, NOW, "review")).toEqual([
      idOf(ids, "b"),
      idOf(ids, "d"),
      idOf(ids, "e"),
    ]);
  });

  it("mixed：复习卡为主干，每 2 张穿插 1 张新词卡，尾部补齐剩余新词", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
      { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
      { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
      { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
      { id: "e", due: "2026-08-13T12:00:00.000Z", reps: 1 },
    ]);

    expect(await getStudyQueueItemIds(database, NOW, "mixed")).toEqual([
      idOf(ids, "b"),
      idOf(ids, "d"),
      idOf(ids, "a"),
      idOf(ids, "e"),
      idOf(ids, "c"),
    ]);
  });

  it("mixed：无到期复习卡时退化为纯新词队列", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
      { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
    ]);

    expect(await getStudyQueueItemIds(database, NOW, "mixed")).toEqual([
      idOf(ids, "a"),
      idOf(ids, "c"),
    ]);
  });

  it("mixed：无新词时退化为纯复习队列", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
      { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
    ]);

    expect(await getStudyQueueItemIds(database, NOW, "mixed")).toEqual([
      idOf(ids, "b"),
      idOf(ids, "d"),
    ]);
  });

  it("空库：三种模式均为空队列", async () => {
    const database = freshDatabase();

    expect(await getStudyQueueItemIds(database, NOW, "learn")).toEqual([]);
    expect(await getStudyQueueItemIds(database, NOW, "review")).toEqual([]);
    expect(await getStudyQueueItemIds(database, NOW, "mixed")).toEqual([]);
  });

  describe("每日新卡上限（RAY-260 评审 suggestion 2）", () => {
    it("learn：newCardLimit 截取 due 升序前 N 条新词", async () => {
      const database = freshDatabase();
      const ids = await seed(database, [
        { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
        { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
        { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
        { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 0 },
        { id: "e", due: "2026-08-13T12:00:00.000Z", reps: 0 },
      ]);

      expect(await getStudyQueueItemIds(database, NOW, "learn", { newCardLimit: 2 })).toEqual([
        idOf(ids, "a"),
        idOf(ids, "c"),
      ]);
      // 未设上限：全部新词照常返回
      expect(await getStudyQueueItemIds(database, NOW, "learn")).toEqual([
        idOf(ids, "a"),
        idOf(ids, "c"),
        idOf(ids, "d"),
        idOf(ids, "e"),
      ]);
    });

    it("mixed：新词侧受 newCardLimit 限制，复习侧不受影响", async () => {
      const database = freshDatabase();
      const ids = await seed(database, [
        { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
        { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
        { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
        { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
        { id: "e", due: "2026-08-13T12:00:00.000Z", reps: 0 },
      ]);

      // 新词 3 张、限 1：只穿插最早到期的一张新词
      expect(await getStudyQueueItemIds(database, NOW, "mixed", { newCardLimit: 1 })).toEqual([
        idOf(ids, "b"),
        idOf(ids, "d"),
        idOf(ids, "a"),
      ]);
    });

    it("newCardLimit = 0：新词清零，复习照常", async () => {
      const database = freshDatabase();
      const ids = await seed(database, [
        { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
        { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
      ]);

      expect(await getStudyQueueItemIds(database, NOW, "learn", { newCardLimit: 0 })).toEqual([]);
      expect(await getStudyQueueItemIds(database, NOW, "mixed", { newCardLimit: 0 })).toEqual([
        idOf(ids, "b"),
      ]);
      expect(await getStudyQueueItemIds(database, NOW, "review", { newCardLimit: 0 })).toEqual([
        idOf(ids, "b"),
      ]);
    });

    it("review 模式不含新词，newCardLimit 对其无影响", async () => {
      const database = freshDatabase();
      const ids = await seed(database, [
        { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
        { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
        { id: "e", due: "2026-08-13T12:00:00.000Z", reps: 1 },
      ]);

      expect(await getStudyQueueItemIds(database, NOW, "review", { newCardLimit: 1 })).toEqual([
        idOf(ids, "b"),
        idOf(ids, "d"),
        idOf(ids, "e"),
      ]);
    });
  });
});

describe("getStudyQueueItemIds / getDueItemIds（生词本开关，RAY-284）", () => {
  /** 落库一个生词本条目：义项先入库（复用），返回生词本条目 id 与其学习条目 id */
  async function seedNotebookEntry(
    database: LexilexiDatabase,
    senseSuffix: string,
    addedAt: IsoDate,
    reps: number,
  ): Promise<ItemId> {
    const sense = makeSense(`sense_nb_${senseSuffix}`);
    await database.senses.put(sense);
    const entry = await addToNotebook(database, { senseId: sense.id, now: addedAt });
    if (reps > 0) {
      const memory = await database.memoryStates.get(entry.itemId);
      if (memory) {
        await database.memoryStates.put({
          ...memory,
          fields: { ...memory.fields, reps, due: addedAt },
        });
      }
    }
    return entry.itemId;
  }

  it("includeNotebook=false：生词本新词/复习条目从三模式队列排除，词书条目保留", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
      { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
    ]);
    const notebookNew = await seedNotebookEntry(database, "new", "2026-08-13T07:00:00.000Z", 0);
    const notebookReview = await seedNotebookEntry(
      database,
      "review",
      "2026-08-13T07:30:00.000Z",
      3,
    );

    expect(await getStudyQueueItemIds(database, NOW, "learn", { includeNotebook: false })).toEqual([
      idOf(ids, "a"),
    ]);
    expect(await getStudyQueueItemIds(database, NOW, "review", { includeNotebook: false })).toEqual(
      [idOf(ids, "b")],
    );
    expect(await getStudyQueueItemIds(database, NOW, "mixed", { includeNotebook: false })).toEqual([
      idOf(ids, "b"),
      idOf(ids, "a"),
    ]);
    expect(notebookNew).toBeDefined();
    expect(notebookReview).toBeDefined();
  });

  it("默认（includeNotebook 未传 / true）：生词本条目包含在队列中", async () => {
    const database = freshDatabase();
    await seed(database, [{ id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 }]);
    const notebookNew = await seedNotebookEntry(database, "new", "2026-08-13T07:00:00.000Z", 0);

    const learnIds = await getStudyQueueItemIds(database, NOW, "learn");
    expect(learnIds).toContain(notebookNew);
    expect(learnIds.length).toBe(2);
    const mixedIds = await getStudyQueueItemIds(database, NOW, "mixed", { includeNotebook: true });
    expect(mixedIds).toContain(notebookNew);
  });

  it("移出生词本后：条目移出 active 集合、底层条目软删除（已删条目由 UI 装配层过滤）", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [{ id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 }]);
    const sense = makeSense("sense_nb_removed");
    await database.senses.put(sense);
    const entry = await addToNotebook(database, {
      senseId: sense.id,
      now: "2026-08-13T07:00:00.000Z",
    });
    await removeFromNotebook(database, {
      entryId: entry.id,
      now: "2026-08-13T07:05:00.000Z",
    });

    // 移出后不再属于 active 生词本集合（开关排除集不含该条目）
    expect(await getActiveNotebookItemIds(database)).toEqual([]);
    // 底层条目软删除（与 deleteItem 同语义；buildReviewQueue 会过滤已删条目）
    expect((await database.items.get(entry.itemId))?.status).toBe("deleted");
    // 词书条目不受移出影响
    const learnIds = await getStudyQueueItemIds(database, NOW, "learn", { includeNotebook: false });
    expect(learnIds).toContain(idOf(ids, "a"));
  });

  it("getDueItemIds：includeNotebook=false 排除生词本到期条目，默认包含", async () => {
    const database = freshDatabase();
    await seed(database, [{ id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 }]);
    const notebookNew = await seedNotebookEntry(database, "new", "2026-08-13T07:00:00.000Z", 0);

    const allDue = await getDueItemIds(database, NOW);
    expect(allDue).toContain(notebookNew);
    expect(allDue.length).toBe(2);
    const withoutNotebook = await getDueItemIds(database, NOW, { includeNotebook: false });
    expect(withoutNotebook).not.toContain(notebookNew);
    expect(withoutNotebook.length).toBe(1);
  });
});
