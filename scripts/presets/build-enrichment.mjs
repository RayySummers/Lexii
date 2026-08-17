/**
 * RAY-268 批次 A：富化数据构建管线（单条统一管线，RAY-257 富化管线合并口径）。
 *
 * 一源四域（kaikki/Wiktionary：例句 / 近反义 / 派生 / 词源 / 双音标校验）
 * + Tatoeba 双语例句 + OpenEtymology 词根词缀中文 + ipa-dict 双音标主力，
 * 按 Tier 0 / Tier 1 词表裁剪，产物为富化 JSON 包：
 *
 *   Tier 0 → packages/core/src/presets/enrichment.tier0.data.json（随 PWA 打包）
 *   Tier 1 → scripts/presets/output/enrichment.tier1.json（扩展包产物，不入库）
 *   报告   → scripts/presets/output/enrichment-report.json（三项实验数据）
 *
 * 前置：先跑各 fetch-*.mjs 下载数据（.data/ 缓存）；Tier 1 词表按
 * ECDICT 分级口径现场计算（与 build.mjs 同 lib，不依赖其产物）。
 *
 * 字段优先级（RAY-267 拍板口径）：
 *   - 双音标：ipa-dict 为主力 → kaikki sounds 补缺 → OpenEtymology 补缺；
 *   - 例句：Tatoeba 句对（含中文译文）优先，kaikki 英文原句补足至 3 条
 *     （quotation 过滤：仅 type === "example"，RAY-257 既定口径）；
 *   - 词根词缀/中文词源：OpenEtymology；英文词源文本：kaikki etymology_text。
 *
 * 产物条目为紧凑元组（term, ipaUs, ipaUk, synonyms, antonyms, derived,
 * etymology, wordParts, etymologyZh, examples），全字符串 + 字符串数组；
 * 词表内无任何富化字段的词条不产出记录（运行时按缺失处理）。
 */
import { createReadStream, existsSync } from "node:fs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  cleanEcdictRow,
  hasExamTag,
  isTier1Core,
  parseCsv,
  parseEcdictRow,
  TIER1_ECDICT_TAGS,
} from "./lib/ecdict.mjs";
import { extractKaikkiLine, mergeKaikkiEntry } from "./lib/kaikki.mjs";
import { parseIpaDict } from "./lib/ipadict.mjs";
import { loadOpenEtymology } from "./lib/openetymology.mjs";
import { buildPairPool, indexPairs, pairsForTerm, readTsvLines } from "./lib/tatoeba.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA_DIR = path.join(ROOT, "scripts", "presets", ".data");
const OUTPUT_DIR = path.join(ROOT, "scripts", "presets", "output");
const TIER0_JSON = path.join(ROOT, "packages", "core", "src", "presets", "tier0.data.json");
const TIER0_ENRICHMENT_JSON = path.join(
  ROOT,
  "packages",
  "core",
  "src",
  "presets",
  "enrichment.tier0.data.json",
);
const KAIKKI_FILE = path.join(DATA_DIR, "kaikki", "kaikki.org-dictionary-English.jsonl");

/** 富化包版本：来源快照固定后版本随内容变更递增 */
const ENRICHMENT_VERSION = "1.2.0";

/**
 * 每词上限与文本截断——Tier 0 / Tier 1 两档体积口径：
 * Tier 0 首启包 brotli < 1MB（实测收敛值）；Tier 1 扩展包 3–8MB
 * （余量充足，保留完整内容：例句 3 条、列表 8/8/12、词源不截）。
 */
const TIER0_CAPS = { examples: 2, synonyms: 3, antonyms: 3, derived: 2 };
const TIER0_TRUNCATE = { etymology: 84, etymologyZh: 64, wordPartsNote: 8 };
const TIER1_CAPS = { examples: 3, synonyms: 8, antonyms: 8, derived: 12 };
const TIER1_TRUNCATE = { etymology: 400, etymologyZh: 400, wordPartsNote: 64 };

/** 按 Unicode 码点截断（中文按字计，避免代理对截半） */
function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return [...text].slice(0, maxChars).join("");
}

