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
import type { DictionarySense, LexilexiDatabase } from "./persistence";
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

/** 升级锁 meta 键（CAS 防并发升级） */
export function dictionaryUpgradeLockKey(packageId: string): string {
  return `dict:${packageId}:upgrading`;
}

/**
 * 升级锁存活时间（毫秒）。
 * 锁值为 ISO 时间戳；超过此时限视为标签页崩溃/被杀，允许接管。
 * Tier 2 升级需读 40 万行 + 分块写，分钟级，10 分钟留有余量。
 */
const UPGRADE_LOCK_TTL_MS = 10 * 60 * 1000;

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
  | {
      status: "installed";
      installedCount: number;
      skippedCount: number;
      /** 升级时：内容变更的词条数（首装时为 0） */
      updatedCount: number;
      /** 升级时：已移除的词条数（首装时为 0） */
      deletedCount: number;
    }
  | { status: "already-installed"; installedVersion: string };

/** 安装选项 */
export interface DictionaryInstallOptions {
  /** 导入发生时刻（ISO；默认调用方当前时间，测试可注入） */
  time?: string;
  /** 块间让出事件循环（测试可注入 no-op；默认 setTimeout 0） */
  yield?: () => Promise<void>;
  /** 取消信号（AbortController）。传入后块间检查 aborted → 抛 AbortError。 */
  signal?: AbortSignal;
}

// ─── 内部辅助 ─────────────────────────────────────────────────────────────────

