/**
 * 首启预设词表引导测试（RAY-258）。
 *
 * 覆盖产品口径：全新库安装、已有数据跳过、中断续装、幂等跳过。
 * 全部注入 fake-indexeddb 与小预设包，不依赖真实 Tier 0 数据。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { LexilexiDatabase, PresetPackage } from "@lexilexi/core";
import { importCsvWordlist, installPreset, openDatabase, presetProgressKey } from "@lexilexi/core";
import { bootstrapPresetData } from "./bootstrap";

function makeOptions(): { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange } {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

function freshDatabase(): LexilexiDatabase {
  db = openDatabase(makeOptions());
  return db;
}

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

function makePreset(count: number): PresetPackage {
  return {
    id: "web-test-tier0",
    version: "1.0.0",
    name: "测试核心词表",
    source: "测试来源（MIT）",
    lang: "en",
    entries: Array.from({ length: count }, (_, i) => ({
      term: `bootword${i}`,
      definitions: [`引导释义${i}`],
      pos: "n.",
      ipa: "/boot/",
      tags: ["高频"],
    })),
  };
}

describe("bootstrapPresetData（首启内置词表引导）", () => {
  it("全新库：安装内置词表，返回 installed 与数量", async () => {
    const database = freshDatabase();
    const outcome = await bootstrapPresetData(database, makePreset(50));
    expect(outcome).toEqual({ status: "installed", installedCount: 50 });
    expect(await database.items.count()).toBe(50);
    expect(await database.events.where("type").equals("import").count()).toBe(50);
  });

  it("已有数据（导入过词库）：跳过，绝不擅自塞词", async () => {
    const database = freshDatabase();
    await importCsvWordlist(database, "apple,苹果,n.", { source: "用户导入" });

    const outcome = await bootstrapPresetData(database, makePreset(50));
    expect(outcome).toEqual({ status: "skipped-existing-data" });
    expect(await database.items.count()).toBe(1);
  });

  it("已安装完成：幂等跳过", async () => {
    const database = freshDatabase();
    const preset = makePreset(10);
    await bootstrapPresetData(database, preset);

    const again = await bootstrapPresetData(database, preset);
    expect(again).toEqual({ status: "already-installed" });
    expect(await database.items.count()).toBe(10);
  });

  it("安装中曾中断：续装到完整（不重复导入）", async () => {
    const database = freshDatabase();
    const preset = makePreset(1200); // 跨 3 个分块（400/块）
    let yielded = 0;
    await expect(
      installPreset(database, preset, {
        yield: async () => {
          yielded += 1;
          throw new Error("模拟中断");
        },
      }),
    ).rejects.toThrow("模拟中断");
    expect(yielded).toBe(1);
    expect(await database.items.count()).toBe(400);
    expect((await database.meta.get(presetProgressKey(preset.id)))?.value).toBe("400");

    const outcome = await bootstrapPresetData(database, preset);
    expect(outcome.status).toBe("installed");
    expect(await database.items.count()).toBe(1200);
  });
});