/** wordParts 词缀注释截断（词根词缀名保留，注释限 maxNote 字） */
function trimWordPartsNote(wordParts, maxNote) {
  if (!wordParts) {
    return "";
  }
  return wordParts
    .split(" · ")
    .map((part) => {
      const match = part.match(/^(.*?)<([^>]*)>$/);
      if (!match) {
        return part;
      }
      return `${match[1]}<${truncateText(match[2], maxNote)}>`;
    })
    .join(" · ");
}

const SOURCE_DECLARATION =
  "Wiktionary（kaikki.org 提取，CC BY-SA 4.0 + GFDL）+ Tatoeba（CC BY 2.0 FR，含 CC0 子集）" +
  " + OpenEtymology 单词本数据（CC BY-SA 4.0）+ ipa-dict en_US（MIT）/ en_UK（GPL-3.0）";

/** 读 Tier 0 词条表（terms 取自已提交的 tier0.data.json，与运行时一致；
 *  小写规范化——tier0.data.json 含 118 个专有名词/缩写原形词条，而
 *  kaikki / ipa-dict / OpenEtymology 均以小写为键） */
function readTier0Terms() {
  const raw = JSON.parse(readFileSync(TIER0_JSON, "utf-8"));
  return [...new Set(raw.entries.map((entry) => entry[0].toLowerCase()))];
}

/** Tier 1 词表：与 build.mjs --tier 1 同口径（全考试标签 ∪ collins/oxford/词频核心） */
function computeTier1Terms() {
  const csv = path.join(DATA_DIR, "ecdict", "ecdict.csv");
  const terms = new Set();
  for (const cells of parseCsv(readFileSync(csv, "utf-8")).slice(1)) {
    const result = cleanEcdictRow(parseEcdictRow(cells));
    if (!("entry" in result)) continue;
    const entry = result.entry;
    if (hasExamTag(entry, TIER1_ECDICT_TAGS) || isTier1Core(entry)) {
      terms.add(entry.term.toLowerCase());
    }
  }
  return [...terms];
}

