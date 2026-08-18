/**
 * 自定义单词列表（RAY-325）：createCustomList / updateCustomList /
 * deleteCustomList / addWordToCustomList / removeWordFromCustomList /
 * listCustomLists / listCustomListsWithSummary /
 * getCustomListsContainingSense / listCustomListEntries 的数据层测试。
 *
 * 走真实 @lexii/core 路径（fake-indexeddb）：
 * - 创建：name 必填 trim 后 1-60、description 可选 trim 后 ≤ 200；
 *   空 description 规范化为 ""，避免 UI 层展示 undefined；
 * - 校验：名称 / 描述长度超限、空名称、删 / 改不存在的列表均报错；
 * - 加入：同 listId + senseId 的 active 条目幂等（连点 / 重复加词不重复）；
 * - 移出：条目标记 removed（保留为历史），列表元数据与义项本身不受影响；
 *   列表整体删除时其下所有 active 条目批量标记 removed；
 * - 列表：仅 active、按 createdAt 倒序；统计单次批量聚合（无 N+1）。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { makeSense, now } from "./helpers";
import { toCustomListEntryId, toCustomListId, toSenseId } from "./id";
import {
  addWordToCustomList,
  createCustomList,
  CUSTOM_LIST_DESCRIPTION_MAX,
  CUSTOM_LIST_NAME_MAX,
  deleteCustomList,
  getCustomList,
  getCustomListsContainingSense,
  listCustomListEntries,
  listCustomLists,
  listCustomListsWithSummary,
  openDatabase,
  removeWordFromCustomList,
  updateCustomList,
  validateCustomListDescription,
  validateCustomListName,
} from "./index";
import type { LexiiDatabase } from "./persistence";

/** 每个用例用独立的 fake-indexeddb 实例（互不干扰） */
function makeOptions(): DexieOptions {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexiiDatabase | undefined;

function freshDatabase(): LexiiDatabase {
  db = openDatabase(makeOptions());
  return db;
}

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

describe("validateCustomListName / validateCustomListDescription（输入校验）", () => {
  it("空名称（trim 后空）报错", () => {
    expect(() => validateCustomListName("")).toThrow("列表名称不能为空");
    expect(() => validateCustomListName("   ")).toThrow("列表名称不能为空");
  });

  it("超过 60 字符报错", () => {
    expect(() => validateCustomListName("a".repeat(CUSTOM_LIST_NAME_MAX + 1))).toThrow(
      "超过 " + CUSTOM_LIST_NAME_MAX,
    );
  });

  it("trim 前后空格后非空视为合法", () => {
    expect(() => validateCustomListName("  阅读常见词  ")).not.toThrow();
  });

  it("描述超过 200 字符报错", () => {
    expect(() =>
      validateCustomListDescription("a".repeat(CUSTOM_LIST_DESCRIPTION_MAX + 1)),
    ).toThrow("超过 " + CUSTOM_LIST_DESCRIPTION_MAX);
  });
});

describe("createCustomList（创建列表）", () => {
  it("创建：name 必填，description 可选且空值规范化为空串", async () => {
    const database = freshDatabase();
    const time = now();

    const list = await createCustomList(database, {
      name: "工作中常用",
      description: "邮件 / 会议高频词",
      now: time,
    });

    expect(list.status).toBe("active");
    expect(list.removedAt).toBeNull();
    expect(list.name).toBe("工作中常用");
    expect(list.description).toBe("邮件 / 会议高频词");
    expect(list.createdAt).toBe(time);
    expect(list.updatedAt).toBe(time);
    expect(await database.customLists.count()).toBe(1);
  });

  it("未传 description 时规范化为空串，避免 UI 层展示 undefined", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "无描述" });
    expect(list.description).toBe("");
  });

  it("name 自动 trim 首尾空格", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "  阅读常见词  " });
    expect(list.name).toBe("阅读常见词");
  });

  it("空名 / 长度超限均报错，事务不留半条记录", async () => {
    const database = freshDatabase();
    await expect(createCustomList(database, { name: "  " })).rejects.toThrow("列表名称不能为空");
    await expect(
      createCustomList(database, { name: "a".repeat(CUSTOM_LIST_NAME_MAX + 1) }),
    ).rejects.toThrow("超过");
    expect(await database.customLists.count()).toBe(0);
  });
});

