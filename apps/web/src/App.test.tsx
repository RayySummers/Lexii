import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    delete document.documentElement.dataset.theme;
  });

  it("渲染应用名与 workspace 包列表", () => {
    render(<App />);
    expect(screen.getByText("乐希")).toBeInTheDocument();
    expect(screen.getByText("Lexilexi")).toBeInTheDocument();
    expect(screen.getByText("@lexilexi/core")).toBeInTheDocument();
    expect(screen.getByText("@lexilexi/ai")).toBeInTheDocument();
  });

  it("点击按钮在浅色/深色主题间切换并写入 data-theme", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: "切换到深色模式" });
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "切换到浅色模式" }));
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