/** 流式抽取 kaikki：仅提取目标词表命中的行，逐行 JSON.parse（3.2GB 不入内存） */
async function extractKaikkiForTerms(termSet) {
  const byWord = new Map();
  let parsed = 0;
  let parseErrors = 0;
  let matched = 0;
  const rl = createInterface({ input: createReadStream(KAIKKI_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    parsed += 1;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }
    const word = typeof obj.word === "string" ? obj.word.trim().toLowerCase() : "";
    if (!word || !termSet.has(word)) continue;
    const extracted = extractKaikkiLine(obj);
    if (!extracted) continue;
    matched += 1;
    const bucket = byWord.get(word);
    if (bucket) {
      bucket.push(extracted);
    } else {
      byWord.set(word, [extracted]);
    }
  }
  console.log(
    `kaikki 流式抽取完成：解析 ${parsed} 行（错误 ${parseErrors}），命中目标词表 ${matched} 行 / ${byWord.size} 词`,
  );
  return { byWord, parseErrors };
}

/** 组装单词语义富化记录（源优先级见文件头；caps/truncate 按 tier 档传入） */
function buildEnrichmentRecord(
  term,
  { kaikki, ipaUsDict, ipaUkDict, oe, tatoebaPairs },
  caps,
  truncate,
) {
  const ipaUs = ipaUsDict.get(term) ?? kaikki.ipaUs ?? oe?.ipaUs ?? "";
  const ipaUk = ipaUkDict.get(term) ?? kaikki.ipaUk ?? oe?.ipaUk ?? "";
  const examples = [];
  for (const pair of tatoebaPairs) {
    examples.push([pair.text, pair.translation]);
    if (examples.length >= caps.examples) break;
  }
  // 无句对词补 1 条 kaikki 英文例句兜底（例句形态决策门：中英句对首发，
  // 英文例句仅作无句对词的垫底，不补满上限——Tier 0 体积口径实测收敛值）
  if (examples.length === 0 && kaikki.examples.length > 0) {
    examples.push([kaikki.examples[0], ""]);
  }
  return [
    term,
    ipaUs,
    ipaUk,
    kaikki.synonyms.slice(0, caps.synonyms).join("\n"),
    kaikki.antonyms.slice(0, caps.antonyms).join("\n"),
    kaikki.derived.slice(0, caps.derived).join("\n"),
    truncateText(kaikki.etymology, truncate.etymology),
    trimWordPartsNote(oe?.wordParts ?? "", truncate.wordPartsNote),
    truncateText(oe?.etymologyZh ?? "", truncate.etymologyZh),
    examples,
  ];
}

/** 词表 × 富化域覆盖率统计 */
function coverageStats(terms, recordFor) {
  const domainCounts = {
    ipaUs: 0,
    ipaUk: 0,
    ipaEither: 0,
    synonyms: 0,
    antonyms: 0,
    derived: 0,
    etymology: 0,
    wordParts: 0,
    etymologyZh: 0,
    examplesAny: 0,
    examplesBilingual: 0,
    anyField: 0,
  };
  let examplePairs = 0;
  const perWordExamples = [];
  for (const term of terms) {
    const record = recordFor(term);
    if (!record) continue;
    const [
      ,
      ipaUs,
      ipaUk,
      synonyms,
      antonyms,
      derived,
      etymology,
      wordParts,
      etymologyZh,
      examples,
    ] = record;
    const hasIpaUs = ipaUs !== "";
    const hasIpaUk = ipaUk !== "";
    if (hasIpaUs) domainCounts.ipaUs += 1;
    if (hasIpaUk) domainCounts.ipaUk += 1;
    if (hasIpaUs || hasIpaUk) domainCounts.ipaEither += 1;
    if (synonyms !== "") domainCounts.synonyms += 1;
    if (antonyms !== "") domainCounts.antonyms += 1;
    if (derived !== "") domainCounts.derived += 1;
    if (etymology !== "") domainCounts.etymology += 1;
    if (wordParts !== "") domainCounts.wordParts += 1;
    if (etymologyZh !== "") domainCounts.etymologyZh += 1;
    if (examples.length > 0) {
      domainCounts.examplesAny += 1;
      if (examples.some(([, zh]) => zh !== "")) domainCounts.examplesBilingual += 1;
      examplePairs += examples.length;
    }
    perWordExamples.push(examples.length);
    if (
      hasIpaUs ||
      hasIpaUk ||
      synonyms !== "" ||
      antonyms !== "" ||
      derived !== "" ||
      etymology !== "" ||
      wordParts !== "" ||
      etymologyZh !== "" ||
      examples.length > 0
    ) {
      domainCounts.anyField += 1;
    }
  }
  const total = terms.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return {
    total,
    counts: domainCounts,
    percentages: Object.fromEntries(Object.entries(domainCounts).map(([k, v]) => [k, pct(v)])),
    avgPairsPerWord: perWordExamples.length > 0 ? examplePairs / perWordExamples.length : 0,
    wordsWithPairs: perWordExamples.filter((n) => n > 0).length,
  };
}

/**
 * 实验一：Tatoeba 中英句对覆盖率（决策门指标：词条级 ≥1 / ≥2 / ≥3
 * 句对的占比——「中英句对首发」要求多数核心词有足量双语例句）。
 * 按句对池直接统计（limit 8），不经产物 caps 裁剪——Tier 0 产物例句
 * 上限 2 条，经产物统计会把 ≥3 恒压为 0（统计口径失真）。
 */
function tatoebaCoverageStats(terms, pairsLookup) {
  let withOne = 0;
  let withTwo = 0;
  let withThree = 0;
  let totalPairs = 0;
  for (const term of terms) {
    const bilingual = pairsLookup(term).length;
    if (bilingual >= 1) withOne += 1;
    if (bilingual >= 2) withTwo += 1;
    if (bilingual >= 3) withThree += 1;
    totalPairs += bilingual;
  }
  const total = terms.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return {
    total,
    withOnePair: { count: withOne, rate: pct(withOne) },
    withTwoPairs: { count: withTwo, rate: pct(withTwo) },
    withThreePairs: { count: withThree, rate: pct(withThree) },
    totalBilingualPairs: totalPairs,
    avgBilingualPairsPerTerm: (totalPairs / total).toFixed(2),
  };
}

/** kaikki 本域覆盖率（源域供给，未经优先级合并/产物截断——实验二口径） */
function kaikkiDomainCoverage(terms, byWord) {
  const counts = { examples: 0, synonyms: 0, antonyms: 0, derived: 0, etymology: 0, soundsIpa: 0 };
  for (const term of terms) {
    const lines = byWord.get(term);
    if (!lines) continue;
    const m = mergeKaikkiEntry(term, lines);
    if (m.examples.length > 0) counts.examples += 1;
    if (m.synonyms.length > 0) counts.synonyms += 1;
    if (m.antonyms.length > 0) counts.antonyms += 1;
    if (m.derived.length > 0) counts.derived += 1;
    if (m.etymology !== "") counts.etymology += 1;
    if (m.ipaUs !== "" || m.ipaUk !== "") counts.soundsIpa += 1;
  }
  const total = terms.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return {
    total,
    counts,
    percentages: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, pct(v)])),
  };
}

