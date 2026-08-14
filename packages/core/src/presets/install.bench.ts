/**
 * RAY-258 首启导入耗时基准（Node + fake-indexeddb 环境，确定性可复现）。
 *
 * 测量预设词表安装器 installPreset 在本地存储上的落库耗时：
 * - 全量 Tier 0（7,195 词条 × 4 记录）单次冷装；
 * - 1000 词条样本（多次迭代取均值，降低抖动）。
 *
 * 口径说明：fake-indexeddb 为内存实现，无真实磁盘/移动端开销，
 * 结果作为「本地逻辑耗时下界」基准；真实设备数据待真机试用复测。
 * 运行方式：pnpm --filter @lexilexi/core bench（vitest bench，不进 CI 测试套件）。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { bench, describe } from "vitest";
import type { LexilexiDatabase } from "../persistence";
import { openDatabase } from "../persistence";
import { installPreset } from "./install";
import { TIER0_PRESET } from "./tier0";
import type { PresetPackage } from "./types";

function freshDatabase(): LexilexiDatabase {
  return openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
}

/** 单次冷装（独立库，完成后即删，保证每轮从零开始） */
async function coldInstall(preset: PresetPackage): Promise<void> {
  const database = freshDatabase();
  try {
    await installPreset(database, preset, { yield: async () => {} });
  } finally {
    await database.delete();
  }
}

function slicePreset(count: number): PresetPackage {
  return { ...TIER0_PRESET, entries: TIER0_PRESET.entries.slice(0, count) };
}

describe("预设词表首启导入耗时基准（fake-indexeddb）", () => {
  bench(
    "Tier 0 全量冷装：7,195 词条 × 4 记录（分块 400）",
    async () => {
      await coldInstall(TIER0_PRESET);
    },
    { iterations: 1, warmupIterations: 0 },
  );

  bench(
    "1,000 词条样本冷装（分块 400）",
    async () => {
      await coldInstall(slicePreset(1000));
    },
    { iterations: 5, warmupIterations: 1, time: 60000 },
  );
});
