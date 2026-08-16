/**
 * 生词本页面组件测试（mock 数据源，不触碰 IndexedDB）。
 *
 * 覆盖状态机：加载中 → 空状态（引导加词入口）→ 列表（词条 + 释义 +
 * 移出两步确认）→ 错误（友好文案 + 错误详情折叠 + 重试）；移出成功后
 * 重新加载列表，移出失败给出反馈。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NotebookEntry } from "@lexilexi/core";
import { toNotebookEntryId, toSenseId } from "@lexilexi/core";
import type { Sense } from "@lexilexi/core";
import { describe, expect, it, vi } from "vitest";
import { NotebookScreen } from "./NotebookScreen";
import type { NotebookDataProvider, NotebookListItem } from "./types";

function makeItem(term: string, definitions: string[]): NotebookListItem {
  const sense: Sense = {
    id: toSenseId(`sense_ui_${term}`),
    lang: "en",
    term,
    definitions,
    pos: "n.",
    ipa: "/tɜːm/",
    tags: [],
    examples: [],
  };
  const entry: NotebookEntry = {
    id: toNotebookEntryId(`nb_ui_${term}`),
    itemId: `item_ui_${term}` as NotebookEntry["itemId"],
    senseId: sense.id,
    term,
    addedAt: "2026-08-14T00:00:00.000Z",
    status: "active",
    removedAt: null,
  };
  return { entry, sense };
}

function makeProvider(overrides: Partial<NotebookDataProvider> = {}): NotebookDataProvider {
  return {
    loadEntries: vi.fn().mockResolvedValue([]),
    removeWord: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("NotebookScreen", () => {
  it("空生词本展示空状态与加词入口提示", async () => {
    render(<NotebookScreen provider={makeProvider()} onExit={() => {}} />);
    expect(await screen.findByRole("heading", { name: "生词本还是空的" })).toBeInTheDocument();
    expect(screen.getByText(/搜词页的结果上点「加词」/)).toBeInTheDocument();
  });

  it("列表展示词条、词性/音标与释义", async () => {
    render(
      <NotebookScreen
        provider={makeProvider({
          loadEntries: vi
            .fn()
            .mockResolvedValue([makeItem("apple", ["苹果", "苹果公司"]), makeItem("book", ["书"])]),
        })}
        onExit={() => {}}
      />,
    );
    expect(await screen.findByText("apple")).toBeInTheDocument();
    expect(screen.getByText("苹果；苹果公司")).toBeInTheDocument();
    expect(screen.getByText("book")).toBeInTheDocument();
    expect(screen.getByText("共 2 个词")).toBeInTheDocument();
  });

  it("移出走两步确认：确认后调用 removeWord 并重新加载", async () => {
    const loadEntries = vi.fn().mockResolvedValue([makeItem("apple", ["苹果"])]);
    const removeWord = vi.fn().mockResolvedValue(undefined);
    render(
      <NotebookScreen provider={makeProvider({ loadEntries, removeWord })} onExit={() => {}} />,
    );

    const removeButton = await screen.findByRole("button", { name: "把「apple」移出生词本" });
    fireEvent.click(removeButton);
    // 第一步只进入确认态，不触发移出
    expect(removeWord).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认移出" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认移出" }));
    await waitFor(() => expect(removeWord).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(loadEntries).toHaveBeenCalledTimes(2));
  });

  it("取消确认：不触发移出", async () => {
    const removeWord = vi.fn().mockResolvedValue(undefined);
    render(
      <NotebookScreen
        provider={makeProvider({
          loadEntries: vi.fn().mockResolvedValue([makeItem("apple", ["苹果"])]),
          removeWord,
        })}
        onExit={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "把「apple」移出生词本" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(removeWord).not.toHaveBeenCalled();
    // 回到未确认态
    expect(screen.getByRole("button", { name: "把「apple」移出生词本" })).toBeInTheDocument();
  });

  it("移出失败展示错误反馈，列表保留", async () => {
    const removeWord = vi.fn().mockRejectedValue(new Error("生词本条目不存在"));
    render(
      <NotebookScreen
        provider={makeProvider({
          loadEntries: vi.fn().mockResolvedValue([makeItem("apple", ["苹果"])]),
          removeWord,
        })}
        onExit={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "把「apple」移出生词本" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移出" }));
    expect(await screen.findByText(/移出失败：生词本条目不存在/)).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
  });

  it("加载失败展示友好文案 + 错误详情折叠 + 重试", async () => {
    const loadEntries = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]);
    render(<NotebookScreen provider={makeProvider({ loadEntries })} onExit={() => {}} />);

    // 主提示为固定友好文案，不直接透出内部错误
    expect(await screen.findByText("生词本暂时无法加载，请稍后重试。")).toBeInTheDocument();
    // 原始错误信息只在「错误详情」折叠区
    const details = screen.getByText("错误详情").closest("details");
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent("boom");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "生词本还是空的" })).toBeInTheDocument();
  });
});
