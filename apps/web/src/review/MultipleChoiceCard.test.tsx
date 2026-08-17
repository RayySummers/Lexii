/**
 * MultipleChoiceCard 交互测试（mock 数据源，不依赖 IndexedDB）。
 *
 * 覆盖：选项渲染、选择反馈（正确/错误高亮）、键盘快捷键 1–4、
 * 选择后禁用、正确/错误标记。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DistractorOption } from "@lexii/core";
import { MultipleChoiceCard } from "./MultipleChoiceCard";
import type { MultipleChoiceQuestion } from "./MultipleChoiceCard";
import { makeSense } from "./testFixtures";

function makeQuestion(overrides: Partial<MultipleChoiceQuestion> = {}): MultipleChoiceQuestion {
  const sense = makeSense({ term: "abandon", definitions: ["放弃"] });
  const options: DistractorOption[] = [
    { text: "放弃", isCorrect: true, source: "correct" },
    { text: "乐队", isCorrect: false, source: "random" },
    { text: "禁令", isCorrect: false, source: "similar-spelling" },
    { text: "银行", isCorrect: false, source: "random" },
  ];
  return { sense, direction: "en-zh", options, ...overrides };
}

describe("MultipleChoiceCard", () => {
  it("渲染词条与选项", () => {
    const question = makeQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={() => {}} />);

    expect(screen.getByText("abandon")).toBeInTheDocument();
    expect(screen.getByText("选择正确的释义")).toBeInTheDocument();
    expect(screen.getByText("放弃")).toBeInTheDocument();
    expect(screen.getByText("乐队")).toBeInTheDocument();
    expect(screen.getByText("禁令")).toBeInTheDocument();
    expect(screen.getByText("银行")).toBeInTheDocument();
  });

  it("显示选项序号 kbd（1–4）", () => {
    const question = makeQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={() => {}} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("点击选项触发 onSelect 回调", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("乐队"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("选择后显示正确/错误标记", () => {
    const question = makeQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={1} onSelect={() => {}} />);

    // 选了错误选项（乐队），正确选项（放弃）显示 ✓
    expect(screen.getByLabelText("正确")).toBeInTheDocument();
    // 选了错误选项显示 ✗
    expect(screen.getByLabelText("错误")).toBeInTheDocument();
  });

  it("选择后选项禁用（不可再选）", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={1} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("银行"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("选择正确选项时只显示 ✓ 无 ✗", () => {
    const question = makeQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={0} onSelect={() => {}} />);

    expect(screen.getByLabelText("正确")).toBeInTheDocument();
    expect(screen.queryByLabelText("错误")).not.toBeInTheDocument();
  });

  it("键盘快捷键 1 选择第一个选项", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: "1" });
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("键盘快捷键 4 选择第四个选项", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: "4" });
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("已选择后键盘快捷键不触发", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={1} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: "2" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("重复按键（repeat）不触发", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: "1", repeat: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("带修饰键不触发", () => {
    const question = makeQuestion();
    const onSelect = vi.fn();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("显示词性标签", () => {
    const sense = makeSense({ term: "abandon", definitions: ["放弃"], pos: "v." });
    const question = makeQuestion({ sense });
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={() => {}} />);

    expect(screen.getByText("v.")).toBeInTheDocument();
  });
});

describe("MultipleChoiceCard 中译英方向（RAY-293）", () => {
  function makeZhEnQuestion(): MultipleChoiceQuestion {
    const sense = makeSense({ term: "abandon", definitions: ["放弃", "抛弃"], pos: "v." });
    const options: DistractorOption[] = [
      { text: "abandon", isCorrect: true, source: "correct" },
      { text: "band", isCorrect: false, source: "random" },
      { text: "ban", isCorrect: false, source: "similar-spelling" },
      { text: "bank", isCorrect: false, source: "random" },
    ];
    return { sense, direction: "zh-en", options };
  }

  it("题面显示主释义、选项显示英文词条", () => {
    const question = makeZhEnQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={() => {}} />);

    // 题面是中文主释义（词条原文只出现在选项里）
    expect(screen.getByRole("radiogroup")).toHaveAccessibleName("放弃 的单词选择");
    expect(screen.getByText("选择正确的单词")).toBeInTheDocument();
    expect(screen.queryByText("选择正确的释义")).not.toBeInTheDocument();
    // 选项全部是英文词条，正确项为 abandon
    expect(screen.getByText("abandon")).toBeInTheDocument();
    expect(screen.getByText("band")).toBeInTheDocument();
    expect(screen.getByText("ban")).toBeInTheDocument();
    expect(screen.getByText("bank")).toBeInTheDocument();
  });

  it("中译英不显示词性标签", () => {
    const question = makeZhEnQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={null} onSelect={() => {}} />);

    expect(screen.queryByText("v.")).not.toBeInTheDocument();
  });

  it("中译英选择后仍显示正确/错误标记", () => {
    const question = makeZhEnQuestion();
    render(<MultipleChoiceCard question={question} selectedIndex={1} onSelect={() => {}} />);

    expect(screen.getByLabelText("正确")).toBeInTheDocument();
    expect(screen.getByLabelText("错误")).toBeInTheDocument();
  });
});
