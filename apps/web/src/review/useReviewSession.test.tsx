/**
 * 复习会话状态机边界（RAY-239 测试补全）：
 * 连按防抖、翻面守卫、StrictMode 双调用竞态等 useReviewSession 内部时序路径。
 *
 * RAY-265：单步撤销（成功可撤销、撤销后不可连退、失败进入 error）与
 * 标熟（按评分同路径推进队列并落撤销快照）。
 * RAY-341：撤销后保留返回快照（canReturn），「返回」原样重放被撤销的
 * 评分 / 标熟回到原位置。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toEventId } from "@lexii/core";
import type { ReviewRating, StudyMode } from "@lexii/core";
import { makeCard } from "./testFixtures";
import type { GradeContext, GradeResult, ReviewCard, ReviewDataProvider } from "./types";
import { useReviewSession } from "./useReviewSession";

interface Harness {
  provider: ReviewDataProvider;
  loadQueue: ReturnType<typeof vi.fn>;
  grade: ReturnType<typeof vi.fn>;
  markMastered: ReturnType<typeof vi.fn>;
  undoGrade: ReturnType<typeof vi.fn>;
  hasAnyItems: ReturnType<typeof vi.fn>;
}

/** 生成与卡片对齐的评分落库结果（事件 id 随调用次数递增，便于断言） */
function gradeResultFor(card: ReviewCard, eventSuffix: string): GradeResult {
  return { reviewEventId: toEventId(`evt_test_${eventSuffix}`), previousMemoryState: card.memory };
}

