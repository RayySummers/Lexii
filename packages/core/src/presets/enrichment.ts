/**
 * 富化数据装载与合并（RAY-268 批次 A）。
 *
 * 富化包（enrichment.tier0.data.json 随 PWA 打包，Tier 1 扩展包同构）
 * 按 term join 补全已有 Sense 的内容字段：
 * 双音标（ipaUs/ipaUk）、近反义词、派生词、英文词源、词根词缀、
 * 中文词源、例句（含中文译文）。不引入新词条、不改调度状态。
 *
 * 两条落库路径：
 * - 新装：installPreset 安装词条时内联填充（见 install.ts 的
 *   options.enrichment）；
 * - 存量库：backfillEnrichment 回填——分块事务按 senses.term 索引
 *   anyOfIgnoreCase 命中词条补字段（「禁止清库重来」：只改记录字段，
 *   不需要 IndexedDB schema 版本迁移，与 learningSteps 等记录级字段
 *   演进的先例一致，见 docs/domain-model.md §4 演进说明）。
 *
 * 合并口径（两路径一致，mergeEnrichmentIntoContent / IntoSense）：
 * 富化字段「只在目标字段缺失/为空时填充」，绝不覆盖用户已有内容
 * （含用户编辑与其它词库导入带来的字段）。
 *
 * 回填与 installPreset 同一套安全机制：进度标记与块数据同事务提交、
 * 起始事务写 progress=0 占位、每块 check-and-set 防并发双标签页重复回填。
 */
import { DEFAULT_WORDLIST_LANG } from "../csv";
import type { Sense } from "../domain";
import type { LexilexiDatabase } from "../persistence";
import type { WordEntryContent } from "../importWords";
import type { EnrichmentPresetEntry, EnrichmentPresetPackage } from "./types";

/** 每块富化词条数（anyOfIgnoreCase 一次查询的合理上限，与词表安装块一致） */
export const ENRICHMENT_CHUNK_SIZE = 400;

/** 回填进度与完成标记的 meta 键（以富化包 id 为键空间） */
export function enrichmentDoneKey(presetId: string): string {
  return `enrichment:${presetId}:done`;
}
export function enrichmentProgressKey(presetId: string): string {
  return `enrichment:${presetId}:progress`;
}

/** 富化词条（元组解析后的类型化形态；字段缺失即未提供） */
export interface EnrichmentEntry {
  term: string;
  ipaUs?: string;
  ipaUk?: string;
  synonyms?: string[];
  antonyms?: string[];
  derived?: string[];
  etymology?: string;
  wordParts?: string;
  etymologyZh?: string;
  examples: { text: string; translation: string }[];
}

/** 元组定长（与打包侧 build-enrichment.mjs 输出一致） */
const ENRICHMENT_TUPLE_LENGTH = 10;

/** 换行连接的词列表 → 字符串数组（空串与空白项丢弃） */
function splitList(raw: string): string[] {
  return raw
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * 元组 → 类型化富化词条；形状非法立即抛错（生成物损坏在启动即暴露）。
 *
 * @param raw 元组（前 9 项字符串，末项 [英文, 译文] 对数组）
 * @param index 词条序号（错误信息定位用）
 * @param sourceName 数据文件名（错误信息前缀）
 */
export function resolveEnrichmentEntry(
  raw: readonly unknown[],
  index: number,
  sourceName: string,
): EnrichmentEntry {
  if (raw.length !== ENRICHMENT_TUPLE_LENGTH) {
    throw new Error(`${sourceName} 富化词条 #${index} 元组长度非法：${raw.length}`);
  }
  const [term, ipaUsRaw, ipaUkRaw, synonymsRaw, antonymsRaw, derivedRaw, etymologyRaw, wordPartsRaw, etymologyZhRaw, examplesRaw] = raw;
  if (typeof term !== "string" || term === "") {
    throw new Error(`${sourceName} 富化词条 #${index} 词条为空`);
  }
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const ipaUs = str(ipaUsRaw).trim();
  const ipaUk = str(ipaUkRaw).trim();
  const synonyms = splitList(str(synonymsRaw));
  const antonyms = splitList(str(antonymsRaw));
  const derived = splitList(str(derivedRaw));
  const etymology = str(etymologyRaw).trim();
  const wordParts = str(wordPartsRaw).trim();
  const etymologyZh = str(etymologyZhRaw).trim();

  const examples: { text: string; translation: string }[] = [];
  if (Array.isArray(examplesRaw)) {
    for (const pair of examplesRaw) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || pair[0].trim() === "") {
        continue;
      }
      examples.push({ text: pair[0].trim(), translation: typeof pair[1] === "string" ? pair[1] : "" });
    }
  }

  return {
    term,
    ...(ipaUs !== "" ? { ipaUs } : {}),
    ...(ipaUk !== "" ? { ipaUk } : {}),
    ...(synonyms.length > 0 ? { synonyms } : {}),
    ...(antonyms.length > 0 ? { antonyms } : {}),
    ...(derived.length > 0 ? { derived } : {}),
    ...(etymology !== "" ? { etymology } : {}),
    ...(wordParts !== "" ? { wordParts } : {}),
    ...(etymologyZh !== "" ? { etymologyZh } : {}),
    examples,
  };
}

