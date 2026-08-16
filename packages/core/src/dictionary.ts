/**
 * Tier 1/2 扩展词包安装、检索与管理（RAY-294）。
 *
 * 词典检索层（dictionarySenses 表）独立于学习四表，仅用于扩展检索覆盖：
 * - 每词条仅写 1 条 dictionarySense 记录（vs installPreset 的 4 条）；
 * - 不参与复习队列、统计、导出；
 * - 用户加词入词书/生词本时走 promoteDictionarySense 晋升到 senses 表。
 *
 * 设计文档：docs/designs/ray294-tier12-download.md
 */
import type { LanguageCode, Sense } from "./domain";
import { createId, toSenseId } from "./id";
import type { DictionarySense, LexilexiDatabase, MetaRecord } from "./persistence";
import type { PresetWordEntry } from "./presets/types";

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 每块词条数（1 条记录/词条，400 词条 ≈ 400 次 put/事务） */
export const DICTIONARY_CHUNK_SIZE = 400;

/** 安装进度标记的 meta 键前缀 */
export function dictionaryProgressKey(packageId: string): string {
  return `dict:${packageId}:progress`;
}

/** 完成标记的 meta 键前缀（值为已安装版本号或 "covered-by-tier2"） */
export function dictionaryDoneKey(packageId: string): string {
  return `dict:${packageId}:done`;
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 扩展词包（传入 installDictionaryPackage 的包描述） */
export interface DictionaryPackage {
  /** 包稳定标识（如 "core-en-tier1"） */
  id: string;
  /** 内容版本（semver） */
  version: string;
  /** 面向用户的名称 */
  name: string;
  /** 词条语言 */
  lang: LanguageCode;
  /** 词条列表（打包侧已排序去重） */
  entries: PresetWordEntry[];
}

/** 安装状态 */
export type DictionaryInstallStatus = "not-installed" | "installing" | "installed" | "covered";

export interface DictionaryPackageState {
  packageId: string;
  status: DictionaryInstallStatus;
  /** 已处理词条数（installing 时为进度游标，installed 时为总数） */
  installedCount: number;
  /** 包内词条总数 */
  totalCount: number;
  /** 已安装版本（status === "installed" 时有值；"covered" 时为 "covered-by-tier2"） */
  installedVersion?: string;
}

export type DictionaryInstallResult =
  | { status: "installed"; installedCount: number; skippedCount: number }
  | { status: "already-installed"; installedVersion: string };

/** 安装选项 */
export interface DictionaryInstallOptions {
  /** 导入发生时刻（ISO；默认调用方当前时间，测试可注入） */
  time?: string;
  /** 块间让出事件循环（测试可注入 no-op；默认 setTimeout 0） */
  yield?: () => Promise<void>;
}

// ─── 内部辅助 ─────────────────────────────────────────────────────────────────

/** 默认让出：把控制权交回事件循环，避免长事务阻塞 UI */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 并发安装检测错误（内部哨兵） */
class ConcurrentDictionaryInstallError extends Error {
  constructor(packageId: string) {
    super(`词典包安装进度被并发安装者推进：${packageId}`);
    this.name = "ConcurrentDictionaryInstallError";
  }
}

/** PresetWordEntry → DictionarySense（不含 source，由调用方补充） */
function toDictionarySense(
  entry: PresetWordEntry,
  lang: LanguageCode,
  source: string,
): DictionarySense {
  return {
    id: toSenseId(createId("sense")),
    lang,
    term: entry.term,
    definitions: entry.definitions,
    ...(entry.pos ? { pos: entry.pos } : {}),
    ...(entry.ipa ? { ipa: entry.ipa } : {}),
    tags: entry.tags ?? [],
    examples: [],
    source,
  };
}

// ─── 安装/升级 ─────────────────────────────────────────────────────────────────

/**
 * 查询扩展包安装状态（done/progress 标记）。
 */
export async function getDictionaryPackageState(
  db: LexilexiDatabase,
  packageId: string,
  totalCount: number,
): Promise<DictionaryPackageState> {
  const done = await db.meta.get(dictionaryDoneKey(packageId));
  const progress = await db.meta.get(dictionaryProgressKey(packageId));
  const installedCount = progress ? Number(progress.value) : 0;

  if (done) {
    if (done.value === "covered-by-tier2") {
      return {
        packageId,
        status: "covered",
        installedCount: totalCount,
        totalCount,
        installedVersion: done.value,
      };
    }
    return {
      packageId,
      status: "installed",
      installedCount: totalCount,
      totalCount,
      installedVersion: done.value,
    };
  }
  return {
    packageId,
    status: installedCount > 0 ? "installing" : "not-installed",
    installedCount: Number.isFinite(installedCount) ? installedCount : 0,
    totalCount,
  };
}

/**
 * 安装/升级扩展词包到 dictionarySenses 表。
 *
 * 分块事务、可恢复、幂等、并发安全——沿用 installPreset 的 progress + done + CAS 三件套。
 * 每词条仅写 1 条 dictionarySense 记录（vs installPreset 的 4 条）。
 *
 * 版本升级：done 标记存在但版本不匹配时触发增量替换（不清库）。
 */
export async function installDictionaryPackage(
  db: LexilexiDatabase,
  pkg: DictionaryPackage,
  options: DictionaryInstallOptions = {},
): Promise<DictionaryInstallResult> {
  const time = options.time ?? new Date().toISOString();
  const yieldFn = options.yield ?? yieldToMainThread;

  const done = await db.meta.get(dictionaryDoneKey(pkg.id));
  if (done) {
    if (done.value === pkg.version) {
      return { status: "already-installed", installedVersion: done.value };
    }
    if (done.value === "covered-by-tier2") {
      return { status: "already-installed", installedVersion: done.value };
    }
    // 版本失配 → 增量升级（§3.2）
    return upgradeDictionaryPackage(db, pkg, done.value, time, yieldFn);
  }

  // ─── 首次安装 ────────────────────────────────────────────────────────────────

  let progressEntry = await db.meta.get(dictionaryProgressKey(pkg.id));
  if (!progressEntry) {
    // 并发首装竞态加固（与 installPreset 同款）
    await db.transaction("rw", db.meta, async () => {
      const existing = await db.meta.get(dictionaryProgressKey(pkg.id));
      if (!existing) {
        await db.meta.put({ key: dictionaryProgressKey(pkg.id), value: "0" });
      }
    });
    progressEntry = await db.meta.get(dictionaryProgressKey(pkg.id));
  }
  const parsed = progressEntry ? Number(progressEntry.value) : 0;
  let cursor = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, pkg.entries.length) : 0;
  const startCursor = cursor;
  const total = pkg.entries.length;
  let skipped = 0;

  while (cursor < total) {
    const chunk = pkg.entries.slice(cursor, cursor + DICTIONARY_CHUNK_SIZE);
    const nextCursor = cursor + chunk.length;
    const expectedCursor = cursor;
    let skippedInChunk = 0;
    try {
      await db.transaction("rw", db.dictionarySenses, db.meta, async () => {
        // 并发防线
        const current = await db.meta.get(dictionaryProgressKey(pkg.id));
        const currentValue = current ? Number(current.value) : 0;
        if ((Number.isFinite(currentValue) ? currentValue : 0) !== expectedCursor) {
          throw new ConcurrentDictionaryInstallError(pkg.id);
        }
        // term 去重：按 dictionarySenses.term 索引查重
        const chunkTerms = chunk.map((entry) => entry.term);
        const existingTerms = new Set(
          (await db.dictionarySenses.where("term").anyOfIgnoreCase(chunkTerms).uniqueKeys()).map(
            (key) => String(key).toLowerCase(),
          ),
        );
        for (const entry of chunk) {
          if (existingTerms.has(entry.term.toLowerCase())) {
            skippedInChunk += 1;
            continue;
          }
          const sense = toDictionarySense(entry, pkg.lang, pkg.id);
          await db.dictionarySenses.put(sense);
        }
        await db.meta.put({ key: dictionaryProgressKey(pkg.id), value: String(nextCursor) });
      });
    } catch (err) {
      if (!(err instanceof ConcurrentDictionaryInstallError)) {
        throw err;
      }
      const doneNow = await db.meta.get(dictionaryDoneKey(pkg.id));
      if (doneNow) {
        return { status: "already-installed", installedVersion: doneNow.value };
      }
      const current = await db.meta.get(dictionaryProgressKey(pkg.id));
      const currentValue = current ? Number(current.value) : 0;
      const advancedCursor =
        Number.isFinite(currentValue) && currentValue > cursor
          ? Math.min(currentValue, total)
          : cursor;
      if (advancedCursor === cursor) {
        throw new ConcurrentDictionaryInstallError(pkg.id);
      }
      cursor = advancedCursor;
      continue;
    }
    cursor = nextCursor;
    skipped += skippedInChunk;
    await yieldFn();
  }

  // 写入完成标记，清除进度
  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: dictionaryDoneKey(pkg.id), value: pkg.version });
    await db.meta.delete(dictionaryProgressKey(pkg.id));
  });

  // 清除缓存（模块级单例）
  invalidateDictionaryCache(pkg.id);

  return {
    status: "installed",
    installedCount: total - startCursor - skipped,
    skippedCount: skipped,
  };
}

