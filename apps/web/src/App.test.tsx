import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexilexiExportData } from "@lexilexi/core";
import { App } from "./App";
import { makeCard } from "./review/testFixtures";
import type { ReviewDataProvider } from "./review/types";
import type { SettingsDataProvider } from "./settings/types";
import type { StatsDataProvider } from "./stats/types";

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

/** 测试接缝：注入 mock 复习数据源工厂，避免渲染时触碰浏览器 IndexedDB */
function makeReviewProviderFactory(queue = [makeCard()]) {
  const provider: ReviewDataProvider = {
    loadQueue: vi.fn().mockResolvedValue(queue),
    grade: vi.fn().mockResolvedValue(undefined),
    hasAnyItems: vi.fn().mockResolvedValue(queue.length > 0),
    importSampleWordlist: vi.fn().mockResolvedValue(14),
    exportBackup: vi.fn().mockResolvedValue(EMPTY_EXPORT),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

/** 测试接缝：注入 mock 设置页数据源工厂 */
function makeSettingsProviderFactory() {
  const provider: SettingsDataProvider = {
    loadOverview: vi.fn().mockResolvedValue({ itemCount: 0, reviewCount: 0, streakDays: 0 }),
    exportBackup: vi.fn().mockResolvedValue(EMPTY_EXPORT),
    exportWordlistCsv: vi.fn().mockResolvedValue("term,definition,pos"),
    importBackup: vi.fn().mockResolvedValue({ items: 0, senses: 0, memoryStates: 0, events: 0 }),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

/** 测试接缝：注入 mock 统计数据源工厂（首页徽标 + 统计页） */
function makeStatsProviderFactory(snapshot = { dueCount: 0, reviewCount: 0, streakDays: 0 }) {
  const provider: StatsDataProvider = {
    loadStats: vi.fn().mockResolvedValue(snapshot),
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
    render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);
    expect(screen.getByText("乐希")).toBeInTheDocument();
    expect(screen.getByText("Lexilexi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始复习" })).toBeInTheDocument();
  });

  it("点击按钮在浅色/深色主题间切换并写入 data-theme", () => {
    render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);
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
    const { factory } = makeReviewProviderFactory([card]);
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

  it("点击设置进入设置页（惰性创建数据源），返回首页退出", async () => {
    const { factory } = makeSettingsProviderFactory();
    render(
      <App
        reviewProviderFactory={makeReviewProviderFactory().factory}
        settingsProviderFactory={factory}
      />,
    );

    expect(factory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("button", { name: "导出 JSON 完整备份" })).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "开始复习" })).toBeInTheDocument();
  });

  it("首页显示今日到期徽标（统计数据源挂载即创建一次）", async () => {
    const { factory: statsFactory } = makeStatsProviderFactory({
      dueCount: 3,
      reviewCount: 10,
      streakDays: 2,
    });
    const { factory: reviewFactory } = makeReviewProviderFactory();
    render(<App reviewProviderFactory={reviewFactory} statsProviderFactory={statsFactory} />);

    expect(await screen.findByText("今日到期 3 词")).toBeInTheDocument();
    expect(statsFactory).toHaveBeenCalledTimes(1);
    // 复习数据源保持惰性：仅展示徽标不创建复习源
    expect(reviewFactory).not.toHaveBeenCalled();
  });

  it("点击统计进入统计页，返回首页退出", async () => {
    const statsFactory = makeStatsProviderFactory({ dueCount: 2, reviewCount: 8, streakDays: 1 });
    render(
      <App
        reviewProviderFactory={makeReviewProviderFactory().factory}
        statsProviderFactory={statsFactory.factory}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    expect(await screen.findByText("连续天数")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "开始复习" })).toBeInTheDocument();
  });
});
