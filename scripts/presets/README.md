# 预设词表打包管线（scripts/presets）

RAY-258「Tier 0 预设词表打包与内置」的离线打包管线。纯 Node 内置 API（无第三方依赖），
所有脚本可在任意环境复现；产物（Tier 0）提交进仓库、随 PWA 打包，运行时零网络依赖。

## 数据来源与许可

| 来源                                                                    | 许可                 | 用途                                                 | 出处核对              |
| ----------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- | --------------------- |
| [ECDICT](https://github.com/skywind3000/ECDICT)                         | MIT（© 2025 Linwei） | 主力词库：中文释义 / 音标 / 词性 / 考试分级标签      | repo `LICENSE` 文件   |
| [NGSL 1.2](https://www.newgeneralservicelist.com/)                      | CC BY-SA 4.0         | 「高频核心」选词基准（2,809 词），join ECDICT 补释义 | 官网下载页声明        |
| [Wiktionary](https://kaikki.org/dictionary/rawdata.html)（kaikki 提取） | CC BY-SA 4.0 + GFDL  | 本阶段仅抽样交叉校验（未随包分发）；中期富化管线接入 | Wiktionary 官方版权页 |

许可义务：MIT 需保留版权声明（见 `packages/core/src/presets/notices.ts` 的
`THIRD_PARTY_NOTICES`）；CC BY-SA 需署名 + 相同方式共享（内置数据为过滤/合并的派生
产物，随包声明修改）。面向用户的中文文案与 NOTICE 正式稿由 Vega（RAY-259）提供。

## 目录结构

```
scripts/presets/
  fetch-ecdict.mjs        下载 ECDICT 全量 CSV（固定 commit + SHA256 校验）
  analyze.mjs             格式清洗实验（行数/拒绝原因/体积 → docs/presets/experiment.md）
  verify-quality.mjs      质量门槛：NGSL 释义覆盖 + Wiktionary 抽样交叉校验
  build.mjs               清洗 → 分级（Tier 0/1/2）→ 生成内置数据
  lib/ecdict.mjs          ECDICT 解析/清洗/词性提取/体积统计（共享库）
  sources/ngsl/           已内置的 NGSL 1.2 词表（含出处与许可说明）
  .data/ecdict/           ECDICT 下载缓存（git 忽略）
  output/                 Tier 1/2 产物与构建审计（git 忽略）
```

## 使用方式

```bash
# 1. 下载 ECDICT（一次性；固定 commit bc015ed，SHA256 校验）
node scripts/presets/fetch-ecdict.mjs

# 2. 清洗实验（对照 RAY-257 简报方案实测行数/体积）
node scripts/presets/analyze.mjs

# 3. 质量校验（NGSL 覆盖 + Wiktionary 抽样交叉校验，网络只读）
node scripts/presets/verify-quality.mjs

# 4. 生成内置数据（Tier 0 → packages/core/src/presets/tier0.data.json，提交进仓库）
node scripts/presets/build.mjs --tier 0
node scripts/presets/build.mjs --tier 1   # 扩展包产物（不随包分发）
node scripts/presets/build.mjs --tier 2   # 全量产物（不随包分发）
```

## 分级口径（RAY-258，Jack 拍板）

| 层级            | 内容                                           | 实测词条 | 压缩体积（brotli-11） | 分发方式                   |
| --------------- | ---------------------------------------------- | -------- | --------------------- | -------------------------- |
| Tier 0 内置核心 | ECDICT tag ∈ {zk,gk,cet4,cet6} ∪ NGSL 1.2 join | 7,195    | 225 KB                | 随 PWA 打包，首启安装      |
| Tier 1 标准     | 全考试标签 ∪ collins>0 ∪ oxford>0 ∪ 词频>0     | 58,244   | 1.3 MB                | 扩展包产物（本阶段仅生成） |
| Tier 2 全量     | 清洗后全部合法词条                             | 401,224  | 6.5 MB                | 扩展包产物（本阶段仅生成） |

## 清洗规则（与 core 侧口径一致）

- 词条形状：`TERM_PATTERN`（英文字母/撇号/连字符/点），过滤短语/词缀/非英语行；
- 释义：换行与半角 `;` 规范化 → 全角分号分隔；超长按 500 字符在「；」边界截断；
- 词性：从释义段首剥离词性标记（`n.`/`vt.`/`a.` 等，见 `POS_MARKERS`）并入 `pos` 字段；
- 去重：term 小写去重，首现优先；按 term 字典序排序。

## 产物格式与运行时契约

Tier 0 产物为紧凑元组 JSON：`{ id, version, name, generatedAt, source, entries }`，
`entries` 为 `[term, definitions, pos, ipa, tags]` 五元组（全字符串）。运行时
`packages/core/src/presets/tier0.ts` 装载时做 parse-don't-validate（结构/词条形状/
去重校验，损坏立即抛错），并由 `packages/core/src/presets/tier0.test.ts` 锁定
「生成 → 装载」契约（词条数、排序、标签口径）。修改清洗规则后必须：

1. 重新生成 tier0.data.json；2. 更新 tier0.test.ts 的期望值；3. 更新本 README 与
   `docs/presets/experiment.md` 的实测数字。

## 首启导入耗时基准

`pnpm --filter @lexilexi/core bench`（vitest bench，Node + fake-indexeddb）：
全量 Tier 0（7,195 词条 × 4 记录，分块 400/块）冷装实测 ~665ms（单样本，内存实现
下界）。真实设备数据待真机试用复测。安装器分块事务 + 块间让出事件循环，UI 不阻塞；
中断后从断点续装（进度写入 meta 表，与块同事务）。
