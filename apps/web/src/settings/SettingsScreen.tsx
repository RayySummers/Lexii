/**
 * 设置页：数据安全 + 数据概览 + 导出 / 导入（RAY-245）。
 *
 * - 数据安全：监听 `lexilexi:storage-permission` 事件（经 usePersistenceStatus），
 *   状态为 "denied" 时提示「当前数据可能被清理，建议导出」并提供直达导出入口；
 *   "unsupported" 环境静默降级、不提示（验收点 6）。
 * - 数据概览：词条数 / 复习次数 / 连续天数；无词库、无复习记录时有友好空状态。
 * - 导出：JSON 完整备份（可原样导回）+ CSV 词表（可经 importCsvWordlist 导回）。
 * - 导入：JSON 备份恢复（同 id 覆盖）；解析失败 / 版本不兼容有明确错误提示。
 *
 * 全部颜色走 design tokens（浅色/深色两套自动生效），不硬编码颜色。
 */
import { useCallback, useRef, useState } from "react";
import { StatCard } from "../components/StatCard";
import { datedFilename, downloadTextFile, serializeBackup } from "../lib/download";
import { usePersistenceStatus } from "./persistenceStatus";
import { useOverview } from "./useOverview";
import type { DataOverview, SettingsDataProvider } from "./types";

export interface SettingsScreenProps {
  provider: SettingsDataProvider;
  onExit(): void;
}

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取本地文件文本（FileReader 兼容 jsdom 与各浏览器） */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export function SettingsScreen({ provider, onExit }: SettingsScreenProps) {
  const persistence = usePersistenceStatus();
  const { overview, error: overviewError, reload: reloadOverview } = useOverview(provider);

  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJson = useCallback(async () => {
    setExporting("json");
    setError(null);
    setNotice(null);
    try {
      const data = await provider.exportBackup();
      downloadTextFile(
        datedFilename("lexilexi-backup", "json"),
        serializeBackup(data),
        "application/json",
      );
      setNotice("已导出 JSON 完整备份。");
    } catch (err) {
      setError(`导出失败：${toErrorMessage(err)}`);
    } finally {
      setExporting(null);
    }
  }, [provider]);

  const handleExportCsv = useCallback(async () => {
    setExporting("csv");
    setError(null);
    setNotice(null);
    try {
      const csv = await provider.exportWordlistCsv();
      downloadTextFile(datedFilename("lexilexi-wordlist", "csv"), csv, "text/csv;charset=utf-8");
      setNotice("已导出 CSV 词表。");
    } catch (err) {
      setError(`导出失败：${toErrorMessage(err)}`);
    } finally {
      setExporting(null);
    }
  }, [provider]);

  const handleImportFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setError(null);
      setNotice(null);
      try {
        const text = await readFileAsText(file);
        const result = await provider.importBackup(text);
        setNotice(
          `已恢复 ${result.items} 个词条、${result.senses} 个义项、${result.events} 条学习记录`,
        );
        reloadOverview();
      } catch (err) {
        setError(`导入失败：${toErrorMessage(err)}`);
      } finally {
        setImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = ""; // 允许重复选择同一文件
        }
      }
    },
    [provider, reloadOverview],
  );

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
      </div>

      <Section title="数据安全">
        <PersistenceBanner
          status={persistence}
          onExport={handleExportJson}
          exporting={exporting === "json"}
        />
      </Section>

      <Section title="数据概览">
        <Overview overview={overview} error={overviewError} onRetry={reloadOverview} />
      </Section>

      <Section title="导出数据">
        <p className="text-sm text-text-muted">
          学习数据只存本机（IndexedDB），可能因清理网站数据或卸载而丢失，建议定期导出备份。
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleExportJson()}
            disabled={exporting !== null}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting === "json" ? "导出中…" : "导出 JSON 完整备份"}
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting !== null}
            className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting === "csv" ? "导出中…" : "导出 CSV 词表"}
          </button>
        </div>
        <p className="text-xs text-text-muted">
          JSON 含词库、学习记录与进度，可原样导回；CSV 仅词表（词条 / 释义 / 词性），不含学习进度。
        </p>
      </Section>

      <Section title="导入数据">
        <p className="text-sm text-text-muted">
          从之前导出的 JSON 备份恢复数据（同 ID 记录会被覆盖）。
        </p>
        <input
          ref={fileInputRef}
          id="import-backup-input"
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleImportFile(file);
            }
          }}
        />
        <label
          htmlFor="import-backup-input"
          className="inline-flex w-fit cursor-pointer rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring"
        >
          {importing ? "正在恢复…" : "选择备份文件…"}
        </label>
      </Section>

      <div aria-live="polite">
        {notice ? (
          <p
            role="status"
            className="rounded-xl border border-border bg-surface p-4 text-sm text-success"
          >
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/40 bg-surface p-4 text-sm text-text"
          >
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** 设置分组容器 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** 持久化提示：denied 时警告并直达导出；persisted/granted 时静默确认；其余不渲染 */
function PersistenceBanner({
  status,
  onExport,
  exporting,
}: {
  status: ReturnType<typeof usePersistenceStatus>;
  onExport(): void;
  exporting: boolean;
}) {
  if (status === "denied") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-4">
        <p className="text-sm">当前数据可能被浏览器清理，建议导出备份。</p>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exporting ? "导出中…" : "导出 JSON 备份"}
        </button>
      </div>
    );
  }
  if (status === "persisted" || status === "granted") {
    return <p className="text-sm text-text-muted">本地数据已受浏览器持久化保护。</p>;
  }
  return null;
}

/** 数据概览：加载中 / 错误重试 / 空状态 / 统计卡片 */
function Overview({
  overview,
  error,
  onRetry,
}: {
  overview: DataOverview | null;
  error: string | null;
  onRetry(): void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-surface p-4">
        <p className="text-sm">无法读取本地数据：{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          重试
        </button>
      </div>
    );
  }
  if (!overview) {
    return (
      <p role="status" className="text-sm text-text-muted">
        正在加载…
      </p>
    );
  }
  if (overview.itemCount === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-center">
        <p className="text-sm">还没有学习数据。</p>
        <p className="mt-1 text-sm text-text-muted">
          去复习页导入内置示例词表，或在这里导入备份即可开始。
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard label="词条" value={String(overview.itemCount)} />
      <StatCard label="已复习" value={String(overview.reviewCount)} />
      <StatCard label="连续天数" value={String(overview.streakDays)} />
      {overview.reviewCount === 0 ? (
        <p className="col-span-3 text-xs text-text-muted">
          还没有复习记录，完成一次复习后这里会更新。
        </p>
      ) : null}
    </div>
  );
}