/** 与 ipa-dict 主力的双音标一致性（kaikki / OpenEtymology 各自按抽样口径汇报） */
function ipaAgreementStats(terms, ipaDict, kaikkiOrOe, label) {
  let compared = 0;
  let agree = 0;
  for (const term of terms) {
    const a = ipaDict.get(term);
    const b = kaikkiOrOe.get(term);
    if (!a || !b) continue;
    compared += 1;
    if (a === b) agree += 1;
  }
  return {
    label,
    compared,
    agree,
    agreementRate: compared > 0 ? `${((agree / compared) * 100).toFixed(1)}%` : "n/a",
  };
}

function writeJson(file, payload) {
  const json = JSON.stringify(payload);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, json, "utf-8");
  const brotliBytes = brotliCompressSync(Buffer.from(json), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  console.log(
    `已写入 ${path.relative(ROOT, file)}（${(Buffer.byteLength(json) / 1024).toFixed(0)} KB 原始 / ${(brotliBytes / 1024).toFixed(0)} KB brotli-11）`,
  );
  return { rawBytes: Buffer.byteLength(json), brotliBytes };
}

async function main() {
  // Nit RAY-300：外部数据缺失时显式跳过（exit 0），避免 CI Actions UI 出现 ❌ 观感异常。
  // 富化构建依赖 kaikki/ipa-dict/OpenEtymology/Tatoeba 四项外部数据（.data/ 目录），
  // CI 环境若未缓存这些数据，直接跳过并提示，而非抛错靠 continue-on-error 放行。
  const REQUIRED_DATA_FILES = [
    { label: "kaikki", path: path.join(DATA_DIR, "kaikki", "kaikki.org-dictionary-English.jsonl") },
    { label: "ipa-dict en_US", path: path.join(DATA_DIR, "ipa-dict", "en_US.txt") },
    { label: "ipa-dict en_UK", path: path.join(DATA_DIR, "ipa-dict", "en_UK.txt") },
    { label: "OpenEtymology", path: path.join(DATA_DIR, "openetymology") },
    { label: "ecdict", path: path.join(DATA_DIR, "ecdict", "ecdict.csv") },
    { label: "Tatoeba eng_sentences", path: path.join(DATA_DIR, "tatoeba", "eng_sentences.tsv") },
    { label: "Tatoeba cmn_sentences", path: path.join(DATA_DIR, "tatoeba", "cmn_sentences.tsv") },
    { label: "Tatoeba eng-cmn_links", path: path.join(DATA_DIR, "tatoeba", "eng-cmn_links.tsv") },
    {
      label: "Tatoeba eng_sentences_CC0",
      path: path.join(DATA_DIR, "tatoeba", "eng_sentences_CC0.tsv"),
    },
    {
      label: "Tatoeba cmn_sentences_CC0",
      path: path.join(DATA_DIR, "tatoeba", "cmn_sentences_CC0.tsv"),
    },
  ];
  const missingData = REQUIRED_DATA_FILES.filter((f) => !existsSync(f.path));
  if (missingData.length > 0) {
    console.log(
      `⏭️  跳过富化构建：缺少外部数据文件（${missingData.map((f) => f.label).join("、")}）。\n` +
        `   富化包为可选产物，需先运行各 fetch-*.mjs 下载数据到 scripts/presets/.data/ 目录。`,
    );
    return;
  }

  const t0 = Date.now();
  console.log("读取 Tier 0 词表与计算 Tier 1 词表 …");
  const tier0Terms = readTier0Terms();
  const tier1Terms = computeTier1Terms();
  const termSet = new Set([...tier0Terms, ...tier1Terms]);
  console.log(
    `Tier 0：${tier0Terms.length} 词；Tier 1：${tier1Terms.length} 词；合计 ${termSet.size} 词`,
  );

  console.log("加载 ipa-dict / OpenEtymology / Tatoeba …");
  const ipaUsDict = parseIpaDict(path.join(DATA_DIR, "ipa-dict", "en_US.txt"));
  const ipaUkDict = parseIpaDict(path.join(DATA_DIR, "ipa-dict", "en_UK.txt"));
  const { entries: oeEntries, bookStats } = loadOpenEtymology(path.join(DATA_DIR, "openetymology"));
  const tatoeba = buildPairPool({
    engLines: readTsvLines(path.join(DATA_DIR, "tatoeba", "eng_sentences.tsv")),
    cmnLines: readTsvLines(path.join(DATA_DIR, "tatoeba", "cmn_sentences.tsv")),
    linkLines: readTsvLines(path.join(DATA_DIR, "tatoeba", "eng-cmn_links.tsv")),
    cc0EngLines: readTsvLines(path.join(DATA_DIR, "tatoeba", "eng_sentences_CC0.tsv")),
    cc0CmnLines: readTsvLines(path.join(DATA_DIR, "tatoeba", "cmn_sentences_CC0.tsv")),
  });
  const tatoebaIndex = indexPairs(tatoeba.pairs);
  console.log(
    `OpenEtymology：${oeEntries.size} 词（${bookStats.map((b) => `${b.book} ${b.parsed}`).join(" / ")}）；` +
      `Tatoeba 可用句对：${tatoeba.stats.usableEngSentences}`,
  );

  console.log("流式抽取 kaikki（仅目标词表）…");
  const { byWord: kaikkiByWord, parseErrors } = await extractKaikkiForTerms(termSet);

  const makeRecordFor = (caps, truncate) => (term) => {
    const lines = kaikkiByWord.get(term);
    const kaikki = lines ? mergeKaikkiEntry(term, lines) : emptyKaikki(term);
    const oe = oeEntries.get(term);
    const pairs = pairsForTerm(tatoeba.pairs, tatoebaIndex, term, caps.examples);
    return buildEnrichmentRecord(
      term,
      { kaikki, ipaUsDict, ipaUkDict, oe, tatoebaPairs: pairs },
      caps,
      truncate,
    );
  };
  const recordForTier0 = makeRecordFor(TIER0_CAPS, TIER0_TRUNCATE);
  const recordForTier1 = makeRecordFor(TIER1_CAPS, TIER1_TRUNCATE);

  const generatedAt = new Date().toISOString();
  const tier0Records = tier0Terms.map(recordForTier0).filter((record) => hasAnyField(record));
  const tier1Records = tier1Terms.map(recordForTier1).filter((record) => hasAnyField(record));

  console.log("写入产物与实验统计 …");
  const tier0Payload = {
    id: "core-en-tier0-enrichment",
    version: ENRICHMENT_VERSION,
    name: "Tier 0 富化数据（例句/近反义/派生/词根词缀/双音标）",
    generatedAt,
    source: SOURCE_DECLARATION,
    entries: tier0Records,
  };
  const tier1Payload = {
    id: "core-en-tier1-enrichment",
    version: ENRICHMENT_VERSION,
    name: "Tier 1 富化数据（例句/近反义/派生/词根词缀/双音标）",
    generatedAt,
    source: SOURCE_DECLARATION,
    entries: tier1Records,
  };
  const tier0Size = writeJson(TIER0_ENRICHMENT_JSON, tier0Payload);
  const tier1Size = writeJson(path.join(OUTPUT_DIR, "enrichment.tier1.json"), tier1Payload);

  // 三项实验之一：Tatoeba 覆盖率（决策门：达标 → 中英句对首发；按句对池统计，不经产物 caps）
  const tatoebaCoverage = tatoebaCoverageStats(tier0Terms, (term) =>
    pairsForTerm(tatoeba.pairs, tatoebaIndex, term, 8),
  );
  // 三项实验之二：kaikki 裁剪后各域覆盖率（源域口径 + 最终优先级合并口径，Tier 0 / Tier 1 分开）
  const kaikkiTier0 = kaikkiDomainCoverage(tier0Terms, kaikkiByWord);
  const kaikkiTier1 = kaikkiDomainCoverage(tier1Terms, kaikkiByWord);
  const tier0Coverage = coverageStats(tier0Terms, recordForTier0);
  const tier1Coverage = coverageStats(tier1Terms, recordForTier1);
  // 双音标一致性（ipa-dict 主力 vs kaikki / OpenEtymology 校验源）
  const ipaAgreement = [
    ipaAgreementStats(
      tier0Terms,
      ipaUsDict,
      kaikkiUsMap(kaikkiByWord, tier0Terms),
      "kaikki US vs ipa-dict",
    ),
    ipaAgreementStats(
      tier0Terms,
      ipaUkDict,
      kaikkiUkMap(kaikkiByWord, tier0Terms),
      "kaikki UK vs ipa-dict",
    ),
    ipaAgreementStats(
      tier0Terms,
      ipaUsDict,
      new Map(
        [...oeEntries]
          .filter(([t]) => tier0Set(tier0Terms).has(t))
          .map(([t, e]) => [t, e.ipaUs ?? ""]),
      ),
      "OpenEtymology US vs ipa-dict",
    ),
  ];

  const report = {
    generatedAt,
    inputs: {
      tier0Terms: tier0Terms.length,
      tier1Terms: tier1Terms.length,
      kaikkiParseErrors: parseErrors,
      kaikkiMatchedWords: kaikkiByWord.size,
      openEtymology: { merged: oeEntries.size, bookStats },
      tatoeba: tatoeba.stats,
    },
    experiments: {
      tatoebaCoverageTier0: tatoebaCoverage,
      kaikkiSourceDomainsTier0: kaikkiTier0,
      kaikkiSourceDomainsTier1: kaikkiTier1,
      kaikkiDomainsTier0: tier0Coverage,
      kaikkiDomainsTier1: tier1Coverage,
      ipaAgreement,
    },
    products: {
      tier0: {
        records: tier0Records.length,
        rawBytes: tier0Size.rawBytes,
        brotliBytes: tier0Size.brotliBytes,
      },
      tier1: {
        records: tier1Records.length,
        rawBytes: tier1Size.rawBytes,
        brotliBytes: tier1Size.brotliBytes,
      },
    },
    elapsedSeconds: Math.round((Date.now() - t0) / 1000),
  };
  writeJson(path.join(OUTPUT_DIR, "enrichment-report.json"), report);
  console.log(`构建完成，耗时 ${report.elapsedSeconds}s`);
}

