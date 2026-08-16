# @lexilexi/stats

Lexilexi 学习统计包：从本地事件流聚合学习统计。

## 职责

- 只依赖 `@lexilexi/core` 的领域类型（`ReviewEvent`），不碰 IndexedDB 表结构。
- 全部纯函数：输入事件数组 + 查询基准时刻，输出统计值；便于测试与重放。
- 事件是唯一事实来源（docs/domain-model.md §7），全部在本地计算，不向任何外部服务发送数据。

## 指标（RAY-252：统计面板 8 项 + RAY-270：学习时长 2 项 + 数据层打底）

| 指标                 | 函数                                                                    | 口径                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已复习数             | `countReviews(events)`                                                  | review 事件总数（一次评分一次复习），即「累计已完成（次数）」                                                                                                               |
| 连击                 | `computeStreak(events, now?)`                                           | 以本地日历日计的连续复习天数；今天还没学不算断；中断后从最新一段算起                                                                                                        |
| 累计天数             | `computeTotalDays(events, now?)`                                        | 有复习记录的不同本地日历日数（未来脏事件不计）                                                                                                                              |
| 今日已学习（次数）   | `computeLearnedTodayCount(events, now?)`                                | 今天首次被复习（新学）的词条数：词条在事件流里时间最早的那条 review 事件即其「学习」记录，落在今天即计 1                                                                    |
| 今日已复习（次数）   | `computeReviewedTodayCount(events, now?)`                               | 今天对已学词条的复习次数 = 今天的 review 事件数 − 今日已学习数（去掉每个词条今天那次首次复习）                                                                              |
| 今日剩余新卡（词条） | `computeNewCardsRemainingToday(limit, remainingNewCards, learnedToday)` | min(每日新卡上限, 今日新卡池) − 今日已学习，下限 0（等价于 min(上限 − 今日已学, 当前剩余新卡)）；RAY-295 统计页「今日待学」口径——按每日新卡上限过滤，不显示全部未学新卡总数 |
| 累计已完成（词条）   | `computeCompletedWordCount(events)`                                     | 至少复习过一次的词条数（itemId 去重；时间非法的记录同样计入）                                                                                                               |
| 累计学习时长（毫秒） | `computeStudyDurationMs(events, now?)`                                  | 全部有效复习时长之和；时间非法与未来脏事件不计（与累计天数同口径）；RAY-270                                                                                                 |
| 今日学习时长（毫秒） | `computeTodayStudyDurationMs(events, now?)`                             | 本地日历日落在今天的有效复习时长之和；RAY-270                                                                                                                               |
| 单次有效时长（毫秒） | `effectiveReviewDurationMs(event)`                                      | reviewDurationMs 按 `MAX_EFFECTIVE_REVIEW_DURATION_MS`（5 分钟）截断；负数/非法值按 0                                                                                       |
| 时长显示文案         | `formatStudyDuration(ms)`                                               | 自适应：0 →「0 分钟」；不足 1 分钟 →「不足 1 分钟」；不足 1 小时 →「X 分钟」；1 小时及以上 →「X 小时 Y 分钟」（Y=0 时省略，仅显示「X 小时」）                               |
| 本地日区间           | `localDayBounds(now, offsetDays?)`                                      | 某本地日历日的半开区间 [start, end)（ISO），供「今日待学/明日到期」与 `@lexilexi/core` 的 `getDueItemIdsInRange` 对齐                                                       |

「今日待学 / 明日到期（词条）」由 `apps/web` 统计数据源经
`@lexilexi/core` 的 `getDueItemIds` / `getDueItemIdsInRange` 查询记忆状态得到
（due 口径见 core；统计包只负责把「基准时刻」换算成本地日历日区间）。
措辞不对称（今日「待学」/ 明日「到期」）是口径使然而非遗漏：今日含 reps===0
的新词（due = now），称「待学」更准确；明日均为已排期复习卡，称「到期」更
准确。若未来「明日到期」也统一术语，需同步本行与 `apps/web` 统计页文案。

RAY-295 起，统计页「今日待学（词条）」改用 `computeNewCardsRemainingToday`
（按每日新卡上限过滤，见上表）；`apps/web` 首页徽标仍用未截断的 dueCount
（RAY-260 口径，另有「今日新卡额度」提示说明二者关系），两条口径刻意不同。

## 学习时长口径（RAY-270）

数据源为 RAY-252 起随 review 事件落库的 `reviewDurationMs`（卡片出现到评分），
无 schema 改动、全本地推导；撤销评分会删除对应 review 事件（RAY-265 单步
撤销），时长随事件流重算自然一致。

「有效时长」的关键是防闲置虚高：卡片挂着不动时 reviewDurationMs 会把闲置
时间一并计入，因此单次有效时长按 `MAX_EFFECTIVE_REVIEW_DURATION_MS`
（5 分钟）截断，超过部分视为挂机不计。选择题模式 reviewDurationMs 恒为 0
（见 docs/quiz-fsrs-mapping.md，S2 迭代再精确计时），故选择题不计入时长。

## 复习结果分类（对/错/遗忘，数据层打底）

```ts
type ReviewOutcome = "correct" | "wrong" | "forgotten";
```

- `classifyReviewOutcome(event)`：`rating=again` → `forgotten`（用户自评忘记，
  优先级最高）；否则按 `answerWasCorrect` 分 `correct` / `wrong`。
- `countReviewOutcomes(events)`：全量对/错/遗忘计数。
- `countReviewOutcomesByItem(events)`：按词条分组的计数，是「遗忘最多的单词」
  统计的直接数据源。

时间戳与每词结果均已随 review 事件落库（`ReviewEvent.time` + 上述分类字段），
后续「最晚背到几点」「遗忘最多的单词」无需再改数据层，直接在本包聚合。

## 使用

```ts
import { computeStreak, computeTotalDays, countReviewOutcomes } from "@lexilexi/stats";

const reviews = await db.events.where("type").equals("review").toArray();
const streak = computeStreak(reviews, new Date().toISOString());
```

## 路线

- 后续迭代：保留率（FSRS retrievability 聚合）、学习趋势图、每日目标、
  「最晚背到几点」「遗忘最多的单词」、年度总结页面（依赖本包时间维度数据）。
