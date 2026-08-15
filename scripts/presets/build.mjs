/**
 * RAY-258 范围 2：预设词表打包脚本（清洗 → 分级 Tier 0/1/2 → 生成内置数据）。
 *
 * 用法：
 *   node scripts/presets/build.mjs --tier 0        # 默认：Tier 0（内置核心）
 *   node scripts/presets/build.mjs --tier 1        # Tier 1（扩展包产物，不入库）
 *   node scripts/presets/build.mjs --tier 2        # Tier 2（全量产物，不入库）
 *
 * 产物：
 *   Tier 0 → packages/core/src/presets/tier0.data.json（提交进仓库，随 PWA 打包）
 *   Tier 1/2 → scripts/presets/output/tierN.json（git 忽略，供后续扩展包分发）
 *   每次构建同步写入 scripts/presets/output/last-build.json（来源哈希与统计，供审计）
 *
 * 口径（RAY-258）：
 *   - Tier 0：ECDICT tag ∈ {zk,gk,cet4,cet6} ∪ NGSL 1.2（join ECDICT 补释义）；
 *   - Tier 1：全考试标签 ∪ collins>0 ∪ oxford>0 ∪ 词频>0（约 5.8 万条，实测）；
 *   - Tier 2：清洗后的全部合法词条（约 40 万条）。
 *   - 释义清洗：换行 → 全角分号；超长按 500 字符在「；」边界截断；
 *     短语/词缀/非英语词条按 core 侧 TERM_PATTERN 过滤；term 小写去重首现优先。
 *   - 生成格式为紧凑元组数组 [term, definitions, pos, ipa, tags]，
 *     definitions 以换行符（"\n"）连接——清洗阶段（normalizeTranslation）
 *     已保证释义文本内不含真实换行与字面 "\n"，换行连接是唯一无损分隔符；
 *     全角分号（「；」）可能在释义文本内出现，若沿用会二次切分
 *     （RAY-260 评审 nit 3）。由 packages/core/src/presets/tier0.ts
 *     在运行时按 "\n" 切回并转成类型化模型。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  cleanEcdictRow,
  hasExamTag,
  isTier1Core,
  parseCsv,
  parseEcdictRow,
  TIER0_ECDICT_TAGS,
  TIER1_ECDICT_TAGS,
} from "./lib/ecdict.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECDICT_CSV = path.join(ROOT, "scripts", "presets", ".data", "ecdict", "ecdict.csv");
const NGSL_CSV = path.join(ROOT, "scripts", "presets", "sources", "ngsl", "NGSL_12_stats.csv");
const OUTPUT_DIR = path.join(ROOT, "scripts", "presets", "output");
const TIER0_JSON = path.join(ROOT, "packages", "core", "src", "presets", "tier0.data.json");
const LAST_BUILD = path.join(OUTPUT_DIR, "last-build.json");

/** 打包版本：来源数据固定（ECDICT commit + NGSL 1.2），版本随内容变更递增 */
const PACKAGE_VERSION = "1.0.0";

const TIER_DEFS = {
  0: {
    id: "core-en-tier0",
    name: "核心词表（中考/高考/四级/六级 + 高频）",
    version: PACKAGE_VERSION,
    predicate: (entry) => hasExamTag(entry, TIER0_ECDICT_TAGS),
  },
  1: {
    id: "core-en-tier1",
    name: "标准词表（全考试 + 核心词频）",
    version: PACKAGE_VERSION,
    predicate: (entry) => hasExamTag(entry, TIER1_ECDICT_TAGS) || isTier1Core(entry),
  },
  2: {
    id: "core-en-tier2",
    name: "全量词表（清洗后全部词条）",
    version: PACKAGE_VERSION,
    predicate: () => true,
  },
};

function readNgslTerms() {
  const rows = parseCsv(readFileSync(NGSL_CSV, "utf-8"));
  return rows
    .slice(1)
    .map((cells) => (cells[0] ?? "").trim())
    .filter((t) => t !== "");
}