/**
 * 增量升级：版本失配时，diff 新旧词条，只写入新增/变更、删除已移除词条。
 * 不清库（红线）。已晋升到 senses 表的副本不受影响（独立记录）。
 */
async function upgradeDictionaryPackage(
  db: LexilexiDatabase,
  pkg: DictionaryPackage,
  oldVersion: string,
  time: string,
  yieldFn: () => Promise<void>,
): Promise<DictionaryInstallResult> {
  // 读取旧版该包的全部 term 集合
  const oldEntries = await db.dictionarySenses.where("source").equals(pkg.id).toArray();
  const oldTermSet = new Set(oldEntries.map((e) => e.term.toLowerCase()));
  const newTermSet = new Set(pkg.entries.map((e) => e.term.toLowerCase()));

  // 删除已移除词条
  const removedTerms: string[] = [];
  for (const term of oldTermSet) {
    if (!newTermSet.has(term)) {
      removedTerms.push(term);
    }
  }
  // 分块删除（避免单事务过大）
  for (let i = 0; i < removedTerms.length; i += DICTIONARY_CHUNK_SIZE) {
    const chunk = removedTerms.slice(i, i + DICTIONARY_CHUNK_SIZE);
    await db.transaction("rw", db.dictionarySenses, async () => {
      for (const term of chunk) {
        const toDelete = await db.dictionarySenses
          .where("term")
          .equalsIgnoreCase(term)
          .filter((s) => s.source === pkg.id)
          .toArray();
        for (const s of toDelete) {
          await db.dictionarySenses.delete(s.id);
        }
      }
    });
    await yieldFn();
  }

  // 写入新增/变更词条（term 不在旧版中的）
  let installedCount = 0;
  let skipped = 0;
  for (let i = 0; i < pkg.entries.length; i += DICTIONARY_CHUNK_SIZE) {
    const chunk = pkg.entries.slice(i, i + DICTIONARY_CHUNK_SIZE);
    await db.transaction("rw", db.dictionarySenses, async () => {
      for (const entry of chunk) {
        if (oldTermSet.has(entry.term.toLowerCase())) {
          // 已存在：检查内容是否变更（简化：跳过，未来可加 hash 比较）
          skipped += 1;
          continue;
        }
        const sense = toDictionarySense(entry, pkg.lang, pkg.id);
        await db.dictionarySenses.put(sense);
        installedCount += 1;
      }
    });
    await yieldFn();
  }

  // 更新完成标记
  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: dictionaryDoneKey(pkg.id), value: pkg.version });
    await db.meta.delete(dictionaryProgressKey(pkg.id));
  });

  invalidateDictionaryCache(pkg.id);

  return { status: "installed", installedCount, skippedCount: skipped };
}

