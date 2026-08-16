/**
 * 设置页交互测试（mock 数据源 + mock 持久化状态 hook，不依赖 IndexedDB）。
 *
 * 覆盖验收点：持久化 denied 提示 + 直达导出、JSON/CSV 导出、JSON 导入
 * 成功/失败、统一导航头（RAY-253：左侧返回箭头、标题右对齐）、
 * 主题三档下拉选单（RAY-261）。
 * 数据概览已随 RAY-253 反馈 6 删除（与统计页重复），不再有相关用例。
 *
 * 主题偏好由 App 级 useTheme 持有：本页测试只验证选单渲染受控与回调
 * 参数正确；解析、应用与持久化行为在 useTheme.test.ts 覆盖。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LexilexiExportData } from "@lexilexi/core";
import { APP_VERSION } from "../lib/appVersion";
import type { ThemePreference } from "../theme/resolve";
import { usePersistenceStatus } from "./persistenceStatus";
import { SettingsScreen } from "./SettingsScreen";
import type { ImportBackupResult, PresetSummary, SettingsDataProvider } from "./types";

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

const DEFAULT_PRESET_SUMMARIES: PresetSummary[] = [
  {
    id: "core-en-tier0",
    name: "核心词表（中考/高考/四级/六级 + 高频）",
    status: "installed",
    installedCount: 7195,
    totalCount: 7195,
    installedVersion: "1.0.0",
  },
];

interface Harness {
  provider: SettingsDataProvider;
  exportBackup: ReturnType<typeof vi.fn>;
  exportWordlistCsv: ReturnType<typeof vi.fn>;
  importBackup: ReturnType<typeof vi.fn>;
  getPresetSummaries: ReturnType<typeof vi.fn>;
  getWordbookSummaries: ReturnType<typeof vi.fn>;
  installWordbook: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const exportBackup = vi.fn<() => Promise<LexilexiExportData>>().mockResolvedValue(EMPTY_EXPORT);
  const exportWordlistCsv = vi.fn<() => Promise<string>>().mockResolvedValue("term,definition,pos");
  const importBackup = vi
    .fn<(text: string) => Promise<ImportBackupResult>>()
    .mockResolvedValue({ items: 0, senses: 0, memoryStates: 0, events: 0 });
  const getPresetSummaries = vi
    .fn<() => Promise<PresetSummary[]>>()
    .mockResolvedValue(DEFAULT_PRESET_SUMMARIES);
  const getWordbookSummaries = vi.fn().mockResolvedValue([]);
  const installWordbook = vi.fn().mockResolvedValue({ installedCount: 0, skippedCount: 0 });
  const provider: SettingsDataProvider = {
    exportBackup,
    exportWordlistCsv,
    importBackup,
    getPresetSummaries,
    getWordbookSummaries,
    installWordbook,
  };
  return {
    provider,
    exportBackup,
    exportWordlistCsv,
    importBackup,
    getPresetSummaries,
    getWordbookSummaries,
    installWordbook,
  };
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

interface RenderSettingsOptions {
  provider?: SettingsDataProvider;
  onExit?: () => void;
  /** 主题偏好（RAY-261 必传 props；默认跟随系统） */
  themePreference?: ThemePreference;
  onThemePreferenceChange?: (preference: ThemePreference) => void;
}

