/**
 * 首启预设词表引导（RAY-258 Tier 0 内置核心词表 + RAY-268 富化数据 +
 * RAY-319 核心词书默认安装）。
 *
 * 口径：开箱零网络即可完整使用核心学习流程（local-first）。
 * - 全新数据库（无任何条目与事件）→ 安装 Tier 0 预设词表 + 核心词书
 *   （中考/高考/四级/六级），富化字段随安装内联填充（installPreset 的
 *   options.enrichment）；
 * - 已有数据（老用户 / 已导入过词库）→ 跳过安装，绝不擅自塞词；
 *   富化字段由 backfillEnrichment 回填（只补字段、不新增词条、不清库）；
 * - 安装/回填中曾中断 → 从进度断点续装（installPreset /
 *   backfillEnrichment 的可恢复契约，幂等）；
 * - 任何失败都不阻塞启动（fire-and-forget，错误仅记录 console）。
 *
 * 数据层算法全部在 @lexii/core（getPresetInstallState / installPreset /
 * backfillEnrichment），本模块只做「何时装/填」的产品口径判断
 * （apps/web 不做算法实现）。
 */
import {
  backfillEnrichment,
  getPresetInstallState,
  installPreset,
  markEnrichmentDone,
  openDatabase,
  TIER0_PRESET,
} from "@lexii/core";
import type { EnrichmentPresetPackage, LexiiDatabase, PresetPackage } from "@lexii/core";

/** RAY-319：首启自动安装的核心词书 id（中考/高考/四级/六级） */
const CORE_WORDBOOK_IDS: readonly string[] = [
  "book-zk",
  "book-gk",
  "book-cet4",
  "book-cet6",
];

export type BootstrapOutcome =
  | { status: "installed"; installedCount: number }
  | { status: "already-installed" }
  | { status: "skipped-existing-data" }
  | { status: "error"; message: string };

/**
 * 首启引导：按产品口径决定是否安装内置词表。
 *
 * @param db 已打开的数据库（测试注入 fake-indexeddb 实例）
 * @param preset 内置预设包（默认 Tier 0 核心词表；测试注入小包）
 * @param enrichment 富化数据包（可选；随安装内联填充新装词条）
 */