function emptyKaikki(term) {
  return {
    term,
    ipaUs: "",
    ipaUk: "",
    synonyms: [],
    antonyms: [],
    derived: [],
    examples: [],
    etymology: "",
  };
}

function hasAnyField(record) {
  const [, ipaUs, ipaUk, synonyms, antonyms, derived, etymology, wordParts, etymologyZh, examples] =
    record;
  return (
    ipaUs !== "" ||
    ipaUk !== "" ||
    synonyms !== "" ||
    antonyms !== "" ||
    derived !== "" ||
    etymology !== "" ||
    wordParts !== "" ||
    etymologyZh !== "" ||
    examples.length > 0
  );
}

function tier0Set(terms) {
  return new Set(terms);
}

function kaikkiUsMap(byWord, terms) {
  const map = new Map();
  for (const term of terms) {
    const lines = byWord.get(term);
    if (!lines) continue;
    const merged = mergeKaikkiEntry(term, lines);
    if (merged.ipaUs) map.set(term, merged.ipaUs);
  }
  return map;
}

function kaikkiUkMap(byWord, terms) {
  const map = new Map();
  for (const term of terms) {
    const lines = byWord.get(term);
    if (!lines) continue;
    const merged = mergeKaikkiEntry(term, lines);
    if (merged.ipaUk) map.set(term, merged.ipaUk);
  }
  return map;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
