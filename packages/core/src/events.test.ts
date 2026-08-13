import { describe, expect, it } from "vitest";
import type { Event, ReviewEvent } from "./events";
import { isDeleteItemEvent, isEditSenseEvent, isImportEvent, isReviewEvent } from "./events";
import { makeReviewEvent } from "./helpers";
import { toEventId, toItemId, toSenseId } from "./id";

describe("事件类型判别函数", () => {
  it("isReviewEvent 识别复习事件", () => {
    const event: ReviewEvent = makeReviewEvent(toItemId("item_1"), toSenseId("sense_1"));
    expect(isReviewEvent(event)).toBe(true);
  });

  it("isReviewEvent 拒绝非复习事件", () => {
    const event: Event = {
      id: toEventId("evt_1"),
      type: "delete-item",
      time: "2026-08-13T10:00:00.000Z",
      itemId: toItemId("item_1"),
    };
    expect(isReviewEvent(event)).toBe(false);
  });

  it("isImportEvent / isDeleteItemEvent 判别正确", () => {
    const importEvent: Event = {
      id: toEventId("evt_2"),
      type: "import",
      time: "2026-08-13T10:00:00.000Z",
      itemId: toItemId("item_1"),
      senseId: toSenseId("sense_1"),
      term: "hello",
      lang: "en",
    };
    const deleteEvent: Event = {
      id: toEventId("evt_3"),
      type: "delete-item",
      time: "2026-08-13T10:00:00.000Z",
      itemId: toItemId("item_1"),
    };
    expect(isImportEvent(importEvent)).toBe(true);
    expect(isImportEvent(deleteEvent)).toBe(false);
    expect(isDeleteItemEvent(deleteEvent)).toBe(true);
    expect(isDeleteItemEvent(importEvent)).toBe(false);
  });

  it("isEditSenseEvent 判别正确", () => {
    const editEvent: Event = {
      id: toEventId("evt_4"),
      type: "edit-sense",
      time: "2026-08-13T10:00:00.000Z",
      senseId: toSenseId("sense_1"),
      diff: { definitions: ["新释义"] },
    };
    const reviewEvent: Event = makeReviewEvent(toItemId("item_1"), toSenseId("sense_1"));
    expect(isEditSenseEvent(editEvent)).toBe(true);
    expect(isEditSenseEvent(reviewEvent)).toBe(false);
  });
});