function loadCleanedEcdict() {
  const rows = parseCsv(readFileSync(ECDICT_CSV, "utf-8"));
  const cleaned = new Map();
  for (const cells of rows.slice(1)) {
    const result = cleanEcdictRow(parseEcdictRow(cells));
    if ("entry" in result) {
      const key = result.entry.term.toLowerCase();
      if (!cleaned.has(key)) {
        cleaned.set(key, result.entry);
      }
    }
  }
  return cleaned;
}

/** 生成紧凑元组条目；NGSL 词追加「高频」标签 */
function toTuple(entry, ngslSet) {
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
}

function buildTier(tier, cleaned, ngslTerms) {
  const ngslSet = new Set(ngslTerms.map((t) => t.toLowerCase()));
  const selected = [...cleaned.values()].filter(TIER_DEFS[tier].predicate);
  const selectedSet = new Set(selected.map((e) => e.term.toLowerCase()));
  if (tier === 0) {
    // NGSL 词 join 进来补释义（覆盖率由 verify-quality.mjs 把关）
    for (const term of ngslTerms) {
      const key = term.toLowerCase();
      if (!selectedSet.has(key) && cleaned.has(key)) {
        selected.push(cleaned.get(key));
      }
    }
  }
  selected.sort((a, b) => a.term.localeCompare(b.term));
  const entries = selected.map((entry) => toTuple(entry, ngslSet));
  return { entries, ngslSet };
}

function main() {
  const argv = process.argv.slice(2);
  const tierIndex = argv.findIndex((a) => a === "--tier" || a.startsWith("--tier="));
  const rawTier =
    tierIndex >= 0
      ? argv[tierIndex].includes("=")
        ? argv[tierIndex].split("=")[1]
        : argv[tierIndex + 1]
      : "0";
  const tier = rawTier !== undefined && Number(rawTier) in TIER_DEFS ? Number(rawTier) : 0;
  const def = TIER_DEFS[tier];

  console.log(`构建 Tier ${tier}（${def.name}）…`);
  const cleaned = loadCleanedEcdict();
  const ngslTerms = readNgslTerms();
  const { entries, ngslSet } = buildTier(tier, cleaned, ngslTerms);

  const payload = {
    id: def.id,
    version: def.version,
    name: def.name,
    generatedAt: new Date().toISOString(),
    source:
      "ECDICT (MIT, © 2025 Linwei, https://github.com/skywind3000/ECDICT) + " +
      "NGSL 1.2 (CC BY-SA 4.0, Browne/Culligan/Phillips, https://www.newgeneralservicelist.com/)",
    entries,
  };
  const json = JSON.stringify(payload);

  const outFile = tier === 0 ? TIER0_JSON : path.join(OUTPUT_DIR, `tier${tier}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, json, "utf-8");
  console.log(
    `已写入 ${path.relative(ROOT, outFile)}（${entries.length} 词条，${(Buffer.byteLength(json) / 1024).toFixed(0)} KB）`,
  );

  // 构建审计记录（来源哈希 + 统计），便于发版核对
  const audit = {
    tier,
    packageId: def.id,
    version: def.version,
    generatedAt: payload.generatedAt,
    entryCount: entries.length,
    ngslCount: ngslTerms.length,
    ngslIncluded: entries.filter((e) => ngslSet.has(e[0].toLowerCase())).length,
    outputFile: path.relative(ROOT, outFile),
    outputBytes: Buffer.byteLength(json, "utf-8"),
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(LAST_BUILD, `${JSON.stringify(audit, null, 2)}\n`, "utf-8");
  console.log(`审计记录：${path.relative(ROOT, LAST_BUILD)}`);
  console.log(`NGSL 内置：${audit.ngslIncluded}/${audit.ngslCount}`);
}

// 防误用：词条形状校验在清洗层（lib/ecdict.mjs）统一执行，本文件只做分级与生成。
main();
