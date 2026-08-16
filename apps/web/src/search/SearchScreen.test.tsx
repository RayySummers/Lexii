/**
 * 搜词页组件测试（mock 数据源，不触碰 IndexedDB）。
 *
 * 覆盖状态机：词库空 / 初始提示 / 检索中 → 结果列表（含计数 live region）/
 * 无命中（库内无此词提示，RAY-292 口径）/ 错误（友好文案 + 错误详情折叠）；
 * 交互细节：空白查询不发起检索、防抖只执行最后一次查询、清空输入与
 * 组件卸载使在途请求失效（请求序号守卫，Oscar 评审 suggestion 1 修复口径）；
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

  it("检索失败展示友好文案，原始信息折叠在「错误详情」中（输入框保持可用）", async () => {
    const provider = makeProvider({
      search: vi.fn().mockRejectedValue(new Error("索引损坏")),
    });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("app");

    // 主提示为固定友好文案，不直接透出内部错误（Oscar 评审 nit 1 口径）
    expect(await screen.findByRole("alert")).toHaveTextContent("本地检索暂时不可用，请稍后重试。");
    expect(screen.queryByText("检索失败：索引损坏")).not.toBeInTheDocument();
    // 原始错误信息只在「错误详情」折叠区
    const details = screen.getByText("错误详情").closest("details");
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent("索引损坏");
    expect(screen.getByLabelText("搜索词条")).toBeInTheDocument();
  });

  it("清空输入使在途请求失效：过期响应不回写结果（评审 suggestion 1）", async () => {
    vi.useFakeTimers();
    let resolveSearch!: (value: SearchResult[]) => void;
    const provider = makeProvider({
      search: vi.fn(
        () =>
          new Promise<SearchResult[]>((resolve) => {
            resolveSearch = resolve;
          }),
      ),
    });
    render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("app");
    await act(async () => {
      vi.advanceTimersByTime(200); // 防抖到期：发起在途检索（promise 挂起未返回）
    });
    expect(provider.search).toHaveBeenCalledTimes(1);

    typeQuery(""); // 清空输入：复位检索区状态并使在途请求失效

    await act(async () => {
      resolveSearch([makeResult("apple", ["苹果"])]); // 过期响应此刻才到达
    });

    // 过期结果被序号守卫丢弃：不显示词条/计数，保持初始检索提示
    expect(screen.queryByText("apple")).not.toBeInTheDocument();
    expect(screen.queryByText("找到 1 条结果")).not.toBeInTheDocument();
    expect(screen.getByText(/输入英文单词或中文释义关键词/)).toBeInTheDocument();
  });

  it("卸载后到达的过期响应不回写状态（序号守卫随卸载清理生效）", async () => {
    vi.useFakeTimers();
    let resolveSearch!: (value: SearchResult[]) => void;
    const provider = makeProvider({
      search: vi.fn(
        () =>
          new Promise<SearchResult[]>((resolve) => {
            resolveSearch = resolve;
          }),
      ),
    });
    const { unmount } = render(<SearchScreen provider={provider} onExit={() => {}} />);

    typeQuery("app");
    await act(async () => {
      vi.advanceTimersByTime(200); // 发起在途检索
    });
    unmount();

    await act(async () => {
      resolveSearch([makeResult("apple", ["苹果"])]); // 卸载后才到达
    });
    // 无异常即通过：卸载清理递增序号，过期响应被丢弃、不再触发任何状态写入
    expect(provider.search).toHaveBeenCalledTimes(1);
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
});
