/**
 * 评分按钮测试（RAY-265：默认三档，设置可切四档）。
 *
 * 覆盖：三档渲染认识 / 模糊 / 不认识且无 Easy；四档渲染
 * Again / Hard / Good / Easy；点击回调携带对应评分档位；
 * RAY-278 返工：三档全视口一排三个（移动端不再 2×2 缺右下角）。
 * 分钟级副文案不渲染（RAY-279：移除「X 分钟后复习」提示）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewRating } from "@lexii/core";
import { RatingButtons } from "./RatingButtons";

const DUE_LABELS: Record<ReviewRating, string | null> = {
  again: null, // 分钟级「X 分钟后复习」文案（RAY-279 起不展示）
  hard: "1小时",
  good: "1天",
  easy: "4天",
};

describe("RatingButtons", () => {
  it("三档：认识 / 模糊 / 不认识，不渲染 Easy", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="three" onGrade={onGrade} />);

    expect(screen.getByRole("button", { name: /评分：认识/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /评分：模糊/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /评分：不认识/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Easy/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("三档点击：认识 → good、模糊 → hard、不认识 → again", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="three" onGrade={onGrade} />);

    fireEvent.click(screen.getByRole("button", { name: /评分：认识/ }));
    fireEvent.click(screen.getByRole("button", { name: /评分：模糊/ }));
    fireEvent.click(screen.getByRole("button", { name: /评分：不认识/ }));

    expect(onGrade.mock.calls.map((call) => call[0])).toEqual(["good", "hard", "again"]);
  });

  it("四档（Anki 传统）：Again / Hard / Good / Easy 齐全", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="four" onGrade={onGrade} />);

    expect(screen.getByRole("button", { name: /评分：Again/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /评分：Hard/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /评分：Good/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /评分：Easy/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("三档全视口一排三个（RAY-278 返工）：base grid-cols-3，非 sm 前缀、非两列", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="three" onGrade={onGrade} />);

    const grid = screen.getByRole("group", { name: "评分" });
    const tokens = grid.className.split(/\s+/);
    expect(tokens).toContain("grid-cols-3");
    expect(tokens).not.toContain("sm:grid-cols-3");
    expect(tokens).not.toContain("grid-cols-2");
  });

  it("四档移动端保持 2×2、sm 以上一排四个（不误伤既有布局）", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="four" onGrade={onGrade} />);

    const grid = screen.getByRole("group", { name: "评分" });
    const tokens = grid.className.split(/\s+/);
    expect(tokens).toContain("grid-cols-2");
    expect(tokens).toContain("sm:grid-cols-4");
    expect(tokens).not.toContain("grid-cols-3");
  });

  it("四档点击：Easy → easy（含到期副文案）", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="four" onGrade={onGrade} />);

    const easyButton = screen.getByRole("button", { name: /评分：Easy/ });
    expect(easyButton).toHaveTextContent("4天");
    fireEvent.click(easyButton);

    expect(onGrade).toHaveBeenCalledWith("easy");
  });

  it("分钟级副文案不渲染（RAY-279），小时/天级保留", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="three" onGrade={onGrade} />);

    // again 档为 null（分钟级），不渲染「X 分钟后复习」类文案
    expect(screen.queryByText(/分钟/)).not.toBeInTheDocument();
    const againButton = screen.getByRole("button", { name: /评分：不认识/ });
    expect(againButton).toHaveTextContent("不认识");
    // 小时 / 天级（真实到期排期）保留
    expect(screen.getByText("1小时")).toBeInTheDocument();
    expect(screen.getByText("1天")).toBeInTheDocument();
  });

  it("全部档位为 null 时按钮无副文案且照常可用（RAY-279）", () => {
    const onGrade = vi.fn();
    const allNull: Record<ReviewRating, string | null> = {
      again: null,
      hard: null,
      good: null,
      easy: null,
    };
    render(<RatingButtons dueLabels={allNull} mode="four" onGrade={onGrade} />);

    expect(screen.queryByText(/分钟|小时|天|月|年/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /评分：Again/ }));
    expect(onGrade).toHaveBeenCalledWith("again");
  });
});
