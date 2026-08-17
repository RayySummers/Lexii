import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toEventId } from "@lexilexi/core";
import type { LexilexiExportData, StudyMode } from "@lexilexi/core";
import { App } from "./App";
import { makeCard } from "./review/testFixtures";
import type { ReviewCard, ReviewDataProvider } from "./review/types";
import type { SearchDataProvider } from "./search/types";
import type { NotebookDataProvider } from "./notebook/types";
import type { SettingsDataProvider } from "./settings/types";
import type { StatsDataProvider } from "./stats/types";
import {
  FIRST_OPEN_DIALOG_DISMISSED_VALUE,
  FIRST_OPEN_DIALOG_STORAGE_KEY,
} from "./lib/firstOpenDialog";

const EMPTY_EXPORT: LexilexiExportData = {
  format: "lexilexi",
  exportFormatVersion: 1,
  dbSchemaVersion: 1,
  exportedAt: "2026-08-14T00:00:00.000Z",
  items: [],
  senses: [],
  memoryStates: [],
  events: [],
  notebookEntries: [],
};

/** 测试接缝：注入 mock 复习数据源工厂，避免渲染时触碰浏览器 IndexedDB */
function makeReviewProviderFactory(queue: ReviewCard[] = [makeCard()]) {
  const gradeResultFor = (card: ReviewCard) => ({
    reviewEventId: toEventId("evt_test_grade"),
    previousMemoryState: card.memory,
  });
  const provider: ReviewDataProvider = {
    loadQueue: vi.fn<(mode: StudyMode) => Promise<ReviewCard[]>>().mockResolvedValue(queue),
    loadMultipleChoiceQueue: vi.fn().mockResolvedValue({ questions: [], cards: [] }),
    grade: vi.fn().mockImplementation(async (card) => gradeResultFor(card)),
    markMastered: vi.fn().mockImplementation(async (card) => gradeResultFor(card)),
    undoGrade: vi.fn().mockResolvedValue(undefined),
    hasAnyItems: vi.fn().mockResolvedValue(queue.length > 0),
    importSampleWordlist: vi.fn().mockResolvedValue(14),
    addToNotebook: vi.fn().mockResolvedValue("added"),
    getNotebookSenseIds: vi.fn().mockResolvedValue([]),
    removeFromNotebookBySenseId: vi.fn().mockResolvedValue(undefined),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

/** 测试接缝：注入 mock 设置页数据源工厂 */
function makeSettingsProviderFactory() {
  const provider: SettingsDataProvider = {
    exportBackup: vi.fn().mockResolvedValue(EMPTY_EXPORT),
    exportWordlistCsv: vi.fn().mockResolvedValue("term,definition,pos"),
    importBackup: vi.fn().mockResolvedValue({ items: 0, senses: 0, memoryStates: 0, events: 0 }),
    getPresetSummaries: vi.fn().mockResolvedValue([]),
    getWordbookSummaries: vi.fn().mockResolvedValue([]),
    installWordbook: vi.fn().mockResolvedValue({ installedCount: 0, skippedCount: 0 }),
    getDictionaryPackageSummaries: vi.fn().mockResolvedValue([]),
    fetchDictionaryManifest: vi.fn().mockRejectedValue(new Error("无法获取词包信息：网络不可达")),
    installDictionaryPackage: vi.fn().mockResolvedValue({ status: "installed", installedCount: 0 }),
    markTier1CoveredByTier2: vi.fn().mockResolvedValue(undefined),
    resetDictionaryPackageInstall: vi.fn().mockResolvedValue(undefined),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

/** 测试接缝：注入 mock 搜词数据源工厂（避免渲染时触碰浏览器 IndexedDB） */
function makeSearchProviderFactory() {
  const provider: SearchDataProvider = {
    search: vi.fn().mockResolvedValue([]),
    hasAnySenses: vi.fn().mockResolvedValue(true),
    getNotebookSenseIds: vi.fn().mockResolvedValue([]),
    addToNotebook: vi.fn().mockResolvedValue("added"),
    removeFromNotebookBySenseId: vi.fn().mockResolvedValue(undefined),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

/** 测试接缝：注入 mock 生词本数据源工厂 */
function makeNotebookProviderFactory() {
  const provider: NotebookDataProvider = {
    loadEntries: vi.fn().mockResolvedValue([]),
    removeWord: vi.fn().mockResolvedValue(undefined),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

/** 全零统计快照（首页徽标 + 统计页测试用） */
const EMPTY_STATS_SNAPSHOT = {
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
};

/** 测试接缝：注入 mock 统计数据源工厂（首页徽标 + 统计页） */
function makeStatsProviderFactory(snapshot = EMPTY_STATS_SNAPSHOT) {
  const provider: StatsDataProvider = {
    loadStats: vi.fn().mockResolvedValue(snapshot),
  };
  return { provider, factory: vi.fn().mockReturnValue(provider) };
}

describe("App", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    // 默认视为「已看过首次弹窗」，避免干扰既有用例；RAY-282 专项用例自行清标记
    window.localStorage.setItem(FIRST_OPEN_DIALOG_STORAGE_KEY, FIRST_OPEN_DIALOG_DISMISSED_VALUE);
    // useTheme 会注册 prefers-color-scheme change 监听（RAY-261），mock 需提供对应 API
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
  });

  it("不显示品牌名；首页渲染三个模式按钮（学习 / 复习 / 混合）", () => {
    render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);
    expect(screen.queryByText("乐希")).not.toBeInTheDocument();
    expect(screen.queryByText("Lexilexi")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "混合" })).toBeInTheDocument();
  });

  it("RAY-261：header 不再常驻主题开关；RAY-266：新增搜词入口", () => {
    render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);
    expect(screen.queryByRole("button", { name: /切换到/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜词" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生词本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "统计" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("点击搜词进入搜词页（惰性创建数据源），返回首页退出", async () => {
    const { factory } = makeSearchProviderFactory();
    render(
      <App
        reviewProviderFactory={makeReviewProviderFactory().factory}
        searchProviderFactory={factory}
      />,
    );

    // 未进入搜词页前不创建数据源（避免 jsdom 下触碰 IndexedDB）
    expect(factory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "搜词" }));
    expect(await screen.findByRole("heading", { name: "搜词" })).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
  });

  it("RAY-261：设置页下拉选单切换主题偏好并写入 data-theme", async () => {
    const { factory } = makeSettingsProviderFactory();
    render(
      <App
        reviewProviderFactory={makeReviewProviderFactory().factory}
        settingsProviderFactory={factory}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const select = await screen.findByLabelText(/主题/);
    // 无持久化值 → 默认跟随系统；系统浅色（mock）→ 实际主题 light
    expect(select).toHaveValue("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.change(select, { target: { value: "dark" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("lexilexi:theme")).toBe("dark");

    fireEvent.change(select, { target: { value: "light" } });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("lexilexi:theme")).toBe("light");

    fireEvent.change(select, { target: { value: "system" } });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("lexilexi:theme")).toBe("system");
  });

  it("点击复习进入复习界面（惰性创建数据源，模式为 review），返回首页退出", async () => {
    const card = makeCard();
    card.sense.term = "apple";
    const { provider, factory } = makeReviewProviderFactory([card]);
    render(<App reviewProviderFactory={factory} />);

    // 未进入复习前不创建数据源（避免 jsdom 下触碰 IndexedDB）
    expect(factory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "复习" }));
    // 词条在卡片两面都会渲染，用翻面按钮的可达名定位当前卡
    expect(await screen.findByRole("button", { name: "显示 apple 的释义" })).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(provider.loadQueue).toHaveBeenCalledWith("review");

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
  });

  it("点击学习以 learn 模式进入复习界面", async () => {
    const { provider, factory } = makeReviewProviderFactory();
    render(<App reviewProviderFactory={factory} />);

    fireEvent.click(screen.getByRole("button", { name: "学习" }));

    expect(await screen.findByRole("button", { name: "返回首页" })).toBeInTheDocument();
    expect(provider.loadQueue).toHaveBeenCalledWith("learn");
  });

  it("点击混合以 mixed 模式进入复习界面", async () => {
    const { provider, factory } = makeReviewProviderFactory();
    render(<App reviewProviderFactory={factory} />);

    fireEvent.click(screen.getByRole("button", { name: "混合" }));

    expect(await screen.findByRole("button", { name: "返回首页" })).toBeInTheDocument();
    expect(provider.loadQueue).toHaveBeenCalledWith("mixed");
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
    // 设置页采用统一导航头：右对齐标题 + 左侧返回箭头
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
  });

  it("首页显示今日待学徽标（统计数据源挂载即创建一次）", async () => {
    const { factory: statsFactory } = makeStatsProviderFactory({
      ...EMPTY_STATS_SNAPSHOT,
      dueCount: 3,
      reviewCount: 10,
      streakDays: 2,
    });
    const { factory: reviewFactory } = makeReviewProviderFactory();
    render(<App reviewProviderFactory={reviewFactory} statsProviderFactory={statsFactory} />);

    expect(await screen.findByText("今日待学 3 词")).toBeInTheDocument();
    expect(statsFactory).toHaveBeenCalledTimes(1);
    // 复习数据源保持惰性：仅展示徽标不创建复习源
    expect(reviewFactory).not.toHaveBeenCalled();
  });

  it("点击统计进入统计页，返回首页退出", async () => {
    // 8 个字段取互不相同的值，避免 getByText 撞值（今日待学取 newCardsRemainingToday=9）
    const statsFactory = makeStatsProviderFactory({
      ...EMPTY_STATS_SNAPSHOT,
      streakDays: 1,
      totalDays: 2,
      todayLearnCount: 3,
      todayReviewCount: 4,
      dueCount: 5,
      dueTomorrowCount: 6,
      newCardsRemainingToday: 9,
      reviewCount: 7,
      completedWordCount: 8,
    });
    render(
      <App
        reviewProviderFactory={makeReviewProviderFactory().factory}
        statsProviderFactory={statsFactory.factory}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    expect(await screen.findByText("连续天数")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    // 统计页采用统一导航头：右对齐标题 + 左侧返回箭头
    expect(screen.getByRole("heading", { name: "统计" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
  });

  describe("RAY-282 首次打开弹窗", () => {
    it("无已读标记的首次打开展示弹窗；点击「开始使用」关闭并写入标记", () => {
      window.localStorage.removeItem(FIRST_OPEN_DIALOG_STORAGE_KEY);
      render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);

      expect(screen.getByRole("dialog", { name: "学习数据只存本机" })).toBeInTheDocument();
      expect(screen.getByText(/乐希是本地优先（local-first）应用/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "开始使用" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(window.localStorage.getItem(FIRST_OPEN_DIALOG_STORAGE_KEY)).toBe(
        FIRST_OPEN_DIALOG_DISMISSED_VALUE,
      );
    });

    it("已读标记存在时不再展示（再次打开不重复）", () => {
      window.localStorage.setItem(FIRST_OPEN_DIALOG_STORAGE_KEY, FIRST_OPEN_DIALOG_DISMISSED_VALUE);
      render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Escape 关闭弹窗并写入标记（与按钮行为一致）", () => {
      window.localStorage.removeItem(FIRST_OPEN_DIALOG_STORAGE_KEY);
      render(<App reviewProviderFactory={makeReviewProviderFactory().factory} />);

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(window.localStorage.getItem(FIRST_OPEN_DIALOG_STORAGE_KEY)).toBe(
        FIRST_OPEN_DIALOG_DISMISSED_VALUE,
      );
    });
  });
});

describe("App 生词本入口（RAY-284）", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(FIRST_OPEN_DIALOG_STORAGE_KEY, FIRST_OPEN_DIALOG_DISMISSED_VALUE);
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
  });

  it("点击生词本进入生词本页（惰性创建数据源），返回首页退出", async () => {
    const { factory } = makeNotebookProviderFactory();
    render(
      <App
        reviewProviderFactory={makeReviewProviderFactory().factory}
        notebookProviderFactory={factory}
      />,
    );

    // 未进入生词本页前不创建数据源
    expect(factory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "生词本" }));
    expect(await screen.findByRole("heading", { name: "生词本还是空的" })).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
  });
});
