import type { DexieOptions } from "dexie";
import { newCardFields } from "@lexilexi/fsrs";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { importCsvWordlist } from "./importWords";
import { makeLearningItem, makeMemoryState, makeSense } from "./helpers";
import { toEventId, toItemId } from "./id";
import type { MemoryStateFields } from "./memory";
import { openDatabase } from "./persistence";
import type { LexilexiDatabase } from "./persistence";
import {
  getDueItemIds,
  getDueItemIdsInRange,
  gradeReview,
  memoryFieldsToCardInput,
  undoReview,
} from "./studyLoop";

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

  it("旧数据缺 learningSteps：防御性兜底为 0，正常排期（评审建议 #2）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    // 模拟本 PR 之前落库的 MemoryState（无 learningSteps 字段）
    const legacyFields = {
      status: "new" as const,
      due: TIME,
      stabilityDays: 0,
      difficulty: 0,
      elapsedDays: 0,
      reps: 0,
      lapses: 0,
      lastReviewAt: null,
      lastRating: null,
    };
    await database.memoryStates.put({
      id: item.id,
      itemId: item.id,
      // 故意缺 learningSteps；字段直接以 any 落库（IndexedDB 记录无 schema 约束）
      fields: legacyFields as unknown as MemoryStateFields,
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
      time: TIME,
    });
    expect(result.nextMemoryState.fields.learningSteps).toBeGreaterThanOrEqual(0);
    expect(result.nextMemoryState.fields.reps).toBe(1);
    expect(await database.events.where("type").equals("review").count()).toBe(1);
  });

  it("reviewDurationMs 非法（负数/NaN/Infinity）拒绝（评审建议 #7）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put(makeMemoryState(item.id));

    for (const badDuration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        gradeReview(database, {
          itemId: item.id,
          senseId: sense.id,
          exerciseType: "recall",
          rating: "good",
          reviewDurationMs: badDuration,
          revealed: false,
          answerWasCorrect: true,
          time: TIME,
        }),
      ).rejects.toThrow(RangeError);
    }
    // time 非法同样拒绝（污染事件时间轴）
    await expect(
      gradeReview(database, {
        itemId: item.id,
        senseId: sense.id,
        exerciseType: "recall",
        rating: "good",
        reviewDurationMs: 1000,
        revealed: false,
        answerWasCorrect: true,
        time: "not-a-date",
      }),
    ).rejects.toThrow(RangeError);
    expect(await database.events.count()).toBe(0);
  });

  it("response 超长截断（评审建议 #7）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put(makeMemoryState(item.id));

    const longResponse = "a".repeat(500);
    const { reviewEvent } = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
      response: longResponse,
      time: TIME,
    });
    expect(reviewEvent.response?.length).toBeLessThan(longResponse.length);
    expect(reviewEvent.response?.length).toBeLessThanOrEqual(200);
  });
});

describe("memoryFieldsToCardInput（公开字段换算 API，RAY-237 评审建议 C1）", () => {
  it("按 domain-model §6 换算：字段直映射、时间转 Date、scheduled_days 恒为 0", () => {
    const fields: MemoryStateFields = {
      status: "review",
      due: "2026-08-10T12:00:00.000Z",
      stabilityDays: 3.5,
      difficulty: 6,
      elapsedDays: 3,
      learningSteps: 2,
      reps: 4,
      lapses: 1,
      lastReviewAt: "2026-08-07T12:00:00.000Z",
      lastRating: "good",
    };

    expect(memoryFieldsToCardInput(fields)).toEqual({
      due: new Date("2026-08-10T12:00:00.000Z"),
      stability: 3.5,
      difficulty: 6,
      scheduled_days: 0,
      learning_steps: 2,
      reps: 4,
      lapses: 1,
      state: "review",
      last_review: new Date("2026-08-07T12:00:00.000Z"),
    });
  });

  it("旧版记录缺 learningSteps 时兜底为 0，lastReviewAt 为 null 时不传 last_review", () => {
    const legacyOverrides: Partial<MemoryStateFields> = {
      learningSteps: undefined,
      lastReviewAt: null,
    };
    const fields: MemoryStateFields = {
      ...newCardFields({ now: "2026-08-10T12:00:00.000Z" }),
      ...legacyOverrides,
    };

    const input = memoryFieldsToCardInput(fields);
    expect(input.learning_steps).toBe(0);
    expect(input.last_review).toBeUndefined();
  });
});

