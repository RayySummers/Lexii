/**
 * 预设词表安装器（RAY-258 Tier 0 内置核心词表落库）。
 *
 * 与 importCsvWordlist 的关键差异：预设词表动辄数千词条，单事务逐条
 * put 会长时间占用主线程（RAY-257 简报 §四 指出的风险），因此：
 * - 分块事务：每 PRESET_CHUNK_SIZE 条一个 Dexie 事务，块间让出事件循环；
 * - 可恢复：进度写入 meta 表（`preset:<id>:progress`），中断后从断点续装，
 *   不会重复导入（每块与进度在同一事务内提交，要么全进要么全回滚）；
 * - 幂等：完成标记（`preset:<id>:done` = 已安装版本）存在时直接跳过；
 * - 每个新条目写入 Sense / Learning Item / Memory State / import 事件
 *   （4 条记录），与 importCsvWordlist 落库形态完全一致，统计与导出路径无感。
 *
 * 数据库 schema：meta 表由 DB_SCHEMA_VERSION 2 引入（persistence.ts 版本链）。
 */
import { DEFAULT_WORDLIST_LANG } from "../csv";
import type { LanguageCode } from "../domain";
import { createId, toEventId, toItemId } from "../id";
import { toMemoryState, toSense } from "../importWords";
import type { LexilexiDatabase } from "../persistence";
import type { PresetPackage } from "./types";

/** 每块词条数（4 条记录/词条，400 词条 ≈ 1,600 次 put/事务） */
export const PRESET_CHUNK_SIZE = 400;

/** 安装进度与完成标记的 meta 键（以包 id 为键空间） */
export function presetDoneKey(presetId: string): string {
  return `preset:${presetId}:done`;
}
export function presetProgressKey(presetId: string): string {
  return `preset:${presetId}:progress`;
}

/** 安装状态（供 UI 展示与首启引导判断） */
export type PresetInstallStatus = "not-installed" | "installing" | "installed";

export interface PresetInstallState {
  /** 包稳定标识 */
  presetId: string;
  status: PresetInstallStatus;
  /** 已安装词条数（来自进度标记；0 = 未开始或未知） */
  installedCount: number;
  /** 包内词条总数 */
  totalCount: number;
  /** 已安装版本（status === "installed" 时有值） */
  installedVersion?: string;
}

/** 安装选项 */
export interface PresetInstallOptions {
  /** 词条语言（默认 "en"） */
  lang?: LanguageCode;
  /** 导入发生时刻（ISO；默认调用方当前时间，测试可注入） */
  time?: string;
  /** 块间让出事件循环（测试可注入 no-op；默认 setTimeout 0） */
  yield?: () => Promise<void>;
}

export type PresetInstallResult =
  | { status: "installed"; installedCount: number }
  | { status: "already-installed"; installedVersion: string };

/** 默认让出：把控制权交回事件循环，避免长事务阻塞 UI */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 读取安装状态（done/progress 标记） */
export async function getPresetInstallState(
  db: LexilexiDatabase,
  preset: PresetPackage,
): Promise<PresetInstallState> {
  const done = await db.meta.get(presetDoneKey(preset.id));
  const progress = await db.meta.get(presetProgressKey(preset.id));
  const installedCount = progress ? Number(progress.value) : 0;
  if (done) {
    return {
      presetId: preset.id,
      status: "installed",
      installedCount: preset.entries.length,
      totalCount: preset.entries.length,
      installedVersion: done.value,
    };
  }
  return {
    presetId: preset.id,
    status: installedCount > 0 ? "installing" : "not-installed",
    installedCount: Number.isFinite(installedCount) ? installedCount : 0,
    totalCount: preset.entries.length,
  };
}

/**
 * 分块安装预设词表（可恢复、幂等）。
 *
 * @param db 已打开的 Lexilexi 数据库
 * @param preset 预设词表包（entries 已由打包侧清洗/排序/去重）
 * @param options 语言 / 时刻 / 让出函数（测试注入）
 * @returns installed = 本次新装数量；already-installed = 完成标记命中，跳过
 */
export async function installPreset(
  db: LexilexiDatabase,
  preset: PresetPackage,
  options: PresetInstallOptions = {},
): Promise<PresetInstallResult> {
  const lang = options.lang ?? DEFAULT_WORDLIST_LANG;
  const time = options.time ?? new Date().toISOString();
  const yieldFn = options.yield ?? yieldToMainThread;

  const done = await db.meta.get(presetDoneKey(preset.id));
  if (done) {
    return { status: "already-installed", installedVersion: done.value };
  }

  const progressEntry = await db.meta.get(presetProgressKey(preset.id));
  const parsed = progressEntry ? Number(progressEntry.value) : 0;
  let cursor = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, preset.entries.length) : 0;
  const startCursor = cursor;
  const total = preset.entries.length;

  while (cursor < total) {
    const chunk = preset.entries.slice(cursor, cursor + PRESET_CHUNK_SIZE);
    const nextCursor = cursor + chunk.length;
    // 块数据与进度标记同一事务：中断时该块整体回滚，进度停留在上一块末尾
    await db.transaction(
      "rw",
      db.senses,
      db.items,
      db.memoryStates,
      db.events,
      db.meta,
      async () => {
        for (const entry of chunk) {
          const sense = toSense(entry, lang);
          const itemId = toItemId(createId("item"));
          await db.senses.put(sense);
          await db.items.put({
            id: itemId,
            createdAt: time,
            updatedAt: time,
            source: `${preset.name}（${preset.id}）`,
            senseId: sense.id,
            kind: "word",
            status: "active",
          });
          await db.memoryStates.put(toMemoryState(itemId, time));
          await db.events.put({
            id: toEventId(createId("evt", 12)),
            type: "import",
            time,
            itemId,
            senseId: sense.id,
            term: sense.term,
            lang: sense.lang,
          });
        }
        await db.meta.put({ key: presetProgressKey(preset.id), value: String(nextCursor) });
      },
    );
    cursor = nextCursor;
    await yieldFn();
  }

  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: presetDoneKey(preset.id), value: preset.version });
    await db.meta.delete(presetProgressKey(preset.id));
  });

  return { status: "installed", installedCount: total - startCursor };
}
