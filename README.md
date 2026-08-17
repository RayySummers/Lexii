# 乐希 Lexii

> 用自己写的软件，背自己的词。

定制化背单词体验：现代简洁、多语言、支持导入词库、**local-first**。

Lexii 是一款本地优先的词汇学习应用：数据只存在你自己的设备上，断网也能完整使用。核心由 **FSRS-7** 间隔重复算法驱动，配合学习评测（`lexii_eval`）把「用户怎么作答」转化为可验证的学习证据。

- 开源：GPL-3.0-or-later
- Web / PWA 优先（可安装、离线可用）
- 词库自由导入（CSV），内置示例词表（许可干净、本项目原创）
- 数据属于你：本地存储 + 一键导出（JSON 可原样导回）

## 原则

1. **Web / PWA 优先** — 先做 Web，后续可打包为 PWA，再考虑 F-Droid / Android
2. **Local-first** — 数据不出设备，所有核心功能离线可用
3. **开源** — GitHub 分发，GPL-3.0-or-later 许可
4. **本地优先** — 不依赖云端服务；AI 能力（若未来提供）采用 BYOK，且只在 `packages/ai`
5. **隐私** — 不发送学习数据到任何外部服务，不埋点、不统计

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

## 快速开始

```bash
pnpm install
pnpm dev        # 启动 dev server（apps/web）
pnpm test       # Vitest 全量测试
pnpm build      # 全量构建
pnpm lint       # ESLint + Prettier 检查
```

环境要求：Node.js ≥ 20、pnpm 10。

## 文档

| 文档                                                 | 说明                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                 | PR 流程、代码评审标准（13 条）、评审流程、发版流程           |
| [ROADMAP.md](./ROADMAP.md)                           | 首期 20 天计划与里程碑、下一期方向                           |
| [docs/domain-model.md](./docs/domain-model.md)       | 领域模型设计（Learning Item / Sense / Memory State / Event） |
| [packages/fsrs/README.md](./packages/fsrs/README.md) | FSRS-7 实现与版本口径（对照官方参考实现验证）                |
| [packages/ai/README.md](./packages/ai/README.md)     | AI 能力规划（BYOK、忆语）与「为什么 MVP 不做」               |

## 许可

本项目采用 **[GPL-3.0-or-later](./LICENSE)**（GNU GPL v3，或（由你选择）任何更高版本）。© 2026 RayySummers。

词表数据：内置示例词表为本项目原创（无第三方词典数据）；词库由用户自行导入。全部依赖均与 GPL-3.0 兼容，详见 [ROADMAP.md](./ROADMAP.md) 开源章节。
