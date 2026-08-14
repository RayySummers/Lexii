# 预设词表质量校验报告（RAY-258 质量门槛）

> 生成时间：2026-08-14T18:31:00.904Z（脚本：scripts/presets/verify-quality.mjs）
> 校验口径（RAY-258 口径约束）：NGSL 高频核心词以 Wiktionary 交叉校验 + 抽样校对
> 作为内置包质量门槛；ECDICT 中文释义为 MVP 基线。

## 1. NGSL 1.2 → ECDICT 释义覆盖

| 指标 | 数值 |
|---|---|
| NGSL 1.2 总词数 | 2809 |
| ECDICT 清洗结果命中 | 2809 |
| 覆盖率 | 100.0% |
| 未命中 | 0 |

## 2. Wiktionary 抽样交叉校验（固定种子抽样，可复现）

| 指标 | 数值 |
|---|---|
| 抽样数 | 40 |
| Wiktionary 存在且含英文释义 | 40 |
| 通过率 | 100.0% |
| 抽样词序（NGSL 行号） | 28, 49, 116, 168, 290, 380, 482, 514, 620, 768, 977, 982, 1025, 1121, 1151, 1172, 1268, 1273, 1374, 1490, 1673, 1717, 1735, 1779, 1885, 1955, 1965, 1970, 2043, 2149, 2304, 2310, 2370, 2434, 2510, 2539, 2610, 2619, 2735, 2776 |

## 3. 抽样对照表（ECDICT 中文释义 vs Wiktionary 英文释义，供人工校对）

| 词条 | ECDICT 中文释义（第一条） | Wiktionary 英文释义（第一条） |
|---|---|---|
| or | 或, 或者 | ISO 639-1 language code for Odia. |
| see | 看见, 查看, 参观, 游览, 理解, 知道, 同意 | ISO 639-3 language code for Seneca. |
| feel | 感觉, 觉得, 触摸, 以为 | To use or experience the sense of touch. To become aware of through the skin; to use the sense of touch on. |
| woman | 女人, 妇女, 女仆 | An adult female human. |
| actually | 事实上, 竟然, 如今, 现在 | In act or in fact; really; in truth; positively. |
| social | 社会的, 群居的, 社交的 | Being extroverted or outgoing. |
| date | 日期, 约会, 枣椰树 | The fruit of the date palm, Phoenix dactylifera, somewhat in the shape of an olive, containing a soft, sweet pulp and en |
| act | 行动, 行为, 幕, 法案 | ISO 639-3 language code for Achterhooks. |
| arm | 手臂, 袖子, 狭长港湾, 武器 | ISO 639-2/B language code for Armenian. |
| statement | 陈述, 指令, 声明 | A declaration or remark. |
| weight | 重, 重量, 体重, 砝码, 重大, 影响, 力量 | The downwards force an object experiences due to gravity. |
| somebody | 了不起的人, 大人物 | Some unspecified person. |
| prevent | 预防, 防止, 阻止, 妨碍 | To stop (an outcome); to keep from (doing something). .mw-parser-output .defdate{font-size:smaller} |
| suit | 套装, 诉讼, 请求, 起诉, 套, 组 | A set of clothes to be worn together, now especially a man's matching jacket and trousers (also business suit or lounge  |
| mistake | 错误, 误会 | To understand wrongly, taking one thing or person for another. |
| select | 挑选出来的, 极好的 | Privileged, specially selected. |
| unfortunately | 恐怕, 不幸的是 | Happening through bad luck, or because of some unfortunate event. |
| appreciate | 赏识, 鉴别, 为...而感激, 领会, 欣赏 | To be grateful or thankful for. |
| sum | 总数, 总和, 金额, 概要, 顶点 | Former ISO 639-3 language code for Sumo-Mayangna. |
| cup | 杯子, 茶杯, 优胜杯 | ISO 639-3 language code for Cupeño. |
| ideal | 理想, 典范, 观念, 思想, 最后目标 | Pertaining to ideas, or to a given idea. |
| unable | 不能的, 不会的 | Not able; lacking a certain ability. |
| county | 县, 郡 | The land ruled by a count or a countess. |
| enormous | 巨大的, 庞大的 | Deviating from the norm; unusual, extraordinary. |
| defeat | 败北, 失败 | To overcome in battle or contest. |
| criticism | 批评, 评论, 非难 | The act of criticising; a critical judgment passed or expressed. |
| examination | 考试, 测验, 审查 | The act of examining. |
| delight | 高兴, 愉快 | Joy; pleasure. |
| framework | 结构, 骨架, 参照标准, 准则, 观点 | A support structure comprising joined parts or conglomerated particles and intervening open spaces of similar or larger  |
| height | 高度, 海拔, 高地, 顶点 | The distance from the base to the top of something. |
| lend | 借, 贷款给, 增添, 提供, 出租 | To allow to be used by someone temporarily, on condition that it or its equivalent will be returned. |
| edit | 编辑, 编校, 修订, 剪辑 | A change to the text of a document. |
| custom | 习惯, 风俗, 海关, 自定义 | Frequent repetition of the same behavior; way of behavior common to many; ordinary manner; habitual practice; method of  |
| illustration | 例证, 插图 | The act of illustrating; the act of making clear and distinct. |
| pregnant | 怀孕的, 充满的, 思想丰富的, 成果丰硕的 | Carrying developing offspring within the body. |
| tail | 尾部, 后部, 辫子, 随员, 特务, 燕尾服, 踪迹, 限定继承(权) | The caudal appendage of an animal that is attached to their posterior and near the anus or cloaca. |
| scan | 审视, 浏览, 扫描, 细查 | To examine sequentially, carefully, or critically; to scrutinize; to behold closely. .mw-parser-output .defdate{font-siz |
| chocolate | 巧克力 | A food made from ground roasted cocoa beans. |
| refugee | 难民, 流亡者 | A person seeking refuge (as for shelter or protection), especially in a foreign country, out of fear or prospect of poli |
| theoretical | 理论的, 理论上的, 假设的, 推理的 | Of or relating to theory; abstract; not empirical. |

> 释义质量结论与人工校对由 Jack/用户侧执行；本报告为可复现的机器校验基线。
