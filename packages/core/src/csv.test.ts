import { describe, expect, it } from "vitest";
import { CsvFormatError, parseCsvWordlist } from "./csv";

describe("parseCsvWordlist（CSV 词表解析与格式校验）", () => {
  it("解析标准两列格式（无表头）：term,definition", () => {
    const { entries } = parseCsvWordlist("apple,苹果\nbook,书");
    expect(entries).toEqual([
      { term: "apple", definitions: ["苹果"] },
      { term: "book", definitions: ["书"] },
    ]);
  });

  it("解析三列格式：term,definition,pos", () => {
    const { entries } = parseCsvWordlist("apple,苹果,n.\nbook,书,n.");
    expect(entries).toEqual([
      { term: "apple", definitions: ["苹果"], pos: "n." },
      { term: "book", definitions: ["书"], pos: "n." },
    ]);
  });

  it("解析带表头的格式（列名大小写不敏感、顺序任意）", () => {
    const csv = "Definition,POS,Term\n苹果,n.,apple\n书,n.,book";
    const { entries } = parseCsvWordlist(csv);
    expect(entries).toEqual([
      { term: "apple", definitions: ["苹果"], pos: "n." },
      { term: "book", definitions: ["书"], pos: "n." },
    ]);
  });

  it("表头为两列时（无 pos 列）按表头映射", () => {
    const { entries } = parseCsvWordlist("term,definition\napple,苹果\nbook,书");
    expect(entries).toEqual([
      { term: "apple", definitions: ["苹果"] },
      { term: "book", definitions: ["书"] },
    ]);
  });

  it("释义内的逗号须加引号（RFC 4180 风格）", () => {
    const { entries } = parseCsvWordlist('term,definition\napple,"苹果，一种水果"\nbook,书');
    expect(entries[0]).toEqual({ term: "apple", definitions: ["苹果，一种水果"] });
    expect(entries[1]).toEqual({ term: "book", definitions: ["书"] });
  });

  it("容错处理未闭合的引号（释义延伸到行尾）", () => {
    const { entries } = parseCsvWordlist('term,definition\napple,"苹果, 一种水果\nbook,书');
    expect(entries[0]).toEqual({ term: "apple", definitions: ["苹果, 一种水果"] });
  });

  it('双引号转义（"" → "）', () => {
    const { entries } = parseCsvWordlist('term,definition\napple,"带""引号""的释义"');
    expect(entries[0]?.definitions).toEqual(['带"引号"的释义']);
  });

  it("释义用全角分号拆分多条", () => {
    const { entries } = parseCsvWordlist("apple,苹果；一种水果\nbook,书");
    expect(entries[0]?.definitions).toEqual(["苹果", "一种水果"]);
  });

  it("支持 CRLF 换行与文件末尾空行", () => {
    const { entries } = parseCsvWordlist("term,definition\r\napple,苹果\r\nbook,书\r\n");
    expect(entries).toHaveLength(2);
  });

  it("空行（含引号空串行）跳过，不是错误", () => {
    const { entries } = parseCsvWordlist('apple,苹果\n""\nbook,书');
    expect(entries).toEqual([
      { term: "apple", definitions: ["苹果"] },
      { term: "book", definitions: ["书"] },
    ]);
  });

  it("空文件（或仅空白）得到空列表", () => {
    expect(parseCsvWordlist("").entries).toEqual([]);
    expect(parseCsvWordlist("   \n  ").entries).toEqual([]);
  });

  it("兼容常见词条形态：连字符、撇号、缩写点", () => {
    const { entries } = parseCsvWordlist("well-known,众所周知的\ndon't,不要\nMr.,先生");
    expect(entries.map((entry) => entry.term)).toEqual(["well-known", "don't", "Mr."]);
  });

  it("UTF-8 BOM header imports cleanly (Excel export, regression guard)", () => {
    // U+FEFF at file start; first header cell keeps the BOM, trimmed away by trim().
    // Source must stay ASCII: build the BOM with an escape sequence, not a literal char.
    const { entries } = parseCsvWordlist("\uFEFFterm,definition\napple,苹果");
    expect(entries).toEqual([{ term: "apple", definitions: ["苹果"] }]);
  });

  describe("格式错误：明确提示（行号 + 原因）", () => {
    it("列数不足", () => {
      // 无表头词表：首行即数据，单列报「第 1 行 列数不足」
      expect(() => parseCsvWordlist("apple\nbanana")).toThrow(CsvFormatError);
      try {
        parseCsvWordlist("apple\nbanana");
      } catch (error) {
        expect(error).toBeInstanceOf(CsvFormatError);
        const csvError = error as CsvFormatError;
        expect(csvError.line).toBe(1);
        expect(csvError.message).toContain("第 1 行");
        expect(csvError.message).toContain("列数不足");
      }
      // 带表头词表：数据行报数据行号
      try {
        parseCsvWordlist("term,definition\napple\nbanana");
      } catch (error) {
        expect(error).toBeInstanceOf(CsvFormatError);
        expect((error as CsvFormatError).line).toBe(2);
      }
    });

    it("单词为空", () => {
      expect(() => parseCsvWordlist("term,definition\n,苹果")).toThrow(/第 2 行：单词为空/);
    });

    it("单词格式非法（含数字或非字母字符）", () => {
      expect(() => parseCsvWordlist("apple2,苹果")).toThrow(/第 1 行：单词格式非法/);
      expect(() => parseCsvWordlist("苹 果,苹果")).toThrow(/第 1 行：单词格式非法/);
      // 超长非法词条：错误信息中截断展示（避免撑爆提示）
      expect(() => parseCsvWordlist(`${"9".repeat(30)},苹果`)).toThrow(/格式非法/);
      expect(() => parseCsvWordlist(`${"9".repeat(30)},苹果`)).toThrow(/…/);
    });

    it("释义缺失", () => {
      expect(() => parseCsvWordlist("term,definition\napple,")).toThrow(
        /第 2 行：单词 "apple" 缺少释义/,
      );
    });

    it("释义仅含空白/分号（拆分后为空）", () => {
      expect(() => parseCsvWordlist("apple,；；")).toThrow(/第 1 行：单词 "apple" 的释义为空/);
    });

    it("字段过长（防极端输入）", () => {
      const longTerm = "a".repeat(501);
      const longDef = "苹".repeat(501);
      const longPos = "n".repeat(501);
      expect(() => parseCsvWordlist(`${longTerm},苹果`)).toThrow(/单词过长/);
      expect(() => parseCsvWordlist(`apple,${longDef}`)).toThrow(/释义过长/);
      expect(() => parseCsvWordlist(`apple,苹果,${longPos}`)).toThrow(/词性过长/);
    });

    it("带表头时报告正确的数据行号（表头不算入）", () => {
      try {
        parseCsvWordlist("term,definition\napple,苹果\nbad-row");
      } catch (error) {
        expect(error).toBeInstanceOf(CsvFormatError);
        expect((error as CsvFormatError).line).toBe(3);
      }
    });
  });

  it("整份数据要么全通过要么全拒绝：任一行非法即抛错", () => {
    // 第 2 行合法、第 3 行非法——整体拒绝，不返回部分结果
    expect(() => parseCsvWordlist("apple,苹果\nbook,书\n9lives,九条命")).toThrow(/第 3 行/);
  });
});
