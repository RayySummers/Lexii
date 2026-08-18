/**
 * 学习流例句繁简扫描（RAY-338 / RAY-346 扩展口径）。
 *
 * 出口与用法（与第二轮一致，CI lint:presets 接入）：
 *   node scripts/presets/scan_traditional.mjs <path/to/data.json> [out.json]
 *
 * 范围：packages/core/src/presets/enrichment.tier0.data.json 中
 *   - entries[*][9]（examples）的中文译文
 *   - entries[*][8]（etymologyZh）的中文词源
 *
 * 退出码：发现任何传统字符 → 1（CI 集成）；全清 → 0。
 *
 * 检测器（共享库：`scripts/presets/lib/traditional-classify.mjs`）：
 *   1. **OpenCC t2s 主检测**（通用 profile = "t" → "cn"），与
 *      `scripts/presets/lib/tatoeba.mjs` 与 `packages/core/src/presets/toSimplified.test.ts`
 *      同口径。覆盖：舖→铺、歐→欧、餐→餐 等。
 *   2. **词级白名单 + 字符邻居 + 动词前缀**三重校验（覆盖 t2s 不转换的字符）：
 *      - 「著」按词典 + 上下文三态判定（保留合法简化词、替换动词后缀）。
 *      - 「妳」无条件 → 「你」（t2s / tw2s 均漏）。
 *
 * 故意不使用 tw2s 全量替换的原因：tw2s 把「什么」改成「什幺」、「怎么」改成
 * 「怎幺」、「显著」改成「显着」、「著述」改成「着述」——本语料 660+ 处引入新错转。
 * 检测可以借助 tw2s（仅检测而不替换），但替换必须用语境化表。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Converter } from "opencc-js";
import { scanTraditional, selfTest } from "./lib/traditional-classify.mjs";

const PATH = process.argv[2] ?? "packages/core/src/presets/enrichment.tier0.data.json";
const OUT = process.argv[3] ?? null;

const toSimplified = Converter({ from: "t", to: "cn" });

const raw = readFileSync(PATH, "utf-8");
const data = JSON.parse(raw);

const entries = data.entries ?? [];
let totalExamplePairs = 0;
let totalChineseSentences = 0;
let entriesWithTraditional = 0;
let traditionalExampleSentenceCount = 0;
let traditionalEtymologyCount = 0;
let totalCharsStillTraditional = 0;
const charFreq = new Map();
const sourceBreakdown = new Map();
const hits = [];

for (const entry of entries) {
  const term = entry[0];
  const examples = entry[9] ?? [];
  const etymologyZh = entry[8] ?? "";

  const exampleHits = [];
  for (const pair of examples) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    totalExamplePairs += 1;
    const en = pair[0] ?? "";
    const zh = pair[1] ?? "";
    if (!zh) continue;
    if (!/[\u4e00-\u9fff]/.test(zh)) continue;
    totalChineseSentences += 1;
    const trads = scanTraditional(zh, toSimplified);
    if (trads.length > 0) {
      traditionalExampleSentenceCount += 1;
      totalCharsStillTraditional += trads.length;
      for (const t of trads) {
        charFreq.set(t.char, (charFreq.get(t.char) ?? 0) + 1);
        sourceBreakdown.set(t.source, (sourceBreakdown.get(t.source) ?? 0) + 1);
      }
      exampleHits.push({
        en,
        zh,
        bad_chars: trads.map((t) => `${t.char}→${t.fixed}`),
        hits: trads,
      });
    }
  }

  let etymologyHit = null;
  if (etymologyZh && /[\u4e00-\u9fff]/.test(etymologyZh)) {
    const trads = scanTraditional(etymologyZh, toSimplified);
    if (trads.length > 0) {
      traditionalEtymologyCount += 1;
      totalCharsStillTraditional += trads.length;
      for (const t of trads) {
        charFreq.set(t.char, (charFreq.get(t.char) ?? 0) + 1);
        sourceBreakdown.set(t.source, (sourceBreakdown.get(t.source) ?? 0) + 1);
      }
      etymologyHit = {
        zh: etymologyZh,
        bad_chars: trads.map((t) => `${t.char}→${t.fixed}`),
        hits: trads,
      };
    }
  }

  if (exampleHits.length > 0 || etymologyHit) {
    entriesWithTraditional += 1;
    hits.push({
      term,
      examples_with_traditional: exampleHits,
      etymology_with_traditional: etymologyHit,
    });
  }
}

const zero = {
  zero_traditional_hits:
    entriesWithTraditional === 0 &&
    traditionalExampleSentenceCount === 0 &&
    traditionalEtymologyCount === 0,
};

// 自身回归用例（RAY-338 第三轮要求）
const selfTestResult = selfTest(toSimplified);

const report = {
  scanned_at: new Date().toISOString(),
  source_file: PATH,
  converter: "OpenCC t2s (通用) + 词级白名单 + 字符邻居 + 动词前缀", // 不再用「餐→餐」无效示例
  scope: ["entries[*][9].examples[*][1] (中文译文)", "entries[*][8].etymologyZh"],
  total_entries: entries.length,
  total_example_pairs: totalExamplePairs,
  total_chinese_sentences: totalChineseSentences,
  entries_with_traditional: entriesWithTraditional,
  traditional_example_sentence_count: traditionalExampleSentenceCount,
  traditional_etymology_count: traditionalEtymologyCount,
  total_chars_still_traditional: totalCharsStillTraditional,
  distinct_traditional_chars: charFreq.size,
  char_freq: Object.fromEntries(charFreq),
  source_breakdown: Object.fromEntries(sourceBreakdown),
  ...zero,
  self_test: {
    total: selfTestResult.total,
    failures: selfTestResult.failures.length,
    failed_cases: selfTestResult.failures.map((f) => ({ label: f.label, text: f.text })),
  },
  hits,
};

const json = JSON.stringify(report, null, 2);
if (OUT) {
  writeFileSync(OUT, json, "utf-8");
} else {
  process.stdout.write(json + "\n");
}

process.stderr.write(
  `summary: entries=${entries.length} examples=${totalExamplePairs} zh_sentences=${totalChineseSentences}` +
    ` entries_with_traditional=${entriesWithTraditional}` +
    ` traditional_examples=${traditionalExampleSentenceCount}` +
    ` traditional_etymology=${traditionalEtymologyCount}` +
    ` distinct_chars=${charFreq.size}` +
    ` total_chars=${totalCharsStillTraditional}` +
    ` zero_${zero.zero_traditional_hits ? "PASS" : "FAIL"}` +
    ` self_test_${selfTestResult.failures.length === 0 ? "PASS" : "FAIL"}\n`,
);

if (selfTestResult.failures.length > 0) {
  // 自身回归失败，立即退出非零（防止分类器逻辑漂移）
  process.exit(2);
}

process.exit(zero.zero_traditional_hits ? 0 : 1);
