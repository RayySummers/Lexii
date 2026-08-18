/**
 * 第二轮繁简统一补丁（RAY-346 / RAY-338 round 2）。
 *
 * 解决 OpenCC t2s 口径的结构性盲区（Oscar 评审结论）：
 * - 「著」用作动词后缀（zhe / zháo / zhuó）时，t2s 不转换：例句 147+ 处
 * - 「妳」t2s / tw2s 都不转换：例句 4 处
 * - 「著」在 etymologyZh 同样有相同问题（Oscar 标注 9 处）
 *
 * 替换策略（语境化变体表 + 字符邻居三态判定）：
 * 1. 「妳」→「你」——无条件，妳 是繁体女二字的繁体对应，简体统一为 你
 * 2. 「著」→「着」——语境判定：
 *    - 当「著」前导字属于形容词/名词修饰语（卓/昭/显/原/译/专/拙/巨/名/
 *      编/撰/创/鸿/杰/遗/论/旧/新/大/典）→ 保留（典型: 显著/卓著/原著/...)
 *    - 当「著」后随字属于名词/作品后缀（名/作/录/述/权/者/书/说）→ 保留
 *      （典型: 著名/著作/著作权/著录/著者/著述/著书/著说）
 *    - 其它一律视为动词后缀 / 介词 / 持续态 → 替换为「着」
 *    - 等著/穿著/坐著/标志著/活著/随著/沿著 ... → 等待/穿着/等着/标志着/活着/随着/沿着
 *
 * 不使用 tw2s 全量替换的原因：tw2s 会把「什么」改成「什幺」、「怎么」改成「怎幺」，
 * 「显著」改成「显着」、「著述」改成「着述」——在本语料 660+ 处引入新的错转。
 * 本脚本复用 t2s + 显式语境表，避开上述噪音。
 *
 * 用法：node scripts/presets/unify_traditional.mjs [path/to/data.json]
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = process.argv[2] ?? "packages/core/src/presets/enrichment.tier0.data.json";

/** 前导字集合：构成「形容/名词+著」型保留化合词（显著/卓著/原著/...） */
const KEEP_PRE = new Set("卓昭显原译专拙巨名编撰创鸿杰遗论旧新大典".split(""));
/** 后随字集合：构成「著+名词/作品」型保留化合词（著名/著作/著录/...） */
const KEEP_POST = new Set("名作录述权者书说".split(""));

/**
 * 返回「著」是否应保留（true）或替换为「着」（false）。
 * 用前置/后随字符的并集判断，避免误伤「等著」类动词后缀。
 */
function shouldKeepZhù(prev, next) {
  if (KEEP_PRE.has(prev)) return true;
  if (KEEP_POST.has(next)) return true;
  return false;
}

/**
 * 对单个中文文本应用语境化替换。
 * 返回 [newText, modifications]，modifications 是受影响的 0-based 偏移数组。
 */
function applyReplacements(text) {
  const modifications = [];
  if (text == null || typeof text !== "string") return [text, modifications];
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "妳") {
      modifications.push({ i, char: "妳", to: "你" });
      out += "你";
    } else if (c === "著") {
      const prev = i > 0 ? text[i - 1] : "";
      const next = i + 1 < text.length ? text[i + 1] : "";
      if (shouldKeepZhù(prev, next)) {
        out += "著";
      } else {
        modifications.push({ i, char: "著", to: "着", prev, next });
        out += "着";
      }
    } else {
      out += c;
    }
  }
  return [out, modifications];
}

const text = readFileSync(PATH, "utf-8");
const data = JSON.parse(text);

let totalMods = 0;
const exampleMods = []; // 命中的词目（仅作回报）
const etymologyMods = [];

for (const entry of data.entries) {
  const term = entry[0];

  // examples 在 entry[9]
  const examples = entry[9] ?? [];
  for (const pair of examples) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const zhBefore = pair[1] ?? "";
    if (!zhBefore) continue;
    const [zhAfter, mods] = applyReplacements(zhBefore);
    if (mods.length > 0) {
      pair[1] = zhAfter;
      totalMods += mods.length;
      exampleMods.push({ term, mods, before: zhBefore, after: zhAfter });
    }
  }

  // etymologyZh 在 entry[8]
  const et = entry[8] ?? "";
  if (et) {
    const [etAfter, mods] = applyReplacements(et);
    if (mods.length > 0) {
      entry[8] = etAfter;
      totalMods += mods.length;
      etymologyMods.push({ term, mods, before: et, after: etAfter });
    }
  }
}

// version 1.2.1 → 1.2.2
const oldVersion = data.version;
if (oldVersion === "1.2.1") {
  data.version = "1.2.2";
} else {
  console.error(`[warn] 顶层 version 字段为 ${oldVersion}，非 1.2.1；保持不变`);
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
    mods: m.mods,
  })),
  etymology_modifications_sample: etymologyMods.slice(0, 5).map((m) => ({
    term: m.term,
    before: m.before.slice(0, 80),
    after: m.after.slice(0, 80),
    mods: m.mods,
  })),
};

console.log(JSON.stringify(summary, null, 2));
console.error(`[unify_traditional] total modifications: ${totalMods}`);
console.error(`[unify_traditional] entries modified in examples: ${exampleMods.length}`);
console.error(`[unify_traditional] entries modified in etymology: ${etymologyMods.length}`);
console.error(`[unify_traditional] version: ${oldVersion} → ${data.version}`);
