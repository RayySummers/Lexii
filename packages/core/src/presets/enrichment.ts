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
 *   options.enrichment）；完成后由引导层写完成标记（markEnrichmentDone），
 *   跳过存量回填（新装词条已内联填充，再全量扫一遍是纯浪费）；
 * - 存量库：backfillEnrichment 回填——单次全量读 senses 建内存小写 Map，
 *   分块按主键 CAS 写回（不用 term 索引 anyOfIgnoreCase：无 transform 的
 *   索引没有原生大小写不敏感查询，真机上同样是 JS 逐条比较，O(块数 ×
 *   词表) 全扫描）；「禁止清库重来」：只改记录字段，不需要 IndexedDB
 *   schema 版本迁移，与 learningSteps 等记录级字段演进的先例一致，见
 *   docs/domain-model.md §4 演进说明。
 *
 * 合并口径（两路径一致，mergeEnrichmentIntoContent / IntoSense）：
 * 富化字段「只在目标字段缺失/为空时填充」，绝不覆盖用户已有内容
 * （含用户编辑与其它词库导入带来的字段）。
 *
 * 回填与 installPreset 同一套安全机制：进度标记与块数据同事务提交、
 * 起始事务写 progress=0 占位、每块 check-and-set 防并发双标签页重复回填。
 *
 * 版本递增 = 存量设备重跑回填（RAY-276）：包 version 每次递增都会让
 * `enrichment:<id>:done` 版本比对失配，存量设备在下一次启动时重新回填
 * （合并幂等、重跑安全）。v1.0.0 → v1.1.0 即用于让升级前安装的旧词书
 * 补齐富化字段（词书库安装路径自 v1.1.0 起同时内联填充，见 apps/web）。
 */
import type { Sense } from "../domain";
import type { LexiiDatabase } from "../persistence";
import type { WordEntryContent } from "../importWords";
import type { EnrichmentPresetEntry, EnrichmentPresetPackage } from "./types";

/** 每块富化词条数（单块事务的写回量上限，与词表安装块一致；查询在内存 Map 上完成） */
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
 * RAY-365：括号平衡工具（与打包侧 lib/truncate.mjs / 前端 enrichmentUi 同口径）。
 * 用于修复存量库中因 32 字截断导致的「只有左括号无右括号」残段。
 * 枚举 `1) ` / `2) ` / `10) ` 中的 `)` 不计入括号平衡（如 keen 的 `1) 物理层面的...`），
 * 正则与 `scripts/presets/lib/truncate.mjs:ENUM_LIST_RE` 同步（S-3）。
 */