describe("updateCustomList（编辑列表）", () => {
  it("改名 + 改描述均生效，updatedAt 推进；createdAt 保留", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, {
      name: "原名",
      description: "原描述",
      now: "2026-08-13T10:00:00.000Z",
    });

    const updated = await updateCustomList(database, {
      id: list.id,
      name: "新名",
      description: "新描述",
      now: "2026-08-14T10:00:00.000Z",
    });

    expect(updated.name).toBe("新名");
    expect(updated.description).toBe("新描述");
    expect(updated.createdAt).toBe("2026-08-13T10:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-08-14T10:00:00.000Z");
  });

  it("description 传 null 清空描述", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "x", description: "原" });
    const updated = await updateCustomList(database, { id: list.id, description: null });
    expect(updated.description).toBe("");
  });

  it("name / description 至少传一个；都未传报错", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "x" });
    await expect(updateCustomList(database, { id: list.id })).rejects.toThrow("至少传入");
    expect((await database.customLists.get(list.id))?.name).toBe("x");
  });

  it("列表不存在 / 已删除均报错，事务回滚", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "x" });
    await deleteCustomList(database, { id: list.id });

    await expect(updateCustomList(database, { id: list.id, name: "y" })).rejects.toThrow(
      "不可编辑",
    );
    await expect(
      updateCustomList(database, { id: toCustomListId("cl_missing"), name: "y" }),
    ).rejects.toThrow("不存在");
  });
});

describe("deleteCustomList（删除列表）", () => {
  it("列表标记 removed + 其下所有 active 条目批量标记 removed，单事务原子", async () => {
    const database = freshDatabase();
    const senseA = makeSense("sense_a");
    const senseB = makeSense("sense_b");
    await database.senses.bulkPut([senseA, senseB]);

    const list = await createCustomList(database, { name: "x" });
    const entryA = await addWordToCustomList(database, { listId: list.id, senseId: senseA.id });
    const entryB = await addWordToCustomList(database, { listId: list.id, senseId: senseB.id });

    const removedAt = "2026-08-15T00:00:00.000Z";
    await deleteCustomList(database, { id: list.id, now: removedAt });

    // 列表元数据：标记 removed
    expect((await database.customLists.get(list.id))?.status).toBe("removed");
    expect((await database.customLists.get(list.id))?.removedAt).toBe(removedAt);
    // 条目：批量标记 removed（保留为历史）
    expect((await database.customListEntries.get(entryA.id))?.status).toBe("removed");
    expect((await database.customListEntries.get(entryA.id))?.removedAt).toBe(removedAt);
    expect((await database.customListEntries.get(entryB.id))?.status).toBe("removed");
    // 义项本身不受影响
    expect(await database.senses.get(senseA.id)).toBeDefined();
    expect(await database.senses.get(senseB.id)).toBeDefined();
  });

  it("重复删除报错；列表不存在报错，事务回滚", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "x" });
    await deleteCustomList(database, { id: list.id });
    await expect(deleteCustomList(database, { id: list.id })).rejects.toThrow("不可重复删除");
    await expect(deleteCustomList(database, { id: toCustomListId("cl_missing") })).rejects.toThrow(
      "不存在",
    );
  });

  it("列表删除后其他列表 / 同 sense 在其他列表的条目不受影响", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);

    const listA = await createCustomList(database, { name: "A" });
    const listB = await createCustomList(database, { name: "B" });
    const entryA = await addWordToCustomList(database, { listId: listA.id, senseId: sense.id });
    const entryB = await addWordToCustomList(database, { listId: listB.id, senseId: sense.id });

    await deleteCustomList(database, { id: listA.id });

    expect((await database.customListEntries.get(entryA.id))?.status).toBe("removed");
    expect((await database.customListEntries.get(entryB.id))?.status).toBe("active");
    expect((await database.customLists.get(listB.id))?.status).toBe("active");
  });
});

