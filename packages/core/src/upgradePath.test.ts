/**
 * 升级路径回归测试（RAY-276 诊断线 1 的落地防线）。
 *
 * 复现真机场景：v0.1.0-alpha.2（schema v1）时代的设备数据——已学词
 * （reps > 0、due 分布在过去/今天）+ 未学新词（reps = 0）+ 学习记录
 * （review/import 事件）——由当前代码（v1→v4 迁移链）打开后必须完整保留：
 * 条目、义项、记忆状态、事件一个不少，到期队列与「今日待学」口径正常。
 *
 * 红线（Oscar 评审标准 4）：schema 升级必须走版本迁移，禁止清库重来。
 * 此测试按 alpha.2 的真实落库形态直接以 v1 schema 建库（不经当前代码
 * 的版本链），再让当前 openDatabase 执行迁移，锁定升级不丢数据。
 */
import Dexie from "dexie";
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { endOfLocalDay } from "./dayBoundary";
import { openDatabase } from "./persistence";
import type { LexilexiDatabase } from "./persistence";
import { getDueItemIds, getStudyQueueItemIds } from "./studyLoop";

function makeOptions(factory: IDBFactory): DexieOptions {
  return { indexedDB: factory, IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

/** 以 alpha.2 的 v1 schema 直接建库（模拟旧版本写入的真实数据） */
async function createLegacyV1Database(factory: IDBFactory): Promise<Dexie> {
  const legacy = new Dexie("lexilexi", makeOptions(factory));
  legacy.version(1).stores({
    items: "id",
    senses: "id",
    memoryStates: "id",
    events: "id, time, type",
  });
  await legacy.open();
  return legacy;
}

function isoAt(dayOffset: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
}

describe("alpha.2（schema v1）→ 当前（v4）升级不丢数据", () => {
  it("已学词、新词、学习记录与到期队列在迁移后完整保留", async () => {
    const factory = new IDBFactory();
    const legacy = await createLegacyV1Database(factory);
    const yesterday = isoAt(-1, 10);
    const today = isoAt(0, 8);

    // 昨天学过的 20 个词：reps=1，due = 今天（+1 天同刻）
    for (let i = 0; i < 20; i++) {
      const itemId = `item_learned_${i}`;
      const senseId = `sense_${i}`;
      await legacy.table("senses").put({
        id: senseId,
        term: `learned${i}`,
        lang: "en",
        definitions: ["释义"],
        ipa: "",
        examples: [],
      });
      await legacy.table("items").put({
        id: itemId,
        createdAt: yesterday,
        updatedAt: yesterday,
        source: "内置词表",
        senseId,
        kind: "word",
        status: "active",
      });
      await legacy.table("memoryStates").put({
        id: itemId,
        itemId,
        fields: {
          status: "review",
          due: isoAt(0, 10),
          stabilityDays: 1.5,
          difficulty: 5,
          elapsedDays: 0,
          learningSteps: 0,
          reps: 1,
          lapses: 0,
          lastReviewAt: yesterday,
          lastRating: "good",
        },
        createdAt: yesterday,
        updatedAt: yesterday,
      });
      await legacy.table("events").put({
        id: `evt_learned_${i}`,
        type: "review",
        time: yesterday,
        itemId,
        senseId,
        exerciseType: "recall",
        rating: "good",
        reviewDurationMs: 1000,
        revealed: true,
        answerWasCorrect: true,
        elapsedDays: 0,
      });
    }

    // 200 个未学新词：reps=0，due = 导入时刻（昨天）
    for (let i = 0; i < 200; i++) {
      const itemId = `item_new_${i}`;
      const senseId = `sense_new_${i}`;
      await legacy.table("senses").put({
        id: senseId,
        term: `new${i}`,
        lang: "en",
        definitions: ["释义"],
        ipa: "",
        examples: [],
      });
      await legacy.table("items").put({
        id: itemId,
        createdAt: yesterday,
        updatedAt: yesterday,
        source: "内置词表",
        senseId,
        kind: "word",
        status: "active",
      });
      await legacy.table("memoryStates").put({
        id: itemId,
        itemId,
        fields: {
          status: "new",
          due: yesterday,
          stabilityDays: 0,
          difficulty: 0,
          elapsedDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          lastReviewAt: null,
          lastRating: null,
        },
        createdAt: yesterday,
        updatedAt: yesterday,
      });
      await legacy.table("events").put({
        id: `evt_new_${i}`,
        type: "import",
        time: yesterday,
        itemId,
        senseId,
        term: `new${i}`,
        lang: "en",
      });
    }
    legacy.close();

    // 当前代码打开：执行 v1→v6 迁移链（v2 meta、v3 fields.due 索引、v4 term 索引、v5 notebookEntries、v6 dictionarySenses）
    db = openDatabase(makeOptions(factory));
    await db.open();

    expect(db.verno).toBe(6);
    expect(await db.items.count()).toBe(220);
    expect(await db.senses.count()).toBe(220);
    expect(await db.memoryStates.count()).toBe(220);
    expect(await db.events.count()).toBe(220);

    // 到期队列走 fields.due 索引：200 新词 + 20 已学词全部在今日队列
    // （已学词 due 今天 10:30 ≤ 今日结束——日历日口径，RAY-276 诊断线 2）
    const now = today;
    const dueIds = await getDueItemIds(db, now);
    expect(dueIds.length).toBe(220);

    // 学习模式（每日新卡上限 20）：截取前 20 张新词
    const learnIds = await getStudyQueueItemIds(db, now, "learn", {
      newCardLimit: 20,
    });
    expect(learnIds.length).toBe(20);

    // 复习模式：昨天学过的 20 词今天到期（due 今天 10:30，上午 8 点即可复习）
    const reviewIds = await getStudyQueueItemIds(db, now, "review");
    expect(reviewIds.length).toBe(20);

    // 「今日待学」= 今天 23:59:59.999 之前到期的全部（含稍后到期的卡），
    // 明天的卡不进入
    const dueBeforeDayEnd = await db
      .table("memoryStates")
      .where("fields.due")
      .belowOrEqual(endOfLocalDay(now))
      .count();
    expect(dueBeforeDayEnd).toBe(220);
  });
});
