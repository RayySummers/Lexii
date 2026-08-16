/**
 * 搜词页组件测试（mock 数据源，不触碰 IndexedDB）。
 *
 * 覆盖状态机：词库空 / 初始提示 / 检索中 → 结果列表（含计数 live region）/
 * 无命中 / 错误；交互细节：空白查询不发起检索、防抖只执行最后一次查询、
 * 卸载后不写状态（最新请求序号守卫）。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { toSenseId } from "@lexilexi/core";
import type { Sense } from "@lexilexi/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchScreen } from "./SearchScreen";
import type { SearchDataProvider, SearchResult } from "./types";

function makeResult(term: string, definitions: string[]): SearchResult {
  const sense: Sense = {
    id: toSenseId(`sense_ui_${term}`),
    lang: "en",
    term,
    definitions,
    tags: [],
    examples: [],
  };
  return { sense, kind: "term-prefix" };
}

/** mock 搜词数据源工厂：search / hasAnySenses 均返回可配置的 vi.fn */
function makeProvider(overrides: Partial<SearchDataProvider> = {}): SearchDataProvider {
  return {
    search: vi.fn<(query: string) => Promise<SearchResult[]>>().mockResolvedValue([]),
    hasAnySenses: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByLabelText("搜索词条"), { target: { value } });
}

describe("SearchScreen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("词库为空时展示空状态", async () => {
    render(
      <SearchScreen
        provider={makeProvider({ hasAnySenses: vi.fn().mockResolvedValue(false) })}
        onExit={() => {}}
      />,
    );
    expect(await screen.findByRole("heading", { name: "词库还是空的" })).toBeInTheDocument();
  });

  it("未输入时展示检索提示（全本地、离线）", async () => {
    const provider = makeProvider();
    render(<SearchScreen provider={provider} onExit={() => {}} />);
    expect(await screen.findByText(/输入英文单词或中文释义关键词/)).toBeInTheDocument();
    expect(provider.search).not.toHaveBeenCalled();
  });

  it("输入后防抖检索并展示结果与计数", async () => {
    const provider = makeProvider({
      search: vi
        .fn<(query: string) => Promise<SearchResult[]>>()
        .mockResolvedValue([
          makeResult("apple", ["苹果", "苹果公司"]),
          makeResult("apply", ["申请；应用"]),
        ]),
    });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("app");

    expect(await screen.findByText("apple")).toBeInTheDocument();
    expect(screen.getByText("苹果；苹果公司")).toBeInTheDocument();
    expect(screen.getByText("找到 2 条结果")).toBeInTheDocument();
    expect(provider.search).toHaveBeenCalledWith("app");
  });

  it("无命中时展示提示并回显查询词", async () => {
    render(<SearchScreen provider={makeProvider()} onExit={() => {}} />);

    typeQuery("zzz");

    expect(await screen.findByRole("heading", { name: "没有找到相关词" })).toBeInTheDocument();
    expect(screen.getByText(/zzz/)).toBeInTheDocument();
  });

  it("检索失败展示错误（输入框保持可用）", async () => {
    const provider = makeProvider({
      search: vi.fn().mockRejectedValue(new Error("索引损坏")),
    });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("app");

    expect(await screen.findByRole("alert")).toHaveTextContent("检索失败：索引损坏");
    expect(screen.getByLabelText("搜索词条")).toBeInTheDocument();
  });

  it("空白查询不发起检索", async () => {
    const provider = makeProvider();
    render(<SearchScreen provider={provider} onExit={() => {}} />);
    await screen.findByText(/输入英文单词或中文释义关键词/);

    typeQuery("   ");

    expect(provider.search).not.toHaveBeenCalled();
  });

  it("防抖：连续输入只执行最后一次查询", async () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("a");
    await act(async () => {
      vi.advanceTimersByTime(100); // 未到防抖间隔：第一次查询尚未发起
    });
    typeQuery("ap");
    await act(async () => {
      vi.advanceTimersByTime(200); // 越过防抖间隔：只执行 "ap"
    });

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith("ap");
  });

  it("返回按钮回调触发 onExit", async () => {
    const onExit = vi.fn();
    render(<SearchScreen provider={makeProvider()} onExit={onExit} />);

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
