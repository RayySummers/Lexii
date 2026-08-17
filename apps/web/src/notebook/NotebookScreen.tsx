/**
 * 生词本页面（RAY-284）：查看与移出已加词条。
 *
 * - 列表：词条 + 词性/音标 + 释义，最新加入在前；
 * - 移出：两步确认（移出 → 确认移出）——移出会软删除该词在生词本的
 *   学习条目（不可逆，学习记录保留在事件流但词不再进队列），词书中的
 *   同词条目不受影响；
 * - 状态机：加载中 → 空（引导去搜词页/复习卡页加词）→ 列表 → 错误
 *   （友好文案 + 原始信息折叠，与统计页同一模式）；
 * - 加词入口不在本页（搜词页结果行与复习卡页工具栏），页面只在入口
 *   处提示；
 * - 全部颜色走 design tokens（浅色/深色自动生效），不硬编码颜色。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotebookEntryId } from "@lexilexi/core";
import { ScreenHeader } from "../components/ScreenHeader";
import type { NotebookDataProvider, NotebookListItem } from "./types";

export interface NotebookScreenProps {
  provider: NotebookDataProvider;
  /** 返回上一页 */
  onExit(): void;
}

/** 数据源错误 → 原始错误信息（仅供「错误详情」折叠区展示；主提示为固定友好文案） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type LoadPhase = "loading" | "ready" | "error";

export function NotebookScreen({ provider, onExit }: NotebookScreenProps) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [entries, setEntries] = useState<NotebookListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 两步确认移出：当前待确认的条目 id（null = 无待确认）
  const [confirmingId, setConfirmingId] = useState<NotebookEntryId | null>(null);
  // 移出操作进行中的条目 id（防连按）
  const [removingId, setRemovingId] = useState<NotebookEntryId | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  /**
   * 加载生词本列表：过期加载经序号丢弃（与搜词页同口径）。
   * 所有 setState 都在 promise 回调内（不在 effect 同步路径上）。
   */
  const runLoad = useCallback(() => {
    const seq = ++loadSeqRef.current;
    void provider
      .loadEntries()
      .then((loaded) => {
        if (loadSeqRef.current !== seq) {
          return;
        }
        setError(null);
        setEntries(loaded);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (loadSeqRef.current !== seq) {
          return;
        }
        setError(toErrorMessage(err));
        setPhase("error");
      });
  }, [provider]);

  useEffect(() => {
    runLoad();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [runLoad]);

  const handleRemove = useCallback(
    async (entryId: NotebookEntryId) => {
      if (removingId !== null) {
        return;
      }
      setRemoveError(null);
      setRemovingId(entryId);
      try {
        await provider.removeWord(entryId);
        setConfirmingId(null);
        runLoad();
      } catch (err: unknown) {
        setRemoveError(toErrorMessage(err));
      } finally {
        setRemovingId(null);
      }
    },
    [provider, runLoad, removingId],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="生词本" onBack={onExit} />

      {phase === "loading" ? (
        <div role="status" className="py-16 text-center text-sm text-text-muted">
          正在加载生词本…
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface p-6">
          <p role="alert" className="text-sm">
            生词本暂时无法加载，请稍后重试。
          </p>
          <details className="text-xs text-text-muted">
            <summary>错误详情</summary>
            <p className="mt-1 whitespace-pre-wrap">{error}</p>
          </details>
          <button
            type="button"
            onClick={runLoad}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            重试
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">生词本还是空的</h2>
          <p className="max-w-sm text-sm text-text-muted">
            在搜词页的结果上点「加词」，或在复习卡页点「加词」，就能把想重点掌握的词收进这里。
            加入后可在设置页开关「学习列表包含生词本」，决定它们是否进入学习队列。
          </p>
        </div>
      ) : (
        <>
          <p role="status" className="text-sm text-text-muted">
            共 {entries.length} 个词
          </p>
          <ul className="flex flex-col gap-3">
            {entries.map(({ entry, sense }) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4"
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-lg font-semibold">{sense.term}</span>
                  {sense.pos ? <span className="text-xs text-text-muted">{sense.pos}</span> : null}
                  {sense.ipa ? (
                    <span className="text-xs text-text-muted">/{sense.ipa}/</span>
                  ) : null}
                </span>
                <p className="text-sm leading-relaxed text-text-muted">
                  {sense.definitions.join("；")}
                </p>
                <div className="flex items-center justify-end gap-2">
                  {confirmingId === entry.id ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">移出后进度不再计入学习列表</span>
                      <button
                        type="button"
                        onClick={() => void handleRemove(entry.id)}
                        disabled={removingId !== null}
                        className="rounded-full bg-danger px-4 py-1.5 text-xs font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {removingId === entry.id ? "移出中…" : "确认移出"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={removingId !== null}
                        className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRemoveError(null);
                        setConfirmingId(entry.id);
                      }}
                      aria-label={`把「${sense.term}」移出生词本`}
                      className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      移出
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {removeError ? (
        <p role="alert" className="text-center text-xs text-text-muted">
          移出失败：{removeError}
        </p>
      ) : null}
    </main>
  );
}
