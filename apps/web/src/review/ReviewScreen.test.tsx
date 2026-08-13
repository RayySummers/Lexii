/**
 * 复习界面交互测试（mock 数据源，不依赖 IndexedDB）。
 *
 * 覆盖验收点：正反面切换、四档评分、键盘快捷键与按钮等价、
 * 队列推进与完成态、空状态与错误恢复。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LexilexiExportData, ReviewRating } from "@lexilexi/core";
import { ReviewScreen } from "./ReviewScreen";
import { makeCard } from "./testFixtures";
import type { GradeContext, ReviewCard, ReviewDataProvider } from "./types";

interface ProviderHarness {
  provider: ReviewDataProvider;
  loadQueue: ReturnType<typeof vi.fn>;
  grade: ReturnType<typeof vi.fn>;
  hasAnyItems: ReturnType<typeof vi.fn>;
  importSampleWordlist: ReturnType<typeof vi.fn>;
  exportBackup: ReturnType<typeof vi.fn>;
}

const EMPTY_EXPORT: LexilexiExportData = {
  format: "lexilexi",
  exportFormatVersion: 1,
  dbSchemaVersion: 1,
  exportedAt: "2026-08-14T00:00:00.000Z",
  items: [],
  senses: [],
  memoryStates: [],
  events: [],
};

function makeHarness(
  options: {
    queue?: ReviewCard[];
    hasItems?: boolean;
    loadError?: Error | null;
  } = {},
): ProviderHarness {
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
  const importSampleWordlist = vi.fn<() => Promise<number>>().mockResolvedValue(14);
  const exportBackup = vi.fn<() => Promise<LexilexiExportData>>().mockResolvedValue(EMPTY_EXPORT);
  const provider: ReviewDataProvider = {
    loadQueue,
    grade,
    hasAnyItems,
    importSampleWordlist,
    exportBackup,
  };
  return { provider, loadQueue, grade, hasAnyItems, importSampleWordlist, exportBackup };
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
  it("加载后渲染第一张卡的词条与进度", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    render(<ReviewScreen provider={makeHarness({ queue: [card] }).provider} onExit={() => {}} />);

    await expectCardShown("apple");
    expect(screen.getAllByText("apple").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 \/ 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Again/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Easy/ })).toBeInTheDocument();
  });

  it("点击卡片翻面：释义从 aria-hidden 变为可见，再点翻回", async () => {
    const card = makeCard();
    render(<ReviewScreen provider={makeHarness({ queue: [card] }).provider} onExit={() => {}} />);
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

  it("点击评分按钮：以对应档位评分并进入下一张卡", async () => {
    const first = makeCard();
    first.sense.term = "apple";
    const second = makeCard();
    second.sense.term = "book";
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
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

  it("翻面后评分记录 revealed=true", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
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
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
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
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.keyDown(window, { key: "5" });
    expect(harness.grade).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "2" });
    await screen.findByText("本轮复习完成");
    expect(harness.grade).toHaveBeenCalledWith(card, "hard", expect.anything());
  });

  it("评完所有卡进入完成态并显示计数", async () => {
    const first = makeCard();
    const second = makeCard();
    const harness = makeHarness({ queue: [first, second] });
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
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
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText("词库还是空的")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /导入内置示例词表/ }));

    await expectCardShown("apple");
    expect(harness.importSampleWordlist).toHaveBeenCalledTimes(1);
    expect(harness.loadQueue).toHaveBeenCalledTimes(2);
  });

  it("有词但今日无到期：显示对应提示", async () => {
    const harness = makeHarness({ queue: [], hasItems: true });
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText("今天没有到期的词")).toBeInTheDocument();
  });

  it("加载失败：显示错误与重试，重试成功后进入复习", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [], loadError: new Error("IndexedDB 不可用") });
    harness.loadQueue
      .mockRejectedValueOnce(new Error("IndexedDB 不可用"))
      .mockResolvedValue([card]);
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB 不可用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await expectCardShown(card.sense.term);
  });

  it("点击导出备份：调用数据源导出并触发下载", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    // jsdom 未实现 URL.createObjectURL，桩掉以验证下载被触发
    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    try {
      render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
      await expectCardShown(card.sense.term);

      fireEvent.click(screen.getByRole("button", { name: "导出备份" }));

      await waitFor(() => expect(harness.exportBackup).toHaveBeenCalledTimes(1));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      clickSpy.mockRestore();
    }
  });

  it("导出失败：显示错误提示", async () => {
    const card = makeCard();
    const harness = makeHarness({ queue: [card] });
    harness.exportBackup.mockRejectedValue(new Error("IndexedDB 不可用"));
    render(<ReviewScreen provider={harness.provider} onExit={() => {}} />);
    await expectCardShown(card.sense.term);

    fireEvent.click(screen.getByRole("button", { name: "导出备份" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败");
  });
});
