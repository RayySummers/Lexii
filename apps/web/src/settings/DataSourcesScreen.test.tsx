/**
 * 「数据来源与许可」页测试（RAY-258 范围 4）。
 *
 * 覆盖：安装状态徽标（已装/安装中/未装）、来源清单与链接、
 * NOTICE 全文、读取失败的错误提示、返回导航。mock 数据源，不依赖 IndexedDB。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataSourcesScreen } from "./DataSourcesScreen";
import type { PresetSummary, SettingsDataProvider } from "./types";

function makeProvider(summaries: PresetSummary[] | Error): {
  provider: SettingsDataProvider;
  getPresetSummaries: ReturnType<typeof vi.fn>;
} {
  const getPresetSummaries = vi.fn<() => Promise<PresetSummary[]>>();
  if (summaries instanceof Error) {
    getPresetSummaries.mockRejectedValue(summaries);
  } else {
    getPresetSummaries.mockResolvedValue(summaries);
  }
  const provider: SettingsDataProvider = {
    exportBackup: vi.fn(),
    exportWordlistCsv: vi.fn(),
    importBackup: vi.fn(),
    getPresetSummaries,
  } as unknown as SettingsDataProvider;
  return { provider, getPresetSummaries };
}

describe("DataSourcesScreen", () => {
  it("已安装：展示名称、词条数与版本", async () => {
    const { provider } = makeProvider([
      {
        id: "core-en-tier0",
        name: "核心词表（中考/高考/四级/六级 + 高频）",
        status: "installed",
        installedCount: 7195,
        totalCount: 7195,
        installedVersion: "1.0.0",
      },
    ]);
    render(<DataSourcesScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByText("已安装")).toBeInTheDocument();
    expect(screen.getByText("7195 词条 · v1.0.0")).toBeInTheDocument();
    expect(screen.queryByText("未安装")).not.toBeInTheDocument();
  });

  it("安装中：展示断点进度", async () => {
    const { provider } = makeProvider([
      {
        id: "core-en-tier0",
        name: "核心词表",
        status: "installing",
        installedCount: 400,
        totalCount: 7195,
      },
    ]);
    render(<DataSourcesScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByText("安装中（400/7195）")).toBeInTheDocument();
  });

  it("未安装：展示未安装徽标（老用户跳过安装的场景）", async () => {
    const { provider } = makeProvider([
      {
        id: "core-en-tier0",
        name: "核心词表",
        status: "not-installed",
        installedCount: 0,
        totalCount: 7195,
      },
    ]);
    render(<DataSourcesScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByText("未安装")).toBeInTheDocument();
    expect(screen.getByText("7195 词条")).toBeInTheDocument();
  });

  it("读取失败：展示错误提示（不崩溃）", async () => {
    const { provider } = makeProvider(new Error("IndexedDB 不可用"));
    render(<DataSourcesScreen provider={provider} onBack={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "读取安装状态失败：IndexedDB 不可用",
    );
  });

  it("来源清单包含许可徽标与出处链接；返回按钮触发 onBack", async () => {
    const { provider } = makeProvider([]);
    const onBack = vi.fn();
    render(<DataSourcesScreen provider={provider} onBack={onBack} />);

    expect(await screen.findByText("MIT")).toBeInTheDocument();
    expect(screen.getAllByText("CC BY-SA 4.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "来源主页" }).length).toBe(3);
    // 署名文本同时出现在来源卡片与 NOTICE 全文，允许多处匹配
    expect(
      screen.getAllByText(/Browne, C\., Culligan, B\. & Phillips, J\./).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
