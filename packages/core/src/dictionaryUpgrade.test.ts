/**
 * RAY-497 回归：词包升级 / 搜词不得产生「单次超大」IndexedDB 请求。
 *
 * 背景：Firefox 对**单条** IndexedDB 消息的序列化体积有硬上限（约 246 MiB，
 * `kMaxMessageSize`），超限抛 `UnknownError: The serialized value is too large
 * (size=…, max=…)`。旧实现有两条同源路径把整表塞进一条消息：
 * - 升级：`where("source").equals(id).toArray()` 先读回该包旧版全量；
 * - 搜词：`db.dictionarySenses.toArray()` 读回整表（Tier 2 共 761,596 条）。
 * Tier 2（761,596 条 × ~366 B）≈ 279 MB > 246 MiB → 升级后搜词直接报
 * 「本地检索暂时不可用」（Ray 2026-09-27 真机现场的那条错误详情）。
 *
 * 本测试在 IDB 层装探针（fake-indexeddb 的 IDBObjectStore / IDBIndex 原型），
 * 记录每次 `getAll` / `getAllKeys` / `put` 的条数与序列化体积，并按比例缩小
 * 设一道「模拟 Firefox 单条消息上限」（真实 246 MiB，这里 512 KiB——数据集
 * 取几千条，保持同一失败形态：只要单次请求体积随表规模增长就会踩线）。
 */
import type { DexieOptions } from "dexie";
import { IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import type { DictionarySense, LexiiDatabase } from "./persistence";
import { openDatabase } from "./persistence";
import {
  DICTIONARY_CHUNK_SIZE,
  DICTIONARY_READ_PAGE_SIZE,
  dictionaryDoneKey,
  dictionaryUpgradeLockKey,
  installDictionaryPackage,
  invalidateDictionaryCache,
} from "./dictionary";
import type { DictionaryPackage } from "./dictionary";
import { toSenseId } from "./id";
import type { PresetWordEntry } from "./presets/types";
import { searchAllSenses } from "./search";

// ─── IDB 请求探针 ─────────────────────────────────────────────────────────────

/**
 * 模拟的「单条 IDB 消息」体积上限（真实 Firefox 约 246 MiB，见文件头注释）。
 *
 * 缩放到 512 KiB 是为了让几千条的数据集也能复现同一失败形态；真正咬住回归的
 * 是下面的**条数**断言（单次请求 ≤ DICTIONARY_CHUNK_SIZE / READ_PAGE_SIZE 条），
 * 它与数据集大小、字段胖瘦都无关。
 */
const EMULATED_SINGLE_MESSAGE_LIMIT_BYTES = 512 * 1024;

/** 单条 put 的上限：一条 DictionarySense 实测 ~200 B，超过 64 KB 说明批量被塞进了一条 */
const MAX_SINGLE_WRITE_BYTES = 64 * 1024;

interface IdbProbeSummary {
  /** 单次读请求返回的最大记录数 */
  maxReadRecords: number;
  /** 单次读请求返回的最大序列化体积（字节，JSON 长度口径） */
  maxReadBytes: number;
  /** 单次写请求（put）的最大序列化体积 */
  maxWriteBytes: number;
  /** 读请求累计返回记录数（用于证明探针真的看到了全量数据） */
  totalReadRecords: number;
  readRequests: number;
  writeRequests: number;
}

interface IdbProbe {
  reset(): void;
  stop(): void;
  summary(): IdbProbeSummary;
}

/** 体积口径：结构化克隆/IPC 大小的代理指标（JSON 长度，量级一致） */
function measureBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function installIdbProbe(): IdbProbe {
  const state: IdbProbeSummary = {
    maxReadRecords: 0,
    maxReadBytes: 0,
    maxWriteBytes: 0,
    totalReadRecords: 0,
    readRequests: 0,
    writeRequests: 0,
  };
  const restores: Array<() => void> = [];

  const noteRead = (records: number, bytes: number): void => {
    state.readRequests += 1;
    state.totalReadRecords += records;
    state.maxReadRecords = Math.max(state.maxReadRecords, records);
    state.maxReadBytes = Math.max(state.maxReadBytes, bytes);
  };

  /** 读方法：结果条数 + 结果体积（getAll / getAllKeys） */
  const patchReadMethod = (target: { prototype: object }, label: string, method: string): void => {
    const proto = target.prototype as Record<string, unknown>;
    const original = proto[method];
    if (typeof original !== "function") {
      return;
    }
    const originalFn = original as (this: unknown, ...args: unknown[]) => IDBRequest;
    proto[method] = function (this: unknown, ...args: unknown[]): IDBRequest {
      const request = originalFn.apply(this, args);
      request.addEventListener("success", () => {
        const result = request.result as unknown;
        const list = Array.isArray(result) ? result : [result];
        let bytes = 0;
        for (const item of list) {
          bytes += measureBytes(item);
        }
        noteRead(list.length, bytes);
      });
      return request;
    };
    restores.push(() => {
      proto[method] = original;
    });
  };

  /** 写方法：写入值体积（put / add） */
  const patchWriteMethod = (target: { prototype: object }, method: string): void => {
    const proto = target.prototype as Record<string, unknown>;
    const original = proto[method];
    if (typeof original !== "function") {
      return;
    }
    const originalFn = original as (this: unknown, ...args: unknown[]) => IDBRequest;
    proto[method] = function (this: unknown, ...args: unknown[]): IDBRequest {
      state.writeRequests += 1;
      state.maxWriteBytes = Math.max(state.maxWriteBytes, measureBytes(args[0]));
      return originalFn.apply(this, args);
    };
    restores.push(() => {
      proto[method] = original;
    });
  };

  for (const target of [IDBObjectStore, IDBIndex]) {
    patchReadMethod(target, "store", "getAll");
    patchReadMethod(target, "store", "getAllKeys");
  }
  for (const method of ["put", "add"]) {
    patchWriteMethod(IDBObjectStore, method);
  }

  let stopped = false;
  return {
    reset(): void {
      state.maxReadRecords = 0;
      state.maxReadBytes = 0;
      state.maxWriteBytes = 0;
      state.totalReadRecords = 0;
      state.readRequests = 0;
      state.writeRequests = 0;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const restore of restores) {
        restore();
      }
    },
    summary(): IdbProbeSummary {
      return { ...state };
    },
  };
}

