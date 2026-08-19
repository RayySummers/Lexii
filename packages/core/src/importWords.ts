/**
 * 词表导入：CSV 解析 → Sense / Learning Item / Memory State / import 事件。
 *
 * 对应 docs/domain-model.md §7（import 事件）与 RAY-242 的验收点：
 * - 格式错误在解析阶段（parseCsvWordlist）给出明确提示（行号 + 原因）；
 * - 整批导入在同一个 Dexie 事务内落库：任一环节失败整体回滚，
 *   不留下半份词表、不产生孤儿 import 事件；
 * - 同词条的重复行按重复导入处理（新条目，保持每行一条轨迹）；
 * - 每个新条目的记忆状态由 @lexii/fsrs 的 newCardFields() 初始化。
 */
import { newCardFields } from "@lexii/fsrs";
import { DEFAULT_WORDLIST_LANG, parseCsvWordlist } from "./csv";
import type { ExampleSentence, IsoDate, LanguageCode, LearningItem, Sense } from "./domain";
import { createId, toEventId, toItemId, toSenseId } from "./id";
import type { MemoryState } from "./memory";
import type { LexiiDatabase } from "./persistence";
/** 导入选项 */
export interface ImportWordsOptions {
  /** 词库标识（写入 LearningItem.source 与导入记录，如 "导入:四级词表.csv"） */
  source: string;
  /** 词条语言（BCP 47；默认 "en"，MVP 词库为英语词条） */
  lang?: LanguageCode;
  /** 导入发生时刻（ISO；默认调用方当前时间） */
  time?: IsoDate;
}

/** 导入结果 */
export interface ImportWordsResult {
  /** 新导入的条目数（即数据行数） */
  importedCount: number;
  /** 新条目 id 列表（按 CSV 行序） */
  itemIds: LearningItem["id"][];
}

/**
 * 把 CSV 词表文本导入数据库（解析 + 落库一气呵成，失败整体回滚）。
 *
 * @param db 已打开的 Lexii 数据库
 * @param csvText CSV 原始文本（格式见 csv.ts）
 * @param options 导入选项（source 必填，与许可证溯源挂钩）
 * @throws CsvFormatError 任一数据行格式非法（带行号与原因），库保持原样
 */
export async function importCsvWordlist(
  db: LexiiDatabase,
  csvText: string,
  options: ImportWordsOptions,
): Promise<ImportWordsResult> {
  const { entries } = parseCsvWordlist(csvText);
  const lang = options.lang ?? DEFAULT_WORDLIST_LANG;
  const time = options.time ?? new Date().toISOString();
  const itemIds: LearningItem["id"][] = [];

  await db.transaction("rw", db.senses, db.items, db.memoryStates, db.events, async () => {
    for (const entry of entries) {
      const sense = toSense(entry, lang);
      const itemId = toItemId(createId("item"));
      itemIds.push(itemId);
      await db.senses.put(sense);
      await db.items.put({
        id: itemId,
        createdAt: time,
        updatedAt: time,
        source: options.source,
        senseId: sense.id,
        kind: "word",
        status: "active",
      });
      await db.memoryStates.put(toMemoryState(itemId, time));
      await db.events.put({
        id: toEventId(createId("evt", 12)),
        type: "import",
        time,
        itemId,
        senseId: sense.id,
        term: sense.term,
        lang: sense.lang,
      });
    }
  });

  return { importedCount: entries.length, itemIds };
}

/** 词条内容（CSV 行 / 预设词表条目 / 富化合并共用：义项快照的输入形态） */
export interface WordEntryContent {
  term: string;
  definitions: string[];
  pos?: string;
  /** 逐条词性（可选，RAY-349）：与 definitions 等长，见 domain.ts 的 Sense.posByDefinition */
  posByDefinition?: string[];
  ipa?: string;
  tags?: string[];
  /** 富化字段（可选，见 presets/enrichment.ts 的合并口径） */
  ipaUs?: string;
  ipaUk?: string;
  synonyms?: string[];
  antonyms?: string[];
  derived?: string[];
  etymology?: string;
  wordParts?: string;
  etymologyZh?: string;
  examples?: ExampleSentence[];
}

/** 词条内容 → Sense（内容快照；释义用全角分号拆分多条） */
export function toSense(entry: WordEntryContent, lang: LanguageCode): Sense {
  return {
    id: toSenseId(createId("sense")),
    lang,
    term: entry.term,
    definitions: entry.definitions,
    ...(entry.pos ? { pos: entry.pos } : {}),
    ...(entry.posByDefinition?.some((item) => item !== "")
      ? { posByDefinition: entry.posByDefinition }
      : {}),
    ...(entry.ipa ? { ipa: entry.ipa } : {}),
    ...(entry.ipaUs ? { ipaUs: entry.ipaUs } : {}),
    ...(entry.ipaUk ? { ipaUk: entry.ipaUk } : {}),
    ...(entry.synonyms ? { synonyms: entry.synonyms } : {}),
    ...(entry.antonyms ? { antonyms: entry.antonyms } : {}),
    ...(entry.derived ? { derived: entry.derived } : {}),
    ...(entry.etymology ? { etymology: entry.etymology } : {}),
    ...(entry.wordParts ? { wordParts: entry.wordParts } : {}),
    ...(entry.etymologyZh ? { etymologyZh: entry.etymologyZh } : {}),
    tags: entry.tags ?? [],
    examples: entry.examples ?? [],
  };
}

/** 新条目的初始记忆状态（@lexii/fsrs 的 newCardFields，due = 导入时刻，导入即到期） */
export function toMemoryState(itemId: LearningItem["id"], time: IsoDate): MemoryState {
  const fields = newCardFields({ now: time });
  return {
    id: itemId,
    itemId,
    fields,
    createdAt: time,
    updatedAt: time,
  };
}
