/**
 * 复习卡片富化展示测试（RAY-272 批次 B 功能层）。
 *
 * 覆盖四类展示：美/英双音标（正反面、缺省回退）、例句（中英句对、
 * 空译文不渲染）、词根词缀拆解与中文词源、近反义词 chips；
 * 以及富化字段缺失时各区块不渲染（退化为既有形态）。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Sense } from "@lexilexi/core";
import { ReviewCard } from "./ReviewCard";
import { makeSense } from "./testFixtures";

/** 受控翻面容器：点击卡片真实翻转（ReviewCard 的 flipped 由父级持有） */
function Harness({ sense }: { sense: Sense }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <ReviewCard
      sense={sense}
      flipped={flipped}
      onFlip={() => setFlipped((v) => !v)}
      ratingHint="按 1–3（或 A / H / G）评分"
    />
  );
}

/** 富化字段齐全的词条（形态照真实数据：音标自带斜杠、词根词缀带 <含义>） */
function makeRichSense(): Sense {
  return makeSense({
    term: "abandon",
    definitions: ["放弃；抛弃"],
    ipa: "/əˈbændən/",
    ipaUs: "/əˈbændən/",
    ipaUk: "/ɐbˈændən/",
    pos: "v.",
    synonyms: ["abdicate", "abjure"],
    antonyms: ["keep", "retain"],
    wordParts: "a<加强> · bandon<控制>",
    etymologyZh: "由强调前缀 a- 与 bandon（管辖权）结合。",
    examples: [
      { text: "We have to abandon the plan.", translation: "我们必须放弃这个计划。" },
      { text: "More text.", translation: "" },
    ],
  });
}

function flipCard() {
  fireEvent.click(screen.getByRole("button", { name: /显示 abandon 的释义/ }));
}

describe("ReviewCard 美/英双音标", () => {
  it("正面展示美/英双音标（aria-label 含音标值，读屏不吞音标本体）", () => {
    render(<Harness sense={makeRichSense()} />);
    expect(screen.getAllByLabelText("美式音标 /əˈbændən/")).toHaveLength(2); // 正反面各一
    expect(screen.getAllByLabelText("英式音标 /ɐbˈændən/")).toHaveLength(2);
    expect(screen.getAllByText("美")).toHaveLength(2);
    expect(screen.getAllByText("英")).toHaveLength(2);
    expect(screen.getAllByText("/əˈbændən/")).toHaveLength(2);
    expect(screen.getAllByText("/ɐbˈændən/")).toHaveLength(2);
  });

  it("富化音标缺省：回退词书自带 ipa（补斜杠、无标签）", () => {
    render(<Harness sense={makeSense({ term: "abandon", ipa: "əˈbændən" })} />);
    expect(screen.getAllByLabelText("音标 /əˈbændən/")).toHaveLength(2);
    expect(screen.getAllByText("/əˈbændən/")).toHaveLength(2);
    expect(screen.queryByText("美")).toBeNull();
    expect(screen.queryByText("英")).toBeNull();
  });

  it("无任何音标数据：不渲染音标行", () => {
    render(<Harness sense={makeSense({ term: "abandon" })} />);
    expect(screen.queryByLabelText("音标")).toBeNull();
    expect(screen.queryByLabelText("美式音标")).toBeNull();
  });
});

