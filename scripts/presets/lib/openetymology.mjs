/**
 * OpenEtymology EPUB 解析（词根/词缀拆解 + 中文词源，CC BY-SA 4.0 数据）。
 *
 * 五册 TXT 为纯词表，结构化内容在 EPUB 的 XHTML 章节内（结构固定）：
 *
 *   <section class="word-entry" id="abandon">
 *     <h2>abandon</h2>
 *     <p class="pronunciation">UK /əˈbændən/ · US /əˈbændən/</p>
 *     <h3>Definitions</h3><ol class="definitions">…</ol>
 *     <h3>Morphemes</h3><ul class="morphemes"><li><strong>a</strong> 加强</li>…</ul>
 *     <h3>Etymology</h3><p>中文词源说明</p>
 *     <h3>Examples</h3><ol class="examples">…</ol>
 *   </section>
 *
 * 批次 A 口径（RAY-268）：本来源仅取「词根词缀中文内容」（wordParts +
 * etymologyZh），音标与例句字段解析后仅作统计（本批次富化管线例句走
 * Tatoeba + kaikki，双音标走 ipa-dict + kaikki 校验，见 build-enrichment.mjs
 * 的优先级；OpenEtymology 结构保留在解析结果里供后续批次复用）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decodeHtmlEntities, readZipEntries, stripTags } from "./zip.mjs";

/** 词本解析顺序（term 去重首现优先：CET4 → CET6 → TOEFL → TEM8 → GRE8000） */
export const OE_BOOKS = [
  { file: "CET4.epub", id: "cet4" },
  { file: "CET6.epub", id: "cet6" },
  { file: "TOEFL.epub", id: "toefl" },
  { file: "TEM8.epub", id: "tem8" },
  { file: "GRE8000.epub", id: "gre8000" },
];

/**
 * 单词条解析结果（全字段；批次 A 富化管线只取 wordParts / etymologyZh）。
 *
 * @typedef {object} OeEntry
 * @property {string} term
 * @property {string} [ipaUs]
 * @property {string} [ipaUk]
 * @property {string} [wordParts] 词根词缀拆解，如 "a<加强> · bandon<控制> · al<形容词后缀>"
 * @property {string} [etymologyZh] 中文词源说明
 * @property {{text: string, translation: string}[]} examples 词本内双语例句（暂不随富化包分发）
 */

/** 解析单个 EPUB 的全部词条（term 小写为键） */
export function parseOeEpub(epubPath) {
  const buf = readFileSync(epubPath);
  const chapters = readZipEntries(buf)
    .filter((entry) => entry.name.endsWith(".xhtml"))
    .map((entry) => entry.data.toString("utf-8"));
  const entries = new Map();
  for (const html of chapters) {
    for (const entry of parseWordEntries(html)) {
      const key = entry.term.toLowerCase();
      if (!entries.has(key)) {
        entries.set(key, entry);
      }
    }
  }
  return entries;
}

/** 从单章 XHTML 提取全部 word-entry 区块 */
function parseWordEntries(html) {
  const results = [];
  // 章节内词条区块以 <section class="word-entry" id="…"> 开始，到下一个同名区块为止
  const sections = html.split(/<section class="word-entry"/).slice(1);
  for (const section of sections) {
    const entry = parseWordEntrySection(section);
    if (entry) {
      results.push(entry);
    }
  }
  return results;
}

function parseWordEntrySection(section) {
  const idMatch = section.match(/^\s+id="([^"]+)"/) ?? section.match(/^[^>]*id="([^"]+)"/);
  const term = idMatch ? decodeHtmlEntities(idMatch[1].trim()) : "";
  if (!term) {
    return null;
  }

  const pronMatch = section.match(/<p class="pronunciation">([\s\S]*?)<\/p>/);
  const pron = pronMatch ? stripTags(pronMatch[1]) : "";
  const ipaUs = pron.match(/US\s+(\/[^/]+\/)/)?.[1];
  const ipaUk = pron.match(/UK\s+(\/[^/]+\/)/)?.[1];

  const morphemes = extractListItems(section, "morphemes").map((item) => {
    const strong = item.match(/<strong>([^<]*)<\/strong>/)?.[1] ?? "";
    const note = item.match(/<span class="note">([^<]*)<\/span>/)?.[1] ?? "";
    const rest = stripTags(item.replace(/<strong>.*?<\/strong>/, "").replace(/<span.*?<\/span>/, ""));
    return `${stripTags(strong)}<${rest}${note ? `（${stripTags(note)}）` : ""}>`;
  });
  const wordParts = morphemes.length > 0 ? morphemes.join(" · ") : undefined;

  const etymologyMatch = section.match(/<h3>Etymology<\/h3>\s*<p>([\s\S]*?)<\/p>/);
  const etymologyZh = etymologyMatch ? stripTags(etymologyMatch[1]) : undefined;

  const examples = extractListItems(section, "examples")
    .map((item) => {
      const en = item.match(/<p class="example-en">([\s\S]*?)<\/p>/)?.[1];
      const zh = item.match(/<p class="example-zh">([\s\S]*?)<\/p>/)?.[1];
      if (!en || !zh) {
        return null;
      }
      return { text: stripTags(en), translation: stripTags(zh) };
    })
    .filter(Boolean);

  return {
    term,
    ...(ipaUs ? { ipaUs } : {}),
    ...(ipaUk ? { ipaUk } : {}),
    ...(wordParts ? { wordParts } : {}),
    ...(etymologyZh ? { etymologyZh } : {}),
    examples,
  };
}

/** 提取 <ul|ol class="NAME"> 内的 <li> 列表（跨行匹配） */
function extractListItems(section, className) {
  const listMatch = section.match(
    new RegExp(`<(?:ul|ol) class="${className}">([\\s\\S]*?)</(?:ul|ol)>`),
  );
  if (!listMatch) {
    return [];
  }
  return listMatch[1]
    .split(/<li>/)
    .slice(1)
    .map((item) => item.replace(/<\/li>[\s\S]*$/, "").trim())
    .filter((item) => item !== "");
}

/**
 * 解析全部词本并合并（term 小写去重，首现优先）。
 *
 * @param dataDir .data/openetymology 目录
 * @returns Map<term, OeEntry> 与词本规模统计
 */
export function loadOpenEtymology(dataDir) {
  const merged = new Map();
  const bookStats = [];
  for (const book of OE_BOOKS) {
    const entries = parseOeEpub(path.join(dataDir, book.file));
    let newCount = 0;
    for (const [term, entry] of entries) {
      if (!merged.has(term)) {
        merged.set(term, entry);
        newCount += 1;
      }
    }
    bookStats.push({ book: book.id, parsed: entries.size, newlyMerged: newCount });
  }
  return { entries: merged, bookStats };
}
