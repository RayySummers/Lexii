/**
 * 释义词性回填测试（RAY-349）：
 * - 存量 Sense 按 term 补 posByDefinition（只补缺失、不覆盖已有）；
 * - 释义被用户改过的 Sense 不回填（对齐关系无从保证，宁缺不错）；
 * - 完成标记幂等（版本一致跳过、版本递增重跑）；
 * - 中断续填（进度标记与块同事务）。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { LexiiDatabase } from "../persistence";
import { openDatabase } from "../persistence";
import { toSense } from "../importWords";
import {
  backfillDefinitionPos,
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
