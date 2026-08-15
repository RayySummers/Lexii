/**
 * enrichment.tier0.data.json 生成 → 装载契约测试（RAY-268 批次 A）。
 *
 * 锁定打包产物与运行时装载的口径：
 * - 包元数据完整；
 * - 富化词条 term 全部来自 Tier 0 词表（富化不引入新词条）；
 * - 按 term 排序去重（与打包侧 build-enrichment.mjs 输出一致）；
 * - 每个富化词条至少携带一个非空字段（装载校验已在 enrichment.ts
 *   parseEnrichmentPreset 中兜底，此处再锁数量底线）。
 */
import { describe, expect, it } from "vitest";
import { ENRICHMENT_TIER0_ENTRY_COUNT, ENRICHMENT_TIER0_PRESET } from "./enrichmentTier0";
import { TIER0_PRESET } from "./tier0";

describe("enrichment.tier0.data.json（生成 → 装载契约）", () => {
  it("包元数据完整：id/version/name/source 非空，词条非空", () => {
    expect(ENRICHMENT_TIER0_PRESET.id).toBe("core-en-tier0-enrichment");
    expect(ENRICHMENT_TIER0_PRESET.version).toBeTruthy();
    expect(ENRICHMENT_TIER0_PRESET.name).toBeTruthy();
    expect(ENRICHMENT_TIER0_PRESET.generatedAt).toBeTruthy();
    expect(ENRICHMENT_TIER0_PRESET.source).toBeTruthy();
    expect(ENRICHMENT_TIER0_ENTRY_COUNT).toBeGreaterThan(0);
  });

  it("富化词条 term 全部来自 Tier 0 词表（大小写不敏感），按 term 排序且无重复", () => {
    // 富化包 term 为打包侧规范化的小写词形（kaikki/ipa-dict/OpenEtymology
    // 均以小写为键）；Tier 0 词表保留专有名词原形（Africa 等 118 词），
    // 运行时 join 大小写不敏感（toEnrichmentMap 小写化），两侧小写比较。
    const tier0Terms = new Set(TIER0_PRESET.entries.map((entry) => entry.term.toLowerCase()));
    const seen = new Set<string>();
    let previous = "";
    for (const tuple of ENRICHMENT_TIER0_PRESET.entries) {
      const term = tuple[0];
      expect(tier0Terms.has(term), `富化词条 "${term}" 不在 Tier 0 词表内`).toBe(true);
      expect(seen.has(term), `富化词条重复：${term}`).toBe(false);
      seen.add(term);
      expect(term >= previous, `词条排序漂移：${previous} → ${term}`).toBe(true);
      previous = term;
    }
  });

  it("富化词条覆盖 Tier 0 词表的大多数（低覆盖即管线产物异常）", () => {
    const tier0Count = TIER0_PRESET.entries.length;
    // 富化包只产出「至少一个富化字段非空」的词条；覆盖比例显著偏低
    // 说明构建管线取数失败（如 kaikki 抽取未命中词表）。
    expect(ENRICHMENT_TIER0_ENTRY_COUNT / tier0Count).toBeGreaterThan(0.5);
  });
});
