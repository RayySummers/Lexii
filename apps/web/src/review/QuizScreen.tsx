/**
 * 选择题界面：会话容器。
 *
 * 复用 ReviewScreen 的阶段结构（loading / empty / no-due / error / done），
 * 区别在于 quizzing 阶段渲染 MultipleChoiceCard 而非翻转卡片。
 *
 * 键盘快捷键：1–4 选择选项（与 MultipleChoiceCard 内的监听一致）。
 */
import type { StudyMode } from "@lexilexi/core";
import { BackArrowIcon } from "../components/icons";
import { readDailyNewCardLimit } from "../lib/dailyNewCardLimit";
import { MultipleChoiceCard } from "./MultipleChoiceCard";
import { useMultipleChoiceSession } from "./useMultipleChoiceSession";
import type { ReviewDataProvider } from "./types";

export interface QuizScreenProps {
  provider: ReviewDataProvider;
  /** 学习模式（学习 / 复习 / 混合），决定队列与空状态文案 */
  mode: StudyMode;
  onExit(): void;
}

/** 队列为空时的按模式文案（复用 ReviewScreen 口径） */
const NO_QUEUE_COPY: Record<StudyMode, { title: string; body: string }> = {
  review: {
    title: "今天没有到期的词",
    body: "到期队列已清空。新的卡片会在复习间隔到达后进入队列；想学新词请返回首页选择「学习」。",
  },
  learn: {
    title: "没有待学习的新词",
    body: "词库里没有从未学过的新词。返回首页试试「复习」或「混合」模式。",
  },
  mixed: {
    title: "今天没有可复习的词",
    body: "今天没有到期词，也没有待学习的新词。休息一下，或返回首页换一种模式。",
  },
};

/** 每日新卡额度耗尽时的空状态文案（RAY-276 诊断线 3，与 ReviewScreen 同口径） */
function quotaExhaustedCopy(
  mode: StudyMode,
  limit: number,
): { title: string; body: string } | null {
  if (mode === "review") {
    return null;
  }
  return mode === "learn"
    ? {
        title: "今日新词额度已用完",
        body: `每日新词上限 ${limit} 张已经学完，剩余新词顺延到明天。想继续学习请返回首页试试「复习」或「混合」模式。`,
      }
    : {
        title: "今日新词额度已用完",
        body: `今天没有到期的复习卡，每日新词上限 ${limit} 张也已学完。休息一下，明天再来。`,
      };
}

export function QuizScreen({ provider, mode, onExit }: QuizScreenProps) {
  const session = useMultipleChoiceSession(provider, mode);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          aria-label="返回首页"
          className="rounded-full border border-border bg-surface p-2.5 text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <BackArrowIcon className="h-5 w-5" />
        </button>
        {session.phase === "quizzing" ? (
          <span
            role="status"
            aria-label={`进度 ${session.index + 1} / ${session.totalCount}`}
            className="text-sm text-text-muted"
          >
            {session.index + 1} / {session.totalCount} · 已答 {session.answeredCount}
          </span>
        ) : null}
      </div>

      <PhaseContent session={session} mode={mode} onExit={onExit} />
    </main>
  );
}

interface PhaseContentProps {
  session: ReturnType<typeof useMultipleChoiceSession>;
  mode: StudyMode;
  onExit(): void;
}

function PhaseContent({ session, mode, onExit }: PhaseContentProps) {
  switch (session.phase) {
    case "loading":
      return (
        <div role="status" className="py-16 text-center text-text-muted">
          正在加载选择题…
        </div>
      );
    case "empty":
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">词库还是空的</h2>
          <p className="max-w-sm text-sm text-text-muted">
            还没有任何需要学习的词。先导入词表，再回来做选择题。
          </p>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            返回首页
          </button>
        </div>
      );
    case "no-due": {
      const copy =
        (session.newCardQuotaExhausted
          ? quotaExhaustedCopy(mode, readDailyNewCardLimit())
          : null) ?? NO_QUEUE_COPY[mode];
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">{copy.title}</h2>
          <p className="max-w-sm text-sm text-text-muted">{copy.body}</p>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            返回首页
          </button>
        </div>
      );
    }
    case "error":
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-danger/40 bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">加载失败</h2>
          <p className="max-w-sm text-sm text-text-muted">{session.error}</p>
          <button
            type="button"
            onClick={session.retry}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            重试
          </button>
        </div>
      );
    case "done":
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">
            {mode === "learn" ? "本轮学习完成" : "本轮练习完成"}
          </h2>
          <p className="text-sm text-text-muted">共完成 {session.answeredCount} 道选择题</p>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            返回首页
          </button>
        </div>
      );
    case "quizzing":
      if (!session.current) {
        return null;
      }
      return (
        <>
          <MultipleChoiceCard
            question={session.current}
            selectedIndex={session.selectedIndex}
            onSelect={session.select}
          />
          <p className="text-center text-xs text-text-muted">按 1–4 选择答案</p>
        </>
      );
  }
}
