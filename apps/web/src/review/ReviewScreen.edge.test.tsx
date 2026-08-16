/**
 * 复习界面键盘与错误路径边界（RAY-239 测试补全）。
 *
 * 与 ReviewScreen.test.tsx 的主交互用例互补：专攻快捷键的修饰键/重复键/
 * 焦点行为（防误触发）与评分失败恢复路径。
 * 本文件统一在四档（Anki 传统）下运行，档位切换的三档/四档差异
 * 由 ReviewScreen.test.tsx 覆盖。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toEventId } from "@lexilexi/core";
import type { ReviewRating, StudyMode } from "@lexilexi/core";
import { RATING_TIER_STORAGE_KEY } from "../lib/ratingTiers";
import { ReviewScreen } from "./ReviewScreen";
import { makeCard } from "./testFixtures";
import type { GradeContext, GradeResult, ReviewCard, ReviewDataProvider } from "./types";

interface ProviderHarness {
  provider: ReviewDataProvider;
  loadQueue: ReturnType<typeof vi.fn>;
  loadMultipleChoiceQueue: ReturnType<typeof vi.fn>;
  grade: ReturnType<typeof vi.fn>;
  hasAnyItems: ReturnType<typeof vi.fn>;
  importSampleWordlist: ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  window.localStorage.setItem(RATING_TIER_STORAGE_KEY, "four");
});

function makeHarness(options: { queue?: ReviewCard[] } = {}): ProviderHarness {
  const { queue = [] } = options;
  const loadQueue = vi.fn<(mode: StudyMode) => Promise<ReviewCard[]>>().mockResolvedValue(queue);
  const loadMultipleChoiceQueue = vi.fn().mockResolvedValue({ questions: [], cards: [] });
  const grade = vi
    .fn<(card: ReviewCard, rating: ReviewRating, context: GradeContext) => Promise<GradeResult>>()
    .mockImplementation(async (card) => ({
      reviewEventId: toEventId("evt_test_grade"),
      previousMemoryState: card.memory,
    }));
  const hasAnyItems = vi.fn<() => Promise<boolean>>().mockResolvedValue(queue.length > 0);
  const importSampleWordlist = vi.fn<() => Promise<number>>().mockResolvedValue(14);
  const provider: ReviewDataProvider = {
    loadQueue,
    loadMultipleChoiceQueue,
    grade,
    markMastered: vi.fn().mockImplementation(async (card) => ({
      reviewEventId: toEventId("evt_test_mastered"),
      previousMemoryState: card.memory,
    })),
    undoGrade: vi.fn().mockResolvedValue(undefined),
    hasAnyItems,
    importSampleWordlist,
  };
  return {
    provider,
    loadQueue,
    loadMultipleChoiceQueue,
    grade,
    hasAnyItems,
    importSampleWordlist,
  };
}

/** 等待卡片出现：翻面按钮的可达名包含词条 */
function expectCardShown(term: string) {
  return screen.findByRole("button", { name: `显示 ${term} 的释义` });
}

describe("ReviewScreen 键盘边界", () => {
  it("按住不放的重复按键（repeat）不重复评分/翻面", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.keyDown(window, { key: "1", repeat: true });
    fireEvent.keyDown(window, { key: " ", repeat: true });

    expect(harness.grade).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: `显示 ${card.sense.term} 的释义` })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("带修饰键（ctrl/alt/meta）的按键不触发快捷键", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    fireEvent.keyDown(window, { key: "a", altKey: true });
    fireEvent.keyDown(window, { key: " ", metaKey: true });

    expect(harness.grade).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: `显示 ${card.sense.term} 的释义` })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("焦点在按钮上按空格：交给按钮原生行为，不双触发（不翻面也不评分）", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    const flipButton = screen.getByRole("button", { name: `显示 ${card.sense.term} 的释义` });
    flipButton.focus();
    // 事件冒泡到 window 监听器，target 是按钮 → 全局处理器跳过（原生 click 由浏览器合成）
    fireEvent.keyDown(flipButton, { key: " " });

    expect(flipButton.getAttribute("aria-expanded")).toBe("false");
    expect(harness.grade).not.toHaveBeenCalled();
  });

  it("焦点在面内滚动区按空格：交给滚动容器原生滚动，不翻面（RAY-291 suggestion 1）", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    // jsdom 不做布局：伪造「可滚动」尺寸与 computed overflow，
    // 模拟 Chrome 127+ 中可键盘聚焦的滚动容器（无焦点子元素时）
    const region = document.querySelector(".overflow-y-auto") as HTMLElement;
    expect(region).not.toBeNull();
    Object.defineProperty(region, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(region, "clientHeight", { value: 200, configurable: true });
    // 只替换目标元素的 computed overflow，其余元素委托真实实现
    // （testing-library 的角色查询依赖 getPropertyValue，不能整体 mock）
    const realGetComputedStyle = window.getComputedStyle;
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      if (element === region) {
        return { overflowY: "auto" } as CSSStyleDeclaration;
      }
      return realGetComputedStyle(element);
    });

    fireEvent.keyDown(region, { key: " " });
    // 断言前立即还原：断言失败也不能让 spy 泄漏到后续用例
    styleSpy.mockRestore();

    // 不翻面、不评分：空格留给滚动容器的原生滚动
    expect(
      screen
        .getByRole("button", { name: `显示 ${card.sense.term} 的释义` })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(harness.grade).not.toHaveBeenCalled();
  });

  it("评分按钮获得焦点时按数字键：全局监听仍生效（按键不因焦点被吞）", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    // 焦点落在评分按钮（button）上时，数字键不是该按钮的原生行为 → 正常评分
    const goodButton = screen.getByRole("button", { name: /评分：Good/ });
    goodButton.focus();
    fireEvent.keyDown(goodButton, { key: "3" });

    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(card, "good", expect.anything());
  });

  it("大写字母 G 与 g 等价（大小写不敏感）", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.keyDown(window, { key: "G" });
    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(card, "good", expect.anything());
  });
});

describe("ReviewScreen 评分失败恢复", () => {
  it("评分落库失败：进入错误态并显示原因，重试后重新加载队列", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    harness.grade.mockRejectedValueOnce(new Error("IndexedDB 磁盘写入失败"));
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.click(screen.getByRole("button", { name: /Good/ }));

    expect(await screen.findByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB 磁盘写入失败")).toBeInTheDocument();

    // 重试：重新加载队列回到复习态（同一张卡未被评分）
    harness.loadQueue.mockResolvedValue([card]);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await expectCardShown("apple");
    expect(harness.loadQueue).toHaveBeenCalledTimes(2);
  });

  it("评分失败后再次评分同一张卡：状态未被污染（可继续评分）", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    harness.grade.mockRejectedValueOnce(new Error("事务失败"));
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.click(screen.getByRole("button", { name: /Again/ }));
    await screen.findByText("加载失败");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await expectCardShown("apple");
    // 第二次评分成功 → 完成态
    fireEvent.click(screen.getByRole("button", { name: /Again/ }));
    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledTimes(2);
  });
});
