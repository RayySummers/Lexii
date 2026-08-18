/**
 * 自定义单词列表管理页（RAY-325）：用户创建 / 编辑 / 删除自己的词单，
 * 进入详情页查看 / 移出词条。
 *
 * 设计参照词书库（WordbookLibraryScreen，RAY-262）与生词本
 * （NotebookScreen，RAY-284）的视觉与状态机口径：
 * - 顶部概览：列表数 / 词条数（跨列表独立计，与 RAY-288 词书库同口径）；
 * - 列表卡片：名称 + 描述 + 词条数 + 最近加入时刻；
 * - 创建：内联输入框（不弹窗，符合 lexii 简洁节奏）；
 * - 编辑：行内修改（点击卡片右上角编辑图标展开编辑区）；
 * - 删除：二次确认对话框（与词书删除同模式，RAY-320）；
 * - 状态机：加载中 → 列表 → 空（引导创建）→ 错误（友好文案 + 原始信息折叠）；
 * - 全部颜色走 design tokens（浅色 / 深色自动生效），不硬编码颜色。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomList, CustomListId } from "@lexii/core";
import { ScreenHeader } from "../components/ScreenHeader";
import { EditIcon, PlusIcon, TrashIcon } from "../components/icons";
import type { CustomListSummaryItem, CustomListsDataProvider } from "./types";

export interface CustomListsScreenProps {
  provider: CustomListsDataProvider;
  /** 返回上一页 */
  onExit(): void;
  /** 进入列表详情（查看 / 移出词条） */
  onOpenList(id: CustomListId): void;
}

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 千分位格式化（与词书库同口径） */
const WORD_COUNT_FORMATTER = new Intl.NumberFormat("zh-CN");

