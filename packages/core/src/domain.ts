/**
 * Learning Item（学习条目）与 Sense（义项）。
 *
 * 对应 docs/domain-model.md §3、§4：
 * - Learning Item 是用户要掌握的最小学习对象：一个词条的「一个词义」。
 *   同一词条多个词义 = 多个 Learning Item，各自独立调度（与 @lexilexi/fsrs 的对接契约）。
 * - Sense 是词义快照（词条、语言、释义），是 Learning Item 的内容部分，不含调度状态。
 */
import type { ItemId, SenseId } from "./id";

/** ISO-8601 毫秒时间戳（UTC） */
export type IsoDate = string;

/** 条目状态流转：active ⇄ suspended 可逆；→ deleted 不可逆（历史事件保留） */
export type ItemStatus = "active" | "suspended" | "deleted";

/** MVP 条目类型仅词条；未来可扩展 "phrase" / "sentence" */
export type ItemKind = "word";

/** BCP 47 语言代码（MVP 词库固定 "en"） */
export type LanguageCode = string;

/** 例句 */
export interface ExampleSentence {
  /** 原文例句 */
  text: string;
  /** 中文翻译 */
  translation: string;
}

/**
 * 义项（Sense）：词义内容快照。
 *
 * 内容修正（改释义、补例句）直接 put 覆盖，不影响调度状态。
 * audioUrl 为 PWA 内本地 Blob URL，不得指向外部服务（local-first 红线）。
 */
export interface Sense {
  id: SenseId;
  /** 词条语言，BCP 47 */
  lang: LanguageCode;
  /** 词条原文 */
  term: string;
  /** 中文释义，至少一条，第一条为主释义 */
  definitions: string[];
  /** 词性（可选，导入词库通常提供），如 "n." / "v." */
  pos?: string;
  /** 音标（可选） */
  ipa?: string;
  /** 美式音标（可选，富化数据提供；UI 优先展示双音标，缺省回退 ipa） */
  ipaUs?: string;
  /** 英式音标（可选，富化数据提供） */
  ipaUk?: string;
  /** 近义词（可选，富化数据提供） */
  synonyms?: string[];
  /** 反义词（可选，富化数据提供） */
  antonyms?: string[];
  /** 派生词（可选，富化数据提供） */
  derived?: string[];
  /** 词根词缀拆解（可选，富化数据提供，如 "a<加强> · bandon<控制>"） */
  wordParts?: string;
  /** 中文词源说明（可选，富化数据提供） */
  etymologyZh?: string;
  /** 发音文件（可选，本地 Blob URL） */
  audioUrl?: string;
  /** 词源（可选，YAML 前端不导入则缺省） */
  etymology?: string;
  /** 标签，如 ["四级", "高频"] */
  tags: string[];
  /** 例句（可空数组） */
  examples: ExampleSentence[];
}

/**
 * Learning Item：用户要掌握的最小学习对象。
 *
 * 一个词条的一个词义。senseId 不可变；删除时标记 status = "deleted"，
 * 同时标记其 Memory State，不物理清除历史事件。
 */
export interface LearningItem {
  id: ItemId;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  /** 来源词库标识（如 "导入:四级词表.csv"），与词典来源/许可证溯源挂钩 */
  source: string;
  /** 1─1 指向 Sense */
  senseId: SenseId;
  kind: ItemKind;
  status: ItemStatus;
}
