/**
 * 释义词性回填测试（RAY-349）：
 * - 存量 Sense 按 term 补 posByDefinition（只补缺失、不覆盖已有）；
 * - 释义被用户改过的 Sense 不回填（对齐关系无从保证，宁缺不错）；
 * - 完成标记幂等（版本一致跳过、版本递增重跑）；
 * - 中断续填（进度标记与块同事务，从断点 cursor 继续，Oscar R1 suggestion 1）；
 * - 并发冲突的三条 catch 分支（done 已写 / 进度已推进 / 未推进，
 *   Oscar R1 suggestion 2）。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LexiiDatabase } from "../persistence";
import { openDatabase } from "../persistence";
import { toSense } from "../importWords";
import {
  backfillDefinitionPos,
  DEFINITION_POS_CHUNK_SIZE,
  definitionPosDoneKey,
  definitionPosProgressKey,
  markDefinitionPosDone,
  mergeDefinitionPosIntoSense,
} from "./definitionPosBackfill";
import type { DefinitionPosSource } from "./definitionPosBackfill";

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

const SOURCE: DefinitionPosSource = {
  id: "test-source",
  version: "1.0.0",
  entries: [
    {
      term: "abandon",
      definitions: ["放弃, 抛弃", "放任, 无拘束"],
      pos: "vt.；n.",
      posByDefinition: ["vt.", "n."],
      tags: [],
    },
    {
      term: "a",
      definitions: ["第一个字母 A", "一个", "第一的"],
      pos: "art.",
      posByDefinition: ["", "", "art."],
      tags: [],
    },
  ],
};

/** 存量义项（RAY-349 之前安装的形态：只有 pos 汇总串） */
async function seedLegacySense(
  database: LexiiDatabase,
  term: string,
  definitions: string[],
  pos: string,
) {
  const sense = toSense({ term, definitions, pos }, "en");
  await database.senses.put(sense);
  return sense.id;
}

/** 多块规模的合成数据源（用于断点续填 / 并发分支：条目数跨多个分块） */
function makeBulkSource(count: number, version = "1.0.0"): DefinitionPosSource {
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      term: `bulkword${i}`,
      definitions: [`释义${i}`, `第二义${i}`],
      pos: "vt.；n.",
      posByDefinition: ["vt.", "n."],
      tags: [],
    });
  }
  return { id: "bulk-source", version, entries };
}

/**
 * meta.get 拦截器：按 key 的调用次序返回伪造记录，模拟另一标签页并发
 * 推进进度 / 写完成标记（不改被测代码，只改它读到的 meta 快照）。
 *
 * handler 返回 `undefined` 表示放行到真实读取；返回字符串表示伪造该次
 * 读取的 value。
 */
function stubMetaGet(
  database: LexiiDatabase,
  handler: (key: string, nth: number) => string | undefined,
) {
  const original = database.meta.get.bind(database.meta);
  const counts = new Map<string, number>();
  return vi.spyOn(database.meta, "get").mockImplementation((async (key: string) => {
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);
    const faked = handler(key, nth);
    return faked === undefined ? original(key) : { key, value: faked };
    // Dexie 的 get 有多个重载，mockImplementation 需要放宽签名（仅测试替身）
  }) as unknown as typeof database.meta.get);
}

describe("mergeDefinitionPosIntoSense", () => {
  it("释义一致且字段缺失时补齐；已有字段不覆盖", () => {
    const entry = SOURCE.entries[0]!;
    const sense = toSense({ term: "abandon", definitions: [...entry.definitions] }, "en");
    expect(mergeDefinitionPosIntoSense(sense, entry).posByDefinition).toEqual(["vt.", "n."]);

    const filled = { ...sense, posByDefinition: ["n.", "n."] };
    expect(mergeDefinitionPosIntoSense(filled, entry)).toBe(filled);
  });

  it("释义与预设不一致（用户编辑过）时不回填", () => {
    const entry = SOURCE.entries[0]!;
    const edited = toSense({ term: "abandon", definitions: ["我自己改的释义"] }, "en");
    expect(mergeDefinitionPosIntoSense(edited, entry)).toBe(edited);
  });
});