describe("getDueItemIdsInRange（半开区间到期查询，RAY-252 明日到期用）", () => {
  it("只返回 due 落在 [from, to) 内的条目", async () => {
    const database = freshDatabase();
    const dues = [
      "2026-08-13T08:00:00.000Z", // from 之前
      "2026-08-14T00:00:00.000Z", // = from（含）
      "2026-08-14T12:00:00.000Z", // 区间内
      "2026-08-15T00:00:00.000Z", // = to（不含）
      "2026-08-15T06:00:00.000Z", // to 之后
    ];
    const itemIds: string[] = [];
    for (const [index, due] of dues.entries()) {
      const sense = makeSense();
      const item = makeLearningItem(sense.id);
      await database.senses.put(sense);
      await database.items.put(item);
      await database.memoryStates.put({
        id: item.id,
        itemId: item.id,
        fields: { ...newCardFields({ now: "2026-08-13T00:00:00.000Z" }), due },
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      });
      itemIds[index] = item.id;
    }

    const from = "2026-08-14T00:00:00.000Z";
    const to = "2026-08-15T00:00:00.000Z";
    const result = await getDueItemIdsInRange(database, from, to);
    expect(result.sort()).toEqual([itemIds[1], itemIds[2]].sort());
  });

  it("空区间返回空数组", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果,n.", {
      source: "测试",
      time: TIME,
    });
    // 导入即到期（due = TIME），查询其后一天的空区间
    const result = await getDueItemIdsInRange(
      database,
      "2026-08-14T00:00:00.000Z",
      "2026-08-15T00:00:00.000Z",
    );
    expect(result).toEqual([]);
    expect(itemIds.length).toBe(1);
  });

  it("边界对齐本地日半开区间：前一日末尾的 due 不算明日到期", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    const item = makeLearningItem(sense.id);
    await database.senses.put(sense);
    await database.items.put(item);
    // due = 8-14T23:59:59.999Z，仍属于 [8-14, 8-15) 区间
    await database.memoryStates.put({
      id: item.id,
      itemId: item.id,
      fields: {
        ...newCardFields({ now: "2026-08-13T00:00:00.000Z" }),
        due: "2026-08-14T23:59:59.999Z",
      },
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });

    const inDay = await getDueItemIdsInRange(
      database,
      "2026-08-14T00:00:00.000Z",
      "2026-08-15T00:00:00.000Z",
    );
    expect(inDay).toEqual([item.id]);
    // 次日区间（[8-15, 8-16)）不含该条目
    const nextDay = await getDueItemIdsInRange(
      database,
      "2026-08-15T00:00:00.000Z",
      "2026-08-16T00:00:00.000Z",
    );
    expect(nextDay).toEqual([]);
  });
});

