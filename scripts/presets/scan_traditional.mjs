/**
 * 学习流例句繁简扫描（与 RAY-338 同步口径）
 *
 * - 转换器：OpenCC `t2s` 通用 profile（"t" → "cn"），与 scripts/presets/lib/tatoeba.mjs
 *   及 packages/core/src/presets/toSimplified.test.ts 一致。
 * - 范围：packages/core/src/presets/enrichment.tier0.data.json 中
 *   - entries[*][9]（examples 字段）的中文译文
 *   - entries[*][8]（etymologyZh 字段）的中文词源
 * - 判定：t2s.convert(zh) !== zh 视为含繁体。
 *
 * 用法：node scripts/presets/scan_traditional.mjs <path/to/data.json>
 */
import { readFileSync } from "node:fs";
import { Converter } from "opencc-js";

const PATH = process.argv[2] ?? "packages/core/src/presets/enrichment.tier0.data.json";
const OUT = process.argv[3] ?? null;

const toSimplified = Converter({ from: "t", to: "cn" });

const raw = readFileSync(PATH, "utf-8");
const data = JSON.parse(raw);

const entries = data.entries ?? [];
let entriesWithTraditional = 0;
let traditionalExampleSentenceCount = 0;
let traditionalEtymologyCount = 0;
let totalChineseSentences = 0;
let totalExamplePairs = 0;
const charFreq = new Map();
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

    // 仅扫描含 CJK 字符的字符串，过滤英文句的纯字母条目
    if (!/[\u4e00-\u9fff]/.test(zh)) continue;
    totalChineseSentences += 1;

    const simplified = toSimplified(zh);
    if (simplified !== zh) {
      traditionalExampleSentenceCount += 1;
      // 逐字符比较：原 zh 中出现但 simplified 中没有/不同的字符
      const bad = [];
      for (let i = 0; i < zh.length; i++) {
        const c = zh[i];
        if (c.charCodeAt(0) < 0x4e00 || c.charCodeAt(0) > 0x9fff) continue;
        const simChar = simplified[i] ?? "";
        if (simChar !== c) {
          bad.push(`${c}→${simChar}`);
          charFreq.set(c, (charFreq.get(c) ?? 0) + 1);
        }
      }
      exampleHits.push({ en, zh, zh_simplified: simplified, bad_chars: bad });
    }
  }

  let etymologyHit = null;
  if (etymologyZh && /[\u4e00-\u9fff]/.test(etymologyZh)) {
    const simplified = toSimplified(etymologyZh);
    if (simplified !== etymologyZh) {
      traditionalEtymologyCount += 1;
      const bad = [];
      for (let i = 0; i < etymologyZh.length; i++) {
        const c = etymologyZh[i];
        if (c.charCodeAt(0) < 0x4e00 || c.charCodeAt(0) > 0x9fff) continue;
        const simChar = simplified[i] ?? "";
        if (simChar !== c) {
          bad.push(`${c}→${simChar}`);
          charFreq.set(c, (charFreq.get(c) ?? 0) + 1);
        }
      }
      etymologyHit = { zh: etymologyZh, zh_simplified: simplified, bad_chars: bad };
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

const report = {
  scanned_at: new Date().toISOString(),
  source_file: PATH,
  converter: "OpenCC t2s (通用繁体→简体，与 tatoeba.mjs 同口径)",
  total_entries: entries.length,
  total_example_pairs: totalExamplePairs,
  total_chinese_sentences: totalChineseSentences,
  entries_with_traditional: entriesWithTraditional,
  traditional_example_sentence_count: traditionalExampleSentenceCount,
  traditional_etymology_count: traditionalEtymologyCount,
  distinct_traditional_chars: charFreq.size,
  char_freq: Object.fromEntries(charFreq),
  hits,
};

const json = JSON.stringify(report, null, 2);
if (OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, json, "utf-8");
} else {
  process.stdout.write(json + "\n");
}

// Summary always to stderr for easy grep
process.stderr.write(
  `summary: entries=${entries.length} examples=${totalExamplePairs} zh_sentences=${totalChineseSentences}` +
    ` entries_with_traditional=${entriesWithTraditional}` +
    ` traditional_examples=${traditionalExampleSentenceCount}` +
    ` traditional_etymology=${traditionalEtymologyCount}` +
    ` distinct_chars=${charFreq.size}\n`,
);
