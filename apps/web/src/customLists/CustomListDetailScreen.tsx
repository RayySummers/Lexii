/**
 * 自定义列表详情页（RAY-325）：查看列表下的词条、逐条移出。
 *
 * 沿用生词本页（NotebookScreen，RAY-284）的视觉与状态机口径：
 * - 列表：词条 + 词性 / 音标 + 释义，最新加入在前；
 * - 移出：两步确认（移出 → 确认移出）——移出会软删除该词在列表中的
 *   归类条目（不可逆，记录保留为历史），列表中的其他词与其他列表不受影响；
 * - 状态机：加载中 → 列表 → 空（引导去复习/搜词页加词）→ 错误；
 * - RAY-338 A1：词条本体（sense.term）应用设置里的卡片字体（CSS 变量
 *   --lex-card-font / --lex-card-font-weight，与复习卡同口径）；
 * - 全部颜色走 design tokens（浅色 / 深色自动生效），不硬编码颜色。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomList, CustomListEntryId, CustomListId } from "@lexii/core";
import { ScreenHeader } from "../components/ScreenHeader";
import type { CustomListDetailItem, CustomListsDataProvider } from "./types";

export interface CustomListDetailScreenProps {
  provider: CustomListsDataProvider;
  /** 返回列表管理页 */
  onExit(): void;
  /** 列表 id（按此读元数据与条目） */
  listId: CustomListId;
}

type LoadPhase = "loading" | "ready" | "error";

export function CustomListDetailScreen({ provider, onExit, listId }: CustomListDetailScreenProps) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [list, setList] = useState<CustomList | null>(null);
  const [items, setItems] = useState<CustomListDetailItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<CustomListEntryId | null>(null);
  const [removingId, setRemovingId] = useState<CustomListEntryId | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    void Promise.all([provider.getList(listId), provider.loadListEntries(listId)])
      .then(([meta, entries]) => {
        if (loadSeqRef.current !== seq) {
          return;
        }
        if (!meta) {
          setError("词单不存在或已被删除");
          setPhase("error");
          return;
        }
        setError(null);
        setList(meta);
        setItems(entries);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (loadSeqRef.current !== seq) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
  }, [provider, listId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRemove = useCallback(
    async (entryId: CustomListEntryId) => {
      if (removingId !== null) {
        return;
      }
      setRemoveError(null);
      setRemovingId(entryId);
      try {
        await provider.removeWordFromList(entryId);
        setConfirmingId(null);
        await refresh();
      } catch (err: unknown) {
        setRemoveError(err instanceof Error ? err.message : String(err));
      } finally {
        setRemovingId(null);
      }
    },
    [provider, refresh, removingId],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title={list?.name ?? "词单详情"} onBack={onExit} backLabel="返回我的词单" />

      {phase === "loading" ? (
        <div role="status" className="py-16 text-center text-sm text-text-muted">
          正在加载词单…
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface p-6">
          <p role="alert" className="text-sm">
            词单暂时无法加载，请稍后重试。
          </p>
          <details className="text-xs text-text-muted">
            <summary>错误详情</summary>
            <p className="mt-1 whitespace-pre-wrap">{error}</p>
          </details>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold">这个词单还是空的</h2>
          <p className="max-w-sm text-sm text-text-muted">
            在复习卡或搜词页点「添加到词单」并勾选本词单，就能往里收词。
            同一个词可以同时归入多个词单。
          </p>
        </div>
      ) : (
        <>
          {list?.description ? <p className="text-sm text-text-muted">{list.description}</p> : null}
          <p role="status" className="text-sm text-text-muted">
            共 {items.length} 个词
          </p>
          <ul className="flex flex-col gap-3">
            {items.map(({ entry, sense }) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4"
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    className="text-lg"
                    style={{
                      fontFamily: "var(--lex-card-font)",
                      fontWeight: "var(--lex-card-font-weight)",
                    }}
                  >
                    {sense.term}
                  </span>
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
                      <span className="text-xs text-text-muted">移出后该词不再属于此词单</span>
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
                      aria-label={`把「${sense.term}」移出此词单`}
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
        <p role="alert" className="text-center text-xs text-danger">
          移出失败：{removeError}
        </p>
      ) : null}
    </main>
  );
}
