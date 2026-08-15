/**
 * RAY-258 范围 2 + RAY-262：预设词表打包脚本
 * （清洗 → 分级 Tier 0/1/2 → 生成内置数据；词书库拆分 → books.data.json）。
 *
 * 用法：
 *   node scripts/presets/build.mjs --tier 0        # 默认：Tier 0（内置核心）
 *   node scripts/presets/build.mjs --tier 1        # Tier 1（扩展包产物，不入库）
 *   node scripts/presets/build.mjs --tier 2        # Tier 2（全量产物，不入库）
 *   node scripts/presets/build.mjs --books         # 考试分级词书库（books.data.json，提交进仓库）
 *   node scripts/presets/build.mjs --tier 0 --books  # 两者都构建（清洗只跑一遍）
 *
 * 产物：
 *   Tier 0 → packages/core/src/presets/tier0.data.json（提交进仓库，随 PWA 打包）
 *   Tier 1/2 → scripts/presets/output/tierN.json（git 忽略，供后续扩展包分发）
 *   词书库 → packages/core/src/presets/books.data.json（提交进仓库，随 PWA 打包）
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
 *
 * 词书库口径（RAY-262，Jack 2026-08-15 拍板）：
 *   - 8 本考试 tag 词书（中考/高考/四级/六级/考研/托福/雅思/GRE）：
 *     各取 ECDICT 对应考试标签词条，清洗去重（term 小写首现优先）；
 *   - 「专四冲刺」= tag ∈ {cet6,toefl} 合并去重（实测 9,137 词）；
 *   - 「专八冲刺」= tag ∈ {gre,toefl,ielts} 合并去重（实测 12,842 词），
 *     按词频（frq desc → bnc desc → term asc 确定性并列裁决）截断至与
 *     「专四冲刺」同词数（9,137，与专四冲刺同量级）；截断边界实测
 *     第 9,137 词 sack（frq=4467）与第 9,138 词 stack（frq=4466）无并列，
 *     口径稳定（详见 scripts/presets/analyze.mjs 词书统计段）；
 *   - 两条冲刺词书为「层次近似词书，非官方专四/专八名单」，命名与描述
 *     必须注明（红线）；官方词表授权不在本任务范围；
 *   - 存储：共享词条池（全部词书词条 ∪ 去重，约 1.5 万词）+
 *     每本词书 term 索引（"\n" 连接，term 无换行、无损往返）；
 *     独立打包 10 本约 5.3 MB，共享池方案约 1.5 MB（省 3.6 倍，实测）；
 *     NOTICE 无新增数据源（词书全部来自已登记的 ECDICT + NGSL 1.2）。
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
import { BOOK_DEFS, examBookDescription, selectBookEntries } from "./lib/books.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECDICT_CSV = path.join(ROOT, "scripts", "presets", ".data", "ecdict", "ecdict.csv");
const NGSL_CSV = path.join(ROOT, "scripts", "presets", "sources", "ngsl", "NGSL_12_stats.csv");
const OUTPUT_DIR = path.join(ROOT, "scripts", "presets", "output");
const TIER0_JSON = path.join(ROOT, "packages", "core", "src", "presets", "tier0.data.json");
const BOOKS_JSON = path.join(ROOT, "packages", "core", "src", "presets", "books.data.json");
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

/**
 * 构建词书库（RAY-262）：共享词条池 + 每本词书 term 索引。
 *
 * 返回 books.data.json 的内容与审计统计；共享池 = 全部词书词条 ∪
 * （term 小写去重），每条释义只存一份，独立打包省 3.6 倍体积（实测）。
 */
