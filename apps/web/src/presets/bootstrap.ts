/**
 * 首启预设词表引导（RAY-258 Tier 0 内置核心词表）。
 *
 * 口径：开箱零网络即可完整使用核心学习流程（local-first）。
 * - 全新数据库（无任何条目与事件）→ 安装 Tier 0 预设词表；
 * - 已有数据（老用户 / 已导入过词库）→ 跳过，绝不擅自塞词；
 * - 安装中曾中断 → 从进度断点续装（installPreset 的可恢复契约）；
 * - 任何失败都不阻塞启动（fire-and-forget，错误仅记录 console）。
 *
 * 数据层算法全部在 @lexilexi/core（getPresetInstallState / installPreset），
 * 本模块只做「何时装」的产品口径判断（apps/web 不做算法实现）。
 */
import { getPresetInstallState, installPreset, openDatabase, TIER0_PRESET } from "@lexilexi/core";
import type { LexilexiDatabase, PresetPackage } from "@lexilexi/core";

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
 */
export async function bootstrapPresetData(
  db: LexilexiDatabase,
  preset: PresetPackage = TIER0_PRESET,
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
    const result = await installPreset(db, preset);
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
 * 浏览器入口（main.tsx 启动时调用）：打开默认数据库并后台安装。
 * 绝不抛错、绝不阻塞启动；失败静默记录（首启安装失败不影响已有功能，
 * 用户仍可手动导入词库）。
 */
export function bootstrapTier0Preset(db?: LexilexiDatabase): void {
  void (async () => {
    try {
      const database = db ?? openDatabase();
      const outcome = await bootstrapPresetData(database);
      if (outcome.status === "error") {
        console.error("[presets] 内置核心词表安装失败：", outcome.message);
      }
    } catch (err) {
      console.error("[presets] 内置核心词表引导异常：", err);
    }
  })();
}
