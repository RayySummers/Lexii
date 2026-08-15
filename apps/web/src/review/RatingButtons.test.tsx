/**
 * 评分按钮测试（RAY-265：默认三档，设置可切四档）。
 *
 * 覆盖：三档渲染认识 / 模糊 / 不认识且无 Easy；四档渲染
 * Again / Hard / Good / Easy；点击回调携带对应评分档位。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewRating } from "@lexilexi/core";
import { RatingButtons } from "./RatingButtons";

const DUE_LABELS: Record<ReviewRating, string> = {
  again: "10分钟",
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

  it("四档点击：Easy → easy（含到期副文案）", () => {
    const onGrade = vi.fn();
    render(<RatingButtons dueLabels={DUE_LABELS} mode="four" onGrade={onGrade} />);

    const easyButton = screen.getByRole("button", { name: /评分：Easy/ });
    expect(easyButton).toHaveTextContent("4天");
    fireEvent.click(easyButton);

    expect(onGrade).toHaveBeenCalledWith("easy");
  });
});