/** 默认让出：把控制权交回事件循环，避免长事务阻塞 UI */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 并发安装检测错误（内部哨兵，用户可见文案见 §3.2） */
class ConcurrentDictionaryInstallError extends Error {
  constructor(packageId: string) {
    super(`另一标签页正在升级：${packageId}`);
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
 *
 * 使用显式只读事务避免隐式事务在并发写入时被中止（AbortError）。
 */
export async function getDictionaryPackageState(
  db: LexilexiDatabase,
  packageId: string,
  totalCount: number,
): Promise<DictionaryPackageState> {
  const doneKey = dictionaryDoneKey(packageId);
  const progressKey = dictionaryProgressKey(packageId);
  const [done, progress] = await db.transaction("r", db.meta, async () => {
    return Promise.all([db.meta.get(doneKey), db.meta.get(progressKey)]);
  });
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
  const signal = options.signal;

  const done = await db.meta.get(dictionaryDoneKey(pkg.id));
  if (done) {
    if (done.value === pkg.version) {
      return { status: "already-installed", installedVersion: done.value };
    }
    if (done.value === "covered-by-tier2") {
      return { status: "already-installed", installedVersion: done.value };
    }
    // 版本失配 → 增量升级（§3.2）
    return upgradeDictionaryPackage(db, pkg, done.value, time, yieldFn, signal);
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

  // ─── term 去重优化（O(n)） ─────────────────────────────────────────────────
  // 首次安装：该包在 dictionarySenses 中无记录，committedTerms 初始为空。
  // 升级/续装：一次性读取该包已有全部 term（source 索引查询，O(n)），
  // 后续每块提交后追加新 term，避免在 while 循环内重复全量读取（O(n²)）。
  const committedTerms = new Set(
    (await db.dictionarySenses.where("source").equals(pkg.id).toArray()).map((s) =>
      s.term.toLowerCase(),
    ),
  );

  while (cursor < total) {
    // 块间取消检查（§6.4 AbortController）
    if (signal?.aborted) {
      throw new DOMException("安装已取消", "AbortError");
    }
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
        // term 去重：使用循环前预加载的 committedTerms Set（O(1) 查找），
        // 避免每块事务内重复全量读取 IDB。
        for (const entry of chunk) {
          if (committedTerms.has(entry.term.toLowerCase())) {
            skippedInChunk += 1;
            continue;
          }
          const sense = toDictionarySense(entry, pkg.lang, pkg.id);
          await db.dictionarySenses.put(sense);
          committedTerms.add(entry.term.toLowerCase());
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
      // CAS 重试：另一标签页已推进进度，重读已提交的 term 集合
      const reloaded = new Set(
        (await db.dictionarySenses.where("source").equals(pkg.id).toArray()).map((s) =>
          s.term.toLowerCase(),
        ),
      );
      committedTerms.clear();
      for (const t of reloaded) {
        committedTerms.add(t);
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
    updatedCount: 0,
    deletedCount: 0,
  };
}

/** 比较 PresetWordEntry 与 DictionarySense 的内容是否一致（轻量比较） */
function isEntryContentEqual(entry: PresetWordEntry, sense: DictionarySense): boolean {
  // definitions 逐条比较
  const entryDefs = entry.definitions;
  if (entryDefs.length !== sense.definitions.length) return false;
  for (let i = 0; i < entryDefs.length; i++) {
    if (entryDefs[i] !== sense.definitions[i]) return false;
  }
  // pos / ipa
  if ((entry.pos ?? "") !== (sense.pos ?? "")) return false;
  if ((entry.ipa ?? "") !== (sense.ipa ?? "")) return false;
  // tags
  const entryTags = entry.tags ?? [];
  if (entryTags.length !== sense.tags.length) return false;
  for (let i = 0; i < entryTags.length; i++) {
    if (entryTags[i] !== sense.tags[i]) return false;
  }
  return true;
}

/**
 * 增量升级：版本失配时，diff 新旧词条，只写入新增/变更、删除已移除词条。
 * 不清库（红线）。已晋升到 senses 表的副本不受影响（独立记录）。
 *
 * 并发防线：CAS 升级锁（meta 键），防止两标签页并发升级产生重复记录。
 */
async function upgradeDictionaryPackage(
  db: LexilexiDatabase,
  pkg: DictionaryPackage,
  oldVersion: string,
  time: string,
  yieldFn: () => Promise<void>,
  signal?: AbortSignal,
): Promise<DictionaryInstallResult> {
  // CAS 升级锁：并发升级时只有一个能成功
  const lockKey = dictionaryUpgradeLockKey(pkg.id);
  let lockAcquired = false;
  await db.transaction("rw", db.meta, async () => {
    const existing = await db.meta.get(lockKey);
    if (existing) {
      // 锁存在：检查是否过期（标签页崩溃/被杀后锁残留）
      const lockTime = new Date(existing.value).getTime();
      const now = new Date(time).getTime();
      const expired = Number.isFinite(lockTime) && now - lockTime > UPGRADE_LOCK_TTL_MS;
      if (!expired) {
        // 锁未过期：重读 done 标记，若已达标则清除锁并返回
        const doneNow = await db.meta.get(dictionaryDoneKey(pkg.id));
        if (doneNow && doneNow.value === pkg.version) {
          // 另一标签页已完成升级，清除残留锁
          await db.meta.delete(lockKey);
          return;
        }
        throw new ConcurrentDictionaryInstallError(pkg.id);
      }
      // 锁已过期：接管（覆盖旧锁）
    }
    await db.meta.put({ key: lockKey, value: time });
    lockAcquired = true;
  });

  if (!lockAcquired) {
    // 未获取锁：检查 done 标记是否已达标
    const doneAfterCheck = await db.meta.get(dictionaryDoneKey(pkg.id));
    if (doneAfterCheck && doneAfterCheck.value === pkg.version) {
      return { status: "already-installed", installedVersion: doneAfterCheck.value };
    }
    // 不应该到达这里（锁未获取且未达标说明有并发错误）
    throw new ConcurrentDictionaryInstallError(pkg.id);
  }

  // 覆盖旧锁后重读 done：可能另一标签页在锁过期前已完成
  const doneAfterLock = await db.meta.get(dictionaryDoneKey(pkg.id));
  if (doneAfterLock && doneAfterLock.value === pkg.version) {
    await db.meta.delete(lockKey);
    return { status: "already-installed", installedVersion: doneAfterLock.value };
  }

  try {
    // 读取旧版该包的全部词条（含 id 用于更新）
    const oldEntries = await db.dictionarySenses.where("source").equals(pkg.id).toArray();
    const oldByTerm = new Map<string, DictionarySense>();
    for (const e of oldEntries) {
      oldByTerm.set(e.term.toLowerCase(), e);
    }
    const newTermSet = new Set(pkg.entries.map((e) => e.term.toLowerCase()));

    // 删除已移除词条
    let deletedCount = 0;
    const removedTerms: string[] = [];
    for (const [term] of oldByTerm) {
      if (!newTermSet.has(term)) {
        removedTerms.push(term);
      }
    }
    for (let i = 0; i < removedTerms.length; i += DICTIONARY_CHUNK_SIZE) {
      if (signal?.aborted) {
        throw new DOMException("安装已取消", "AbortError");
      }
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
      deletedCount += chunk.length;
      await yieldFn();
    }

    // 写入新增/变更词条，跳过内容未变的
    let installedCount = 0;
    let updatedCount = 0;
    let skipped = 0;
    for (let i = 0; i < pkg.entries.length; i += DICTIONARY_CHUNK_SIZE) {
      if (signal?.aborted) {
        throw new DOMException("安装已取消", "AbortError");
      }
      const chunk = pkg.entries.slice(i, i + DICTIONARY_CHUNK_SIZE);
      await db.transaction("rw", db.dictionarySenses, async () => {
        for (const entry of chunk) {
          const old = oldByTerm.get(entry.term.toLowerCase());
          if (old) {
            if (isEntryContentEqual(entry, old)) {
              skipped += 1;
            } else {
              // 内容变更：保留原 id，更新字段
              const updated: DictionarySense = {
                ...old,
                definitions: entry.definitions,
                ...(entry.pos !== undefined ? { pos: entry.pos } : {}),
                ...(entry.ipa !== undefined ? { ipa: entry.ipa } : {}),
                tags: entry.tags ?? [],
              };
              await db.dictionarySenses.put(updated);
              updatedCount += 1;
            }
          } else {
            const sense = toDictionarySense(entry, pkg.lang, pkg.id);
            await db.dictionarySenses.put(sense);
            installedCount += 1;
          }
        }
      });
      await yieldFn();
    }

    // 更新完成标记，清除进度与升级锁
    await db.transaction("rw", db.meta, async () => {
      await db.meta.put({ key: dictionaryDoneKey(pkg.id), value: pkg.version });
      await db.meta.delete(dictionaryProgressKey(pkg.id));
      await db.meta.delete(lockKey);
    });

    invalidateDictionaryCache(pkg.id);

    return {
      status: "installed",
      installedCount,
      skippedCount: skipped,
      updatedCount,
      deletedCount,
    };
  } catch (err) {
    // 清除升级锁（允许重试）
    await db.meta.delete(lockKey);
    throw err;
  }
}

// ─── Tier 1 ⊆ Tier 2 覆盖标记 ────────────────────────────────────────────────

/**
 * 标记 Tier 1 被 Tier 2 覆盖。
 *
 * **调用契约**：Tier 2 安装完成后（`installDictionaryPackage` 返回 `status: "installed"`）
 * 由调用方显式调用。`installDictionaryPackage` 本身不自动调用此函数——
 * 因为 Tier 1 ⊆ Tier 2 覆盖是安装关系语义，不是安装流程的一部分。
 *
 * Phase 3 UI 应在 Tier 2 安装成功回调中调用此函数，避免遗漏。
 *
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
 *
 * 幂等防重：在单个 rw 事务内查重 + put（与 installPreset 块内查重同款），
 * 同 term 已存在时直接返回已有 Sense，不重复晋升。
 * 连点/并发场景下事务串行化保证不会产生双记录。
 */
export async function promoteDictionarySense(
  db: LexilexiDatabase,
  dictSenseId: string,
): Promise<Sense | null> {
  const dictSense = await db.dictionarySenses.get(dictSenseId);
  if (!dictSense) {
    return null;
  }
  return db.transaction("rw", db.senses, async () => {
    // 幂等防重：同 term 已在 senses 表中 → 直接返回已有记录
    const existing = await db.senses.where("term").equalsIgnoreCase(dictSense.term).first();
    if (existing) {
      return existing;
    }
    // 新生成 SenseId，避免与字典条目 id 命名空间冲突
    const { source: _, ...senseFields } = dictSense;
    const promotedSense: Sense = {
      ...senseFields,
      id: toSenseId(createId("sense")),
    };
    await db.senses.put(promotedSense);
    return promotedSense;
  });
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
): Promise<
  Array<{ sense: DictionarySense; kind: "term-prefix" | "term-substring" | "definition" }>
> {
  const q = query.trim().toLowerCase().slice(0, 100);
  if (q.length === 0) return [];
  const limit = options.limit ?? 50;

  // 前缀命中：IDB 索引查询
  const prefixHits = await db.dictionarySenses.where("term").startsWithIgnoreCase(q).toArray();

  const seen = new Set<string>();
  const hits: Array<{
    sense: DictionarySense;
    kind: "term-prefix" | "term-substring" | "definition";
  }> = [];

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
  const KIND_RANK: Record<string, number> = {
    "term-prefix": 0,
    "term-substring": 1,
    definition: 2,
  };
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
 * 模块级单例缓存：合并所有已装包的全量 DictionarySense[]。
 *
 * 实现细节：
 * - 使用单一键 "_all" 合并所有包（而非 packageId:version 独立键），
 *   因为 searchDictionarySenses 需要全量数据做子串/释义扫描。
 * - 缓存失效：安装/升级/卸载时调用 invalidateDictionaryCache() 全量清除。
 * - 低内存降级：前缀命中不依赖缓存（IDB 索引查询），子串/释义命中在缓存
 *   未命中时回退到按需 toArray。
 *
 * 跨标签页限制：模块级单例是 per-tab 的，另一标签页安装/升级后本页缓存
 * 仍旧。刷新后生效。后续可按 focus/版本探测刷新。
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
 *
 * 使用单一 "_all" 键合并所有包，因此始终全量清除。
 * packageId 参数保留供调用方语义表达（当前未区分）。
 */
export function invalidateDictionaryCache(_packageId?: string): void {
  dictionaryCache.clear();
}

// ─── 词条元组转换（与 convertEntry.ts 口径一致） ─────────────────────────────

/**
 * 紧凑元组 → 类型化词条。
 *
 * 打包侧（build.mjs）生成格式为 [term, definitions, pos, ipa, tags]，
 * definitions 以 "\n" 连接多条释义。与 tier0.ts / books.ts 的
 * convertPresetEntry 口径一致，本处内联避免跨模块依赖。
 */
function tupleToPresetWordEntry(raw: unknown[], index: number): PresetWordEntry {
  if (raw.length !== 5) {
    throw new Error(`词条 #${index} 元组长度非法：${raw.length}`);
  }
  const [term = "", defs = "", pos = "", ipa = "", tags = ""] = raw as string[];
  if (!term) {
    throw new Error(`词条 #${index} 词条为空`);
  }
  const definitions = (defs as string)
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (definitions.length === 0) {
    throw new Error(`词条 #${index}（${term}）缺少释义`);
  }
  const tagList = (tags as string)
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return {
    term,
    definitions,
    ...(pos !== "" ? { pos } : {}),
    ...(ipa !== "" ? { ipa } : {}),
    tags: tagList,
  };
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
 *
 * 返回时做最小字段校验（packages 数组 + id/version/variants），
 * 防止托管端返回异常时 UI 深处才 TypeError。
 */
export async function fetchManifest(manifestUrl: string): Promise<DictionaryManifest> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`manifest 获取失败：HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("packages" in data)) {
    throw new Error("manifest 格式非法：缺少 packages 字段");
  }
  const manifest = data as DictionaryManifest;
  if (!Array.isArray(manifest.packages)) {
    throw new Error("manifest 格式非法：packages 不是数组");
  }
  for (const pkg of manifest.packages) {
    if (!pkg.id || !pkg.version || !pkg.variants) {
      throw new Error(
        `manifest 包条目格式非法：缺少 id/version/variants（${JSON.stringify(pkg)}）`,
      );
    }
  }
  return manifest;
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
 *
 * 前提：`crypto.subtle` 仅安全上下文可用（HTTPS 或 localhost）。
 * 非安全上下文直接抛出可读错误（Phase 3 UI 需展示）。
 *
 * signal 可选，用于取消下载（AbortController）。传入后 fetch 请求可被中止。
 */
export async function downloadAndVerifyPackage(
  variant: ManifestVariant,
  signal?: AbortSignal,
): Promise<PresetWordEntry[]> {
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
    throw new Error("当前环境不支持 crypto.subtle（需 HTTPS 或 localhost 安全上下文）");
  }

  const response = await fetch(variant.url, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`包文件下载失败：HTTP ${response.status}`);
  }
  const compressed = await response.arrayBuffer();

  // 解压
  const encoding = variant.url.endsWith(".br") ? "br" : variant.url.endsWith(".gz") ? "gzip" : null;
  let decompressed: ArrayBuffer;
  if (encoding) {
    const ds = new DecompressionStream(encoding as CompressionFormat);
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(compressed));
    await writer.close();
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

  // 解析 JSON：打包侧生成紧凑元组数组 [term, definitions, pos, ipa, tags]，
  // 需转换为 PresetWordEntry 对象（与 tier0.ts / books.ts 的 convertPresetEntry 口径一致）。
  const text = new TextDecoder().decode(decompressed);
  const raw = JSON.parse(text) as unknown[];
  if (!Array.isArray(raw)) {
    throw new Error("包文件格式非法：顶层不是数组");
  }
  return raw.map((entry, index) => {
    if (Array.isArray(entry)) {
      return tupleToPresetWordEntry(entry, index);
    }
    // 兼容对象格式（未来可能切换）
    return entry as PresetWordEntry;
  });
}
