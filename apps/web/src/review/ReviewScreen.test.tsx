/**
 * 复习界面交互测试（mock 数据源，不依赖 IndexedDB）。
 *
 * 覆盖验收点：正反面切换、评分（RAY-265 默认三档 / 四档 Anki 传统）、
 * 键盘快捷键与按钮等价、标熟、单步撤销、发音、队列推进与完成态、
 * 空状态与错误恢复。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  markMastered: ReturnType<typeof vi.fn>;
  undoGrade: ReturnType<typeof vi.fn>;
  hasAnyItems: ReturnType<typeof vi.fn>;
  importSampleWordlist: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  // 档位设置在 localStorage：每个用例后清理，保证「默认三档」用例不受污染
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
  vi.unstubAllGlobals();
});

/** 切换到四档（Anki 传统）——需要 Again/Hard/Good/Easy 的用例先调用 */
function useFourTiers() {
  window.localStorage.setItem(RATING_TIER_STORAGE_KEY, "four");
}

/** 与卡片对齐的评分落库结果（撤销证据） */
function gradeResultFor(card: ReviewCard, eventSuffix: string): GradeResult {
  return { reviewEventId: toEventId(`evt_test_${eventSuffix}`), previousMemoryState: card.memory };
}

function makeHarness(
  options: {
    queue?: ReviewCard[];
    hasItems?: boolean;
    loadError?: Error | null;
  } = {},
): ProviderHarness {
  const { queue = [], hasItems = queue.length > 0, loadError = null } = options;
  const loadQueue = vi.fn<(mode: StudyMode) => Promise<ReviewCard[]>>();
  if (loadError) {
    loadQueue.mockRejectedValue(loadError);
  } else {
    loadQueue.mockResolvedValue(queue);
  }
  const loadMultipleChoiceQueue = vi.fn().mockResolvedValue({ questions: [], cards: [] });
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
  const importSampleWordlist = vi.fn<() => Promise<number>>().mockResolvedValue(14);
  const provider: ReviewDataProvider = {
    loadQueue,
    loadMultipleChoiceQueue,
    grade,
    markMastered,
    undoGrade,
    hasAnyItems,
    importSampleWordlist,
  };
  return {
    provider,
    loadQueue,
    loadMultipleChoiceQueue,
    grade,
    markMastered,
    undoGrade,
    hasAnyItems,
    importSampleWordlist,
  };
}

/** 当前面（未翻面时正面，翻面后背面）的 aria-hidden 状态 */
function faceAriaHidden(element: HTMLElement): string | null {
  return element.closest("[aria-hidden]")?.getAttribute("aria-hidden") ?? null;
}

/** 等待卡片出现：翻面按钮的可达名包含词条，且词条在两面上都会渲染，用它定位最稳 */
function expectCardShown(term: string) {
  return screen.findByRole("button", { name: `显示 ${term} 的释义` });
}

