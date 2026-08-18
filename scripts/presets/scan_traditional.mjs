/**
 * 学习流例句繁简扫描（RAY-338 / RAY-346 扩展口径）。
 *
 * 组合两层检测，规避 each 口径的盲区：
 *
 * 1. **OpenCC t2s 主检测**（通用 profile = "t" → "cn"），与
 *    `scripts/presets/lib/tatoeba.mjs` 与 `packages/core/src/presets/toSimplified.test.ts`
 *    同口径。覆盖：舖→铺、餐→餐、歐→欧 等。
 *
 * 2. **语境化变体表（context-aware）**，覆盖 t2s 不转换的字符：
 *    - 「妳」→ 显式判定（tw2s 也漏）。繁体女二字的繁体对应，简体统一为「你」。
 *    - 「著」→ 语境三态判定：
 *      - 保留：前导字 ∈ {卓/昭/显/原/译/专/拙/巨/名/编/撰/创/鸿/杰/遗/论/旧/新/大/典}
 *        （典型：显著/卓著/原著/译著/...）
 *      - 保留：后随字 ∈ {名/作/录/述/权/者/书/说}
 *        （典型：著名/著作/著作权/著录/著述/...）
 *      - 替换：其它（动词后缀 / 介词 / 持续态 / 等著 / 穿著 / 坐著 / 标志著 ...）
 *
 * 故意不使用 tw2s 全量替换的字符：tw2s 把「什么」改成「什幺」、「怎么」改成
 * 「怎幺」、「显著」改成「显着」、「著述」改成「着述」——本语料 660+ 处引入新错转。
 * 检测可以借助 tw2s（仅检测而不替换），但替换必须用语境化表。
 *
 * 范围：packages/core/src/presets/enrichment.tier0.data.json 中
 *   - entries[*][9]（examples）的中文译文
 *   - entries[*][8]（etymologyZh）的中文词源
 *
 * 退出码：发现任何传统字符 → 1（CI 集成）；全清 → 0。
 *
 * 用法：node scripts/presets/scan_traditional.mjs <path/to/data.json> [out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Converter } from "opencc-js";

const PATH = process.argv[2] ?? "packages/core/src/presets/enrichment.tier0.data.json";
const OUT = process.argv[3] ?? null;

const toSimplified = Converter({ from: "t", to: "cn" });

const KEEP_PRE = new Set("卓昭显原译专拙巨名编撰创鸿杰遗论旧新大典".split(""));
const KEEP_POST = new Set("名作录述权者书说".split(""));

/**
 * 判定字符「著」在某个上下文是否应保留。
 * 返回 "keep" | "convert" | "skip"（boundary 字符不参与判定）。
 */
function classifyZhù(prev, next) {
  if (KEEP_PRE.has(prev)) return "keep";
  if (KEEP_POST.has(next)) return "keep";
  return "convert";
}

/**
 * 找出文本中所有需替换的字符（含位置、来源）。
 * 返回数组 [{ i, char, source, fixed, prev, next }]
 * 不修改原文。
 */
function findTraditional(text) {
  const hits = [];
  if (text == null || typeof text !== "string") return hits;
  // 主检测：t2s 整体差异
  const t2sOut = toSimplified(text);
  if (t2sOut !== text) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c.charCodeAt(0) < 0x4e00 || c.charCodeAt(0) > 0x9fff) continue;
      const simChar = t2sOut[i] ?? "";
      if (simChar !== c) {
        hits.push({ i, char: c, source: "t2s", fixed: simChar });
      }
    }
  }
  // 扩展检测：t2s 漏掉的字符
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "妳") {
      hits.push({ i, char: "妳", source: "explicit_妳", fixed: "你" });
    } else if (c === "著") {
      const prev = i > 0 ? text[i - 1] : "";
      const next = i + 1 < text.length ? text[i + 1] : "";
      const cls = classifyZhù(prev, next);
      if (cls === "convert") {
        hits.push({ i, char: "著", source: "context_著", fixed: "着", prev, next });
      }
    }
  }
  return hits;
}

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
    const trads = findTraditional(zh);
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
    const trads = findTraditional(etymologyZh);
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

const report = {
  scanned_at: new Date().toISOString(),
  source_file: PATH,
  converter: "OpenCC t2s (通用) + 语境化字符表（妳/著）",
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
    ` zero_${zero.zero_traditional_hits ? "PASS" : "FAIL"}\n`,
);

process.exit(zero.zero_traditional_hits ? 0 : 1);
