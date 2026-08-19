# 预设词表打包管线（scripts/presets）

RAY-258「Tier 0 预设词表打包与内置」与 RAY-268 批次 A「富化管线」的离线打包管线。
纯 Node 内置 API（无第三方依赖；bzip2 解压用 vendored MIT 库 seek-bzip，见
`lib/vendor/seek-bzip/`），所有脚本可在任意环境复现；产物（Tier 0 + Tier 0 富化）
提交进仓库、随 PWA 打包，运行时零网络依赖。

## 数据来源与许可

| 来源                                                                    | 许可                           | 用途                                                                  | 出处核对               |
| ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | ---------------------- |
| [ECDICT](https://github.com/skywind3000/ECDICT)                         | MIT（© 2025 Linwei）           | 主力词库：中文释义 / 音标 / 词性 / 考试分级标签                       | repo `LICENSE` 文件    |
| [NGSL 1.2](https://www.newgeneralservicelist.com/)                      | CC BY-SA 4.0                   | 「高频核心」选词基准（2,809 词），join ECDICT 补释义                  | 官网下载页声明         |
| [Wiktionary](https://kaikki.org/dictionary/rawdata.html)（kaikki 提取） | CC BY-SA 4.0 + GFDL            | 富化：例句（仅编者自造句）/ 近反义词 / 派生词 / 英文词源 / 双音标校验 | Wiktionary 官方版权页  |
| [Tatoeba](https://downloads.tatoeba.org/exports/per_language/)          | CC BY 2.0 FR（默认）+ CC0 子集 | 富化：eng-cmn 双语例句（按句许可过滤，仅保留 CC BY / CC0）            | ToU §6.2 + 版权页      |
| [ipa-dict](https://github.com/open-dict-data/ipa-dict)                  | MIT（en_US）/ GPL-3.0（en_UK） | 富化：双音标主力（仅摄取 en_US / en_UK，避开 NC 语种文件）            | repo README 双链声明   |
| [OpenEtymology](https://github.com/openetymology/OpenEtymology)         | CC BY-SA 4.0                   | 富化：词根词缀拆解 + 中文词源（五册 EPUB 解析）                       | repo `DATA_LICENSE.md` |

许可义务：MIT 需保留版权声明（见 `packages/core/src/presets/notices.ts` 的
`THIRD_PARTY_NOTICES`）；CC BY-SA 需署名 + 相同方式共享（内置数据为过滤/合并的派生
产物，随包声明修改）；GPL-3.0（ipa-dict en_UK 数据）的分发条款见
`sources/ipa-dict/README.md`。面向用户的中文文案与 NOTICE 正式稿由 Vega（RAY-259/271）提供。

## 目录结构

```
scripts/presets/
  fetch-ecdict.mjs          下载 ECDICT 全量 CSV（固定 commit + SHA256 校验）
  fetch-kaikki.mjs          下载 kaikki 英语 JSONL（多连接断点续传 + manifest 校验）
  fetch-tatoeba.mjs         下载 Tatoeba eng/cmn 句库与链接表（bz2 解压 + SHA256）
  fetch-ipa-dict.mjs        下载 ipa-dict en_US/en_UK（固定 commit + SHA256 校验）
  fetch-openetymology.mjs   下载 OpenEtymology 五册 EPUB 与数据许可（固定 commit + SHA256）
  analyze.mjs               格式清洗实验（行数/拒绝原因/体积 → docs/presets/experiment.md）
  verify-quality.mjs        质量门槛：NGSL 释义覆盖 + Wiktionary 抽样交叉校验
  build.mjs                 清洗 → 分级（Tier 0/1/2）→ 生成内置词表
  build-enrichment.mjs      富化管线：四源 join → Tier 0/1 富化包 + 实验统计
  lib/ecdict.mjs            ECDICT 解析/清洗/词性提取/体积统计（共享库）
  lib/kaikki.mjs            kaikki JSONL 字段抽取与多行合并
  lib/tatoeba.mjs           Tatoeba 句对池 / 许可过滤 / 倒排索引 join
  lib/ipadict.mjs           ipa-dict TSV 解析
  lib/openetymology.mjs     OpenEtymology EPUB 解析（ZIP + XHTML 词条区块）
  lib/zip.mjs               最小 ZIP 读取器（EPUB 容器）
  lib/bz2.mjs               bzip2 解压（vendored seek-bzip 包装）
  lib/vendor/seek-bzip/     vendored MIT 库（npm seek-bzip 2.0.0）
  sources/ngsl/             已内置的 NGSL 1.2 词表（含出处与许可说明）
  sources/kaikki/           来源与许可溯源说明（数据 3.2GB，不 vendored）
  sources/tatoeba/          来源与许可溯源说明
  sources/ipa-dict/         来源与许可溯源说明（含 GPL-3.0 分发条款）
  sources/openetymology/    来源与许可溯源说明
  .data/                    下载缓存（git 忽略；manifest/SHA256 固定快照）
  output/                   扩展包产物与实验统计（git 忽略）
```

## 使用方式

```bash
# 1. 下载词表数据源（一次性；固定 commit / SHA256 校验；kaikki 支持多连接断点续传）
node scripts/presets/fetch-ecdict.mjs
node scripts/presets/fetch-kaikki.mjs --connections 16
node scripts/presets/fetch-tatoeba.mjs
node scripts/presets/fetch-ipa-dict.mjs
node scripts/presets/fetch-openetymology.mjs

> kaikki 下载带单实例锁（`.data/kaikki/.kaikki-fetch.lock`）：并发两个下载
> 进程写同一组分片会互相污染字节，锁文件命中即拒绝启动；确认没有并发
> 下载后可删除锁文件或加 `--force` 强制继续。

# 2. 生成内置词表（Tier 0 → packages/core/src/presets/tier0.data.json，提交进仓库）
node scripts/presets/build.mjs --tier 0
node scripts/presets/build.mjs --tier 1   # 扩展包产物（不随包分发）
node scripts/presets/build.mjs --tier 2   # 全量产物（不随包分发）

# 3. 生成富化包（单条统一管线，RAY-268；Tier 0 富化提交进仓库）
node scripts/presets/build-enrichment.mjs
#    产物：
#    packages/core/src/presets/enrichment.tier0.data.json（随 PWA 打包）
#    output/enrichment.tier1.json（扩展包产物）
#    output/enrichment-report.json（三项实验统计：Tatoeba 覆盖率决策门 /
#      kaikki 各域覆盖率 / 体积）
```

## 分级口径（RAY-258，Jack 拍板）

| 层级            | 内容                                           | 实测词条 | 压缩体积（brotli-11） | 分发方式                   |
| --------------- | ---------------------------------------------- | -------- | --------------------- | -------------------------- |
| Tier 0 内置核心 | ECDICT tag ∈ {zk,gk,cet4,cet6} ∪ NGSL 1.2 join | 7,195    | 224 KB                | 随 PWA 打包，首启安装      |
| Tier 1 标准     | 全考试标签 ∪ collins>0 ∪ oxford>0 ∪ 词频>0     | 58,244   | 1.2 MB                | 扩展包产物（本阶段仅生成） |
| Tier 2 全量     | 清洗后全部合法词条                             | 401,222  | 6.4 MB                | 扩展包产物（本阶段仅生成） |

## 富化管线（RAY-268 批次 A）

单条统一管线（RAY-257 计划的富化管线与本批次合并为同一条，无双线并行）：

1. **词表裁剪**：Tier 0 词表读取自已提交的 `tier0.data.json`；Tier 1 词表按
   `lib/ecdict.mjs` 分级口径现场计算（与 build.mjs 同 lib，不依赖其产物）。
2. **kaikki 流式抽取**：3.2GB JSONL 逐行解析，仅命中目标词表的词条抽取
   （例句/近反义/派生/词源/双音标）；quotation 引用句过滤（仅 `type === "example"`
   的编者自造句，fair use 口径，RAY-257 既定）。
3. **字段优先级**（RAY-267 拍板口径）：
   - 双音标：ipa-dict 为主力 → kaikki sounds 补缺 → OpenEtymology 补缺；
   - 例句：Tatoeba 句对（含中文译文）优先；Tier 0 每词至多 2 条、无句对词
     补 1 条 kaikki 英文原句兜底，Tier 1 每词至多 3 条；
   - 词根词缀/中文词源：OpenEtymology；英文词源文本：kaikki `etymology_text`。
4. **产物条目**：紧凑元组 `[term, ipaUs, ipaUk, synonyms, antonyms, derived,
etymology, wordParts, etymologyZh, examples]`；词列表以换行符连接；无任何
   富化字段的词条不产出记录。运行时契约见 `packages/core/src/presets/enrichment.ts`
   （parse-don't-validate + 回填），体积口径：Tier 0 富化 brotli **≈ 1.28 MB**
   （RAY-344 起偏离原 1MB 红线——wordParts 注释 8 → 32 字 + 中文词源 64 → 384
   字换回的完整内容质量；与 RAY-318 同档，三项实验数据见
   `docs/presets/experiment-enrichment.md`）。

三项实验（决策门与覆盖率）实测数字见 `docs/presets/experiment-enrichment.md`。

## 清洗规则（与 core 侧口径一致）

- 词条形状：`TERM_PATTERN`（英文字母/撇号/连字符/点），过滤短语/词缀/非英语行；
  唯一定义在 `packages/core/src/termPattern.js`——core 与打包脚本 import 同一文件，
  无双处维护（RAY-260 评审 nit 1）；
- 释义：换行与半角 `;` 规范化 → 全角分号分隔；超长按 500 字符在「；」边界截断；
- 词性：从释义段首剥离词性标记（`n.`/`vt.`/`a.` 等，见 `POS_MARKERS`）并入 `pos` 字段；
- 领域标记：剥离释义段首的 `[医]`/`[法]`/`[计]` 等 ECDICT 领域标记
  （`^\[[^\]]+\]`，可连续多个；与词性标记交替剥离，「`n. [医] 解剖`」与
  「`[医] n. 解剖`」两种形态都剥净，RAY-260 评审 suggestion 1）；
- 去重：term 小写去重，首现优先；按 term 字典序排序。

## 产物格式与运行时契约

Tier 0 产物为紧凑元组 JSON：`{ id, version, name, generatedAt, source, entries }`，
`entries` 为 `[term, definitions, pos, ipa, tags]` 五元组（全字符串）。`definitions`
以换行符连接多条释义——清洗阶段已保证释义文本内不含换行，换行连接是无损往返
（全角分号可能出现在释义文本内，不作连接符，RAY-260 评审 nit 3）。运行时
`packages/core/src/presets/tier0.ts` 装载时做 parse-don't-validate（结构/词条形状/
去重校验，损坏立即抛错），并由 `packages/core/src/presets/tier0.test.ts` 锁定
「生成 → 装载」契约（词条数、排序、标签口径、领域标记与词性标记剥离）。修改清洗规则后必须：

1. 重新生成 tier0.data.json；2. 更新 tier0.test.ts 的期望值；3. 更新本 README 与
   `docs/presets/experiment.md` 的实测数字。

富化产物同构：`enrichment.tier0.data.json` 的 `entries` 为十元组（见上），运行时
`packages/core/src/presets/enrichmentTier0.ts` 装载校验，并由
`packages/core/src/presets/enrichment.test.ts` 锁定「生成 → 装载」契约。富化字段为
记录级可选字段，不改 IndexedDB schema（回填见 `backfillEnrichment`，不清库）。

## 首启导入耗时基准

`pnpm --filter @lexii/core bench`（vitest bench，Node + fake-indexeddb）：
全量 Tier 0（7,195 词条 × 4 记录，分块 400/块）冷装实测 ~1.1s（单样本，内存实现
口径）；富化内联冷装与存量库回填基准（RAY-268 实验三，回填已按 Oscar 评审
suggestion 1 重构为单次全量读 + 主键 CAS 写回）见
`docs/presets/experiment-enrichment.md`。真实设备数据待真机试用复测。安装器分块
事务 + 块间让出事件循环，UI 不阻塞；中断后从断点续装（进度写入 meta 表，与块同事务）。