const ENUM_LIST_RE = /(^|\s)\d+\)\s/g;
function bracketDepth(text: string): { full: number; half: number } {
  const normalized = text.replace(ENUM_LIST_RE, "$1");
  let full = 0;
  let half = 0;
  for (const ch of normalized) {
    if (ch === "（") full += 1;
    else if (ch === "）") full -= 1;
    else if (ch === "(") half += 1;
    else if (ch === ")") half -= 1;
  }
  return { full, half };
}
function isBalancedText(text: string): boolean {
  const normalized = text.replace(ENUM_LIST_RE, "$1");
  let full = 0;
  let half = 0;
  for (const ch of normalized) {
    if (ch === "（") full += 1;
    else if (ch === "）") {
      full -= 1;
      if (full < 0) return false;
    } else if (ch === "(") half += 1;
    else if (ch === ")") {
      half -= 1;
      if (half < 0) return false;
    }
  }
  return full === 0 && half === 0;
}
function ensureBalancedText(text: string): string {
  let t = text;
  while (t.endsWith("（") || t.endsWith("(")) {
    t = t.slice(0, -1).trimEnd();
  }
  let { full, half } = bracketDepth(t);
  if ((full > 0 || half > 0) && (t.endsWith("、") || t.endsWith("，") || t.endsWith(","))) {
    t = t.slice(0, -1).trimEnd();
  }
  const after = bracketDepth(t);
  full = after.full;
  half = after.half;
  let result = t;
  if (full > 0) result += "）".repeat(full);
  if (half > 0) result += ")".repeat(half);
  let depth = bracketDepth(result);
  while (depth.full < 0 && result.endsWith("）")) {
    result = result.slice(0, -1);
    depth = bracketDepth(result);
  }
  while (depth.half < 0 && result.endsWith(")")) {
    result = result.slice(0, -1);
    depth = bracketDepth(result);
  }
  return result;
}
function isWordPartsUnbalanced(wordParts: string | undefined): boolean {
  if (!wordParts) return false;
  for (const part of wordParts.split(" · ")) {
    const m = part.match(/^(.*?)<([^>]*)>$/);
    if (!m) continue;
    const note = m[2] ?? "";
    if (!isBalancedText(note)) return true;
  }
  return false;
}
function repairWordPartsBrackets(wordParts: string): string {
  return wordParts
    .split(" · ")
    .map((part) => {
      const m = part.match(/^(.*?)<([^>]*)>$/);
      if (!m) return part;
      const head = m[1];
      const note = m[2] ?? "";
      const balanced = ensureBalancedText(note);
      return `${head}<${balanced}>`;
    })
    .join(" · ");
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
  const [
    term,
    ipaUsRaw,
    ipaUkRaw,
    synonymsRaw,
    antonymsRaw,
    derivedRaw,
    etymologyRaw,
    wordPartsRaw,
    etymologyZhRaw,
    examplesRaw,
  ] = raw;
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
      examples.push({
        text: pair[0].trim(),
        translation: typeof pair[1] === "string" ? pair[1] : "",
      });
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

/** 富化词条 → 词条内容合并（新装路径；只在目标字段缺失/为空时填充，RAY-365 增加括号截断修复） */
export function mergeEnrichmentIntoContent(
  content: WordEntryContent,
  enrichment: EnrichmentEntry | undefined,
): WordEntryContent {
  // RAY-365：即使无富化，也需修复存量 content 的括号截断（前端防御的后端同口径）
  // 若富化存在且为已平衡的同词条，优先走“截断覆盖”语义（S-2），避免本地修复后不再覆盖
  let base: WordEntryContent = content;
  const wouldOverwriteWordPartsContent =
    enrichment?.wordParts !== undefined &&
    !!content.wordParts &&
    isWordPartsUnbalanced(content.wordParts) &&
    !isWordPartsUnbalanced(enrichment.wordParts);
  if (base.wordParts && isWordPartsUnbalanced(base.wordParts) && !wouldOverwriteWordPartsContent) {
    base = { ...base, wordParts: repairWordPartsBrackets(base.wordParts) };
  }
  const wouldOverwriteZhContent =
    enrichment?.etymologyZh !== undefined &&
    !!content.etymologyZh &&
    !isBalancedText(content.etymologyZh) &&
    isBalancedText(enrichment.etymologyZh);
  if (base.etymologyZh && !isBalancedText(base.etymologyZh) && !wouldOverwriteZhContent) {
    base = { ...base, etymologyZh: ensureBalancedText(base.etymologyZh) };
  }
  const wouldOverwriteEtyContent =
    enrichment?.etymology !== undefined &&
    !!content.etymology &&
    !isBalancedText(content.etymology) &&
    isBalancedText(enrichment.etymology);
  if (base.etymology && !isBalancedText(base.etymology) && !wouldOverwriteEtyContent) {
    base = { ...base, etymology: ensureBalancedText(base.etymology) };
  }
  if (!enrichment) {
    return base === content ? content : base;
  }
  const merged: WordEntryContent = { ...base };
  let changed = base !== content;
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
  // RAY-365 P0 放宽（S-2）：原“只补空缺”改为“空缺或括号不平衡（截断）则覆盖”。
  // 仅当现有字段因 32 字截断导致 `!isBalanced` / `isWordPartsUnbalanced` 且富化已平衡时覆盖，
  // 已平衡的用户自定义内容（非截断）绝不覆盖，避免误伤。
  if (enrichment.etymology) {
    if (!merged.etymology) {
      merged.etymology = enrichment.etymology;
      changed = true;
    } else if (!isBalancedText(merged.etymology) && isBalancedText(enrichment.etymology)) {
      merged.etymology = enrichment.etymology;
      changed = true;
    }
  }
  if (enrichment.wordParts) {
    if (!merged.wordParts) {
      merged.wordParts = enrichment.wordParts;
      changed = true;
    } else if (
      isWordPartsUnbalanced(merged.wordParts) &&
      !isWordPartsUnbalanced(enrichment.wordParts)
    ) {
      merged.wordParts = enrichment.wordParts;
      changed = true;
    }
  }
  if (enrichment.etymologyZh) {
    if (!merged.etymologyZh) {
      merged.etymologyZh = enrichment.etymologyZh;
      changed = true;
    } else if (!isBalancedText(merged.etymologyZh) && isBalancedText(enrichment.etymologyZh)) {
      merged.etymologyZh = enrichment.etymologyZh;
      changed = true;
    }
  }
  if ((merged.examples?.length ?? 0) === 0 && enrichment.examples.length > 0) {
    merged.examples = enrichment.examples;
    changed = true;
  }
  return changed ? merged : content;
}

/** 富化词条 → Sense 合并（回填路径）；无变化返回原引用，有变化返回新对象。RAY-365 增加括号截断的覆盖修复 */
export function mergeEnrichmentIntoSense(
  sense: Sense,
  enrichment: EnrichmentEntry | undefined,
): Sense {
  // 先做无富化时的括号修复（存量旧数据的兜底，即使 enrichment 缺失也能自愈）
  // 若富化存在且为已平衡的同词条，优先走“截断覆盖”语义（S-2），避免本地 ensureBalanced 后被判为已平衡而不再覆盖
  let base = sense;
  let baseRepaired = false;
  let repaired: Sense | null = null;
  function ensureRepaired(): Sense {
    if (!repaired) {
      repaired = { ...base };
    }
    return repaired;
  }
  const wouldOverwriteWordParts =
    enrichment?.wordParts !== undefined &&
    !!sense.wordParts &&
    isWordPartsUnbalanced(sense.wordParts) &&
    !isWordPartsUnbalanced(enrichment.wordParts);
  if (base.wordParts && isWordPartsUnbalanced(base.wordParts) && !wouldOverwriteWordParts) {
    const fixed = repairWordPartsBrackets(base.wordParts);
    if (fixed !== base.wordParts) {
      ensureRepaired().wordParts = fixed;
      baseRepaired = true;
    }
  }
  const wouldOverwriteZh =
    enrichment?.etymologyZh !== undefined &&
    !!sense.etymologyZh &&
    !isBalancedText(sense.etymologyZh) &&
    isBalancedText(enrichment.etymologyZh);
  if (base.etymologyZh && !isBalancedText(base.etymologyZh) && !wouldOverwriteZh) {
    const fixed = ensureBalancedText(base.etymologyZh);
    if (fixed !== base.etymologyZh) {
      ensureRepaired().etymologyZh = fixed;
      baseRepaired = true;
    }
  }
  const wouldOverwriteEty =
    enrichment?.etymology !== undefined &&
    !!sense.etymology &&
    !isBalancedText(sense.etymology) &&
    isBalancedText(enrichment.etymology);
  if (base.etymology && !isBalancedText(base.etymology) && !wouldOverwriteEty) {
    const fixed = ensureBalancedText(base.etymology);
    if (fixed !== base.etymology) {
      ensureRepaired().etymology = fixed;
      baseRepaired = true;
    }
  }
  if (baseRepaired && repaired) {
    base = repaired;
  }
  if (!enrichment) {
    return baseRepaired ? base : sense;
  }
  const merged: Sense = { ...base };
  let changed = baseRepaired;
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
  // RAY-365 P0 放宽（S-2）：原“只补空缺”改为“空缺或括号不平衡（截断）则覆盖”。
  // 仅当现有字段因 32 字截断导致 `!isBalanced` / `isWordPartsUnbalanced` 且富化已平衡时覆盖，
  // 已平衡的用户自定义内容（非截断）绝不覆盖，避免误伤。
  if (enrichment.etymology) {
    if (!merged.etymology) {
      merged.etymology = enrichment.etymology;
      changed = true;
    } else if (!isBalancedText(merged.etymology) && isBalancedText(enrichment.etymology)) {
      merged.etymology = enrichment.etymology;
      changed = true;
    }
  }
  if (enrichment.wordParts) {
    if (!merged.wordParts) {
      merged.wordParts = enrichment.wordParts;
      changed = true;
    } else if (
      isWordPartsUnbalanced(merged.wordParts) &&
      !isWordPartsUnbalanced(enrichment.wordParts)
    ) {
      merged.wordParts = enrichment.wordParts;
      changed = true;
    }
  }
  if (enrichment.etymologyZh) {
    if (!merged.etymologyZh) {
      merged.etymologyZh = enrichment.etymologyZh;
      changed = true;
    } else if (!isBalancedText(merged.etymologyZh) && isBalancedText(enrichment.etymologyZh)) {
      merged.etymologyZh = enrichment.etymologyZh;
      changed = true;
    }
  }
  if ((merged.examples?.length ?? 0) === 0 && enrichment.examples.length > 0) {
    merged.examples = enrichment.examples;
    changed = true;
  }
  return changed ? merged : sense;
}

/** 回填结果 */
export type EnrichmentBackfillResult =
  { status: "backfilled"; filledCount: number } | { status: "already-backfilled"; version: string };

/** 回填选项 */
export interface EnrichmentBackfillOptions {
  /** 块间让出事件循环（测试可注入 no-op；默认 setTimeout 0） */
  yield?: () => Promise<void>;
}

/**
 * 标记富化包已处理（Oscar 评审 suggestion 3）：新装路径 installPreset
 * 已同事务内联填充富化字段，引导层在 installed 后调用本函数写完成标记，
 * 跳过存量回填的全量扫描。同时清掉可能的残留进度（完成标记写入后，
 * 中断续填的进度不再有意义）。
 */
export async function markEnrichmentDone(
  db: LexiiDatabase,
  pkg: EnrichmentPresetPackage,
): Promise<void> {
  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: enrichmentDoneKey(pkg.id), value: pkg.version });
    await db.meta.delete(enrichmentProgressKey(pkg.id));
  });
}