describe("ReviewScreen", () => {
  it("不渲染导出备份按钮（RAY-280：导出入口已移到设置页）", async () => {
    const card = makeCard();
    render(
      <ReviewScreen
        provider={makeHarness({ queue: [card] }).provider}
        mode="review"
        onExit={() => {}}
      />,
    );

    await expectCardShown(card.sense.term);
    expect(screen.queryByRole("button", { name: "导出备份" })).not.toBeInTheDocument();
  });

  it("加载后渲染第一张卡的词条与进度（四档 Anki 传统）", async () => {
    useFourTiers();
    const card = makeCard();
    card.sense.term = "apple";
    render(
      <ReviewScreen
        provider={makeHarness({ queue: [card] }).provider}
        mode="review"
        onExit={() => {}}
      />,
    );

    await expectCardShown("apple");
    expect(screen.getAllByText("apple").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 \/ 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Again/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Easy/ })).toBeInTheDocument();
  });

  it("默认三档：认识 / 模糊 / 不认识（无 Easy）", async () => {
    const card = makeCard();
    render(
      <ReviewScreen
        provider={makeHarness({ queue: [card] }).provider}
        mode="review"
        onExit={() => {}}
      />,
    );
    await expectCardShown(card.sense.term);

    expect(screen.getByRole("button", { name: /评分：认识/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /模糊/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /不认识/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Easy/ })).not.toBeInTheDocument();
    // RAY-279：背词页不再显示「X 分钟后复习」提示（新卡各档均为分钟级）
    expect(screen.queryByText(/分钟/)).not.toBeInTheDocument();
  });

  it("默认三档：数字键 4 与字母 E 不评分（Easy 未提供）", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.keyDown(window, { key: "4" });
    fireEvent.keyDown(window, { key: "e" });
    expect(harness.grade).not.toHaveBeenCalled();

    // 三档数字键 1–3 正常评分
    fireEvent.keyDown(window, { key: "3" });
    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(card, "good", expect.anything());
  });

  it("点击卡片翻面：释义从 aria-hidden 变为可见，再点翻回", async () => {
    const card = makeCard();
    render(
      <ReviewScreen
        provider={makeHarness({ queue: [card] }).provider}
        mode="review"
        onExit={() => {}}
      />,
    );
    await expectCardShown(card.sense.term);

    const definition = screen.getByText(card.sense.definitions[0]!);
    const flipButton = screen.getByRole("button", { name: `显示 ${card.sense.term} 的释义` });
    expect(faceAriaHidden(definition)).toBe("true");
    expect(flipButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(flipButton);
    expect(faceAriaHidden(definition)).toBe("false");
    expect(
      screen
        .getByRole("button", { name: `隐藏 ${card.sense.term} 的释义` })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: `隐藏 ${card.sense.term} 的释义` }));
    expect(faceAriaHidden(definition)).toBe("true");
  });

  it("点击评分按钮：以对应档位评分并进入下一张卡（四档）", async () => {
    useFourTiers();
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.click(screen.getByRole("button", { name: /Good/ }));

    await expectCardShown("book");
    expect(harness.grade).toHaveBeenCalledTimes(1);
    expect(harness.grade).toHaveBeenCalledWith(
      first,
      "good",
      expect.objectContaining({ revealed: false }),
    );
  });

  it("默认三档：点「认识」以 Good 评分并进入下一张卡", async () => {
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.click(screen.getByRole("button", { name: /评分：认识/ }));

    await expectCardShown("book");
    expect(harness.grade).toHaveBeenCalledWith(
      first,
      "good",
      expect.objectContaining({ revealed: false }),
    );
  });

  it("翻面后评分记录 revealed=true", async () => {
    useFourTiers();
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.click(screen.getByRole("button", { name: `显示 ${card.sense.term} 的释义` }));
    fireEvent.click(screen.getByRole("button", { name: /Hard/ }));

    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(
      card,
      "hard",
      expect.objectContaining({ revealed: true, reviewDurationMs: expect.any(Number) }),
    );
  });

  it("键盘快捷键与按钮等价：空格翻面、字母 a 等价于 1（Again）", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    // 空格翻面
    fireEvent.keyDown(window, { key: " " });
    expect(
      screen
        .getByRole("button", { name: `隐藏 ${card.sense.term} 的释义` })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    // 字母键 a 等价于 1（Again）
    fireEvent.keyDown(window, { key: "a" });
    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(card, "again", expect.anything());
  });

  it("数字键 2 评分 Hard；无关键不触发", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.keyDown(window, { key: "5" });
    expect(harness.grade).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "2" });
    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(card, "hard", expect.anything());
  });

  it("评完所有卡进入完成态并显示计数（四档）", async () => {
    useFourTiers();
    const first = makeCard();
    const second = makeCard();
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(first.sense.term);

    fireEvent.click(screen.getByRole("button", { name: /Good/ }));
    await expectCardShown(second.sense.term);
    fireEvent.click(screen.getByRole("button", { name: /Easy/ }));

    expect(await screen.findByText("本轮复习完成")).toBeInTheDocument();
    expect(screen.getByText("共复习 2 张卡片")).toBeInTheDocument();
  });

  it("空库：显示导入示例词表入口，导入后直接进入复习", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const harness = makeHarness({ queue: [], hasItems: false });
    harness.loadQueue.mockResolvedValueOnce([]).mockResolvedValue([card]);
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);

    expect(await screen.findByText("词库还是空的")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /导入内置示例词表/ }));

    await expectCardShown("apple");
    expect(harness.importSampleWordlist).toHaveBeenCalledTimes(1);
    expect(harness.loadQueue).toHaveBeenCalledTimes(2);
  });

  it("有词但今日无到期：显示对应提示", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);

    expect(await screen.findByText("今天没有到期的词")).toBeInTheDocument();
    expect(harness.loadQueue).toHaveBeenCalledWith("review");
  });

  it("学习模式：队列为空但有词时显示「没有待学习的新词」", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    render(<ReviewScreen provider={harness.provider} mode="learn" onExit={() => {}} />);

    expect(await screen.findByText("没有待学习的新词")).toBeInTheDocument();
    expect(harness.loadQueue).toHaveBeenCalledWith("learn");
  });

  it("学习模式：每日新卡额度已用完且词库仍有新词时显示额度耗尽文案（RAY-276 诊断线 3）", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    harness.provider.loadQueueMeta = vi
      .fn()
      .mockResolvedValue({ remainingNewCardQuota: 0, hasDueNewWords: true });
    render(<ReviewScreen provider={harness.provider} mode="learn" onExit={() => {}} />);

    expect(await screen.findByText("今日新词额度已用完")).toBeInTheDocument();
    expect(screen.getByText(/剩余新词顺延到明天/)).toBeInTheDocument();
    expect(harness.provider.loadQueueMeta).toHaveBeenCalledWith("learn");
  });

  it("学习模式：额度仍有剩余时不显示额度耗尽文案", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    harness.provider.loadQueueMeta = vi
      .fn()
      .mockResolvedValue({ remainingNewCardQuota: 5, hasDueNewWords: true });
    render(<ReviewScreen provider={harness.provider} mode="learn" onExit={() => {}} />);

    expect(await screen.findByText("没有待学习的新词")).toBeInTheDocument();
    expect(screen.queryByText("今日新词额度已用完")).not.toBeInTheDocument();
  });

  it("学习模式：词库没有未学新词时不显示额度耗尽文案", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    harness.provider.loadQueueMeta = vi
      .fn()
      .mockResolvedValue({ remainingNewCardQuota: 0, hasDueNewWords: false });
    render(<ReviewScreen provider={harness.provider} mode="learn" onExit={() => {}} />);

    expect(await screen.findByText("没有待学习的新词")).toBeInTheDocument();
    expect(screen.queryByText("今日新词额度已用完")).not.toBeInTheDocument();
  });

  it("混合模式：队列为空但有词时显示「今天没有可复习的词」", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    render(<ReviewScreen provider={harness.provider} mode="mixed" onExit={() => {}} />);

    expect(await screen.findByText("今天没有可复习的词")).toBeInTheDocument();
    expect(harness.loadQueue).toHaveBeenCalledWith("mixed");
  });

  it("学习模式完成态：显示「本轮学习完成」与学习计数", async () => {
    useFourTiers();
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="learn" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.click(screen.getByRole("button", { name: /Good/ }));

    expect(await screen.findByText("本轮学习完成")).toBeInTheDocument();
    expect(screen.getByText("共学习 1 张卡片")).toBeInTheDocument();
  });

  it("加载失败：显示错误与重试，重试成功后进入复习", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [], loadError: new Error("IndexedDB 不可用") });
    harness.loadQueue
      .mockRejectedValueOnce(new Error("IndexedDB 不可用"))
      .mockResolvedValue([card]);
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);

    expect(await screen.findByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB 不可用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await expectCardShown(card.sense.term);
  });
});

