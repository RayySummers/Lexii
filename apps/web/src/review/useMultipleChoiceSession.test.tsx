/**
 * useMultipleChoiceSession 时序边界测试。
 *
 * 覆盖：加载 → quizzing 流转、选择评分、自动推进、连按防抖、
 * 评分失败恢复、空队列处理。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DistractorOption, ReviewRating, StudyMode } from "@lexilexi/core";
import { makeCard } from "./testFixtures";
import type { GradeContext, MultipleChoiceQueueResult, ReviewCard, ReviewDataProvider } from "./types";
import type { MultipleChoiceQuestion } from "./MultipleChoiceCard";
import { useMultipleChoiceSession } from "./useMultipleChoiceSession";

function makeQuestion(sense: ReviewCard["sense"]): MultipleChoiceQuestion {
  const options: DistractorOption[] = [
    { text: sense.definitions[0]!, isCorrect: true, source: "correct" },
    { text: "错答A", isCorrect: false, source: "random" },
    { text: "错答B", isCorrect: false, source: "random" },
    { text: "错答C", isCorrect: false, source: "random" },
  ];
  return { sense, options };
}

function makeHarness(
  options: {
    cards?: ReviewCard[];
    hasItems?: boolean;
    loadError?: Error | null;
    gradeError?: Error | null;
  } = {},
) {
  const { cards = [], hasItems = cards.length > 0, loadError = null, gradeError = null } = options;
  const questions = cards.map((card) => makeQuestion(card.sense));
  const loadMultipleChoiceQueue = vi.fn<() => Promise<MultipleChoiceQueueResult>>();
  if (loadError) {
    loadMultipleChoiceQueue.mockRejectedValue(loadError);
  } else {
    loadMultipleChoiceQueue.mockResolvedValue({ questions, cards });
  }
  const grade = vi.fn<(card: ReviewCard, rating: ReviewRating, context: GradeContext) => Promise<void>>();
  if (gradeError) {
    grade.mockRejectedValue(gradeError);
  } else {
    grade.mockResolvedValue(undefined);
  }
  const hasAnyItems = vi.fn<() => Promise<boolean>>().mockResolvedValue(hasItems);
  const provider: ReviewDataProvider = {
    loadQueue: vi.fn().mockResolvedValue([]),
    loadMultipleChoiceQueue,
    grade,
    hasAnyItems,
    importSampleWordlist: vi.fn().mockResolvedValue(14),
    exportBackup: vi.fn().mockResolvedValue(null as never),
  };
  return { provider, loadMultipleChoiceQueue, grade, hasAnyItems };
}

describe("useMultipleChoiceSession", () => {
  it("加载后进入 quizzing 态，current 为第一题", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    card.sense.definitions = ["苹果"];
    const harness = makeHarness({ cards: [card] });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));

    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));
    expect(result.current.current?.sense.term).toBe("apple");
    expect(result.current.totalCount).toBe(1);
    expect(result.current.index).toBe(0);
    expect(result.current.selectedIndex).toBeNull();
  });

  it("选择正确选项：以 good 评分，1 秒后自动推进", async () => {
    const first = makeCard();
    first.sense.definitions = ["正确"];
    const second = makeCard();
    second.sense.definitions = ["正确2"];
    const harness = makeHarness({ cards: [first, second] });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));

    // 选择正确选项（index 0）
    await act(async () => {
      result.current.select(0);
    });
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.isCorrect).toBe(true);
    expect(harness.grade).toHaveBeenCalledWith(
      first,
      "good",
      expect.objectContaining({ exerciseType: "multiple-choice" }),
    );

    // 等待自动推进
    await waitFor(() => expect(result.current.index).toBe(1), { timeout: 2000 });
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.answeredCount).toBe(1);
  });

  it("选择错误选项：以 again 评分", async () => {
    const card = makeCard();
    card.sense.definitions = ["正确"];
    const harness = makeHarness({ cards: [card] });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));

    await act(async () => {
      result.current.select(1); // 错误选项
    });
    expect(result.current.isCorrect).toBe(false);
    expect(harness.grade).toHaveBeenCalledWith(
      card,
      "again",
      expect.objectContaining({ exerciseType: "multiple-choice" }),
    );
  });

  it("连按防抖：同一题只评分一次", async () => {
    const card = makeCard();
    const harness = makeHarness({ cards: [card] });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));

    await act(async () => {
      result.current.select(0);
      result.current.select(1); // 第二次应被防抖
    });
    expect(harness.grade).toHaveBeenCalledTimes(1);
  });

  it("最后一题答完进入 done 态", async () => {
    const card = makeCard();
    const harness = makeHarness({ cards: [card] });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));

    await act(async () => {
      result.current.select(0);
    });
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.answeredCount).toBe(1);
  });

  it("空队列且无词：empty 态", async () => {
    const harness = makeHarness({ cards: [], hasItems: false });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));

    await waitFor(() => expect(result.current.phase).toBe("empty"));
  });

  it("空队列但有词：no-due 态", async () => {
    const harness = makeHarness({ cards: [], hasItems: true });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));

    await waitFor(() => expect(result.current.phase).toBe("no-due"));
  });

  it("加载失败：error 态，重试后恢复", async () => {
    const card = makeCard();
    const harness = makeHarness({ cards: [], loadError: new Error("数据库不可用") });
    harness.loadMultipleChoiceQueue
      .mockRejectedValueOnce(new Error("数据库不可用"))
      .mockResolvedValue({ questions: [makeQuestion(card.sense)], cards: [card] });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("数据库不可用");

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));
  });

  it("评分失败：error 态", async () => {
    const card = makeCard();
    const harness = makeHarness({ cards: [card], gradeError: new Error("落库失败") });
    const { result } = renderHook(() => useMultipleChoiceSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("quizzing"));

    await act(async () => {
      result.current.select(0);
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("落库失败");
  });
});
