# 预设词表格式清洗实验报告（RAY-258 范围 1）

> 生成时间：2026-08-15T05:26:53.461Z（脚本：scripts/presets/analyze.mjs）
> 数据来源：ECDICT（MIT，commit bc015ed，ecdict.csv SHA256 1A6947E0…F9C3CF）+ NGSL 1.2（CC BY-SA 4.0，官方 NGSL_12_stats.csv）

## 1. 清洗统计（ECDICT 全量 76 万行）

| 指标 | 数值 |
|---|---|
| 全量数据行 | 770611 |
| 清洗后唯一词条（term 形状合法 + 释义非空 + 去重） | 401222 |
| 重复丢弃（term 小写去重） | 0 |
| 释义超长截断行 | 0 |

拒绝原因分布：

| 原因 | 行数 |
|---|---|
| term-shape | 368416 |
| empty-translation | 973 |

## 2. 分级过滤行数

| 分级 | 条件 | 词条数 |
|---|---|---|
| Tier 0（ECDICT 部分） | tag ∈ {zk,gk,cet4,cet6} | 7112 |
| Tier 0（最终） | 考试标签 ∪ NGSL 1.2 join | 7195 |
| Tier 1（全考试标签） | tag ∈ {zk,gk,cet4,cet6,ky,toefl,ielts,gre} | 14933 |
| Tier 1（全考试 ∪ 核心阈值） | 全考试 ∪ collins>0 ∪ oxford>0 ∪ 词频>0 | 58244 |
| Tier 2（全量清洗） | 全部合法词条 | 401222 |

各考试标签词条数（清洗后）：

| 标签 | 词条数 |
|---|---|
| zk | 1602 |
| gk | 3677 |
| cet4 | 3846 |
| cet6 | 5406 |
| ky | 4801 |
| toefl | 6970 |
| ielts | 5038 |
| gre | 7504 |

## 3. NGSL 1.2 join 覆盖

| 指标 | 数值 |
|---|---|
| NGSL 1.2 总词数 | 2809 |
| 在 ECDICT 清洗结果中命中 | 2809 |
| 未命中（无释义，本轮不内置，需人工/双源补齐） | 0 |
| 已包含在考试标签子集内 | 2726 |

未命中词条清单：（无）

## 4. 体积估算（紧凑元组 JSON，UTF-8）

| 分级 | 词条数 | 原始 | gzip(9) | brotli(11) |
|---|---|---|---|---|
| Tier 0 | 7195 | 845 KB | 286 KB | 224 KB |
| Tier 1 | 58244 | 4.4 MB | 1.7 MB | 1.2 MB |
| Tier 2 | 401222 | 25.2 MB | 8.5 MB | 6.4 MB |

> 首启导入耗时基准见 docs/presets/benchmark.md（vitest bench，Node fake-indexeddb 环境，
> 真实设备数据待真机试用复测）。

脚本耗时：56.3s
