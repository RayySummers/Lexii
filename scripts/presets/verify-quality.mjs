/**
 * RAY-258 质量门槛：NGSL 高频核心词 Wiktionary 交叉校验 + 抽样校对。
 *
 * 1. NGSL 1.2 在 ECDICT 清洗结果中的释义覆盖率（打包前置硬指标）。
 * 2. 抽样 N=40（固定种子伪随机）NGSL 词 → 查询 Wiktionary REST API，
 *    校验词条存在且含英文释义；产出抽样对照表供人工校对。
 *
 * 结果写入 docs/presets/quality-check.md。网络访问仅限 en.wiktionary.org
 * 公开 REST API（只读），单次运行请求数封顶（MAX_SAMPLE）。
 *
 * 用法：node scripts/presets/verify-quality.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanEcdictRow, parseCsv, parseEcdictRow } from "./lib/ecdict.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ECDICT_CSV = path.join(ROOT, "scripts", "presets", ".data", "ecdict", "ecdict.csv");
const NGSL_CSV = path.join(ROOT, "scripts", "presets", "sources", "ngsl", "NGSL_12_stats.csv");
const REPORT_PATH = path.join(ROOT, "docs", "presets", "quality-check.md");

const MAX_SAMPLE = 40;
const WIKTIONARY_REST = "https://en.wiktionary.org/api/rest_v1/page/definition/";
const MAX_ATTEMPTS = 5;

/** 确定性伪随机（LCG，固定种子 20260815）——抽样可复现 */
function seededIndices(count, n, seed = 20260815) {
  let state = seed;
  const indices = new Set();
  while (indices.size < n) {
    state = (state * 1664525 + 1013904223) >>> 0;
    indices.add(state % count);
  }
  return [...indices].sort((a, b) => a - b);
}

