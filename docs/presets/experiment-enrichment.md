# 富化管线实验报告（RAY-268 批次 A 三项实验）

> 生成时间：2026-08-15（脚本：scripts/presets/build-enrichment.mjs，全流程 ~104s）
> **2026-08-19 追加（RAY-344 中文词源/词根词缀完整性回填）**：本节"体积口径"
> 数据已从 RAY-268 初版（Tier 0 brotli 977 KB / etymologyZh 64 字 /
> wordPartsNote 8 字）迁移到 RAY-344 新版（Tier 0 brotli ≈ 1.28 MB /
> etymologyZh 384 字 / wordPartsNote 32 字 + sentence-boundary 截断），
> 详见下方"附：富化数据体积"及后续 RAY-344 行项。
> 数据来源：kaikki.org 英语词典（CC BY-SA 4.0 + GFDL，快照 Last-Modified 2026-08-12，3.21 GB /
> 1,487,640 行，SHA256 `34b1929e…`）+ Tatoeba（CC BY 2.0 FR / CC0 子集）+ ipa-dict
> （en_US MIT / en_UK GPL-3.0，commit 43c3570）+ OpenEtymology（CC BY-SA 4.0，commit 7d89f36）

## 实验一：Tatoeba 中英句对覆盖率（例句形态决策门）

**口径**：Tier 0 词表（7,195 词）按 term join Tatoeba 中英句对池（eng-cmn_links.tsv），
句对按句许可过滤（仅保留 CC BY / CC0 句子）；按句对池直接统计（不经产物例句上限），
「达标」= 词表覆盖率与句对供给量足以支撑中英句对首发。

> **「按句许可过滤」口径说明**（Oscar 评审 suggestion 4）：官方 per_language
> 导出**不含逐句 license 列**，当前 `licenseOf()` 对非 CC0 子集的句子一律按
> 默认许可 CC BY 处理，白名单（CC BY / CC0）两者均放行——在现有导出格式下
> 这是事实正确的处理（文本句仅这两种许可形态），但「过滤」实际未拒绝任何
> 句子，属口径性处理而非发生过真实过滤。**待上游导出引入 license 列（或改采
> detailed export）后，将 `lib/tatoeba.mjs` 的 `licenseOf()` 升级为逐句过滤**，
> 届时本实验数字需按真实过滤后口径复测。此口径已同步记录在
> `scripts/presets/sources/tatoeba/README.md`。

| 指标 | 数值 |
|---|---|
| Tier 0 词表词条数 | 7,195 |
| 句对池许可过滤后可用英文句 | 72,209 |
| 有 ≥1 可用句对的 Tier 0 词条 | 5,097（70.8%） |
| 有 ≥2 可用句对的 Tier 0 词条 | 3,976（55.3%） |
| 有 ≥3 可用句对的 Tier 0 词条 | 3,350（46.6%） |
| 池内人均句对（前 8 条口径） | 3.39 |

**决策**：**达标 → 中英句对首发**。70.8% 核心词至少一条中英句对、46.6% 可配满
Tier 0 产物上限；产物口径：Tier 0 例句上限 2 条（句对优先），无句对词补 1 条
kaikki 英文例句兜底 → 最终双语例句覆盖 70.8%、任一例句覆盖 90.3%（6,500 词）。
双语例句缺失的近 30% 词条以英文例句 + 中文释义覆盖，不阻塞首发。

## 实验二：kaikki 裁剪后各域覆盖率（Tier 0 / Tier 1）

**口径**：kaikki 全量 JSONL 按 Tier 0 / Tier 1 词表裁剪（term 小写命中），逐域统计
词条级覆盖率；quotation 已按 RAY-257 口径过滤（仅保留 type==="example"）。下表为
kaikki 源域口径（未经优先级合并与产物截断）。

| 域 | Tier 0 命中 | Tier 0 覆盖率 | Tier 1 命中 | Tier 1 覆盖率 |
|---|---|---|---|---|
| 例句（examples） | 5,719 | 79.5% | 17,031 | 29.2% |
| 近义词（synonyms） | 5,530 | 76.9% | 22,573 | 38.8% |
| 反义词（antonyms） | 1,028 | 14.3% | 3,136 | 5.4% |
| 派生词（derived） | 6,178 | 85.9% | 24,316 | 41.7% |
| 词源（etymology） | 7,067 | 98.2% | 47,259 | 81.1% |
| kaikki 音标（sounds.ipa） | 4,817 | 66.9% | 21,667 | 37.2% |

优先级合并后的最终产物覆盖率（ipa-dict 主力 → kaikki 补缺 → OpenEtymology 补缺；
例句 Tatoeba 句对优先 → kaikki 英文原句兜底）：

| 域 | Tier 0 最终 | Tier 1 最终 |
|---|---|---|
| 例句（任一） | 90.3% | 35.7% |
| 例句（中英双语） | 70.8% | 17.2% |
| 音标（US 或 UK） | 99.6% | 87.1% |

双音标一致性（符号体系差异测量，非质量门槛）：kaikki US vs ipa-dict 9.2%（4,517 对）、
kaikki UK vs ipa-dict 1.4%（4,240 对）、OpenEtymology US vs ipa-dict 4.4%（2,975 对）——
证实「ipa-dict 主力 + kaikki/OpenEtymology 仅补缺」的优先级正确（kaikki 音标为
cmudict 派生符号，与 Wiktionary IPA 体系直接冲突率低）。

