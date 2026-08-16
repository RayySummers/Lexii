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
 * - 错误态展示（并发错误映射可读文案）。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    ...overrides,
  };
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
      expect(provider.installDictionaryPackage).toHaveBeenCalledWith("core-en-tier2");
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

  it("manifest 不可用时展示错误提示", async () => {
    const provider = makeProvider({
      fetchDictionaryManifest: vi.fn().mockResolvedValue(null),
    });
    render(<DictionaryPackagesScreen provider={provider} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/无法获取词包信息/)).toBeInTheDocument();
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
      expect(provider.installDictionaryPackage).toHaveBeenCalledWith("core-en-tier1");
    });
  });
});
