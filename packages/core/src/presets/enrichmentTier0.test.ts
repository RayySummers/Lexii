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
// @ts-ignore
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ENRICHMENT_TIER0_ENTRY_COUNT, ENRICHMENT_TIER0_PRESET } from "./enrichmentTier0";
import { TIER0_PRESET } from "./tier0";

// 与 `scripts/presets/lib/truncate.mjs:ENUM_LIST_RE` 同步（S-3），避免两处漂移
const ENUM_LIST_RE = /(^|\s)\d+\)\s/g;

describe("enrichment.tier0.data.json（生成 → 装载契约）", () => {
  it("包元数据完整：id/version/name/source 非空，词条非空", () => {
    expect(ENRICHMENT_TIER0_PRESET.id).toBe("core-en-tier0-enrichment");
    expect(ENRICHMENT_TIER0_PRESET.version).toBeTruthy();
    expect(ENRICHMENT_TIER0_PRESET.name).toBeTruthy();
    expect(ENRICHMENT_TIER0_PRESET.generatedAt).toBeTruthy();
    expect(ENRICHMENT_TIER0_PRESET.source).toBeTruthy();
    expect(ENRICHMENT_TIER0_ENTRY_COUNT).toBeGreaterThan(0);
  });

  it('S-1：version === "1.4.0" 且 brotli 体积防回滚/膨胀（1.28MB+5KB）', () => {
    // 显式 pin 版本，防 1.3.0 数据被误回滚；brotli 阈值防 64→128 等无意膨胀
    expect(ENRICHMENT_TIER0_PRESET.version).toBe("1.4.0");
    const json = JSON.stringify(ENRICHMENT_TIER0_PRESET);
    // @ts-ignore - Buffer global in node, zlib can take string directly
    const brotliBytes = brotliCompressSync(json, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
    const threshold = 1.28 * 1024 * 1024 + 5 * 1024;
    expect(
      brotliBytes,
      `brotli 体积 ${brotliBytes} bytes 超阈 ${threshold}，防无意膨胀（当前 1.28MB 基线 +5KB）`,
    ).toBeLessThan(threshold);
    // 额外 guard：1.4.0 产物已通过 RAY-365 修复，entry 数应与 1.3.0 同量级（不回退）
    expect(ENRICHMENT_TIER0_ENTRY_COUNT).toBeGreaterThan(7000);
  }, 15000);

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
    // RAY-365 收紧：32 → 64 字 + 括号平衡感知后，应为 0（2026-08-20 实测 309 → 0）。
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
    // v1.2.3 因 8-char 上限 100% 注释都被截断，其中 80 条以「（」收尾；
    // RAY-344 上限 32 字 + sentence-boundary 后剩余应在个位数（实测 2：
    // fridge / listen 两个 OE 源 > 32 字且无完整全角括号的边缘条目）。
    // RAY-365 修复后应为 0（括号平衡 + 上限 64 字）。
    expect(truncated, "wordParts 注释收尾于「（」残段").toBe(0);
  });

  it("RAY-365：wordParts/ etymology/ etymologyZh 括号必须平衡（P0 只有左括号无右括号）", () => {
    // 根因：truncateAtBoundary 在嵌套 `（` 场景下曾选内层 `）` 导致外层未闭合，
    // 产物出现 309 条 wordParts 注释「只有左括号无右括号」。RAY-365 增加括号平衡感知
    // 与硬切后补全，此测试直接断言三字段括号深度为 0。
    // 注意：中文词源中枚举 `1) ` / `2) ` / `10) ` 的 `)` 不计入括号平衡（keen 等词条的 `1) 物理层面的...`），正则与 truncate.mjs 同步
    let unbalanced = 0;
    const unbalancedSamples: string[] = [];
    function depth(text: string): { full: number; half: number } {
      // 去掉枚举标记 `1) ` / `2) ` / `10) ` 再计数，避免误判（keen 等词条，S-3）
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
    for (const tuple of ENRICHMENT_TIER0_PRESET.entries) {
      const wp = tuple[7] as string;
      const ez = tuple[8] as string;
      // P0 只关注中文词源与词根词缀；英文 etymology (kaikki) 的 84 字截断不在本 P0 验收范围
      // 只检查全角括号，避免 `1) ` 枚举干扰（keen 等）
      if (ez) {
        const d = depth(ez);
        if (d.full !== 0) {
          unbalanced += 1;
          if (unbalancedSamples.length < 3) unbalancedSamples.push(`${tuple[0]}.etymologyZh:${JSON.stringify(ez.slice(0, 40))}`);
        }
      }
      if (wp) {
        for (const part of wp.split(" · ")) {
          const m = part.match(/^(.*?)<([^>]*)>$/);
          if (!m) continue;
          const note = m[2] ?? "";
          const d = depth(note);
          if (d.full !== 0) {
            unbalanced += 1;
            if (unbalancedSamples.length < 3) unbalancedSamples.push(`${tuple[0]}.wordParts:${JSON.stringify(part.slice(0, 50))}`);
            break;
          }
        }
      }
    }
    expect(unbalanced, `括号不平衡样本: ${unbalancedSamples.join(" | ")}`).toBe(0);
  });

  it("S-3：枚举正则忽略 `1) ` / `2) ` / `10) `（与 truncate 共用 ENUM_LIST_RE）", () => {
    // 与 `scripts/presets/lib/truncate.mjs:ENUM_LIST_RE` 同步，覆盖 2) / 10) 场景
    const samples = ["1) 物理层面的", " 2) 精神层面的", " 10) 测试枚举"];
    for (const raw of samples) {
      const normalized = raw.replace(ENUM_LIST_RE, "$1");
      expect(normalized, `枚举 ${JSON.stringify(raw)} 未被忽略`).not.toContain(")");
      // 进一步验证 depth 计为平衡（full 0）
      let full = 0;
      for (const ch of normalized) {
        if (ch === "（") full += 1;
        else if (ch === "）") full -= 1;
      }
      expect(full, `枚举 ${JSON.stringify(raw)} 仍计为不平衡`).toBe(0);
    }
    // 非枚举的括号不应被忽略
    expect("a（b）".replace(ENUM_LIST_RE, "$1")).toBe("a（b）");
    expect("test(1)".replace(ENUM_LIST_RE, "$1")).toBe("test(1)");
  });

  it("RAY-344：etymologyZh 无半句截断（=== 64 而非 < 64，pin 上限确实放开）", () => {
    // 回归样本：RAY-338 报告的 etymologyZh 全被 64-char 上限切到中段
    // （v1.2.3 共有 4315 条 etymologyZh 长度恰好 64 字且以中文单字收尾）。
    //
    // 阈值必须是 `=== 64` 而不是 `< 64`：v1.2.3 的硬切是「截到正好 64 字」，
    // 所以 `ez.length < 64` 在旧数据上同样命中 0 条（`< 64` 在新旧数据上都
    // 通过），等于没设防。`=== 64` 才是真正钉住「上限真的被放开」这件事。
    //
    // 配套一条防御：`maxLen > 64` —— 直接断言实际产物的 etymologyZh 长度
    // 上限已经超过 64（覆盖未来若有人把上限改回 ≤ 64 字的情况，不依赖 0
    // 命中阈值也能 fail）。
    let midSentence = 0;
    let maxLen = 0;
    for (const tuple of ENRICHMENT_TIER0_PRESET.entries) {
      const ez = tuple[8];
      if (!ez) continue;
      if (ez.length > maxLen) maxLen = ez.length;
      // 长度恰好 64 字且以中文单字收尾（无标点）⇒ v1.2.3 的硬切痕迹
      if (ez.length === 64 && /[一-鿿]$/.test(ez)) {
        midSentence += 1;
      }
    }
    expect(midSentence, "etymologyZh 仍存在半句截断（旧数据 4315 → 新数据 0）").toBe(0);
    expect(maxLen, "etymologyZh 上限需 > 64 字（RAY-344 实际为 384）").toBeGreaterThan(64);
  });
});