describe("标熟与单步撤销（RAY-265）", () => {
  it("标熟：记录 mastered 标记，rating 映射 easy（长间隔进入调度，词保留词书）", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果,n.", {
      source: "测试",
      time: TIME,
    });
    const itemId = itemIds[0]!;
    const item = (await database.items.get(itemId))!;
    const sense = (await database.senses.get(item.senseId))!;

    const { reviewEvent, nextMemoryState, previousMemoryState } = await gradeReview(database, {
      itemId,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "easy",
      mastered: true,
      reviewDurationMs: 2000,
      revealed: false,
      answerWasCorrect: true,
      time: TIME,
    });

    expect(reviewEvent).toMatchObject({
      type: "review",
      rating: "easy",
      mastered: true,
      answerWasCorrect: true,
    });
    expect(nextMemoryState.fields.lastRating).toBe("easy");
    // 长间隔：直接进入复习状态且 due 显著晚于评分时刻（FSRS easy 排期）
    expect(nextMemoryState.fields.status).toBe("review");
    expect(Date.parse(nextMemoryState.fields.due)).toBeGreaterThan(Date.parse(TIME));
    // 词保留词书：条目状态不变（不剔除、不挂起）
    expect((await database.items.get(itemId))!.status).toBe("active");
    // 返回评分前状态供撤销回滚
    expect(previousMemoryState.fields).toEqual({
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
    });
  });

  it("普通评分不写 mastered 字段", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    const { reviewEvent } = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "easy",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
      time: TIME,
    });
    expect("mastered" in reviewEvent).toBe(false);
  });

  it("标熟配非 easy 评分被拒绝（核心层强制映射契约）", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    await expect(
      gradeReview(database, {
        itemId: item.id,
        senseId: sense.id,
        exerciseType: "recall",
        rating: "good",
        mastered: true,
        reviewDurationMs: 1000,
        revealed: false,
        answerWasCorrect: true,
        time: TIME,
      }),
    ).rejects.toThrow(RangeError);
    expect(await database.events.count()).toBe(1); // 仅 import 事件
  });

  it("撤销：完整回滚事件与记忆状态（统计口径与撤销前一致）", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    const before = (await database.memoryStates.get(item.id))!;

    const result = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1500,
      revealed: true,
      answerWasCorrect: true,
      time: TIME,
    });
    expect(await database.events.where("type").equals("review").count()).toBe(1);

    await undoReview(database, {
      itemId: item.id,
      eventId: result.reviewEvent.id,
      previousMemoryState: result.previousMemoryState,
      time: "2026-08-13T10:05:00.000Z",
    });

    // 事件删除、状态恢复（fields 逐字段一致；updatedAt 记撤销时刻）
    expect(await database.events.where("type").equals("review").count()).toBe(0);
    const restored = (await database.memoryStates.get(item.id))!;
    expect(restored.fields).toEqual(before.fields);
    expect(restored.updatedAt).toBe("2026-08-13T10:05:00.000Z");
  });

  it("撤销标熟：同样完整回滚（mastered 事件可撤销）", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    const result = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "easy",
      mastered: true,
      reviewDurationMs: 2000,
      revealed: false,
      answerWasCorrect: true,
      time: TIME,
    });

    await undoReview(database, {
      itemId: item.id,
      eventId: result.reviewEvent.id,
      previousMemoryState: result.previousMemoryState,
    });

    expect(await database.events.where("type").equals("review").count()).toBe(0);
    const restored = (await database.memoryStates.get(item.id))!;
    expect(restored.fields.reps).toBe(0);
    expect(restored.fields.lastRating).toBeNull();
  });

  it("撤销不存在的事件：报错且状态不动", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const before = (await database.memoryStates.get(item.id))!;

    await expect(
      undoReview(database, {
        itemId: item.id,
        eventId: toEventId("evt_missing_001"),
        previousMemoryState: before,
      }),
    ).rejects.toThrow("复习记录不存在或已撤销");
    expect((await database.memoryStates.get(item.id))!.fields).toEqual(before.fields);
  });

  it("事件之后存在更新的评分：拒绝撤销（防线，保护事件投影不变量）", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    const first = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
      time: "2026-08-13T10:00:00.000Z",
    });
    await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
      time: "2026-08-13T10:10:00.000Z",
    });

    await expect(
      undoReview(database, {
        itemId: item.id,
        eventId: first.reviewEvent.id,
        previousMemoryState: first.previousMemoryState,
      }),
    ).rejects.toThrow("存在更新的复习记录");
    expect(await database.events.where("type").equals("review").count()).toBe(2);
  });

  it("撤销条目不匹配的状态：报错且不落库", async () => {
    const database = freshDatabase();
    const { itemIds } = await importCsvWordlist(database, "apple,苹果", {
      source: "测试",
      time: TIME,
    });
    const item = (await database.items.get(itemIds[0]!))!;
    const sense = (await database.senses.get(item.senseId))!;
    const result = await gradeReview(database, {
      itemId: item.id,
      senseId: sense.id,
      exerciseType: "recall",
      rating: "good",
      reviewDurationMs: 1000,
      revealed: false,
      answerWasCorrect: true,
      time: TIME,
    });

    await expect(
      undoReview(database, {
        itemId: item.id,
        eventId: result.reviewEvent.id,
        previousMemoryState: { ...result.previousMemoryState, itemId: toItemId("item_other") },
      }),
    ).rejects.toThrow("撤销状态与条目不一致");
    expect(await database.events.where("type").equals("review").count()).toBe(1);
  });
});
