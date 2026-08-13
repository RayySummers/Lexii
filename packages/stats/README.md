# @lexilexi/stats

Lexilexi 学习统计包：从本地事件流聚合学习统计。

## 职责

- 只依赖 `@lexilexi/core` 的领域类型（`ReviewEvent`），不碰 IndexedDB 表结构。
- 全部纯函数：输入事件数组 + 查询基准时刻，输出统计值；便于测试与重放。
- 事件是唯一事实来源（docs/domain-model.md §7），全部在本地计算，不向任何外部服务发送数据。

## v0 指标

| 指标     | 函数                          | 口径                                                                 |
| -------- | ----------------------------- | -------------------------------------------------------------------- |
| 已复习数 | `countReviews(events)`        | review 事件总数                                                      |
| 连击     | `computeStreak(events, now?)` | 以本地日历日计的连续复习天数；今天还没学不算断；中断后从最新一段算起 |

## 使用

```ts
import { computeStreak, countReviews } from "@lexilexi/stats";

const reviews = await db.events.where("type").equals("review").toArray();
const streak = computeStreak(reviews, new Date().toISOString());
```

## 路线

- 后续迭代：保留率（FSRS retrievability 聚合）、学习趋势图、每日目标等。
