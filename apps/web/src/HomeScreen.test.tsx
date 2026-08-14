/**
 * 首页 UI 测试（mock 统计数据源）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";
import type { StatsDataProvider, StatsSnapshot } from "./stats/types";

function makeStatsProvider(snapshot: StatsSnapshot): StatsDataProvider {
  return { loadStats: vi.fn().mockResolvedValue(snapshot) };
}

/** 只含首页徽标关心的字段、其余归零的快照 */
function badgeSnapshot(dueCount: number, reviewCount: number, streakDays: number): StatsSnapshot {
  return {
    streakDays,
    totalDays: 0,
    todayLearnCount: 0,
    todayReviewCount: 0,
    dueCount,
    dueTomorrowCount: 0,
    reviewCount,
    completedWordCount: 0,
  };
}

describe("HomeScreen", () => {
  it("今日有到期词时显示到期徽标", async () => {
    render(
      <HomeScreen
        onStartReview={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(3, 10, 2))}
      />,
    );

    expect(await screen.findByText("今日到期 3 词")).toBeInTheDocument();
    // 徽标位于固定挂载的 live region 内（Oscar 评审 C5）
    expect(screen.getByText("今日到期 3 词").closest('[role="status"]')).not.toBeNull();
  });

  it("live region 固定挂载：即使无到期内容，status 区域也在文档中", async () => {
    render(
      <HomeScreen
        onStartReview={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(0, 0, 0))}
      />,
    );

    await screen.findByRole("button", { name: "开始复习" });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/到期/)).not.toBeInTheDocument();
  });

  it("无到期但复习过时显示安静文案", async () => {
    render(
      <HomeScreen
        onStartReview={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(0, 10, 2))}
      />,
    );

    expect(await screen.findByText("今日无到期词，休息一下。")).toBeInTheDocument();
  });

  it("无任何学习记录时不显示到期相关文案", async () => {
    render(
      <HomeScreen
        onStartReview={vi.fn()}
        statsProvider={makeStatsProvider(badgeSnapshot(0, 0, 0))}
      />,
    );

    await screen.findByRole("button", { name: "开始复习" });
    expect(screen.queryByText(/到期/)).not.toBeInTheDocument();
  });

  it("统计数据源不可用（null）时不显示徽标", () => {
    render(<HomeScreen onStartReview={vi.fn()} statsProvider={null} />);

    expect(screen.queryByText(/到期/)).not.toBeInTheDocument();
  });

  it("点击开始复习触发回调", () => {
    const onStartReview = vi.fn();
    render(<HomeScreen onStartReview={onStartReview} statsProvider={null} />);

    fireEvent.click(screen.getByRole("button", { name: "开始复习" }));
    expect(onStartReview).toHaveBeenCalledTimes(1);
  });
});
