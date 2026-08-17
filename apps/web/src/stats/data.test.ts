/**
 * 统计数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexii/core 路径：导入示例词表 → 到期数 = 词条数（导入即到期）→
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
} from "@lexii/core";
import type { LexiiDatabase } from "@lexii/core";
import { localDayBounds, MAX_EFFECTIVE_REVIEW_DURATION_MS } from "@lexii/stats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_NEW_CARD_LIMIT_STORAGE_KEY } from "../lib/dailyNewCardLimit";
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

let db: LexiiDatabase | undefined;

beforeEach(() => {
  db = openDatabase(makeOptions());
  // 「每日新卡上限」走 localStorage：清理后一律回落默认值 20，
  // 各用例按需显式设置（与 HomeScreen.test 同一口径）
  window.localStorage.clear();
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

  it("导入示例词表后到期数 = 词条数（新卡导入即到期），其余统计为零；今日待学按默认上限 20 过滤 = 14（剩余新卡 < 上限）", async () => {
    const provider = createIndexedDbStatsDataProvider(db!);
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

    const stats = await provider.loadStats();
    expect(stats).toEqual({
      ...EMPTY_STATS,
      dueCount: SAMPLE_WORDLIST_ROW_COUNT,
      newCardsRemainingToday: SAMPLE_WORDLIST_ROW_COUNT,
    });
  });

  it("评分一张卡后：累计次数/词条/天数/今日学习各 +1，今日复习为 0；该卡 10 分钟后到期仍属今日待学（日历日口径）", async () => {
    // 冻结系统时间到远离本地午夜的时刻（只假 Date、不假计时器，Dexie 事务不受影响）：
    // 「good」的到期时间在 10 分钟内，若在 23:50 之后运行会跨过本地午夜，
    // 使 dueTomorrowCount 变成 1，产生与实现无关的时间点抖动。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-14T04:00:00.000Z"));
    try {
      const statsProvider = createIndexedDbStatsDataProvider(db!);
      const reviewProvider = createIndexedDbReviewDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const card = (await reviewProvider.loadQueue("learn"))[0]!;
      await reviewProvider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });

      const stats = await statsProvider.loadStats();
      // 日历日口径（RAY-276 诊断线 2）：good 后 due 在未来 10 分钟，仍属
      // 「今日待学」，到期数不减；明日到期仍为 0
      expect(stats.dueCount).toBe(SAMPLE_WORDLIST_ROW_COUNT);
      expect(stats.reviewCount).toBe(1);
      expect(stats.completedWordCount).toBe(1);
      expect(stats.streakDays).toBe(1);
      expect(stats.totalDays).toBe(1);
      expect(stats.todayLearnCount).toBe(1);
      expect(stats.todayReviewCount).toBe(0);
      expect(stats.dueTomorrowCount).toBe(0);
      // RAY-295：今日待学 = min(20 − 1, 剩余 13) = 13（不被已学重复扣减）
      expect(stats.newCardsRemainingToday).toBe(SAMPLE_WORDLIST_ROW_COUNT - 1);
      // RAY-270：学习时长随 review 事件落库推导（1 秒）
      expect(stats.todayStudyDurationMs).toBe(1_000);
      expect(stats.totalStudyDurationMs).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("学习时长（RAY-270）", () => {
    it("多次评分累计：今日与累计时长均为各次有效时长之和", async () => {
      const statsProvider = createIndexedDbStatsDataProvider(db!);
      const reviewProvider = createIndexedDbReviewDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const cards = await reviewProvider.loadQueue("learn");
      await reviewProvider.grade(cards[0]!, "good", { reviewDurationMs: 1_000, revealed: true });
      await reviewProvider.grade(cards[1]!, "good", { reviewDurationMs: 2_500, revealed: true });

      const stats = await statsProvider.loadStats();
      expect(stats.todayStudyDurationMs).toBe(3_500);
      expect(stats.totalStudyDurationMs).toBe(3_500);
    });

    it("单卡挂机超上限：时长按上限截断，不虚高", async () => {
      const statsProvider = createIndexedDbStatsDataProvider(db!);
      const reviewProvider = createIndexedDbReviewDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const card = (await reviewProvider.loadQueue("learn"))[0]!;
      // 卡片挂了 30 分钟才评分：只有 5 分钟上限计入有效时长
      await reviewProvider.grade(card, "good", {
        reviewDurationMs: 30 * 60_000,
        revealed: true,
      });

      const stats = await statsProvider.loadStats();
      expect(stats.todayStudyDurationMs).toBe(MAX_EFFECTIVE_REVIEW_DURATION_MS);
      expect(stats.totalStudyDurationMs).toBe(MAX_EFFECTIVE_REVIEW_DURATION_MS);
    });

    it("撤销评分后时长口径一致：事件删除，时长同步回滚（RAY-265 撤销红线）", async () => {
      const statsProvider = createIndexedDbStatsDataProvider(db!);
      const reviewProvider = createIndexedDbReviewDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const card = (await reviewProvider.loadQueue("learn"))[0]!;
      const result = await reviewProvider.grade(card, "good", {
        reviewDurationMs: 4_000,
        revealed: true,
      });

      let stats = await statsProvider.loadStats();
      expect(stats.todayStudyDurationMs).toBe(4_000);
      expect(stats.totalStudyDurationMs).toBe(4_000);

      await reviewProvider.undoGrade(
        card.item.id,
        result.reviewEventId,
        result.previousMemoryState,
      );

      stats = await statsProvider.loadStats();
      expect(stats.todayStudyDurationMs).toBe(0);
      expect(stats.totalStudyDurationMs).toBe(0);
      expect(stats.reviewCount).toBe(0);
    });
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

  describe("今日待学按每日新卡上限过滤（RAY-295）", () => {
    /** 生成 N 行合法词表 CSV（term 仅含字母且唯一，避免义项合并） */
    function csvWith(rowCount: number): string {
      return Array.from({ length: rowCount }, (_, i) => {
        const term = `w${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
        return `${term},词${i},n.`;
      }).join("\n");
    }

    it("剩余新卡 > 上限：设置上限 5 时今日待学 = 5（不显示全部 14 张）", async () => {
      window.localStorage.setItem(DAILY_NEW_CARD_LIMIT_STORAGE_KEY, "5");
      const provider = createIndexedDbStatsDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const stats = await provider.loadStats();
      expect(stats.dueCount).toBe(SAMPLE_WORDLIST_ROW_COUNT); // 未截断口径不变（首页徽标用）
      expect(stats.newCardsRemainingToday).toBe(5);
    });

    it("剩余新卡 > 上限（默认上限 20）：25 张新卡时今日待学 = 20", async () => {
      const provider = createIndexedDbStatsDataProvider(db!);
      await importCsvWordlist(db!, csvWith(25), { source: "test" });

      const stats = await provider.loadStats();
      expect(stats.dueCount).toBe(25);
      expect(stats.newCardsRemainingToday).toBe(20);
    });

    it("今日已学后扣减：学 3 张（14 张词表）后今日待学 = 11", async () => {
      const statsProvider = createIndexedDbStatsDataProvider(db!);
      const reviewProvider = createIndexedDbReviewDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const cards = await reviewProvider.loadQueue("learn");
      for (const card of cards.slice(0, 3)) {
        await reviewProvider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });
      }

      const stats = await statsProvider.loadStats();
      expect(stats.todayLearnCount).toBe(3);
      expect(stats.newCardsRemainingToday).toBe(SAMPLE_WORDLIST_ROW_COUNT - 3);
    });

    it("已学满今日额度：上限 1 学 1 张后今日待学 = 0", async () => {
      window.localStorage.setItem(DAILY_NEW_CARD_LIMIT_STORAGE_KEY, "1");
      const statsProvider = createIndexedDbStatsDataProvider(db!);
      const reviewProvider = createIndexedDbReviewDataProvider(db!);
      await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

      const card = (await reviewProvider.loadQueue("learn"))[0]!;
      await reviewProvider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });

      const stats = await statsProvider.loadStats();
      expect(stats.todayLearnCount).toBe(1);
      expect(stats.newCardsRemainingToday).toBe(0);
      expect(stats.dueCount).toBe(SAMPLE_WORDLIST_ROW_COUNT); // 未截断口径不变
    });
  });
});

describe("createEmptyStatsDataProvider（无 IndexedDB 环境兜底）", () => {
  it("始终返回全零快照且不抛错", async () => {
    const provider = createEmptyStatsDataProvider();
    expect(await provider.loadStats()).toEqual(EMPTY_STATS);
  });
});
