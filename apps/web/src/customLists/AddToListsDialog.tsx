/**
 * 「添加到列表」对话框（RAY-325）：复习页 / 搜词页共用。
 *
 * 设计要点：
 * - 取代原有「加词」按钮（背的都是词书或生词本里已有的词；改为多列表选择）；
 * - 多选 checkbox：默认勾选当前义项已加入的列表（反查 getCustomListsContainingSense）；
 * - 列表内创建：对话框底部内联一个「+ 新建列表」入口；
 * - 提交：批量加入 / 取消加入（不勾选 → 移出），单事务；
 * - 状态机：加载中 → 列表 → 提交中 → 完成（按 ESC / 点遮罩关闭）；
 * - 可达性：role=dialog + aria-modal + ESC 关闭；标题、控件全部可键盘访问；
 * - 全部颜色走 design tokens（浅色 / 深色自动生效），不硬编码颜色。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomList, CustomListId, Sense } from "@lexii/core";
import { CheckIcon, PlusIcon } from "../components/icons";
import type { AddToListsDataProvider } from "./types";

export interface AddToListsDialogProps {
  provider: AddToListsDataProvider;
  /** 目标义项（用于反查已加入的列表与批量加入 / 移出） */
  sense: Sense;
  /** 关闭对话框（取消 / 关闭按钮 / ESC / 遮罩点击） */
  onClose(): void;
}

type DialogPhase = "loading" | "ready" | "submitting";

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AddToListsDialog({ provider, sense, onClose }: AddToListsDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("loading");
  const [allLists, setAllLists] = useState<CustomList[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<CustomListId>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // 新建列表（对话框底部内联入口）
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating2, setCreating2] = useState(false);

  const refresh = useCallback(() => {
    void Promise.all([provider.listLists(), provider.getListsContainingSense(sense.id)])
      .then(([lists, containing]) => {
        setAllLists(lists);
        // 默认勾选：当前义项已加入的列表
        const initial = new Set<CustomListId>(containing.map((list) => list.id));
        setSelectedIds(initial);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        setError(toErrorMessage(err));
        setPhase("ready");
      });
  }, [provider, sense.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = useCallback((listId: CustomListId) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  }, []);

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (name.length === 0) {
      setCreateError("词单名称不能为空");
      return;
    }
    if (name.length > 60) {
      setCreateError("词单名称不能超过 60 个字符");
      return;
    }
    setCreating2(true);
    setCreateError(null);
    try {
      const newId = await provider.createListAndAdd(name, sense.id);
      setCreating(false);
      setNewName("");
      await refresh();
      // 自动勾选新建列表（用户期望「新建 + 加入」是一气呵成的动作）
      setSelectedIds((previous) => {
        const next = new Set(previous);
        next.add(newId);
        return next;
      });
    } catch (err: unknown) {
      setCreateError(toErrorMessage(err));
    } finally {
      setCreating2(false);
    }
  }, [newName, provider, refresh, sense.id]);

  const submit = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    try {
      // 反查当前已加入的列表，对比 selectedIds 计算 add / remove 集合
      const containing = await provider.getListsContainingSense(sense.id);
      const currentIds = new Set(containing.map((list) => list.id));
      const toAdd: CustomListId[] = [];
      const toRemove: CustomListId[] = [];
      for (const list of allLists) {
        const wasIn = currentIds.has(list.id);
        const isIn = selectedIds.has(list.id);
        if (!wasIn && isIn) toAdd.push(list.id);
        if (wasIn && !isIn) toRemove.push(list.id);
      }
      for (const listId of toAdd) {
        await provider.addWordToList(listId, sense.id);
      }
      for (const listId of toRemove) {
        await provider.removeWordFromList(listId, sense.id);
      }
      onClose();
    } catch (err: unknown) {
      setError(toErrorMessage(err));
      setPhase("ready");
    }
  }, [allLists, selectedIds, provider, sense.id, onClose]);

  // ESC 关闭
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const totalSelected = useMemo(() => selectedIds.size, [selectedIds]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`把「${sense.term}」添加到词单`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-lg">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold">添加到词单</h3>
            <p className="text-xs text-text-muted">
              勾选目标词单后保存。「{sense.term}」可同时归入多个词单。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭对话框"
            className="shrink-0 rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {phase === "loading" ? (
            <div role="status" className="py-8 text-center text-sm text-text-muted">
              正在加载词单…
            </div>
          ) : allLists.length === 0 && !creating ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-raised p-6 text-center">
              <p className="text-sm text-text-muted">还没有自定义词单，先创建一个吧。</p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <PlusIcon className="h-4 w-4" />
                新建词单
              </button>
            </div>
          ) : (
            <ul
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1.5"
              aria-label="候选词单"
            >
              {/* RAY-338 A2：p-1.5（6px）容纳选中卡片的 focus 描边
                  （outline-2 + outline-offset-2 = 边框外 4px）。overflow-y-auto 会把
                  overflow-x 强制为 auto，贴边卡片的外扩描边会被滚动容器裁掉，
                  只剩底边可见（描边残缺）。留出内边距后描边完整落在裁剪区内。 */}
              {allLists.map((list) => {
                const checked = selectedIds.has(list.id);
                return (
                  <li key={list.id}>
                    <label
                      className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring ${
                        checked
                          ? "border-primary bg-primary/5"
                          : "border-border bg-surface hover:border-primary"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(list.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        aria-label={`词单「${list.name}」`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{list.name}</span>
                        {list.description ? (
                          <span className="line-clamp-2 text-xs leading-relaxed text-text-muted">
                            {list.description}
                          </span>
                        ) : null}
                      </span>
                      {checked ? (
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {creating ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreate();
              }}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3"
            >
              <span className="text-xs font-medium text-text-muted">新建词单</span>
              <input
                type="text"
                value={newName}
                maxLength={60}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="词单名称"
                autoFocus
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              />
              {createError ? (
                <p role="alert" className="text-xs text-danger">
                  {createError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setCreateError(null);
                  }}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating2}
                  className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating2 ? "创建中…" : "创建并加入"}
                </button>
              </div>
            </form>
          ) : allLists.length > 0 ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex w-fit items-center gap-1.5 self-start rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              新建词单
            </button>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <span className="text-xs text-text-muted">
            {allLists.length === 0
              ? "无可勾选词单"
              : `已选 ${totalSelected} / ${allLists.length} 个词单`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={phase === "submitting" || allLists.length === 0}
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "submitting" ? "保存中…" : "保存"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