function makeHarness(
  options: {
    queue?: ReviewCard[];
    hasItems?: boolean;
    loadError?: Error | null;
  } = {},
): Harness {
  const { queue = [], hasItems = queue.length > 0, loadError = null } = options;
  const loadQueue = vi.fn<(mode: StudyMode) => Promise<ReviewCard[]>>();
  if (loadError) {
    loadQueue.mockRejectedValue(loadError);
  } else {
    loadQueue.mockResolvedValue(queue);
  }
  const grade = vi
    .fn<(card: ReviewCard, rating: ReviewRating, context: GradeContext) => Promise<GradeResult>>()
    .mockImplementation(async (card) => gradeResultFor(card, "grade"));
  const markMastered = vi
    .fn<(card: ReviewCard, context: GradeContext) => Promise<GradeResult>>()
    .mockImplementation(async (card) => gradeResultFor(card, "mastered"));
  const undoGrade = vi
    .fn<
      (
        itemId: ReviewCard["item"]["id"],
        eventId: GradeResult["reviewEventId"],
        previousMemoryState: GradeResult["previousMemoryState"],
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const hasAnyItems = vi.fn<() => Promise<boolean>>().mockResolvedValue(hasItems);
  const provider: ReviewDataProvider = {
    loadQueue,
    loadMultipleChoiceQueue: vi.fn().mockResolvedValue({ questions: [], cards: [] }),
    grade,
    markMastered,
    undoGrade,
    hasAnyItems,
    importSampleWordlist: vi.fn().mockResolvedValue(14),
  };
  return { provider, loadQueue, grade, markMastered, undoGrade, hasAnyItems };
}

describe("useReviewSession 时序边界", () => {
  it("初始加载：loading → reviewing（队列非空），模式透传给数据源", async () => {
    const card = makeCard();
    const { provider, loadQueue } = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(provider, "review"));

    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));
    expect(result.current.current).toBe(card);
    expect(result.current.totalCount).toBe(1);
    expect(loadQueue).toHaveBeenCalledWith("review");
  });

  it("连按评分：同一张卡只评分一次（grading 防抖），不跳过卡片", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      const first = result.current.grade("good");
      const second = result.current.grade("good"); // 连按第二次应被防抖吞掉
      await Promise.all([first, second]);
    });

    expect(harness.grade).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("done");
    expect(result.current.gradedCount).toBe(1);
  });

  it("翻面守卫：非 reviewing 阶段 flip 无效", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("no-due"));

    act(() => result.current.flip());
    expect(result.current.flipped).toBe(false);
  });

  it("非 reviewing 阶段评分无效（done 态不重复评分）", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.grade("good");
    });
    expect(result.current.phase).toBe("done");

    await act(async () => {
      await result.current.grade("easy"); // done 态评分：直接返回
    });
    expect(harness.grade).toHaveBeenCalledTimes(1);
  });

  it("评分失败：进入 error 态，重试成功恢复 reviewing", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    harness.grade.mockRejectedValueOnce(new Error("落库失败"));
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.grade("good");
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("落库失败");

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));
    expect(result.current.index).toBe(0);
  });

  it("加载竞态：旧请求的迟到结果被丢弃（loadId 防线）", async () => {
    let resolveFirst!: (queue: ReviewCard[]) => void;
    const card = makeCard();
    const loadQueue = vi
      .fn<(mode: StudyMode) => Promise<ReviewCard[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([card]);
    const provider: ReviewDataProvider = {
      loadQueue,
      loadMultipleChoiceQueue: vi.fn().mockResolvedValue({ questions: [], cards: [] }),
      grade: vi.fn().mockImplementation(async (c) => gradeResultFor(c, "grade")),
      markMastered: vi.fn().mockImplementation(async (c) => gradeResultFor(c, "mastered")),
      undoGrade: vi.fn().mockResolvedValue(undefined),
      hasAnyItems: vi.fn().mockResolvedValue(true),
      importSampleWordlist: vi.fn().mockResolvedValue(14),
    };
    const { result } = renderHook(() => useReviewSession(provider, "review"));

    // 触发第二次加载（retry），覆盖第一次未决请求
    act(() => result.current.retry());
    // 第一次请求此时才返回（迟到的旧结果）
    await act(async () => {
      resolveFirst([]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.phase).toBe("reviewing"));
    expect(result.current.current).toBe(card);
  });

  it("importSample 失败：进入 error 态且 importing 复位", async () => {
    const loadQueue = vi.fn<(mode: StudyMode) => Promise<ReviewCard[]>>().mockResolvedValue([]);
    const importSampleWordlist = vi
      .fn<() => Promise<number>>()
      .mockRejectedValue(new Error("导入失败"));
    const provider: ReviewDataProvider = {
      loadQueue,
      loadMultipleChoiceQueue: vi.fn().mockResolvedValue({ questions: [], cards: [] }),
      grade: vi.fn().mockImplementation(async (c) => gradeResultFor(c, "grade")),
      markMastered: vi.fn().mockImplementation(async (c) => gradeResultFor(c, "mastered")),
      undoGrade: vi.fn().mockResolvedValue(undefined),
      hasAnyItems: vi.fn().mockResolvedValue(false),
      importSampleWordlist,
    };
    const { result } = renderHook(() => useReviewSession(provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("empty"));

    await act(async () => {
      await result.current.importSample();
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("导入失败");
    expect(result.current.importing).toBe(false);
  });

  it("翻面后评分：context.revealed 记录翻面状态，进入下一张卡时复位", async () => {
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    act(() => result.current.flip());
    expect(result.current.flipped).toBe(true);

    await act(async () => {
      await result.current.grade("good");
    });
    expect(harness.grade).toHaveBeenCalledWith(
      first,
      "good",
      expect.objectContaining({ revealed: true }),
    );
    // 下一张卡：翻面状态复位
    expect(result.current.flipped).toBe(false);
    expect(result.current.index).toBe(1);
  });
});

describe("RAY-265 单步撤销与标熟", () => {
  it("评分后 canUndo；撤销回到该卡且可「返回」重放原评分（不可连退）", async () => {
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.grade("good");
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canReturn).toBe(false);
    expect(result.current.index).toBe(1);

    await act(async () => {
      await result.current.undo();
    });
    expect(harness.undoGrade).toHaveBeenCalledWith(
      first.item.id,
      toEventId("evt_test_grade"),
      first.memory,
    );
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.index).toBe(0);
    expect(result.current.current?.sense.term).toBe("apple");
    expect(result.current.gradedCount).toBe(0);
    expect(result.current.canUndo).toBe(false); // 快照已清空，不允许连退
    expect(result.current.canReturn).toBe(true); // RAY-341：撤销后保留返回路径

    // 「返回」：原样重放被撤销的评分，回到撤销前所在的下一张卡
    await act(async () => {
      await result.current.redo();
    });
    expect(result.current.index).toBe(1);
    expect(result.current.gradedCount).toBe(1);
    expect(result.current.canUndo).toBe(true); // 重放即一次新评分，重新获得撤销机会
    expect(result.current.canReturn).toBe(false);
    expect(harness.grade).toHaveBeenCalledTimes(2);
    expect(harness.grade).toHaveBeenLastCalledWith(first, "good", expect.anything());

    // 再次撤销：仍可退回（撤销 ↔ 返回 来回切换）
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.index).toBe(0);
    expect(result.current.canReturn).toBe(true);
  });

  it("撤销后重新评分：新操作清空返回路径（返回只对刚撤销的那一步有效）", async () => {
    const first = makeCard();
    const second = makeCard();
    const harness = makeHarness({ queue: [first, second] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.grade("good");
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.canReturn).toBe(true);

    await act(async () => {
      await result.current.grade("again"); // 反悔后改评分
    });
    expect(result.current.index).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canReturn).toBe(false);
  });

  it("done 态撤销：回到最后一张卡重新评分，计数不虚增", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.grade("good");
    });
    expect(result.current.phase).toBe("done");
    expect(result.current.gradedCount).toBe(1);
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.phase).toBe("reviewing");
    expect(result.current.index).toBe(0);
    expect(result.current.gradedCount).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canReturn).toBe(true);

    // 「返回」重放评分后回到 done 态
    await act(async () => {
      await result.current.redo();
    });
    expect(result.current.phase).toBe("done");
    expect(result.current.gradedCount).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canReturn).toBe(false);
  });

  it("标熟：与评分同路径推进队列并留撤销快照，撤销后「返回」重放标熟", async () => {
    const first = makeCard();
    const second = makeCard();
    const harness = makeHarness({ queue: [first, second] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.markMastered();
    });
    expect(harness.markMastered).toHaveBeenCalledTimes(1);
    expect(result.current.index).toBe(1);
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.index).toBe(0);
    expect(harness.undoGrade).toHaveBeenCalledTimes(1);
    expect(result.current.canReturn).toBe(true);

    await act(async () => {
      await result.current.redo();
    });
    expect(harness.markMastered).toHaveBeenCalledTimes(2);
    expect(harness.grade).not.toHaveBeenCalled();
    expect(result.current.index).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canReturn).toBe(false);
  });

  it("无可撤销快照时 undo / redo 无效；撤销失败进入 error 态", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canReturn).toBe(false);
    await act(async () => {
      await result.current.undo();
    });
    await act(async () => {
      await result.current.redo();
    });
    expect(harness.undoGrade).not.toHaveBeenCalled();
    expect(harness.grade).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.grade("good");
    });
    harness.undoGrade.mockRejectedValueOnce(new Error("回滚失败"));
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("回滚失败");
  });

  it("撤销恢复的卡：memory 回退为评分前状态（再评分与到期预览一致）", async () => {
    const first = makeCard();
    const second = makeCard();
    const harness = makeHarness({ queue: [first, second] });
    const { result } = renderHook(() => useReviewSession(harness.provider, "review"));
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));

    await act(async () => {
      await result.current.grade("easy");
    });
    await act(async () => {
      await result.current.undo();
    });
    // 评分前的记忆状态：从未评分，lastRating 为 null
    expect(result.current.current?.memory.fields.lastRating).toBeNull();
    expect(result.current.current?.item.id).toBe(first.item.id);
  });
});
