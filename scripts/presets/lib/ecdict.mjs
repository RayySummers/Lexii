/**
 * ECDICT CSV 解析与清洗共享库（打包脚本专用，不进运行时）。
 *
 * ECDICT 格式（skywind3000/ECDICT，MIT）：
 *   word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
 *   - translation 内含转义的换行（字面 "\\n" 或真实换行）分隔多条释义；
 *   - tag 为空格分隔的考试标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre …）；
 *   - 原始数据含大量短语、词缀、缩略行，打包侧必须清洗（RAY-257 简报 §三.9）。
 *
 * 本模块只用 Node 内置 API（fs/zlib），无第三方依赖，便于在任何环境复现。
 */
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { TERM_PATTERN } from "../../../packages/core/src/termPattern.js";

/**
 * 与 core 侧共享的词条模式（唯一物理定义在
 * packages/core/src/termPattern.js——core 的 csv.ts 与打包脚本 import 同一文件，
 * 消除双处维护漂移，RAY-260 评审 nit 1）。
 */
export { TERM_PATTERN };

/** 与 core 侧一致的单字段上限（500 字符） */
export const MAX_FIELD_LENGTH = 500;

/** 考试标签 → 面向用户的中文标签（Sense.tags 展示用） */
export const TAG_LABELS = Object.freeze({
  zk: "中考",
  gk: "高考",
  cet4: "四级",
  cet6: "六级",
  ky: "考研",
  toefl: "托福",
  ielts: "雅思",
  gre: "GRE",
});

/**
 * ECDICT 词性标记集（出现在释义段首，如 "vt. 放弃…"）。
 * 清洗时从释义文本剥离、并入 pos 字段（Sense.pos），与词性列（通常为空）互补。
 */
export const POS_MARKERS = new Set([
  "n.",
  "v.",
  "vt.",
  "vi.",
  "a.",
  "adj.",
  "adv.",
  "prep.",
  "conj.",
  "pron.",
  "num.",
  "art.",
  "aux.",
  "int.",
  "interj.",
  "suf.",
  "pref.",
  "abbr.",
  "pl.",
]);

/**
 * ECDICT 领域标记（释义段首，如 "[医] 苹果"、"[计] 变量"）。
 * 仅匹配半角方括号形态；连续多个段首标记全部剥离（如 "[医][化] 水"）。
 * RAY-260 评审 suggestion 1：打包管线剥离领域标记，避免 "[医] 苹果"
 * 这类文本原样渲染到复习卡。
 */
const DOMAIN_TAG_PATTERN = /^\[[^\]]+\]/;

/** 剥离文本段首的领域标记（可连续多个），返回剩余文本 */
function stripLeadingDomainTags(text) {
  let rest = text;
  while (DOMAIN_TAG_PATTERN.test(rest)) {
    rest = rest.replace(DOMAIN_TAG_PATTERN, "").trimStart();
  }
  return rest;
}

/**
 * 从释义段首剥离领域标记与词性标记（交替剥离直至稳定）。
 *
 * ECDICT 两种真实形态都要覆盖：
 * - "[医] 苹果"：领域标记在段首，词性紧随其后（"[医] n. 解剖" 亦见）；
 * - "n. [医] 解剖"：词性在前、领域标记在后（全量数据中约 4,895 段）。
 * 单次单向剥离会漏剥其中一种，因此循环交替剥离直到不再变化；
 * 词性提取口径与 RAY-258 旧实现完全一致（段首 `[a-z]{1,6}.` + 空白、
 * 大小写归一、按出现顺序去重并入 pos 字段），不破坏现有词性提取。
 *
 * RAY-349：除去重后的 pos 汇总串外，另返回与释义逐条对齐的词性数组
 * （posByDefinition[i] 是 definitions[i] 段首剥下的词性，无标记为 ""）。
 * 汇总串会去重（"n. 能力\nn. 才能" → "n."），对齐信息在去重时丢失，
 * 卡片因此只能给释义编号（1. 2. 3.）而非标注词性——对齐数组是补回
 * 这一信息的唯一来源，口径与汇总串完全一致（同一次剥离的产物）。
 *
 * @param {string[]} definitions 已按「；」切分的原始释义段
 * @returns {{ definitions: string[], pos: string, posByDefinition: string[] }}
 *   剥离后的释义、按出现顺序去重的词性串、与释义等长的逐条词性数组
 */
export function stripPrefixMarkers(definitions) {
  const posList = [];
  const stripped = [];
  const posByDefinition = [];
  for (const def of definitions) {
    let rest = def;
    let defPos = "";
    for (;;) {
      let didStrip = false;
      const withoutTags = stripLeadingDomainTags(rest);
      if (withoutTags !== rest) {
        rest = withoutTags;
        didStrip = true;
      }
      const match = rest.match(/^([a-z]{1,6}\.)\s+/);
      if (match && POS_MARKERS.has(match[1].toLowerCase())) {
        const marker = match[1].toLowerCase();
        if (!posList.includes(marker)) {
          posList.push(marker);
        }
        // 同一段出现多个词性标记（"vt. vi. 停留"）时取首个作为该段词性
        if (defPos === "") {
          defPos = marker;
        }
        rest = rest.slice(match[0].length).trimStart();
        didStrip = true;
      }
      if (!didStrip) {
        break;
      }
    }
    rest = rest.trim();
    if (rest !== "") {
      stripped.push(rest);
      posByDefinition.push(defPos);
    }
  }
  return { definitions: stripped, pos: posList.join("；"), posByDefinition };
}

/** Tier 0 内置核心：中考/高考/四级/六级（RAY-258 口径，Jack 拍板） */
export const TIER0_ECDICT_TAGS = Object.freeze(["zk", "gk", "cet4", "cet6"]);

