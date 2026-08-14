/**
 * 复习会话状态机边界（RAY-239 测试补全）：
 * 连按防抖、翻面守卫、StrictMode 双调用竞态等 useReviewSession 内部时序路径。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewRating } from "@lexilexi/core";
import { makeCard } from "./testFixtures";
import type { GradeContext, ReviewCard, ReviewDataProvider } from "./types";
import { useReviewSession } from "./useReviewSession";

interface Harness {
  provider: ReviewDataProvider;
  loadQueue: ReturnType<typeof vi.fn>;
  grade: ReturnType<typeof vi.fn>;
  hasAnyItems: ReturnType<typeof vi.fn>;
}

function makeHarness(
  options: {
    queue?: ReviewCard[];
    hasItems?: boolean;
    loadError?: Error | null;
  } = {},
): Harness {
  const { queue = [], hasItems = queue.length > 0, loadError = null } = options;
  const loadQueue = vi.fn<() => Promise<ReviewCard[]>>();
  if (loadError) {
    loadQueue.mockRejectedValue(loadError);
  } else {
    loadQueue.mockResolvedValue(queue);
  }
  const grade = vi
    .fn<(card: ReviewCard, rating: ReviewRating, context: GradeContext) => Promise<void>>()
    .mockResolvedValue(undefined);
  const hasAnyItems = vi.fn<() => Promise<boolean>>().mockResolvedValue(hasItems);
  const provider: ReviewDataProvider = {
    loadQueue,
    grade,
    hasAnyItems,
    importSampleWordlist: vi.fn().mockResolvedValue(14),
    exportBackup: vi.fn().mockResolvedValue(null as never),
  };
  return { provider, loadQueue, grade, hasAnyItems };
}

describe("useReviewSession 时序边界", () => {
  it("初始加载：loading → reviewing（队列非空）", async () => {
    const card = makeCard();
    const { provider } = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(provider));

    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("reviewing"));
    expect(result.current.current).toBe(card);
    expect(result.current.totalCount).toBe(1);
  });

  it("连按评分：同一张卡只评分一次（grading 防抖），不跳过卡片", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(harness.provider));
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
    const { result } = renderHook(() => useReviewSession(harness.provider));
    await waitFor(() => expect(result.current.phase).toBe("no-due"));

    act(() => result.current.flip());
    expect(result.current.flipped).toBe(false);
  });

  it("非 reviewing 阶段评分无效（done 态不重复评分）", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    const { result } = renderHook(() => useReviewSession(harness.provider));
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
    const { result } = renderHook(() => useReviewSession(harness.provider));
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
      .fn<() => Promise<ReviewCard[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([card]);
    const provider: ReviewDataProvider = {
      loadQueue,
      grade: vi.fn().mockResolvedValue(undefined),
      hasAnyItems: vi.fn().mockResolvedValue(true),
      importSampleWordlist: vi.fn().mockResolvedValue(14),
      exportBackup: vi.fn().mockResolvedValue(null as never),
    };
    const { result } = renderHook(() => useReviewSession(provider));

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
    const loadQueue = vi.fn<() => Promise<ReviewCard[]>>().mockResolvedValue([]);
    const importSampleWordlist = vi
      .fn<() => Promise<number>>()
      .mockRejectedValue(new Error("导入失败"));
    const provider: ReviewDataProvider = {
      loadQueue,
      grade: vi.fn().mockResolvedValue(undefined),
      hasAnyItems: vi.fn().mockResolvedValue(false),
      importSampleWordlist,
      exportBackup: vi.fn().mockResolvedValue(null as never),
    };
    const { result } = renderHook(() => useReviewSession(provider));
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
    const { result } = renderHook(() => useReviewSession(harness.provider));
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