export async function bootstrapPresetData(
  db: LexiiDatabase,
  preset: PresetPackage = TIER0_PRESET,
  enrichment?: EnrichmentPresetPackage,
): Promise<BootstrapOutcome> {
  try {
    const state = await getPresetInstallState(db, preset);
    if (state.status === "installed") {
      return { status: "already-installed" };
    }
    if (state.status === "not-installed") {
      const [items, events] = await Promise.all([db.items.count(), db.events.count()]);
      if (items > 0 || events > 0) {
        return { status: "skipped-existing-data" };
      }
    }
    const result = await installPreset(db, preset, enrichment ? { enrichment } : {});
    return result.status === "installed"
      ? { status: "installed", installedCount: result.installedCount }
      : { status: "already-installed" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * RAY-319：首启引导安装核心词书（中考/高考/四级/六级）。
 *
 * 产品口径：
 * - 全新数据库（无条目与事件）→ 安装全部核心词书；
 * - 已有数据（老用户）→ 跳过全部，绝不擅自塞词；
 * - 已安装完成 → 幂等跳过（不重复安装）；
 * - 任何单本失败不阻塞其余词书安装。
 *
 * 词书数据走 "@lexii/core/presets/books" 子路径动态 import，
 * 不进主 bundle。
 *
 * 返回值：结果数组顺序与 `wordbookIds` 入参顺序一致（按入参逐项产出
 * `already-installed` / `error` / `skipped-existing-data` /
 * `installed`）。调用方可依赖 `results[i]` 与 `wordbookIds[i]` 对应。
 *
 * @param db 已打开的数据库（测试注入 fake-indexeddb 实例）
 * @param wordbookIds 要安装的词书 id 列表（默认 CORE_WORDBOOK_IDS；测试注入）
 * @param enrichment 富化数据包（可选；随安装内联填充新装词条）
 */
export async function bootstrapCoreWordbooks(
  db: LexiiDatabase,
  wordbookIds: readonly string[] = CORE_WORDBOOK_IDS,
  enrichment?: EnrichmentPresetPackage,
): Promise<BootstrapOutcome[]> {
  const results: BootstrapOutcome[] = [];
  try {
    // 动态导入词书模块（~2 MB，不进主 bundle）
    const { WORDBOOK_CATALOG, getWordbookPackage } = await import("@lexii/core/presets/books");

    // 预检查每本词书的安装状态（幂等 + 跳过未找到的词书）
    type BookEntry = { bookId: string; preset: PresetPackage };
    const bookEntries: BookEntry[] = [];
    for (const bookId of wordbookIds) {
      const book = WORDBOOK_CATALOG.find((candidate) => candidate.id === bookId);
      if (!book) {
        results.push({ status: "error", message: `词书 ${bookId} 未在目录中找到` });
        continue;
      }
      const preset = getWordbookPackage(book);
      const state = await getPresetInstallState(db, preset);
      if (state.status === "installed") {
        results.push({ status: "already-installed" });
      } else {
        bookEntries.push({ bookId, preset });
      }
    }

    // 所有词书已安装 → 直接返回
    if (bookEntries.length === 0) {
      return results;
    }

    // 检查数据库是否有已有数据（与 Tier 0 同口径：有数据则跳过未安装的词书）
    const [items, events] = await Promise.all([db.items.count(), db.events.count()]);
    if (items > 0 || events > 0) {
      // 已有数据（老用户）→ 跳过未安装的词书
      for (const entry of bookEntries) {
        results.push({ status: "skipped-existing-data" });
      }
      return results;
    }

    // 全新数据库 → 安装所有待安装词书
    for (const { bookId, preset } of bookEntries) {
      try {
        const outcome = await installPreset(db, preset, enrichment ? { enrichment } : {});
        results.push(
          outcome.status === "installed"
            ? { status: "installed", installedCount: outcome.installedCount }
            : { status: "already-installed" },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ status: "error", message });
        console.error(`[presets] 核心词书 ${bookId} 安装失败：`, message);
      }
    }
  } catch (err) {
    // 模块加载失败或数据库检查失败（异常路径）：预检查循环可能已部分
    // 产出结果（`already-installed` / `error`），也可能在 import 立即
    // 失败时 `results` 为空——使用 `while` 一次性补齐至 `wordbookIds`
    // 长度，保证调用方拿到与入参等长的结果数组
    const message = err instanceof Error ? err.message : String(err);
    while (results.length < wordbookIds.length) {
      results.push({ status: "error", message });
    }
    console.error("[presets] 核心词书引导异常：", err);
  }
  return results;
}

/**
 * 浏览器入口（main.tsx 启动时调用）：打开默认数据库并后台安装 + 富化回填。
 * 绝不抛错、绝不阻塞启动；失败静默记录（首启安装失败不影响已有功能，
 * 用户仍可手动导入词库）。
 *
 * RAY-319：同时安装核心词书（中考/高考/四级/六级），开箱即有完整体验。
 */
export function bootstrapTier0Preset(db?: LexiiDatabase): void {
  void (async () => {
    try {
      const database = db ?? openDatabase();
      // 富化数据包按需加载（子路径 + 动态 import，MB 级 JSON 不进主 bundle，
      // 与词书库 books.data.json 同口径）
      const { ENRICHMENT_TIER0_PRESET } = await import("@lexii/core/presets/enrichment");
      const outcome = await bootstrapPresetData(database, TIER0_PRESET, ENRICHMENT_TIER0_PRESET);
      if (outcome.status === "error") {
        console.error("[presets] 内置核心词表安装失败：", outcome.message);
      }
      if (outcome.status === "installed") {
        // 新装路径（Oscar 评审 suggestion 3）：词条落库时已同事务内联填充
        // 富化字段，直接写完成标记跳过存量回填——回填只补缺失字段，
        // 新装库再全量扫一遍是纯浪费（18 块全扫描、零写入）。
        await markEnrichmentDone(database, ENRICHMENT_TIER0_PRESET);
      } else {
        // 富化回填（RAY-268 存量库路径）：按 term 补字段，幂等
        // （enrichment:<id>:done 标记与包版本一致即跳过），单次全量读
        // senses 建内存 Map 分块写回；合并只改「缺失/为空」的字段。
        const backfill = await backfillEnrichment(database, ENRICHMENT_TIER0_PRESET);
        if (backfill.status === "backfilled" && backfill.filledCount > 0) {
          console.info(`[presets] 富化回填完成：${backfill.filledCount} 条词条`);
        }
      }

      // RAY-319：核心词书默认安装（中考/高考/四级/六级）
      // 与 Tier 0 同口径：全新库安装、已有数据跳过、fire-and-forget
      // 记录安装前 db.items.count()（与 `bootstrapCoreWordbooks` 内部
      // 老用户口径 `items > 0 || events > 0` 取的 items 同源），用于
      // 日志反映真实的净增词条数（4 本词书存在大量重叠词，
      // installedCount 之和 ≠ 净增）。
      const itemsBefore = await database.items.count();
      const wordbookResults = await bootstrapCoreWordbooks(database, CORE_WORDBOOK_IDS, ENRICHMENT_TIER0_PRESET);
      const installedBooks = wordbookResults.filter((r) => r.status === "installed");
      const skippedBooks = wordbookResults.filter((r) => r.status === "skipped-existing-data");
      // 互斥契约：`bootstrapCoreWordbooks` 对同一 `wordbookIds` 入参
      // 只会产出 `installed` 或 `skipped-existing-data` 其中一类——
      // 全新库全装走 `installed`、老用户全跳走 `skipped-existing-data`，
      // 不会有部分 `installed` + 部分 `skipped` 的混合态。
      // 下列两个 `if` 因此互斥，绝不会同时触发，避免重复日志。
      // 未来若 `bootstrapCoreWordbooks` 实现变化允许混合态，
      // 应将两个 `if` 合并为单一 `else if` 链或互斥的 `switch`。
      if (installedBooks.length > 0) {
        const itemsAfter = await database.items.count();
        const netDelta = itemsAfter - itemsBefore;
        // 面向用户的口径用净增（不重叠虚高），sumInstalled 仅作开发者参考
        const sumInstalled = installedBooks.reduce(
          (sum, r) => sum + (r.status === "installed" ? r.installedCount : 0),
          0,
        );
        console.info(
          `[presets] 核心词书安装完成：${installedBooks.length} 本，净增 ${netDelta} 词条（dev 参考：各本去重累计 ${sumInstalled}，与 Tier 0 / 其它词书重叠已去重）`,
        );
      }
      if (skippedBooks.length > 0) {
        // 老用户：库内已有数据，核心词书按口径全部跳过——给开发者
        // 一行可视化反馈，避免无声静默
        console.info(`[presets] 核心词书跳过：${skippedBooks.length} 本（库内已有数据，未追加安装）`);
      }
    } catch (err) {
      console.error("[presets] 内置核心词表引导异常：", err);
    }
  })();
}
