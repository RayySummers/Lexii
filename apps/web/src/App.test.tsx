import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { makeCard } from "./review/testFixtures";
import type { ReviewDataProvider } from "./review/types";

/** 测试接缝：注入 mock 数据源工厂，避免渲染时触碰浏览器 IndexedDB */
function makeProviderFactory(queue = [makeCard()]) {
  const provider: ReviewDataProvider = {
    loadQueue: vi.fn().mockResolvedValue(queue),
    grade: vi.fn().mockResolvedValue(undefined),
    hasAnyItems: vi.fn().mockResolvedValue(queue.length > 0),
    importSampleWordlist: vi.fn().mockResolvedValue(14),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

describe("App", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
  });

  it("渲染品牌名与首页复习入口", () => {
    render(<App reviewProviderFactory={makeProviderFactory().factory} />);
    expect(screen.getByText("乐希")).toBeInTheDocument();
    expect(screen.getByText("Lexilexi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始复习" })).toBeInTheDocument();
  });

  it("点击按钮在浅色/深色主题间切换并写入 data-theme", () => {
    render(<App reviewProviderFactory={makeProviderFactory().factory} />);
    const button = screen.getByRole("button", { name: "切换到深色模式" });
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "切换到浅色模式" }));
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("开始复习进入复习界面（惰性创建数据源），返回首页退出", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const { factory } = makeProviderFactory([card]);
    render(<App reviewProviderFactory={factory} />);

    // 未进入复习前不创建数据源（避免 jsdom 下触碰 IndexedDB）
    expect(factory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始复习" }));
    // 词条在卡片两面都会渲染，用翻面按钮的可达名定位当前卡
    expect(await screen.findByRole("button", { name: "显示 apple 的释义" })).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "开始复习" })).toBeInTheDocument();
  });
});