**缺口评估**：antonyms 14.3% / 5.4% 为反义词数据的本性（反义词天然稀疏，kaikki
已接近免费数据源供给上限），**不触发 MorphyNet / OEWN 首批接入**；kaikki 音标
源域 66.9% / 37.2% 经 ipa-dict 主力补足至 99.6% / 87.1%，无需新增音标源。
无任何域跌破决策门阈值，首批按 kaikki 单源交付。

## 实验三：首启导入耗时基准

**口径**：vitest 4.1.10 bench（Node + fake-indexeddb 6.2.5，2026-08-15 干净单套件运行），
对照三条路径：Tier 0 基线冷装（无富化）/ Tier 0 冷装 + 富化内联 / 存量库富化回填。
回填路径已按 Oscar 评审 suggestion 1 重构（单次全量读建内存 Map + 主键 CAS 分块写回）。
真实设备数据待真机试用复测。

| 路径 | 词条数 | 耗时 | 每千词耗时 |
|---|---|---|---|
| Tier 0 基线冷装 | 7,195 | 1,061 ms | ~147 ms |
| Tier 0 冷装 + 富化内联 | 7,195 | 1,152 ms | ~160 ms |
| 存量库富化回填 | 7,195 | 27,703 ms | ~3.85 s |
| （对照）1,000 词样本冷装 | 1,000 | mean 125.2 ms / p99 254.5 ms | ~125 ms |

解读：

- 富化内联与基线冷装耗时相当（~90ms 单样本噪声级差异）——富化包与词表同分块
  事务写入，不增加安装轮次，内联路径无额外成本。
- 存量库回填 27.7s 为 suggestion 1 重构后口径：单次全量读 senses 建内存小写
  Map、分块按主键 CAS 写回，消除了此前每块 `anyOfIgnoreCase` 全扫描的
  O(块数 × 词表) 放大（重构前同环境 46.4s，降约 40%）。剩余耗时仍受
  fake-indexeddb 放大（真实浏览器原生索引 + 结构化克隆更快，预期再快一个
  数量级）；回填分块写 meta 进度、中断续装，不阻塞 UI。**真机复测待办**
  （首启后后台回填，用户体验不受 27s 级耗时影响）。
- 早期一轮 bench 数字（冷装 999ms / 回填 38.8s）与本次不一致：当时 vitest bench
  把 `dist/` 编译产物中的重复 bench 套件一并运行（并行争抢 CPU）；已修复
  （`tsconfig.build.json` 排除 bench 文件 + `vitest.config.ts` 排除 dist），
  本报告采用干净单套件口径。

## 附：富化数据体积

| 指标 | RAY-268 初版 (v1.0.0) | RAY-344 修订 (v1.3.0) |
|---|---|---|
| Tier 0 富化包词条数 | 7,182 | 7,182 |
| Tier 0 富化包 raw | 3,589 KB | **4,730 KB** |
| Tier 0 富化包 gzip | 1,468 KB | — |
| Tier 0 富化包 brotli-11 | 977 KB（999,950 字节） | **1,280 KB**（1,310,552 字节） |
| Tier 0 etymologyZh 上限 | 64 字 | **384 字**（sentence-boundary） |
| Tier 0 wordPartsNote 上限 | 8 字 | **32 字**（sentence-boundary） |
| Tier 0 etymology 上限 | 84 字 | 84 字（sentence-boundary 复检） |
| Tier 1 富化包词条数 | 56,206 | 56,206 |
| Tier 1 富化包 raw / gzip / brotli-11 | 23,903 KB / 8,651 KB / 5,780 KB | 23,903 KB / 8,651 KB / 5,780 KB（未动） |

> **RAY-344 红线偏移**：原 Tier 0 富化 brotli 977 KB < 1 MB（首启按需加载，
> 余量 ~48 KB）硬约束已被 RAY-318 一次（64 → 384 字，977 → 1,269 KB）、
> RAY-344 一次（wordPartsNote 8 → 32 字 + sentence-boundary，1,269 →
> 1,280 KB）两次突破；当前 Tier 0 富化 brotli ≈ 1.28 MB，超原 1MB 红线
> 约 256 KB。
>
> - **2026-08-19 owner 评审**（待补）：1MB 红线上调到 1.28 MB 需走 owner
>   评审（Jack 拍板）；Knox 已附 reviewer/owner 确认到 PR 描述后，
>   README 与本节口径方为终态。
> - **代价**：首启 Tier 0 富化包下载 +303 KB（brotli 977 → 1,280 KB，
>   +31%），仍属可控范围（首启 PWA 整体 bundle 远大于此）。
> - **收益**：wordParts 注释 8 字硬切 100% → sentence-boundary 32 字
>   （p95 24/p99 31 完全覆盖，全角括号外切残段消除，3711 条恢复）；
>   etymologyZh 64 字硬切 6245/6247 → sentence-boundary 384 字（覆盖
>   OE 源 100% 词条，6244 条恢复；剩余 ~3 条 OE 源本身 < 64 字）。
>
> Tier 0 收敛参数：例句上限 2 条（无句对词只补 1 条英文兜底）、近/反/派生
> 3/3/2、词源 84 字符（sentence-boundary）、中文词源 384 字（sentence-
> boundary）、词缀注释 32 字（sentence-boundary）；Tier 1 保留完整内容
> （3 条例句、8/8/12、词源 400 字符）。
>
> 截断函数（truncateAtBoundary / trimWordPartsNote）抽到
> `scripts/presets/lib/truncate.mjs`，build-enrichment.mjs 与
> backfill/ray344.mjs 共用同一份实现（RAY-344 沉淀口径同步约定）。
