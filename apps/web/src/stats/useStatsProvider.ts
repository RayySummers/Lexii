/**
 * 统计数据源的惰性创建 hook（App 外壳用）。
 *
 * 首页默认视图需要到期徽标，因此统计源在挂载时即创建（区别于复习/设置源的
 * 「进入界面才创建」）；工厂默认实现自带无 IndexedDB 环境兜底（见 data.ts），
 * 测试注入 mock 工厂即可断言创建时机与数据展示。
 * 放进 .ts 文件以复用「挂载即创建」的 effect 模式（同 useOverview）。
 */
import { useEffect, useState } from "react";
import type { StatsDataProvider } from "./types";

export function useStatsProvider(factory: () => StatsDataProvider): StatsDataProvider | null {
  const [provider, setProvider] = useState<StatsDataProvider | null>(null);
  useEffect(() => {
    setProvider(factory());
  }, [factory]);
  return provider;
}
