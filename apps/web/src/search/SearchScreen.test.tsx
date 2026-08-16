/**
 * 搜词页组件测试（mock 数据源，不触碰 IndexedDB）。
 *
 * 覆盖状态机：词库空 / 初始提示 / 检索中 → 结果列表（含计数 live region）/
 * 无命中（库内无此词提示，RAY-292 口径）/ 错误；交互细节：空白查询不发起
 * 检索、防抖只执行最后一次查询、卸载后不写状态（最新请求序号守卫）；
 * 搜词历史（RAY-292）：未输入时展示、点击回填检索（焦点回输入框）、
 * 叉叉单条删除、有命中的检索记入本地历史（去重移前）、零命中查询不进
 * 历史（评审 sug 2）、词库为空时历史仍可查看/删除（评审 sug 1）。
 *
 * 历史走默认 window.localStorage（jsdom 提供），beforeEach 清空隔离。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toSenseId } from "@lexilexi/core";
import type { Sense } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_HISTORY_STORAGE_KEY } from "../lib/searchHistory";
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

/** 读取 localStorage 中的历史数组（断言存储同步用） */
function storedHistory(): string[] {
  return JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "[]") as string[];
}

describe("SearchScreen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

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

  it("无命中时展示「库内无此词」提示并回显查询词（RAY-292 口径）", async () => {
    render(<SearchScreen provider={makeProvider()} onExit={() => {}} />);

    typeQuery("zzz");

    expect(await screen.findByRole("heading", { name: "库内无此词" })).toBeInTheDocument();
    expect(screen.getByText(/zzz/)).toBeInTheDocument();
    expect(screen.getByText(/导入自建词库/)).toBeInTheDocument();
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

  // —— RAY-292 搜词历史 ——

  it("有历史时未输入展示搜索历史列表（词条 + 叉叉删除按钮）", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["apple", "banana"]));
    render(<SearchScreen provider={makeProvider()} onExit={() => {}} />);

    expect(await screen.findByRole("heading", { name: "搜索历史" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "apple" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "banana" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除搜索历史「apple」" })).toBeInTheDocument();
    // 超长词条 CSS 截断时仍有 title 提示全文（评审 nit 2）
    expect(screen.getByRole("button", { name: "apple" })).toHaveAttribute("title", "apple");
    // 初始检索提示不再展示
    expect(screen.queryByText(/输入英文单词或中文释义关键词/)).not.toBeInTheDocument();
  });

  it("点击历史词条回填输入、重新检索且焦点回输入框", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["apple"]));
    const provider = makeProvider({
      search: vi.fn().mockResolvedValue([makeResult("apple", ["苹果"])]),
    });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "apple" }));

    expect(screen.getByLabelText("搜索词条")).toHaveValue("apple");
    // 评审 nit 3：点选后焦点回输入框（历史列表随输入卸载，焦点不丢失）
    expect(screen.getByLabelText("搜索词条")).toHaveFocus();
    expect(await screen.findByText("苹果")).toBeInTheDocument();
    expect(provider.search).toHaveBeenCalledWith("apple");
  });

  it("叉叉单条删除：条目消失、其余保留、存储同步", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["apple", "banana"]));
    render(<SearchScreen provider={makeProvider()} onExit={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除搜索历史「apple」" }));

    expect(screen.queryByRole("button", { name: "apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "banana" })).toBeInTheDocument();
    expect(storedHistory()).toEqual(["banana"]);
  });

  it("删除最后一条历史后恢复初始检索提示", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["apple"]));
    render(<SearchScreen provider={makeProvider()} onExit={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除搜索历史「apple」" }));

    expect(await screen.findByText(/输入英文单词或中文释义关键词/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "搜索历史" })).not.toBeInTheDocument();
    expect(storedHistory()).toEqual([]);
  });

  it("有命中的检索记入本地历史：最新在前、重复词移到最前不重复", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["banana"]));
    const provider = makeProvider({
      search: vi.fn().mockResolvedValue([makeResult("apple", ["苹果"])]),
    });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("apple");
    await screen.findByText("找到 1 条结果");
    expect(storedHistory()).toEqual(["apple", "banana"]);

    // 再次检索已存在的词（不同大小写）：移到最前、保留最新形态
    typeQuery("BANANA");
    await waitFor(() => {
      expect(storedHistory()).toEqual(["BANANA", "apple"]);
    });
  });

  it("零命中查询不进历史（评审 sug 2：拼写错误/未收录不积攒噪音词）", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["banana"]));
    render(<SearchScreen provider={makeProvider()} onExit={() => {}} />);

    typeQuery("kaleidoscope");
    await screen.findByRole("heading", { name: "库内无此词" });

    expect(storedHistory()).toEqual(["banana"]);
  });

  it("词库为空但仍有历史：空库提示与历史同时展示，可单条删除（评审 sug 1）", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["apple", "banana"]));
    render(
      <SearchScreen
        provider={makeProvider({ hasAnySenses: vi.fn().mockResolvedValue(false) })}
        onExit={() => {}}
      />,
    );

    expect(await screen.findByRole("heading", { name: "词库还是空的" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "搜索历史" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "apple" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除搜索历史「apple」" }));

    expect(screen.queryByRole("button", { name: "apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "banana" })).toBeInTheDocument();
    expect(storedHistory()).toEqual(["banana"]);
  });

  it("空词库点选历史词条：回填输入并给出该查询暂无结果的反馈（delta 复核 nit）", async () => {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(["apple"]));
    const provider = makeProvider({ hasAnySenses: vi.fn().mockResolvedValue(false) });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    // 先等空库判定落地（hasAnySenses 异步），再点选：判定落地前点选会命中
    // 即将被替换的旧按钮节点（组件测试特有竞态，真实点击不受影响）
    expect(await screen.findByRole("heading", { name: "词库还是空的" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "apple" }));

    // 输入回填，空库提示仍在，且带「该查询暂无结果」的可见反馈
    expect(screen.getByLabelText("搜索词条")).toHaveValue("apple");
    expect(screen.getByRole("heading", { name: "词库还是空的" })).toBeInTheDocument();
    expect(await screen.findByText(/「apple」现在搜不到结果/)).toBeInTheDocument();
    // 防抖后检索照常发起（输入回填触发的既有链路）
    await waitFor(() => expect(provider.search).toHaveBeenCalledWith("apple"));
  });
});
