/**
 * 领域实体 id：nanoid 字符串，带类型前缀，便于在事件流与日志中区分实体。
 *
 * 前缀约定：item（学习条目）、sense（义项）、evt（事件）、nb（生词本条目）、
 * cl（自定义列表）、cle（自定义列表条目）。条目与义项的 id 不校验实体存在性
 * （可能先出现在事件里）。
 */

/** 学习条目 id */
export type ItemId = string & { readonly __itemId: unique symbol };

/** 义项（sense）id */
export type SenseId = string & { readonly __senseId: unique symbol };

/** 事件 id */
export type EventId = string & { readonly __eventId: unique symbol };

/** 生词本条目 id */
export type NotebookEntryId = string & { readonly __notebookEntryId: unique symbol };

/** 自定义列表 id（RAY-325） */
export type CustomListId = string & { readonly __customListId: unique symbol };

/** 自定义列表条目 id（RAY-325） */
export type CustomListEntryId = string & { readonly __customListEntryId: unique symbol };

/** id 类型的字母前缀 */
export type IdPrefix = "item" | "sense" | "evt" | "nb" | "cl" | "cle";

/** 随机串字母表（去除易混淆的 l/1/O/0） */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 在 [min, max) 内取随机整数（可注入 rng 以支持测试） */
function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min)) + min;
}

/** 生成带类型前缀的随机 id */
export function createId(prefix: IdPrefix, length = 10, rng: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < length; i += 1) {
    body += ALPHABET[randomInt(0, ALPHABET.length, rng)];
  }
  return `${prefix}_${body}`;
}

/** 从任意字符串转成 ItemId（导入的数据与内部创建的 id 共用此入口） */
export function toItemId(id: string): ItemId {
  return id as ItemId;
}

/** 从任意字符串转成 SenseId */
export function toSenseId(id: string): SenseId {
  return id as SenseId;
}

/** 从任意字符串转成 EventId */
export function toEventId(id: string): EventId {
  return id as EventId;
}

/** 从任意字符串转成 NotebookEntryId */
export function toNotebookEntryId(id: string): NotebookEntryId {
  return id as NotebookEntryId;
}

/** 从任意字符串转成 CustomListId（RAY-325） */
export function toCustomListId(id: string): CustomListId {
  return id as CustomListId;
}

/** 从任意字符串转成 CustomListEntryId（RAY-325） */
export function toCustomListEntryId(id: string): CustomListEntryId {
  return id as CustomListEntryId;
}

/** 判断字符串是否带指定类型前缀 */
export function hasIdPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}
