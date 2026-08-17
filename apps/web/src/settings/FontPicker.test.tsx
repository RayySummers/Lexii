/**
 * 卡片字体选择（RAY-323）UI 测试。
 *
 * 覆盖验收点：4 张卡片齐全（按 CARD_FONT_OPTIONS 顺序）、每张展示
 * 中文短名 + 示例文案 + 一句副描述、当前档位有「已选」徽标且边框走
 * 主色、点击其他档位回调 onChange(目标 id)、整组 role="radiogroup"，
 * 单卡为原生 radio（受控、name 一致、键盘可访问由浏览器内置）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CARD_FONT_OPTIONS, type CardFont } from "../lib/cardFont";
import { FontPicker } from "./FontPicker";

describe("FontPicker 卡片字体选择（RAY-323）", () => {
  it("4 张卡片齐全（按 CARD_FONT_OPTIONS 顺序）", () => {
    render(<FontPicker value="inter" onChange={() => {}} groupLabel="卡片字体" />);

    for (const option of CARD_FONT_OPTIONS) {
      expect(screen.getByText(option.label)).toBeInTheDocument();
      expect(screen.getByText(option.description)).toBeInTheDocument();
    }
    // 整组有 radiogroup 角色 + 中文 aria-label
    expect(screen.getByRole("radiogroup", { name: "卡片字体" })).toBeInTheDocument();
    // 4 个原生 radio
    const radios = screen.getAllByRole("radio", { hidden: true });
    expect(radios).toHaveLength(CARD_FONT_OPTIONS.length);
    // 全部在同一 name 下，浏览器会把它们作为同一组
    expect(radios.every((radio) => radio.getAttribute("name") === "card-font")).toBe(true);
  });

  it("当前档位标记「已选」、边框走主色，其他档位无徽标", () => {
    const { container } = render(
      <FontPicker value="playpen" onChange={() => {}} groupLabel="卡片字体" />,
    );
    // playpen 卡片有「已选」徽标（role="img" aria-label="已选中"）
    const selectedBadge = screen.getByLabelText("已选中");
    expect(selectedBadge).toBeInTheDocument();
    // 选中卡片：边框走主色（class 含 border-primary）
    const selectedLabel = selectedBadge.closest("label");
    expect(selectedLabel).not.toBeNull();
    expect(selectedLabel!.className).toContain("border-primary");
    // 受控：playpen radio checked
    const radios = screen.getAllByRole("radio", { hidden: true }) as HTMLInputElement[];
    const playpenRadio = radios.find((radio) => radio.value === "playpen");
    expect(playpenRadio).toBeDefined();
    expect(playpenRadio!.checked).toBe(true);
    // 其他三档 unchecked
    for (const option of CARD_FONT_OPTIONS) {
      if (option.id === "playpen") continue;
      const otherRadio = radios.find((radio) => radio.value === option.id);
      expect(otherRadio).toBeDefined();
      expect(otherRadio!.checked).toBe(false);
    }
    // 徽标总数：只一处「已选」
    expect(screen.getAllByLabelText("已选中")).toHaveLength(1);
    // 桌面端 2 列网格 + 移动端单列（grid-cols-1 sm:grid-cols-2）
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.className).toMatch(/grid-cols-1/);
    expect(group?.className).toMatch(/sm:grid-cols-2/);
  });

  it("点击其他档位回调 onChange(目标 id)；点击当前档位也回报告（同名重复切换无副作用）", () => {
    const onChange = vi.fn();
    render(<FontPicker value="inter" onChange={onChange} groupLabel="卡片字体" />);

    const targets: CardFont[] = ["google-sans", "playpen", "newsreader"];
    for (const next of targets) {
      // 点击 label 文本会冒泡到原生 radio，触发 onChange
      fireEvent.click(screen.getByText(CARD_FONT_OPTIONS.find((o) => o.id === next)!.label));
      expect(onChange).toHaveBeenLastCalledWith(next);
    }
    expect(onChange).toHaveBeenCalledTimes(targets.length);
  });

  it("示例文案用对应字体渲染（fontFamily 内联 style 引用 CARD_FONT_OPTIONS）", () => {
    const { container } = render(
      <FontPicker value="inter" onChange={() => {}} groupLabel="卡片字体" />,
    );
    // 4 张卡片都用同一个 sampleText；用容器内 raw HTML 反查
    // 「style 包含该档 fontFamily」的 sample 节点必须恰好 1 个
    const allSamples = Array.from(container.querySelectorAll<HTMLElement>("span"));
    for (const option of CARD_FONT_OPTIONS) {
      const matches = allSamples.filter(
        (el) =>
          el.textContent === option.sampleText &&
          (el.getAttribute("style") ?? "").includes(option.fontFamily),
      );
      expect(matches).toHaveLength(1);
    }
  });
});
