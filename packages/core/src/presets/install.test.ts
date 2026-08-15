/**
 * 预设词表安装器测试（RAY-258）：
 * - 分块落库（4 记录/词条，与 importCsvWordlist 形态一致）；
 * - 中断续装（进度标记与块同事务，不重复导入）；
 * - 幂等（完成标记命中即跳过）；
 * - 安装状态机与 meta 键清理。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LexilexiDatabase } from "../persistence";
import { openDatabase } from "../persistence";
import { toSense } from "../importWords";
import {
  getPresetInstallState,
  installPreset,
  presetDoneKey,
  presetProgressKey,
  PRESET_CHUNK_SIZE,
} from "./install";
import type { PresetPackage, PresetWordEntry } from "./types";

function makeOptions(): DexieOptions {
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

/** 生成 n 条测试预设条目（跨两个分块以覆盖 chunk 边界） */
function makeEntries(count: number): PresetWordEntry[] {
  const entries: PresetWordEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      term: `testword${i}`,
      definitions: [`释义${i}`, `第二义${i}`],
      pos: "n.",
      ipa: "/test/",
      tags: i % 2 === 0 ? ["四级", "高频"] : ["四级"],
    });
  }
  return entries;
}

function makePreset(entries: PresetWordEntry[]): PresetPackage {
  return {
    id: "test-tier0",
    version: "1.0.0",
    name: "测试核心词表",
    source: "测试来源（MIT）",
    lang: "en",
    entries,
  };
}

