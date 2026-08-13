/**
 * 复习数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入示例词表 → 加载到期队列 → 评分落库 →
 * 队列缩短。与 packages/core 的 persistence.test.ts 使用同一 fake-indexeddb
 * 注入方式（IDBFactory + IDBKeyRange），不依赖浏览器环境。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDatabase, SAMPLE_WORDLIST_ROW_COUNT } from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbReviewDataProvider } from "./data";

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

describe("createIndexedDbReviewDataProvider", () => {
  it("空库：loadQueue 为空，hasAnyItems 为 false", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    expect(await provider.loadQueue()).toEqual([]);
    expect(await provider.hasAnyItems()).toBe(false);
  });

  it("导入示例词表后队列包含全部词条且按 due 排序", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    const imported = await provider.importSampleWordlist();
    expect(imported).toBe(SAMPLE_WORDLIST_ROW_COUNT);

    const queue = await provider.loadQueue();
    expect(queue).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    expect(await provider.hasAnyItems()).toBe(true);

    // 新卡 due 为导入时刻，同一批导入 due 相同，顺序由 createdAt 决胜
    const dues = queue.map((card) => card.memory.fields.due);
    const sorted = [...dues].sort();
    expect(dues).toEqual(sorted);
  });

  it("评分后该卡离开队列，且记忆状态按排期更新", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue();
    const card = queue[0]!;

    await provider.grade(card, "good", { reviewDurationMs: 2_000, revealed: true });

    const remaining = await provider.loadQueue();
    expect(remaining).toHaveLength(queue.length - 1);
    expect(remaining.some((entry) => entry.item.id === card.item.id)).toBe(false);

    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields.reps).toBe(1);
    expect(memory?.fields.lastRating).toBe("good");
    expect(memory?.fields.lastReviewAt).not.toBeNull();
    // good 走学习第二步：due 应在未来（10 分钟内）
    expect(memory!.fields.due > new Date().toISOString()).toBe(true);
  });

  it("评分 again 后卡仍在短期学习回路，due 在未来 1 分钟附近", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const card = (await provider.loadQueue())[0]!;
    const before = Date.now();

    await provider.grade(card, "again", { reviewDurationMs: 500, revealed: false });

    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields.status).toBe("learning");
    const dueMs = Date.parse(memory!.fields.due);
    expect(dueMs).toBeGreaterThan(before);
    expect(dueMs).toBeLessThanOrEqual(before + 60_000 + 1_000);
  });

  it("不完整数据（缺义项/记忆状态）不入队，不抛错", async () => {
    // 直接塞一条只有 item、没有 sense 与 memoryState 的脏数据
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue();
    const victim = queue[0]!;
    await db!.transaction("rw", db!.senses, db!.memoryStates, async () => {
      await db!.senses.delete(victim.sense.id);
      await db!.memoryStates.delete(victim.memory.id);
    });

    const remaining = await provider.loadQueue();
    expect(remaining).toHaveLength(queue.length - 1);
    expect(remaining.some((entry) => entry.item.id === victim.item.id)).toBe(false);
  });

  it("评分时记忆状态缺失则整体失败（core 原子性契约透传）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const card = (await provider.loadQueue())[0]!;
    await db!.memoryStates.delete(card.item.id);

    await expect(
      provider.grade(card, "easy", { reviewDurationMs: 1_000, revealed: true }),
    ).rejects.toThrow();
  });
});