/** 断言：整段操作里没有任何单次请求逼近 IDB 消息上限 */
function expectNoOversizedRequest(summary: IdbProbeSummary, expectedMaxReadRecords: number): void {
  const detail = JSON.stringify(summary);
  expect(
    summary.maxReadRecords,
    `单次读请求返回 ${summary.maxReadRecords} 条（上限 ${expectedMaxReadRecords} 条）；` +
      `真实 Firefox 会以 UnknownError: The serialized value is too large 拒绝。${detail}`,
  ).toBeLessThanOrEqual(expectedMaxReadRecords);
  expect(
    summary.maxReadBytes,
    `单次读请求 ${summary.maxReadBytes} B 超过模拟上限 ${EMULATED_SINGLE_MESSAGE_LIMIT_BYTES} B。${detail}`,
  ).toBeLessThanOrEqual(EMULATED_SINGLE_MESSAGE_LIMIT_BYTES);
  expect(
    summary.maxWriteBytes,
    `单次写请求 ${summary.maxWriteBytes} B 超过 ${MAX_SINGLE_WRITE_BYTES} B（写入必须逐条）。${detail}`,
  ).toBeLessThanOrEqual(MAX_SINGLE_WRITE_BYTES);
}

// ─── 数据集与断言辅助 ─────────────────────────────────────────────────────────