// ─── Tier 1 ⊆ Tier 2 覆盖标记 ────────────────────────────────────────────────

/**
 * 标记 Tier 1 被 Tier 2 覆盖（Tier 2 安装完成后调用）。
 * 写入 dictionaryDoneKey("core-en-tier1") = "covered-by-tier2"。
 */
export async function markTier1CoveredByTier2(db: LexilexiDatabase): Promise<void> {
  await db.meta.put({ key: dictionaryDoneKey("core-en-tier1"), value: "covered-by-tier2" });
}

// ─── 晋升 ─────────────────────────────────────────────────────────────────────

/**
 * 从 dictionarySenses 复制到 senses 表（新生成 SenseId）。
 * 供 addToNotebook 兜底路径调用（RAY-284 衔接）。
 * 返回晋升后的 Sense（senses 表中的新记录）。
 */
export async function promoteDictionarySense(
  db: LexilexiDatabase,
  dictSenseId: string,
): Promise<Sense | null> {
  const dictSense = await db.dictionarySenses.get(dictSenseId);
  if (!dictSense) {
    return null;
  }
  // 新生成 SenseId，避免与字典条目 id 命名空间冲突
  const { source: _, ...senseFields } = dictSense;
  const promotedSense: Sense = {
    ...senseFields,
    id: toSenseId(createId("sense")),
  };
  await db.senses.put(promotedSense);
  return promotedSense;
}

