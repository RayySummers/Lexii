/**
 * 第三轮繁简统一补丁（RAY-346 / RAY-338 round 3）。
 *
 * 解决 Oscar 第二轮复审闭关的 2 处分类器边界误判：
 *   1. `goddess` 例句「土著」被误转为「土着」（新引入错字，应改回）
 *   2. `speaker` 例句「意味著作」漏转（应为「意味着作」）
 *
 * 共享分类器：`scripts/presets/lib/traditional-classify.mjs`
 *   - 词级白名单（KEEP_WORDS_ZHU）：覆盖 著作/著名/显著/卓著/昭著/土著/... 所有合法 zhù 词
 *   - 字符邻居兜底（KEEP_PRE 已含「土」修复 土著；KEEP_POST 用于 著作/著名/著录/...）
 *   - 动词前缀规则（VERB_PREFIXES_BEFORE_ZHU）：覆盖「意味著作」型「X+著+作」拆分
 *
 * 替换策略（继承自第二轮，已与共享模块同步）：
 *   - 「妳」→「你」——无条件，繁体女二字的繁体对应，简体统一为 你
 *   - 「著」→ 走共享分类器 `isKeptZhù`（词级白名单 + 字符邻居 + 动词前缀）
 *   - 其它 t2s 字符（如 舖→铺）由 t2s 自己转换
 *
 * 不使用 tw2s 全量替换的原因：tw2s 会把「什么」改成「什幺」、「怎么」改成「怎幺」，
 * 「显著」改成「显着」、「著述」改成「着述」——在本语料 660+ 处引入新的错转。
 * 本脚本复用 分类器 + 显式语境表，避开上述噪音。
 *
 * 数据 schema 约束（与第二轮一致）：
 *   - 替换 entry[9].examples[*][1] 中文译文
 *   - 替换 entry[8].etymologyZh 中文词源
 *   - 顶层 version 递增 1.2.2 → 1.2.3
 *   - 顶层 generatedAt 同步更新（标注补丁式修改）
 *
 * 用法：node scripts/presets/unify_traditional.mjs [path/to/data.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Converter } from "opencc-js";
import { applyTraditionalFixes } from "./lib/traditional-classify.mjs";

const PATH = process.argv[2] ?? "packages/core/src/presets/enrichment.tier0.data.json";

const t2s = Converter({ from: "t", to: "cn" });

const text = readFileSync(PATH, "utf-8");
const data = JSON.parse(text);

let totalMods = 0;
const exampleMods = [];
const etymologyMods = [];

for (const entry of data.entries) {
  const term = entry[0];

  // examples 在 entry[9]
  const examples = entry[9] ?? [];
  for (const pair of examples) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const zhBefore = pair[1] ?? "";
    if (!zhBefore) continue;
    const { text: zhAfter, hits } = applyTraditionalFixes(zhBefore, t2s);
    if (hits.length > 0) {
      pair[1] = zhAfter;
      totalMods += hits.length;
      exampleMods.push({ term, hits, before: zhBefore, after: zhAfter });
    }
  }

  // etymologyZh 在 entry[8]
  const et = entry[8] ?? "";
  if (et) {
    const { text: etAfter, hits } = applyTraditionalFixes(et, t2s);
    if (hits.length > 0) {
      entry[8] = etAfter;
      totalMods += hits.length;
      etymologyMods.push({ term, hits, before: et, after: etAfter });
    }
  }
}

// version 1.2.2 → 1.2.3
const oldVersion = data.version;
if (oldVersion === "1.2.2") {
  data.version = "1.2.3";
} else {
  console.error(`[warn] 顶层 version 字段为 ${oldVersion}，非 1.2.2；保持不变`);
}

// generatedAt 同步更新（补丁式修改而非重生成；标注改进口径）
const now = new Date().toISOString();
data.generatedAt = now;

writeFileSync(PATH, JSON.stringify(data), "utf-8");

const summary = {
  path: PATH,
  scanned_at: now,
  modifications_total: totalMods,
  modifications_in_examples: exampleMods.length,
  modifications_in_etymology: etymologyMods.length,
  example_sentences_modified: exampleMods.length,
  etymology_sentences_modified: etymologyMods.length,
  version_before: oldVersion,
  version_after: data.version,
  example_modifications_sample: exampleMods.slice(0, 5).map((m) => ({
    term: m.term,
    before: m.before,
    after: m.after,
    hits: m.hits,
  })),
  etymology_modifications_sample: etymologyMods.slice(0, 5).map((m) => ({
    term: m.term,
    before: m.before.slice(0, 80),
    after: m.after.slice(0, 80),
    hits: m.hits,
  })),
};

console.log(JSON.stringify(summary, null, 2));
console.error(`[unify_traditional] total modifications: ${totalMods}`);
console.error(`[unify_traditional] entries modified in examples: ${exampleMods.length}`);
console.error(`[unify_traditional] entries modified in etymology: ${etymologyMods.length}`);
console.error(`[unify_traditional] version: ${oldVersion} → ${data.version}`);
