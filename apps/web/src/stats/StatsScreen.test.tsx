/**
 * 统计页 UI 测试（mock 数据源）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatsScreen } from "./StatsScreen";
import type { StatsDataProvider, StatsSnapshot } from "./types";

function makeProvider(snapshot: StatsSnapshot): StatsDataProvider {
  return { loadStats: vi.fn().mockResolvedValue(snapshot) };
}

describe("StatsScreen", () => {
  it("渲染连续天数 / 今日到期 / 已复习三张卡片", async () => {
    render(
      <StatsScreen
        provider={makeProvider({ dueCount: 5, reviewCount: 42, streakDays: 3 })}
        onExit={vi.fn()}
      />,
    );

    expect(await screen.findByText("连续天数")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("无学习数据时显示空状态", async () => {
    render(
      <StatsScreen
        provider={makeProvider({ dueCount: 0, reviewCount: 0, streakDays: 0 })}
        onExit={vi.fn()}
      />,
    );

    expect(await screen.findByText("还没有学习数据。")).toBeInTheDocument();
    expect(screen.queryByText("连续天数")).not.toBeInTheDocument();
  });

  it("加载失败显示错误并可重试恢复", async () => {
    const provider: StatsDataProvider = {
      loadStats: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue({ dueCount: 1, reviewCount: 2, streakDays: 3 }),
    };
    render(<StatsScreen provider={provider} onExit={vi.fn()} />);

    expect(await screen.findByText(/无法读取本地数据/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("连续天数")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("返回首页按钮触发 onExit", async () => {
    const onExit = vi.fn();
    render(
      <StatsScreen
        provider={makeProvider({ dueCount: 0, reviewCount: 0, streakDays: 0 })}
        onExit={onExit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
