import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstOpenDialog } from "./FirstOpenDialog";

describe("FirstOpenDialog", () => {
  it("渲染 Vega 文案：标题 / 正文（local-first + 备份建议）/ 按钮", () => {
    render(<FirstOpenDialog onDismiss={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "学习数据只存本机" })).toBeInTheDocument();
    expect(screen.getByText(/乐希是本地优先（local-first）应用/)).toBeInTheDocument();
    expect(screen.getByText(/不会上传到任何服务器/)).toBeInTheDocument();
    expect(screen.getByText(/建议定期导出备份/)).toBeInTheDocument();
    expect(screen.getByText(/设置页「导出数据」中随时可以导出/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始使用" })).toBeInTheDocument();
  });

  it("点击「开始使用」触发 onDismiss", () => {
    const onDismiss = vi.fn();
    render(<FirstOpenDialog onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Escape 键触发 onDismiss", () => {
    const onDismiss = vi.fn();
    render(<FirstOpenDialog onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("打开时焦点落在「开始使用」按钮", () => {
    render(<FirstOpenDialog onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "开始使用" })).toHaveFocus();
  });

  it("单焦点弹窗内 Tab 被拦截（焦点不外泄到背景内容）", () => {
    render(<FirstOpenDialog onDismiss={vi.fn()} />);
    const button = screen.getByRole("button", { name: "开始使用" });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(button).toHaveFocus();
  });

  it("弹窗面板走 design tokens（无硬编码颜色工具类，浅色/深色随主题切换）", () => {
    render(<FirstOpenDialog onDismiss={vi.fn()} />);
    const panel = screen.getByRole("dialog");
    // 背景 / 边框 / 文本全部引用 M3 语义 token 工具类（--lex-*）
    expect(panel.className).toContain("bg-surface");
    expect(panel.className).toContain("border-outline-variant");
    expect(panel.className).toContain("rounded-xl");
    expect(panel.querySelector("h2")?.className).toContain("text-on-surface");
    expect(panel.querySelector("p")?.className).toContain("text-on-surface-variant");
    expect(panel.querySelector("button")?.className).toContain("bg-primary");
    expect(panel.querySelector("button")?.className).toContain("text-on-primary");
    // 遮罩走 M3 scrim（--lex-scrim）
    expect(document.body.innerHTML).toContain("bg-scrim/40");
  });
});
