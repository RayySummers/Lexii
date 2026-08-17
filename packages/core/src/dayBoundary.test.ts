/**
 * 「今日」到期边界（RAY-276 诊断线 2）：endOfLocalDay 与查询口径。
 *
 * 锁定日历日语义：due <= 今日 23:59:59.999（本地日历日）即进入今日队列，
 * 明天起才到期的卡不提前进入；endOfLocalDay 由本地日历分量构造，
 * 与夏令时无关（与 @lexii/stats 的 localDayBounds 同源）。
 */
import { afterEach, describe, expect, it } from "vitest";
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { endOfLocalDay } from "./dayBoundary";
import { makeLearningItem, makeMemoryState, makeSense } from "./helpers";
import { openDatabase } from "./persistence";
import type { LexiiDatabase } from "./persistence";
import { getDueItemIds } from "./studyLoop";

function makeOptions(): DexieOptions {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexiiDatabase | undefined;

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe("endOfLocalDay（本地日历日边界）", () => {
  it("返回所在本地日历日的 23:59:59.999（含）", () => {
    const noon = new Date(2026, 7, 16, 12, 0, 0, 0).toISOString();
    const end = new Date(endOfLocalDay(noon));
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
    // 与次日 00:00 相差 1ms（边界含当天最后一毫秒）
    const nextDayStart = new Date(2026, 7, 17, 0, 0, 0, 0).getTime();
    expect(nextDayStart - end.getTime()).toBe(1);
  });

  it("非法时间抛 RangeError", () => {
    expect(() => endOfLocalDay("not-a-date")).toThrow(RangeError);
  });
});

describe("getDueItemIds（日历日到期口径）", () => {
  it("due 在今天稍后的卡进入队列；明天起的卡排除", async () => {
    const database = (db = openDatabase(makeOptions()));
    const now = new Date(2026, 7, 16, 8, 0, 0, 0).toISOString(); // 今天 08:00
    const dueEvening = new Date(2026, 7, 16, 21, 0, 0, 0).toISOString(); // 今天 21:00
    const dueTomorrow = new Date(2026, 7, 17, 0, 30, 0, 0).toISOString(); // 明天 00:30

    const seedState = async (itemId: string, due: string): Promise<string> => {
      const sense = makeSense(`sense_${itemId}`);
      const item = makeLearningItem(sense.id, `item_${itemId}`);
      const state = makeMemoryState(item.id);
      await database.senses.put(sense);
      await database.items.put(item);
      await database.memoryStates.put({ ...state, fields: { ...state.fields, due } });
      return item.id;
    };

    const eveningId = await seedState("evening", dueEvening);
    await seedState("tomorrow", dueTomorrow);

    const dueIds = await getDueItemIds(database, now);
    expect(dueIds).toEqual([eveningId]);
  });

  it("跨午夜：昨天欠下的到期卡今天仍在队列（积压不清零）", async () => {
    const database = (db = openDatabase(makeOptions()));
    const now = new Date(2026, 7, 16, 0, 10, 0, 0).toISOString(); // 今天 00:10
    const overdue = new Date(2026, 7, 14, 12, 0, 0, 0).toISOString(); // 前天 12:00

    const sense = makeSense("sense_overdue");
    const item = makeLearningItem(sense.id, "item_overdue");
    const state = makeMemoryState(item.id);
    await database.senses.put(sense);
    await database.items.put(item);
    await database.memoryStates.put({ ...state, fields: { ...state.fields, due: overdue } });

    const dueIds = await getDueItemIds(database, now);
    expect(dueIds).toEqual([item.id]);
  });
});
