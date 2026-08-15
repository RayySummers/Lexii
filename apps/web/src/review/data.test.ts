/**
 * 复习数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入示例词表 → 按模式加载队列（学习 / 复习 /
 * 混合）→ 评分落库 → 队列缩短。与 packages/core 的 persistence.test.ts 使用
 * 同一 fake-indexeddb 注入方式（IDBFactory + IDBKeyRange），不依赖浏览器环境。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDatabase, SAMPLE_WORDLIST_ROW_COUNT } from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbReviewDataProvider } from "./data";
import type { ReviewCard } from "./types";
import { pastIso } from "./testFixtures";

/** 与 openDatabase 的参数类型对齐，避免直接依赖 dexie 的类型声明 */
function makeOptions(): Parameters<typeof openDatabase>[0] {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

beforeEach(() => {
  db = openDatabase(makeOptions());
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

/** 把指定卡改为「已评分且到期」（reps > 0，due 在过去），模拟复习过的词 */
async function markReviewed(card: ReviewCard): Promise<void> {
  await db!.memoryStates.put({
    ...card.memory,
    fields: {
      ...card.memory.fields,
      reps: card.memory.fields.reps + 1,
      due: pastIso(new Date(), 3_600_000),
    },
    updatedAt: new Date().toISOString(),
  });
}

describe("createIndexedDbReviewDataProvider", () => {
  it("空库：三模式 loadQueue 均为空，hasAnyItems 为 false", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    expect(await provider.loadQueue("learn")).toEqual([]);
    expect(await provider.loadQueue("review")).toEqual([]);
    expect(await provider.loadQueue("mixed")).toEqual([]);
    expect(await provider.hasAnyItems()).toBe(false);
  });

  it("导入示例词表后：全部词条进入学习队列，复习队列为空", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    const imported = await provider.importSampleWordlist();
    expect(imported).toBe(SAMPLE_WORDLIST_ROW_COUNT);

    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    // 新卡均未评分：复习队列（reps > 0）为空
    expect(await provider.loadQueue("review")).toEqual([]);
    // 复习为空时混合退化为纯新词队列
    expect(await provider.loadQueue("mixed")).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    expect(await provider.hasAnyItems()).toBe(true);

    // 新卡 due 为导入时刻，同一批导入 due 相同，队列顺序稳定（due 升序）
    const dues = learnQueue.map((card) => card.memory.fields.due);
    const sorted = [...dues].sort();
    expect(dues).toEqual(sorted);
  });

  it("评分后该卡离开学习队列，且记忆状态按排期更新", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const card = queue[0]!;

    await provider.grade(card, "good", { reviewDurationMs: 2_000, revealed: true });

    const remaining = await provider.loadQueue("learn");
    expect(remaining).toHaveLength(queue.length - 1);
    expect(remaining.some((entry) => entry.item.id === card.item.id)).toBe(false);

    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields.reps).toBe(1);
    expect(memory?.fields.lastRating).toBe("good");
    expect(memory?.fields.lastReviewAt).not.toBeNull();
    // good 走学习第二步：due 应在未来（10 分钟内），复习队列仍为空
    expect(memory!.fields.due > new Date().toISOString()).toBe(true);
    expect(await provider.loadQueue("review")).toEqual([]);
  });

  it("已评分且到期的卡只进入复习队列，不进学习队列", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    await markReviewed(queue[0]!);

    const reviewQueue = await provider.loadQueue("review");
    expect(reviewQueue).toHaveLength(1);
    expect(reviewQueue[0]!.item.id).toBe(queue[0]!.item.id);

    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(queue.length - 1);
    expect(learnQueue.some((entry) => entry.item.id === queue[0]!.item.id)).toBe(false);
  });

  it("混合模式：复习卡为主干，每 2 张穿插 1 张新词卡", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const [first, second] = queue;
    await markReviewed(first!);
    await markReviewed(second!);

    const mixed = await provider.loadQueue("mixed");
    // R R N N N ...（复习耗尽后按序补齐全部新词）
    expect(mixed[0]!.item.id).toBe(first!.item.id);
    expect(mixed[1]!.item.id).toBe(second!.item.id);
    expect(mixed.slice(2).map((card) => card.item.id)).toEqual(
      queue.slice(2).map((card) => card.item.id),
    );
    expect(mixed).toHaveLength(queue.length);
  });

  it("评分 again 后卡仍在短期学习回路，due 在未来 1 分钟附近", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const card = (await provider.loadQueue("learn"))[0]!;
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
    const queue = await provider.loadQueue("learn");
    const victim = queue[0]!;
    await db!.transaction("rw", db!.senses, db!.memoryStates, async () => {
      await db!.senses.delete(victim.sense.id);
      await db!.memoryStates.delete(victim.memory.id);
    });

    const remaining = await provider.loadQueue("learn");
    expect(remaining).toHaveLength(queue.length - 1);
    expect(remaining.some((entry) => entry.item.id === victim.item.id)).toBe(false);
  });

  it("评分时记忆状态缺失则整体失败（core 原子性契约透传）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const card = (await provider.loadQueue("learn"))[0]!;
    await db!.memoryStates.delete(card.item.id);

    await expect(
      provider.grade(card, "easy", { reviewDurationMs: 1_000, revealed: true }),
    ).rejects.toThrow();
  });

  it("每日新卡上限：设置 5 时 learn 队列只取前 5 张新卡，review 不受影响（RAY-260 suggestion 2）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(5);
    // 复习队列不含新词，额度不影响
    expect(await provider.loadQueue("review")).toEqual([]);
  });

  it("每日新卡上限：今日已学词条数扣减额度（已学 2 张后剩余额度只补到上限）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const first = (await provider.loadQueue("learn")).slice(0, 2);
    for (const card of first) {
      await provider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });
    }

    // 今日已学 2 张新卡 → 剩余额度 3
    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(3);
    const ids = new Set(learnQueue.map((card) => card.item.id));
    for (const card of first) {
      expect(ids.has(card.item.id)).toBe(false);
    }
  });
});
