/**
 * 扩展词包设置页测试（RAY-294）。
 *
 * 覆盖：
 * - 词包列表渲染（名称、状态徽标、词条数）；
 * - 未安装包展示「下载」按钮；
 * - 已安装包不展示下载按钮；
 * - covered 状态展示「已包含在全量词表中」；
 * - 点击下载弹出确认对话框（ECDICT MIT 许可展示）；
 * - 确认后调用 installDictionaryPackage；
 * - Tier 2 安装完成后调用 markTier1CoveredByTier2；
 * - 错误态展示（并发错误映射可读文案）；
 * - 安装中展示取消按钮（§6.4 AbortController）；
 * - manifest 不可用时降级展示（体积缺失 fallback）；
 * - 升级进度（RAY-498）：阶段文案 + 百分比、升级中可取消、长时间无进展的安抚文案。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DictionaryInstallProgress } from "@lexii/core";
import { DictionaryPackagesScreen } from "./DictionaryPackagesScreen";
import type {
  DictionaryInstallResult,
  DictionaryManifestInfo,
  DictionaryPackageSummary,
  SettingsDataProvider,
} from "./types";

function makeProvider(overrides: Partial<SettingsDataProvider> = {}): SettingsDataProvider {
  return {
    exportBackup: vi.fn(),
    exportWordlistCsv: vi.fn(),
    importBackup: vi.fn(),
    getPresetSummaries: vi.fn().mockResolvedValue([]),
    getWordbookSummaries: vi.fn().mockResolvedValue([]),
    installWordbook: vi.fn(),
    removeWordbook: vi.fn(),
    getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
      {
        id: "core-en-tier1",
        name: "Tier 1 标准词包",
        status: "not-installed",
        installedCount: 0,
        totalCount: 58_244,
      },
      {
        id: "core-en-tier2",
        name: "Tier 2 全量词包",
        status: "not-installed",
        installedCount: 0,
        totalCount: 401_222,
      },
    ] satisfies DictionaryPackageSummary[]),
    fetchDictionaryManifest: vi.fn().mockResolvedValue([
      {
        id: "core-en-tier1",
        version: "1.0.0",
        sourceCommit: "abc123",
        bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
      },
      {
        id: "core-en-tier2",
        version: "1.0.0",
        sourceCommit: "abc123",
        bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
      },
    ] satisfies DictionaryManifestInfo[]),
    installDictionaryPackage: vi.fn().mockResolvedValue({
      status: "installed",
      installedCount: 58_244,
      skippedCount: 0,
    } satisfies DictionaryInstallResult),
    markTier1CoveredByTier2: vi.fn().mockResolvedValue(undefined),
    resetDictionaryPackageInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** 升级场景（RAY-498 用例共用）：Tier 1 已装 1.0.0、manifest 提供 2.0.0，Tier 2 未安装 */
function makeUpgradeProvider(overrides: Partial<SettingsDataProvider> = {}): SettingsDataProvider {
  return makeProvider({
    getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
      {
        id: "core-en-tier1",
        name: "Tier 1 标准词包",
        status: "installed",
        installedCount: 58_244,
        totalCount: 58_244,
        installedVersion: "1.0.0",
      },
      {
        id: "core-en-tier2",
        name: "Tier 2 全量词包",
        status: "not-installed",
        installedCount: 0,
        totalCount: 401_222,
      },
    ] satisfies DictionaryPackageSummary[]),
    fetchDictionaryManifest: vi.fn().mockResolvedValue([
      {
        id: "core-en-tier1",
        version: "2.0.0",
        sourceCommit: "abc123",
        bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
      },
      {
        id: "core-en-tier2",
        version: "1.0.0",
        sourceCommit: "abc123",
        bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
      },
    ] satisfies DictionaryManifestInfo[]),
    ...overrides,
  });
}

