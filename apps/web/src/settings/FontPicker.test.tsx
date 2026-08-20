/**
 * 卡片字体选择（RAY-323，RAY-366 扩至 7 档）UI 测试。
 *
 * 覆盖验收点：7 张卡片齐全（按 CARD_FONT_OPTIONS 顺序）、每张展示
 * 中文短名 + 示例文案 + 一句副描述、当前档位有「已选」徽标且边框走
 * 主色、点击其他档位回调 onChange(目标 id)、整组 role="radiogroup"，
 * 单卡为原生 radio（受控、name 一致、键盘可访问由浏览器内置）。
 * RAY-366 三档（geist-mono / nunito / geist-pixel）在尾部追加，与
 * RAY-359（Sentient 替换 newsreader）无冲突——id 不重叠、顺序尾部追加。
 *
 * Oscar 评审 suggestion 2 / nit：示例文案按档位应用 fontFamily 与
 * fontWeight（与 Google Fonts 加载字重一致）；「已选」徽标 aria-hidden
 * （radio 的 checked 已播报选中态，不再叠加 role="img"）。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CARD_FONT_OPTIONS, type CardFont } from "../lib/cardFont";
import { FontPicker } from "./FontPicker";

describe("FontPicker 卡片字体选择（RAY-323，RAY-366 扩至 7 档）", () => {
  it("7 张卡片齐全（按 CARD_FONT_OPTIONS 顺序）", () => {
    render(<FontPicker value="inter" onChange={() => {}} groupLabel="卡片字体" />);

    for (const option of CARD_FONT_OPTIONS) {
      expect(screen.getByText(option.label)).toBeInTheDocument();
      expect(screen.getByText(option.description)).toBeInTheDocument();
    }
    // 整组有 radiogroup 角色 + 中文 aria-label
    expect(screen.getByRole("radiogroup", { name: "卡片字体" })).toBeInTheDocument();
    // 7 个原生 radio（RAY-366 与 RAY-359 无冲突：尾部 3 档新增）
    const radios = screen.getAllByRole("radio", { hidden: true });
    expect(radios).toHaveLength(CARD_FONT_OPTIONS.length);
    // 全部在同一 name 下，浏览器会把它们作为同一组
    expect(radios.every((radio) => radio.getAttribute("name") === "card-font")).toBe(true);
  });

  it("当前档位标记「已选」、边框走主色，其他档位无徽标", () => {
    const { container } = render(
      <FontPicker value="playpen" onChange={() => {}} groupLabel="卡片字体" />,
    );
    // playpen 卡片有「已选」徽标；徽标 aria-hidden（Oscar 评审 nit：
    // radio checked 已播报选中态，徽标纯视觉，不叠加 role="img"）
    const selectedBadge = screen.getByText("已选");
    expect(selectedBadge).toBeInTheDocument();
    expect(selectedBadge).toHaveAttribute("aria-hidden", "true");
    // 选中卡片：边框走主色（class 含 border-primary）
    const selectedLabel = selectedBadge.closest("label");
    expect(selectedLabel).not.toBeNull();
    expect(selectedLabel!.className).toContain("border-primary");
    // 受控：playpen radio checked
    const radios = screen.getAllByRole("radio", { hidden: true }) as HTMLInputElement[];
    const playpenRadio = radios.find((radio) => radio.value === "playpen");
    expect(playpenRadio).toBeDefined();
    expect(playpenRadio!.checked).toBe(true);
    // 其他六档 unchecked
    for (const option of CARD_FONT_OPTIONS) {
      if (option.id === "playpen") continue;
      const otherRadio = radios.find((radio) => radio.value === option.id);
      expect(otherRadio).toBeDefined();
      expect(otherRadio!.checked).toBe(false);
    }
    // 徽标总数：只一处「已选」
    expect(screen.getAllByText("已选")).toHaveLength(1);
    // 桌面端 2 列网格 + 移动端单列（grid-cols-1 sm:grid-cols-2）
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.className).toMatch(/grid-cols-1/);
    expect(group?.className).toMatch(/sm:grid-cols-2/);
  });

  it("点击其他档位回调 onChange(目标 id)；点击当前档位也回报告（同名重复切换无副作用）", () => {
    const onChange = vi.fn();
    render(<FontPicker value="inter" onChange={onChange} groupLabel="卡片字体" />);

    const targets: CardFont[] = [
      "google-sans",
      "playpen",
      "sentient",
      "geist-mono",
      "nunito",
      "geist-pixel",
    ];
    for (const next of targets) {
      // 点击 label 文本会冒泡到原生 radio，触发 onChange
      fireEvent.click(screen.getByText(CARD_FONT_OPTIONS.find((o) => o.id === next)!.label));
      expect(onChange).toHaveBeenLastCalledWith(next);
    }
    expect(onChange).toHaveBeenCalledTimes(targets.length);
  });

  it("示例文案按档位渲染 fontFamily 与 fontWeight（与 CARD_FONT_OPTIONS 一致，suggestion 2）", () => {
    const { container } = render(
      <FontPicker value="inter" onChange={() => {}} groupLabel="卡片字体" />,
    );
    // 7 张卡片都用同一个 sampleText；用容器内 raw HTML 反查
    // 「style 含该档 fontFamily 且 fontWeight 匹配」的 sample 节点必须恰好 1 个
    const allSamples = Array.from(container.querySelectorAll<HTMLElement>("span"));
    for (const option of CARD_FONT_OPTIONS) {
      const matches = allSamples.filter(
        (el) =>
          el.textContent === option.sampleText &&
          (el.getAttribute("style") ?? "").includes(option.fontFamily) &&
          (el.getAttribute("style") ?? "").includes(`font-weight: ${option.fontWeight}`),
      );
      expect(matches).toHaveLength(1);
    }
  });
});
