/**
 * Tatoeba 例句 join（文本 CC BY 2.0 FR，默认许可；CC0 子集单独标记，RAY-267）。
 *
 * 按句许可列过滤（Jack 拍板写入任务规格，RAY-268 口径）：
 * Tatoeba 官方导出不含逐句 license 列，许可以「默认 CC BY 2.0 FR（ToU §6.2）
 * + _CC0 子集文件显式标记」呈现，文本句仅这两种许可——因此过滤实现为：
 * 句子许可 = CC0 子集命中 ? "CC0" : "CC-BY"，两者均保留；如未来导出引入
 * 其它许可形态（详细导出带 license 列），过滤点在本文件 licenseOf()。
 *
 * 质量规则（社区句库，打包侧清洗）：
 * - 英句：5–200 字符、含字母、无 URL、无 "@" 提及残留；
 * - 中句：2–200 字符、含 CJK、无 URL；
 * - 同一 (eng_id, cmn_id) 对去重；同一英文文本只保留首个（避免社区复读句）。
 *
 * 按词 join：term 整词边界匹配（大小写不敏感）英文句，每词至多
 * maxPerTerm 对（按英文句 id 升序取先收录的句子）。
 */
import { readFileSync } from "node:fs";
import { Converter } from "opencc-js";

/** 繁体→简体转换器（Tatoeba 中文句可能含繁体，统一转简体） */
const toSimplified = Converter({ from: "tw", to: "cn" });

/** 许可类型（过滤白名单外的许可；当前导出仅 CC-BY / CC0 两种形态） */
const ALLOWED_LICENSES = new Set(["CC-BY", "CC0"]);

/** 每词最大句对数（产物体积与展示口径的平衡） */
export const MAX_PAIRS_PER_TERM = 3;

/** 读取 TSV（无表头：id\tlang\ttext 或 id\ttext，视用途解析） */
export function readTsvLines(file) {
  return readFileSync(file, "utf-8").split("\n");
}

/** 解析句子 TSV → Map<id, {lang, text}> */
export function parseSentences(lines) {
  const map = new Map();
  for (const line of lines) {
    if (!line) continue;
    const tab1 = line.indexOf("\t");
    const tab2 = line.indexOf("\t", tab1 + 1);
    if (tab1 < 0 || tab2 < 0) continue;
    const id = line.slice(0, tab1);
    const lang = line.slice(tab1 + 1, tab2);
    const text = line.slice(tab2 + 1);
    map.set(id, { lang, text });
  }
  return map;
}

/** 解析 CC0 子集文件 → Set<句 id>（eng 子集为 4 列：id\tlang\ttext\tdate） */
export function parseCc0Ids(lines) {
  const ids = new Set();
  for (const line of lines) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab > 0) {
      ids.add(line.slice(0, tab));
    }
  }
  return ids;
}

/** 解析 links TSV（eng_id\tcmn_id）→ engId → [cmnId, …] */
export function parseLinks(lines) {
  const map = new Map();
  for (const line of lines) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const engId = line.slice(0, tab);
    const cmnId = line.slice(tab + 1);
    const list = map.get(engId);
    if (list) {
      list.push(cmnId);
    } else {
      map.set(engId, [cmnId]);
    }
  }
  return map;
}

/** 句许可判定（按句许可列过滤的实现点） */
function licenseOf(id, cc0Eng, cc0Cmn, lang) {
  const cc0 = lang === "eng" ? cc0Eng.has(id) : cc0Cmn.has(id);
  return cc0 ? "CC0" : "CC-BY";
}

/** 英文句质量过滤 */
function isUsableEng(text) {
  if (text.length < 5 || text.length > 200) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (/@/.test(text)) return false;
  return true;
}