/** 点「升级到 v2.0.0」→ 确认对话框 → 确认（RAY-498 用例共用） */
async function startUpgradeFromUi() {
  await waitFor(() => {
    expect(screen.getByText("升级到 v2.0.0")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("升级到 v2.0.0"));
  await waitFor(() => {
    expect(screen.getByText("确认下载")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("确认下载"));
}

/**
 * 推 fake 时钟并等微任务（含 Promise resolve）落地。
 * 与 useStats.test.ts 同款：二次包 act 是为了把 setInterval 回调里的 setState
 * 纳入 React 的 act 边界，规避 "not wrapped in act(...)" 警告。
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("DictionaryPackagesScreen", () => {
  it("渲染两个词包卡片（Tier 1 / Tier 2）", async () => {
    const provider = makeProvider();
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Tier 1 标准词包")).toBeInTheDocument();
      expect(screen.getByText("Tier 2 全量词包")).toBeInTheDocument();
    });

    // 词条数展示（使用 getByText 内容包含匹配）
    expect(screen.getByText((content) => content.includes("58,244"))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("401,222"))).toBeInTheDocument();
  });

  it("未安装包展示「下载」按钮和「未安装」徽标", async () => {
    const provider = makeProvider();
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("未安装")).toHaveLength(2);
    });
    expect(screen.getAllByText("下载")).toHaveLength(2);
  });

  it("已安装包不展示下载按钮，展示版本号", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.0.0",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("已安装 v1.0.0")).toBeInTheDocument();
    });
    // 只有 Tier 2 有下载按钮
    expect(screen.getAllByText("下载")).toHaveLength(1);
  });

  it("covered 状态展示「已包含在全量词表中」", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "covered",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "covered-by-tier2",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "installed",
          installedCount: 401_222,
          totalCount: 401_222,
          installedVersion: "1.0.0",
        },
      ] satisfies DictionaryPackageSummary[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("已包含在全量词表中")).toBeInTheDocument();
    });
  });

  it("点击下载弹出确认对话框，展示许可声明", async () => {
    const provider = makeProvider();
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击 Tier 1 的下载按钮
    const downloadButtons = screen.getAllByText("下载");
    fireEvent.click(downloadButtons[0]!);

    // 确认对话框出现
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    // 许可声明（在确认对话框中）
    expect(screen.getByText("确认下载")).toBeInTheDocument();
    // 确认对话框中包含许可信息
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("ECDICT");
    expect(dialog.textContent).toContain("MIT 许可");
    // 体积展示
    expect(dialog.textContent).toContain("1.2 MB");
  });

  it("确认下载后调用 installDictionaryPackage 和 markTier1CoveredByTier2（Tier 2）", async () => {
    const provider = makeProvider();
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击 Tier 2 的下载按钮（第二个）
    const downloadButtons = screen.getAllByText("下载");
    fireEvent.click(downloadButtons[1]!);

    // 确认对话框出现 → 点击确认
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("确认下载"));

    // 等待安装完成
    await waitFor(() => {
      expect(provider.installDictionaryPackage).toHaveBeenCalledWith(
        "core-en-tier2",
        expect.any(AbortSignal),
        // RAY-498：第三个参数是升级落库阶段进度回调
        expect.any(Function),
      );
    });

    // Tier 2 安装完成后应调用 markTier1CoveredByTier2
    await waitFor(() => {
      expect(provider.markTier1CoveredByTier2).toHaveBeenCalled();
    });
  });

  it("并发错误展示可读文案（非内部哨兵）", async () => {
    const concurrentError = new Error("另一标签页正在升级：core-en-tier1");
    concurrentError.name = "ConcurrentDictionaryInstallError";
    const provider = makeProvider({
      installDictionaryPackage: vi.fn().mockRejectedValue(concurrentError),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击下载 → 确认
    fireEvent.click(screen.getAllByText("下载")[0]!);
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("确认下载"));

    // 错误展示可读文案
    await waitFor(() => {
      expect(screen.getByText(/另一标签页正在升级/)).toBeInTheDocument();
    });
  });

  it("manifest 不可用时展示错误提示（网络不可达）", async () => {
    const provider = makeProvider({
      fetchDictionaryManifest: vi
        .fn()
        .mockRejectedValue(new Error("无法获取词包信息：网络不可达，请检查网络连接")),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/无法获取词包信息/)).toBeInTheDocument();
    });
  });

  it("manifest 404 时展示 HTTP 错误提示", async () => {
    const provider = makeProvider({
      fetchDictionaryManifest: vi.fn().mockRejectedValue(new Error("manifest 获取失败：HTTP 404")),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    });
  });

  it("已安装包版本低于 manifest 时展示「可升级」徽标和升级按钮", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.0.0",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
      fetchDictionaryManifest: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          version: "2.0.0",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
        },
        {
          id: "core-en-tier2",
          version: "1.0.0",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
        },
      ] satisfies DictionaryManifestInfo[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("可升级 v2.0.0")).toBeInTheDocument();
    });
    expect(screen.getByText("升级到 v2.0.0")).toBeInTheDocument();
    // Tier 2 仍然显示「下载」按钮（未安装）
    expect(screen.getByText("下载")).toBeInTheDocument();
  });

  it("已安装包版本与 manifest 一致时不展示升级按钮", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.0.0",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("已安装 v1.0.0")).toBeInTheDocument();
    });
    expect(screen.queryByText(/可升级/)).not.toBeInTheDocument();
    expect(screen.queryByText(/升级到/)).not.toBeInTheDocument();
  });

  it("已装 1.0.0、manifest 为 1.0.0-alpha 时不展示升级提示（RAY-494 验收：不误判）", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.0.0",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
      fetchDictionaryManifest: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          version: "1.0.0-alpha",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
        },
        {
          id: "core-en-tier2",
          version: "1.1.0-alpha",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
        },
      ] satisfies DictionaryManifestInfo[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    // 1.0.0 > 1.0.0-alpha：正式版比预发布版新，不该提示升级
    await waitFor(() => {
      expect(screen.getByText("已安装 v1.0.0")).toBeInTheDocument();
    });
    expect(screen.queryByText(/可升级/)).not.toBeInTheDocument();
  });

  it("已装 1.1.0-alpha、manifest 为 1.1.1-alpha 时展示「可升级」（RAY-494 回归）", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.1.0-alpha",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
      // 旧 compareSemver 对「带 -alpha 的 patch 段」两处比较都不成立 → 返回 0 →
      // 升级提示静默失效；本用例是修复前会失败的回归点
      fetchDictionaryManifest: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          version: "1.1.1-alpha",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
        },
        {
          id: "core-en-tier2",
          version: "1.1.1-alpha",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
        },
      ] satisfies DictionaryManifestInfo[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("可升级 v1.1.1-alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("升级到 v1.1.1-alpha")).toBeInTheDocument();
  });

  it("已装 1.1.0、manifest 为 1.1.0-alpha 时不误判为可升级（预发布版小于正式版）", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.1.0",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
      fetchDictionaryManifest: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          version: "1.1.0-alpha",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
        },
        {
          id: "core-en-tier2",
          version: "1.1.0-alpha",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
        },
      ] satisfies DictionaryManifestInfo[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("已安装 v1.1.0")).toBeInTheDocument();
    });
    expect(screen.queryByText(/可升级/)).not.toBeInTheDocument();
    expect(screen.queryByText(/升级到/)).not.toBeInTheDocument();
  });

  it("点击升级按钮触发安装流程（复用 installDictionaryPackage）", async () => {
    const provider = makeProvider({
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "installed",
          installedCount: 58_244,
          totalCount: 58_244,
          installedVersion: "1.0.0",
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
      fetchDictionaryManifest: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          version: "2.0.0",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t1.json.br", size: 1_258_304, sha256: "aaa" },
        },
        {
          id: "core-en-tier2",
          version: "1.0.0",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
        },
      ] satisfies DictionaryManifestInfo[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("升级到 v2.0.0")).toBeInTheDocument();
    });

    // 点击升级按钮 → 弹出确认对话框
    fireEvent.click(screen.getByText("升级到 v2.0.0"));
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });

    // 确认后调用 installDictionaryPackage
    fireEvent.click(screen.getByText("确认下载"));
    await waitFor(() => {
      expect(provider.installDictionaryPackage).toHaveBeenCalledWith(
        "core-en-tier1",
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });
  });

  it("升级进行中展示阶段文案与百分比（RAY-498）", async () => {
    // 捕获 core → UI 的进度回调（安装挂起，模拟长时间升级）
    let emitProgress: ((progress: DictionaryInstallProgress) => void) | undefined;
    const installSpy = vi
      .fn()
      .mockImplementation(
        (
          _id: string,
          _signal?: AbortSignal,
          onProgress?: (progress: DictionaryInstallProgress) => void,
        ) => {
          emitProgress = onProgress;
          return new Promise<DictionaryInstallResult>(() => {
            // 不 resolve，保持升级中
          });
        },
      );
    const provider = makeUpgradeProvider({ installDictionaryPackage: installSpy });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await startUpgradeFromUi();
    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledOnce();
    });
    expect(emitProgress).toBeDefined();

    // 回调到达前（下载阶段）：只有「下载中…」+ 不确定进度条（无 aria-valuenow）
    expect(screen.getByText("下载中…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");

    // 阶段 1：读取旧词包（一次性全量扫描，不确定进度）
    act(() => {
      emitProgress!({ phase: "reading", processedChunks: 0, totalChunks: 0, percent: 0 });
    });
    expect(screen.getByText("读取旧词包…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");

    // 阶段 2：更新词条 N%（按块数确定百分比）
    act(() => {
      emitProgress!({ phase: "updating", processedChunks: 2, totalChunks: 5, percent: 40 });
    });
    expect(screen.getByText("更新词条 40%")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemax", "100");

    // 阶段 3：完成校验
    act(() => {
      emitProgress!({ phase: "finalizing", processedChunks: 5, totalChunks: 5, percent: 100 });
    });
    expect(screen.getByText("完成校验…")).toBeInTheDocument();
  });

  it("升级进行中提供取消按钮，点击后 signal aborted（RAY-498）", async () => {
    let capturedSignal: AbortSignal | undefined;
    const installSpy = vi.fn().mockImplementation((_id: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<DictionaryInstallResult>(() => {
        // 不 resolve，保持升级中
      });
    });
    const provider = makeUpgradeProvider({ installDictionaryPackage: installSpy });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await startUpgradeFromUi();
    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledOnce();
    });
    expect(capturedSignal?.aborted).toBe(false);

    // 升级进行中：按钮禁用 + 可取消（此前升级分支没有取消入口）
    await waitFor(() => {
      expect(screen.getByText("升级中…")).toBeDisabled();
      expect(screen.getByText("取消")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("取消"));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("升级长时间无进展 → 展示「仍在处理，请勿关闭页面」（RAY-498）", async () => {
    vi.useFakeTimers();
    try {
      const installSpy = vi.fn().mockImplementation(() => {
        return new Promise<DictionaryInstallResult>(() => {
          // 不 resolve，也不上报进度：模拟落库阶段静默很久
        });
      });
      const provider = makeUpgradeProvider({ installDictionaryPackage: installSpy });
      render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

      await tick(0);
      fireEvent.click(screen.getByText("升级到 v2.0.0"));
      fireEvent.click(screen.getByText("确认下载"));
      await tick(0);
      expect(installSpy).toHaveBeenCalledOnce();

      // 刚点下升级：还没有安抚文案
      expect(screen.queryByText("仍在处理，请勿关闭页面")).not.toBeInTheDocument();

      // 10 秒无任何进展 → 出现安抚文案
      await tick(10_000);
      expect(screen.getByText("仍在处理，请勿关闭页面")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("首装轮询有进展时不误报卡住，停滞后才提示（RAY-498）", async () => {
    vi.useFakeTimers();
    try {
      let installedCount = 0;
      const provider = makeProvider({
        // 与真实 IDB 口径一致：进度游标 > 0 才算 installing（首装从 not-installed 起步）
        getDictionaryPackageSummaries: vi.fn().mockImplementation(async () => [
          {
            id: "core-en-tier1",
            name: "Tier 1 标准词包",
            status: installedCount > 0 ? "installing" : "not-installed",
            installedCount,
            totalCount: 58_244,
          },
          {
            id: "core-en-tier2",
            name: "Tier 2 全量词包",
            status: "not-installed",
            installedCount: 0,
            totalCount: 401_222,
          },
        ]),
        installDictionaryPackage: vi.fn().mockImplementation(() => {
          return new Promise<DictionaryInstallResult>(() => {
            // 不 resolve：模拟长时间落库
          });
        }),
      });
      render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

      // 首装：进度游标由 IDB 轮询驱动
      await tick(0);
      fireEvent.click(screen.getAllByText("下载")[0]!);
      fireEvent.click(screen.getByText("确认下载"));
      await tick(0);

      // 每 2 秒推进一块（400 词）→ 始终有进展，不应提示卡住
      for (let i = 0; i < 6; i += 1) {
        installedCount += 400;
        await tick(2_000);
      }
      expect(screen.queryByText("仍在处理，请勿关闭页面")).not.toBeInTheDocument();

      // 游标停住 10 秒 → 提示
      await tick(10_000);
      expect(screen.getByText("仍在处理，请勿关闭页面")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("安装进行中传递 AbortSignal，取消后 signal aborted", async () => {
    // 让 installDictionaryPackage 挂起（模拟下载中）
    let capturedSignal: AbortSignal | undefined;
    const installSpy = vi.fn().mockImplementation((_id: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<DictionaryInstallResult>(() => {
        // 不 resolve，模拟长下载
      });
    });
    const provider = makeProvider({
      installDictionaryPackage: installSpy,
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    // 等待初始渲染完成
    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击下载 → 确认
    fireEvent.click(screen.getAllByText("下载")[0]!);
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("确认下载"));

    // 等待 install 被调用（带 AbortSignal）
    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledOnce();
    });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // 点击取消按钮
    await waitFor(() => {
      expect(screen.getByText("取消")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("取消"));

    // signal 应该被 abort
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("下载阶段也展示取消按钮（pendingInstalls 但 status 仍 not-installed）", async () => {
    // 让 installDictionaryPackage 挂起（模拟下载阶段，status 仍 not-installed）
    const installSpy = vi.fn().mockImplementation(() => {
      return new Promise<DictionaryInstallResult>(() => {
        // 不 resolve
      });
    });
    const provider = makeProvider({
      installDictionaryPackage: installSpy,
      // getDictionaryPackageSummaries 返回 not-installed（模拟下载中状态未变）
      getDictionaryPackageSummaries: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          name: "Tier 1 标准词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 58_244,
        },
        {
          id: "core-en-tier2",
          name: "Tier 2 全量词包",
          status: "not-installed",
          installedCount: 0,
          totalCount: 401_222,
        },
      ] satisfies DictionaryPackageSummary[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击 Tier 1 下载 → 确认
    fireEvent.click(screen.getAllByText("下载")[0]!);
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("确认下载"));

    // 等待 install 被调用
    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledOnce();
    });

    // 下载阶段应展示「下载中…」和「取消」按钮
    await waitFor(() => {
      expect(screen.getByText("下载中…")).toBeInTheDocument();
    });
    expect(screen.getByText("取消")).toBeInTheDocument();
  });

  it("AbortError 展示「下载已取消」提示（非错误态）", async () => {
    const installSpy = vi.fn().mockImplementation((_id: string, signal?: AbortSignal) => {
      return new Promise<DictionaryInstallResult>((_resolve, reject) => {
        // 监听 abort → reject
        signal?.addEventListener("abort", () => {
          reject(new DOMException("安装已取消", "AbortError"));
        });
      });
    });
    const provider = makeProvider({
      installDictionaryPackage: installSpy,
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击下载 → 确认
    fireEvent.click(screen.getAllByText("下载")[0]!);
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("确认下载"));

    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledOnce();
    });

    // 点击取消
    await waitFor(() => {
      expect(screen.getByText("取消")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("取消"));

    // 应展示「下载已取消」提示（非错误态）
    await waitFor(() => {
      expect(screen.getByText("下载已取消。")).toBeInTheDocument();
    });
    // 不应展示错误
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("取消安装后调用 resetDictionaryPackageInstall 清除进度并恢复 UI", async () => {
    const installSpy = vi.fn().mockImplementation((_id: string, signal?: AbortSignal) => {
      return new Promise<DictionaryInstallResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("安装已取消", "AbortError"));
        });
      });
    });
    const resetSpy = vi.fn().mockResolvedValue(undefined);
    const provider = makeProvider({
      installDictionaryPackage: installSpy,
      resetDictionaryPackageInstall: resetSpy,
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });

    // 点击下载 → 确认
    fireEvent.click(screen.getAllByText("下载")[0]!);
    await waitFor(() => {
      expect(screen.getByText("确认下载")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("确认下载"));

    await waitFor(() => {
      expect(installSpy).toHaveBeenCalledOnce();
    });

    // 点击取消
    await waitFor(() => {
      expect(screen.getByText("取消")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("取消"));

    // 应调用 resetDictionaryPackageInstall 清除 IDB 进度
    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith("core-en-tier1");
    });

    // UI 应恢复到「下载」按钮
    await waitFor(() => {
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });
  });

  it("manifest 不可用时展示错误提示（降级）", async () => {
    const provider = makeProvider({
      fetchDictionaryManifest: vi
        .fn()
        .mockRejectedValue(new Error("无法获取词包信息：网络不可达，请检查网络连接")),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/无法获取词包信息/)).toBeInTheDocument();
    });
  });

  it("manifest 中包无 bestVariant 时不展示该包的下载按钮", async () => {
    const provider = makeProvider({
      fetchDictionaryManifest: vi.fn().mockResolvedValue([
        {
          id: "core-en-tier1",
          version: "1.0.0",
          sourceCommit: "abc123",
          // 无 bestVariant
        },
        {
          id: "core-en-tier2",
          version: "1.0.0",
          sourceCommit: "abc123",
          bestVariant: { url: "http://example.com/t2.json.br", size: 6_710_886, sha256: "bbb" },
        },
      ] satisfies DictionaryManifestInfo[]),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      // Tier 1 无 bestVariant，确认对话框不应展示体积
      expect(screen.getAllByText("下载")).toHaveLength(2);
    });
  });
});
