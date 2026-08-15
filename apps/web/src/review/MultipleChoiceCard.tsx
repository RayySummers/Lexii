/**
 * 选择题卡片：显示词条 + 4 个释义选项。
 *
 * 交互流程：
 * 1. 显示词条（正面），等待选择
 * 2. 选择后立即反馈（正确/错误高亮），1 秒后自动进入下一题
 * 3. 键盘快捷键 1–4 选择
 *
 * 设计 token 全走 CSS 变量（浅色/深色自动生效）；
 * 触控目标 ≥ 48px（Oscar 标准 C3）；
 * 动画尊重 prefers-reduced-motion。
 */
import { useEffect, useRef } from "react";
import type { Sense } from "@lexilexi/core";
import type { DistractorOption } from "@lexilexi/core";

export interface MultipleChoiceQuestion {
  /** 当前考查的义项 */
  sense: Sense;
  /** 选项（已洗牌，含 1 正 + N-1 错） */
  options: readonly DistractorOption[];
}

export interface MultipleChoiceCardProps {
  question: MultipleChoiceQuestion;
  /** 已选中的选项下标（null = 未选择） */
  selectedIndex: number | null;
  onSelect(index: number): void;
}

export function MultipleChoiceCard({ question, selectedIndex, onSelect }: MultipleChoiceCardProps) {
  const { sense, options } = question;
  const containerRef = useRef<HTMLDivElement>(null);

  // 键盘快捷键 1–4
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      const onInteractive =
        target instanceof HTMLElement &&
        (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.isContentEditable);
      if (onInteractive) {
        return;
      }
      const num = parseInt(event.key, 10);
      if (num >= 1 && num <= options.length && selectedIndex === null) {
        event.preventDefault();
        onSelect(num - 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [options.length, selectedIndex, onSelect]);

  return (
    <div ref={containerRef} className="flex flex-col gap-4">
      {/* 词条标题 */}
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-6 text-center">
        <span className="text-4xl font-bold tracking-tight sm:text-5xl">{sense.term}</span>
        {sense.pos ? (
          <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-sm text-text-muted">
            {sense.pos}
          </span>
        ) : null}
        <span className="text-sm text-text-muted">选择正确的释义</span>
      </div>

      {/* 选项列表 */}
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={`${sense.term} 的释义选择`}>
        {options.map((option, index) => (
          <OptionButton
            key={`${index}:${option.text}`}
            index={index}
            option={option}
            disabled={selectedIndex !== null}
            selected={selectedIndex === index}
            revealed={selectedIndex !== null}
            onSelect={() => onSelect(index)}
          />
        ))}
      </div>
    </div>
  );
}

interface OptionButtonProps {
  index: number;
  option: DistractorOption;
  disabled: boolean;
  selected: boolean;
  revealed: boolean;
  onSelect(): void;
}

function OptionButton({ index, option, disabled, selected, revealed, onSelect }: OptionButtonProps) {
  let stateClass = "border-border hover:border-primary";
  if (revealed && option.isCorrect) {
    stateClass = "border-success bg-success/10";
  } else if (revealed && selected && !option.isCorrect) {
    stateClass = "border-danger bg-danger/10";
  } else if (selected) {
    stateClass = "border-primary bg-primary/10";
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      onClick={onSelect}
      disabled={disabled}
      className={`relative flex min-h-12 items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-default sm:min-h-14 ${stateClass}`}
    >
      <kbd className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-surface-raised text-xs font-medium text-text-muted">
        {index + 1}
      </kbd>
      <span className="flex-1">{option.text}</span>
      {revealed && option.isCorrect ? (
        <span aria-label="正确" className="text-lg text-success">
          ✓
        </span>
      ) : null}
      {revealed && selected && !option.isCorrect ? (
        <span aria-label="错误" className="text-lg text-danger">
          ✗
        </span>
      ) : null}
    </button>
  );
}