/**
 * 装载富化包（parse-don't-validate：结构与词条形状非法立即抛错，
 * 生成物损坏在启动即暴露，绝不带病运行）。
 */
export function parseEnrichmentPreset(raw: unknown, sourceName: string): EnrichmentPresetPackage {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${sourceName} 富化数据根节点非法`);
  }
  const { id, version, name, generatedAt, source, entries } = raw as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    throw new Error(`${sourceName} 缺少富化包 id`);
  }
  if (typeof version !== "string" || version === "") {
    throw new Error(`${sourceName} 缺少富化包版本号`);
  }
  if (typeof name !== "string" || name === "") {
    throw new Error(`${sourceName} 缺少富化包名称`);
  }
  if (typeof generatedAt !== "string" || generatedAt === "") {
    throw new Error(`${sourceName} 缺少生成时间`);
  }
  if (typeof source !== "string" || source === "") {
    throw new Error(`${sourceName} 缺少来源与许可声明`);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${sourceName} 富化词条为空或格式非法`);
  }
  const resolved: EnrichmentPresetEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const tuple = entries[index];
    if (!Array.isArray(tuple)) {
      throw new Error(`${sourceName} 富化词条 #${index} 非元组`);
    }
    const entry = resolveEnrichmentEntry(tuple, index, sourceName);
    // 富化词条需至少携带一个非空字段（打包侧已按此过滤，装载侧二道防线）
    if (
      entry.ipaUs === undefined &&
      entry.ipaUk === undefined &&
      entry.synonyms === undefined &&
      entry.antonyms === undefined &&
      entry.derived === undefined &&
      entry.etymology === undefined &&
      entry.wordParts === undefined &&
      entry.etymologyZh === undefined &&
      entry.examples.length === 0
    ) {
      throw new Error(`${sourceName} 富化词条 #${index}（${entry.term}）无任何富化字段`);
    }
    resolved.push([
      entry.term,
      entry.ipaUs ?? "",
      entry.ipaUk ?? "",
      (entry.synonyms ?? []).join("\n"),
      (entry.antonyms ?? []).join("\n"),
      (entry.derived ?? []).join("\n"),
      entry.etymology ?? "",
      entry.wordParts ?? "",
      entry.etymologyZh ?? "",
      entry.examples.map((example) => [example.text, example.translation] as [string, string]),
    ]);
  }
  return { id, version, name, generatedAt, source, entries: resolved };
}

/** 富化包 → 按小写词条查询的 Map（打包侧 term 已小写；此处防御性再规范化） */
export function toEnrichmentMap(pkg: EnrichmentPresetPackage): Map<string, EnrichmentEntry> {
  const map = new Map<string, EnrichmentEntry>();
  for (let index = 0; index < pkg.entries.length; index += 1) {
    const tuple = pkg.entries[index];
    if (tuple === undefined) {
      continue;
    }
    const entry = resolveEnrichmentEntry(tuple, index, pkg.id);
    map.set(entry.term.toLowerCase(), entry);
  }
  return map;
}