describe("ReviewScreen 标熟 / 单步撤销 / 发音（RAY-265）", () => {
  it("标熟：调用 markMastered 并进入下一张卡，可撤销回到该卡", async () => {
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    fireEvent.click(screen.getByRole("button", { name: /标熟/ }));

    await expectCardShown("book");
    expect(harness.markMastered).toHaveBeenCalledTimes(1);
    expect(harness.grade).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "撤销上一步" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销上一步" }));
    await expectCardShown("apple");
    expect(harness.undoGrade).toHaveBeenCalledTimes(1);
    // 撤销成功后按钮消失（连续只能撤销一次）
    expect(screen.queryByRole("button", { name: "撤销上一步" })).not.toBeInTheDocument();
  });

  it("评分后出现「撤销上一步」；撤销回退到上一张卡且不可连退", async () => {
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown("apple");

    // 评分前无撤销入口
    expect(screen.queryByRole("button", { name: "撤销上一步" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /评分：认识/ }));
    await expectCardShown("book");

    fireEvent.click(screen.getByRole("button", { name: "撤销上一步" }));
    await expectCardShown("apple");
    expect(harness.undoGrade).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "撤销上一步" })).not.toBeInTheDocument();
  });

  it("完成态仍可撤销最后一步评分", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.click(screen.getByRole("button", { name: /评分：认识/ }));
    expect(await screen.findByText("本轮复习完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销上一步" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销上一步" }));
    await expectCardShown(card.sense.term);
    expect(harness.undoGrade).toHaveBeenCalledTimes(1);
  });

  it("发音：以设置口音朗读当前词条（浏览器语音合成，离线）", async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    const resume = vi.fn();
    class FakeUtterance {
      text: string;
      lang = "";
      volume = 1;
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", {
      speak,
      cancel,
      resume,
      getVoices: () => [],
      addEventListener: () => {},
      speaking: false,
      pending: false,
      paused: false,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    const card = makeCard();
    card.sense.term = "apple";
    render(
      <ReviewScreen
        provider={makeHarness({ queue: [card] }).provider}
        mode="review"
        onExit={() => {}}
      />,
    );
    await expectCardShown("apple");

    fireEvent.click(screen.getByRole("button", { name: /朗读 apple/ }));

    expect(speak).toHaveBeenCalledTimes(1);
    const utterance = speak.mock.calls[0]![0] as FakeUtterance;
    expect(utterance.text).toBe("apple");
    expect(utterance.lang).toBe("en-US"); // 默认美式
    expect(utterance.volume).toBe(1); // RAY-277：显式音量（部分 iOS 默认异常）
    // RAY-277：队列空闲时不 cancel（iOS cancel→speak 同 tick 竞态吞朗读）
    expect(cancel).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("发音：环境不支持语音合成时给出提示，不阻塞复习", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);

    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.click(screen.getByRole("button", { name: /朗读/ }));

    expect(await screen.findByText("当前浏览器不支持语音合成，无法发音。")).toBeInTheDocument();
    // 复习流程不受影响
    expect(screen.getByRole("button", { name: /评分：认识/ })).toBeInTheDocument();
  });

  it("发音：设备语音不可用（异步合成失败）时给出降级提示，不阻塞复习（RAY-277）", async () => {
    const speak = vi.fn();
    class FakeUtterance {
      text: string;
      lang = "";
      volume = 1;
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", {
      speak,
      cancel: () => {},
      resume: () => {},
      getVoices: () => [],
      addEventListener: () => {},
      speaking: false,
      pending: false,
      paused: false,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} mode="review" onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.click(screen.getByRole("button", { name: /朗读/ }));
    const utterance = speak.mock.calls[0]![0] as FakeUtterance;
    act(() => {
      utterance.onerror?.({ error: "synthesis-unavailable" } as SpeechSynthesisErrorEvent);
    });

    expect(
      await screen.findByText(
        "当前设备无法发声：语音服务不可用，请检查系统语音（TTS）设置后重试。",
      ),
    ).toBeInTheDocument();
    // 复习流程不受影响
    expect(screen.getByRole("button", { name: /评分：认识/ })).toBeInTheDocument();
  });
});
