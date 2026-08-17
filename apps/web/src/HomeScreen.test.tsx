/**
 * 首页 UI 测试（mock 统计数据源）。
 *
 * RAY-253：三个模式按钮（学习 / 复习 / 混合）+ 今日待学徽标（RAY-254 起，此前为到期徽标）；
 * 品牌名与介绍文案不再渲染（已归档 docs/archive/homepage-intro-v1.md）。
 * RAY-260（Oscar 复评 suggestion 2）：有待学词时展示「今日新卡额度剩余 N 张」。
 * RAY-278（返工裁定）：三模式按钮移动端竖排为期望形态——容器必须是
 * `sm:grid-cols-3`（<640px 单列竖排），不带 base `grid-cols-3`（那会把
 * 移动端挤成一排三个）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyMode } from "@lexii/core";
import { HomeScreen } from "./HomeScreen";
import type { StatsDataProvider, StatsSnapshot } from "./stats/types";

function makeStatsProvider(snapshot: StatsSnapshot): StatsDataProvider {
  return { loadStats: vi.fn().mockResolvedValue(snapshot) };
}

/** 只含首页徽标关心的字段、其余归零的快照 */
function badgeSnapshot(
  dueCount: number,
  reviewCount: number,
  streakDays: number,
  overrides: Partial<StatsSnapshot> = {},
): StatsSnapshot {
  return {
    streakDays,
    totalDays: 0,
    todayLearnCount: 0,
    todayReviewCount: 0,
    dueCount,
    dueTomorrowCount: 0,
    newCardsRemainingToday: 0,
    reviewCount,
    completedWordCount: 0,
    todayStudyDurationMs: 0,
    totalStudyDurationMs: 0,
    ...overrides,
  };
}

describe("HomeScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("渲染三个模式按钮：学习 / 复习 / 混合", () => {
    render(<HomeScreen onStart={vi.fn()} statsProvider={null} />);

    expect(screen.getByRole("button", { name: "学习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "混合" })).toBeInTheDocument();
  });

  it("三模式按钮移动端竖排、桌面端三列（RAY-278 返工：容器不带 base grid-cols-3）", () => {
    render(<HomeScreen onStart={vi.fn()} statsProvider={null} />);

    const modes = [
      screen.getByRole("button", { name: "学习" }),
      screen.getByRole("button", { name: "复习" }),
      screen.getByRole("button", { name: "混合" }),
    ];

    // 三个按钮挂在同一个网格容器上
    const containers = new Set(modes.map((b) => b.parentElement));
    expect(containers.size).toBe(1);

    // 移动端竖排（一排一个）：base 不带三列类；桌面端 ≥sm 才一排三个
    const grid = modes[0]!.parentElement!;
    const tokens = grid.className.split(/\s+/);
    expect(tokens).toContain("sm:grid-cols-3");
    expect(tokens).not.toContain("grid-cols-3");

    // 学习形式切换（卡片/选择题）不属于该网格
    expect(grid).not.toContainElement(screen.getByRole("radio", { name: /卡片/ }));
  });

  it("不渲染品牌名与介绍文案（反馈 1：首页保持简洁）", () => {
    render(<HomeScreen onStart={vi.fn()} statsProvider={null} />);

    expect(screen.queryByText("定制化背单词体验")).not.toBeInTheDocument();
    expect(screen.queryByText("本地优先")).not.toBeInTheDocument();
    expect(screen.queryByText("FSRS 排期")).not.toBeInTheDocument();
    expect(screen.queryByText("支持导入词库")).not.toBeInTheDocument();
  });

  it.each([
    ["学习", "learn"],
    ["复习", "review"],
    ["混合", "mixed"],
  ] as const)("点击「%s」以 %s 模式触发回调", (label, mode: StudyMode) => {
    const onStart = vi.fn();
    render(<HomeScreen onStart={onStart} statsProvider={null} />);

    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(mode, "card");
  });

  it("今日有待学词时显示待学徽标", async () => {
    render(
      <HomeScreen onStart={vi.fn()} statsProvider={makeStatsProvider(badgeSnapshot(3, 10, 2))} />,
    );

    expect(await screen.findByText("今日待学 3 词")).toBeInTheDocument();
    // 徽标位于固定挂载的 live region 内（Oscar 评审 C5）
    expect(screen.getByText("今日待学 3 词").closest('[role="status"]')).not.toBeNull();
  });

  it("live region 固定挂载：即使无待学内容，status 区域也在文档中", async () => {
    render(
      <HomeScreen onStart={vi.fn()} statsProvider={makeStatsProvider(badgeSnapshot(0, 0, 0))} />,
    );

    await screen.findByRole("button", { name: "学习" });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/今日待学/)).not.toBeInTheDocument();
  });

  it("无待学词但复习过时显示安静文案", async () => {
    render(
      <HomeScreen onStart={vi.fn()} statsProvider={makeStatsProvider(badgeSnapshot(0, 10, 2))} />,
    );

    expect(await screen.findByText("今日无待学词，休息一下。")).toBeInTheDocument();
  });

  it("无任何学习记录时不显示待学相关文案", async () => {
    render(
      <HomeScreen onStart={vi.fn()} statsProvider={makeStatsProvider(badgeSnapshot(0, 0, 0))} />,
    );

    await screen.findByRole("button", { name: "学习" });
    expect(screen.queryByText(/今日待学/)).not.toBeInTheDocument();
  });

  it("统计数据源不可用（null）时不显示徽标", () => {
    render(<HomeScreen onStart={vi.fn()} statsProvider={null} />);

    expect(screen.queryByText(/今日待学/)).not.toBeInTheDocument();
  });

  it("有待学词时显示今日新卡额度（默认 20 − 今日已学，RAY-260 复评 suggestion 2）", async () => {
    render(
      <HomeScreen
        onStart={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(3, 10, 2, { todayLearnCount: 5 }))}
      />,
    );

    expect(
      await screen.findByText("今日新卡额度剩余 15 张，超出部分顺延到之后的日子。"),
    ).toBeInTheDocument();
  });

  it("额度按设置值折算；今日已学满时显示剩余 0 张", async () => {
    window.localStorage.setItem("lexii:daily-new-card-limit", "5");
    render(
      <HomeScreen
        onStart={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(8, 10, 2, { todayLearnCount: 5 }))}
      />,
    );

    expect(
      await screen.findByText("今日新卡额度剩余 0 张，超出部分顺延到之后的日子。"),
    ).toBeInTheDocument();
  });

  it("无待学词时不显示额度提示（空状态保持简洁）", async () => {
    render(
      <HomeScreen
        onStart={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(0, 10, 2, { todayLearnCount: 3 }))}
      />,
    );

    await screen.findByRole("button", { name: "学习" });
    expect(screen.queryByText(/今日新卡额度/)).not.toBeInTheDocument();
  });
});