/** 富化词条 → 词条内容合并（新装路径；只在目标字段缺失/为空时填充） */
export function mergeEnrichmentIntoContent(
  content: WordEntryContent,
  enrichment: EnrichmentEntry | undefined,
): WordEntryContent {
  if (!enrichment) {
    return content;
  }
  const merged: WordEntryContent = { ...content };
  if (!merged.ipaUs && enrichment.ipaUs) {
    merged.ipaUs = enrichment.ipaUs;
  }
  if (!merged.ipaUk && enrichment.ipaUk) {
    merged.ipaUk = enrichment.ipaUk;
  }
  if ((merged.synonyms?.length ?? 0) === 0 && enrichment.synonyms) {
    merged.synonyms = enrichment.synonyms;
  }
  if ((merged.antonyms?.length ?? 0) === 0 && enrichment.antonyms) {
    merged.antonyms = enrichment.antonyms;
  }
  if ((merged.derived?.length ?? 0) === 0 && enrichment.derived) {
    merged.derived = enrichment.derived;
  }
  if (!merged.etymology && enrichment.etymology) {
    merged.etymology = enrichment.etymology;
  }
  if (!merged.wordParts && enrichment.wordParts) {
    merged.wordParts = enrichment.wordParts;
  }
  if (!merged.etymologyZh && enrichment.etymologyZh) {
    merged.etymologyZh = enrichment.etymologyZh;
  }
  if ((merged.examples?.length ?? 0) === 0 && enrichment.examples.length > 0) {
    merged.examples = enrichment.examples;
  }
  return merged;
}

/** 富化词条 → Sense 合并（回填路径）；无变化返回原引用，有变化返回新对象 */
export function mergeEnrichmentIntoSense(
  sense: Sense,
  enrichment: EnrichmentEntry | undefined,
): Sense {
  if (!enrichment) {
    return sense;
  }
  const merged: Sense = { ...sense };
  let changed = false;
  if (!merged.ipaUs && enrichment.ipaUs) {
    merged.ipaUs = enrichment.ipaUs;
    changed = true;
  }
  if (!merged.ipaUk && enrichment.ipaUk) {
    merged.ipaUk = enrichment.ipaUk;
    changed = true;
  }
  if ((merged.synonyms?.length ?? 0) === 0 && enrichment.synonyms) {
    merged.synonyms = enrichment.synonyms;
    changed = true;
  }
  if ((merged.antonyms?.length ?? 0) === 0 && enrichment.antonyms) {
    merged.antonyms = enrichment.antonyms;
    changed = true;
  }
  if ((merged.derived?.length ?? 0) === 0 && enrichment.derived) {
    merged.derived = enrichment.derived;
    changed = true;
  }
  if (!merged.etymology && enrichment.etymology) {
    merged.etymology = enrichment.etymology;
    changed = true;
  }
  if (!merged.wordParts && enrichment.wordParts) {
    merged.wordParts = enrichment.wordParts;
    changed = true;
  }
  if (!merged.etymologyZh && enrichment.etymologyZh) {
    merged.etymologyZh = enrichment.etymologyZh;
    changed = true;
  }
  if ((merged.examples?.length ?? 0) === 0 && enrichment.examples.length > 0) {
    merged.examples = enrichment.examples;
    changed = true;
  }
  return changed ? merged : sense;
}

/** 回填结果 */
export type EnrichmentBackfillResult =
  | { status: "backfilled"; filledCount: number }
  | { status: "already-backfilled"; version: string };

/** 回填选项 */
export interface EnrichmentBackfillOptions {
  /** 块间让出事件循环（测试可注入 no-op；默认 setTimeout 0） */
  yield?: () => Promise<void>;
}

/**
 * 存量库富化回填（幂等、可恢复、并发安全；不改 schema、不清库）。
 *
 * 只更新 term 命中富化包的既有 Sense；富化包覆盖不到的词条（用户自建
 * 词表/词书外词条）不受影响。完成后写 `enrichment:<id>:done` 标记，
 * 下次启动直接跳过。
 *
 * @param db 已打开的 Lexilexi 数据库
 * @param pkg 富化数据包（装载校验后的形态）
 * @returns backfilled = 本次实际改写的 Sense 数；
 *   already-backfilled = 完成标记命中，跳过
 */
