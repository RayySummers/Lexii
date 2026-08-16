/**
 * 复习界面：会话容器。
 *
 * - 挂载即加载到期队列（useReviewSession），按阶段渲染 加载 / 复习 / 完成 /
 *   空状态（无词导入 / 今日无到期）/ 错误重试；
 * - 键盘快捷键（等价于按钮，满足验收点 3）：
 *     空格 / 回车 → 翻面（焦点在按钮上时交给按钮原生行为，避免双触发）
 *     三档（默认）：1–3 或 A / H / G → 不认识 / 模糊 / 认识
 *     四档（Anki 传统）：1–4 或 A / H / G / E → Again / Hard / Good / Easy
 * - 评分按钮副文案为各档到期时间预览（@lexilexi/fsrs Scheduler.preview）。
 *
 * RAY-265：
 * - 评分档位默认三档（认识 / 模糊 / 不认识），设置内可切四档；
 * - 工具栏提供「发音」（浏览器语音合成，美/英口音随设置）与「标熟」
 *   （词保留词书、按已熟长间隔调度）；
 * - 每次评分 / 标熟后可单步撤销（连续只能撤销一次，不可连退）。
 *
 * RAY-280：导出备份入口已从本页移到设置页（真机反馈），本页不再提供
 * 导出按钮，导出功能本身不变（设置页仍导出完整可恢复 JSON）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SAMPLE_WORDLIST_ROW_COUNT } from "@lexilexi/core";
import type { ReviewRating, StudyMode } from "@lexilexi/core";
import { BackArrowIcon, SpeakerIcon, UndoIcon } from "../components/icons";
import { readPronunciationAccent, speakWord } from "../lib/pronunciation";
import { readRatingTierMode } from "../lib/ratingTiers";
import type { RatingTierMode } from "../lib/ratingTiers";
import { ReviewCard } from "./ReviewCard";
import { RatingButtons } from "./RatingButtons";
import { formatDueLabel, previewGradeDueLabels, ratingFromKey } from "./grade";
import type { ReviewCard as ReviewCardData, ReviewDataProvider } from "./types";
import { useReviewSession, type ReviewSession } from "./useReviewSession";

export interface ReviewScreenProps {
  provider: ReviewDataProvider;
  /** 学习模式（学习 / 复习 / 混合），决定队列与空状态文案 */
  mode: StudyMode;
  onExit(): void;
}

/** 队列为空（有词但当前模式无可复习内容）时的按模式文案 */
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

/** 当前卡评分的到期文案（预览计算轻量，无需 memo） */
function computeDueLabels(card: ReviewCardData): Record<ReviewRating, string> {
  const now = new Date();
  const preview = previewGradeDueLabels(card.memory.fields, now);
  return {
    again: formatDueLabel(preview.again, now),
    hard: formatDueLabel(preview.hard, now),
    good: formatDueLabel(preview.good, now),
    easy: formatDueLabel(preview.easy, now),
  };
}

/** 背面评分快捷键提示（随档位模式切换） */
function ratingHintFor(mode: RatingTierMode): string {
  return mode === "three" ? "按 1–3（或 A / H / G）评分" : "按 1–4（或 A / H / G / E）评分";
}

