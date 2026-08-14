/**
 * Tier 0 内置核心词表装载校验（RAY-258）。
 *
 * 真实生成物（packages/core/src/presets/tier0.data.json）的完整性断言：
 * 词条数、形状、去重、标签口径。生成物由 scripts/presets/build.mjs 产出，
 * 本测试保证「生成 → 装载」契约不被破坏（如脚本输出格式变更须同步此处）。
 */
import { describe, expect, it } from "vitest";
import { TERM_PATTERN } from "../csv";
import { TIER0_PRESET, TIER0_PRESET_ROW_COUNT } from "./tier0";
import { THIRD_PARTY_DATA_SOURCES, THIRD_PARTY_NOTICES } from "./notices";

describe("TIER0_PRESET（内置核心词表）", () => {
  it("包元信息完整，来源与许可声明非空", () => {
    expect(TIER0_PRESET.id).toBe("core-en-tier0");
    expect(TIER0_PRESET.version).toBeTruthy();
    expect(TIER0_PRESET.name).toBeTruthy();
    expect(TIER0_PRESET.lang).toBe("en");
    expect(TIER0_PRESET.source).toContain("ECDICT");
    expect(TIER0_PRESET.source).toContain("NGSL");
  });

  it("词条数与审计一致（7,195 条：考试标签 ∪ NGSL 1.2，2026-08-15 构建）", () => {
    expect(TIER0_PRESET_ROW_COUNT).toBe(7195);
    expect(TIER0_PRESET.entries).toHaveLength(7195);
  });

  it("全部词条满足词条模式、释义非空、无重复", () => {
    const seen = new Set<string>();
    for (const entry of TIER0_PRESET.entries) {
      expect(TERM_PATTERN.test(entry.term), `词条形状非法：${entry.term}`).toBe(true);
      expect(entry.definitions.length, `释义为空：${entry.term}`).toBeGreaterThan(0);
      expect(seen.has(entry.term.toLowerCase()), `词条重复：${entry.term}`).toBe(false);
      seen.add(entry.term.toLowerCase());
    }
  });

  it("词条按字母序排列（打包侧排序契约）", () => {
    const terms = TIER0_PRESET.entries.map((entry) => entry.term);
    const sorted = [...terms].sort((a, b) => a.localeCompare(b));
    expect(terms).toEqual(sorted);
  });

  it("高频词条（NGSL 1.2）覆盖率 100%：2,809 词全部在包内且带「高频」标签", () => {
    const highFreq = TIER0_PRESET.entries.filter((entry) => entry.tags.includes("高频"));
    expect(highFreq).toHaveLength(2809);
  });

  it("考试标签只使用预定义中文标签集", () => {
    const known = new Set(["中考", "高考", "四级", "六级", "考研", "托福", "雅思", "GRE", "高频"]);
    for (const entry of TIER0_PRESET.entries) {
      for (const tag of entry.tags) {
        expect(known.has(tag), `未知标签：${tag}`).toBe(true);
      }
    }
  });

  it("义项 ipa 与词性字段形态合法（打包侧从释义段首提取词性）", () => {
    const withIpa = TIER0_PRESET.entries.filter((entry) => entry.ipa !== undefined);
    const withPos = TIER0_PRESET.entries.filter((entry) => entry.pos !== undefined);
    expect(withIpa.length).toBeGreaterThan(7000);
    expect(withPos.length).toBeGreaterThan(7000);
    for (const entry of withIpa) {
      expect(entry.ipa!.length).toBeGreaterThan(0);
    }
    for (const entry of withPos) {
      expect(entry.pos!.length).toBeGreaterThan(0);
    }
  });

  it("释义段首不含词性标记（已剥离并入 pos 字段）", () => {
    const markerPattern = /^[a-z]{1,6}\.\s+/;
    for (const entry of TIER0_PRESET.entries) {
      for (const def of entry.definitions) {
        expect(markerPattern.test(def), `释义仍含词性标记：${entry.term} → ${def}`).toBe(false);
      }
    }
  });
});

describe("第三方数据来源登记（数据来源与许可页的事实层）", () => {
  it("登记 ECDICT / NGSL / Wiktionary 三项，许可与出处可核对", () => {
    const ids = THIRD_PARTY_DATA_SOURCES.map((source) => source.id);
    expect(ids).toEqual(["ecdict", "ngsl", "wiktionary"]);
    for (const source of THIRD_PARTY_DATA_SOURCES) {
      expect(source.license).toBeTruthy();
      expect(source.licenseUrl).toMatch(/^https:\/\//);
      expect(source.sourceUrl).toMatch(/^https:\/\//);
      expect(source.attribution).toBeTruthy();
    }
  });

  it("Tier 0 随包分发的来源包含 ECDICT 与 NGSL，不含 Wiktionary（仅交叉校验）", () => {
    const ecdict = THIRD_PARTY_DATA_SOURCES.find((source) => source.id === "ecdict");
    const ngsl = THIRD_PARTY_DATA_SOURCES.find((source) => source.id === "ngsl");
    const wikt = THIRD_PARTY_DATA_SOURCES.find((source) => source.id === "wiktionary");
    expect(ecdict?.bundledIn).toContain("core-en-tier0");
    expect(ngsl?.bundledIn).toContain("core-en-tier0");
    expect(wikt?.bundledIn).toEqual([]);
  });

  it("NOTICE 包含 MIT 版权声明与 NGSL 署名义务文本", () => {
    expect(THIRD_PARTY_NOTICES).toContain("MIT License");
    expect(THIRD_PARTY_NOTICES).toContain("Copyright (c) 2025 Linwei");
    expect(THIRD_PARTY_NOTICES).toContain("Browne, C., Culligan, B. & Phillips, J.");
    expect(THIRD_PARTY_NOTICES).toContain("CC BY-SA 4.0");
  });
});