describe("backfillDefinitionPos", () => {
  it("按 term 补齐存量义项的逐条词性，写完成标记并清进度", async () => {
    const database = freshDatabase();
    const abandonId = await seedLegacySense(
      database,
      "abandon",
      ["放弃, 抛弃", "放任, 无拘束"],
      "vt.；n.",
    );
    const aId = await seedLegacySense(database, "A", ["第一个字母 A", "一个", "第一的"], "art.");

    const result = await backfillDefinitionPos(database, SOURCE, { yield: async () => {} });

    expect(result).toEqual({ status: "backfilled", filledCount: 2 });
    expect((await database.senses.get(abandonId))?.posByDefinition).toEqual(["vt.", "n."]);
    // term 大小写不敏感匹配；部分释义无词性标记的位置保持空串
    expect((await database.senses.get(aId))?.posByDefinition).toEqual(["", "", "art."]);
    expect((await database.meta.get(definitionPosDoneKey(SOURCE.id)))?.value).toBe("1.0.0");
    expect(await database.meta.get(definitionPosProgressKey(SOURCE.id))).toBeUndefined();
  });

  it("覆盖不到的词条（用户自建）不受影响", async () => {
    const database = freshDatabase();
    const ownId = await seedLegacySense(database, "mycustomword", ["我的释义"], "n.");

    await backfillDefinitionPos(database, SOURCE, { yield: async () => {} });

    expect((await database.senses.get(ownId))?.posByDefinition).toBeUndefined();
  });

  it("完成标记版本一致即跳过；版本递增则重跑", async () => {
    const database = freshDatabase();
    await seedLegacySense(database, "abandon", ["放弃, 抛弃", "放任, 无拘束"], "vt.；n.");
    await markDefinitionPosDone(database, SOURCE);

    expect(await backfillDefinitionPos(database, SOURCE, { yield: async () => {} })).toEqual({
      status: "already-backfilled",
      version: "1.0.0",
    });

    const next = { ...SOURCE, version: "1.1.0" };
    const rerun = await backfillDefinitionPos(database, next, { yield: async () => {} });
    expect(rerun).toEqual({ status: "backfilled", filledCount: 1 });
  });

  it("重复回填幂等：第二次无字段可补（filledCount = 0）", async () => {
    const database = freshDatabase();
    await seedLegacySense(database, "abandon", ["放弃, 抛弃", "放任, 无拘束"], "vt.；n.");
    await backfillDefinitionPos(database, SOURCE, { yield: async () => {} });
    await database.meta.delete(definitionPosDoneKey(SOURCE.id));

    const second = await backfillDefinitionPos(database, SOURCE, { yield: async () => {} });
    expect(second).toEqual({ status: "backfilled", filledCount: 0 });
  });
});

describe("backfillDefinitionPos 断点续填（Oscar R1 suggestion 1）", () => {
  it("progress 已存在、done 未写：从 cursor 继续，不重扫已处理的块", async () => {
    const database = freshDatabase();
    const source = makeBulkSource(DEFINITION_POS_CHUNK_SIZE + 100);
    // 中断前已处理完第一块（cursor = 400）：块内词条的字段已补好
    const doneChunkId = await seedLegacySense(
      database,
      "bulkword0",
      ["释义0", "第二义0"],
      "vt.；n.",
    );
    // 断点之后的词条（第二块）仍是存量形态
    const pendingId = await seedLegacySense(
      database,
      `bulkword${DEFINITION_POS_CHUNK_SIZE}`,
      [`释义${DEFINITION_POS_CHUNK_SIZE}`, `第二义${DEFINITION_POS_CHUNK_SIZE}`],
      "vt.；n.",
    );
    await database.meta.put({
      key: definitionPosProgressKey(source.id),
      value: String(DEFINITION_POS_CHUNK_SIZE),
    });

    const result = await backfillDefinitionPos(database, source, { yield: async () => {} });

    // 只处理断点之后的块：第一块的词条不再被扫到（字段仍缺失）
    expect(result).toEqual({ status: "backfilled", filledCount: 1 });
    expect((await database.senses.get(doneChunkId))?.posByDefinition).toBeUndefined();
    expect((await database.senses.get(pendingId))?.posByDefinition).toEqual(["vt.", "n."]);
    // 收尾：写完成标记 + 清进度
    expect((await database.meta.get(definitionPosDoneKey(source.id)))?.value).toBe("1.0.0");
    expect(await database.meta.get(definitionPosProgressKey(source.id))).toBeUndefined();
  });
});