export function ReviewScreen({ provider, mode, onExit }: ReviewScreenProps) {
  const session = useReviewSession(provider, mode);
  const dueLabels = session.current ? computeDueLabels(session.current) : null;
  // 评分档位（RAY-265）：会话内固定读取一次；改设置后下次进入复习生效
  const [tierMode] = useState<RatingTierMode>(() => readRatingTierMode());
  const [speakNotice, setSpeakNotice] = useState<string | null>(null);
  // 朗读目标经 ref 读取（session 每次渲染换身份，useCallback 依赖其字段会
  // 让回调每次重建；ref 与提交同步即可保证点击时读到当前卡）
  const currentCardRef = useRef(session.current);

  /** 朗读当前词条（浏览器语音合成，口音随设置；不支持时给出一次性提示） */
  const handleSpeak = useCallback(() => {
    const card = currentCardRef.current;
    if (!card) {
      return;
    }
    if (!speakWord(card.sense.term, readPronunciationAccent())) {
      setSpeakNotice("当前浏览器不支持语音合成，无法发音。");
    }
  }, []);

  // 键盘监听：监听器生命周期与组件绑定（空依赖），阶段与回调经 ref 读取。
  // 之前依赖 [phase] 会在阶段切换时移除/重挂监听——重挂窗口内（或闭包
  // 捕获到旧 phase 时）按键会被静默吞掉；按键状态本身由 session 状态机守卫，
  // 监听器不需要随阶段重建（RAY-239 测试补全发现的竞态）。
  const { flip, grade } = session;
  const phaseRef = useRef(session.phase);
  const flipRef = useRef(flip);
  const gradeRef = useRef(grade);
  const tierModeRef = useRef(tierMode);

  // 每次提交后同步 ref（react-hooks/refs 禁止渲染期写 ref；useLayoutEffect
  // 在 DOM 提交后、浏览器绘制前同步执行——用户键盘事件派发前 ref 必然已
  // 更新，把「重挂窗口内按键读到旧状态」的理论窗口压到零。Oscar 评审
  // suggestion 采纳：useEffect 在绘制后异步执行，理论上存在绘制与 effect
  // 之间的空隙；键盘输入路径改 useLayoutEffect 后无此窗口）。
  useLayoutEffect(() => {
    phaseRef.current = session.phase;
    flipRef.current = flip;
    gradeRef.current = grade;
    tierModeRef.current = tierMode;
    currentCardRef.current = session.current;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      const onInteractive =
        target instanceof HTMLElement &&
        (target.tagName === "BUTTON" ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === " " || event.key === "Enter") {
        if (onInteractive) {
          return; // 焦点在按钮上：交给按钮原生激活，避免重复触发
        }
        if (phaseRef.current === "reviewing") {
          event.preventDefault();
          flipRef.current();
        }
        return;
      }
      const rating = ratingFromKey(event.key, tierModeRef.current);
      if (rating && phaseRef.current === "reviewing") {
        event.preventDefault();
        void gradeRef.current(rating);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        <div className="flex items-center gap-3">
          {session.phase === "reviewing" ? (
            <span
              role="status"
              aria-label={`进度 ${session.index + 1} / ${session.totalCount}，剩余 ${session.totalCount - session.index - 1}`}
              className="text-sm text-text-muted"
            >
              {session.index + 1} / {session.totalCount} · 剩余{" "}
              {session.totalCount - session.index - 1}
            </span>
          ) : null}
        </div>
      </div>

      <PhaseContent
        session={session}
        dueLabels={dueLabels}
        mode={mode}
        tierMode={tierMode}
        onSpeak={handleSpeak}
        speakNotice={speakNotice}
        onExit={onExit}
      />
    </main>
  );
}

interface PhaseContentProps {
  session: ReviewSession;
  dueLabels: Record<ReviewRating, string> | null;
  mode: StudyMode;
  /** 评分档位模式（三档默认 / 四档 Anki 传统） */
  tierMode: RatingTierMode;
  /** 朗读当前词条 */
  onSpeak(): void;
  /** 发音不可用的提示（null = 无提示） */
  speakNotice: string | null;
  onExit(): void;
}

/** 按会话阶段渲染对应内容（独立于容器，便于逐阶段阅读） */
function PhaseContent({
  session,
  dueLabels,
  mode,
  tierMode,
  onSpeak,
  speakNotice,
  onExit,
}: PhaseContentProps) {
  switch (session.phase) {
    case "loading":
      return (
        <div role="status" className="py-16 text-center text-text-muted">
          正在加载复习队列…
        </div>
      );
    case "empty":
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">词库还是空的</h2>
          <p className="max-w-sm text-sm text-text-muted">
            还没有任何需要学习的词。导入你自己的 CSV 词表，或先导入内置示例词表体验完整的学习流程。
          </p>
          <button
            type="button"
            onClick={() => void session.importSample()}
            disabled={session.importing}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {session.importing
              ? "正在导入…"
              : `导入内置示例词表（${SAMPLE_WORDLIST_ROW_COUNT} 词）`}
          </button>
        </div>
      );
    case "no-due": {
      const copy = NO_QUEUE_COPY[mode];
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
            {mode === "learn" ? "本轮学习完成" : "本轮复习完成"}
          </h2>
          <p className="text-sm text-text-muted">
            {mode === "learn"
              ? `共学习 ${session.gradedCount} 张卡片`
              : `共复习 ${session.gradedCount} 张卡片`}
          </p>
          {session.canUndo ? <UndoButton onUndo={() => void session.undo()} /> : null}
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            返回首页
          </button>
        </div>
      );
    case "reviewing":
      if (!session.current || !dueLabels) {
        return null;
      }
      return (
        <>
          <ReviewCard
            sense={session.current.sense}
            flipped={session.flipped}
            onFlip={session.flip}
            ratingHint={ratingHintFor(tierMode)}
          />
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onSpeak}
              aria-label={`朗读 ${session.current.sense.term} 的发音`}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <SpeakerIcon className="h-4 w-4" />
              发音
            </button>
            <button
              type="button"
              onClick={() => void session.markMastered()}
              aria-label="标熟：这个词我已掌握，按很长的间隔以后再复习（词仍在词书中）"
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition-colors hover:border-success hover:bg-success/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span aria-hidden="true" className="text-base leading-none text-success">
                熟
              </span>
              标熟
            </button>
          </div>
          <RatingButtons
            dueLabels={dueLabels}
            mode={tierMode}
            onGrade={(rating) => void session.grade(rating)}
          />
          {speakNotice ? (
            <p role="status" className="text-center text-xs text-text-muted">
              {speakNotice}
            </p>
          ) : null}
          {session.canUndo ? <UndoButton onUndo={() => void session.undo()} /> : null}
          <p className="text-center text-xs text-text-muted">
            空格翻面 ·{" "}
            {tierMode === "three"
              ? "数字键 1–3 或字母 A / H / G 评分"
              : "数字键 1–4 或字母 A / H / G / E 评分"}
          </p>
        </>
      );
  }
}

/** 单步撤销按钮（每次评分 / 标熟后可见；撤销成功后消失，不可连退） */
function UndoButton({ onUndo }: { onUndo(): void }) {
  return (
    <button
      type="button"
      onClick={onUndo}
      className="flex w-fit items-center gap-1.5 self-center rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <UndoIcon className="h-4 w-4" />
      撤销上一步
    </button>
  );
}
