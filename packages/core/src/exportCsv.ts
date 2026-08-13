/**
 * 词表导出：数据库 → CSV 文本（与 importCsvWordlist 的解析格式互逆）。
 *
 * 对应 docs/domain-model.md §7 与 RAY-245 的验收点「CSV 导出格式可读」：
 * - 输出表头 `term,definition,pos`（parseCsvWordlist 能识别的三列表头）；
 * - 多条释义用全角分号「；」连接（与导入解析的拆分规则一致，保证导回）；
 * - 字段含逗号 / 引号 / 换行时按 RFC 4180 加引号并转义（"" → "）；
 * - 只导出未删除（active / suspended）条目，按 createdAt 升序（稳定可复现）；
 * - 导出文本前置 UTF-8 BOM（Windows 中文版 Excel 打开中文释义不乱码；
 *   parseCsvWordlist 会忽略 BOM，round-trip 不受影响）。
 *
 * 导出边界（CSV 格式固有限制，详见 docs/domain-model.md §7）：
 * - CSV 只能承载 term / definitions / pos 三列；音标、标签、例句、记忆状态
 *   不在 CSV 范围内（完整备份请用 exportLexilexiData 的 JSON）；
 * - 释义本身含全角分号「；」的词条导回后会被拆成多条释义（「；」是多释义
 *   分隔符）；释义含换行的词条无法原样导回（解析器不支持字段内换行）；
 * - 词条须满足导入格式的单词模式（英文字母、'、-、.），否则无法经
 *   importCsvWordlist 导回——MVP 词库为英语单词，天然满足。
 * 因此「互逆」指常规词条（无上述特殊字符）；特殊内容以 JSON 备份为准。
 */
import type { CsvWordEntry } from "./csv";
import type { LearningItem, Sense } from "./domain";
import type { LexilexiDatabase } from "./persistence";

/** CSV 表头（与 parseCsvWordlist 的表头识别对齐：term / definition / pos） */
const CSV_HEADER = "term,definition,pos";

/** UTF-8 BOM（导出文件层前置，Excel 等工具识别编码用；解析侧会忽略） */
const UTF8_BOM = "\uFEFF";

/**
 * 把词条列表序列化为 CSV 文本（纯函数，无 I/O）。
 *
 * 产物保证能被 parseCsvWordlist 解析回等价的 CsvWordEntry 列表
 * （term / definitions / pos 三项，常规词条；边界见文件头注释）。
 * 注意：本函数不输出 BOM——BOM 是文件编码产物，由导出入口 exportCsvWordlist 添加。
 */
export function serializeWordlistCsv(entries: readonly CsvWordEntry[]): string {
  const lines: string[] = [CSV_HEADER];
  for (const entry of entries) {
    const definition = entry.definitions.join("；");
    lines.push([entry.term, definition, entry.pos ?? ""].map(escapeCsvCell).join(","));
  }
  return lines.join("\n");
}

/** 导出当前词表为 CSV 文本（仅未删除条目，按 createdAt 升序；前置 UTF-8 BOM） */
export async function exportCsvWordlist(db: LexilexiDatabase): Promise<string> {
  return db.transaction("r", db.items, db.senses, async () => {
    const items = await db.items.toArray();
    const kept = items.filter((item) => item.status !== "deleted").sort(byCreatedAt);
    const senses = await db.senses.bulkGet(kept.map((item) => item.senseId));
    const entries: CsvWordEntry[] = [];
    for (let i = 0; i < kept.length; i += 1) {
      const sense = senses[i];
      if (!sense) {
        continue; // 义项缺失的脏数据跳过，不产出空行（与复习队列的对齐策略一致）
      }
      entries.push(toCsvEntry(sense));
    }
    return UTF8_BOM + serializeWordlistCsv(entries);
  });
}

/** Sense → CSV 词条（只取 CSV 能承载的三列） */
function toCsvEntry(sense: Sense): CsvWordEntry {
  return {
    term: sense.term,
    definitions: sense.definitions,
    ...(sense.pos ? { pos: sense.pos } : {}),
  };
}

/** RFC 4180 单元格转义：含逗号 / 引号 / 换行时加引号，内部引号翻倍 */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function byCreatedAt(a: LearningItem, b: LearningItem): number {
  if (a.createdAt < b.createdAt) {
    return -1;
  }
  if (a.createdAt > b.createdAt) {
    return 1;
  }
  return 0;
}
