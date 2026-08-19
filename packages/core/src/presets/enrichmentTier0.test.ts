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

  it("RAY-344：wordParts 注释无残段（不收尾于半切的全角括号内）", () => {
    // 回归样本：RAY-338 报告里的「preside.sid: 坐（拉丁语 se」属于此问题
    // （8-char 上限 + 全角括号未对齐）。回填后 8 → 32 字、sentence-boundary，
    // 应基本消除 8-char 上限带来的「（」收尾；剩余仅为少数 OE 源本就 > 32
    // 字且句中无可对齐全角括号的边缘情况（如 fridge / listen）。
    let truncated = 0;
    for (const tuple of ENRICHMENT_TIER0_PRESET.entries) {
      const wp = tuple[7];
      if (!wp) continue;
      for (const part of wp.split(" · ")) {
        const match = part.match(/^(.*?)<([^>]*)>$/);
        if (!match) continue;
        const note = match[2];
        if (note === undefined) continue;
        if (note.endsWith("（") || note.endsWith("(")) {
          truncated += 1;
        }
      }
    }
    // v1.2.3 因 8-char 上限有 11987 / 11987 注释都被截断；RAY-344 上限 32 字
    // + sentence-boundary 后剩余应在个位数。
    expect(truncated, "wordParts 注释收尾于「（」残段").toBeLessThan(10);
  });

  it("RAY-344：etymologyZh 无大面积半句截断", () => {
    // 回归样本：RAY-338 报告的 etymologyZh 全被 64-char 上限切到中段
    // （v1.2.3 共有 6245 / 6247 条 etymologyZh 都被截到 64 字）。
    // 回填后 64 → 384 字 + sentence-boundary；剩余仅极少数 OE 源本身就
    // 超过 384 字的条目会被切到句中，比例应远低于 1%。
    let midSentence = 0;
    for (const tuple of ENRICHMENT_TIER0_PRESET.entries) {
      const ez = tuple[8];
      if (!ez) continue;
      // 长度 < 64 字且以中文单字收尾（无标点）⇒ v1.2.3 的截断痕迹
      if (ez.length < 64 && /[一-鿿]$/.test(ez)) {
        midSentence += 1;
      }
    }
    expect(midSentence, "etymologyZh 仍存在大面积半句截断").toBeLessThan(10);
  });
});
