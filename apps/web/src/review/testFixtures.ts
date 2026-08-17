/**
 * 复习模块测试夹具（仅测试使用）。
 *
 * 用 `toItemId` / `toSenseId` 把字符串铸成品牌类型；时间与 id 由内部计数器
 * 递增，保证同文件内夹具互不冲突。
 */
import { newCardFields } from "@lexii/fsrs";
import { toItemId, toSenseId } from "@lexii/core";
import type {
  IsoDate,
  LearningItem,
  MemoryState,
  MemoryStateFields,
  Sense,
  SenseId,
} from "@lexii/core";
import type { ReviewCard } from "./types";

let counter = 0;

/** 递增计数生成可预测的测试数据（调用一次 +1） */
function next(): number {
  counter += 1;
  return counter;
}

export function makeSense(overrides: Partial<Sense> = {}): Sense {
  const n = next();
  return {
    id: toSenseId(`sense_test_${n}`),
    lang: "en",
    term: `term-${n}`,
    definitions: [`释义 ${n}`],
    tags: [],
    examples: [],
    ...overrides,
  };
}

export function makeItem(senseId: SenseId, overrides: Partial<LearningItem> = {}): LearningItem {
  const n = next();
  return {
    id: toItemId(`item_test_${n}`),
    createdAt: `2026-08-0${(n % 9) + 1}T00:00:00.000Z`,
    updatedAt: `2026-08-0${(n % 9) + 1}T00:00:00.000Z`,
    source: "测试词表",
    senseId,
    kind: "word",
    status: "active",
    ...overrides,
  };
}

export function makeMemory(
  itemId: LearningItem["id"],
  fieldsOverrides: Partial<MemoryStateFields> = {},
  overrides: Partial<MemoryState> = {},
): MemoryState {
  const time = "2026-08-01T00:00:00.000Z";
  return {
    id: itemId,
    itemId,
    fields: { ...newCardFields({ now: time }), ...fieldsOverrides },
    createdAt: time,
    updatedAt: time,
    ...overrides,
  };
}

export function makeCard(
  overrides: Partial<ReviewCard> = {},
  fieldsOverrides: Partial<MemoryStateFields> = {},
): ReviewCard {
  const sense = makeSense();
  const item = makeItem(sense.id);
  const memory = makeMemory(item.id, fieldsOverrides);
  return { item, sense, memory, ...overrides };
}

/** 未来时间（相对 now 偏移毫秒），ISO 格式 */
export function futureIso(now: Date, offsetMs: number): IsoDate {
  return new Date(now.getTime() + offsetMs).toISOString();
}

/** 过去时间（相对 now 偏移毫秒），ISO 格式 */
export function pastIso(now: Date, offsetMs: number): IsoDate {
  return new Date(now.getTime() - offsetMs).toISOString();
}
