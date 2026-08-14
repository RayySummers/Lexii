/**
 * 设置页交互测试（mock 数据源 + mock 持久化状态 hook，不依赖 IndexedDB）。
 *
 * 覆盖验收点：持久化 denied 提示 + 直达导出、JSON/CSV 导出、JSON 导入
 * 成功/失败、统一导航头（RAY-253：左侧返回箭头、标题右对齐）。
 * 数据概览已随 RAY-253 反馈 6 删除（与统计页重复），不再有相关用例。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LexilexiExportData } from "@lexilexi/core";
import { usePersistenceStatus } from "./persistenceStatus";
import { SettingsScreen } from "./SettingsScreen";
import type { ImportBackupResult, SettingsDataProvider } from "./types";

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
  exportBackup: ReturnType<typeof vi.fn>;
  exportWordlistCsv: ReturnType<typeof vi.fn>;
  importBackup: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const exportBackup = vi.fn<() => Promise<LexilexiExportData>>().mockResolvedValue(EMPTY_EXPORT);
  const exportWordlistCsv = vi.fn<() => Promise<string>>().mockResolvedValue("term,definition,pos");
  const importBackup = vi
    .fn<(text: string) => Promise<ImportBackupResult>>()
    .mockResolvedValue({ items: 0, senses: 0, memoryStates: 0, events: 0 });
  const provider: SettingsDataProvider = {
    exportBackup,
    exportWordlistCsv,
    importBackup,
  };
  return { provider, exportBackup, exportWordlistCsv, importBackup };
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

  it("统一导航头：标题「设置」右对齐，返回箭头触发 onExit", () => {
    const onExit = vi.fn();
    render(<SettingsScreen provider={makeHarness().provider} onExit={onExit} />);

    const heading = screen.getByRole("heading", { name: "设置" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-right");

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("不渲染数据概览（RAY-253 反馈 6：与统计页重复，已删除）", async () => {
    render(<SettingsScreen provider={makeHarness().provider} onExit={() => {}} />);

    await screen.findByText("数据安全");
    expect(screen.queryByText("数据概览")).not.toBeInTheDocument();
    expect(screen.queryByText("词条")).not.toBeInTheDocument();
    expect(screen.queryByText("已复习")).not.toBeInTheDocument();
    expect(screen.queryByText("连续天数")).not.toBeInTheDocument();
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

    await screen.findByText("数据安全");
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

  it("导入 JSON 成功：显示恢复计数", async () => {
    const harness = makeHarness();
    harness.importBackup.mockResolvedValue({ items: 3, senses: 3, memoryStates: 3, events: 3 });
    render(<SettingsScreen provider={harness.provider} onExit={() => {}} />);
    await screen.findByText("导入数据");

    const file = new File(['{"format":"lexilexi"}'], "backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择备份文件…"), { target: { files: [file] } });

    expect(await screen.findByText("已恢复 3 个词条、3 个义项、3 条学习记录")).toBeInTheDocument();
    expect(harness.importBackup).toHaveBeenCalledTimes(1);
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
});
