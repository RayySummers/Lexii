/**
 * RAY-262 考试分级词书共享定义（打包脚本专用，不进运行时）。
 *
 * 词书口径唯一定义在本文件：build.mjs（打包生成 books.data.json）与
 * analyze.mjs（词数/去重比例/截断口径实测统计）import 同一份定义，
 * 消除双处维护漂移（同 core 侧 TERM_PATTERN 共享模式，RAY-260 评审 nit 1）。
 *
 * 口径（Jack 2026-08-15 拍板，路线 B）：
 * - 8 本单 tag 词书（中考/高考/四级/六级/考研/托福/雅思/GRE）；
 * - 「专四冲刺」= tag ∈ {cet6,toefl} 合并去重；
 * - 「专八冲刺」= tag ∈ {gre,toefl,ielts} 合并去重后按词频截断至与
 *   「专四冲刺」同词数（同量级）；排序 frq desc → bnc desc → term asc
 *   （确定性并列裁决）；
 * - 两条冲刺词书为「层次近似词书，非官方专四/专八名单」，命名与描述
 *   必须注明（红线）。
 */
import { TAG_LABELS } from "./ecdict.mjs";

/**
 * 考试分级词书定义。
 *
 * - `tagList`：ECDICT 考试标签组合（任含其一即入词书）；
 * - `category`："exam"（考试词汇）/ "sprint"（冲刺词书），UI 分组展示用；
 * - `description`：面向用户的说明文案（词数在调用时注入）；冲刺词书
 *   必须注明「层次近似词书，非官方专四/专八名单」；
 * - `cutoffToId`：词频截断目标（截到与该词书同词数）。
 */
export const BOOK_DEFS = [
  { id: "book-zk", category: "exam", name: "中考词汇", tagList: ["zk"] },
  { id: "book-gk", category: "exam", name: "高考词汇", tagList: ["gk"] },
  { id: "book-cet4", category: "exam", name: "大学英语四级", tagList: ["cet4"] },
  { id: "book-cet6", category: "exam", name: "大学英语六级", tagList: ["cet6"] },
  { id: "book-ky", category: "exam", name: "考研词汇", tagList: ["ky"] },
  { id: "book-toefl", category: "exam", name: "托福词汇", tagList: ["toefl"] },
  { id: "book-ielts", category: "exam", name: "雅思词汇", tagList: ["ielts"] },
  { id: "book-gre", category: "exam", name: "GRE 词汇", tagList: ["gre"] },
  {
    id: "book-tem4",
    category: "sprint",
    name: "专四冲刺（近似词书）",
    tagList: ["cet6", "toefl"],
    description: (count) =>
      `层次近似词书，非官方专四名单：由 ECDICT 六级与托福标签词条合并去重（${count} 词），供专四备考冲刺参考，不代表官方专四词汇表。`,
  },
  {
    id: "book-tem8",
    category: "sprint",
    name: "专八冲刺（近似词书）",
    tagList: ["gre", "toefl", "ielts"],
    cutoffToId: "book-tem4",
    description: (count) =>
      `层次近似词书，非官方专八名单：由 ECDICT GRE、托福与雅思标签词条合并并按词频截断（${count} 词，与专四冲刺同量级），供专八备考冲刺参考，不代表官方专八词汇表。`,
  },
];

/** 常规考试词书描述（词数调用时注入；冲刺词书用自己的口径文案） */
export function examBookDescription(tagList, count) {
  const labels = tagList.map((tag) => TAG_LABELS[tag] ?? tag).join("、");
  return `ECDICT ${labels}（${tagList.join("/")}）标签词条，清洗去重后 ${count} 词。`;
}

/** 词频降序排序（专八截断口径）：frq desc → bnc desc → term asc（确定性并列裁决） */
export function byFrequencyDesc(a, b) {
  return b.frq - a.frq || b.bnc - a.bnc || a.term.localeCompare(b.term);
}

/**
 * 按词书定义选词（含「专八冲刺」词频截断），返回 id → 词条数组的 Map。
 * 词条按 term 升序排列（与共享池顺序一致）。
 *
 * @param {Array<import("./ecdict.mjs").CleanedEntry>} cleanedAll 清洗后的全部词条
 * @returns {Map<string, Array<import("./ecdict.mjs").CleanedEntry>>}
 */
export function selectBookEntries(cleanedAll) {
  const bookEntriesById = new Map();
  for (const def of BOOK_DEFS) {
    let entries = cleanedAll
      .filter((entry) => entry.examTags.some((tag) => def.tagList.includes(tag)))
      .sort((a, b) => a.term.localeCompare(b.term));
    if (def.cutoffToId) {
      const targetCount = bookEntriesById.get(def.cutoffToId).length;
      entries = [...entries]
        .sort(byFrequencyDesc)
        .slice(0, targetCount)
        .sort((a, b) => a.term.localeCompare(b.term));
    }
    bookEntriesById.set(def.id, entries);
  }
  return bookEntriesById;
}
