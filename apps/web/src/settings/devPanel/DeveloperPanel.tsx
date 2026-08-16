/**
 * 开发者面板（RAY-297 任务 B）：设置页版本号连点 5 次解锁的隐藏「开发者」分组。
 *
 * 内容（对照 issue 验收）：
 * - 通道切换器（P0）：显示当前通道（release / dev），<a> 纯页面跳转到另一通道；
 * - 构建信息（P0）：版本 / 通道 / commit SHA / 构建时间 / 分支或 tag，全部
 *   构建时注入（__APP_BUILD__），运行时零网络请求；
 * - 版本回退（P1）：历史 Release tag 列表（构建时注入），跳转 GitHub Release 页
 *   （纯外链，不请求数据）；
 * - 数据库调试（P1）：IndexedDB schema 版本、各表记录数、二次确认清库；
 * - FSRS 调试（P2）：当前记忆参数（与调度器默认参数同源）、状态分布、
 *   未来 30 天到期样例；
 * - Feature flags（P2）：localStorage 持久化的候选方向开关（当前未接线）。
 *
 * 红线：
 * - 不引入任何联网功能：通道切换是纯页面跳转，历史 Release 是纯外链，
 *   其余信息全部构建时注入或本机 IndexedDB 读取；
 * - 不埋点上报；深色模式走 design tokens（无硬编码颜色）。
 *
 * 数据源按需注入：面板挂载时才创建 provider（默认实现打开本机 IndexedDB），
 * 未解锁的普通用户零开销、零请求。
 */
import { useEffect, useState } from "react";
import { APP_VERSION } from "../../lib/appVersion";
import { APP_BUILD } from "./buildInfo";
import { CHANNEL_LABELS, detectChannel, getOtherChannelPath } from "./channel";
import { FEATURE_FLAGS, readFeatureFlags, writeFeatureFlag } from "./featureFlags";
import type { DatabaseDebug, DeveloperDataProvider, FsrsDebug } from "./types";

export interface DeveloperPanelProps {
  /** 面板数据源工厂（设置页注入：默认浏览器 IndexedDB，测试注入 mock） */
  providerFactory: () => DeveloperDataProvider;
}

/** 当前版本对应的 release tag（与版本回退列表的「当前」标记比较） */
const CURRENT_VERSION_TAG = `v${APP_VERSION}`;

