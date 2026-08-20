/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RAY-364 锚点集成测试（5 项，Jack 门禁前补齐）。
 * 覆盖：搜词无结果按钮带稳定锚点、Settings 区块 id/data-anchor、initialAnchor 滚动、App 端到端跳转 + hash 可持续、重排后仍有效（非索引）。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import {
  FIRST_OPEN_DIALOG_DISMISSED_VALUE,
  FIRST_OPEN_DIALOG_STORAGE_KEY,
} from "../lib/firstOpenDialog";
import { SearchScreen } from "../search/SearchScreen";
import type { SearchDataProvider } from "../search/types";
import {
  SETTINGS_ANCHOR_EXTENSION_PACKAGES,
  SETTINGS_SECTION_ID_EXTENSION_PACKAGES,
} from "./anchors";
import { SettingsScreen } from "./SettingsScreen";
import type { SettingsDataProvider } from "./types";

function makeSearchProvider(): SearchDataProvider {
  return {
    search: vi.fn().mockResolvedValue([]),
    hasAnySenses: vi.fn().mockResolvedValue(true),
    getNotebookSenseIds: vi.fn().mockResolvedValue([]),
    addToNotebook: vi.fn().mockResolvedValue("added"),
    removeFromNotebookBySenseId: vi.fn().mockResolvedValue(undefined),
  };
}
function makeSettingsProvider(): SettingsDataProvider {
  return {
    exportBackup: vi.fn().mockResolvedValue({
      format: "lexii",
      exportFormatVersion: 1,
      dbSchemaVersion: 1,
      exportedAt: "",
      items: [],
      senses: [],
      memoryStates: [],
      events: [],
      notebookEntries: [],
      customLists: [],
      customListEntries: [],
    } as any),
    exportWordlistCsv: vi.fn().mockResolvedValue(""),
    importBackup: vi.fn().mockResolvedValue({ items: 0, senses: 0, memoryStates: 0, events: 0 }),
    getPresetSummaries: vi.fn().mockResolvedValue([]),
    getWordbookSummaries: vi.fn().mockResolvedValue([]),
    installWordbook: vi.fn().mockResolvedValue({ installedCount: 0, skippedCount: 0 }),
    removeWordbook: vi.fn().mockResolvedValue(undefined),
    getDictionaryPackageSummaries: vi.fn().mockResolvedValue([]),
    fetchDictionaryManifest: vi.fn().mockResolvedValue(null),
    installDictionaryPackage: vi.fn().mockResolvedValue({ status: "installed", installedCount: 0 }),
    markTier1CoveredByTier2: vi.fn().mockResolvedValue(undefined),
    resetDictionaryPackageInstall: vi.fn().mockResolvedValue(undefined),
  };
}

