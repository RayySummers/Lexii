/**
 * 词书库页测试（RAY-262 + RAY-288）。
 *
 * 覆盖：目录分组展示（考试词汇/冲刺词书）、状态徽标（已装/未装/安装中）、
 * 安装触发与成功提示（新增/跳过计数）、安装失败错误提示、安装中进度与
 * 「继续安装」、轮询刷新、返回导航；词书库概览（词书总数/词条总数/
 * 已装词书/已装词条，词书规模口径，RAY-288）。mock 数据源，不依赖 IndexedDB。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WORDBOOK_CATALOG } from "@lexii/core/presets/books";
import type { SettingsDataProvider, WordbookSummary } from "./types";
import { WordbookLibraryScreen } from "./WordbookLibraryScreen";

/** 用真实词书目录构造给定 id 的状态摘要 */
function makeSummaries(overrides: Partial<WordbookSummary>[]): WordbookSummary[] {
  return overrides.map((override) => ({
    id: "book-cet6",
    status: "not-installed",
    installedCount: 0,
    totalCount: WORDBOOK_CATALOG.find((book) => book.id === override.id)?.terms.length ?? 0,
    ...override,
  }));
}

function makeProvider(overrides?: {
  summaries?: WordbookSummary[];
  installError?: Error;
  installResult?: { installedCount: number; skippedCount: number };
}): {
  provider: SettingsDataProvider;
  getWordbookSummaries: ReturnType<typeof vi.fn>;
  installWordbook: ReturnType<typeof vi.fn>;
} {
  const getWordbookSummaries = vi.fn<() => Promise<WordbookSummary[]>>();
  getWordbookSummaries.mockResolvedValue(overrides?.summaries ?? []);
  const installWordbook = vi.fn<() => Promise<{ installedCount: number; skippedCount: number }>>();
  if (overrides?.installError) {
    installWordbook.mockRejectedValue(overrides.installError);
  } else {
    installWordbook.mockResolvedValue(
      overrides?.installResult ?? { installedCount: 100, skippedCount: 0 },
    );
  }
  const provider: SettingsDataProvider = {
    exportBackup: vi.fn(),
    exportWordlistCsv: vi.fn(),
    importBackup: vi.fn(),
    getPresetSummaries: vi.fn(),
    getWordbookSummaries,
    installWordbook,
  } as unknown as SettingsDataProvider;
  return { provider, getWordbookSummaries, installWordbook };
}