/** 统一渲染设置页：主题 props 提供默认值，与主题无关的用例无需重复传参 */
function renderSettings(options: RenderSettingsOptions = {}) {
  return render(
    <SettingsScreen
      provider={options.provider ?? makeHarness().provider}
      onExit={options.onExit ?? (() => {})}
      themePreference={options.themePreference ?? "system"}
      onThemePreferenceChange={options.onThemePreferenceChange ?? vi.fn()}
    />,
  );
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.mocked(usePersistenceStatus).mockReturnValue(null);
    window.localStorage.clear();
  });

  it("统一导航头：标题「设置」右对齐，返回箭头触发 onExit", () => {
    const onExit = vi.fn();
    renderSettings({ onExit });

    const heading = screen.getByRole("heading", { name: "设置" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-right");

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("RAY-280 导出入口显眼：数据安全与备份分组位于页面顶部（先于外观）", async () => {
    renderSettings();

    const backupHeading = await screen.findByRole("heading", { name: "数据安全与备份" });
    const appearanceHeading = screen.getByRole("heading", { name: "外观" });
    // 备份分组渲染在外观分组之前（DOM 顺序），保证入口进设置页即可见
    expect(
      backupHeading.compareDocumentPosition(appearanceHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 主导出按钮保持主样式（primary）——显眼入口
    expect(screen.getByRole("button", { name: "导出 JSON 完整备份" })).toBeInTheDocument();
  });

  it("RAY-261 外观：下拉选单三档选项齐全且随 preference 受控", async () => {
    renderSettings({ themePreference: "light" });
    await screen.findByText("外观");

    const select = screen.getByLabelText(/主题/);
    expect(select).toHaveValue("light");
    expect(screen.getByRole("option", { name: "浅色" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "深色" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "跟随系统" })).toBeInTheDocument();
  });

  it("RAY-261 外观：选择档位经回调上报（本页不自行持久化）", async () => {
    const onThemePreferenceChange = vi.fn();
    renderSettings({ themePreference: "system", onThemePreferenceChange });
    await screen.findByText("外观");

    const select = screen.getByLabelText(/主题/);
    fireEvent.change(select, { target: { value: "dark" } });
    expect(onThemePreferenceChange).toHaveBeenCalledWith("dark");

    fireEvent.change(select, { target: { value: "light" } });
    expect(onThemePreferenceChange).toHaveBeenCalledWith("light");

    fireEvent.change(select, { target: { value: "system" } });
    expect(onThemePreferenceChange).toHaveBeenCalledWith("system");
    expect(onThemePreferenceChange).toHaveBeenCalledTimes(3);
    // 设置页只上报回调，主题持久化由 App 级 useTheme 负责
    expect(window.localStorage.getItem("lexilexi:theme")).toBeNull();
  });

  it("不渲染数据概览（RAY-253 反馈 6：与统计页重复，已删除）", async () => {
    renderSettings();

    await screen.findByText("数据安全与备份");
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
      renderSettings({ provider: harness.provider });

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
    renderSettings({ provider: harness.provider });

    expect(await screen.findByText("本地数据已受浏览器持久化保护。")).toBeInTheDocument();
    expect(screen.queryByText("当前数据可能被浏览器清理，建议导出备份。")).not.toBeInTheDocument();
  });

  it("不支持环境：静默降级不提示", async () => {
    vi.mocked(usePersistenceStatus).mockReturnValue("unsupported");
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    await screen.findByText("数据安全与备份");
    expect(screen.queryByText("当前数据可能被浏览器清理，建议导出备份。")).not.toBeInTheDocument();
    expect(screen.queryByText("本地数据已受浏览器持久化保护。")).not.toBeInTheDocument();
  });

  it("导出 JSON：调用数据源并提示成功", async () => {
    const harness = makeHarness();
    const restore = stubObjectUrl();
    try {
      renderSettings({ provider: harness.provider });
      await screen.findByText("数据安全与备份");

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
      renderSettings({ provider: harness.provider });
      await screen.findByText("数据安全与备份");

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
    renderSettings({ provider: harness.provider });
    await screen.findByText("导入数据");

    const file = new File(['{"format":"lexilexi"}'], "backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择备份文件…"), { target: { files: [file] } });

    expect(await screen.findByText("已恢复 3 个词条、3 个义项、3 条学习记录")).toBeInTheDocument();
    expect(harness.importBackup).toHaveBeenCalledTimes(1);
  });

  it("导入失败：显示明确错误提示", async () => {
    const harness = makeHarness();
    harness.importBackup.mockRejectedValue(new Error("导出文件版本不兼容"));
    renderSettings({ provider: harness.provider });
    await screen.findByText("导入数据");

    const file = new File(["{}"], "backup.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择备份文件…"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("导入失败：导出文件版本不兼容");
  });

  it("关于：渲染 GitHub 仓库链接（新窗口打开）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });
    await screen.findByText("关于");

    const link = screen.getByRole("link", { name: "GitHub 仓库" });
    expect(link).toHaveAttribute("href", "https://github.com/RayySummers/Lexilexi");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("关于：反馈问题入口指向 GitHub Issues（新窗口打开）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });
    await screen.findByText("关于");

    const link = screen.getByRole("link", { name: "反馈问题" });
    expect(link).toHaveAttribute("href", "https://github.com/RayySummers/Lexilexi/issues");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("底部展示与构建注入一致的版本号", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });
    await screen.findByText("关于");

    // 断言 UI 走 APP_VERSION（构建注入），不硬编码具体版本——发版 bump package.json 后测试自动跟随
    expect(screen.getByText(`乐希 Lexilexi v${APP_VERSION}`)).toBeInTheDocument();
  });

  it("词书库：入口进入词书库页并展示分组词书目录，返回按钮回到设置（RAY-262）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    fireEvent.click(await screen.findByRole("button", { name: "浏览并安装词书" }));

    // 二级页为 React.lazy 加载（词书数据约 2 MB 的独立 chunk）：全量并行
    // 测试下加载可能超过默认 1s 等待，显式放宽到 5s 避免 flaky。
    expect(
      await screen.findByRole("heading", { name: "词书库" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText("考试词汇", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("冲刺词书")).toBeInTheDocument();
    expect(screen.getByText("专四冲刺（近似词书）")).toBeInTheDocument();
    // getWordbookSummaries 是异步 effect：懒加载拆分后目录内容可能先于
    // effect 落定，直接断言调用次数存在时序竞态，用 waitFor 等待其稳定。
    await waitFor(() => {
      expect(harness.getWordbookSummaries).toHaveBeenCalledTimes(1);
    });

    // 返回设置
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
  });

  it("数据来源与许可：入口进入二级页并展示来源与许可声明，返回按钮回到设置", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    fireEvent.click(await screen.findByRole("button", { name: "查看数据来源与许可" }));

    // 二级页标题与安装状态
    expect(await screen.findByRole("heading", { name: "数据来源与许可" })).toBeInTheDocument();
    expect(await screen.findByText("已安装")).toBeInTheDocument();
    expect(await screen.findByText("7195 词条 · v1.0.0")).toBeInTheDocument();
    expect(harness.getPresetSummaries).toHaveBeenCalledTimes(1);

    // 数据来源与许可链接（新窗口打开）
    expect(screen.getByText("ECDICT")).toBeInTheDocument();
    expect(screen.getByText("NGSL 1.2（New General Service List）")).toBeInTheDocument();
    const licenseLinks = screen.getAllByRole("link", { name: "许可文本" });
    expect(licenseLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of licenseLinks) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }

    // NOTICE 文本可见
    expect(screen.getByText(/Copyright \(c\) 2025 Linwei/)).toBeInTheDocument();

    // 返回设置页
    fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
  });

  it("每日新卡上限：默认 20，输入合法值即时持久化（RAY-260 评审 suggestion 2）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    const input = await screen.findByLabelText(/每日新卡上限/);
    expect(input).toHaveValue(20);

    fireEvent.change(input, { target: { value: "35" } });
    expect(input).toHaveValue(35);
    expect(window.localStorage.getItem("lexilexi:daily-new-card-limit")).toBe("35");
  });

  it("每日新卡上限：非法输入不持久化（存储保持原值）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    const input = await screen.findByLabelText(/每日新卡上限/);
    // number 输入框对非数字文本会被浏览器清空（value 为空串）
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input).toHaveValue(null);
    expect(window.localStorage.getItem("lexilexi:daily-new-card-limit")).toBeNull();
  });

  it("每日新卡上限：失焦时显示回落到生效值（Oscar 复评 nit 1）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    const input = await screen.findByLabelText(/每日新卡上限/);
    // 先设置合法值 35（持久化），再清空输入（非法、不持久化）
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);

    // 失焦：显示回落到存储中实际生效的值 35
    fireEvent.blur(input);
    expect(input).toHaveValue(35);
    expect(window.localStorage.getItem("lexilexi:daily-new-card-limit")).toBe("35");
  });

  it("每日新卡上限：合法值失焦归一化显示（不改变生效值）", async () => {
    const harness = makeHarness();
    renderSettings({ provider: harness.provider });

    const input = await screen.findByLabelText(/每日新卡上限/);
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(7);
    expect(window.localStorage.getItem("lexilexi:daily-new-card-limit")).toBe("7");
  });

  it("进行中的导出在进入二级页后不丢状态：返回后仍显示导出中并最终提示成功（RAY-260 评审 nit 2）", async () => {
    const harness = makeHarness();
    const restore = stubObjectUrl();
    let resolveExport: ((value: LexilexiExportData) => void) | undefined;
    harness.exportBackup.mockImplementation(
      () =>
        new Promise<LexilexiExportData>((resolve) => {
          resolveExport = resolve;
        }),
    );
    try {
      renderSettings({ provider: harness.provider });
      await screen.findByText("数据安全与备份");

      // 发起导出（挂起中），随即切到「数据来源与许可」再返回
      fireEvent.click(screen.getByRole("button", { name: "导出 JSON 完整备份" }));
      expect(await screen.findByRole("button", { name: "导出中…" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "查看数据来源与许可" }));
      expect(await screen.findByRole("heading", { name: "数据来源与许可" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
      expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();

      // 导出状态未随 SettingsMainView 卸载丢失：仍显示「导出中…」
      expect(await screen.findByRole("button", { name: "导出中…" })).toBeDisabled();

      // 完成导出后，成功提示落在返回后的主视图上
      resolveExport?.(EMPTY_EXPORT);
      expect(await screen.findByText("已导出 JSON 完整备份。")).toBeInTheDocument();
      expect(harness.exportBackup).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});

describe("RAY-265 学习设置：评分档位与发音口音", () => {
  it("评分档位默认三档；切换四档即时持久化到 localStorage", async () => {
    renderSettings();
    await screen.findByText("学习");

    const select = screen.getByLabelText(/评分档位/);
    expect(select).toHaveValue("three");
    expect(window.localStorage.getItem("lexilexi:rating-tiers")).toBeNull(); // 未显式设置

    fireEvent.change(select, { target: { value: "four" } });
    expect(select).toHaveValue("four");
    expect(window.localStorage.getItem("lexilexi:rating-tiers")).toBe("four");
  });

  it("评分档位读取已存储的四档", async () => {
    window.localStorage.setItem("lexilexi:rating-tiers", "four");
    renderSettings();
    await screen.findByText("学习");
    expect(screen.getByLabelText(/评分档位/)).toHaveValue("four");
  });

  it("发音口音默认美式；切换英式即时持久化到 localStorage", async () => {
    renderSettings();
    await screen.findByText("学习");

    const select = screen.getByLabelText(/发音口音/);
    expect(select).toHaveValue("us");

    fireEvent.change(select, { target: { value: "uk" } });
    expect(select).toHaveValue("uk");
    expect(window.localStorage.getItem("lexilexi:pronunciation-accent")).toBe("uk");
  });

  it("发音口音读取已存储的英式", async () => {
    window.localStorage.setItem("lexilexi:pronunciation-accent", "uk");
    renderSettings();
    await screen.findByText("学习");
    expect(screen.getByLabelText(/发音口音/)).toHaveValue("uk");
  });
});