function makeOptions(): DexieOptions {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexiiDatabase | undefined;
let probe: IdbProbe | undefined;

afterEach(async () => {
  probe?.stop();
  probe = undefined;
  await db?.delete();
  db = undefined;
  invalidateDictionaryCache();
});

function freshDatabase(): LexiiDatabase {
  db = openDatabase(makeOptions());
  return db;
}

function makeEntries(count: number, prefix: string): PresetWordEntry[] {
  const entries: PresetWordEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      term: `${prefix}${String(i).padStart(7, "0")}`,
      definitions: [`释义 ${prefix}${i}`, `第二义 ${prefix}${i}`],
      pos: "n.",
      ipa: `/test${i}/`,
      tags: i % 2 === 0 ? ["四级"] : [],
    });
  }
  return entries;
}

/**
 * 「旧版全量 + 新版全量」升级场景：删 1/6、改 1/10、留其余，并等量新增。
 * 旧版与新版条目数相同，diff 三态齐备。
 *
 * 注：fake-indexeddb 覆盖已有记录的成本约为插入的 90 倍（索引维护是 O(n)），
 * 故「变更」比例取小值——本用例要压的是**单次读请求体积**（由旧版全量条数
 * 决定），与变更比例无关。
 */
interface UpgradeScenario {
  oldEntries: PresetWordEntry[];
  newEntries: PresetWordEntry[];
  installed: number;
  updated: number;
  skipped: number;
  deleted: number;
}

function makeScenario(oldCount: number): UpgradeScenario {
  const deleted = Math.floor(oldCount / 6);
  const updated = Math.floor(oldCount / 10);
  const skipped = oldCount - deleted - updated;
  const oldEntries = makeEntries(oldCount, "word");
  const changed = oldEntries.slice(deleted, deleted + updated).map((entry) => ({
    ...entry,
    definitions: [...entry.definitions, "（v2 新增义项）"],
  }));
  return {
    oldEntries,
    newEntries: [
      ...changed,
      ...oldEntries.slice(deleted + updated),
      ...makeEntries(deleted, "late"),
    ],
    installed: deleted,
    updated,
    skipped,
    deleted,
  };
}

function makePackage(
  entries: PresetWordEntry[],
  version: string,
  id = "core-en-tier2",
): DictionaryPackage {
  return { id, version, name: "测试扩展词表", lang: "en", entries };
}

/**
 * 断言表内容与新包逐条一致（条数、term 唯一、字段口径）。
 * 差异批量收集后一次性断言：几千条数据下逐条 expect 会把测试拖慢十倍。
 */
async function expectTableMatchesPackage(
  database: LexiiDatabase,
  pkg: DictionaryPackage,
): Promise<void> {
  const senses = await database.dictionarySenses.toArray();
  const problems: string[] = [];

  if (senses.length !== pkg.entries.length) {
    problems.push(`表内 ${senses.length} 条 ≠ 新包 ${pkg.entries.length} 条`);
  }

  const byTerm = new Map<string, DictionarySense[]>();
  for (const sense of senses) {
    if (sense.source !== pkg.id) {
      problems.push(`词条 ${sense.term} 的 source 非法：${sense.source}`);
    }
    const key = sense.term.toLowerCase();
    const bucket = byTerm.get(key);
    if (bucket) {
      bucket.push(sense);
    } else {
      byTerm.set(key, [sense]);
    }
  }

  for (const entry of pkg.entries) {
    const rows = byTerm.get(entry.term.toLowerCase());
    if (!rows) {
      problems.push(`缺词条 ${entry.term}`);
      continue;
    }
    if (rows.length !== 1) {
      problems.push(`词条 ${entry.term} 重复落库 ${rows.length} 条`);
      continue;
    }
    const sense = rows[0]!;
    const actual = [
      sense.definitions.join("\u0001"),
      sense.pos ?? "",
      sense.ipa ?? "",
      sense.tags.join("\u0001"),
    ].join("\u0000");
    const expected = [
      entry.definitions.join("\u0001"),
      entry.pos ?? "",
      entry.ipa ?? "",
      (entry.tags ?? []).join("\u0001"),
    ].join("\u0000");
    if (actual !== expected) {
      problems.push(`词条 ${entry.term} 内容不一致：期望 ${expected} 实际 ${actual}`);
    }
  }

  expect(problems.slice(0, 10)).toEqual([]);
}