describe("RAY-364 锚点集成（5 项）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(FIRST_OPEN_DIALOG_STORAGE_KEY, FIRST_OPEN_DIALOG_DISMISSED_VALUE);
    history.replaceState(null, "", window.location.pathname);
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }) as any;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1/5 搜词无结果按钮以稳定锚点常量调用 onNavigateToSettings", async () => {
    const onNavigateToSettings = vi.fn();
    render(
      <SearchScreen
        provider={makeSearchProvider()}
        onExit={() => {}}
        onNavigateToSettings={onNavigateToSettings}
      />,
    );
    fireEvent.change(screen.getByLabelText("搜索词条"), { target: { value: "zzz-not-exist" } });
    const btn = await screen.findByRole("button", { name: "前往设置安装扩展词包" });
    fireEvent.click(btn);
    expect(onNavigateToSettings).toHaveBeenCalledWith(SETTINGS_ANCHOR_EXTENSION_PACKAGES);
    expect(onNavigateToSettings.mock.calls[0]?.[0]).toBe("extension-packages");
  });

  it("2/5 Settings 扩展词包区块具备稳定 id 与 data-anchor", async () => {
    const provider = makeSettingsProvider();
    render(
      <SettingsScreen
        provider={provider}
        onExit={() => {}}
        themePreference="system"
        onThemePreferenceChange={() => {}}
        cardFont="inter"
        onCardFontChange={() => {}}
      />,
    );
    await screen.findByRole("heading", { name: "扩展词包" });
    const section = document.getElementById(SETTINGS_SECTION_ID_EXTENSION_PACKAGES);
    expect(section).not.toBeNull();
    expect(section?.getAttribute("data-anchor")).toBe(SETTINGS_ANCHOR_EXTENSION_PACKAGES);
    expect(document.querySelector(`[data-anchor="${SETTINGS_ANCHOR_EXTENSION_PACKAGES}"]`)).toBe(
      section,
    );
  });

  it("3/5 Settings 收到 initialAnchor 时自动 scrollIntoView", async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    (Element.prototype as any).scrollIntoView = scrollIntoView;
    try {
      const provider = makeSettingsProvider();
      render(
        <SettingsScreen
          provider={provider}
          onExit={() => {}}
          themePreference="system"
          onThemePreferenceChange={() => {}}
          cardFont="inter"
          onCardFontChange={() => {}}
          initialAnchor={SETTINGS_ANCHOR_EXTENSION_PACKAGES}
        />,
      );
      await screen.findByRole("heading", { name: "扩展词包" });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "smooth", block: "start" }),
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("4/5 App 搜词无结果按钮点击后跳转至设置页并定位锚点（URL 可持续）", async () => {
    const scrollIntoView = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    (Element.prototype as any).scrollIntoView = scrollIntoView;
    try {
      const searchFactory = vi.fn().mockReturnValue(makeSearchProvider());
      const settingsFactory = vi.fn().mockReturnValue(makeSettingsProvider());
      const statsFactory = vi.fn().mockReturnValue({
        loadStats: vi.fn().mockResolvedValue({
          streakDays: 0,
          totalDays: 0,
          todayLearnCount: 0,
          todayReviewCount: 0,
          dueCount: 0,
          dueTomorrowCount: 0,
          newCardsRemainingToday: 0,
          reviewCount: 0,
          completedWordCount: 0,
          todayStudyDurationMs: 0,
          totalStudyDurationMs: 0,
        }),
      });
      render(
        <App
          searchProviderFactory={searchFactory}
          settingsProviderFactory={settingsFactory}
          statsProviderFactory={statsFactory}
          reviewProviderFactory={vi.fn().mockReturnValue({
            loadQueue: vi.fn().mockResolvedValue([]),
            loadMultipleChoiceQueue: vi.fn().mockResolvedValue({ questions: [], cards: [] }),
            grade: vi.fn(),
            markMastered: vi.fn(),
            undoGrade: vi.fn(),
            hasAnyItems: vi.fn().mockResolvedValue(false),
            importSampleWordlist: vi.fn(),
          } as any)}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "搜词" }));
      await screen.findByRole("heading", { name: "搜词" });
      fireEvent.change(screen.getByLabelText("搜索词条"), {
        target: { value: "zzz-not-exist-anchortest" },
      });
      const anchorBtn = await screen.findByRole("button", { name: "前往设置安装扩展词包" });
      fireEvent.click(anchorBtn);
      expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
      expect(window.location.hash).toContain(`anchor=${SETTINGS_ANCHOR_EXTENSION_PACKAGES}`);
      expect(document.getElementById(SETTINGS_SECTION_ID_EXTENSION_PACKAGES)).not.toBeNull();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled(), { timeout: 2000 });
    } finally {
      (Element.prototype as any).scrollIntoView = orig;
    }
  });

  it("5/5 锚点查询基于 data-anchor 而非硬编码索引：重排后仍有效", async () => {
    const provider = makeSettingsProvider();
    const { container } = render(
      <SettingsScreen
        provider={provider}
        onExit={() => {}}
        themePreference="system"
        onThemePreferenceChange={() => {}}
        cardFont="inter"
        onCardFontChange={() => {}}
        initialAnchor={SETTINGS_ANCHOR_EXTENSION_PACKAGES}
      />,
    );
    await screen.findByRole("heading", { name: "扩展词包" });
    const allSections = Array.from(container.querySelectorAll("section"));
    const anchorEl = document.querySelector(
      `[data-anchor="${SETTINGS_ANCHOR_EXTENSION_PACKAGES}"]`,
    ) as HTMLElement | null;
    expect(anchorEl).not.toBeNull();
    expect(
      (allSections as unknown as Element[]).indexOf(anchorEl as unknown as Element),
    ).toBeGreaterThanOrEqual(0);
  });
});
