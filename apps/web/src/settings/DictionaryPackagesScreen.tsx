/**
 * 扩展词包设置页（RAY-294 Tier 1/2 大词库联网下载、离线可用）。
 *
 * - 用户主动触发：仅进入本页时 fetchManifest（启动不联网）；
 * - 词包列表与状态：未装 / 已装 / 安装中（进度）/ covered（Tier 1 被 Tier 2 覆盖）；
 * - 下载确认界面：体积 + ECDICT MIT 许可展示；
 * - 下载/安装进度条（fetch + 落库两阶段）；
 * - 取消与错误提示（并发错误映射文档 §3.2 可读文案）；
 * - Tier 2 安装完成回调 markTier1CoveredByTier2。
 *
 * 文案：Vega 产出（RAY-326）；联网下载 / 离线可用口径与 RAY-304 一致。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DictionaryInstallStatus } from "@lexii/core";
import { ScreenHeader } from "../components/ScreenHeader";
import type {
  DictionaryManifestInfo,
  DictionaryPackageSummary,
  SettingsDataProvider,
} from "./types";

/** 安装状态轮询间隔（安装进行中时刷新进度） */
const POLL_INTERVAL_MS = 800;

/**
 * 简单 semver 比较：返回 -1（a < b）、0（a === b）、1（a > b）。
 * 仅处理 major.minor.patch，不含 pre-release/build。
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/** 包体积格式化（字节 → MB） */
function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 安装状态 → 中文徽标文案 */
function statusLabel(
  status: DictionaryInstallStatus,
  installedVersion?: string,
  manifestVersion?: string,
): string {
  switch (status) {
    case "installed": {
      if (
        installedVersion &&
        manifestVersion &&
        compareSemver(installedVersion, manifestVersion) < 0
      ) {
        return `可升级 v${manifestVersion}`;
      }
      return installedVersion ? `已安装 v${installedVersion}` : "已安装";
    }
    case "installing":
      return "安装中";
    case "not-installed":
      return "未安装";
    case "covered":
      return "已包含在全量词表中";
  }
}

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // 并发错误映射为文档 §3.2 可读文案
    if (error.name === "ConcurrentDictionaryInstallError") {
      return "另一标签页正在升级，请稍后重试";
    }
    // 安全上下文 / SHA-256 校验错误给出可读提示
    if (error.message.includes("crypto.subtle")) {
      return "当前环境不支持安全校验（需 HTTPS），请在安全页面重试";
    }
    if (error.message.includes("SHA-256")) {
      return "下载文件校验失败，可能是网络传输错误，请重试";
    }
    return error.message;
  }
  return String(error);
}

export interface DictionaryPackagesScreenProps {
  provider: SettingsDataProvider;
  /** 返回设置页 */
  onBack(): void;
}

/**
 * 下载确认对话框（模态）。
 * 展示包名称、体积、ECDICT MIT 许可声明，用户确认后开始下载。
 */
function DownloadConfirmDialog({
  packageName,
  sizeBytes,
  onConfirm,
  onCancel,
}: {
  packageName: string;
  sizeBytes?: number;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`确认下载 ${packageName}`}
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold">下载确认</h2>
        <div className="flex flex-col gap-2 text-sm text-text-muted">
          <p>
            即将下载<strong className="text-text"> {packageName}</strong>
            {sizeBytes ? `（${formatSize(sizeBytes)}）` : ""}。
          </p>
          <p>
            扩展词包数据来自
            <strong> ECDICT</strong>（MIT 许可，© 2025
            Linwei）。下载时需要联网，下载后可离线使用；不埋点。
          </p>
          <p>仅扩充检索层，不影响已有学习数据。</p>
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            确认下载
          </button>
        </div>
      </div>
    </div>
  );
}

