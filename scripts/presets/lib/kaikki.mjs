/**
 * kaikki/Wiktionary 英语提取 JSONL 的字段抽取（CC BY-SA 4.0 + GFDL）。
 *
 * 一源四域（RAY-267 拍板）：例句 / 近反义词 / 派生词 / 双音标校验。
 * 字段口径：
 * - 例句：仅取 type === "example"——quotation 涉 fair use，商用必须过滤
 *   （RAY-257 既定口径，Jack 2026-08-15 写入任务规格）；
 * - 近义词：顶层 + 义项级 synonyms 合并；反义词：义项级 antonyms；
 * - 派生词：顶层 derived（对象取 word 字段）；
 * - 双音标：sounds 中按标签取 US/UK 变体（ipa-dict 为主力，本字段做
 *   校验与缺省补位——优先级见 build-enrichment.mjs）。
 *
 * 同一词条在 kaikki 内按词性/词源拆成多行，抽取后按 term 合并去重
 * （mergeKaikkiEntry）。3.2GB 文件流式逐行处理，本模块不读全量入内存。
 */

/** 美式音标标签（大小写不敏感匹配） */
const US_TAGS = ["general-american", "us", "american", "genam"];
/** 英式音标标签 */
const UK_TAGS = ["received-pronunciation", "uk", "british", "rp"];

/** 单行 kaikki 词条抽取结果（未合并；字段均可为空） */
export function extractKaikkiLine(obj) {
  const word = typeof obj.word === "string" ? obj.word.trim() : "";
  if (!word) {
    return null;
  }

  const sounds = Array.isArray(obj.sounds) ? obj.sounds : [];
  const ipaUs = pickIpaByTags(sounds, US_TAGS);
  const ipaUk = pickIpaByTags(sounds, UK_TAGS);

  const synonyms = collectWordFields([
    ...(Array.isArray(obj.synonyms) ? obj.synonyms : []),
    ...(Array.isArray(obj.senses) ? obj.senses.flatMap((s) => s.synonyms ?? []) : []),
  ]);
  const antonyms = collectWordFields(
    Array.isArray(obj.senses) ? obj.senses.flatMap((s) => s.antonyms ?? []) : [],
  );
  const derived = collectWordFields(Array.isArray(obj.derived) ? obj.derived : []);

  const examples = (Array.isArray(obj.senses) ? obj.senses.flatMap((s) => s.examples ?? []) : [])
    .filter((ex) => ex && typeof ex.text === "string" && ex.type === "example")
    .map((ex) => ex.text.trim())
    .filter(isUsableExample);

  const etymology =
    typeof obj.etymology_text === "string"
      ? obj.etymology_text.trim().replace(/\s+/g, " ").slice(0, 400)
      : "";

  return {
    word,
    ...(ipaUs ? { ipaUs } : {}),
    ...(ipaUk ? { ipaUk } : {}),
    synonyms,
    antonyms,
    derived,
    examples,
    etymology,
  };
}

/** 从 sounds 数组按标签取第一个 IPA（kaikki 的 ipa 形如 "/…/"） */
function pickIpaByTags(sounds, tagList) {
  for (const sound of sounds) {
    if (!sound || typeof sound.ipa !== "string") {
      continue;
    }
    const tags = Array.isArray(sound.tags) ? sound.tags.map((t) => String(t).toLowerCase()) : [];
    if (tags.some((t) => tagList.includes(t))) {
      return sound.ipa;
    }
  }
  return undefined;
}

/** 近反义/派生字段的条目形态：字符串或 { word: "…" }，统一取词形并清洗 */
function collectWordFields(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const raw = typeof item === "string" ? item : item?.word;
    if (typeof raw !== "string") {
      continue;
    }
    const cleaned = raw
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s+/g, " ");
    if (!cleaned || cleaned.length > 40 || !/[A-Za-z]/.test(cleaned)) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

/** 例句可用性：长度 5–200，非纯符号，不含 wiktextract 残留模板/链接 */
function isUsableExample(text) {
  if (text.length < 5 || text.length > 200) {
    return false;
  }
  if (/[{}[\]<>]|https?:\/\//.test(text)) {
    return false;
  }
  return /[A-Za-z]/.test(text);
}

/**
 * 同一 term 的多行 kaikki 条目合并（去重，首个非空字段优先）。
 *
 * @param term 词条原文（小写）
 * @param lines 该词条的全部抽取结果
 */
export function mergeKaikkiEntry(term, lines) {
  const merged = {
    term,
    ipaUs: "",
    ipaUk: "",
    synonyms: [],
    antonyms: [],
    derived: [],
    examples: [],
    etymology: "",
  };
  const seen = {
    synonyms: new Set(),
    antonyms: new Set(),
    derived: new Set(),
    examples: new Set(),
  };
  for (const line of lines) {
    if (!merged.ipaUs && line.ipaUs) merged.ipaUs = line.ipaUs;
    if (!merged.ipaUk && line.ipaUk) merged.ipaUk = line.ipaUk;
    if (!merged.etymology && line.etymology) merged.etymology = line.etymology;
    for (const field of ["synonyms", "antonyms", "derived"]) {
      for (const item of line[field]) {
        const key = item.toLowerCase();
        if (!seen[field].has(key)) {
          seen[field].add(key);
          merged[field].push(item);
        }
      }
    }
    for (const example of line.examples) {
      const key = example.toLowerCase();
      if (!seen.examples.has(key)) {
        seen.examples.add(key);
        merged.examples.push(example);
      }
    }
  }
  return merged;
}