/**
 * 存量库富化回填（幂等、可恢复、并发安全；不改 schema、不清库）。
 *
 * 只更新 term 命中富化包的既有 Sense；富化包覆盖不到的词条（用户自建
 * 词表/词书外词条）不受影响。完成后写 `enrichment:<id>:done` 标记，
 * 下次启动直接跳过。
 *
 * 实现（Oscar 评审 suggestion 1/2）：
 * - 单次全量读 senses 建内存小写 Map，之后分块按主键 CAS 写回——替代
 *   每块 `anyOfIgnoreCase` 全扫描（Dexie 对无 transform 的索引没有原生
 *   大小写不敏感查询，真机上同样是 JS 逐条比较，O(块数 × 词表)）；
 *   快照可能错过回填期间的并发写入，但合并口径「只补缺失字段」幂等，
 *   错过的写入由下一次回填（如版本递增重跑）补上，安全；
 * - 完成标记比对版本：`enrichment:<id>:done` 的值 ≠ 包版本即重跑
 *   （ENRICHMENT_VERSION 递增后存量用户能收到新回填；合并幂等，重跑安全）。
 *
 * @param db 已打开的 Lexii 数据库
 * @param pkg 富化数据包（装载校验后的形态）
 * @returns backfilled = 本次实际改写的 Sense 数；
 *   already-backfilled = 完成标记版本与包版本一致，跳过
 */