/** 剥离 REST API 释义中的 HTML 标签并解码实体（对照表用纯文本） */
function stripHtml(input) {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 限速退避：429/5xx 指数退避重试（Wiktionary REST 对连续请求有限速） */
async function fetchWiktionaryDefinition(term) {
  const url = `${WIKTIONARY_REST}${encodeURIComponent(term)}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "lexilexi-preset-pipeline (local-first vocabulary app)" },
        signal: controller.signal,
      });
      if (res.status === 404) {
        return { status: "missing" };
      }
      if (res.status === 429 || res.status >= 500) {
        const waitMs = 2000 * 2 ** attempt;
        console.log(
          `    ${term} → HTTP ${res.status}，${(waitMs / 1000).toFixed(0)}s 后重试（${attempt + 1}/${MAX_ATTEMPTS}）`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        return { status: "error", detail: `HTTP ${res.status}` };
      }
      const data = await res.json();
      const sections = Array.isArray(data) ? data : (data?.en ?? []);
      const definitions = sections
        .filter((s) => s.partOfSpeech && Array.isArray(s.definitions))
        .flatMap((s) => s.definitions)
        .map((d) => (typeof d.definition === "string" ? stripHtml(d.definition) : ""))
        .filter((d) => d !== "");
      return definitions.length > 0
        ? { status: "present", definitions }
        : { status: "no-definition" };
    } catch (err) {
      const waitMs = 2000 * 2 ** attempt;
      console.log(
        `    ${term} → 网络错误（${err instanceof Error ? err.message : String(err)}），${(waitMs / 1000).toFixed(0)}s 后重试`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: "error", detail: `重试 ${MAX_ATTEMPTS} 次后仍失败` };
}

function readNgslTerms() {
  const rows = parseCsv(readFileSync(NGSL_CSV, "utf-8"));
  return rows
    .slice(1)
    .map((cells) => (cells[0] ?? "").trim())
    .filter((t) => t !== "");
}

function buildEcdictLookup() {
  const rows = parseCsv(readFileSync(ECDICT_CSV, "utf-8"));
  const lookup = new Map();
  for (const cells of rows.slice(1)) {
    const result = cleanEcdictRow(parseEcdictRow(cells));
    if ("entry" in result) {
      const key = result.entry.term.toLowerCase();
      if (!lookup.has(key)) {
        lookup.set(key, result.entry);
      }
    }
  }
  return lookup;
}

async function main() {
  const ngslTerms = readNgslTerms();
  const ecdict = buildEcdictLookup();
  const covered = ngslTerms.filter((t) => ecdict.has(t.toLowerCase()));
  const missing = ngslTerms.filter((t) => !ecdict.has(t.toLowerCase()));

  const sampleIdx = seededIndices(ngslTerms.length, MAX_SAMPLE);
  const sampleTerms = sampleIdx.map((i) => ngslTerms[i]);
  const results = [];
  console.log(`开始 Wiktionary 抽样交叉校验（${sampleTerms.length} 词）…`);
  for (const [i, term] of sampleTerms.entries()) {
    const wikt = await fetchWiktionaryDefinition(term);
    results.push({ term, wikt });
    console.log(`  [${i + 1}/${sampleTerms.length}] ${term} → ${wikt.status}`);
    await new Promise((r) => setTimeout(r, 1000)); // 礼貌限速（Wiktionary 公开 API）
  }

  const present = results.filter((r) => r.wikt.status === "present");
  const passRate = ((present.length / results.length) * 100).toFixed(1);

  const rows = results.map(({ term, wikt }) => {
    const entry = ecdict.get(term.toLowerCase());
    const ecdictDef = entry ? entry.definitions[0] : "（缺失）";
    const wiktDef =
      wikt.status === "present"
        ? wikt.definitions[0].replace(/[|\n]/g, " ").slice(0, 120)
        : wikt.status === "missing"
          ? "（Wiktionary 无此词条）"
          : wikt.status === "no-definition"
            ? "（无释义段落）"
            : `（请求失败：${wikt.detail}）`;
    return `| ${term} | ${ecdictDef} | ${wiktDef} |`;
  });

  const report = [
    "# 预设词表质量校验报告（RAY-258 质量门槛）",
    "",
    `> 生成时间：${new Date().toISOString()}（脚本：scripts/presets/verify-quality.mjs）`,
    "> 校验口径（RAY-258 口径约束）：NGSL 高频核心词以 Wiktionary 交叉校验 + 抽样校对",
    "> 作为内置包质量门槛；ECDICT 中文释义为 MVP 基线。",
    "",
    "## 1. NGSL 1.2 → ECDICT 释义覆盖",
    "",
    `| 指标 | 数值 |`,
    `|---|---|`,
    `| NGSL 1.2 总词数 | ${ngslTerms.length} |`,
    `| ECDICT 清洗结果命中 | ${covered.length} |`,
    `| 覆盖率 | ${((covered.length / ngslTerms.length) * 100).toFixed(1)}% |`,
    `| 未命中 | ${missing.length}${missing.length > 0 ? `：${missing.join(", ")}` : ""} |`,
    "",
    "## 2. Wiktionary 抽样交叉校验（固定种子抽样，可复现）",
    "",
    `| 指标 | 数值 |`,
    `|---|---|`,
    `| 抽样数 | ${results.length} |`,
    `| Wiktionary 存在且含英文释义 | ${present.length} |`,
    `| 通过率 | ${passRate}% |`,
    `| 抽样词序（NGSL 行号） | ${sampleIdx.join(", ")} |`,
    "",
    "## 3. 抽样对照表（ECDICT 中文释义 vs Wiktionary 英文释义，供人工校对）",
    "",
    "| 词条 | ECDICT 中文释义（第一条） | Wiktionary 英文释义（第一条） |",
    "|---|---|---|",
    ...rows,
    "",
    "> 释义质量结论与人工校对由 Jack/用户侧执行；本报告为可复现的机器校验基线。",
    "",
  ].join("\n");

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report, "utf-8");
  console.log(`报告已写入：${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`覆盖：${covered.length}/${ngslTerms.length}，抽样通过率：${passRate}%`);
}

main();