/** ISO 时间戳 → 简短本地化展示（YYYY/M/D，无小时分钟，避免误导） */
function formatDate(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}/${month}/${day}`;
}

type LoadPhase = "loading" | "ready" | "error";

/** 新建列表表单状态机（RAY-325 评审 nit 2：原 creating / creating2 双布尔合并） */
type CreateFormPhase = "hidden" | "editing" | "submitting";

export function CustomListsScreen({ provider, onExit, onOpenList }: CustomListsScreenProps) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [summaries, setSummaries] = useState<CustomListSummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 创建表单状态：hidden（收起）/ editing（展开输入）/ submitting（提交中）
  const [createForm, setCreateForm] = useState<CreateFormPhase>("hidden");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  // 编辑中的列表 id（null = 无编辑）
  const [editingId, setEditingId] = useState<CustomListId | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  // 删除二次确认（与词书删除同模式，RAY-320）
  const [confirmDelete, setConfirmDelete] = useState<CustomList | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadSeqRef = useRef(0);

  const refresh = useCallback(() => {
    const seq = ++loadSeqRef.current;
    void provider
      .loadSummaries()
      .then((loaded) => {
        if (loadSeqRef.current !== seq) {
          return;
        }
        setError(null);
        setSummaries(loaded);
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
    refresh();
  }, [refresh]);

  const startCreate = useCallback(() => {
    setCreateForm("editing");
    setNewName("");
    setNewDescription("");
    setCreateError(null);
  }, []);

  const cancelCreate = useCallback(() => {
    setCreateForm("hidden");
    setNewName("");
    setNewDescription("");
    setCreateError(null);
  }, []);

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    const description = newDescription.trim();
    if (name.length === 0) {
      setCreateError("列表名称不能为空");
      return;
    }
    if (name.length > 60) {
      setCreateError("列表名称不能超过 60 个字符");
      return;
    }
    if (description.length > 200) {
      setCreateError("列表描述不能超过 200 个字符");
      return;
    }
    setCreateForm("submitting");
    setCreateError(null);
    try {
      await provider.createList({ name, description });
      setCreateForm("hidden");
      setNewName("");
      setNewDescription("");
      setNotice("已创建列表。");
      await refresh();
    } catch (err: unknown) {
      setCreateError(toErrorMessage(err));
      setCreateForm("editing");
    }
  }, [newName, newDescription, provider, refresh]);

  const startEdit = useCallback((list: CustomList) => {
    setEditingId(list.id);
    setEditName(list.name);
    setEditDescription(list.description);
    setEditError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditError(null);
  }, []);

  const submitEdit = useCallback(async () => {
    if (editingId === null) {
      return;
    }
    const name = editName.trim();
    const description = editDescription.trim();
    if (name.length === 0) {
      setEditError("列表名称不能为空");
      return;
    }
    if (name.length > 60) {
      setEditError("列表名称不能超过 60 个字符");
      return;
    }
    if (description.length > 200) {
      setEditError("列表描述不能超过 200 个字符");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      await provider.updateList({ id: editingId, name, description });
      setEditingId(null);
      setNotice("已更新列表。");
      await refresh();
    } catch (err: unknown) {
      setEditError(toErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }, [editingId, editName, editDescription, provider, refresh]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      return;
    }
    const id = confirmDelete.id;
    setDeleting(true);
    setError(null);
    try {
      await provider.deleteList(id);
      setConfirmDelete(null);
      setNotice("列表已删除。词条记录保留为历史。");
      await refresh();
    } catch (err: unknown) {
      setError(`删除失败：${toErrorMessage(err)}`);
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, provider, refresh]);

  // 顶部概览：列表数 + 跨列表独立词条数（与 RAY-288 同口径）
  const totalLists = summaries.length;
  const totalWords = summaries.reduce((sum, summary) => sum + summary.entryCount, 0);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="自定义词单" onBack={onExit} />

      <p className="text-sm text-text-muted">
        创建你自己的词单，把散落的词条按主题归类（如「工作中常用」「阅读里遇过」）。
        同一个词可以归入多个列表；列表不参与学习调度，仅作词条的收藏与组织。
      </p>

      <section aria-label="我的列表概览" className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-text-muted">列表总数</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {phase === "ready" ? `${totalLists} 个` : "…"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-text-muted">词条总数</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {phase === "ready" ? WORD_COUNT_FORMATTER.format(totalWords) : "…"}
          </p>
        </div>
      </section>

      {phase === "loading" ? (
        <div role="status" className="py-16 text-center text-sm text-text-muted">
          正在加载列表…
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-danger/40 bg-surface p-6">
          <p role="alert" className="text-sm">
            列表暂时无法加载，请稍后重试。
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
      ) : (
        <>
          {createForm !== "hidden" ? (
            <CreateForm
              name={newName}
              description={newDescription}
              error={createError}
              submitting={createForm === "submitting"}
              onNameChange={setNewName}
              onDescriptionChange={setNewDescription}
              onSubmit={() => void submitCreate()}
              onCancel={cancelCreate}
            />
          ) : summaries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center">
              <h2 className="text-xl font-semibold">还没有自定义列表</h2>
              <p className="max-w-sm text-sm text-text-muted">
                创建第一个列表，把零散的词条按你的主题归类。
                在复习卡或搜词页点「添加到列表」就能往里收词。
              </p>
              <button
                type="button"
                onClick={startCreate}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <PlusIcon className="h-4 w-4" />
                创建列表
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {summaries.map((summary) =>
                editingId === summary.list.id ? (
                  <EditForm
                    key={summary.list.id}
                    name={editName}
                    description={editDescription}
                    error={editError}
                    saving={savingEdit}
                    onNameChange={setEditName}
                    onDescriptionChange={setEditDescription}
                    onSubmit={() => void submitEdit()}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <ListCard
                    key={summary.list.id}
                    summary={summary}
                    onOpen={() => onOpenList(summary.list.id)}
                    onEdit={() => startEdit(summary.list)}
                    onDelete={() => setConfirmDelete(summary.list)}
                  />
                ),
              )}
            </div>
          )}

          {summaries.length > 0 && createForm === "hidden" ? (
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex w-fit items-center gap-1.5 self-start rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <PlusIcon className="h-4 w-4" />
              新建列表
            </button>
          ) : null}
        </>
      )}

      <div aria-live="polite">
        {error && phase !== "error" ? (
          <p role="alert" className="rounded-xl border border-danger/40 bg-surface p-4 text-sm">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="rounded-xl border border-border bg-surface p-4 text-sm text-success"
          >
            {notice}
          </p>
        ) : null}
      </div>

      {confirmDelete !== null ? (
        <ConfirmDeleteDialog
          listName={confirmDelete.name}
          entryCount={
            summaries.find((summary) => summary.list.id === confirmDelete.id)?.entryCount ?? 0
          }
          deleting={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </main>
  );
}

interface ListCardProps {
  summary: CustomListSummaryItem;
  onOpen(): void;
  onEdit(): void;
  onDelete(): void;
}

function ListCard({ summary, onOpen, onEdit, onDelete }: ListCardProps) {
  const { list, entryCount, latestAddedAt } = summary;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`打开列表「${list.name}」`}
        className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-base font-semibold">{list.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-text-muted">{entryCount} 词</span>
          </span>
          {list.description ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-text-muted">
              {list.description}
            </p>
          ) : null}
          {latestAddedAt ? (
            <p className="text-xs text-text-muted">最近加入 {formatDate(latestAddedAt)}</p>
          ) : null}
        </div>
      </button>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`编辑列表「${list.name}」`}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <EditIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`删除列表「${list.name}」`}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface CreateFormProps {
  name: string;
  description: string;
  error: string | null;
  submitting: boolean;
  onNameChange(value: string): void;
  onDescriptionChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

function CreateForm({
  name,
  description,
  error,
  submitting,
  onNameChange,
  onDescriptionChange,
  onSubmit,
  onCancel,
}: CreateFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <span className="text-sm font-semibold">新建列表</span>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">名称（必填，1–60 字）</span>
        <input
          type="text"
          value={name}
          maxLength={60}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="如：阅读常见词"
          autoFocus
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">描述（可选，≤ 200 字）</span>
        <textarea
          value={description}
          maxLength={200}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="说明列表的主题 / 场景"
          rows={2}
          className="resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "创建中…" : "创建"}
        </button>
      </div>
    </form>
  );
}

interface EditFormProps {
  name: string;
  description: string;
  error: string | null;
  saving: boolean;
  onNameChange(value: string): void;
  onDescriptionChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

function EditForm({
  name,
  description,
  error,
  saving,
  onNameChange,
  onDescriptionChange,
  onSubmit,
  onCancel,
}: EditFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <span className="text-sm font-semibold">编辑列表</span>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">名称</span>
        <input
          type="text"
          value={name}
          maxLength={60}
          onChange={(event) => onNameChange(event.target.value)}
          autoFocus
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">描述</span>
        <textarea
          value={description}
          maxLength={200}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={2}
          className="resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}

interface ConfirmDeleteDialogProps {
  listName: string;
  entryCount: number;
  deleting: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** 删除确认对话框（与词书删除同模式，RAY-320）：醒目提示词条记录保留 */
function ConfirmDeleteDialog({
  listName,
  entryCount,
  deleting,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  // ESC 键关闭
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="确认删除列表"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden="true" />
      <div className="relative flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-lg">
        <h3 className="text-base font-semibold">确认删除列表</h3>
        <p className="text-sm text-text-muted">
          确定要删除「{listName}」吗？该列表当前包含 {entryCount} 个词。
        </p>
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-medium text-warning">
            列表与词条的归类记录将被移除，但词条本身不会被删除，仍在词库中可搜可用。
          </p>
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