function buildBooks(cleaned, ngslTerms) {
  const ngslSet = new Set(ngslTerms.map((t) => t.toLowerCase()));
  const all = [...cleaned.values()];

  // 每本词书选词（口径唯一定义在 lib/books.mjs；「专八冲刺」词频截断在选词内完成）
  const bookEntriesById = selectBookEntries(all);

  // 共享池：全部词书词条 ∪ 去重（term 小写，池内词条已在清洗阶段去重）
  const poolMap = new Map();
  for (const entries of bookEntriesById.values()) {
    for (const entry of entries) {
      poolMap.set(entry.term.toLowerCase(), entry);
    }
  }
  const pool = [...poolMap.values()].sort((a, b) => a.term.localeCompare(b.term));

  const books = BOOK_DEFS.map((def) => {
    const entries = bookEntriesById.get(def.id);
    const description = def.description
      ? def.description(entries.length)
      : examBookDescription(def.tagList, entries.length);
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      description,
      // term 索引："\n" 连接（term 经 TERM_PATTERN 过滤不含换行，无损往返）
      terms: entries.map((entry) => entry.term).join("\n"),
    };
  });

  return {
    payload: {
      version: PACKAGE_VERSION,
      generatedAt: new Date().toISOString(),
      source:
        "ECDICT (MIT, © 2025 Linwei, https://github.com/skywind3000/ECDICT) + " +
        "NGSL 1.2 (CC BY-SA 4.0, Browne/Culligan/Phillips, https://www.newgeneralservicelist.com/)",
      pool: pool.map((entry) => toTuple(entry, ngslSet)),
      books,
    },
    stats: {
      poolCount: pool.length,
      books: books.map((book) => ({ id: book.id, termCount: book.terms.split("\n").length })),
    },
  };
}

function main() {
  const argv = process.argv.slice(2);
  const buildBooksRequested = argv.includes("--books");
  const tierIndex = argv.findIndex((a) => a === "--tier" || a.startsWith("--tier="));
  const rawTier =
    tierIndex >= 0
      ? argv[tierIndex].includes("=")
        ? argv[tierIndex].split("=")[1]
        : argv[tierIndex + 1]
      : "0";
  const tier = rawTier !== undefined && Number(rawTier) in TIER_DEFS ? Number(rawTier) : 0;
  const buildTierRequested = tierIndex >= 0 || !buildBooksRequested;

  console.log("读取 ECDICT 全量 CSV 并清洗 …");
  const cleaned = loadCleanedEcdict();
  const ngslTerms = readNgslTerms();
  console.log(`清洗后唯一词条：${cleaned.size}`);

  let audit = { generatedAt: new Date().toISOString() };

  if (buildTierRequested) {
    const def = TIER_DEFS[tier];
    console.log(`构建 Tier ${tier}（${def.name}）…`);
    const { entries, ngslSet } = buildTier(tier, cleaned, ngslTerms);

    const payload = {
      id: def.id,
      version: def.version,
      name: def.name,
      generatedAt: audit.generatedAt,
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
    audit = {
      ...audit,
      tier,
      packageId: def.id,
      version: def.version,
      entryCount: entries.length,
      ngslCount: ngslTerms.length,
      ngslIncluded: entries.filter((e) => ngslSet.has(e[0].toLowerCase())).length,
      outputFile: path.relative(ROOT, outFile),
      outputBytes: Buffer.byteLength(json, "utf-8"),
    };
    console.log(`NGSL 内置：${audit.ngslIncluded}/${audit.ngslCount}`);
  }

  if (buildBooksRequested) {
    console.log("构建考试分级词书库 …");
    const { payload, stats } = buildBooks(cleaned, ngslTerms);
    const json = JSON.stringify(payload);
    mkdirSync(path.dirname(BOOKS_JSON), { recursive: true });
    writeFileSync(BOOKS_JSON, json, "utf-8");
    console.log(
      `已写入 ${path.relative(ROOT, BOOKS_JSON)}（池 ${stats.poolCount} 词条 / ${stats.books.length} 本词书，${(Buffer.byteLength(json) / 1024).toFixed(0)} KB）`,
    );
    for (const book of stats.books) {
      console.log(`  - ${book.id}：${book.termCount} 词`);
    }
    audit = {
      ...audit,
      books: {
        poolCount: stats.poolCount,
        bookCount: stats.books.length,
        bookTermCounts: Object.fromEntries(stats.books.map((b) => [b.id, b.termCount])),
        outputFile: path.relative(ROOT, BOOKS_JSON),
        outputBytes: Buffer.byteLength(json, "utf-8"),
      },
    };
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(LAST_BUILD, `${JSON.stringify(audit, null, 2)}\n`, "utf-8");
  console.log(`审计记录：${path.relative(ROOT, LAST_BUILD)}`);
}

// 防误用：词条形状校验在清洗层（lib/ecdict.mjs）统一执行，本文件只做分级与生成。
main();
