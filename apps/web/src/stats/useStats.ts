/**
 * 统计快照加载 hook（统计页 + 首页到期徽标共用）。
 *
 * provider 为 null 时（App 尚未创建数据源）不加载、保持空状态。
 * 与 useOverview 一致：把「挂载加载」的 effect 收进 hook（.ts 文件），
 * 组件层不再在 effect 里同步 setState。
 *
 * 跨午夜兜底（RAY-343 B1）：
 * `loadedAtDateRef` 记录上次成功加载的本地日历日（YYYY-MM-DD）。周期性
 * 定时器（30s）比对当前本地日，跨日则自动 `reload()`。不依赖
 * visibilitychange/focus——「应用一直在前台被显示、日历日跨过午夜」
 * （用户不切窗口）也要兜住。定时器间隔权衡：30s 比分钟级更及时，同时
 * 不至于把 IndexedDB 读操作拖到浪费。
 *
 * 与「首页额度提示」+「统计页时间维度」的耦合（对应 RAY-343 复盘）：
 * 旧实现只在 provider 首次就绪时 load 一次，跨过午夜不会刷新——用户
 * 体感就是「第二天还报无学习额度」（首页卡 Day 1 的 todayLearnCount）。
 * 新实现两路径覆盖：①前台跨午夜（定时器触发）；②后台跨午夜（挂载
 * effect 在重新挂载时也会 load——配合 App.tsx 现有 visibility 重建机制
 * 覆盖到 ②；前台不动则交给定时器覆盖到 ①）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StatsDataProvider, StatsSnapshot } from "./types";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 当前时刻的本地日历日，YYYY-MM-DD（与 Date.getFullYear/Month/Date 同源） */
export function localDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface StatsState {
  stats: StatsSnapshot | null;
  error: string | null;
  reload(): void;
}

export function useStats(provider: StatsDataProvider | null): StatsState {
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 上次成功 load 的本地日历日（null = 还没 load 过）；存 ref 而非 state，
  // 避免日期字符串变化触发额外渲染——只要统计数字到位即可。
  const loadedAtDateRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!provider) {
      return;
    }
    try {
      const result = await provider.loadStats();
      setStats(result);
      setError(null);
      loadedAtDateRef.current = localDateKey();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  // 跨午夜兜底：定时器检测本地日历日变化，跨日则 reload。
  // 不依赖 visibilitychange/focus：应用一直保持前台、日历日跨过午夜也能刷新。
  useEffect(() => {
    if (!provider) {
      return;
    }
    const intervalId = setInterval(() => {
      const today = localDateKey();
      if (loadedAtDateRef.current !== null && loadedAtDateRef.current !== today) {
        void load();
      }
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [provider, load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { stats, error, reload };
}
