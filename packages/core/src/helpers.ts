/**
 * 测试夹具：构造合法的领域实体，避免各测试文件重复样板。
 */
import { createId, toEventId, toItemId, toSenseId } from "./id";
import type { IsoDate, LearningItem, Sense } from "./domain";
import type { MemoryState } from "./memory";
import type { ReviewEvent } from "./events";

/** 固定测试时刻（ISO-8601 UTC） */
export function now(): IsoDate {
  return "2026-08-13T10:00:00.000Z";
}

/** 构造一个合法 Sense（词条 "hello"） */
export function makeSense(id?: string): Sense {
  return {
    id: toSenseId(id ?? createId("sense")),
    lang: "en",
    term: "hello",
    definitions: ["你好；打招呼"],
    pos: "int.",
    ipa: "/həˈloʊ/",
    tags: ["四级"],
    examples: [{ text: "Hello, world.", translation: "你好，世界。" }],
  };
}

/** 构造一个合法 Learning Item（与给定 sense 关联） */
export function makeLearningItem(senseId: Sense["id"], id?: string): LearningItem {
  return {
    id: toItemId(id ?? createId("item")),
    createdAt: now(),
    updatedAt: now(),
    source: "测试",
    senseId,
    kind: "word",
    status: "active",
  };
}

/** 构造一份合法的 MemoryState（与给定 item 1─1 锚定） */
export function makeMemoryState(itemId: LearningItem["id"]): MemoryState {
  return {
    id: itemId,
    itemId,
    fields: {
      status: "new",
      due: "2026-08-14T10:00:00.000Z",
      stabilityDays: 1,
      difficulty: 4,
      elapsedDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReviewAt: null,
      lastRating: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

/** 构造一个合法的 ReviewEvent */
export function makeReviewEvent(
  itemId: LearningItem["id"],
  senseId: Sense["id"],
  overrides: Partial<ReviewEvent> = {},
): ReviewEvent {
  return {
    id: toEventId(createId("evt", 12)),
    type: "review",
    time: now(),
    itemId,
    senseId,
    exerciseType: "recall",
    rating: "good",
    reviewDurationMs: 3500,
    revealed: false,
    answerWasCorrect: true,
    elapsedDays: 0,
    ...overrides,
  };
}
