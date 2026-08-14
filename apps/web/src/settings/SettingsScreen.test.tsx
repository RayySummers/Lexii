/**
 * 设置页交互测试（mock 数据源 + mock 持久化状态 hook，不依赖 IndexedDB）。
 *
 * 覆盖验收点：持久化 denied 提示 + 直达导出、JSON/CSV 导出、JSON 导入
 * 成功/失败、空状态（无词库 / 无复习记录）、概览错误重试。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LexilexiExportData } from "@lexilexi/core";
import { APP_VERSION } from "../lib/appVersion";
import { usePersistenceStatus } from "./persistenceStatus";
import { SettingsScreen } from "./SettingsScreen";
import type { DataOverview, ImportBackupResult, SettingsDataProvider } from "./types";

vi.mock("./persistenceStatus", () => ({
  usePersistenceStatus: vi.fn(),
}));

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

interface Harness {
  provider: SettingsDataProvider;
  loadOverview: ReturnType<typeof vi.fn>;
  exportBackup: ReturnType<typeof vi.fn>;
  exportWordlistCsv: ReturnType<typeof vi.fn>;
  importBackup: ReturnType<typeof vi.fn>;
}

function makeHarness(
  overview: DataOverview = { itemCount: 0, reviewCount: 0, streakDays: 0 },
): Harness {
  const loadOverview = vi.fn<() => Promise<DataOverview>>().mockResolvedValue(overview);
  const exportBackup = vi.fn<() => Promise<LexilexiExportData>>().mockResolvedValue(EMPTY_EXPORT);
  const exportWordlistCsv = vi.fn<() => Promise<string>>().mockResolvedValue("term,definition,pos");
  const importBackup = vi
    .fn<(text: string) => Promise<ImportBackupResult>>()
    .mockResolvedValue({ items: 0, senses: 0, memoryStates: 0, events: 0 });
  const provider: SettingsDataProvider = {
    loadOverview,
    exportBackup,
    exportWordlistCsv,
    importBackup,
  };
  return { provider, loadOverview, exportBackup, exportWordlistCsv, importBackup };
}

/** 桩掉 jsdom 未实现的 URL.createObjectURL / revokeObjectURL 与锚点点击，返回恢复函数 */
function stubObjectUrl() {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
  URL.revokeObjectURL = vi.fn();
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return () => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    clickSpy.mockRestore();
  };
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.mocked(usePersistenceStatus).mockReturnValue(null);
  });

  it("渲染数据概览统计", async () => {
    const harness = makeHarness({ itemCount: 5, reviewCount: 3, streakDays: 2 });
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("词条")).toBeInTheDocument();
    expect(screen.getByText("已复习")).toBeInTheDocument();
    expect(screen.getByText("连续天数")).toBeInTheDocument();
  });

  it("无词库：显示空状态", async () => {
    const harness = makeHarness({ itemCount: 0, reviewCount: 0, streakDays: 0 });
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText("还没有学习数据。")).toBeInTheDocument();
  });

  it("有词但无复习记录：显示统计空状态提示", async () => {
    const harness = makeHarness({ itemCount: 5, reviewCount: 0, streakDays: 0 });
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

    expect(
      await screen.findByText("还没有复习记录，完成一次复习后这里会更新。"),
    ).toBeInTheDocument();
  });

  it("持久化被拒：显示提示并直达导出", async () => {
    vi.mocked(usePersistenceStatus).mockReturnValue("denied");
    const harness = makeHarness();
    const restore = stubObjectUrl();
    try {
      render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

      expect(
        await screen.findByText("当前数据可能被浏览器清理，建议导出备份。"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "导出 JSON 备份" }));
      await waitFor(() => expect(harness.exportBackup).toHaveBeenCalledTimes(1));
    } finally {
      restore();
    }
  });

  it("持久化已获保护：显示确认文案（非警告）", async () => {
    vi.mocked(usePersistenceStatus).mockReturnValue("persisted");
    const harness = makeHarness();
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText("本地数据已受浏览器持久化保护。")).toBeInTheDocument();
    expect(screen.queryByText("当前数据可能被浏览器清理，建议导出备份。")).not.toBeInTheDocument();
  });

  it("不支持环境：静默降级不提示", async () => {
    vi.mocked(usePersistenceStatus).mockReturnValue("unsupported");
    const harness = makeHarness();
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

    await screen.findByText("数据概览");
    expect(screen.queryByText("当前数据可能被浏览器清理，建议导出备份。")).not.toBeInTheDocument();
    expect(screen.queryByText("本地数据已受浏览器持久化保护。")).not.toBeInTheDocument();
  });

  it("导出 JSON：调用数据源并提示成功", async () => {
    const harness = makeHarness();
    const restore = stubObjectUrl();
    try {
      render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
      await screen.findByText("导出数据");

      fireEvent.click(screen.getByRole("button", { name: "导出 JSON 完整备份" }));
      expect(await screen.findByText("已导出 JSON 完整备份。")).toBeInTheDocument();
      expect(harness.exportBackup).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("导出 CSV：调用数据源并提示成功", async () => {
    const harness = makeHarness();
    const restore = stubObjectUrl();
    try {
      render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
      await screen.findByText("导出数据");

      fireEvent.click(screen.getByRole("button", { name: "导出 CSV 词表" }));
      expect(await screen.findByText("已导出 CSV 词表。")).toBeInTheDocument();
      expect(harness.exportWordlistCsv).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("导入 JSON 成功：显示恢复计数并刷新概览", async () => {
    const harness = makeHarness();
    harness.importBackup.mockResolvedValue({ items: 3, senses: 3, memoryStates: 3, events: 3 });
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
    await screen.findByText("导入数据");

    const file = new File(['{"format":"lexilexi"}'], "backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择备份文件…"), { target: { files: [file] } });

    expect(await screen.findByText("已恢复 3 个词条、3 个义项、3 条学习记录")).toBeInTheDocument();
    expect(harness.importBackup).toHaveBeenCalledTimes(1);
    expect(harness.loadOverview).toHaveBeenCalledTimes(2); // 首载 + 导入后刷新
  });

  it("导入失败：显示明确错误提示", async () => {
    const harness = makeHarness();
    harness.importBackup.mockRejectedValue(new Error("导出文件版本不兼容"));
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
    await screen.findByText("导入数据");

    const file = new File(["{}"], "backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择备份文件…"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("导入失败：导出文件版本不兼容");
  });

  it("概览加载失败：显示错误并可重试", async () => {
    const harness = makeHarness();
    harness.loadOverview.mockRejectedValueOnce(new Error("IndexedDB 不可用"));
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);

    expect(await screen.findByText(/无法读取本地数据/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(harness.loadOverview).toHaveBeenCalledTimes(2));
  });

  it("关于：渲染 GitHub 仓库链接（新窗口打开）", async () => {
    const harness = makeHarness();
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
    await screen.findByText("关于");

    const link = screen.getByRole("link", { name: "GitHub 仓库" });
    expect(link).toHaveAttribute("href", "https://github.com/RayySummers/Lexilexi");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("关于：反馈问题入口指向 GitHub Issues（新窗口打开）", async () => {
    const harness = makeHarness();
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
    await screen.findByText("关于");

    const link = screen.getByRole("link", { name: "反馈问题" });
    expect(link).toHaveAttribute("href", "https://github.com/RayySummers/Lexilexi/issues");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("底部展示与构建注入一致的版本号", async () => {
    const harness = makeHarness();
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
    await screen.findByText("关于");

    // 断言 UI 走 APP_VERSION（构建注入），不硬编码具体版本——发版 bump package.json 后测试自动跟随
    expect(screen.getByText(`乐希 Lexilexi v${APP_VERSION}`)).toBeInTheDocument();
  });
});
