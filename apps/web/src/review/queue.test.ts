import { describe, expect, it } from "vitest";
import { buildReviewQueue } from "./queue";
import { makeItem, makeMemory, makeSense, pastIso } from "./testFixtures";

const NOW = new Date("2026-08-10T12:00:00.000Z").toISOString();
const DUE_PAST = pastIso(new Date(NOW), 60_000);

describe("buildReviewQueue", () => {
  it("空输入返回空队列", () => {
    expect(buildReviewQueue([], [], [], NOW)).toEqual([]);
  });

  it("组装完整的三表对齐数据为一张卡", () => {
    const sense = makeSense({ term: "apple" });
    const item = makeItem(sense.id);
    const memory = makeMemory(item.id, { due: DUE_PAST });

    const cards = buildReviewQueue([item], [sense], [memory], NOW);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.item).toBe(item);
    expect(cards[0]?.sense).toBe(sense);
    expect(cards[0]?.memory).toBe(memory);
  });

  it("过滤非 active 条目（suspended / deleted 不出现在队列）", () => {
    const sense = makeSense();
    const suspended = makeItem(sense.id, { status: "suspended" });
    const deleted = makeItem(sense.id, { status: "deleted" });
    const active = makeItem(sense.id);
    const cards = buildReviewQueue(
      [suspended, deleted, active],
      [sense, sense, sense],
      [
        makeMemory(suspended.id, { due: DUE_PAST }),
        makeMemory(deleted.id, { due: DUE_PAST }),
        makeMemory(active.id, { due: DUE_PAST }),
      ],
      NOW,
    );

    expect(cards.map((card) => card.item.id)).toEqual([active.id]);
  });

  it("缺失条目 / 义项 / 记忆状态时跳过该槽位", () => {
    const sense = makeSense();
    const item = makeItem(sense.id);
    const memory = makeMemory(item.id, { due: DUE_PAST });

    // 槽位 0：条目缺失；槽位 2：义项缺失；槽位 4：记忆状态缺失
    const cards = buildReviewQueue(
      [undefined, item, item, item],
      [sense, sense, undefined, sense],
      [memory, memory, memory, undefined],
      NOW,
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]?.item.id).toBe(item.id);
  });

  it("过滤 due 晚于 now 的卡（未来卡不提前进队列）", () => {
    const future = new Date("2026-08-11T12:00:00.000Z").toISOString(); // now + 1 天
    const sense = makeSense();
    const futureItem = makeItem(sense.id);
    const dueItem = makeItem(sense.id);
    const cards = buildReviewQueue(
      [futureItem, dueItem],
      [sense, sense],
      [makeMemory(futureItem.id, { due: future }), makeMemory(dueItem.id, { due: DUE_PAST })],
      NOW,
    );

    expect(cards.map((card) => card.item.id)).toEqual([dueItem.id]);
  });

  it("保持输入顺序（排序与穿插由 core 的 getStudyQueueItemIds 决定，本函数不重排）", () => {
    const a = makeCardLike("2026-08-10T00:00:00.000Z", "2026-08-03T00:00:00.000Z");
    const b = makeCardLike("2026-08-09T00:00:00.000Z", "2026-08-01T00:00:00.000Z"); // due 更早但排在输入第二位
    const c = makeCardLike("2026-08-08T00:00:00.000Z", "2026-08-05T00:00:00.000Z");

    const cards = buildReviewQueue(
      [a.item, b.item, c.item],
      [a.sense, b.sense, c.sense],
      [a.memory, b.memory, c.memory],
      NOW,
    );

    expect(cards.map((card) => card.item.id)).toEqual([a.item.id, b.item.id, c.item.id]);
  });

  it("due 恰等于 now 的卡视为到期（<= 比较）", () => {
    const sense = makeSense();
    const item = makeItem(sense.id);
    const cards = buildReviewQueue([item], [sense], [makeMemory(item.id, { due: NOW })], NOW);
    expect(cards).toHaveLength(1);
  });
});

/** 构造「指定 due 与 createdAt」的完整夹具三元组 */
function makeCardLike(due: string, createdAt: string) {
  const sense = makeSense();
  const item = makeItem(sense.id, { createdAt, updatedAt: createdAt });
  const memory = makeMemory(item.id, { due });
  return { item, sense, memory };
}
