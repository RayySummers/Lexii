/**
 * SearchScreen 近义词跳转补充测试（RAY-367 S1）。
 *
 * 覆盖：A→B→A 去重、currentQuery 循环禁用、栈上限 20 截断（纯函数）、breadcrumb 显隐、无结果态仍可返回。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toSenseId } from "@lexii/core";
import type { Sense } from "@lexii/core";
import { describe, expect, it, vi } from "vitest";
import { pushToStack, SearchScreen } from "./SearchScreen";
import type { SearchDataProvider, SearchResult } from "./types";

function makeSense(term: string, synonyms: string[], definitions: string[] = [`${term}释义`]): Sense {
  return {
    id: toSenseId(`sense_syn_${term}`),
    lang: "en",
    term,
    definitions,
    pos: "vt.",
    posByDefinition: definitions.map(() => "vt."),
    synonyms,
    tags: [],
    examples: [],
  } as Sense;
}

function makeResult(term: string, synonyms: string[]): SearchResult {
  return { sense: makeSense(term, synonyms), kind: "term-prefix", source: "learning" };
}

function makeProvider(map: Record<string, SearchResult[]>): SearchDataProvider {
  return {
    search: vi.fn(async (query: string) => map[query.trim().toLowerCase()] ?? []),
    hasAnySenses: vi.fn().mockResolvedValue(true),
    getNotebookSenseIds: vi.fn().mockResolvedValue([]),
    addToNotebook: vi.fn().mockResolvedValue("added"),
    removeFromNotebookBySenseId: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SearchScreen 近义词跳转（RAY-367）", () => {
  it("点击近义词：query 更新为该词，面包屑出现且返回可回退", async () => {
    const provider = makeProvider({
      abandon: [makeResult("abandon", ["abjure", "desert"])],
      abjure: [makeResult("abjure", ["abandon"])],
    });
    render(<SearchScreen provider={provider} onExit={vi.fn()} initialQuery="abandon" />);

    expect(await screen.findByText("abandon")).toBeInTheDocument();
    expect(screen.getByText("abjure")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "搜索近义词 abjure" }));
    expect(await screen.findByText("abjure")).toBeInTheDocument();
    expect(screen.getByText(/来自「abandon」/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByText("abandon")).toBeInTheDocument());
  });

  it("A→B→A 去重：栈内不重复，循环链可往返", async () => {
    const provider = makeProvider({
      abandon: [makeResult("abandon", ["abjure"])],
      abjure: [makeResult("abjure", ["abandon"])],
    });
    const onExit = vi.fn();
    render(<SearchScreen provider={provider} onExit={onExit} initialQuery="abandon" />);

    await screen.findByText("abandon");
    fireEvent.click(screen.getByRole("button", { name: "搜索近义词 abjure" }));
    await screen.findByText("abjure");
    fireEvent.click(screen.getByRole("button", { name: "搜索近义词 abandon" }));
    await screen.findByText("abandon");
    // 此时栈应为 [abjure]，点面包屑返回回到 abjure
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByText("abjure")).toBeInTheDocument());
    // 栈已空，面包屑消失；再点 header 返回首页触发 onExit
    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });

  it("currentQuery 循环禁用：与当前输入相同的近义词不可点击", async () => {
    const provider = makeProvider({
      app: [makeResult("apple", ["app", "apply"])],
    });
    render(<SearchScreen provider={provider} onExit={vi.fn()} initialQuery="app" />);
    await screen.findByText("apple");
    expect(screen.queryByRole("button", { name: "搜索近义词 app" })).toBeNull();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索近义词 apply" })).toBeInTheDocument();
  });

  it("面包屑仅在栈非空时显示", async () => {
    const provider = makeProvider({
      abandon: [makeResult("abandon", ["abjure"])],
      abjure: [makeResult("abjure", ["desert"])],
    });
    render(<SearchScreen provider={provider} onExit={vi.fn()} initialQuery="abandon" />);
    await screen.findByText("abandon");
    expect(screen.queryByText(/来自「/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "搜索近义词 abjure" }));
    await screen.findByText("abjure");
    expect(screen.getByText(/来自「abandon」/)).toBeInTheDocument();
  });

  it("无结果态仍可返回：近义词搜不到时显示无词并保留返回", async () => {
    const provider = makeProvider({
      abandon: [makeResult("abandon", ["unknownword"])],
    });
    const onExit = vi.fn();
    render(<SearchScreen provider={provider} onExit={onExit} initialQuery="abandon" />);
    await screen.findByText("abandon");
    fireEvent.click(screen.getByRole("button", { name: "搜索近义词 unknownword" }));
    expect(await screen.findByText("库内无此词")).toBeInTheDocument();
    expect(screen.getByText(/来自「abandon」/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByText("abandon")).toBeInTheDocument());
    expect(onExit).not.toHaveBeenCalled();
  });

  it("栈上限 20 截断：pushToStack 连续 25 次后长度为 20且保留最新", () => {
    let stack: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const cur = `word${i}`;
      const next = `word${i + 1}`;
      stack = pushToStack(stack, cur, next);
    }
    expect(stack).toHaveLength(20);
    // 保留最新 20：应为 word5..word24（首 5 被截断）
    expect(stack[0]).toBe("word5");
    expect(stack[stack.length - 1]).toBe("word24");
    // 去重：重复项应被移除后重压
    const withDup = pushToStack(["a", "b", "c"], "d", "b");
    expect(withDup).toEqual(["a", "c", "d"]);
  });
});