describe("addWordToCustomList（加入列表）", () => {
  it("加入：写入 active 条目", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });

    const entry = await addWordToCustomList(database, {
      listId: list.id,
      senseId: sense.id,
      now: now(),
    });

    expect(entry.status).toBe("active");
    expect(entry.listId).toBe(list.id);
    expect(entry.senseId).toBe(sense.id);
    expect(await database.customListEntries.count()).toBe(1);
  });

  it("同 listId + senseId 重复加入幂等：返回既有 active 条目，不重复创建", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });

    const first = await addWordToCustomList(database, { listId: list.id, senseId: sense.id });
    const second = await addWordToCustomList(database, {
      listId: list.id,
      senseId: sense.id,
      now: "2026-08-14T00:00:00.000Z",
    });

    expect(second.id).toBe(first.id);
    expect(second.addedAt).toBe(first.addedAt);
    expect(await database.customListEntries.count()).toBe(1);
  });

  it("同义项可在多个列表中各有一条（多对一关联）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const listA = await createCustomList(database, { name: "A" });
    const listB = await createCustomList(database, { name: "B" });

    const entryA = await addWordToCustomList(database, { listId: listA.id, senseId: sense.id });
    const entryB = await addWordToCustomList(database, { listId: listB.id, senseId: sense.id });

    expect(entryA.id).not.toBe(entryB.id);
    expect(entryA.listId).toBe(listA.id);
    expect(entryB.listId).toBe(listB.id);
    expect(await database.customListEntries.count()).toBe(2);
  });

  it("列表已删除 / 义项不存在均报错，事务回滚不留半条记录", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });
    await deleteCustomList(database, { id: list.id });

    // 列表已删除：报「不可加入词条」
    await expect(
      addWordToCustomList(database, { listId: list.id, senseId: sense.id }),
    ).rejects.toThrow("不可加入词条");
    // 义项不存在：用另一个新建的活动列表，报「义项不存在」
    const activeList = await createCustomList(database, { name: "active" });
    await expect(
      addWordToCustomList(database, {
        listId: activeList.id,
        senseId: toSenseId("sense_missing"),
      }),
    ).rejects.toThrow("义项不存在");
    expect(await database.customListEntries.count()).toBe(0);
  });

  it("移出后重新加入：创建新条目，旧 removed 记录保留为历史", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });

    const first = await addWordToCustomList(database, {
      listId: list.id,
      senseId: sense.id,
      now: "2026-08-13T00:00:00.000Z",
    });
    await removeWordFromCustomList(database, { entryId: first.id });
    const second = await addWordToCustomList(database, {
      listId: list.id,
      senseId: sense.id,
      now: "2026-08-14T00:00:00.000Z",
    });

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("active");
    expect((await database.customListEntries.get(first.id))?.status).toBe("removed");
  });
});

describe("removeWordFromCustomList（移出列表）", () => {
  it("条目标记 removed（保留为历史），列表元数据与义项不受影响", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });
    const entry = await addWordToCustomList(database, { listId: list.id, senseId: sense.id });
    const time = "2026-08-15T00:00:00.000Z";

    await removeWordFromCustomList(database, { entryId: entry.id, now: time });

    expect((await database.customListEntries.get(entry.id))?.status).toBe("removed");
    expect((await database.customListEntries.get(entry.id))?.removedAt).toBe(time);
    expect((await database.customLists.get(list.id))?.status).toBe("active");
    expect(await database.senses.get(sense.id)).toBeDefined();
  });

  it("重复移出报错；条目不存在报错，事务回滚", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });
    const entry = await addWordToCustomList(database, { listId: list.id, senseId: sense.id });
    await removeWordFromCustomList(database, { entryId: entry.id });

    await expect(removeWordFromCustomList(database, { entryId: entry.id })).rejects.toThrow(
      "不可重复移出",
    );
    await expect(
      removeWordFromCustomList(database, { entryId: toCustomListEntryId("cle_missing") }),
    ).rejects.toThrow("不存在");
  });
});

describe("listCustomLists / listCustomListsWithSummary（列表 + 统计）", () => {
  it("listCustomLists 仅返回 active 列表，按 createdAt 倒序", async () => {
    const database = freshDatabase();
    const early = await createCustomList(database, {
      name: "早",
      now: "2026-08-10T00:00:00.000Z",
    });
    const middle = await createCustomList(database, {
      name: "中",
      now: "2026-08-13T00:00:00.000Z",
    });
    const late = await createCustomList(database, {
      name: "晚",
      now: "2026-08-16T00:00:00.000Z",
    });
    await deleteCustomList(database, { id: early.id, now: "2026-08-12T00:00:00.000Z" });

    const lists = await listCustomLists(database);
    expect(lists.map((list) => list.id)).toEqual([late.id, middle.id]);
  });

  it("listCustomListsWithSummary 单次聚合 entryCount + latestAddedAt（无 N+1）", async () => {
    const database = freshDatabase();
    const senseA = makeSense("sense_a");
    const senseB = makeSense("sense_b");
    const senseC = makeSense("sense_c");
    await database.senses.bulkPut([senseA, senseB, senseC]);

    // 三列表的 createdAt 按 D / C / B 错落，最后全部时间戳明确可控
    const listEmpty = await createCustomList(database, {
      name: "空列表",
      now: "2026-08-12T00:00:00.000Z",
    });
    const listTwo = await createCustomList(database, {
      name: "两词",
      now: "2026-08-13T00:00:00.000Z",
    });
    const listThree = await createCustomList(database, {
      name: "三词",
      now: "2026-08-16T00:00:00.000Z",
    });
    await addWordToCustomList(database, {
      listId: listTwo.id,
      senseId: senseA.id,
      now: "2026-08-14T00:00:00.000Z",
    });
    await addWordToCustomList(database, {
      listId: listTwo.id,
      senseId: senseB.id,
      now: "2026-08-15T00:00:00.000Z",
    });
    await addWordToCustomList(database, {
      listId: listThree.id,
      senseId: senseA.id,
      now: "2026-08-13T00:00:00.000Z",
    });
    await addWordToCustomList(database, {
      listId: listThree.id,
      senseId: senseB.id,
      now: "2026-08-14T00:00:00.000Z",
    });
    await addWordToCustomList(database, {
      listId: listThree.id,
      senseId: senseC.id,
      now: "2026-08-15T00:00:00.000Z",
    });

    const summaries = await listCustomListsWithSummary(database);
    // 按 createdAt 倒序：listThree（08-16）在前，listTwo（08-13）居中，listEmpty（08-12）在后
    expect(summaries.map((s) => s.list.id)).toEqual([listThree.id, listTwo.id, listEmpty.id]);
    const three = summaries.find((s) => s.list.id === listThree.id);
    expect(three?.entryCount).toBe(3);
    expect(three?.latestAddedAt).toBe("2026-08-15T00:00:00.000Z");
    const two = summaries.find((s) => s.list.id === listTwo.id);
    expect(two?.entryCount).toBe(2);
    expect(two?.latestAddedAt).toBe("2026-08-15T00:00:00.000Z");
    const empty = summaries.find((s) => s.list.id === listEmpty.id);
    expect(empty?.entryCount).toBe(0);
    expect(empty?.latestAddedAt).toBeNull();
  });

  it("空库返回空数组", async () => {
    const database = freshDatabase();
    expect(await listCustomLists(database)).toEqual([]);
    expect(await listCustomListsWithSummary(database)).toEqual([]);
  });
});