// ─── 检索 ─────────────────────────────────────────────────────────────────────

/**
 * 检索 dictionarySenses 表（纯函数委托 + IDB 读取）。
 *
 * 三种命中类型（与 RAY-266 口径一致）：
 * - term-prefix：IDB 索引区间查询（O(log N)）
 * - term-substring：全量 toArray → 内存 includes
 * - definition：全量 toArray → 内存 definitions.some
 */
export async function searchDictionarySenses(
  db: LexilexiDatabase,
  query: string,
  options: { limit?: number } = {},
): Promise<Array<{ sense: DictionarySense; kind: "term-prefix" | "term-substring" | "definition" }>> {
  const q = query.trim().toLowerCase().slice(0, 100);
  if (q.length === 0) return [];
  const limit = options.limit ?? 50;

  // 前缀命中：IDB 索引查询
  const prefixHits = await db.dictionarySenses
    .where("term")
    .startsWithIgnoreCase(q)
    .toArray();

  const seen = new Set<string>();
  const hits: Array<{ sense: DictionarySense; kind: "term-prefix" | "term-substring" | "definition" }> = [];

  for (const sense of prefixHits) {
    if (!seen.has(sense.id)) {
      seen.add(sense.id);
      hits.push({ sense, kind: "term-prefix" });
    }
  }

  // 子串 + 释义命中：全量 toArray → 内存过滤
  // 使用缓存（模块级单例）避免重复读 IDB
  const allSenses = await getDictionarySensesCached(db);

  for (const sense of allSenses) {
    if (seen.has(sense.id)) continue;
    const term = sense.term.toLowerCase();
    let kind: "term-substring" | "definition" | null = null;
    if (term.includes(q)) {
      kind = "term-substring";
    } else if (sense.definitions.some((d) => d.toLowerCase().includes(q))) {
      kind = "definition";
    }
    if (kind !== null) {
      seen.add(sense.id);
      hits.push({ sense, kind });
    }
  }

  // 排序：命中类型 → 词条长度 → 字典序
  const KIND_RANK: Record<string, number> = { "term-prefix": 0, "term-substring": 1, definition: 2 };
  hits.sort((a, b) => {
    const byKind = (KIND_RANK[a.kind] ?? 0) - (KIND_RANK[b.kind] ?? 0);
    if (byKind !== 0) return byKind;
    const byLength = a.sense.term.length - b.sense.term.length;
    if (byLength !== 0) return byLength;
    return a.sense.term.localeCompare(b.sense.term);
  });

  return limit > 0 ? hits.slice(0, limit) : hits;
}

// ─── 模块级缓存 ────────────────────────────────────────────────────────────────