describe("ReviewCard 背面富化内容", () => {
  it("例句以中英句对展示；空译文不渲染第二行", () => {
    render(<Harness sense={makeRichSense()} />);
    flipCard();

    const examplesSection = screen.getByText("例句").parentElement as HTMLElement;
    expect(within(examplesSection).getByText("We have to abandon the plan.")).toBeInTheDocument();
    expect(within(examplesSection).getByText("我们必须放弃这个计划。")).toBeInTheDocument();
    // 空译文例句：只有英文一行，不产生空译文行
    const noTranslation = within(examplesSection).getByText("More text.");
    expect(noTranslation.parentElement?.children).toHaveLength(1);
  });

  it("词根词缀：词素与含义拆分展示", () => {
    render(<Harness sense={makeRichSense()} />);
    flipCard();

    const wordPartsSection = screen.getByText("词根词缀").parentElement as HTMLElement;
    expect(within(wordPartsSection).getByText("a")).toBeInTheDocument();
    expect(within(wordPartsSection).getByText("加强")).toBeInTheDocument();
    expect(within(wordPartsSection).getByText("bandon")).toBeInTheDocument();
    expect(within(wordPartsSection).getByText("控制")).toBeInTheDocument();
  });

  it("中文词源展示完整说明文字", () => {
    render(<Harness sense={makeRichSense()} />);
    flipCard();

    expect(screen.getByText("由强调前缀 a- 与 bandon（管辖权）结合。")).toBeInTheDocument();
  });

  it("近反义词以 chips 展示", () => {
    render(<Harness sense={makeRichSense()} />);
    flipCard();

    const synonymsSection = screen.getByText("近义词").parentElement as HTMLElement;
    expect(within(synonymsSection).getByText("abdicate")).toBeInTheDocument();
    expect(within(synonymsSection).getByText("abjure")).toBeInTheDocument();

    const antonymsSection = screen.getByText("反义词").parentElement as HTMLElement;
    expect(within(antonymsSection).getByText("keep")).toBeInTheDocument();
    expect(within(antonymsSection).getByText("retain")).toBeInTheDocument();
  });

  it("富化字段缺失：各区块不渲染，卡片退化为释义形态", () => {
    render(
      <Harness
        sense={makeSense({ term: "abandon", definitions: ["放弃；抛弃"], ipa: "əˈbændən" })}
      />,
    );
    flipCard();

    expect(screen.getByText("放弃；抛弃")).toBeInTheDocument();
    for (const label of ["例句", "词根词缀", "中文词源", "近义词", "反义词"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("翻面状态经 aria-expanded 表达，正面提示词只在正面可见", () => {
    render(<Harness sense={makeRichSense()} />);
    const button = screen.getByRole("button", { name: /显示 abandon 的释义/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("点击卡片或按空格查看释义")).toBeInTheDocument();

    flipCard();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ReviewCard 固定高度与卡片内部滚动（RAY-291）", () => {
  /** 卡片按钮：翻面后可达名从「显示」变「隐藏」，正则取公共部分 */
  function cardButton(): HTMLElement {
    return screen.getByRole("button", { name: /abandon 的释义/ });
  }

  /** 两面都渲染同一词条文本（正反面各一），取当前可见面（aria-hidden=false）的那份 */
  function visibleElementOf(text: string): HTMLElement {
    const matches = screen.getAllByText(text);
    const visible = matches.find(
      (element) => element.closest("[aria-hidden]")?.getAttribute("aria-hidden") === "false",
    );
    if (!visible) {
      throw new Error(`未找到可见面的文本：${text}`);
    }
    return visible;
  }

  it("卡片高度固定、与内容长度无关：外层容器带视口 clamp 高度（不随内容伸缩）", () => {
    render(<Harness sense={makeRichSense()} />);
    const wrapper = cardButton().parentElement as HTMLElement;
    // 高度只由视口决定（clamp 区间），超长内容由面内滚动区承接
    expect(wrapper).toHaveClass("h-[clamp(14rem,calc(100dvh_-_26rem),32rem)]");
  });

  it("正反面同口径：两面共用同一 CardFace 结构，h-full 填满固定高度卡片", () => {
    render(<Harness sense={makeRichSense()} />);
    const faces = Array.from(cardButton().querySelectorAll(":scope > div"));
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toHaveClass("h-full", "overflow-hidden", "rounded-2xl", "border");
    }
  });

  it("背面超长内容落在面内滚动区；评分提示固定在滚动区外的底栏", () => {
    render(<Harness sense={makeRichSense()} />);
    flipCard();

    const scrollRegion = screen.getByText("放弃；抛弃").closest(".overflow-y-auto") as HTMLElement;
    expect(scrollRegion).toHaveClass("overflow-y-auto", "overscroll-contain");
    // 富化内容全部收纳在同一滚动区内
    for (const label of ["例句", "词根词缀", "中文词源", "近义词", "反义词"]) {
      expect(scrollRegion).toContainElement(screen.getByText(label));
    }
    // 评分提示不在滚动区内：内容滚动时提示恒留在卡片底部
    const ratingHint = screen.getByText("按 1–3（或 A / H / G）评分");
    expect(scrollRegion).not.toContainElement(ratingHint);
    expect(ratingHint.parentElement).toBe(cardButton().lastElementChild);
  });

  it("正面词条在面内滚动区内；翻面提示固定在正面底栏", () => {
    render(<Harness sense={makeRichSense()} />);

    const term = visibleElementOf("abandon");
    const scrollRegion = term.closest(".overflow-y-auto") as HTMLElement;
    expect(scrollRegion).toHaveClass("overflow-y-auto", "overscroll-contain");
    expect(scrollRegion).toContainElement(term);

    const flipHint = screen.getByText("点击卡片或按空格查看释义");
    expect(scrollRegion).not.toContainElement(flipHint);
    expect(flipHint.parentElement).toBe(cardButton().firstElementChild);
  });

  it("换卡时滚动区以 sense.id 重建：滚动位置不跨卡残留", () => {
    const first = makeRichSense();
    const second = makeSense({ term: "benevolent", definitions: ["仁慈的；善意的"] });
    const { rerender } = render(<Harness sense={first} />);
    flipCard();

    const regionBefore = screen.getByText("放弃；抛弃").closest(".overflow-y-auto");
    rerender(<Harness sense={second} />);
    const regionAfter = screen.getByText("仁慈的；善意的").closest(".overflow-y-auto");

    expect(regionAfter).not.toBeNull();
    // 新卡重建滚动区（key 变化触发 remount），旧滚动位置随之归零
    expect(regionAfter).not.toBe(regionBefore);
  });
});