export function DictionaryPackagesScreen({ provider, onBack }: DictionaryPackagesScreenProps) {
  const [summaries, setSummaries] = useState<DictionaryPackageSummary[] | null>(null);
  const [manifestInfos, setManifestInfos] = useState<DictionaryManifestInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 正在安装的包 id（按钮态 + 轮询续命）
  const [pendingInstalls, setPendingInstalls] = useState<ReadonlySet<string>>(new Set());
  // 每个 pending install 的 AbortController（用于取消）
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // 下载确认对话框（null = 不显示）
  const [confirmTarget, setConfirmTarget] = useState<DictionaryPackageSummary | null>(null);
  // manifest 加载中
  const [loadingManifest, setLoadingManifest] = useState(false);
  // 卸载保护
  const mountedRef = useRef(true);
  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      mountedRef.current = false;
      // 组件卸载时取消所有进行中的下载
      for (const controller of controllers.values()) {
        controller.abort();
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await provider.getDictionaryPackageSummaries();
    if (mountedRef.current) {
      setSummaries(result);
    }
  }, [provider]);

  // 首次进入：读本地安装状态 + fetch manifest（用户主动触发口径）
  useEffect(() => {
    let cancelled = false;

    // 两个请求独立处理：manifest 失败不应阻止本地状态加载
    async function load() {
      // 本地状态始终加载
      const localSummaries = await provider.getDictionaryPackageSummaries();
      if (cancelled) return;
      setSummaries(localSummaries);

      // manifest 可能失败（网络/文件不存在），错误展示在 UI 中
      try {
        const manifest = await provider.fetchDictionaryManifest();
        if (cancelled) return;
        setManifestInfos(manifest);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(toErrorMessage(err));
        }
      }
    }

    void load()
      .catch((err: unknown) => {
        // getDictionaryPackageSummaries 失败（IDB 异常等）
        if (!cancelled) {
          setError(toErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) {
          setLoadingManifest(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // 安装进行中轮询
  const anyInstalling = summaries?.some((s) => s.status === "installing") ?? false;
  useEffect(() => {
    if (!anyInstalling && pendingInstalls.size === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      void refresh().catch(() => {
        // 轮询失败静默忽略
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [anyInstalling, pendingInstalls, refresh]);

  // 点击「下载」按钮 → 弹出确认对话框
  const handleDownloadClick = useCallback((summary: DictionaryPackageSummary) => {
    setConfirmTarget(summary);
  }, []);

  // 确认下载 → 开始安装
  const handleConfirmDownload = useCallback(
    async (packageId: string) => {
      setConfirmTarget(null);
      setError(null);
      setNotice(null);
      setPendingInstalls((current) => new Set(current).add(packageId));

      // 创建 AbortController 用于取消
      const controller = new AbortController();
      abortControllersRef.current.set(packageId, controller);

      try {
        const result = await provider.installDictionaryPackage(packageId, controller.signal);
        if (!mountedRef.current) return;

        if (result.status === "installed") {
          const parts: string[] = [];
          if (result.installedCount && result.installedCount > 0) {
            parts.push(`新增 ${result.installedCount.toLocaleString()} 词`);
          }
          if (result.skippedCount && result.skippedCount > 0) {
            parts.push(`跳过 ${result.skippedCount.toLocaleString()} 已存在词条`);
          }
          if (result.updatedCount && result.updatedCount > 0) {
            parts.push(`更新 ${result.updatedCount.toLocaleString()} 词`);
          }
          if (result.deletedCount && result.deletedCount > 0) {
            parts.push(`移除 ${result.deletedCount.toLocaleString()} 旧词`);
          }
          setNotice(`词包安装完成${parts.length > 0 ? `：${parts.join("，")}` : ""}。`);

          // Tier 2 安装完成 → 自动标记 Tier 1 为 covered（§7）
          if (packageId === "core-en-tier2") {
            await provider.markTier1CoveredByTier2();
          }
        } else {
          setNotice("词包已是最新版本，无需重复安装。");
        }
      } catch (err) {
        if (!mountedRef.current) return;
        // AbortError：清除 IDB 进度标记，使 refresh 读到 not-installed
        if (err instanceof DOMException && err.name === "AbortError") {
          try {
            await provider.resetDictionaryPackageInstall(packageId);
          } catch (resetErr) {
            if (import.meta.env.DEV) {
              console.warn("resetDictionaryPackageInstall failed", resetErr);
            }
          }
          setNotice("下载已取消。");
        } else {
          setError(`安装失败：${toErrorMessage(err)}`);
        }
      } finally {
        abortControllersRef.current.delete(packageId);
        if (mountedRef.current) {
          setPendingInstalls((current) => {
            const next = new Set(current);
            next.delete(packageId);
            return next;
          });
          void refresh().catch(() => {});
        }
      }
    },
    [provider, refresh],
  );

  // 取消安装（abort 后由 handleConfirmDownload 的 catch 分支清除 IDB 进度）
  const handleCancelInstall = useCallback((packageId: string) => {
    const controller = abortControllersRef.current.get(packageId);
    if (controller) {
      controller.abort();
    }
  }, []);

  // 获取 manifest 中的体积信息
  const getManifestSize = useCallback(
    (packageId: string): number | undefined => {
      const info = manifestInfos?.find((i) => i.id === packageId);
      return info?.bestVariant?.size;
    },
    [manifestInfos],
  );

  // 获取 manifest 中的版本信息
  const getManifestVersion = useCallback(
    (packageId: string): string | undefined => {
      return manifestInfos?.find((i) => i.id === packageId)?.version;
    },
    [manifestInfos],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="扩展词包" onBack={onBack} backLabel="返回设置" />

      <p className="text-sm text-text-muted">
        下载扩展词包可将词典检索范围从内置 7,195 词扩展到 ECDICT
        全量覆盖。下载时需要联网，下载后可离线使用。词包仅扩充检索层，不影响已有学习数据；只有加入词书或生词本后，才会进入学习队列。
      </p>

      {loadingManifest ? (
        <div role="status" className="py-8 text-center text-sm text-text-muted">
          正在获取词包信息…
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {summaries?.map((summary) => (
          <DictionaryPackageCard
            key={summary.id}
            summary={summary}
            sizeBytes={getManifestSize(summary.id)}
            manifestVersion={getManifestVersion(summary.id)}
            installing={pendingInstalls.has(summary.id)}
            onDownload={handleDownloadClick}
            onCancel={handleCancelInstall}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="text-sm font-medium">数据来源与许可</h3>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Tier 1 / 2 扩展词包数据来自 ECDICT（MIT 许可，© 2025 Linwei，
          <a
            href="https://github.com/skywind3000/ECDICT"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary"
          >
            GitHub
          </a>
          ）。下载时需要联网，下载后可离线使用；不埋点。
        </p>
      </div>

      {/* 确认对话框 */}
      {confirmTarget ? (
        <DownloadConfirmDialog
          packageName={confirmTarget.name}
          sizeBytes={getManifestSize(confirmTarget.id)}
          onConfirm={() => void handleConfirmDownload(confirmTarget.id)}
          onCancel={() => setConfirmTarget(null)}
        />
      ) : null}

      <div aria-live="polite">
        {error ? (
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
    </main>
  );
}

/** 单个词包卡片 */
function DictionaryPackageCard({
  summary,
  sizeBytes,
  manifestVersion,
  installing,
  onDownload,
  onCancel,
}: {
  summary: DictionaryPackageSummary;
  sizeBytes?: number;
  /** manifest 中的最新版本（用于判断升级可用） */
  manifestVersion?: string;
  installing: boolean;
  onDownload(summary: DictionaryPackageSummary): void;
  onCancel(packageId: string): void;
}) {
  const { status, installedCount, totalCount, installedVersion } = summary;
  const progressPercent =
    status === "installing" && totalCount > 0 ? Math.round((installedCount / totalCount) * 100) : 0;

  const isUpgradeAvailable =
    status === "installed" &&
    installedVersion &&
    manifestVersion &&
    compareSemver(installedVersion, manifestVersion) < 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{summary.name}</span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs ${
            status === "installed"
              ? isUpgradeAvailable
                ? "border-accent/40 text-accent"
                : "border-success/40 text-success"
              : status === "covered"
                ? "border-success/40 text-success"
                : status === "installing"
                  ? "border-accent/40 text-accent"
                  : "border-border text-text-muted"
          }`}
        >
          {statusLabel(status, installedVersion, manifestVersion)}
        </span>
      </span>
      <span className="text-xs text-text-muted">
        {totalCount.toLocaleString()} 词条
        {sizeBytes ? ` · ${formatSize(sizeBytes)}` : ""}
      </span>

      {status === "installing" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalCount}
              aria-valuenow={installedCount}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-text-muted">{progressPercent}%</span>
          </div>
          {installing ? (
            <button
              type="button"
              onClick={() => onCancel(summary.id)}
              className="w-fit rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium transition-colors hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              取消
            </button>
          ) : null}
        </div>
      ) : null}

      {status === "not-installed" ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={installing}
            onClick={() => onDownload(summary)}
            className="w-fit rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing ? "下载中…" : "下载"}
          </button>
          {installing ? (
            <button
              type="button"
              onClick={() => onCancel(summary.id)}
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium transition-colors hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              取消
            </button>
          ) : null}
        </div>
      ) : null}

      {isUpgradeAvailable ? (
        <button
          type="button"
          disabled={installing}
          onClick={() => onDownload(summary)}
          className="w-fit rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {installing ? "升级中…" : `升级到 v${manifestVersion}`}
        </button>
      ) : null}
    </div>
  );
}
