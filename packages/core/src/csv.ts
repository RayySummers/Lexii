/**
 * CSV 词表解析与格式校验（纯函数，无 I/O）。
 *
 * 支持两种常见词表格式（MVP 接受范围）：
 * 1. 标准三列：term,definition,pos（词性可选，兼容两列变体）
 * 2. 带表头映射：header 含 term 与 definition 两列（大小写不敏感、
 *    顺序任意），其他列忽略
 *
 * 格式错误必须给出明确提示（行号 + 原因），整份数据要么全通过要么全拒绝，
 * 绝不静默丢弃行。中文释义栏内的逗号须加引号（RFC 4180 风格，容错处理
 * 未闭合引号）。
 */
import type { LanguageCode } from "./domain";

/** 词表默认语言（MVP 固定英语词条） */
export const DEFAULT_WORDLIST_LANG: LanguageCode = "en";

/** 单行最大解析宽度（词条/释义等字段的上限，防极端输入） */
const MAX_FIELD_LENGTH = 500;

/** 单词词条模式：字母、撇号、连字符、点（如 "well-known"、"Mr."） */
const TERM_PATTERN = /^[A-Za-z][A-Za-z'-]*[.]?$/;

/** 表头列名（不区分大小写） */
const TERM_HEADERS = new Set(["term", "word"]);
const DEFINITION_HEADERS = new Set(["definition", "meaning", "def"]);
const POS_HEADERS = new Set(["pos", "partofspeech", "speech"]);

/** 解析成功的一行词表数据 */
export interface CsvWordEntry {
  /** 词条 */
  term: string;
  /** 中文释义（≥1 条，第一条为主释义） */
  definitions: string[];
  /** 词性（可选） */
  pos?: string;
}

/** 整份词表的解析结果：合法时 entries 为全部行 */
export interface CsvParseResult {
  entries: CsvWordEntry[];
}

/** 格式错误类型 */
export class CsvFormatError extends Error {
  /** 1 起始的行号（数据行；表头行不算入） */
  readonly line: number;

  constructor(line: number, message: string) {
    super(`第 ${line} 行：${message}`);
    this.name = "CsvFormatError";
    this.line = line;
  }
}

/**
 * 解析 CSV 文本为词条列表。
 *
 * @param text CSV 原始文本（任意换行风格；允许空文件 → 空列表）
 * @throws CsvFormatError 任一数据行格式非法时抛出（带行号与原因）
 */
export function parseCsvWordlist(text: string): CsvParseResult {
  const rows = splitCsvRows(text);
  if (rows.length === 0) {
    return { entries: [] };
  }
  const { plan, hasHeader } = planColumns(parseCsvLine(rows[0]!));
  const startRow = hasHeader ? 1 : 0;
  const entries: CsvWordEntry[] = [];
  for (let i = startRow; i < rows.length; i += 1) {
    const cells = parseCsvLine(rows[i]!);
    if (cells.length === 1 && cells[0] === "") {
      continue; // 空行跳过（不是错误，常见于文件末尾）
    }
    entries.push(parseDataRow(cells, plan, i + 1));
  }
  return { entries };
}

/** 按行切分（兼容 \r\n / \n / \r），跳过完全空白的行 */
function splitCsvRows(text: string): string[] {
  return text.split(/\r\n|\n|\r/).filter((row) => row.trim() !== "");
}

/**
 * 解析单行 CSV 为单元格（RFC 4180 风格）：
 * - 逗号分隔；
 * - 引号包裹字段：可含逗号/换行，"" 转义为 "；
 * - 容错：行末未闭合引号视为「该字段延伸到行尾」（释义手写加引号常见错误）。
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === "") {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** 列映射方案：term/definition 必填，pos 可选 */
interface ColumnPlan {
  term: number;
  definition: number;
  pos: number | null;
}

/**
 * 根据首行决定列映射与是否带表头：
 * - 首行能匹配到 term/definition 表头（大小写不敏感、顺序任意）→ 带表头，
 *   数据从第 2 行开始；
 * - 否则视为无表头词表，首行即数据，按「term, definition[, pos]」位置映射。
 */
function planColumns(firstRow: string[]): { plan: ColumnPlan; hasHeader: boolean } {
  const term = firstRow.findIndex((name) => TERM_HEADERS.has(name.toLowerCase()));
  const definition = firstRow.findIndex((name) => DEFINITION_HEADERS.has(name.toLowerCase()));
  if (term >= 0 && definition >= 0) {
    const pos = firstRow.findIndex((name) => POS_HEADERS.has(name.toLowerCase()));
    return { plan: { term, definition, pos: pos >= 0 ? pos : null }, hasHeader: true };
  }
  // 无表头：按「term, definition[, pos]」的位置默认
  return {
    plan: { term: 0, definition: 1, pos: firstRow.length >= 3 ? 2 : null },
    hasHeader: false,
  };
}

/** 校验并转换一个数据行（line 为 1 起始的行号） */
function parseDataRow(cells: string[], plan: ColumnPlan, line: number): CsvWordEntry {
  if (cells.length < 2) {
    throw new CsvFormatError(line, "列数不足（至少需要「单词,释义」两列）");
  }
  const termCell = cells[plan.term];
  const definitionCell = cells[plan.definition];
  const posCell = plan.pos !== null && plan.pos < cells.length ? cells[plan.pos] : undefined;

  if (!termCell || termCell === "") {
    throw new CsvFormatError(line, "单词为空");
  }
  if (!TERM_PATTERN.test(termCell)) {
    throw new CsvFormatError(
      line,
      `单词格式非法："${truncate(termCell)}"（仅支持英文字母、'、-、.）`,
    );
  }
  if (termCell.length > MAX_FIELD_LENGTH) {
    throw new CsvFormatError(line, `单词过长（超过 ${MAX_FIELD_LENGTH} 字符）`);
  }
  if (!definitionCell || definitionCell === "") {
    throw new CsvFormatError(line, `单词 "${termCell}" 缺少释义`);
  }
  if (definitionCell.length > MAX_FIELD_LENGTH) {
    throw new CsvFormatError(
      line,
      `单词 "${termCell}" 的释义过长（超过 ${MAX_FIELD_LENGTH} 字符）`,
    );
  }
  const definitions = definitionCell
    .split("；")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (definitions.length === 0) {
    throw new CsvFormatError(line, `单词 "${termCell}" 的释义为空`);
  }
  if (posCell && posCell.length > MAX_FIELD_LENGTH) {
    throw new CsvFormatError(
      line,
      `单词 "${termCell}" 的词性过长（超过 ${MAX_FIELD_LENGTH} 字符）`,
    );
  }
  return {
    term: termCell,
    definitions,
    ...(posCell ? { pos: posCell } : {}),
  };
}

function truncate(value: string): string {
  return value.length > 20 ? `${value.slice(0, 20)}…` : value;
}