// ─── 用例 ─────────────────────────────────────────────────────────────────────

describe("RAY-497 升级/搜词无单次超大 IDB 请求", () => {
  it("旧版全量 + 新版全量升级：单次请求有界，表内容完整", async () => {
    const database = freshDatabase();
    const scenario = makeScenario(3000);
    await installDictionaryPackage(database, makePackage(scenario.oldEntries, "1.0.0"), {
      yield: async () => {},
    });

    probe = installIdbProbe();
    probe.reset();
    const result = await installDictionaryPackage(
      database,
      makePackage(scenario.newEntries, "2.0.0"),
      { yield: async () => {} },
    );
    const summary = probe.summary();
    probe.stop();

    expect(result.status).toBe("installed");
    if (result.status !== "installed") throw new Error("unreachable");
    expect(result.installedCount).toBe(scenario.installed);
    expect(result.updatedCount).toBe(scenario.updated);
    expect(result.skippedCount).toBe(scenario.skipped);
    expect(result.deletedCount).toBe(scenario.deleted);

    // 探针确实覆盖了全量旧表读取（避免「什么都没读到」式的假通过）
    expect(summary.totalReadRecords).toBeGreaterThanOrEqual(scenario.oldEntries.length);
    expectNoOversizedRequest(summary, DICTIONARY_CHUNK_SIZE);

    await expectTableMatchesPackage(database, makePackage(scenario.newEntries, "2.0.0"));
    const done = await database.meta.get(dictionaryDoneKey("core-en-tier2"));
    expect(done?.value).toBe("2.0.0");
  });

  it("单次请求体积与表规模解耦：4 倍数据不放大请求", async () => {
    const small = makeScenario(1000);
    const large = makeScenario(4000);

    const measureUpgrade = async (scenario: UpgradeScenario): Promise<IdbProbeSummary> => {
      const database = freshDatabase();
      await installDictionaryPackage(database, makePackage(scenario.oldEntries, "1.0.0"), {
        yield: async () => {},
      });
      const localProbe = installIdbProbe();
      localProbe.reset();
      await installDictionaryPackage(database, makePackage(scenario.newEntries, "2.0.0"), {
        yield: async () => {},
      });
      const summary = localProbe.summary();
      localProbe.stop();
      await database.delete();
      db = undefined;
      return summary;
    };

    const smallSummary = await measureUpgrade(small);
    const largeSummary = await measureUpgrade(large);

    // 表规模 ×4，单次请求体积不随规模增长（分页边界固定）
    expect(largeSummary.maxReadBytes).toBeLessThanOrEqual(
      smallSummary.maxReadBytes * 1.5 + 64 * 1024,
    );
    expect(largeSummary.maxReadRecords).toBeLessThanOrEqual(DICTIONARY_CHUNK_SIZE);
    expectNoOversizedRequest(largeSummary, DICTIONARY_CHUNK_SIZE);
  }, 60000);

  it("升级中断后可重入：done 不落新版本，重跑即收敛（幂等）", async () => {
    const database = freshDatabase();
    const scenario = makeScenario(1200);
    await installDictionaryPackage(database, makePackage(scenario.oldEntries, "1.0.0"), {
      yield: async () => {},
    });

    // 模拟升级途中崩溃/取消：第一页写完后中止
    const controller = new AbortController();
    const aborted = await installDictionaryPackage(
      database,
      makePackage(scenario.newEntries, "2.0.0"),
      { signal: controller.signal, yield: async () => controller.abort() },
    ).catch((err: unknown) => err);
    expect((aborted as DOMException).name).toBe("AbortError");

    // 关键：done 仍是旧版本号，升级锁已清（不会被锁死）
    const doneAfterCrash = await database.meta.get(dictionaryDoneKey("core-en-tier2"));
    expect(doneAfterCrash?.value).toBe("1.0.0");
    const lockAfterCrash = await database.meta.get(dictionaryUpgradeLockKey("core-en-tier2"));
    expect(lockAfterCrash).toBeUndefined();

    // 重新点升级：从头跑通，且不产生重复记录
    const retried = await installDictionaryPackage(
      database,
      makePackage(scenario.newEntries, "2.0.0"),
      { yield: async () => {} },
    );
    expect(retried.status).toBe("installed");
    if (retried.status !== "installed") throw new Error("unreachable");
    expect(retried.installedCount + retried.updatedCount + retried.skippedCount).toBe(
      scenario.newEntries.length,
    );

    await expectTableMatchesPackage(database, makePackage(scenario.newEntries, "2.0.0"));
    const doneAfterRetry = await database.meta.get(dictionaryDoneKey("core-en-tier2"));
    expect(doneAfterRetry?.value).toBe("2.0.0");
  });

  it("崩溃残留的半空表 + 同 term 脏记录：重跑升级自愈", async () => {
    const database = freshDatabase();
    const scenario = makeScenario(1000);
    await installDictionaryPackage(database, makePackage(scenario.oldEntries, "1.0.0"), {
      yield: async () => {},
    });

    // 复现现场：done 已写旧版本号，但表被删剩一半（先删后写中途失败）
    const survivors = await database.dictionarySenses.toArray();
    const half = survivors.slice(0, Math.floor(survivors.length / 2));
    await database.dictionarySenses.bulkDelete(survivors.slice(half.length).map((s) => s.id));
    // 再塞一条同 term 的脏记录（旧版半途失败可能留下的重复）
    const victim = half[0]!;
    await database.dictionarySenses.put({ ...victim, id: toSenseId(`${victim.id}_dup`) });

    const result = await installDictionaryPackage(
      database,
      makePackage(scenario.newEntries, "2.0.0"),
      { yield: async () => {} },
    );
    expect(result.status).toBe("installed");

    // 半空表被补齐、重复记录被清掉，最终与新包逐条一致
    await expectTableMatchesPackage(database, makePackage(scenario.newEntries, "2.0.0"));
    const done = await database.meta.get(dictionaryDoneKey("core-en-tier2"));
    expect(done?.value).toBe("2.0.0");
  });

  it("升级后搜词走分页读取：冷词可命中，无单次超大请求（真机验收口径）", async () => {
    const database = freshDatabase();
    const scenario = makeScenario(3000);
    const coldWord: PresetWordEntry = {
      term: "quixotic",
      definitions: ["不切实际的，空想的"],
      pos: "adj.",
      ipa: "/kwɪkˈsɒtɪk/",
      tags: [],
    };
    const oldEntries = [...scenario.oldEntries, coldWord];
    const newEntries = [...scenario.newEntries, coldWord];

    await installDictionaryPackage(database, makePackage(oldEntries, "1.0.0"), {
      yield: async () => {},
    });
    await installDictionaryPackage(database, makePackage(newEntries, "2.0.0"), {
      yield: async () => {},
    });

    // 搜词：缓存加载 + 前缀/子串/释义扫描全程装在探针下
    invalidateDictionaryCache();
    probe = installIdbProbe();
    probe.reset();
    const hits = await searchAllSenses(database, "quixotic");
    const summary = probe.summary();
    probe.stop();

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.sense.term).toBe("quixotic");
    expect(hits[0]!.source).toBe("dictionary");
    expect(hits[0]!.kind).toBe("term-prefix");

    // 搜词会读全表做子串/释义扫描，但必须按页读：单次请求有界
    expect(summary.totalReadRecords).toBeGreaterThanOrEqual(newEntries.length);
    expectNoOversizedRequest(summary, DICTIONARY_READ_PAGE_SIZE);
  });
});