export function DeveloperPanel({ providerFactory }: DeveloperPanelProps) {
  // provider 惰性创建：面板解锁挂载时才打开 IndexedDB
  const [provider] = useState(providerFactory);
  const [databaseDebug, setDatabaseDebug] = useState<DatabaseDebug | null>(null);
  const [fsrsDebug, setFsrsDebug] = useState<FsrsDebug | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState(() => readFeatureFlags());
  const [clearArmed, setClearArmed] = useState(false);
  const [clearDone, setClearDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [database, fsrs] = await Promise.all([
          provider.loadDatabaseDebug(),
          provider.loadFsrsDebug(),
        ]);
        if (!cancelled) {
          setDatabaseDebug(database);
          setFsrsDebug(fsrs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const handleFlagChange = (id: string, checked: boolean) => {
    writeFeatureFlag(id, checked);
    setFlags(readFeatureFlags());
  };

  const handleClearClick = () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    void (async () => {
      try {
        await provider.clearDatabase();
        setClearDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const channel = detectChannel(window.location.pathname);
  const otherChannelPath = getOtherChannelPath(window.location.pathname);

  return (
    <section className="rounded-2xl border border-border bg-surface p-6" aria-label="开发者">
      <h2 className="text-base font-semibold">开发者</h2>
      <p className="mt-1 text-xs text-text-muted">
        本分组为隐藏彩蛋，仅供维护者调试：所有信息均构建时注入或本机读取，无任何联网请求。
      </p>
      <div className="mt-4 flex flex-col gap-6">
        <DevSection title="通道">
          <p className="text-sm">
            当前通道：<span className="font-medium">{CHANNEL_LABELS[channel]}</span>
            <span className="mt-1 block text-xs text-text-muted">
              部署路径：{window.location.pathname}
            </span>
          </p>
          <a
            href={otherChannelPath}
            className="inline-flex w-fit items-center rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            切换到 {channel === "release" ? "Dev" : "Release"} 通道
          </a>
          <p className="text-xs text-text-muted">
            纯页面跳转（{otherChannelPath}
            ），两通道同源、共享同一 IndexedDB，数据互通。
          </p>
        </DevSection>

        <DevSection title="构建信息">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <DebugField label="版本" value={APP_VERSION} />
            <DebugField label="通道" value={CHANNEL_LABELS[APP_BUILD.channel]} />
            <DebugField
              label="Commit"
              value={APP_BUILD.sha}
              title={APP_BUILD.sha.length > 8 ? `完整 SHA：${APP_BUILD.sha}` : undefined}
            />
            <DebugField label="构建时间" value={APP_BUILD.time} />
            <DebugField label="分支 / tag" value={APP_BUILD.branch} />
          </dl>
        </DevSection>

        <DevSection title="版本回退">
          <ul className="flex flex-col gap-1 text-sm">
            {APP_BUILD.releaseTags.map((tag) => (
              <li key={tag} className="flex items-center gap-2">
                <a
                  href={`https://github.com/RayySummers/Lexilexi/releases/tag/${tag}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {tag}
                </a>
                {tag === CURRENT_VERSION_TAG ? (
                  <span className="text-xs text-text-muted">（当前）</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">
            Pages 仅托管最新稳定版，旧版本回退请跳转到对应 tag 的 GitHub Release
            页面（纯外链，不请求数据）。
          </p>
        </DevSection>

        <DevSection title="数据库调试">
          {loading ? (
            <p className="text-sm text-text-muted">正在读取…</p>
          ) : databaseDebug ? (
            <>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <DebugField label="数据库" value={databaseDebug.dbName} />
                <DebugField label="Schema 版本" value={`v${databaseDebug.schemaVersion}`} />
              </dl>
              <ul className="flex flex-col gap-1 text-sm">
                {databaseDebug.tables.map((table) => (
                  <li key={table.name} className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs">{table.name}</span>
                    <span className="text-text-muted">{table.count} 条</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleClearClick}
                  className={
                    clearArmed
                      ? "w-fit rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      : "w-fit rounded-full border border-danger/40 bg-surface px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:border-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  }
                >
                  {clearArmed ? "再次点击确认清空（不可恢复）" : "清空本地数据库"}
                </button>
                {clearDone ? (
                  <p role="status" className="text-sm text-success">
                    数据库已清空。请刷新页面重新开始。
                  </p>
                ) : (
                  <p className="text-xs text-text-muted">
                    危险操作：删除全部本地学习数据，请先导出备份；需二次点击确认。
                  </p>
                )}
              </div>
            </>
          ) : null}
        </DevSection>

        <DevSection title="FSRS 调试">
          {loading ? (
            <p className="text-sm text-text-muted">正在读取…</p>
          ) : fsrsDebug ? (
            <>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <DebugField
                  label="期望保持率"
                  value={String(fsrsDebug.parameters.request_retention)}
                />
                <DebugField
                  label="最大间隔（天）"
                  value={String(fsrsDebug.parameters.maximum_interval)}
                />
                <DebugField
                  label="学习步骤"
                  value={fsrsDebug.parameters.learning_steps.join(" / ")}
                />
                <DebugField
                  label="重学步骤"
                  value={fsrsDebug.parameters.relearning_steps.join(" / ")}
                />
                <DebugField
                  label="短期记忆调度"
                  value={fsrsDebug.parameters.enable_short_term ? "开" : "关"}
                />
                <DebugField
                  label="间隔模糊化"
                  value={fsrsDebug.parameters.enable_fuzz ? "开" : "关"}
                />
              </dl>
              <div>
                <p className="text-sm">权重 w（{fsrsDebug.parameters.w.length} 个）</p>
                <p className="mt-1 break-all font-mono text-xs text-text-muted">
                  {fsrsDebug.parameters.w.join(", ")}
                </p>
              </div>
              <div>
                <p className="text-sm">记忆状态分布</p>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <li>新词：{fsrsDebug.counts.new}</li>
                  <li>学习中：{fsrsDebug.counts.learning}</li>
                  <li>复习：{fsrsDebug.counts.review}</li>
                  <li>重学：{fsrsDebug.counts.relearning}</li>
                </ul>
              </div>
              <div>
                <p className="text-sm">即将到期样例（未来 30 天，最多 10 条）</p>
                {fsrsDebug.dueSample.length === 0 ? (
                  <p className="mt-1 text-xs text-text-muted">未来 30 天内没有到期条目。</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {fsrsDebug.dueSample.map((entry) => (
                      <li
                        key={entry.itemId}
                        className="flex flex-wrap items-baseline justify-between gap-x-4"
                      >
                        <span>{entry.term}</span>
                        <span className="text-xs text-text-muted">
                          到期 {entry.due} · S {entry.stabilityDays} · D {entry.difficulty}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </DevSection>

        <DevSection title="Feature flags">
          <div className="flex flex-col gap-3">
            {FEATURE_FLAGS.map((flag) => (
              <label
                key={flag.id}
                htmlFor={`feature-flag-${flag.id}`}
                className="flex items-start gap-3 text-sm"
              >
                <input
                  id={`feature-flag-${flag.id}`}
                  type="checkbox"
                  checked={flags[flag.id] === true}
                  onChange={(event) => handleFlagChange(flag.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  {flag.name}
                  <span className="mt-0.5 block text-xs text-text-muted">{flag.description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            开关仅持久化到本机 localStorage，当前版本均未接入功能逻辑（下一期候选方向的 A/B 预留）。
          </p>
        </DevSection>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/40 bg-surface p-4 text-sm text-text"
          >
            读取失败：{error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** 面板子分组（视觉层级低于设置页的 Section） */
function DevSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-text-muted">{title}</h3>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  );
}

/** 构建信息 / 调试信息的「标签 — 值」行 */
function DebugField({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-right font-mono text-xs" title={title}>
        {value}
      </dd>
    </div>
  );
}
