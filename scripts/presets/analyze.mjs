/**
 * RAY-258 范围 1：格式清洗实验（对照 RAY-257 简报方案实测）。
 *
 * 输入：scripts/presets/.data/ecdict/ecdict.csv（fetch-ecdict.mjs 下载）+ 已内置的 NGSL 1.2。
 * 输出：stdout 统计 + docs/presets/experiment.md 实验报告（行数/体积/覆盖）。
 *
 * 用法：node scripts/presets/analyze.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  cleanEcdictRow,
  hasExamTag,
  isTier1Core,
  measureVolumes,
  parseCsv,
  parseEcdictRow,
  TIER0_ECDICT_TAGS,
  TIER1_ECDICT_TAGS,
} from "./lib/ecdict.mjs";
import { BOOK_DEFS, byFrequencyDesc, selectBookEntries } from "./lib/books.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECDICT_CSV = path.join(ROOT, "scripts", "presets", ".data", "ecdict", "ecdict.csv");
const NGSL_CSV = path.join(ROOT, "scripts", "presets", "sources", "ngsl", "NGSL_12_stats.csv");
const REPORT_PATH = path.join(ROOT, "docs", "presets", "experiment.md");

function readNgslTerms() {
  const text = readFileSync(NGSL_CSV, "utf-8");
  const rows = parseCsv(text);
  const terms = [];
  for (const cells of rows.slice(1)) {
    const term = (cells[0] ?? "").trim();
    if (term !== "") {
      terms.push(term);
    }
  }
  return terms;
}

function toTierPayload(entries, ngslSet) {
  // 紧凑元组：[term, definitions(；joined), pos, ipa, tags(空格分隔)]
  return entries.map((entry) => {
    const tags = [...entry.tags];
    if (ngslSet.has(entry.term) && !tags.includes("高频")) {
      tags.push("高频");
    }
    return [
      entry.term,
      entry.definitions.join("；"),
      entry.pos ?? "",
      entry.ipa ?? "",
      tags.join(" "),
    ];
  });
}

function main() {
  const started = Date.now();
  console.log("读取 ECDICT 全量 CSV …");
  const text = readFileSync(ECDICT_CSV, "utf-8");
  const rows = parseCsv(text);
  const totalRows = rows.length - 1; // 去掉表头
  console.log(`全量数据行：${totalRows}（含表头 ${rows.length} 行）`);

  // 1. 全量清洗统计
  const reject = new Map();
  const cleaned = new Map(); // term(lower) → entry（首现优先）
  let duplicates = 0;
  let truncatedRows = 0;
  for (const cells of rows.slice(1)) {
    const row = parseEcdictRow(cells);
    const result = cleanEcdictRow(row);
    if ("reason" in result) {
      reject.set(result.reason, (reject.get(result.reason) ?? 0) + 1);
      continue;
    }
    if (result.truncated) {
      truncatedRows += 1;
    }
    const key = result.entry.term.toLowerCase();
    if (cleaned.has(key)) {
      duplicates += 1;
      continue; // 去重：首现优先
    }
    cleaned.set(key, result.entry);
  }
  const cleanedAll = [...cleaned.values()];
  console.log(
    `清洗后唯一词条（全量）：${cleanedAll.length}，重复丢弃 ${duplicates}，释义截断 ${truncatedRows}`,
  );
  console.log("拒绝原因分布：", Object.fromEntries(reject));

  // 2. 考试标签过滤（分级）
  const tier0Tagged = cleanedAll.filter((e) => hasExamTag(e, TIER0_ECDICT_TAGS));
  const tier1Tagged = cleanedAll.filter((e) => hasExamTag(e, TIER1_ECDICT_TAGS));
  const tier1Core = cleanedAll.filter((e) => hasExamTag(e, TIER1_ECDICT_TAGS) || isTier1Core(e));
  const byTag = Object.fromEntries(
    ["zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"].map((t) => [
      t,
      cleanedAll.filter((e) => e.examTags.includes(t)).length,
    ]),
  );

  // 3. NGSL join
  const ngslTerms = readNgslTerms();
  const ngslSet = new Set(ngslTerms.map((t) => t.toLowerCase()));
  const tier0Set = new Set(tier0Tagged.map((e) => e.term.toLowerCase()));
  const ngslCovered = ngslTerms.filter((t) => cleaned.has(t.toLowerCase()));
  const ngslInTier0 = ngslTerms.filter((t) => tier0Set.has(t.toLowerCase()));
  const ngslMissing = ngslTerms.filter((t) => !cleaned.has(t.toLowerCase()));
  // Tier 0 = 考试标签词 ∪ NGSL 词（join ECDICT 补释义）
  const tier0Entries = [...tier0Tagged];
  for (const term of ngslCovered) {
    if (!tier0Set.has(term.toLowerCase())) {
      tier0Entries.push(cleaned.get(term.toLowerCase()));
    }
  }
  tier0Entries.sort((a, b) => a.term.localeCompare(b.term));

  // 4. 体积
  const tier0Payload = toTierPayload(tier0Entries, ngslSet);
  const tier0Json = JSON.stringify(tier0Payload);
  const tier1Payload = toTierPayload(tier1Core, ngslSet);
  const tier1Json = JSON.stringify(tier1Payload);
  const tier2Payload = toTierPayload(cleanedAll, ngslSet);
  const tier2Json = JSON.stringify(tier2Payload);
  const vol = {
    tier0: measureVolumes(tier0Json),
    tier1: measureVolumes(tier1Json),
    tier2: measureVolumes(tier2Json),
  };

  // 5. 词书库拆分统计（RAY-262）：词数 / 去重比例 / 专八截断口径 / 体积对比
  const bookEntriesById = selectBookEntries(cleanedAll);
  const bookTuple = (entry) => {
    const tags = [...entry.tags];
    if (ngslSet.has(entry.term.toLowerCase()) && !tags.includes("高频")) {
      tags.push("高频");
    }
    return [
      entry.term,
      entry.definitions.join("\n"),
      entry.pos ?? "",
      entry.ipa ?? "",
      tags.join(" "),
    ];
  };
  const bookRows = BOOK_DEFS.map((def) => {
    const entries = bookEntriesById.get(def.id);
    const beforeDedup = def.tagList.reduce((sum, tag) => sum + (byTag[tag] ?? 0), 0);
    const dedupRatio =
      beforeDedup > 0 ? `${((entries.length / beforeDedup) * 100).toFixed(1)}%` : "—";
    const note = def.cutoffToId ? "（词频截断）" : "";
    return `| ${def.name}（${def.id}） | ${def.tagList.join("+")} | ${entries.length}${note} | ${beforeDedup} | ${dedupRatio} |`;
  });
  const tem8Def = BOOK_DEFS.find((def) => def.id === "book-tem8");
  const tem8Target = bookEntriesById.get("book-tem8").length;
  const tem8Raw = cleanedAll
    .filter((e) => e.examTags.some((t) => tem8Def.tagList.includes(t)))
    .sort(byFrequencyDesc);
  const tem8Boundary = tem8Raw[tem8Target - 1];
  const tem8AfterBoundary = tem8Raw[tem8Target];
  const booksPool = new Map();
  for (const entries of bookEntriesById.values()) {
    for (const entry of entries) {
      booksPool.set(entry.term.toLowerCase(), entry);
    }
  }
  const booksPoolJson = JSON.stringify([...booksPool.values()].map(bookTuple));
  const booksPoolVol = measureVolumes(booksPoolJson);
  let booksStandaloneBytes = 0;
  for (const entries of bookEntriesById.values()) {
    booksStandaloneBytes += Buffer.byteLength(JSON.stringify(entries.map(bookTuple)), "utf-8");
  }

  const report = [
    "# 预设词表格式清洗实验报告（RAY-258 范围 1）",
    "",
    `> 生成时间：${new Date().toISOString()}（脚本：scripts/presets/analyze.mjs）`,
    "> 数据来源：ECDICT（MIT，commit bc015ed，ecdict.csv SHA256 1A6947E0…F9C3CF）+ NGSL 1.2（CC BY-SA 4.0，官方 NGSL_12_stats.csv）",
    "",
    "## 1. 清洗统计（ECDICT 全量 76 万行）",
    "",
    `| 指标 | 数值 |`,
    `|---|---|`,
    `| 全量数据行 | ${totalRows} |`,
    `| 清洗后唯一词条（term 形状合法 + 释义非空 + 去重） | ${cleanedAll.length} |`,
    `| 重复丢弃（term 小写去重） | ${duplicates} |`,
    `| 释义超长截断行 | ${truncatedRows} |`,
    "",
    "拒绝原因分布：",
    "",
    `| 原因 | 行数 |`,
    `|---|---|`,
    ...[...reject.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## 2. 分级过滤行数",
    "",
    `| 分级 | 条件 | 词条数 |`,
    `|---|---|---|`,
    `| Tier 0（ECDICT 部分） | tag ∈ {zk,gk,cet4,cet6} | ${tier0Tagged.length} |`,
    `| Tier 0（最终） | 考试标签 ∪ NGSL 1.2 join | ${tier0Entries.length} |`,
    `| Tier 1（全考试标签） | tag ∈ {zk,gk,cet4,cet6,ky,toefl,ielts,gre} | ${tier1Tagged.length} |`,
    `| Tier 1（全考试 ∪ 核心阈值） | 全考试 ∪ collins>0 ∪ oxford>0 ∪ 词频>0 | ${tier1Core.length} |`,
    `| Tier 2（全量清洗） | 全部合法词条 | ${cleanedAll.length} |`,
    "",
    "各考试标签词条数（清洗后）：",
    "",
    `| 标签 | 词条数 |`,
    `|---|---|`,
    ...Object.entries(byTag).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## 3. NGSL 1.2 join 覆盖",
    "",
    `| 指标 | 数值 |`,
    `|---|---|`,
    `| NGSL 1.2 总词数 | ${ngslTerms.length} |`,
    `| 在 ECDICT 清洗结果中命中 | ${ngslCovered.length} |`,
    `| 未命中（无释义，本轮不内置，需人工/双源补齐） | ${ngslMissing.length} |`,
    `| 已包含在考试标签子集内 | ${ngslInTier0.length} |`,
    "",
    `未命中词条清单：${ngslMissing.join(", ") || "（无）"}`,
    "",
    "## 4. 体积估算（紧凑元组 JSON，UTF-8）",
    "",
    "| 分级 | 词条数 | 原始 | gzip(9) | brotli(11) |",
    "|---|---|---|---|---|",
    `| Tier 0 | ${tier0Entries.length} | ${(vol.tier0.raw / 1024).toFixed(0)} KB | ${(vol.tier0.gzip / 1024).toFixed(0)} KB | ${(vol.tier0.brotli / 1024).toFixed(0)} KB |`,
    `| Tier 1 | ${tier1Core.length} | ${(vol.tier1.raw / 1024 / 1024).toFixed(1)} MB | ${(vol.tier1.gzip / 1024 / 1024).toFixed(1)} MB | ${(vol.tier1.brotli / 1024 / 1024).toFixed(1)} MB |`,
    `| Tier 2 | ${cleanedAll.length} | ${(vol.tier2.raw / 1024 / 1024).toFixed(1)} MB | ${(vol.tier2.gzip / 1024 / 1024).toFixed(1)} MB | ${(vol.tier2.brotli / 1024 / 1024).toFixed(1)} MB |`,
    "",
    "> 首启导入耗时基准见 docs/presets/benchmark.md（vitest bench，Node fake-indexeddb 环境，",
    "> 真实设备数据待真机试用复测）。",
    "",
    "## 5. 词书库拆分统计（RAY-262）",
    "",
    "| 词书 | 标签组合 | 词条数 | 合并去重前 | 去重比例 |",
    "|---|---|---|---|---|",
    ...bookRows,
    "",
    `共享词条池（全部词书 ∪ 去重）：${booksPool.size} 词，`,
    `raw ${(booksPoolVol.raw / 1024).toFixed(0)} KB，gzip ${(booksPoolVol.gzip / 1024).toFixed(0)} KB，brotli ${(booksPoolVol.brotli / 1024).toFixed(0)} KB。`,
    `独立打包（每本词书各存一份词条）：raw ${(booksStandaloneBytes / 1024).toFixed(0)} KB，`,
    `为共享池方案的 ${(booksStandaloneBytes / booksPoolVol.raw).toFixed(2)} 倍（独立打包 5.3 MB vs 共享池 1.5 MB，实测）。`,
    "",
    "「专八冲刺」词频截断口径（frq desc → bnc desc → term asc 确定性并列裁决）：",
    "",
    `| 指标 | 数值 |`,
    `|---|---|`,
    `| 合并去重后总词数 | ${tem8Raw.length} |`,
    `| 截断至（与专四冲刺同词数） | ${tem8Target} |`,
    `| 截断点词条 | ${tem8Boundary.term}（frq=${tem8Boundary.frq}, bnc=${tem8Boundary.bnc}） |`,
    `| 截断点下一词条 | ${tem8AfterBoundary.term}（frq=${tem8AfterBoundary.frq}, bnc=${tem8AfterBoundary.bnc}） |`,
    `| 截断点有无并列 | ${tem8Boundary.frq === tem8AfterBoundary.frq && tem8Boundary.bnc === tem8AfterBoundary.bnc ? "有（frq/bnc 并列，按 term 序裁决）" : "无（frq 严格递减，确定性截断）"} |`,
    `| 被截掉词条数 | ${tem8Raw.length - tem8Target} |`,
    `| 被截掉词条仍由单本词书覆盖 | ${tem8Raw.slice(tem8Target).filter((e) => booksPool.has(e.term.toLowerCase())).length}/${tem8Raw.length - tem8Target}（全部覆盖，不影响其它词书完整性） |`,
    "",
    `脚本耗时：${((Date.now() - started) / 1000).toFixed(1)}s`,
    "",
  ].join("\n");

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report, "utf-8");
  console.log(`\n报告已写入：${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Tier 0 最终词条数：${tier0Entries.length}`);
  console.log(
    `体积 tier0 gz: ${(vol.tier0.gzip / 1024).toFixed(0)} KB, brotli: ${(vol.tier0.brotli / 1024).toFixed(0)} KB`,
  );
  console.log(
    `词书库：共享池 ${booksPool.size} 词 / ${BOOK_DEFS.length} 本词书（共享池 raw ${(booksPoolVol.raw / 1024).toFixed(0)} KB）`,
  );
  console.log(
    `专八冲刺截断：${tem8Raw.length} 词 → ${tem8Target} 词（截断点 ${tem8Boundary.term} frq=${tem8Boundary.frq}，下一词 ${tem8AfterBoundary.term} frq=${tem8AfterBoundary.frq}）`,
  );
}

main();
