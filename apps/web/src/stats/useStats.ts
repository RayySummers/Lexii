/**
 * 统计快照加载 hook（统计页 + 首页到期徽标共用）。
 *
 * provider 为 null 时（App 尚未创建数据源）不加载、保持空状态。
 * 与 useOverview 一致：把「挂载加载」的 effect 收进 hook（.ts 文件），
 * 组件层不再在 effect 里同步 setState。
 */
import { useCallback, useEffect, useState } from "react";
import type { StatsDataProvider, StatsSnapshot } from "./types";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface StatsState {
  stats: StatsSnapshot | null;
  error: string | null;
  reload(): void;
}

export function useStats(provider: StatsDataProvider | null): StatsState {
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!provider) {
      return;
    }
    try {
      const result = await provider.loadStats();
      setStats(result);
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

  return { stats, error, reload };
}