/** 中文句质量过滤 */
function isUsableCmn(text) {
  if (text.length < 2 || text.length > 200) return false;
  if (!/[一-鿿]/.test(text)) return false;
  if (/https?:\/\//i.test(text)) return false;
  return true;
}

/**
 * 构建 eng→cmn 双语句对池（许可过滤 + 质量过滤 + 去重）。
 *
 * @returns {{ pairs: Map<engId, {text, translation}[]>, stats: object }}
 */
export function buildPairPool({ engLines, cmnLines, linkLines, cc0EngLines, cc0CmnLines }) {
  const eng = parseSentences(engLines);
  const cmn = parseSentences(cmnLines);
  const links = parseLinks(linkLines);
  const cc0Eng = parseCc0Ids(cc0EngLines);
  const cc0Cmn = parseCc0Ids(cc0CmnLines);

  const pairs = new Map();
  let rejectedLicense = 0;
  let rejectedEng = 0;
  let rejectedCmn = 0;
  let linked = 0;
  let duplicatePairs = 0;
  const seenPair = new Set();
  const seenEngText = new Set();

  for (const [engId, cmnIds] of links) {
    const engSentence = eng.get(engId);
    if (!engSentence) continue;
    linked += 1;
    if (!ALLOWED_LICENSES.has(licenseOf(engId, cc0Eng, cc0Cmn, "eng"))) {
      rejectedLicense += 1;
      continue;
    }
    if (!isUsableEng(engSentence.text)) {
      rejectedEng += 1;
      continue;
    }
    for (const cmnId of cmnIds) {
      const cmnSentence = cmn.get(cmnId);
      if (!cmnSentence) continue;
      if (!ALLOWED_LICENSES.has(licenseOf(cmnId, cc0Eng, cc0Cmn, "cmn"))) {
        rejectedLicense += 1;
        continue;
      }
      if (!isUsableCmn(cmnSentence.text)) {
        rejectedCmn += 1;
        continue;
      }
      const pairKey = `${engId}:${cmnId}`;
      if (seenPair.has(pairKey)) {
        duplicatePairs += 1;
        continue;
      }
      const textKey = engSentence.text.toLowerCase();
      if (seenEngText.has(textKey)) {
        duplicatePairs += 1;
        continue;
      }
      seenPair.add(pairKey);
      seenEngText.add(textKey);
      // 繁体→简体：Tatoeba 中文句可能含繁体，统一转简体确保一致性
      const translation = toSimplified(cmnSentence.text);
      const list = pairs.get(engId);
      if (list) {
        list.push({ text: engSentence.text, translation });
      } else {
        pairs.set(engId, [{ text: engSentence.text, translation }]);
      }
    }
  }

  return {
    pairs,
    stats: {
      linkedEngSentences: linked,
      rejectedLicense,
      rejectedEng,
      rejectedCmn,
      duplicatePairs,
      usableEngSentences: pairs.size,
    },
  };
}

/**
 * 构建「词 → 句对」倒排索引（英文句按非字母边界切词，词小写为键）。
 *
 * 按词 join（Tier 0 词表 × 句对池）走索引 O(1) 查询，避免逐词全池扫描。
 * 每对只取英文句前 200 词（句长上限 200 字符内），索引内存约几十万词条。
 */
export function indexPairs(pool) {
  const index = new Map();
  for (const [engId, list] of pool) {
    const words = list[0].text.toLowerCase().match(/[a-z][a-z'’-]*\.?/g) ?? [];
    const unique = [...new Set(words)];
    for (const word of unique) {
      const bucket = index.get(word);
      if (bucket) {
        bucket.push(engId);
      } else {
        index.set(word, [engId]);
      }
    }
  }
  return index;
}

/**
 * 按词 join：整词命中英文句的句对（每词至多 maxPerTerm 对）。
 *
 * 词条含撇号/连字符时按字面匹配（TERM_PATTERN 形状，索引切词保留
 * 撇号/连字符，故直接查小写词条即可；不做词形还原——派生形态命中
 * 不计入，覆盖率实验按此口径如实汇报）。
 *
 * @param pool buildPairPool 的 pairs（engId → 句对列表）
 * @param index indexPairs 的倒排索引
 * @param term 词条（TERM_PATTERN 形状）
 */
export function pairsForTerm(pool, index, term, maxPerTerm = MAX_PAIRS_PER_TERM) {
  const engIds = index.get(term.toLowerCase());
  if (!engIds) {
    return [];
  }
  const out = [];
  for (const engId of engIds) {
    const list = pool.get(engId);
    if (!list) continue;
    for (const pair of list) {
      out.push(pair);
      if (out.length >= maxPerTerm) return out;
    }
  }
  return out;
}