export async function backfillEnrichment(
  db: LexilexiDatabase,
  pkg: EnrichmentPresetPackage,
  options: EnrichmentBackfillOptions = {},
): Promise<EnrichmentBackfillResult> {
  const yieldFn = options.yield ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  const done = await db.meta.get(enrichmentDoneKey(pkg.id));
  if (done) {
    return { status: "already-backfilled", version: done.value };
  }

  const map = toEnrichmentMap(pkg);

  // 并发首启竞态加固（与 installPreset 同款）：起始事务先写 progress=0
  // 占位（条件写入），占位后重读一次进度。
  let progressEntry = await db.meta.get(enrichmentProgressKey(pkg.id));
  if (!progressEntry) {
    await db.transaction("rw", db.meta, async () => {
      const existing = await db.meta.get(enrichmentProgressKey(pkg.id));
      if (!existing) {
        await db.meta.put({ key: enrichmentProgressKey(pkg.id), value: "0" });
      }
    });
    progressEntry = await db.meta.get(enrichmentProgressKey(pkg.id));
  }
  const parsed = progressEntry ? Number(progressEntry.value) : 0;
  let cursor =
    Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, pkg.entries.length) : 0;
  const total = pkg.entries.length;
  let filled = 0;

  while (cursor < total) {
    const chunk = pkg.entries.slice(cursor, cursor + ENRICHMENT_CHUNK_SIZE);
    const nextCursor = cursor + chunk.length;
    const expectedCursor = cursor;
    let filledInChunk = 0;
    try {
      await db.transaction("rw", db.senses, db.meta, async () => {
        // 并发防线：块事务开始时进度必须仍是本调用读到的 cursor
        const current = await db.meta.get(enrichmentProgressKey(pkg.id));
        const currentValue = current ? Number(current.value) : 0;
        if ((Number.isFinite(currentValue) ? currentValue : 0) !== expectedCursor) {
          throw new ConcurrentBackfillError(pkg.id);
        }
        const terms = chunk.map((entry) => entry[0]);
        const senses = await db.senses.where("term").anyOfIgnoreCase(terms).toArray();
        const byTerm = new Map<string, Sense[]>();
        for (const sense of senses) {
          const key = sense.term.toLowerCase();
          const bucket = byTerm.get(key);
          if (bucket) {
            bucket.push(sense);
          } else {
            byTerm.set(key, [sense]);
          }
        }
        for (const entryTuple of chunk) {
          const enrichment = map.get(entryTuple[0].toLowerCase());
          if (!enrichment) {
            continue;
          }
          const matches = byTerm.get(entryTuple[0].toLowerCase());
          if (!matches) {
            continue;
          }
          for (const sense of matches) {
            const merged = mergeEnrichmentIntoSense(sense, enrichment);
            if (merged !== sense) {
              await db.senses.put(merged);
              filledInChunk += 1;
            }
          }
        }
        await db.meta.put({ key: enrichmentProgressKey(pkg.id), value: String(nextCursor) });
      });
    } catch (err) {
      if (!(err instanceof ConcurrentBackfillError)) {
        throw err;
      }
      // 并发回填者推进了进度（本块已整体回滚）：先看是否已完成，再重读续填
      const doneNow = await db.meta.get(enrichmentDoneKey(pkg.id));
      if (doneNow) {
        return { status: "already-backfilled", version: doneNow.value };
      }
      const current = await db.meta.get(enrichmentProgressKey(pkg.id));
      const currentValue = current ? Number(current.value) : 0;
      const advancedCursor =
        Number.isFinite(currentValue) && currentValue > cursor
          ? Math.min(currentValue, total)
          : cursor;
      if (advancedCursor === cursor) {
        throw new ConcurrentBackfillError(pkg.id);
      }
      cursor = advancedCursor;
      continue;
    }
    cursor = nextCursor;
    filled += filledInChunk;
    await yieldFn();
  }

  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: enrichmentDoneKey(pkg.id), value: pkg.version });
    await db.meta.delete(enrichmentProgressKey(pkg.id));
  });

  return { status: "backfilled", filledCount: filled };
}

/** 并发回填检测错误（内部哨兵：不面向调用方文案） */
class ConcurrentBackfillError extends Error {
  constructor(presetId: string) {
    super(`富化回填进度被并发回填者推进：${presetId}`);
    this.name = "ConcurrentBackfillError";
  }
}
