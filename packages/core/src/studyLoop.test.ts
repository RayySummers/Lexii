import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { importCsvWordlist } from "./importWords";
import { makeLearningItem, makeSense } from "./helpers";
import { openDatabase } from "./persistence";
import type { LexilexiDatabase } from "./persistence";
import { getDueItemIds, gradeReview } from "./studyLoop";

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

const TIME = "2026-08-13T10:00:00.000Z";

describe("gradeReview（学习回路：评分 → FSRS 排期 → 事件落库）", () => {
  it("首次评分：事件与记忆状态原子落库（Good）", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果,n.", {
      source: "测试",
      time: TIME,
    });
    const itemId = itemIds[0]!;
    const item = (await database.items.get(itemId))!;
    const sense = (await database.senses.get(item.senseId))!;

    const { reviewEvent, nextMemoryState } = await gradeReview(database, {
      itemId,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 3000,
      revealed: false,
      answerWasCorrect: true,
      response: "apple",
      time: TIME,
    });

    // review 事件落库
    expect(reviewEvent).toMatchObject({
      type: "review",
      itemId,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 3000,
      revealed: false,
      answerWasCorrect: true,
      response: "apple",
      time: TIME,
      elapsedDays: 0, // 首次复习为 0
    });
    expect(await database.events.get(reviewEvent.id)).toEqual(reviewEvent);

    // 记忆状态被 FSRS 排期更新
    expect(nextMemoryState.itemId).toBe(itemId);
    expect(nextMemoryState.fields.lastRating).toBe("good");
    expect(nextMemoryState.fields.lastReviewAt).toBe(TIME);
    expect(nextMemoryState.fields.reps).toBe(1);
    expect(nextMemoryState.fields.difficulty).toBeGreaterThan(0);
    expect(nextMemoryState.fields.stabilityDays).toBeGreaterThan(0);
    expect(await database.memoryStates.get(itemId)).toEqual(nextMemoryState);
  });

  it("四档评分各产生合法排期，due 严格递增（again < hard < good < easy）", async () => {
    const database = freshDatabase();
    const dues: Partial<Record<string, number>> = {};
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      const sense = makeSense();
      const item = makeLearningItem(sense.id);
      await database.senses.put(sense);
      await database.items.put(item);
      // 手工构造初始记忆状态（等价于导入时的 newCardFields 输出）
      await database.memoryStates.put({
        id: item.id,
        itemId: item.id,
        fields: {
          status: "new",
          due: TIME,
          stabilityDays: 0,
          difficulty: 0,
          elapsedDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          lastReviewAt: null,
          lastRating: null,
        },
        createdAt: TIME,
        updatedAt: TIME,
      });

      const result = await gradeReview(database, {
        itemId: item.id,
        senseId: sense.id,
        exerciseType: "recall",
        rating,
        reviewDurationMs: 1000,
        revealed: true,
        answerWasCorrect: rating !== "again",
        time: TIME,
      });
      expect(result.nextMemoryState.fields.lastRating).toBe(rating);
      dues[rating] = Date.parse(result.nextMemoryState.fields.due);
      await database.items.delete(item.id);
      await database.senses.delete(sense.id);
      await database.memoryStates.delete(item.id);
    }
    const again = dues.again ?? Number.NaN;
    const hard = dues.hard ?? Number.NaN;
    const good = dues.good ?? Number.NaN;
    const easy = dues.easy ?? Number.NaN;
    expect(again).toBeLessThan(hard);
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it("未指定 time 时使用调用方当前时间", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;

    const before = new Date();
    const { reviewEvent } = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
    });
    const after = new Date();
    const eventTime = Date.parse(reviewEvent.time);
    expect(eventTime).toBeGreaterThanOrEqual(before.getTime());
    expect(eventTime).toBeLessThanOrEqual(after.getTime());
  });

  it("记忆状态不存在时报错，不产生孤儿事件", async () => {
    const database = freshDatabase();
    await expect(
      gradeReview(database, {
        itemId: makeLearningItem(makeSense().id).id, // 未落库的条目
        senseId: makeSense().id,
        exerciseType: "recall",
        rating: "good",
        reviewDurationMs: 1000,
        revealed: false,
        answerWasCorrect: true,
        time: TIME,
      }),
    ).rejects.toThrow("记忆状态不存在");
    expect(await database.events.count()).toBe(0);
  });

  it("完整闭环：导入 → 练习 → 评分 → 排期 → 事件，统计可重放", async () => {
    const database = freshDatabase();
    // 1. 导入词表
    const { itemIds } = await importCsvWordlist(database, "apple,苹果\nbook,书", {
      source: "导入:测试.csv",
      time: TIME,
    });
    // 2. 到期队列包含全部新条目
    const due = await getDueItemIds(database, TIME);
    expect(new Set(due)).toEqual(new Set(itemIds));
    // 3. 逐个评分（回忆练习）
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "easy",
      reviewDurationMs: 2500,
      revealed: false,
      answerWasCorrect: true,
      response: "apple",
      time: TIME,
    });
    // 4. 事件落库：1 个 import + 1 个 review，且 review 定位到同一条目
    expect(await database.events.where("type").equals("import").count()).toBe(2);
    expect(await database.events.where("type").equals("review").count()).toBe(1);
    const reviews = await database.events.where("type").equals("review").toArray();
    expect(reviews[0]).toMatchObject({ itemId: item.id, rating: "easy", elapsedDays: 0 });
    // 5. easy 排期：进入复习状态，未到期
    const state = (await database.memoryStates.get(item.id))!;
    expect(state.fields.status).toBe("review");
    expect(Date.parse(state.fields.due)).toBeGreaterThan(Date.parse(TIME));
    expect(await getDueItemIds(database, TIME)).not.toContain(item.id);
  });

  it("elapsedDays 按上次复习时间推算（跨天复习重放恢复用）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put({
      id: item.id,
      itemId: item.id,
      fields: {
        status: "review",
        due: "2026-08-11T10:00:00.000Z",
        stabilityDays: 5,
        difficulty: 5,
        elapsedDays: 0,
        learningSteps: 0,
        reps: 2,
        lapses: 0,
        lastReviewAt: "2026-08-11T10:00:00.000Z",
        lastRating: "good",
      },
      createdAt: TIME,
      updatedAt: TIME,
    });

    const result = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
      time: "2026-08-13T10:00:00.000Z", // 两天后复习
    });
    expect(result.reviewEvent.elapsedDays).toBe(2);
  });

  it("非法评分抛错（RangeError，与调度器入口一致）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put({
      id: item.id,
      itemId: item.id,
      fields: {
        status: "new",
        due: TIME,
        stabilityDays: 0,
        difficulty: 0,
        elapsedDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        lastReviewAt: null,
        lastRating: null,
      },
      createdAt: TIME,
      updatedAt: TIME,
    });

    await expect(
      gradeReview(database, {
        itemId: item.id,
        senseId: sense.id,
        exerciseType: "recall",
        rating: "excellent" as never, // 绕过类型检查的脏输入
        reviewDurationMs: 1000,
        revealed: false,
        answerWasCorrect: true,
        time: TIME,
      }),
    ).rejects.toThrow(RangeError);
    expect(await database.events.count()).toBe(0);
    expect((await database.memoryStates.get(item.id))?.fields.reps).toBe(0);
  });
});
