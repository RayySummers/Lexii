/**
 * Tier 0 富化数据（随 PWA 打包，开箱离线可用）。
 *
 * 数据由 scripts/presets/build-enrichment.mjs 生成（kaikki/Wiktionary
 * CC BY-SA 4.0 + GFDL、Tatoeba CC BY 2.0 FR（含 CC0 子集）、
 * OpenEtymology CC BY-SA 4.0、ipa-dict MIT/GPL-3.0，按 Tier 0 词表裁剪），
 * 本文件在模块加载时做 parse-don't-validate（见 enrichment.ts），
 * 结构与词条形状不合法立即抛错（生成物损坏在启动即暴露）。
 */
import { parseEnrichmentPreset } from "./enrichment";
import type { EnrichmentPresetPackage } from "./types";
import enrichmentData from "./enrichment.tier0.data.json";

const SOURCE_NAME = "enrichment.tier0.data.json";

function loadEnrichmentTier0(): EnrichmentPresetPackage {
  return parseEnrichmentPreset(enrichmentData, SOURCE_NAME);
}

/** Tier 0 富化数据包（模块加载即校验，损坏立即抛错） */
export const ENRICHMENT_TIER0_PRESET: EnrichmentPresetPackage = loadEnrichmentTier0();

/** Tier 0 富化词条数（供 UI 展示与测试断言） */
export const ENRICHMENT_TIER0_ENTRY_COUNT = ENRICHMENT_TIER0_PRESET.entries.length;