/** Tier 1 标准：全考试标签 + collins/oxford 星级 + 词频阈值（RAY-257 简报 §四） */
export const TIER1_ECDICT_TAGS = Object.freeze([
  ...TIER0_ECDICT_TAGS,
  "ky",
  "toefl",
  "ielts",
  "gre",
]);

/** Tier 1 词频阈值：BNC 或当代语料词频任一非零即视为核心词 */
export const TIER1_MIN_FRQ = 1;

/**
 * RFC 4180 风格 CSV 解析（支持引号包裹、"" 转义、字段内真实换行）。
 * 返回行数组；表头行由调用方自行识别。
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }
  return rows;
}

/** ECDICT 单行 → 结构化对象（表头行之外调用；cells 须为 13 列） */
export function parseEcdictRow(cells) {
  const word = (cells[0] ?? "").trim();
  const phonetic = (cells[1] ?? "").trim();
  const translation = cells[3] ?? "";
  const pos = (cells[4] ?? "").trim();
  const collins = Number.parseInt(cells[5] ?? "0", 10) || 0;
  const oxford = Number.parseInt(cells[6] ?? "0", 10) || 0;
  const tag = (cells[7] ?? "").trim();
  const bnc = Number.parseInt(cells[8] ?? "0", 10) || 0;
  const frq = Number.parseInt(cells[9] ?? "0", 10) || 0;
  return { word, phonetic, translation, pos, collins, oxford, tag, bnc, frq };
}

/**
 * 转义换行与释义规范化 → 全角分号分隔的多条释义：
 * - 字面 "\\n"/"\\r" 与真实换行 → 分隔符；
 * - 半角 "; " 在 ECDICT 机翻文本中作义项分隔 → 转全角分号（与 core 侧多释义分隔符一致）；
 * - 逐段 trim 去空。
 */
export function normalizeTranslation(translation) {
  const segments = translation
    .split(/\\r|\\n|\r\n|\r|\n/)
    .flatMap((part) => part.split(/;\s*/))
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return segments.join("；");
}

/** 词条清洗判定：返回拒绝原因（null = 通过进入释义规范化） */
export function rejectReason(row) {
  const word = row.word;
  if (!TERM_PATTERN.test(word)) {
    return "term-shape"; // 短语 / 词缀 / 缩略 / 非英语词条（如 "why not"、"-ability"、"'hood"）
  }
  if (word.length > MAX_FIELD_LENGTH) {
    return "term-too-long";
  }
  if (normalizeTranslation(row.translation) === "") {
    return "empty-translation";
  }
  return null;
}

/**
 * 清洗一条 ECDICT 行 → 规范化中间条目（供分级/生成使用）。
 * 超长释义按 500 字符在「；」边界截断（与 core 侧单字段上限一致），
 * 截断后无剩余释义的行按 empty-translation 拒绝。
 * @returns {{ entry: CleanedEntry, truncated: boolean } | { reason: string }}
 */
export function cleanEcdictRow(row) {
  const reason = rejectReason(row);
  if (reason !== null) {
    return { reason };
  }
  let translation = normalizeTranslation(row.translation);
  let truncated = false;
  if (translation.length > MAX_FIELD_LENGTH) {
    const cut = translation.slice(0, MAX_FIELD_LENGTH);
    const lastSep = cut.lastIndexOf("；");
    translation = lastSep > 0 ? cut.slice(0, lastSep) : cut;
    truncated = true;
  }
  const rawDefinitions = translation.split("；");
  if (rawDefinitions.length === 0 || rawDefinitions.every((d) => d === "")) {
    return { reason: "empty-translation" };
  }
  // 领域标记 + 词性标记交替剥离（RAY-260 suggestion 1；"[医] n. 解剖" 与
  // "n. [医] 解剖" 两种形态都能剥净，词性提取口径不变）
  const { definitions, pos: extractedPos, posByDefinition } = stripPrefixMarkers(rawDefinitions);
  if (definitions.length === 0) {
    return { reason: "empty-translation" };
  }
  const pos = extractedPos !== "" ? extractedPos : row.pos;
  // 逐条词性（RAY-349）：全空（该词无段首词性标记）时不带出该字段
  const hasDefPos = posByDefinition.some((p) => p !== "");
  const tags = row.tag
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => TAG_LABELS[t])
    .map((t) => TAG_LABELS[t]);
  return {
    entry: {
      term: row.word,
      definitions,
      ...(pos ? { pos } : {}),
      ...(hasDefPos ? { posByDefinition } : {}),
      ...(row.phonetic ? { ipa: row.phonetic } : {}),
      tags,
      collins: row.collins,
      oxford: row.oxford,
      bnc: row.bnc,
      frq: row.frq,
      examTags: row.tag
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t !== ""),
    },
    truncated,
  };
}

/** 判定一条已清洗条目是否属于给定考试标签集合 */
export function hasExamTag(entry, examTags) {
  return entry.examTags.some((t) => examTags.includes(t));
}

/** 判定一条已清洗条目是否达到 Tier 1 核心阈值（collins/oxford 星级或词频） */
export function isTier1Core(entry) {
  return entry.collins > 0 || entry.oxford > 0 || entry.bnc > 0 || entry.frq >= TIER1_MIN_FRQ;
}

/** 体积统计（UTF-8 字节 / gzip / brotli，压缩级别取发布常用档） */
export function measureVolumes(text) {
  const raw = Buffer.byteLength(text, "utf-8");
  const gzip = gzipSync(text, { level: 9 }).length;
  const brotli = brotliCompressSync(text, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  return { raw, gzip, brotli };
}