describe("WordbookLibraryScreen", () => {
  it("按分组展示全部 10 本词书（考试词汇 8 本 + 冲刺词书 2 本）", async () => {
    const { provider } = makeProvider();
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByText("考试词汇")).toBeInTheDocument();
    expect(screen.getByText("冲刺词书")).toBeInTheDocument();
    for (const book of WORDBOOK_CATALOG) {
      expect(screen.getByText(book.name)).toBeInTheDocument();
    }
    expect(screen.getAllByText("未安装")).toHaveLength(WORDBOOK_CATALOG.length);
  });

  it("词书库概览（RAY-288）：展示词书总数/词条总数与口径说明", async () => {
    const { provider } = makeProvider();
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    await screen.findByText("考试词汇");
    const expectedWordCount = WORDBOOK_CATALOG.reduce((sum, book) => sum + book.terms.length, 0);
    expect(screen.getByText("词书总数")).toBeInTheDocument();
    expect(screen.getByText(`${WORDBOOK_CATALOG.length} 本`)).toBeInTheDocument();
    expect(screen.getByText("词条总数")).toBeInTheDocument();
    // 千分位格式化（RAY-288 Oscar nit 2）
    expect(screen.getByText(expectedWordCount.toLocaleString("zh-CN"))).toBeInTheDocument();
    expect(screen.getByText(/词数按词书规模计，跨词书重叠词条分别计入。/)).toBeInTheDocument();
  });

  it("词书库概览（RAY-288）：已装词书/已装词条按已安装词书汇总（词书规模口径）", async () => {
    const { provider } = makeProvider({
      summaries: makeSummaries([
        { id: "book-cet6", status: "installed", installedCount: 5406, totalCount: 5406 },
        { id: "book-gre", status: "installed", installedCount: 4139, totalCount: 4139 },
        { id: "book-toefl", status: "installing", installedCount: 100, totalCount: 4308 },
      ]),
    });
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    await screen.findByText("考试词汇");
    expect(screen.getByText("已装词书")).toBeInTheDocument();
    expect(screen.getByText("2 本")).toBeInTheDocument();
    expect(screen.getByText("已装词条")).toBeInTheDocument();
    // 5406 + 4139 = 9545，千分位格式化（RAY-288 Oscar nit 2）
    expect(screen.getByText("9,545")).toBeInTheDocument();
  });

  it("词书库概览（RAY-288）：安装状态加载中已装统计显示占位", async () => {
    const provider: SettingsDataProvider = {
      exportBackup: vi.fn(),
      exportWordlistCsv: vi.fn(),
      importBackup: vi.fn(),
      getPresetSummaries: vi.fn(),
      getWordbookSummaries: vi.fn().mockImplementation(
        () => new Promise<WordbookSummary[]>(() => {}), // 永不 resolve：模拟加载中
      ),
      installWordbook: vi.fn(),
    } as unknown as SettingsDataProvider;
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    await screen.findByText("考试词汇");
    expect(screen.getAllByText("…")).toHaveLength(2);
  });

  it("冲刺词书卡片展示口径文案（层次近似词书，非官方名单）", async () => {
    const { provider } = makeProvider();
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByText("专四冲刺（近似词书）")).toBeInTheDocument();
    expect(screen.getByText(/层次近似词书，非官方专四名单/)).toBeInTheDocument();
    expect(screen.getByText(/层次近似词书，非官方专八名单/)).toBeInTheDocument();
  });

  it("已安装词书显示「已安装」徽标与禁用按钮", async () => {
    const { provider } = makeProvider({
      summaries: makeSummaries([
        {
          id: "book-cet6",
          status: "installed",
          installedCount: 5406,
          totalCount: 5406,
          installedVersion: "1.0.0",
        },
        { id: "book-gre", status: "not-installed" },
      ]),
    });
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    // 徽标 + 按钮两处「已安装」
    expect(await screen.findAllByText("已安装")).toHaveLength(2);
    expect(screen.getByText("5406 词条 · v1.0.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已安装" })).toBeDisabled();
    // 未安装的词书仍有「安装」按钮
    expect(screen.getAllByRole("button", { name: "安装" }).length).toBeGreaterThanOrEqual(1);
  });

  it("安装中：显示进度徽标与「继续安装」按钮", async () => {
    const { provider } = makeProvider({
      summaries: makeSummaries([
        { id: "book-cet6", status: "installing", installedCount: 400, totalCount: 5406 },
      ]),
    });
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByText("安装中（400/5406）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续安装" })).toBeInTheDocument();
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "400");
    expect(progressbar).toHaveAttribute("aria-valuemax", "5406");
  });

  it("点击「安装」触发 installWordbook，成功后展示新增/跳过提示并刷新状态", async () => {
    const summaries = makeSummaries([{ id: "book-cet6", status: "not-installed" }]);
    const { provider, getWordbookSummaries, installWordbook } = makeProvider({
      summaries,
      installResult: { installedCount: 5000, skippedCount: 406 },
    });
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    // 等初始加载完成后，在 CET6 卡片作用域内点击「安装」
    await screen.findByText("大学英语六级");
    const card = screen.getByText("大学英语六级").closest("div");
    if (!card) {
      throw new Error("CET6 卡片未找到");
    }
    fireEvent.click(within(card).getByRole("button", { name: "安装" }));

    await waitFor(() => {
      expect(installWordbook).toHaveBeenCalledWith("book-cet6");
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "词书已安装：新增 5000 词，跳过已存在 406 词。",
    );
    // 安装结束后刷新一次状态
    await waitFor(() => {
      expect(getWordbookSummaries.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("卸载保护：组件卸载后安装完成，不再刷新状态（mountedRef 守卫）", async () => {
    const summaries = makeSummaries([{ id: "book-cet6", status: "not-installed" }]);
    const { provider, getWordbookSummaries, installWordbook } = makeProvider({ summaries });
    // 安装 promise 由测试手动控制 resolve 时机，模拟组件卸载后才完成
    let resolveInstall!: (result: { installedCount: number; skippedCount: number }) => void;
    installWordbook.mockImplementation(
      () =>
        new Promise<{ installedCount: number; skippedCount: number }>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    const { unmount } = render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    await screen.findByText("大学英语六级");
    const card = screen.getByText("大学英语六级").closest("div");
    if (!card) {
      throw new Error("CET6 卡片未找到");
    }
    fireEvent.click(within(card).getByRole("button", { name: "安装" }));
    await waitFor(() => {
      expect(installWordbook).toHaveBeenCalledWith("book-cet6");
    });

    unmount();

    // 卸载后安装才完成：mountedRef 守卫应跳过 setState 与 refresh，
    // getWordbookSummaries 调用次数不再变化（轮询 interval 也已随卸载清理）
    const callsAtUnmount = getWordbookSummaries.mock.calls.length;
    resolveInstall({ installedCount: 5000, skippedCount: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getWordbookSummaries.mock.calls.length).toBe(callsAtUnmount);
  });

  it("安装失败：展示错误提示（不崩溃）", async () => {
    const { provider, installWordbook } = makeProvider({
      summaries: makeSummaries([{ id: "book-cet6", status: "not-installed" }]),
      installError: new Error("存储不可用"),
    });
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    await screen.findByText("大学英语六级");
    const card = screen.getByText("大学英语六级").closest("div");
    if (!card) {
      throw new Error("CET6 卡片未找到");
    }
    fireEvent.click(within(card).getByRole("button", { name: "安装" }));

    await waitFor(() => {
      expect(installWordbook).toHaveBeenCalledWith("book-cet6");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("安装失败：存储不可用");
  });

  it("状态读取失败：展示错误提示（不崩溃）", async () => {
    const getWordbookSummaries = vi.fn().mockRejectedValue(new Error("IndexedDB 不可用"));
    const provider: SettingsDataProvider = {
      exportBackup: vi.fn(),
      exportWordlistCsv: vi.fn(),
      importBackup: vi.fn(),
      getPresetSummaries: vi.fn(),
      getWordbookSummaries,
      installWordbook: vi.fn(),
    } as unknown as SettingsDataProvider;
    render(<WordbookLibraryScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("IndexedDB 不可用");
  });

  it("返回按钮触发 onBack", async () => {
    const { provider } = makeProvider();
    const onBack = vi.fn();
    render(<WordbookLibraryScreen provider={provider} onBack={onBack} />);

    await screen.findByText("考试词汇");
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
