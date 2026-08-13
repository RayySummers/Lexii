/**
 * 复习队列构建（纯函数）。
 *
 * 与 @lexilexi/core 的分工：`getDueItemIds` 负责「哪些记忆状态到期」，
 * 本函数负责「到期条目 → 可复习卡片」的完整性校验与排序——
 * 这是 UI 侧的装配逻辑，不含任何调度算法。
 */
import type { IsoDate, LearningItem, MemoryState, Sense } from "@lexilexi/core";
import type { ReviewCard } from "./types";

/**
 * 从三张表的查询结果构建复习队列。
 *
 * 三个输入是「按 itemId 对齐的平行数组」（IndexedDB bulkGet 的结果形态）：
 * `items[i]` / `senses[i]` / `memories[i]` 对应同一条目；查询不到的槽位为
 * undefined。数据不完整（缺条目 / 缺义项 / 缺记忆状态）的槽位跳过——视为
 * 不可复习，绝不渲染半张卡。
 *
 * 规则：
 * - 仅保留 status === "active" 的条目（getDueItemIds 不区分条目状态，
 *   已删除 / 已暂停条目的到期记忆状态必须被过滤掉）；
 * - 仅保留 due <= now 的卡（防御式：与 getDueItemIds 的口径保持一致，
 *   防止调用方传错时间导致未来卡提前进入队列）；
 * - 排序：due 升序，同 due 时按 item.createdAt 升序决胜（先导入先复习）。
 */
export function buildReviewQueue(
  items: readonly (LearningItem | undefined)[],
  senses: readonly (Sense | undefined)[],
  memories: readonly (MemoryState | undefined)[],
  now: IsoDate,
): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const length = items.length;
  for (let i = 0; i < length; i++) {
    const item = items[i];
    const sense = senses[i];
    const memory = memories[i];
    if (!item || item.status !== "active") {
      continue;
    }
    if (!sense || !memory) {
      continue;
    }
    if (memory.fields.due > now) {
      continue;
    }
    cards.push({ item, sense, memory });
  }
  cards.sort(compareCards);
  return cards;
}

/** due 升序，createdAt 决胜（ISO-8601 同格式字符串可直接字典序比较） */
function compareCards(a: ReviewCard, b: ReviewCard): number {
  const byDue = a.memory.fields.due.localeCompare(b.memory.fields.due);
  if (byDue !== 0) {
    return byDue;
  }
  return a.item.createdAt.localeCompare(b.item.createdAt);
}
