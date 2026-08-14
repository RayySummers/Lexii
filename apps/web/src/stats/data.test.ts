/**
 * 统计数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入示例词表 → 到期数 = 词条数（导入即到期）→
 * 评分后到期数减一、已复习数 +1、连续天数 1。与 review/data.test.ts 使用
 * 同一 fake-indexeddb 注入方式。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  importCsvWordlist,
  openDatabase,
  SAMPLE_WORDLIST_CSV,
  SAMPLE_WORDLIST_ROW_COUNT,
} from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbReviewDataProvider } from "../review/data";
import { createEmptyStatsDataProvider, createIndexedDbStatsDataProvider } from "./data";

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
    expect(await provider.loadStats()).toEqual({ dueCount: 0, reviewCount: 0, streakDays: 0 });
  });

  it("导入示例词表后到期数 = 词条数（新卡导入即到期），复习数与连续天数为 0", async () => {
    const provider = createIndexedDbStatsDataProvider(db!);
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

    const stats = await provider.loadStats();
    expect(stats.dueCount).toBe(SAMPLE_WORDLIST_ROW_COUNT);
    expect(stats.reviewCount).toBe(0);
    expect(stats.streakDays).toBe(0);
  });

  it("评分一张卡后：到期数减一，已复习数 +1，连续天数 1", async () => {
    const statsProvider = createIndexedDbStatsDataProvider(db!);
    const reviewProvider = createIndexedDbReviewDataProvider(db!);
    await importCsvWordlist(db!, SAMPLE_WORDLIST_CSV, { source: "test" });

    const card = (await reviewProvider.loadQueue())[0]!;
    await reviewProvider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });

    const stats = await statsProvider.loadStats();
    expect(stats.dueCount).toBe(SAMPLE_WORDLIST_ROW_COUNT - 1);
    expect(stats.reviewCount).toBe(1);
    expect(stats.streakDays).toBe(1);
  });
});

describe("createEmptyStatsDataProvider（无 IndexedDB 环境兜底）", () => {
  it("始终返回全零快照且不抛错", async () => {
    const provider = createEmptyStatsDataProvider();
    expect(await provider.loadStats()).toEqual({ dueCount: 0, reviewCount: 0, streakDays: 0 });
  });
});
