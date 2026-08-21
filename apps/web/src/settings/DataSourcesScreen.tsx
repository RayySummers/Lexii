/**
 * 「数据来源与许可」页（RAY-258 范围 4）。
 *
 * - 内置词表安装状态（meta 标记 → 名称/词条数/版本）；
 * - 第三方数据来源登记（名称、许可、出处链接、署名、使用方式）；
 * - 打包 NOTICE 全文（MIT 版权声明 + CC BY-SA 署名与共享义务）。
 *
 * 说明文案为过渡版（Vega RAY-259 的正式文案交付后替换）；数据事实层
 * （来源/许可/署名）来自 RAY-257 简报核对结论，随 @lexii/core 的
 * THIRD_PARTY_DATA_SOURCES / THIRD_PARTY_NOTICES 分发。
 * 全部颜色走 design tokens（浅色/深色自动生效）。
 */
import { useEffect, useState } from "react";
import type { ThirdPartyDataSource } from "@lexii/core";
import { THIRD_PARTY_DATA_SOURCES, THIRD_PARTY_NOTICES } from "@lexii/core";
import { ScreenHeader } from "../components/ScreenHeader";
import type { PresetSummary, SettingsDataProvider } from "./types";

export interface DataSourcesScreenProps {
  provider: SettingsDataProvider;
  /** 返回设置页 */
  onBack(): void;
}

/** 安装状态 → 中文徽标文案 */
function statusLabel(summary: PresetSummary): string {
  switch (summary.status) {
    case "installed":
      return "已安装";
    case "installing":
      return `安装中（${summary.installedCount}/${summary.totalCount}）`;
    case "not-installed":
      return "未安装";
  }
}

export function DataSourcesScreen({ provider, onBack }: DataSourcesScreenProps) {
  const [summaries, setSummaries] = useState<PresetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void provider
      .getPresetSummaries()
      .then((result) => {
        if (!cancelled) {
          setSummaries(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="数据来源与许可" onBack={onBack} backLabel="返回设置" />

      <p className="text-sm text-text-muted">
        乐希的预设词表由开源数据清洗打包而成，随应用内置、离线可用。以下列出全部数据来源、许可与署名信息。
      </p>

      {/* RAY-375 S1-3：全局界面字体说明（与词表来源区分，不混淆） */}
      <p className="text-sm text-text-muted">
        界面字体：默认使用小米{" "}
        <a
          href="https://hyperos.mi.com/font/zh/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          MiSans
        </a>{" "}
       （以 woff2 形式随应用分发，400/500/700 三档，font-display: swap，离线回退系统字体）。卡片英文词条字体仍由“外观-卡片字体”7
        档独立控制，不受全局字体影响。
      </p>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-base font-semibold">内置词表</h2>
        <div className="mt-4 flex flex-col gap-3">
          {error ? (
            <p role="alert" className="rounded-xl border border-danger/40 bg-surface p-4 text-sm">
              读取安装状态失败：{error}
            </p>
          ) : summaries === null ? (
            <p className="text-sm text-text-muted">正在读取安装状态…</p>
          ) : (
            summaries.map((summary) => (
              <div
                key={summary.id}
                className="flex flex-col gap-1 rounded-xl border border-border p-4"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{summary.name}</span>
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted">
                    {statusLabel(summary)}
                  </span>
                </span>
                <span className="text-xs text-text-muted">
                  {summary.totalCount} 词条
                  {summary.status === "installed" && summary.installedVersion
                    ? ` · v${summary.installedVersion}`
                    : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-base font-semibold">数据来源</h2>
        <div className="mt-4 flex flex-col gap-4">
          {THIRD_PARTY_DATA_SOURCES.map((source) => (
            <DataSourceCard key={source.id} source={source} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-base font-semibold">许可声明（NOTICE）</h2>
        <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-border bg-surface-raised p-4 text-xs leading-relaxed text-text-muted whitespace-pre-wrap">
          {THIRD_PARTY_NOTICES}
        </pre>
      </section>
    </main>
  );
}

/** 单个数据来源卡片：名称 + 许可徽标 + 使用方式 + 署名 + 出处链接 */
function DataSourceCard({ source }: { source: ThirdPartyDataSource }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{source.name}</span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text-muted">
          {source.license}
        </span>
      </span>
      <p className="text-sm text-text-muted">{source.usage}</p>
      <p className="text-xs text-text-muted">{source.attribution}</p>
      <span className="flex flex-wrap gap-3 text-sm">
        <a
          href={source.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          来源主页
        </a>
        <a
          href={source.licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          许可文本
        </a>
      </span>
    </div>
  );
}
