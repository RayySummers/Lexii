/**
 * 三模式学习队列（RAY-253）：getStudyQueueItemIds + interleaveCards。
 *
 * 走真实 @lexilexi/core 路径：手工落库条目的记忆状态（reps / due），
 * 验证 learn / review / mixed 三种模式的筛选与排序、混合穿插节奏与
 * 任一侧耗尽时的补齐行为。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
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
  it("learn：仅从未评分的卡（reps === 0），按 due 升序，未来 due 排除", async () => {
    const database = freshDatabase();
    const ids = await seed(database, [
      { id: "a", due: "2026-08-13T08:00:00.000Z", reps: 0 },
      { id: "b", due: "2026-08-13T09:00:00.000Z", reps: 2 },
      { id: "c", due: "2026-08-13T10:00:00.000Z", reps: 0 },
      { id: "d", due: "2026-08-13T11:00:00.000Z", reps: 5 },
      { id: "e", due: "2026-08-14T12:00:00.000Z", reps: 0 },
    ]);

    expect(await getStudyQueueItemIds(database, NOW, "learn")).toEqual([
      idOf(ids, "a"),
      idOf(ids, "c"),
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
