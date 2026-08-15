/**
 * 词书库装载器（RAY-262 考试分级词书）。
 *
 * 数据由 scripts/presets/build.mjs --books 生成（books.data.json：
 * 共享词条池 pool + 每本词书 term 索引），随 PWA 打包、离线可用。
 * 本文件在模块加载时做 parse-don't-validate：结构与词条形状不合法
 * 立即抛错（生成物损坏在启动即暴露，绝不带病运行）。
 *
 * 词书词条内容（释义/词性/音标/标签）从共享池按 term join 得到——
 * 池内每条释义只存一份，独立打包省 4.2 倍体积（实测）。join 时
 * term 缺失视为数据损坏，立即抛错。
 */
import { TERM_PATTERN } from "../csv";
import { convertPresetEntry } from "./convertEntry";
import type { PresetPackage, WordbookCategory, WordbookDefinition } from "./types";
import booksData from "./books.data.json";

/** 生成物原始形态（元组池 + 词书索引；term 索引以 "\n" 连接，无损往返） */
type RawBooksData = {
  version: string;
  generatedAt: string;
  source: string;
  pool: string[][];
  books: {
    id: string;
    name: string;
    category: string;
    description: string;
    terms: string;
  }[];
};

const SOURCE_NAME = "books.data.json";

/** 词书分组合法值（与打包侧 lib/books.mjs 的 category 口径一致） */
const WORDBOOK_CATEGORIES: readonly WordbookCategory[] = ["exam", "sprint"];

function convertPoolEntry(raw: readonly string[], index: number) {
  return convertPresetEntry(raw, index, SOURCE_NAME);
}

function parseTerms(rawTerms: string, bookId: string, index: number): string[] {
  const terms = rawTerms
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (terms.length === 0) {
    throw new Error(`${SOURCE_NAME} 词书 #${index}（${bookId}）term 索引为空`);
  }
  for (const term of terms) {
    if (!TERM_PATTERN.test(term)) {
      throw new Error(`${SOURCE_NAME} 词书 #${index}（${bookId}）term 形状非法："${term}"`);
    }
  }
  const seen = new Set<string>();
  for (const term of terms) {
    if (seen.has(term.toLowerCase())) {
      throw new Error(`${SOURCE_NAME} 词书 #${index}（${bookId}）term 重复："${term}"`);
    }
    seen.add(term.toLowerCase());
  }
  return terms;
}

function loadBooksData(): {
  version: string;
  source: string;
  pool: Map<string, ReturnType<typeof convertPoolEntry>>;
  catalog: WordbookDefinition[];
} {
  const raw = booksData as unknown as RawBooksData;
  if (typeof raw.version !== "string" || raw.version === "") {
    throw new Error(`${SOURCE_NAME} 缺少版本号`);
  }
  if (typeof raw.source !== "string" || raw.source === "") {
    throw new Error(`${SOURCE_NAME} 缺少来源与许可声明`);
  }
  if (!Array.isArray(raw.pool) || raw.pool.length === 0) {
    throw new Error(`${SOURCE_NAME} 词条池为空或格式非法`);
  }
  if (!Array.isArray(raw.books) || raw.books.length === 0) {
    throw new Error(`${SOURCE_NAME} 词书目录为空或格式非法`);
  }
  const pool = new Map();
  raw.pool.forEach((tuple, i) => {
    const entry = convertPoolEntry(tuple, i);
    const key = entry.term.toLowerCase();
    if (pool.has(key)) {
      throw new Error(`${SOURCE_NAME} 词条池重复："${entry.term}"`);
    }
    pool.set(key, entry);
  });
  const catalog = raw.books.map((book, index) => {
    if (typeof book.id !== "string" || book.id === "") {
      throw new Error(`${SOURCE_NAME} 词书 #${index} 缺少 id`);
    }
    if (typeof book.name !== "string" || book.name === "") {
      throw new Error(`${SOURCE_NAME} 词书 #${index}（${book.id}）缺少名称`);
    }
    if (typeof book.description !== "string" || book.description === "") {
      throw new Error(`${SOURCE_NAME} 词书 #${index}（${book.id}）缺少描述`);
    }
    if (!WORDBOOK_CATEGORIES.includes(book.category as WordbookCategory)) {
      throw new Error(`${SOURCE_NAME} 词书 #${index}（${book.id}）分组非法："${book.category}"`);
    }
    if (typeof book.terms !== "string") {
      throw new Error(`${SOURCE_NAME} 词书 #${index}（${book.id}）缺少 term 索引`);
    }
    return {
      id: book.id,
      name: book.name,
      description: book.description,
      category: book.category as WordbookCategory,
      terms: parseTerms(book.terms, book.id, index),
    };
  });
  const catalogIds = new Set<string>();
  for (const book of catalog) {
    if (catalogIds.has(book.id)) {
      throw new Error(`${SOURCE_NAME} 词书 id 重复："${book.id}"`);
    }
    catalogIds.add(book.id);
  }
  return { version: raw.version, source: raw.source, pool, catalog };
}

const loaded = loadBooksData();

/** 词书库数据版本（打包侧 PACKAGE_VERSION） */
export const WORDBOOK_DATA_VERSION = loaded.version;

/** 词书库来源与许可声明 */
export const WORDBOOK_SOURCE = loaded.source;

/** 词书库共享词条池（term 小写 → 词条；模块加载即校验） */
export const WORDBOOK_POOL: ReadonlyMap<string, ReturnType<typeof convertPoolEntry>> = loaded.pool;

/** 词书目录（打包侧定义顺序：8 本考试词汇 + 专四/专八冲刺） */
export const WORDBOOK_CATALOG: readonly WordbookDefinition[] = loaded.catalog;

/** 词书目录中的词书数量（供 UI 与测试断言） */
export const WORDBOOK_COUNT = WORDBOOK_CATALOG.length;

/**
 * 词书定义 → 可安装的预设包（term 索引 join 共享池）。
 *
 * @param book 词书定义（来自 WORDBOOK_CATALOG）
 * @returns 完整 PresetPackage（id = 词书 id；安装器按 id 键控进度与完成标记）
 */
export function getWordbookPackage(book: WordbookDefinition): PresetPackage {
  const entries = book.terms.map((term, index) => {
    const entry = WORDBOOK_POOL.get(term.toLowerCase());
    if (!entry) {
      throw new Error(`词书 ${book.id} 的 term 在共享池缺失："${term}"（索引 #${index}）`);
    }
    return entry;
  });
  return {
    id: book.id,
    version: WORDBOOK_DATA_VERSION,
    name: book.name,
    description: book.description,
    source: WORDBOOK_SOURCE,
    lang: "en",
    entries,
  };
}
