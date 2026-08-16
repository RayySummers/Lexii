/**
 * 统计页 UI 测试（mock 数据源）。
 *
 * RAY-252：8 项统计卡片全量渲染，数值互不冲突（用全不同的值便于断言）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatsScreen } from "./StatsScreen";
import type { StatsDataProvider, StatsSnapshot } from "./types";

/** 8 个字段互不相同的快照（避免 getByText 撞值；今日待学取 newCardsRemainingToday=9） */
const FULL_SNAPSHOT: StatsSnapshot = {
  streakDays: 1,
  totalDays: 2,
  todayLearnCount: 3,
  todayReviewCount: 4,
  dueCount: 5,
  dueTomorrowCount: 6,
  newCardsRemainingToday: 9,
  reviewCount: 7,
  completedWordCount: 8,
};

const EMPTY_SNAPSHOT: StatsSnapshot = {
  streakDays: 0,
  totalDays: 0,
  todayLearnCount: 0,
  todayReviewCount: 0,
  dueCount: 0,
  dueTomorrowCount: 0,
  newCardsRemainingToday: 0,
  reviewCount: 0,
  completedWordCount: 0,
};

function makeProvider(snapshot: StatsSnapshot): StatsDataProvider {
  return { loadStats: vi.fn().mockResolvedValue(snapshot) };
}

describe("StatsScreen", () => {
  it("渲染 8 张统计卡片与对应数值", async () => {
    render(<StatsScreen provider={makeProvider(FULL_SNAPSHOT)} onExit={vi.fn()} />);

    expect(await screen.findByText("连续天数")).toBeInTheDocument();
    expect(screen.getByText("累计天数")).toBeInTheDocument();
    expect(screen.getByText("今日已学习（次数）")).toBeInTheDocument();
    expect(screen.getByText("今日已复习（次数）")).toBeInTheDocument();
    expect(screen.getByText("今日待学（词条）")).toBeInTheDocument();
    expect(screen.getByText("明日到期（词条）")).toBeInTheDocument();
    expect(screen.getByText("累计已完成（次数）")).toBeInTheDocument();
    expect(screen.getByText("累计已完成（词条）")).toBeInTheDocument();

    // 今日待学显示 newCardsRemainingToday（9），不再显示未截断的 dueCount（5）
    for (const value of ["1", "2", "3", "4", "6", "7", "8", "9"]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("今日待学按每日新卡上限过滤：显示剩余新卡数，不显示全部未学新卡总数（RAY-295）", async () => {
    render(
      <StatsScreen
        provider={makeProvider({ ...EMPTY_SNAPSHOT, dueCount: 7_195, newCardsRemainingToday: 20 })}
        onExit={vi.fn()}
      />,
    );

    expect(await screen.findByText("今日待学（词条）")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText("7,195")).not.toBeInTheDocument();
    expect(screen.queryByText("7195")).not.toBeInTheDocument();
  });

  it("无学习数据时显示空状态", async () => {
    render(<StatsScreen provider={makeProvider(EMPTY_SNAPSHOT)} onExit={vi.fn()} />);

    expect(await screen.findByText("还没有学习数据。")).toBeInTheDocument();
    expect(screen.queryByText("连续天数")).not.toBeInTheDocument();
  });

  it("仅明日有到期（无复习、今日无到期）也展示面板", async () => {
    render(
      <StatsScreen
        provider={makeProvider({ ...EMPTY_SNAPSHOT, dueTomorrowCount: 3 })}
        onExit={vi.fn()}
      />,
    );

    expect(await screen.findByText("明日到期（词条）")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("还没有学习数据。")).not.toBeInTheDocument();
  });

  it("加载失败显示友好错误文案（原始信息收进折叠详情）并可重试恢复", async () => {
    const provider: StatsDataProvider = {
      loadStats: vi
        .fn()
        .mockRejectedValueOnce(new Error("IndexedDB connection failed: boom"))
        .mockResolvedValue({
          ...EMPTY_SNAPSHOT,
          newCardsRemainingToday: 1,
          reviewCount: 2,
          streakDays: 3,
        }),
    };
    render(<StatsScreen provider={provider} onExit={vi.fn()} />);

    // 主文案友好（Oscar 评审 C4），原始错误只出现在折叠详情里
    expect(await screen.findByText("无法读取本地数据，请重试。")).toBeInTheDocument();
    const rawError = screen.getByText(/IndexedDB connection failed: boom/);
    expect(rawError.closest("details")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("连续天数")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("返回首页按钮触发 onExit", async () => {
    const onExit = vi.fn();
    render(<StatsScreen provider={makeProvider(EMPTY_SNAPSHOT)} onExit={onExit} />);

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
