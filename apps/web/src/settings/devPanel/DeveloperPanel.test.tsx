/**
 * 开发者面板组件测试（RAY-297 任务 B）：
 * 渲染各分组（通道切换器 / 构建信息 / 版本回退 / 数据库调试 / FSRS 调试 /
 * Feature flags）、二次确认清库、flag 开关持久化、读取失败的错误展示。
 *
 * 数据源注入 mock（不依赖 IndexedDB）；构建信息走 APP_BUILD（vitest define
 * 注入，与 vite build 同一来源）；通道检测以 jsdom 默认路径 "/" 为 release。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../lib/appVersion";
import { APP_BUILD } from "./buildInfo";
import { DeveloperPanel } from "./DeveloperPanel";
import type { DatabaseDebug, DeveloperDataProvider, FsrsDebug } from "./types";

const DATABASE_DEBUG: DatabaseDebug = {
  dbName: "lexii",
  schemaVersion: 4,
  tables: [
    { name: "items", count: 12 },
    { name: "senses", count: 14 },
    { name: "memoryStates", count: 16 },
    { name: "events", count: 34 },
    { name: "meta", count: 2 },
  ],
};

const FSRS_DEBUG: FsrsDebug = {
  parameters: {
    request_retention: 0.9,
    maximum_interval: 36_500,
    w: [0.21, 1.29, 2.31],
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"],
  },
  counts: { new: 3, learning: 2, review: 6, relearning: 1 },
  dueSample: [
    {
      itemId: "itm_test_1",
      term: "apple",
      due: "2026-09-01T08:00:00.000Z",
      stabilityDays: 2.51,
      difficulty: 4.21,
    },
  ],
};

interface PanelHarness {
  provider: DeveloperDataProvider;
  loadDatabaseDebug: ReturnType<typeof vi.fn>;
  loadFsrsDebug: ReturnType<typeof vi.fn>;
  clearDatabase: ReturnType<typeof vi.fn>;
}

function makeProvider(): PanelHarness {
  const loadDatabaseDebug = vi.fn<() => Promise<DatabaseDebug>>().mockResolvedValue(DATABASE_DEBUG);
  const loadFsrsDebug = vi.fn<() => Promise<FsrsDebug>>().mockResolvedValue(FSRS_DEBUG);
  const clearDatabase = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const provider: DeveloperDataProvider = { loadDatabaseDebug, loadFsrsDebug, clearDatabase };
  return { provider, loadDatabaseDebug, loadFsrsDebug, clearDatabase };
}

function renderPanel(provider: DeveloperDataProvider) {
  return render(<DeveloperPanel providerFactory={() => provider} />);
}

describe("DeveloperPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("渲染全部分组与通道切换器（jsdom 根路径 → release，链接指向 /dev/）", async () => {
    const { provider } = makeProvider();
    renderPanel(provider);

    for (const heading of [
      "通道",
      "构建信息",
      "版本回退",
      "数据库调试",
      "FSRS 调试",
      "Feature flags",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "开发者" })).toBeInTheDocument();
    // 当前通道 release（jsdom location.pathname === "/"）
    expect(screen.getAllByText("Release（稳定版）").length).toBeGreaterThan(0);
    const switchLink = screen.getByRole("link", { name: "切换到 Dev 通道" });
    expect(switchLink).toHaveAttribute("href", "/dev/");
  });

  it("构建信息展示版本 / SHA / 构建时间 / 分支（构建时注入，不硬编码）", async () => {
    const { provider } = makeProvider();
    renderPanel(provider);

    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
    expect(screen.getByText(APP_BUILD.sha)).toBeInTheDocument();
    expect(screen.getByText(APP_BUILD.time)).toBeInTheDocument();
    // RAY-368 回归：branch 可能与 releaseTags[0] 同值（v0.9.1-alpha），DOM 会出现两个相同文本
    // （分支字段的 <dd> + 版本回退的 <a>），用分支字段的 <dt>/<dd> 结构精确定位
    const branchLabel = screen.getByText("分支 / tag");
    const branchValueEl = branchLabel.closest("div")?.querySelector("dd");
    expect(branchValueEl).not.toBeNull();
    expect(branchValueEl).toHaveTextContent(APP_BUILD.branch);
    // 兜底：页面上至少有一处分支文本可见（防止未来 DOM 结构调整导致漏测）
    expect(screen.getAllByText(APP_BUILD.branch).length).toBeGreaterThanOrEqual(1);
  });

  it("版本回退：历史 Release 列表渲染为 GitHub Release 外链，当前版本有标记", async () => {
    const { provider } = makeProvider();
    renderPanel(provider);

    for (const tag of APP_BUILD.releaseTags) {
      expect(screen.getByRole("link", { name: tag }).getAttribute("href")).toBe(
        `https://github.com/RayySummers/Lexii/releases/tag/${tag}`,
      );
    }
    // 当前版本（releaseTags 首位）带「（当前）」标记
    expect(screen.getByText("（当前）")).toBeInTheDocument();
  });

  it("数据库调试：展示 schema 版本与各表记录数", async () => {
    const { provider } = makeProvider();
    renderPanel(provider);

    expect(await screen.findByText("v4")).toBeInTheDocument();
    expect(screen.getByText("lexii")).toBeInTheDocument();
    for (const table of DATABASE_DEBUG.tables) {
      expect(screen.getByText(table.name)).toBeInTheDocument();
      expect(screen.getByText(`${table.count} 条`)).toBeInTheDocument();
    }
  });

  it("清空数据库需要二次确认：首次点击武装、再次点击才执行并提示成功", async () => {
    const harness = makeProvider();
    renderPanel(harness.provider);

    const button = await screen.findByRole("button", { name: "清空本地数据库" });
    fireEvent.click(button);
    expect(harness.clearDatabase).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "再次点击确认清空（不可恢复）" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再次点击确认清空（不可恢复）" }));
    expect(harness.clearDatabase).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("数据库已清空");
  });

  it("FSRS 调试：展示当前参数、状态分布与到期样例", async () => {
    const { provider } = makeProvider();
    renderPanel(provider);

    expect(await screen.findByText("0.9")).toBeInTheDocument();
    expect(screen.getByText("36,500".replace(/,/g, ""))).toBeInTheDocument();
    expect(screen.getByText("新词：3")).toBeInTheDocument();
    expect(screen.getByText("学习中：2")).toBeInTheDocument();
    expect(screen.getByText("复习：6")).toBeInTheDocument();
    expect(screen.getByText("重学：1")).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
    expect(
      screen.getByText(/到期 2026-09-01T08:00:00\.000Z · S 2\.51 · D 4\.21/),
    ).toBeInTheDocument();
  });

  it("Feature flags：勾选即持久化到 localStorage，读回状态一致", async () => {
    const { provider } = makeProvider();
    renderPanel(provider);

    const checkbox = screen.getByLabelText(/听写练习形式/);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    const stored = JSON.parse(window.localStorage.getItem("lexii:feature-flags") ?? "{}");
    expect(stored.dictation).toBe(true);
  });

  it("数据源读取失败时展示错误提示（role=alert），不崩溃", async () => {
    const failing: DeveloperDataProvider = {
      loadDatabaseDebug: vi.fn().mockRejectedValue(new Error("IndexedDB 不可用")),
      loadFsrsDebug: vi.fn().mockRejectedValue(new Error("IndexedDB 不可用")),
      clearDatabase: vi.fn().mockResolvedValue(undefined),
    };
    renderPanel(failing);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("读取失败");
    expect(alert).toHaveTextContent("IndexedDB 不可用");
  });
});