describe("backfillDefinitionPos 并发冲突（Oscar R1 suggestion 2）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("并发方已写完成标记：本块回滚后直接返回 already-backfilled", async () => {
    const database = freshDatabase();
    const source = makeBulkSource(DEFINITION_POS_CHUNK_SIZE + 100);
    const senseId = await seedLegacySense(database, "bulkword0", ["释义0", "第二义0"], "vt.；n.");
    await database.meta.put({ key: definitionPosProgressKey(source.id), value: "0" });

    stubMetaGet(database, (key, nth) => {
      // 块事务内的进度读（第 2 次）：并发方已推进 → 触发冲突回滚
      if (key === definitionPosProgressKey(source.id) && nth === 2) {
        return "800";
      }
      // 冲突后查完成标记（第 2 次读 done）：并发方已完成
      if (key === definitionPosDoneKey(source.id) && nth === 2) {
        return source.version;
      }
      return undefined;
    });

    const result = await backfillDefinitionPos(database, source, { yield: async () => {} });

    expect(result).toEqual({ status: "already-backfilled", version: "1.0.0" });
    // 本块整体回滚：没有写入任何 Sense
    expect((await database.senses.get(senseId))?.posByDefinition).toBeUndefined();
  });

  it("并发方推进了进度：adopt 推进后的 cursor 续填，不重复处理已提交的块", async () => {
    const database = freshDatabase();
    const advanced = DEFINITION_POS_CHUNK_SIZE * 2;
    const source = makeBulkSource(advanced + 100);
    const skippedId = await seedLegacySense(database, "bulkword0", ["释义0", "第二义0"], "vt.；n.");
    const pendingId = await seedLegacySense(
      database,
      `bulkword${advanced}`,
      [`释义${advanced}`, `第二义${advanced}`],
      "vt.；n.",
    );
    await database.meta.put({ key: definitionPosProgressKey(source.id), value: "0" });

    stubMetaGet(database, (key, nth) => {
      if (key !== definitionPosProgressKey(source.id)) {
        return undefined;
      }
      // 第 2 次：块事务内的进度读 → 并发方已推进到 advanced，触发回滚
      // 第 3 次：catch 分支重读进度 → 读到推进后的 cursor
      // 第 4 次：adopt 后的块事务内进度读 → 与新 cursor 一致，正常提交
      if (nth === 2 || nth === 3 || nth === 4) {
        return String(advanced);
      }
      return undefined;
    });

    const result = await backfillDefinitionPos(database, source, { yield: async () => {} });

    // 从 advanced 续填：之前的块不再重扫，断点之后的词条补齐
    expect(result).toEqual({ status: "backfilled", filledCount: 1 });
    expect((await database.senses.get(skippedId))?.posByDefinition).toBeUndefined();
    expect((await database.senses.get(pendingId))?.posByDefinition).toEqual(["vt.", "n."]);
    expect((await database.meta.get(definitionPosDoneKey(source.id)))?.value).toBe("1.0.0");
  });

  it("进度未推进（异常状态）：抛出并发冲突错误，不进入死循环", async () => {
    const database = freshDatabase();
    const source = makeBulkSource(DEFINITION_POS_CHUNK_SIZE + 100);
    await seedLegacySense(database, "bulkword0", ["释义0", "第二义0"], "vt.；n.");
    await database.meta.put({ key: definitionPosProgressKey(source.id), value: "0" });

    stubMetaGet(database, (key, nth) => {
      // 块事务内读到不一致的进度 → 冲突；catch 重读却仍停在 0（既未完成
      // 也未推进）→ 属异常状态，直接抛错而不是无限重试
      if (key === definitionPosProgressKey(source.id) && nth === 2) {
        return "5";
      }
      return undefined;
    });

    await expect(
      backfillDefinitionPos(database, source, { yield: async () => {} }),
    ).rejects.toThrow(/词性回填并发冲突/);
    expect(await database.meta.get(definitionPosDoneKey(source.id))).toBeUndefined();
  });
});
