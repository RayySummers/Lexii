/**
 * 词书库装载校验（RAY-262）。
 *
 * 真实生成物（packages/core/src/presets/books.data.json）的完整性断言：
 * 词书目录、词数（与打包侧审计一致）、共享池形状、term join 往返、
 * 冲刺词书口径红线。生成物由 scripts/presets/build.mjs --books 产出，
 * 本测试保证「生成 → 装载」契约不被破坏（如脚本输出格式变更须同步此处）。
 */
import { describe, expect, it } from "vitest";
import { TERM_PATTERN } from "../csv";
import {
  getWordbookPackage,
  WORDBOOK_CATALOG,
  WORDBOOK_COUNT,
  WORDBOOK_DATA_VERSION,
  WORDBOOK_POOL,
  WORDBOOK_SOURCE,
} from "./books";

/** 打包侧审计词数（scripts/presets/build.mjs --books 实测） */
const EXPECTED_TERM_COUNTS: Record<string, number> = {
  "book-zk": 1602,
  "book-gk": 3677,
  "book-cet4": 3846,
  "book-cet6": 5406,
  "book-ky": 4801,
  "book-toefl": 6970,
  "book-ielts": 5038,
  "book-gre": 7504,
  "book-tem4": 8569,
  "book-tem8": 8569,
};

describe("WORDBOOK_CATALOG（词书目录）", () => {
  it("10 本词书：8 本考试词汇 + 专四/专八冲刺，id 唯一且顺序稳定", () => {
    expect(WORDBOOK_COUNT).toBe(10);
    expect(WORDBOOK_CATALOG.map((book) => book.id)).toEqual([
      "book-zk",
      "book-gk",
      "book-cet4",
      "book-cet6",
      "book-ky",
      "book-toefl",
      "book-ielts",
      "book-gre",
      "book-tem4",
      "book-tem8",
    ]);
    const exam = WORDBOOK_CATALOG.filter((book) => book.category === "exam");
    const sprint = WORDBOOK_CATALOG.filter((book) => book.category === "sprint");
    expect(exam).toHaveLength(8);
    expect(sprint).toHaveLength(2);
  });

  it("每本词书元数据完整（名称/描述/词数），词数与打包侧审计一致", () => {
    for (const book of WORDBOOK_CATALOG) {
      expect(book.name, book.id).toBeTruthy();
      expect(book.description, book.id).toBeTruthy();
      expect(book.terms.length, book.id).toBe(EXPECTED_TERM_COUNTS[book.id]);
    }
  });

  it("冲刺词书同词数（GRE 剔除 + 真题补入后截断至同量级）", () => {
    const tem4 = WORDBOOK_CATALOG.find((book) => book.id === "book-tem4");
    const tem8 = WORDBOOK_CATALOG.find((book) => book.id === "book-tem8");
    expect(tem8?.terms.length).toBe(tem4?.terms.length);
    expect(tem8?.terms.length).toBeGreaterThan(8000);
  });

  it("冲刺词书命名与描述注明「层次近似词书，非官方专四/专八名单」（口径红线）", () => {
    const tem4 = WORDBOOK_CATALOG.find((book) => book.id === "book-tem4");
    const tem8 = WORDBOOK_CATALOG.find((book) => book.id === "book-tem8");
    expect(tem4?.name).toContain("近似词书");
    expect(tem4?.description).toContain("层次近似词书，非官方专四名单");
    expect(tem4?.description).toContain("不代表官方专四词汇表");
    expect(tem8?.name).toContain("近似词书");
    expect(tem8?.description).toContain("层次近似词书，非官方专八名单");
    expect(tem8?.description).toContain("不代表官方专八词汇表");
    expect(tem8?.description).toContain("词频截断");
  });

  it("词书 term 索引形状合法、升序、无重复", () => {
    for (const book of WORDBOOK_CATALOG) {
      const sorted = [...book.terms].sort((a, b) => a.localeCompare(b));
      expect(book.terms, book.id).toEqual(sorted);
      const seen = new Set<string>();
      for (const term of book.terms) {
        expect(TERM_PATTERN.test(term), `${book.id} → ${term}`).toBe(true);
        expect(seen.has(term.toLowerCase()), `${book.id} → ${term}`).toBe(false);
        seen.add(term.toLowerCase());
      }
    }
  });
});

