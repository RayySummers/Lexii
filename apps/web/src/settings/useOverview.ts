/**
 * 数据概览加载 hook（设置页）。
 *
 * 挂载即拉取概览，暴露 { overview, error, reload }。与 useReviewSession 一致，
 * 把「挂载加载」的 effect 收进 hook（.ts 文件），组件层不再在 effect 里同步
 * setState（满足 react-hooks/set-state-in-effect）。
 */
import { useCallback, useEffect, useState } from "react";
import type { DataOverview, SettingsDataProvider } from "./types";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface OverviewState {
  overview: DataOverview | null;
  error: string | null;
  reload(): void;
}

export function useOverview(provider: SettingsDataProvider): OverviewState {
  const [overview, setOverview] = useState<DataOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await provider.loadOverview();
      setOverview(result);
      setError(null);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { overview, error, reload };
}
