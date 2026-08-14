import Dexie from "dexie";
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { LexilexiDatabase } from "./persistence";
import { openDatabase } from "./persistence";
import { exportLexilexiData, importLexilexiData, parseLexilexiExport } from "./export";
import { DB_SCHEMA_VERSION, EXPORT_FORMAT_VERSION } from "./constants";
import type { LexilexiExportData } from "./export";
import { SAMPLE_WORDLIST_CSV, SAMPLE_WORDLIST_ROW_COUNT } from "./sampleWordlist";
import { importCsvWordlist } from "./importWords";
import { makeLearningItem, makeMemoryState, makeReviewEvent, makeSense, now } from "./helpers";

/** 每个测试用独立的 fake-indexeddb 实例 */
function makeOptions(): DexieOptions {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

describe("数据迁移红线（禁止清库重来）", () => {
  it("schema 升级走 version/upgrade 迁移，旧数据原样保留", async () => {
    // 同一份底层 IndexedDB（同一 IDBFactory），模拟同一数据库文件的两次打开
    const sharedOptions = makeOptions();

    // 1. 用「旧版 schema」（v1）建库并写入数据
    const oldDb = new Dexie("migration-check", sharedOptions);
    oldDb.version(1).stores({ items: "id" });
    await oldDb.open();
    await oldDb.table("items").put({
      id: "item_legacy",
      legacy: true,
      payload: "旧版数据",
    });
    const oldVersion = oldDb.verno;
    await oldDb.close();

    // 2. 用「新版 schema」（v2，追加 senses 表）打开同一数据库：
    //    必须声明从 v1 到 v2 的完整版本链，升级函数内不得删除/清空旧数据。
    const newDb = new Dexie("migration-check", sharedOptions);
    newDb.version(1).stores({ items: "id" });
    newDb
      .version(2)
      .stores({ items: "id", senses: "id" })
      .upgrade(async (tx) => {
        // 模拟未来迁移：在升级事务内读取旧表数据、向新表写入派生数据。
        // 禁止 db.delete()/clear()（清库重来是红线）。
        const legacyItems = await tx.table("items").toArray();
        await tx
          .table("senses")
          .bulkPut(
            legacyItems.map((row) => ({ id: `sense_of_${String(row.id)}`, migratedFrom: row.id })),
          );
      });
    await newDb.open();

    // 3. 旧数据必须完整保留、迁移的派生数据正确、版本号前进到 2
    expect(newDb.verno).toBe(2);
    expect(await newDb.table("items").get("item_legacy")).toEqual({
      id: "item_legacy",
      legacy: true,
      payload: "旧版数据",
    });
    expect(await newDb.table("senses").toArray()).toEqual([
      { id: "sense_of_item_legacy", migratedFrom: "item_legacy" },
    ]);

    await newDb.close();
    await newDb.delete();
    expect(oldVersion).toBe(1);
  });

  it("建库后版本号为 DB_SCHEMA_VERSION", async () => {
    const db = openDatabase(makeOptions());
    expect(db.verno).toBe(DB_SCHEMA_VERSION);
    await db.close();
    await db.delete();
  });
});

/** 组装一份含全部四张表数据的导出快照 */
async function makeExport(db: LexilexiDatabase) {
  const sense = makeSense();
  const item = makeLearningItem(sense.id);
  const memoryState = makeMemoryState(item.id);
  const event = makeReviewEvent(item.id, sense.id);
  await db.senses.put(sense);
  await db.items.put(item);
  await db.memoryStates.put(memoryState);
  await db.events.put(event);
  return { sense, item, memoryState, event };
}

describe("exportLexilexiData / importLexilexiData", () => {
  it("导出 → 原样导回（JSON round-trip，四张表完整恢复）", async () => {
    const source = openDatabase(makeOptions());
    const inserted = await makeExport(source);
    const data = await exportLexilexiData(source, now());

    expect(data.format).toBe("lexilexi");
    expect(data.exportFormatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(data.items).toEqual([inserted.item]);
    expect(data.senses).toEqual([inserted.sense]);
    expect(data.memoryStates).toEqual([inserted.memoryState]);
    expect(data.events).toEqual([inserted.event]);

    // 通过 JSON 字符串 round-trip（模拟真实文件传输）
    const roundTripped = parseLexilexiExport(JSON.stringify(data));

    const target = openDatabase(makeOptions());
    await importLexilexiData(target, roundTripped);

    expect(await target.items.toArray()).toEqual(data.items);
    expect(await target.senses.toArray()).toEqual(data.senses);
    expect(await target.memoryStates.toArray()).toEqual(data.memoryStates);
    expect(await target.events.toArray()).toEqual(data.events);

    await source.delete();
    await target.delete();
  });

  it("导出在单个读事务内快照：与并发导入串行化，不拍到跨表中间态", async () => {
    const db = openDatabase(makeOptions());
    await makeExport(db); // 预置 1 条（items/senses/memoryStates 各 1 + review 事件 1）

    // 并发：整批导入（四表同事务写入）与导出同时进行
    const [, snapshot] = await Promise.all([
      importCsvWordlist(db, SAMPLE_WORDLIST_CSV, { source: "并发导入" }),
      exportLexilexiData(db, now()),
    ]);

    // 快照要么是导入前的 1 条，要么是导入后的 1 + 14 条，绝不混合
    expect([1, 1 + SAMPLE_WORDLIST_ROW_COUNT]).toContain(snapshot.items.length);
    // 四张表两两完整：每个 item 的 sense 与 memoryState 都在快照内
    expect(snapshot.senses.length).toBe(snapshot.items.length);
    expect(snapshot.memoryStates.length).toBe(snapshot.items.length);
    const senseIds = new Set(snapshot.senses.map((sense) => sense.id));
    const memoryIds = new Set(snapshot.memoryStates.map((memory) => memory.id));
    for (const item of snapshot.items) {
      expect(senseIds.has(item.senseId)).toBe(true);
      expect(memoryIds.has(item.id)).toBe(true);
    }
    // 事件数 = 每个条目 1 条 import 事件 + 预置的 1 条 review 事件（快照前/后二选一）
    expect([snapshot.items.length, snapshot.items.length + 1]).toContain(snapshot.events.length);

    await db.delete();
  });

  it("导入覆盖语义：同 id 记录被导入数据覆盖", async () => {
    const source = openDatabase(makeOptions());
    await makeExport(source);
    const data = await exportLexilexiData(source, now());

    const target = openDatabase(makeOptions());
    await importLexilexiData(target, data);
    // 修改源数据后再次导入同一 id：应覆盖
    const first = data.items[0];
    if (!first) {
      throw new Error("导出数据应至少包含一条学习条目");
    }
    const overwrittenItem = { ...first, source: "覆盖后的来源" };
    await importLexilexiData(target, { ...data, items: [overwrittenItem] });

    expect((await target.items.get(overwrittenItem.id))?.source).toBe("覆盖后的来源");
    await source.delete();
    await target.delete();
  });

  it("格式不符或版本过高时整体拒绝，库保持原样", async () => {
    const target = openDatabase(makeOptions());
    await makeExport(target);
    const before = await target.items.count();

    await expect(
      importLexilexiData(target, JSON.parse(JSON.stringify({ format: "other" })) as never),
    ).rejects.toThrow("格式未知");
    const future: LexilexiExportData = {
      format: "lexilexi",
      exportFormatVersion: 999,
      dbSchemaVersion: 1,
      exportedAt: now(),
      items: [],
      senses: [],
      memoryStates: [],
      events: [],
    };
    await expect(importLexilexiData(target, future)).rejects.toThrow("版本不兼容");
    await expect(
      importLexilexiData(target, {
        ...future,
        exportFormatVersion: EXPORT_FORMAT_VERSION,
        dbSchemaVersion: 999,
      }),
    ).rejects.toThrow("更新版本");

    expect(await target.items.count()).toBe(before);
    await target.delete();
  });
});

describe("parseLexilexiExport（结构校验）", () => {
  it("拒绝非 JSON", () => {
    expect(() => parseLexilexiExport("not json")).toThrow("不是合法 JSON");
  });

  it("拒绝非对象 / 错误格式 / 错误字段类型", () => {
    expect(() => parseLexilexiExport("[]")).toThrow("必须是对象");
    expect(() => parseLexilexiExport('{"format":"other"}')).toThrow("格式未知");
    expect(() => parseLexilexiExport('{"format":"lexilexi","exportFormatVersion":"1"}')).toThrow(
      "exportFormatVersion",
    );
    expect(() =>
      parseLexilexiExport('{"format":"lexilexi","exportFormatVersion":1,"dbSchemaVersion":"1"}'),
    ).toThrow("dbSchemaVersion");
    expect(() =>
      parseLexilexiExport(
        '{"format":"lexilexi","exportFormatVersion":1,"dbSchemaVersion":1,"exportedAt":1}',
      ),
    ).toThrow("exportedAt");
    expect(() =>
      parseLexilexiExport(
        '{"format":"lexilexi","exportFormatVersion":1,"dbSchemaVersion":1,"exportedAt":"2026-01-01T00:00:00.000Z","items":{}}',
      ),
    ).toThrow("items");
  });

  it("拒绝表数组内的非对象元素", () => {
    expect(() =>
      parseLexilexiExport(
        `{"format":"lexilexi","exportFormatVersion":1,"dbSchemaVersion":1,"exportedAt":"2026-01-01T00:00:00.000Z","items":[1],"senses":[],"memoryStates":[],"events":[]}`,
      ),
    ).toThrow("items 的元素");
  });

  it("接受结构合法的数据（未知键保留）", () => {
    const parsed = parseLexilexiExport(
      `{"format":"lexilexi","exportFormatVersion":1,"dbSchemaVersion":1,"exportedAt":"2026-01-01T00:00:00.000Z","items":[],"senses":[],"memoryStates":[],"events":[],"custom":"kept"}`,
    );
    expect(parsed.format).toBe("lexilexi");
    expect(parsed.items).toEqual([]);
    expect((parsed as unknown as Record<string, unknown>).custom).toBe("kept");
  });
});

describe("表结构", () => {
  it("四张表均存在且可操作", async () => {
    const db = openDatabase(makeOptions());
    for (const table of [db.items, db.senses, db.memoryStates, db.events]) {
      await table.clear();
      expect(await table.count()).toBe(0);
    }
    await db.delete();
  });
});
