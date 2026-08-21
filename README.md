# 乐希 Lexii

> 用自己写的软件，背自己的词。

定制化背单词体验：现代简洁、多语言、支持导入词库、**local-first**。

[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

Lexii 是一款本地优先的词汇学习应用：数据只存在你自己的设备上，断网也能完整使用。核心由 **FSRS-7** 间隔重复算法驱动，配合学习评测（`lexii_eval`）把「用户怎么作答」转化为可验证的学习证据。

**在线体验**：<https://rayysummers.github.io/Lexii/>（开发预览：<https://rayysummers.github.io/Lexii/dev/>）

## 特性

- 开源：GPL-3.0-or-later
- Web / PWA 优先（可安装、离线可用）
- 内置核心词表开箱即用；扩展词包（约 5.8 万 / 40 万词）在应用内主动下载、离线检索
- 词库自由导入（CSV），导入数据仅存本机
- 数据属于你：本地存储 + 一键导出（JSON 可原样导回）

## 原则

1. **Web / PWA 优先** — 先做 Web，后续可打包为 PWA，再考虑 F-Droid / Android
2. **Local-first** — 数据不出设备，所有核心功能离线可用
3. **开源** — GitHub 分发，GPL-3.0-or-later 许可
4. **本地优先** — 不依赖云端服务；AI 能力（若未来提供）采用 BYOK，且只在 `packages/ai`
5. **隐私** — 不发送学习数据到任何外部服务，不埋点、不统计

## 快速开始

```bash
pnpm install
pnpm dev              # 启动 dev server（apps/web）
pnpm typecheck        # 递归跑全 6 个 workspace 的 tsc（见下方「PR 前自检」）
pnpm test             # Vitest 全量测试
pnpm build            # 全量构建
pnpm lint             # ESLint + Prettier 检查
```

环境要求：Node.js ≥ 20、pnpm 10。

### PR 前自检

提交 PR 前至少在本地跑一遍 `pnpm -r typecheck`：

```bash
pnpm -r typecheck    # 递归扫全 6 个 workspace：apps/web + packages/{core,fsrs,eval,stats,ai}
```

**为什么必须 `-r`**：本仓库是 pnpm monorepo，每个 workspace 自带一份 `tsconfig.json`。单跑 `apps/web` 的 `tsc --noEmit` 只覆盖 `apps/web` 这一个项目，**任何对 `packages/*` 的类型改动（尤其是手写 type literal 漏字段）都不会被本地 typecheck 抓到**，只能等到 CI `Build & Test` 用 `pnpm -r typecheck` 递归扫全 6 个 workspace（`apps/web` + `packages/{core,fsrs,eval,stats,ai}`）时才报错，徒增一轮 CI red。跨包 PR 必须把这条纳入自检。完整 PR 流程与 13 条评审标准见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 技术栈

| 层     | 选型                        |
| ------ | --------------------------- |
| 语言   | TypeScript（strict）        |
| 前端   | React + Vite + Tailwind CSS |
| 测试   | Vitest                      |
| 包管理 | pnpm workspace（monorepo）  |
| 存储   | IndexedDB（Dexie）          |
| 调度   | FSRS-7                      |
| 许可   | GPL-3.0-or-later            |

## 仓库结构（Monorepo）

```
Lexii/
├── apps/
│   └── web/            # Web / PWA 应用（只做界面）
├── packages/
│   ├── core/           # 核心领域模型与共享类型
│   ├── fsrs/           # FSRS-7 调度算法
│   ├── eval/           # 学习评测（lexii_eval）
│   ├── stats/          # 学习统计
│   └── ai/             # AI 能力（空壳 + 规划文档，MVP 不做）
└── ...
```

分层约束：`apps/web` 只做界面；算法逻辑一律在 `packages/`；跨包引用走公开 API。

> packages 的打包约定与未来发布 checklist 见 [packages/README.md](./packages/README.md)。

## 文档

| 文档                                                 | 说明                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                 | PR 流程、代码评审标准（13 条）、评审流程、发版流程           |
| [ROADMAP.md](./ROADMAP.md)                           | 首期 20 天计划与里程碑、下一期方向                           |
| [docs/domain-model.md](./docs/domain-model.md)       | 领域模型设计（Learning Item / Sense / Memory State / Event） |
| [packages/fsrs/README.md](./packages/fsrs/README.md) | FSRS-7 实现与版本口径（对照官方参考实现验证）                |
| [packages/ai/README.md](./packages/ai/README.md)     | AI 能力规划（BYOK、忆语）与「为什么 MVP 不做」               |

## 词表数据与许可

乐希的词表由第三方开放数据源清洗、整理而成，随应用内置或由你在应用内主动下载。以下为全部来源、许可与用途：

| 来源                                                                           | 许可                           | 用途                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------ |
| [ECDICT](https://github.com/skywind3000/ECDICT)                                | MIT（Copyright © 2025 Linwei） | 预设词表主力词库：中文释义、词性、音标与考试分级标签                     |
| [NGSL 1.2](https://www.newgeneralservicelist.com/)                             | CC BY-SA 4.0                   | 「高频核心」选词基准（2,809 词），与 ECDICT 合并补充释义                 |
| [Wiktionary](https://kaikki.org/dictionary/rawdata.html)（经 kaikki.org 提取） | CC BY-SA 4.0 + GFDL            | 富化数据：英文例句（仅编者自造句）、近反义词、派生词、英文词源与音标校验 |
| [Tatoeba](https://downloads.tatoeba.org/exports/per_language/)                 | CC BY 2.0 FR + CC0 子集        | 中英双语例句                                                             |
| [ipa-dict](https://github.com/open-dict-data/ipa-dict)                         | MIT（en_US）/ GPL-3.0（en_UK） | 美式 / 英式双音标                                                        |
| [OpenEtymology](https://github.com/openetymology/OpenEtymology)                | CC BY-SA 4.0                   | 词根词缀拆解与中文词源                                                   |
| [MiSans](https://hyperos.mi.com/font/zh/)（[许可协议 PDF](https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf)） | MiSans License（小米自有许可，允许免费商用与随应用分发 webfont） | 界面默认字体：全站 `font-family` 首选 MiSans，`woff2` 400/500/700 + `font-display: swap`，加载失败回退系统字体；卡片词条 `.term` 仍走 `var(--lex-card-font)` 7 档，不受全局字体影响 |

- **Tier 0 内置核心词表**：约 7,200 词，随 PWA 打包、首次启动即安装，离线可用；含例句、近反义词、词源等富化数据。
- **Tier 1 / Tier 2 扩展词包**：覆盖 ECDICT 全量词条（约 5.8 万 / 40 万词），在应用内主动下载后离线检索；Tier 1 富化数据可选下载。应用默认不发任何网络请求。
- **用户导入词库**：完全由你自行导入，仅存本机；乐希不收集、不上传学习数据。

以上来源均按各自许可证署名，CC 系来源的派生内容按相同方式共享；完整声明随包分发（`packages/core/src/presets/notices.ts`），打包管线与许可出处核对见 `scripts/presets/README.md`。

## 贡献

欢迎 PR 与反馈。PR 流程、代码评审标准（13 条）与发版流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)；下一期方向见 [ROADMAP.md](./ROADMAP.md)。

## 许可

本项目代码采用 **[GPL-3.0-or-later](./LICENSE)**（GNU GPL v3，或（由你选择）任何更高版本）。© 2026 RayySummers。

词表数据来自多个第三方开放数据源，各来源许可与署名见上文「词表数据与许可」。全部依赖均与 GPL-3.0 兼容，详见 [ROADMAP.md](./ROADMAP.md) 开源章节。