describe("installPreset（分块安装预设词表）", () => {
  it("跨分块完整落库：4 条记录/词条，import 事件与来源标识齐全", async () => {
    const database = freshDatabase();
    const total = PRESET_CHUNK_SIZE * 2 + 50; // 跨越 3 个块
    const preset = makePreset(makeEntries(total));

    const result = await installPreset(database, preset, {
      time: "2026-08-15T00:00:00.000Z",
      yield: async () => {},
    });

    expect(result.status).toBe("installed");
    if (result.status !== "installed") {
      throw new Error("unreachable");
    }
    expect(result.installedCount).toBe(total);
    expect(await database.senses.count()).toBe(total);
    expect(await database.items.count()).toBe(total);
    expect(await database.memoryStates.count()).toBe(total);
    expect(await database.events.where("type").equals("import").count()).toBe(total);

    const sample = await database.senses.filter((s) => s.term === "testword0").first();
    expect(sample?.term).toBe("testword0");
    expect(sample?.definitions).toEqual(["释义0", "第二义0"]);
    expect(sample?.ipa).toBe("/test/");
    expect(sample?.tags).toEqual(["四级", "高频"]);

    const item = await database.items.filter((i) => i.senseId === sample!.id).first();
    expect(item?.source).toBe("测试核心词表（test-tier0）");
    expect(item?.status).toBe("active");

    const event = await database.events
      .filter((e) => e.type === "import" && e.term === "testword0")
      .first();
    expect(event).toMatchObject({ type: "import", term: "testword0", lang: "en" });

    // 记忆状态由 FSRS newCardFields 初始化，due = 导入时刻（导入即到期）
    const memory = await database.memoryStates.get(item!.id);
    expect(memory?.fields.due).toBe("2026-08-15T00:00:00.000Z");
  });

  it("完成后写完成标记并清理进度标记（幂等跳过）", async () => {
    const database = freshDatabase();
    const preset = makePreset(makeEntries(10));

    await installPreset(database, preset, { yield: async () => {} });
    expect((await database.meta.get(presetDoneKey(preset.id)))?.value).toBe(preset.version);
    expect(await database.meta.get(presetProgressKey(preset.id))).toBeUndefined();

    const again = await installPreset(database, preset, { yield: async () => {} });
    expect(again).toEqual({ status: "already-installed", installedVersion: preset.version });
    expect(await database.items.count()).toBe(10);
  });

  it("中断后续装：从进度断点恢复，不重复导入", async () => {
    const database = freshDatabase();
    const total = PRESET_CHUNK_SIZE * 3;
    const preset = makePreset(makeEntries(total));

    // 第一次安装：第 1 块完成后让出函数抛错，模拟中断
    let yielded = 0;
    const failingYield = async () => {
      yielded += 1;
      throw new Error("模拟中断");
    };
    await expect(installPreset(database, preset, { yield: failingYield })).rejects.toThrow(
      "模拟中断",
    );
    expect(yielded).toBe(1);
    // 第 1 块已提交，进度停在块边界
    expect(await database.items.count()).toBe(PRESET_CHUNK_SIZE);
    expect((await database.meta.get(presetProgressKey(preset.id)))?.value).toBe(
      String(PRESET_CHUNK_SIZE),
    );
    expect(await database.meta.get(presetDoneKey(preset.id))).toBeUndefined();

    // 第二次安装：续装剩余，无重复
    const result = await installPreset(database, preset, { yield: async () => {} });
    expect(result).toEqual({
      status: "installed",
      installedCount: total - PRESET_CHUNK_SIZE,
      skippedCount: 0,
    });
    expect(await database.items.count()).toBe(total);
    expect(await database.senses.count()).toBe(total);
    expect((await database.meta.get(presetDoneKey(preset.id)))?.value).toBe(preset.version);
  });

  it("getPresetInstallState 状态机：未装 → 安装中（有进度）→ 已装", async () => {
    const database = freshDatabase();
    const preset = makePreset(makeEntries(10));

    expect((await getPresetInstallState(database, preset)).status).toBe("not-installed");

    // 手动写入进度标记（模拟安装进行中）
    await database.meta.put({ key: presetProgressKey(preset.id), value: "4" });
    const installing = await getPresetInstallState(database, preset);
    expect(installing).toMatchObject({ status: "installing", installedCount: 4, totalCount: 10 });

    await installPreset(database, preset, { yield: async () => {} });
    const installed = await getPresetInstallState(database, preset);
    expect(installed).toMatchObject({
      status: "installed",
      installedCount: 10,
      installedVersion: preset.version,
    });
  });

  it("空词表安装为 no-op（写完成标记，不产生记录）", async () => {
    const database = freshDatabase();
    const preset = makePreset([]);
    const result = await installPreset(database, preset, { yield: async () => {} });
    expect(result).toEqual({ status: "installed", installedCount: 0, skippedCount: 0 });
    expect(await database.items.count()).toBe(0);
    expect((await database.meta.get(presetDoneKey(preset.id)))?.value).toBe(preset.version);
  });

  it("term 去重（RAY-262）：库中已存在的词条跳过，不产生重复学习项", async () => {
    const database = freshDatabase();

    // 先安装第一本词书（与第二本有部分重叠词条）
    const overlapping = makeEntries(10);
    const first = makePreset(overlapping);
    await installPreset(database, first, { yield: async () => {} });

    // 第二本：前 4 条与第一本重叠，后 6 条为新词
    const secondEntries = [
      ...overlapping.slice(0, 4),
      ...makeEntries(6).map((entry, i) => ({ ...entry, term: `newword${i}` })),
    ];
    const second = makePreset(secondEntries);
    second.id = "test-tier1";
    second.name = "测试扩展词表";
    const result = await installPreset(database, second, { yield: async () => {} });

    expect(result.status).toBe("installed");
    if (result.status !== "installed") {
      throw new Error("unreachable");
    }
    expect(result.installedCount).toBe(6);
    expect(result.skippedCount).toBe(4);
    // 重叠词条不重复生成 Sense / Item / MemoryState / import 事件
    expect(await database.senses.count()).toBe(16);
    expect(await database.items.count()).toBe(16);
    expect(await database.memoryStates.count()).toBe(16);
    expect(await database.events.where("type").equals("import").count()).toBe(16);
    // 重叠词条的 Sense 保持第一本的写入形态（不被第二本覆盖）
    const kept = await database.senses.filter((s) => s.term === "testword0").toArray();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.definitions).toEqual(["释义0", "第二义0"]);
    // 新词正常落库
    const added = await database.senses.filter((s) => s.term === "newword0").toArray();
    expect(added).toHaveLength(1);
  });

  it("term 去重不覆盖已有 Sense：释义保持用户既有数据（安装绝不改写）", async () => {
    const database = freshDatabase();

    // 用户已导入同 term 词条（不同释义形态）
    const existing = toSense({ term: "testword0", definitions: ["用户既有释义"] }, "en");
    await database.senses.put(existing);

    const preset = makePreset(makeEntries(3));
    const result = await installPreset(database, preset, { yield: async () => {} });

    expect(result.status).toBe("installed");
    if (result.status !== "installed") {
      throw new Error("unreachable");
    }
    expect(result.skippedCount).toBe(1);
    const kept = await database.senses.get(existing.id);
    expect(kept?.definitions).toEqual(["用户既有释义"]);
    expect(await database.items.count()).toBe(2);
  });

  it("term 去重大小写不敏感（Oscar 评审 suggestion 1）：用户导入大写词条同样命中跳过", async () => {
    const database = freshDatabase();

    // 用户 CSV 导入含大写开头词条（词书内为全小写）
    const existing = toSense({ term: "Testword0", definitions: ["用户导入的释义"] }, "en");
    await database.senses.put(existing);

    const preset = makePreset(makeEntries(3));
    const result = await installPreset(database, preset, { yield: async () => {} });

    expect(result.status).toBe("installed");
    if (result.status !== "installed") {
      throw new Error("unreachable");
    }
    expect(result.skippedCount).toBe(1);
    expect(result.installedCount).toBe(2);
    // 大写词条不产生重复 Sense / Learning Item
    expect(await database.senses.count()).toBe(3);
    expect(await database.items.count()).toBe(2);
    const kept = await database.senses.get(existing.id);
    expect(kept?.term).toBe("Testword0");
    expect(kept?.definitions).toEqual(["用户导入的释义"]);
  });

  it("并发首装加固：起始事务先写 progress=0 占位，早于任何词条落库（RAY-260 suggestion 3）", async () => {
    const database = freshDatabase();
    const preset = makePreset(makeEntries(10));

    const metaPutEntries: Array<{ key: string; value: string }> = [];
    const sensesPutTerms: string[] = [];
    const originalMetaPut = database.meta.put.bind(database.meta);
    const originalSensesPut = database.senses.put.bind(database.senses);
    const metaPutSpy = vi.spyOn(database.meta, "put").mockImplementation((record) => {
      metaPutEntries.push({ key: record.key, value: record.value });
      return originalMetaPut(record);
    });
    const sensesPutSpy = vi.spyOn(database.senses, "put").mockImplementation((record) => {
      sensesPutTerms.push(record.term);
      return originalSensesPut(record);
    });
    try {
      await installPreset(database, preset, { yield: async () => {} });
    } finally {
      metaPutSpy.mockRestore();
      sensesPutSpy.mockRestore();
    }

    // 第一条 meta 写入必须是 progress=0 占位（起始事务，早于任何词条落库）
    expect(metaPutEntries[0]).toEqual({ key: presetProgressKey(preset.id), value: "0" });
    // 词条落库发生在占位之后（meta 事件序：占位 → 块提交进度 → 完成标记）
    expect(sensesPutTerms).toHaveLength(10);
    const progressWrites = metaPutEntries.filter(
      (entry) => entry.key === presetProgressKey(preset.id),
    );
    expect(progressWrites.map((entry) => entry.value)).toEqual(["0", "10"]);
    const doneWrites = metaPutEntries.filter((entry) => entry.key === presetDoneKey(preset.id));
    expect(doneWrites.map((entry) => entry.value)).toEqual([preset.version]);
  });

  it("并发首装竞态：两个 installPreset 同时启动不产生重复导入", async () => {
    const database = freshDatabase();
    const total = PRESET_CHUNK_SIZE * 2 + 30;
    const preset = makePreset(makeEntries(total));

    const [first, second] = await Promise.all([
      installPreset(database, preset, { yield: async () => {} }),
      installPreset(database, preset, { yield: async () => {} }),
    ]);

    // 无论哪个调用先完成/续装，最终落库数恰好等于包内词条数（无重复导入）
    for (const result of [first, second]) {
      expect(["installed", "already-installed"]).toContain(result.status);
    }
    expect(await database.items.count()).toBe(total);
    expect(await database.senses.count()).toBe(total);
    expect(await database.memoryStates.count()).toBe(total);
    expect(await database.events.where("type").equals("import").count()).toBe(total);
    expect(await database.meta.get(presetProgressKey(preset.id))).toBeUndefined();
    expect((await database.meta.get(presetDoneKey(preset.id)))?.value).toBe(preset.version);
  });
});
