/**
 * 统计数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入示例词表 → 到期数 = 词条数（导入即到期）→
 * 评分后到期数减一、已复习数 +1、连续天数 1、今日已学习 1。与 review/data.test.ts
 * 使用同一 fake-indexeddb 注入方式。
 *
 * RAY-252 新增：8 项统计快照、今日学习/复习口径、明日到期区间、累计词条去重。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  importCsvWordlist,
  openDatabase,
  SAMPLE_WORDLIST_CSV,
  SAMPLE_WORDLIST_ROW_COUNT,
  toItemId,
  toSenseId,
} from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { localDayBounds } from "@lexilexi/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbReviewDataProvider } from "../review/data";
import {
  createEmptyStatsDataProvider,
  createIndexedDbStatsDataProvider,
  EMPTY_STATS,
} from "./data";

/** 与 openDatabase 的参数类型对齐，避免直接依赖 dexie 的类型声明 */
function makeOptions(): Parameters<typeof openDatabase>[0] {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

beforeEach(() => {
  db = openDatabase(makeOptions());
});

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe("createIndexedDbStatsDataProvider", () => {
  it("空库：全零快照", async () => {
    const provider = createIndexedDbStatsDataProvider(db!);
    expect(await provider.loadStats()).toEqual(EMPTY_STATS);
  });

  it("导入示例词表后到期数 = 词条数（新卡导入即到期），其余统计为零", async () => {
    const provider = createIndexedDbStatsDataProvider(db!);
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

    const stats = await provider.loadStats();
    expect(stats).toEqual({ ...EMPTY_STATS, dueCount: SAMPLE_WORDLIST_ROW_COUNT });
  });

  it("评分一张卡后：到期数减一，累计次数/词条/天数/今日学习各 +1，今日复习为 0", async () => {
    const statsProvider = createIndexedDbStatsDataProvider(db!);
    const reviewProvider = createIndexedDbReviewDataProvider(db!);
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

    const card = (await reviewProvider.loadQueue("learn"))[0]!;
    await reviewProvider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });

    const stats = await statsProvider.loadStats();
    expect(stats.dueCount).toBe(SAMPLE_WORDLIST_ROW_COUNT - 1);
    expect(stats.reviewCount).toBe(1);
    expect(stats.completedWordCount).toBe(1);
    expect(stats.streakDays).toBe(1);
    expect(stats.totalDays).toBe(1);
    expect(stats.todayLearnCount).toBe(1);
    expect(stats.todayReviewCount).toBe(0);
    expect(stats.dueTomorrowCount).toBe(0);
  });

  it("同一张卡今天第二次评分：今日已学习不变，今日已复习 +1", async () => {
    const statsProvider = createIndexedDbStatsDataProvider(db!);
    const reviewProvider = createIndexedDbReviewDataProvider(db!);
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

    const card = (await reviewProvider.loadQueue("learn"))[0]!;
    await reviewProvider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });

    // 手动把该卡的 due 拨回过去，模拟同一天内再次到期
    const memory = (await db!.memoryStates.get(card.item.id))!;
    await db!.memoryStates.put({
      ...memory,
      fields: { ...memory.fields, due: new Date(Date.now() - 1000).toISOString() },
    });

    const again = (await reviewProvider.loadQueue("review"))[0]!;
    await reviewProvider.grade(again, "hard", { reviewDurationMs: 500, revealed: false });

    const stats = await statsProvider.loadStats();
    expect(stats.todayLearnCount).toBe(1);
    expect(stats.todayReviewCount).toBe(1);
    expect(stats.reviewCount).toBe(2);
    expect(stats.completedWordCount).toBe(1);
  });

  it("明日到期：due 落在明天本地日历日内的记忆状态计入，其余不计", async () => {
    const statsProvider = createIndexedDbStatsDataProvider(db!);
    const now = new Date();
    const tomorrow = localDayBounds(now.toISOString(), 1);
    const dayAfter = localDayBounds(now.toISOString(), 2);

    // 通过导入创建一条「导入即到期」的词条（due = 导入时刻，今日到期）
    await importCsvWordlist(db!, "apple,苹果,n.", { source: "test" });
    const items = await db!.items.toArray();
    const firstItem = items[0]!;

    // 追加两条不同 due 的记忆状态：明天中午（计入）与后天中午（不计入）
    for (const due of [tomorrow.start, dayAfter.start]) {
      const key = encodeURIComponent(due);
      const senseId = toSenseId(`sense-due-${key}`);
      const itemId = toItemId(`item-due-${key}`);
      await db!.senses.put({
        id: senseId,
        lang: "en",
        term: `term-${key}`,
        definitions: ["释义"],
        tags: [],
        examples: [],
      });
      await db!.items.put({
        id: itemId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        source: "test",
        senseId,
        kind: "word",
        status: "active",
      });
      await db!.memoryStates.put({
        id: itemId,
        itemId,
        fields: {
          status: "new",
          due: new Date(Date.parse(due) + 3_600_000).toISOString(),
          stabilityDays: 0,
          difficulty: 0,
          elapsedDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          lastReviewAt: null,
          lastRating: null,
        },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    const stats = await statsProvider.loadStats();
    expect(stats.dueCount).toBe(1); // 仅导入的词条今日到期
    expect(stats.dueTomorrowCount).toBe(1); // 仅明天中午那条
    expect(firstItem.id).toBeDefined();
  });
});

describe("createEmptyStatsDataProvider（无 IndexedDB 环境兜底）", () => {
  it("始终返回全零快照且不抛错", async () => {
    const provider = createEmptyStatsDataProvider();
    expect(await provider.loadStats()).toEqual(EMPTY_STATS);
  });
});