/**
 * 模块级单例缓存：以 packageId 为键，缓存全量 DictionarySense[]。
 *
 * 缓存失效：安装/升级/卸载时调用 invalidateDictionaryCache。
 * 低内存降级：前缀命中不依赖缓存（IDB 索引查询），子串/释义命中在缓存
 * 未命中时回退到按需 toArray。
 */
const dictionaryCache = new Map<string, DictionarySense[]>();

/**
 * 获取缓存的全量词典数据（合并所有已装包）。
 * 首次调用时从 IDB 加载，后续走缓存。
 */
async function getDictionarySensesCached(db: LexilexiDatabase): Promise<DictionarySense[]> {
  // 使用单一缓存键 "_all" 合并所有包的数据
  const CACHE_KEY = "_all";
  const cached = dictionaryCache.get(CACHE_KEY);
  if (cached) return cached;

  const all = await db.dictionarySenses.toArray();
  dictionaryCache.set(CACHE_KEY, all);
  return all;
}

/**
 * 使缓存失效（安装/升级/卸载时调用）。
 * packageId 未指定时清除全部缓存。
 */
export function invalidateDictionaryCache(packageId?: string): void {
  if (packageId) {
    // 清除所有缓存条目（因为 _all 合并了所有包）
    dictionaryCache.clear();
  } else {
    dictionaryCache.clear();
  }
}

// ─── manifest 与解压 ──────────────────────────────────────────────────────────

/** manifest 中每个包的 variant 描述 */
export interface ManifestVariant {
  url: string;
  size: number;
  sha256: string;
}

/** manifest 中每个包的描述 */
export interface ManifestPackage {
  id: string;
  version: string;
  variants: {
    brotli?: ManifestVariant;
    gzip?: ManifestVariant;
    raw?: ManifestVariant;
  };
  sourceCommit: string;
}

/** manifest 顶层结构 */
export interface DictionaryManifest {
  packages: ManifestPackage[];
  generatedAt: string;
}

/**
 * 获取远程 manifest（含包列表、版本、SHA256）。
 * 用户进入扩展词包设置页时发起（启动时不发任何网络请求）。
 */
export async function fetchManifest(manifestUrl: string): Promise<DictionaryManifest> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`manifest 获取失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<DictionaryManifest>;
}

/**
 * 运行时检测浏览器解压能力。
 * 方案采用运行时探测，Brotli 支持矩阵仅作参考。
 */
export async function detectDecompression(): Promise<"brotli" | "gzip" | "raw"> {
  try {
    // "br" 未纳入 TypeScript DOM 类型（CompressionFormat），但 Chrome 80+ 已支持
    const stream = new DecompressionStream("br" as CompressionFormat);
    await stream.writable.close();
    return "brotli";
  } catch {
    try {
      const stream = new DecompressionStream("gzip");
      await stream.writable.close();
      return "gzip";
    } catch {
      return "raw";
    }
  }
}

/**
 * 下载并校验扩展包数据。
 *
 * 流程：fetch 包文件（cache: "no-store"）→ 解压 → SHA-256 校验 → 解析 JSON。
 * 整包重试（非 Range 续传）。
 */
export async function downloadAndVerifyPackage(
  variant: ManifestVariant,
): Promise<PresetWordEntry[]> {
  const response = await fetch(variant.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`包文件下载失败：HTTP ${response.status}`);
  }
  const compressed = await response.arrayBuffer();

  // 解压
  const encoding = variant.url.endsWith(".br")
    ? "br"
    : variant.url.endsWith(".gz")
      ? "gzip"
      : null;
  let decompressed: ArrayBuffer;
  if (encoding) {
    const ds = new DecompressionStream(encoding as CompressionFormat);
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(compressed));
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    decompressed = result.buffer;
  } else {
    decompressed = compressed;
  }

  // SHA-256 校验
  const hashBuffer = await crypto.subtle.digest("SHA-256", decompressed);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hashHex !== variant.sha256) {
    throw new Error(`SHA-256 校验失败：期望 ${variant.sha256}，实际 ${hashHex}`);
  }

  // 解析 JSON
  const text = new TextDecoder().decode(decompressed);
  return JSON.parse(text) as PresetWordEntry[];
}
