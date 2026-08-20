/**
 * 释义级词性回填（RAY-349）：给存量库里已安装的 Sense 补 posByDefinition。
 *
 * 背景：卡片按词性标注每条释义需要「哪条释义是什么词性」的对齐信息
 * （见 ../definitionPos.ts）。该信息自 RAY-349 起随预设词表分发
 * （PresetWordEntry.posByDefinition），但升级前安装的义项只有去重后的
 * pos 汇总串（"a.；n.；vt."），对齐关系已丢失，读取侧只能在词性数与释义
 * 数相等时推断，其余退回序号。本回填把打包侧的对齐数组补进存量 Sense，
 * 让存量设备与新装设备看到同一结果。
 *
 * 安全口径（与 backfillEnrichment 同款，见 enrichment.ts）：
 * - 只写 posByDefinition 一个字段，且只在该字段缺失时写；
 * - 释义内容必须与预设完全一致才回填——用户编辑过释义（增删改条目）的
 *   Sense 对齐关系无从保证，宁可不写也不写错词性；
 * - 不改 schema、不清库、不新增/删除词条；
 * - 进度标记与块数据同事务提交（中断可续填）、起始事务写 progress=0
 *   占位、每块 check-and-set 防双标签页并发重复回填；
 * - 完成标记 `defpos:<id>:done` 记录数据版本，版本递增即重跑（幂等）。
 */
import type { Sense } from "../domain";
import type { LexiiDatabase } from "../persistence";
import type { PresetWordEntry } from "./types";

/** 每块回填词条数（单块事务写回量上限，与富化回填一致） */
export const DEFINITION_POS_CHUNK_SIZE = 400;

/** 回填进度与完成标记的 meta 键（以数据源 id 为键空间） */
export function definitionPosDoneKey(sourceId: string): string {
  return `defpos:${sourceId}:done`;
}
export function definitionPosProgressKey(sourceId: string): string {
  return `defpos:${sourceId}:progress`;
}

/** 回填数据源：预设词表包或词书共享池（只需 id/版本/词条三项） */
export interface DefinitionPosSource {
  id: string;
  version: string;
  entries: readonly PresetWordEntry[];
}

/** 回填结果 */
export type DefinitionPosBackfillResult =
  { status: "backfilled"; filledCount: number } | { status: "already-backfilled"; version: string };

/** 回填选项 */
export interface DefinitionPosBackfillOptions {
  /** 块间让出事件循环（测试可注入 no-op；默认 setTimeout 0） */
  yield?: () => Promise<void>;
}

/** 并发回填冲突（另一标签页推进了进度，本块整体回滚后重读续填） */
class ConcurrentDefinitionPosBackfillError extends Error {
  constructor(sourceId: string) {
    super(`词性回填并发冲突：${sourceId}`);
    this.name = "ConcurrentDefinitionPosBackfillError";
  }
}

/** 两个释义数组是否逐条相同（回填前置条件：内容未被用户改过） */
function sameDefinitions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * 单条合并：可回填则返回补齐字段的新 Sense，否则原样返回（引用相等表示未改）。
 */
export function mergeDefinitionPosIntoSense(sense: Sense, entry: PresetWordEntry): Sense {
  const aligned = entry.posByDefinition;
  if (!aligned || !aligned.some((item) => item !== "")) {
    return sense;
  }
  if (sense.posByDefinition?.some((item) => item !== "")) {
    return sense;
  }
  if (!sameDefinitions(sense.definitions, entry.definitions)) {
    return sense;
  }
  return { ...sense, posByDefinition: [...aligned] };
}

/** 标记该数据源已处理（新装路径词条落库时已带 posByDefinition，跳过全量扫描） */
export async function markDefinitionPosDone(
  db: LexiiDatabase,
  source: DefinitionPosSource,
): Promise<void> {
  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: definitionPosDoneKey(source.id), value: source.version });
    await db.meta.delete(definitionPosProgressKey(source.id));
  });
}

