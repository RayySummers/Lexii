/**
 * RAY-344（B3 中文词源 / 词根词缀完整性回填）一次性回填脚本。
 *
 * 修复 RAY-338 提交链引入的回归：
 * - v1.1.0（RAY-318）etymologyZh 上限 64 → 384，但 RAY-316 的繁简统一
 *   PR（merge commit 1a3d2d4）重新带回了 64-char 上限的数据；
 * - wordPartsNote 上限 8 字导致 100% 截断（包外层全角括号都没保住），
 *   用户在 RAY-338 报告里的样本「sid 坐（拉丁语 se」即一例。
 *
 * 本脚本从 OpenEtymology 源（已下载到 scripts/presets/.data/openetymology/）
 * 重新计算 Tier 0 词表的 wordParts / etymologyZh，按 RAY-344 新口径
 * （wordPartsNote: 32, etymologyZh: 384, sentence-boundary）写回
 * enrichment.tier0.data.json，version 1.2.3 → 1.3.0。
 *
 * 前置条件（Oscar 评审 suggestion #6）：
 *   1. 本地先跑 `node scripts/presets/fetch-openetymology.mjs`，
 *      把五册 EPUB 下载到 `scripts/presets/.data/openetymology/`；
 *      否则本脚本会因为 OE 源缺失而抛错。
 *   2. 仅在 RAY-344 数据需要回填时跑一次；CI 不依赖、不定时跑。
 *
 * 截断函数从 `lib/truncate.mjs` 导入（Oscar 评审 suggestion #4），
 * 与 `build-enrichment.mjs` 共用同一份实现，口径调整时改一处即可。
 *
 * 词性 / IPA / 英文 etymology（kaikki 来源）保持原值——kaikki 数据未在
 * 本环境缓存，回归无法修复，但其截断 84 字的影响仅在中英对照的英文词源
 * 显示，本任务（中文词源/词根词缀）范围之外，留待后续 RAY 修复。
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOpenEtymology } from "../lib/openetymology.mjs";
import { truncateAtBoundary, trimWordPartsNote } from "../lib/truncate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OE_DIR = path.join(ROOT, "scripts", "presets", ".data", "openetymology");
const TIER0_ENRICH_JSON = path.join(ROOT, "packages", "core", "src", "presets", "enrichment.tier0.data.json");

const TIER0_TRUNCATE = { etymology: 84, etymologyZh: 384, wordPartsNote: 32 };

console.log("读取 OE 源 + Tier 0 富化包 …");
const { entries: oeEntries } = loadOpenEtymology(OE_DIR);
console.log(`OE 词条：${oeEntries.size}`);

const enrichRaw = readFileSync(TIER0_ENRICH_JSON, "utf-8");
const enrich = JSON.parse(enrichRaw);
console.log(`当前富化包 version=${enrich.version}, entries=${enrich.entries.length}`);

let wpRestored = 0;
let wpTruncated = 0;
let etyZhRestored = 0;
let etyZhTruncated = 0;
let unchanged = 0;

for (const rec of enrich.entries) {
  const term = rec[0];
  const oe = oeEntries.get(term.toLowerCase());
  if (!oe) continue;
  // wordParts
  if (oe.wordParts) {
    const newWp = trimWordPartsNote(oe.wordParts, TIER0_TRUNCATE.wordPartsNote);
    if (newWp !== rec[7]) {
      if (newWp.length > rec[7].length) wpRestored += 1;
      else wpTruncated += 1;
      rec[7] = newWp;
    } else {
      unchanged += 1;
    }
  }
  // etymologyZh
  if (oe.etymologyZh) {
    const newEtyZh = truncateAtBoundary(oe.etymologyZh, TIER0_TRUNCATE.etymologyZh, "zh");
    if (newEtyZh !== rec[8]) {
      if (newEtyZh.length > rec[8].length) etyZhRestored += 1;
      else etyZhTruncated += 1;
      rec[8] = newEtyZh;
    } else {
      unchanged += 1;
    }
  }
}

enrich.version = "1.3.0";
// 一次性回填：固定 generatedAt 让产物可复现（Oscar 评审 nit #5）。
// 当前值与首次提交 v1.3.0 时的产物对齐；重跑本脚本产物字节不变。
// 如需"重跑即更新"的语义，把这一行换成 `new Date().toISOString()`。
enrich.generatedAt = "2026-08-19T14:31:07.309Z";

const outJson = JSON.stringify(enrich);
writeFileSync(TIER0_ENRICH_JSON, outJson, "utf-8");

import zlib from "node:zlib";
const brotliBytes = zlib.brotliCompressSync(Buffer.from(outJson), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;
const rawBytes = Buffer.byteLength(outJson);

console.log("");
console.log("回填统计：");
console.log(`  wordParts  恢复（变长）: ${wpRestored}`);
console.log(`  wordParts  截断（变短）: ${wpTruncated}`);
console.log(`  etymologyZh 恢复（变长）: ${etyZhRestored}`);
console.log(`  etymologyZh 截断（变短）: ${etyZhTruncated}`);
console.log(`  无变化条目: ${unchanged}`);
console.log("");
console.log(`新 version=${enrich.version}, entries=${enrich.entries.length}`);
console.log(`原始字节: ${rawBytes} (${(rawBytes/1024/1024).toFixed(2)} MB)`);
console.log(`Brotli-11: ${brotliBytes} (${(brotliBytes/1024).toFixed(1)} KB), headroom: ${1024*1024 - brotliBytes} bytes`);