export async function backfillEnrichment(
  db: LexiiDatabase,
  pkg: EnrichmentPresetPackage,
  options: EnrichmentBackfillOptions = {},
): Promise<EnrichmentBackfillResult> {
  const yieldFn = options.yield ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  // 完成标记比对版本（suggestion 2）：版本一致才跳过；版本不同重跑
  const done = await db.meta.get(enrichmentDoneKey(pkg.id));
  if (done && done.value === pkg.version) {
    return { status: "already-backfilled", version: done.value };
  }

  const map = toEnrichmentMap(pkg);

  // 单次全量读 senses 建内存小写 Map（suggestion 1）：回填为后台一次性
  // 任务，全量快照 + 分块主键 CAS 写回，避免每块索引全扫描。
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
  let cursor = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, pkg.entries.length) : 0;
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
      if (doneNow && doneNow.value === pkg.version) {
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

  // RAY-365 括号截断扫尾：对未被 enrichment 覆盖但仍截断的词条做本地自愈
  // 主 chunk 已通过 mergeEnrichmentIntoSense 对 enrichment 命中的词条完成括号修复+富化覆盖；
  // 扫尾对全库剩余不平衡（如用户导入的旧截断数据）做就地平衡，不依赖 enrichment。
  const remainingToRepair: Sense[] = [];
  for (const sense of allSenses) {
    if (
      (sense.wordParts && isWordPartsUnbalanced(sense.wordParts)) ||
      (sense.etymologyZh && !isBalancedText(sense.etymologyZh)) ||
      (sense.etymology && !isBalancedText(sense.etymology))
    ) {
      const repaired = mergeEnrichmentIntoSense(sense, undefined);
      if (repaired !== sense) {
        // 去重：若该 sense 已在主 chunk 中被修复，此处 repaired 会与已修复版本一致，
        // 但 allSenses 仍指向旧对象，故会再次被加入；后续去重由 Map 避免重复 put
        remainingToRepair.push(repaired);
      }
    }
  }
  if (remainingToRepair.length > 0) {
    // 按 term 去重（同一 term 多 sense 需全修，但同一 sense 重复出现需去重）
    const dedup = new Map<string, Sense>();
    for (const s of remainingToRepair) {
      dedup.set(s.id, s);
    }
    await db.transaction("rw", db.senses, async () => {
      for (const s of dedup.values()) {
        // 最终以 DB 当前值为准：若 chunk 已写入新值，此处 put 会覆盖为同一平衡值（幂等）
        await db.senses.put(s);
      }
    });
    filled += dedup.size;
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
