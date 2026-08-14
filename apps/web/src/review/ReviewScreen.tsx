/**
 * 复习界面：会话容器。
 *
 * - 挂载即加载到期队列（useReviewSession），按阶段渲染 加载 / 复习 / 完成 /
 *   空状态（无词导入 / 今日无到期）/ 错误重试；
 * - 键盘快捷键（等价于按钮，满足验收点 3）：
 *     空格 / 回车 → 翻面（焦点在按钮上时交给按钮原生行为，避免双触发）
 *     1–4 或 A / H / G / E → Again / Hard / Good / Easy
 * - 评分按钮副文案为各档到期时间预览（@lexilexi/fsrs Scheduler.preview）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SAMPLE_WORDLIST_ROW_COUNT } from "@lexilexi/core";
import type { ReviewRating } from "@lexilexi/core";
import { datedFilename, downloadTextFile, serializeBackup } from "../lib/download";
import { ReviewCard } from "./ReviewCard";
import { RatingButtons } from "./RatingButtons";
import { formatDueLabel, previewGradeDueLabels, ratingFromKey } from "./grade";
import type { ReviewCard as ReviewCardData, ReviewDataProvider } from "./types";
import { useReviewSession, type ReviewSession } from "./useReviewSession";

export interface ReviewScreenProps {
  provider: ReviewDataProvider;
  onExit(): void;
}

/** 当前卡四档评分的到期文案（预览计算轻量，无需 memo） */
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

export function ReviewScreen({ provider, onExit }: ReviewScreenProps) {
  const session = useReviewSession(provider);
  const dueLabels = session.current ? computeDueLabels(session.current) : null;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const data = await provider.exportBackup();
      downloadTextFile(
        datedFilename("lexilexi-backup", "json"),
        serializeBackup(data),
        "application/json",
      );
      setExportNotice("已导出备份。");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [provider]);

  // 键盘监听：监听器生命周期与组件绑定（空依赖），阶段与回调经 ref 读取。
  // 之前依赖 [phase] 会在阶段切换时移除/重挂监听——重挂窗口内（或闭包
  // 捕获到旧 phase 时）按键会被静默吞掉；按键状态本身由 session 状态机守卫，
  // 监听器不需要随阶段重建（RAY-239 测试补全发现的竞态）。
  const { flip, grade } = session;
  const phaseRef = useRef(session.phase);
  const flipRef = useRef(flip);
  const gradeRef = useRef(grade);

  // 每次提交后同步 ref（react-hooks/refs 禁止渲染期写 ref；useLayoutEffect
  // 在 DOM 提交后、浏览器绘制前同步执行——用户键盘事件派发前 ref 必然已
  // 更新，把「重挂窗口内按键读到旧状态」的理论窗口压到零。Oscar 评审
  // suggestion 采纳：useEffect 在绘制后异步执行，理论上存在绘制与 effect
  // 之间的空隙；键盘输入路径改 useLayoutEffect 后无此窗口）。
  useLayoutEffect(() => {
    phaseRef.current = session.phase;
    flipRef.current = flip;
    gradeRef.current = grade;
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
      const rating = ratingFromKey(event.key);
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
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          返回首页
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
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? "导出中…" : "导出备份"}
          </button>
        </div>
      </div>

      {exportNotice ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-surface p-4 text-sm text-success"
        >
          {exportNotice}
        </p>
      ) : null}

      {exportError ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-surface p-4 text-sm text-text"
        >
          导出失败：{exportError}
        </p>
      ) : null}

      <PhaseContent session={session} dueLabels={dueLabels} onExit={onExit} />
    </main>
  );
}

interface PhaseContentProps {
  session: ReviewSession;
  dueLabels: Record<ReviewRating, string> | null;
  onExit(): void;
}

/** 按会话阶段渲染对应内容（独立于容器，便于逐阶段阅读） */
function PhaseContent({ session, dueLabels, onExit }: PhaseContentProps) {
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
            还没有任何需要复习的词。导入你自己的 CSV 词表，或先导入内置示例词表体验完整的复习流程。
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
    case "no-due":
      return (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">今天没有到期的词</h2>
          <p className="max-w-sm text-sm text-text-muted">
            到期队列已清空。新的卡片会在复习间隔到达后进入队列。
          </p>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            返回首页
          </button>
        </div>
      );
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
          <h2 className="text-xl font-semibold">本轮复习完成</h2>
          <p className="text-sm text-text-muted">共复习 {session.gradedCount} 张卡片</p>
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
          />
          <RatingButtons dueLabels={dueLabels} onGrade={(rating) => void session.grade(rating)} />
          <p className="text-center text-xs text-text-muted">
            空格翻面 · 数字键 1–4 或字母 A / H / G / E 评分
          </p>
        </>
      );
  }
}