/**
 * 存量库释义词性回填（幂等、可恢复、并发安全；不改 schema、不清库）。
 *
 * @param db 已打开的 Lexii 数据库
 * @param source 回填数据源（预设包 / 词书共享池）
 * @returns backfilled = 本次实际改写的 Sense 数；
 *   already-backfilled = 完成标记版本与数据版本一致，跳过
 */
export async function backfillDefinitionPos(
  db: LexiiDatabase,
  source: DefinitionPosSource,
  options: DefinitionPosBackfillOptions = {},
): Promise<DefinitionPosBackfillResult> {
  const yieldFn = options.yield ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  const done = await db.meta.get(definitionPosDoneKey(source.id));
  if (done && done.value === source.version) {
    return { status: "already-backfilled", version: done.value };
  }

  // 单次全量读 senses 建内存小写 Map，分块按主键写回（与富化回填同口径：
  // 避免每块索引全扫描；快照错过的并发写入由下次重跑补上，合并幂等）。
  const allSenses = await db.senses.toArray();
  const byTerm = new Map<string, Sense[]>();
  for (const sense of allSenses) {
    const key = sense.term.toLowerCase();
    const bucket = byTerm.get(key);
    if (bucket) {
      bucket.push(sense);
    } else {
      byTerm.set(key, [sense]);
    }
  }

  let progressEntry = await db.meta.get(definitionPosProgressKey(source.id));
  if (!progressEntry) {
    await db.transaction("rw", db.meta, async () => {
      const existing = await db.meta.get(definitionPosProgressKey(source.id));
      if (!existing) {
        await db.meta.put({ key: definitionPosProgressKey(source.id), value: "0" });
      }
    });
    progressEntry = await db.meta.get(definitionPosProgressKey(source.id));
  }
  const parsed = progressEntry ? Number(progressEntry.value) : 0;
  const total = source.entries.length;
  let cursor = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, total) : 0;
  let filled = 0;

  while (cursor < total) {
    const chunk = source.entries.slice(cursor, cursor + DEFINITION_POS_CHUNK_SIZE);
    const nextCursor = cursor + chunk.length;
    const expectedCursor = cursor;
    let filledInChunk = 0;
    try {
      await db.transaction("rw", db.senses, db.meta, async () => {
        const current = await db.meta.get(definitionPosProgressKey(source.id));
        const currentValue = current ? Number(current.value) : 0;
        if ((Number.isFinite(currentValue) ? currentValue : 0) !== expectedCursor) {
          throw new ConcurrentDefinitionPosBackfillError(source.id);
        }
        for (const entry of chunk) {
          const matches = byTerm.get(entry.term.toLowerCase());
          if (!matches) {
            continue;
          }
          for (const sense of matches) {
            const merged = mergeDefinitionPosIntoSense(sense, entry);
            if (merged !== sense) {
              await db.senses.put(merged);
              filledInChunk += 1;
            }
          }
        }
        await db.meta.put({ key: definitionPosProgressKey(source.id), value: String(nextCursor) });
      });
    } catch (err) {
      if (!(err instanceof ConcurrentDefinitionPosBackfillError)) {
        throw err;
      }
      const doneNow = await db.meta.get(definitionPosDoneKey(source.id));
      if (doneNow && doneNow.value === source.version) {
        return { status: "already-backfilled", version: doneNow.value };
      }
      const current = await db.meta.get(definitionPosProgressKey(source.id));
      const currentValue = current ? Number(current.value) : 0;
      const advancedCursor =
        Number.isFinite(currentValue) && currentValue > cursor
          ? Math.min(currentValue, total)
          : cursor;
      if (advancedCursor === cursor) {
        throw new ConcurrentDefinitionPosBackfillError(source.id);
      }
      cursor = advancedCursor;
      continue;
    }
    cursor = nextCursor;
    filled += filledInChunk;
    await yieldFn();
  }

  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: definitionPosDoneKey(source.id), value: source.version });
    await db.meta.delete(definitionPosProgressKey(source.id));
  });

  return { status: "backfilled", filledCount: filled };
}