describe("getCustomList（按 id 读取）", () => {
  it("存在则返回；不存在返回 undefined", async () => {
    const database = freshDatabase();
    const list = await createCustomList(database, { name: "x" });
    expect((await getCustomList(database, list.id))?.id).toBe(list.id);
    expect(await getCustomList(database, toCustomListId("cl_missing"))).toBeUndefined();
  });
});

describe("getCustomListsContainingSense（按义项反查列表）", () => {
  it("返回包含指定义项的所有 active 列表，按 createdAt 倒序", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);

    const listA = await createCustomList(database, {
      name: "A",
      now: "2026-08-10T00:00:00.000Z",
    });
    const listB = await createCustomList(database, {
      name: "B",
      now: "2026-08-15T00:00:00.000Z",
    });
    const listC = await createCustomList(database, {
      name: "C",
      now: "2026-08-12T00:00:00.000Z",
    });
    const listRemoved = await createCustomList(database, {
      name: "已删",
      now: "2026-08-11T00:00:00.000Z",
    });

    await addWordToCustomList(database, { listId: listA.id, senseId: sense.id });
    await addWordToCustomList(database, { listId: listB.id, senseId: sense.id });
    await addWordToCustomList(database, { listId: listC.id, senseId: sense.id });
    // 已删列表：加入后随列表被整体移除
    await addWordToCustomList(database, { listId: listRemoved.id, senseId: sense.id });
    await deleteCustomList(database, { id: listRemoved.id });

    const containing = await getCustomListsContainingSense(database, sense.id);
    expect(containing.map((list) => list.id)).toEqual([listB.id, listC.id, listA.id]);
  });

  it("义项不在任何列表中返回空数组", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    expect(await getCustomListsContainingSense(database, sense.id)).toEqual([]);
  });

  it("已被移出的条目不计入（按 status=active 过滤）", async () => {
    const database = freshDatabase();
    const sense = makeSense();
    await database.senses.put(sense);
    const list = await createCustomList(database, { name: "x" });
    const entry = await addWordToCustomList(database, { listId: list.id, senseId: sense.id });
    await removeWordFromCustomList(database, { entryId: entry.id });
    expect(await getCustomListsContainingSense(database, sense.id)).toEqual([]);
  });
});

describe("listCustomListEntries（按列表查条目）", () => {
  it("仅返回 active 条目，按 addedAt 倒序（最新加入在前）", async () => {
    const database = freshDatabase();
    const senseA = makeSense("sense_a");
    const senseB = makeSense("sense_b");
    const senseC = makeSense("sense_c");
    await database.senses.bulkPut([senseA, senseB, senseC]);
    const list = await createCustomList(database, { name: "x" });

    const early = await addWordToCustomList(database, {
      listId: list.id,
      senseId: senseA.id,
      now: "2026-08-10T00:00:00.000Z",
    });
    const late = await addWordToCustomList(database, {
      listId: list.id,
      senseId: senseB.id,
      now: "2026-08-15T00:00:00.000Z",
    });
    const middle = await addWordToCustomList(database, {
      listId: list.id,
      senseId: senseC.id,
      now: "2026-08-12T00:00:00.000Z",
    });
    await removeWordFromCustomList(database, { entryId: early.id });

    const entries = await listCustomListEntries(database, list.id);
    expect(entries.map((entry) => entry.id)).toEqual([late.id, middle.id]);
    expect(entries.every((entry) => entry.status === "active")).toBe(true);
  });
});