describe("WORDBOOK_POOL（共享词条池）", () => {
  it("池词条形状合法（元组转换校验），term 键与池唯一", () => {
    expect(WORDBOOK_POOL.size).toBeGreaterThan(14000);
    for (const [key, entry] of WORDBOOK_POOL) {
      expect(key).toBe(entry.term.toLowerCase());
      expect(TERM_PATTERN.test(entry.term), entry.term).toBe(true);
      expect(entry.definitions.length, entry.term).toBeGreaterThan(0);
    }
  });

  it("全部词书的 term 都能在池中命中（join 无缺失）", () => {
    for (const book of WORDBOOK_CATALOG) {
      for (const term of book.terms) {
        expect(WORDBOOK_POOL.has(term.toLowerCase()), `${book.id} → ${term}`).toBe(true);
      }
    }
  });

  it("来源与许可声明、版本非空", () => {
    expect(WORDBOOK_SOURCE).toContain("ECDICT");
    expect(WORDBOOK_SOURCE).toContain("NGSL");
    expect(WORDBOOK_DATA_VERSION).toBeTruthy();
  });
});

describe("getWordbookPackage（词书定义 → 可安装包）", () => {
  it("join 后词条数与索引一致，包元信息完整（id = 词书 id）", () => {
    for (const book of WORDBOOK_CATALOG) {
      const preset = getWordbookPackage(book);
      expect(preset.id).toBe(book.id);
      expect(preset.name).toBe(book.name);
      expect(preset.description).toBe(book.description);
      expect(preset.version).toBe(WORDBOOK_DATA_VERSION);
      expect(preset.lang).toBe("en");
      expect(preset.source).toBe(WORDBOOK_SOURCE);
      expect(preset.entries).toHaveLength(book.terms.length);
      // join 出的词条与索引 term 一一对应（升序）
      expect(preset.entries.map((entry) => entry.term)).toEqual(book.terms);
    }
  });

  it("词条内容与池一致（释义/词性/音标/标签原样取出，不复制不重排）", () => {
    const book = WORDBOOK_CATALOG[0]!;
    const preset = getWordbookPackage(book);
    for (const entry of preset.entries) {
      const pooled = WORDBOOK_POOL.get(entry.term.toLowerCase());
      expect(entry).toEqual(pooled);
    }
  });

  it("组合词书词条来自对应标签集合 ∪ 真题高频词补入（RAY-274）", () => {
    const tem4 = WORDBOOK_CATALOG.find((book) => book.id === "book-tem4");
    const cet6 = WORDBOOK_CATALOG.find((book) => book.id === "book-cet6");
    const toefl = WORDBOOK_CATALOG.find((book) => book.id === "book-toefl");
    // RAY-274：冲刺词书现在包含 ECDICT {cet6,toefl} 标签词 + 真题高频词补入（P1），
    // P1 词不一定有 cet6/toefl 标签，但仍属于词书的有效内容。
    const tagAllowed = new Set([...(cet6?.terms ?? []), ...(toefl?.terms ?? [])]);
    const preset = getWordbookPackage(tem4!);
    // 断言：词条要么来自标签集合，要么在共享池中有完整词条数据（P1 补入词）
    for (const entry of preset.entries) {
      const inTagSet = tagAllowed.has(entry.term);
      const inPool = WORDBOOK_POOL.has(entry.term.toLowerCase());
      expect(inTagSet || inPool, `${entry.term}: not in tag set but ${inPool ? "in pool" : "missing from pool"}`).toBe(true);
    }
    expect(preset.entries.length).toBe(EXPECTED_TERM_COUNTS["book-tem4"]);
  });
});
