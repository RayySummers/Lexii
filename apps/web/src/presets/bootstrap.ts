/**
 * 首启预设词表引导（RAY-258 Tier 0 内置核心词表 + RAY-268 富化数据）。
 *
 * 口径：开箱零网络即可完整使用核心学习流程（local-first）。
 * - 全新数据库（无任何条目与事件）→ 安装 Tier 0 预设词表，富化字段
 *   随安装内联填充（installPreset 的 options.enrichment）；
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
 * 浏览器入口（main.tsx 启动时调用）：打开默认数据库并后台安装 + 富化回填。
 * 绝不抛错、绝不阻塞启动；失败静默记录（首启安装失败不影响已有功能，
 * 用户仍可手动导入词库）。
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
        return;
      }
      // 富化回填（RAY-268 存量库路径）：按 term 补字段，幂等
      // （enrichment:<id>:done 标记与包版本一致即跳过），单次全量读
      // senses 建内存 Map 分块写回；合并只改「缺失/为空」的字段。
      const backfill = await backfillEnrichment(database, ENRICHMENT_TIER0_PRESET);
      if (backfill.status === "backfilled" && backfill.filledCount > 0) {
        console.info(`[presets] 富化回填完成：${backfill.filledCount} 条词条`);
      }
    } catch (err) {
      console.error("[presets] 内置核心词表引导异常：", err);
    }
  })();
}
