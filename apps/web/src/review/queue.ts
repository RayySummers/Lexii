/**
 * 复习队列构建（纯函数）。
 *
 * 与 @lexilexi/core 的分工：`getStudyQueueItemIds` 负责「哪些记忆状态
 * 进入队列、按什么顺序」（含三模式的筛选、排序与混合穿插），本函数负责
 * 「id 列表 → 可复习卡片」的完整性校验——这是 UI 侧的装配逻辑，不含任何
 * 调度算法，也不重排队列顺序。
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
 * - 仅保留 status === "active" 的条目（getStudyQueueItemIds 不区分条目状态，
 *   已删除 / 已暂停条目的到期记忆状态必须被过滤掉）；
 * - 仅保留 due <= now 的卡（防御式：与 getStudyQueueItemIds 的口径保持一致，
 *   防止调用方传错时间导致未来卡提前进入队列）；
 * - 保持输入顺序：队列组成与排序（due 升序 / 混合穿插）由
 *   @lexilexi/core 的 getStudyQueueItemIds 决定，本函数不得重排
 *   （RAY-253 三模式队列的穿插顺序必须原样保留）。
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
  return cards;
}
