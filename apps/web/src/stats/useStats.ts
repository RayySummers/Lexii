/**
 * 统计快照加载 hook（统计页 + 首页到期徽标共用）。
 *
 * provider 为 null 时（App 尚未创建数据源）不加载、保持空状态。
 * 与 useOverview 一致：把「挂载加载」的 effect 收进 hook（.ts 文件），
 * 组件层不再在 effect 里同步 setState。
 *
 * 跨午夜兜底（RAY-343 B1）：
 * `loadedAtDateRef` 记录上次成功加载的「开始日」本地日历日（YYYY-MM-DD）。
 * loadStats 内部用 `new Date().toISOString()` 取 `now` 作为聚合基准时刻，
 * 快照对应的就是「开始日」语义——所以 S1：ref 记**开始日**而不是「完成
 * 当日的 now」，避免 load 在跨日前发起、跨日后完成时把 Day 1 快照错记
 * 成 Day 2。30s 周期定时器比对当前本地日：
 *   - ref 缺失（首载失败、从未成功过）→ 触发 load 重试；
 *   - ref 与今日不同 → 触发 load 跨日刷新；
 *   - 两者都不是 → 同日无变化，零 IO。
 *
 * 为什么不依赖 visibilitychange/focus：
 *   - 浏览器对 hidden 标签的 setInterval 节流到 ≥1 次/分钟，30s 周期仍
 *     能跨日触发（切到后台 tab 也兜住）；
 *   - 标签页从挂起恢复时浏览器会补发过期定时器，下一 tick 即可跨日；
 *   - 进程被杀 / 路由卸载重挂 → effect 重挂 → 首次 load 拿当日值。
 *
 * 与「首页额度提示」+「统计页时间维度」的耦合（对应 RAY-343 复盘）：
 * 旧实现只在 provider 首次就绪时 load 一次，跨过午夜不会刷新——用户
 * 体感就是「第二天还报无学习额度」（首页卡 Day 1 的 todayLearnCount）。
 * 新实现靠定时器跨日 reload 兜住。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { localDateKey } from "@lexii/stats";
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
  // 上次成功 load 的「开始日」本地日历日（null = 还没成功过）；存 ref 而非
  // state，避免日期字符串变化触发额外渲染——只要统计数字到位即可。
  const loadedAtDateRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!provider) {
      return;
    }
    // S1：在 await 之前捕获「开始日」。loadStats（stats/data.ts）内部用
    // `new Date().toISOString()` 取 `now` 作为聚合基准——开始日与快照口径
    // 同源。若一次 load 在 Day 1 23:59:59.x 发起、00:00:00.y 完成，
    // ref 应记 Day 1（与快照同源），下一 tick 会发现 ref !== today 并自动补
    // 发 Day 2 快照；若记完成日的 Day 2 则 30s 窗口内首页额度提示会过期一整日。
    const startDate = localDateKey();
    try {
      const result = await provider.loadStats();
      setStats(result);
      setError(null);
      loadedAtDateRef.current = startDate;
    } catch (err) {
      setError(toErrorMessage(err));
      // 失败路径不碰 ref——
      //   - 旧 ref 仍为某成功日时，下一 tick 仍按「ref !== today」重试，行为不变；
      //   - 首载失败时 ref 保持 null，由 interval 守卫「S2：ref 缺失也重试」兜底。
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  // 跨午夜兜底：定时器检测本地日历日变化，跨日则 reload。
  // 不依赖 visibilitychange/focus（理由见头注释）。
  useEffect(() => {
    if (!provider) {
      return;
    }
    const intervalId = setInterval(() => {
      const today = localDateKey();
      // S2：ref 缺失（首载抛错、ref 一直 null）也要重试；否则首载失败后
      // watchdog 永久失活，直到 provider 重建或组件重挂。其它情况下只跨日
      // reload，不发起无谓 IO。
      if (loadedAtDateRef.current === null || loadedAtDateRef.current !== today) {
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
