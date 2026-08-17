# 参与贡献（CONTRIBUTING）

感谢你对乐希 Lexii 的关注！这是一份社区贡献指南，涵盖 PR 流程、代码评审标准与评审流程。内容不多，请先通读再动手。

- **许可证**：本项目采用 [GPL-3.0-or-later](./LICENSE)。你在 GPL-3.0 或更高版本的条款下向本项目贡献代码，并同意你的贡献按同一许可证分发。贡献前请确认你的代码不包含与 GPL-3.0 不兼容的第三方代码；若你复用了他人的代码，请在 PR 描述中说明来源与许可证。
- **提交签名**：项目尚未启用 CLA / DCO，可直接贡献；若未来引入，以本文件更新为准。
- **语言**：代码注释、提交信息、PR 描述一律使用中文（自本文件生效起，此前历史提交除外）；英文仅用于标识符与错误消息等代码本体。
- **本地优先**：本项目坚持 local-first 与隐私红线。任何必须联网才能使用的功能、任何向外部服务发送学习数据的行为，一律不会被接受。详见下方评审标准第 5、6 条。

## 快速上手

```bash
pnpm install      # 安装依赖（Node.js >= 20，pnpm 10）
pnpm dev          # 启动 dev server（apps/web）
pnpm test         # Vitest 全量测试
pnpm build        # 全量构建
pnpm lint         # ESLint + Prettier 检查
```

Monorepo 分层与各包职责见 [README.md](./README.md) 与 `packages/` 下各包文档。

## 代码评审标准（13 条，每个 PR 逐项打勾）

### A. 必须通过（不过就打回）

1. **构建与测试**：`pnpm build` 无报错；`pnpm test` 全绿；新增代码必须带测试。
2. **FSRS-7 正确性**：对照官方参考实现的验证用例必须全部通过（`fsrs-verify` 标记，CI 单独跑）。
3. **TypeScript 严格模式**：`tsc --noEmit` 零错误；禁止 `any`（除非有书面理由）；核心数据模型必须有类型定义。
4. **数据安全**：IndexedDB 改动不得破坏数据迁移路径（schema 升级必须走版本迁移，禁止清库重来）；导出功能必须导出完整可恢复数据（JSON 能原样导回）。
5. **local-first 红线**：不得引入任何必须联网才能用的功能；AI 相关代码只允许在 `packages/ai` 内。
6. **隐私红线**：不得把学习数据发送到任何外部服务；不得埋点上报（连匿名统计都不行）。

### B. 应该通过（通常打回，有合理理由可豁免）

7. **代码风格**：符合仓库统一风格（Prettier + ESLint）；命名清晰达意；无死代码 / 注释掉的代码。
8. **结构**：符合 monorepo 分层——`apps/web` 只做界面，算法逻辑必须在 `packages/`；跨包引用走公开 API。
9. **文档**：新模块要有 README 或代码内说明；接口签名变化同步更新受影响文档。
10. **深色模式**：新增界面同时提供浅色 / 深色两套（走 design tokens，不许硬编码颜色）。

### C. 建议（不打回，但会在评审中提出）

11. **性能**：明显低效的查询 / 渲染会指出（如循环里查数据库、大列表无虚拟化）。
12. **可维护性**：重复代码、过度复杂函数、可简化的逻辑。
13. **UX 细节**：明显的可用性问题（按钮无反馈、键盘操作断裂等）。

## PR 流程

### 1. 从 main 切出功能分支

分支命名统一 `feat/` / `fix/` / `docs/` 等前缀 + 简短描述：

```
feat/fsrs-7          # 新功能
fix/import-crash     # 修复
docs/roadmap         # 文档
```

本项目的 agent 自动分支使用 `agent/<name>/<id>` 格式（如 `agent/vega/984556a2`），与上述人工贡献前缀规范并存。

### 2. 提交信息格式

提交信息必须带包名 scope 前缀，与 PR 标题保持一致：

```
[web] feat: 复习界面支持键盘快捷键
[core] fix: CSV 导入空行导致解析错误
[fsrs] test: 补充学习步骤边界用例
[docs] docs: 更新 README 路线图
```

- 类型采用 Conventional Commits：`feat` / `fix` / `test` / `docs` / `refactor` / `style` / `chore`。
- scope 为 `web`、`core`、`fsrs`、`eval`、`stats`、`ai`、`docs` 或 `repo`（仓库级变更）；一次改动涉及多个包时列出全部：`[core][fsrs][web]`。
- PR 标题需包含对应 issue 编号（如 RAY-243），便于自动关联。

### 3. 本地自检

提交 PR 前，确保本地通过：

```bash
pnpm typecheck && pnpm build && pnpm test && pnpm lint
```

涉及 `packages/fsrs` 的改动，请额外确认 `fsrs-verify` 用例全部通过（CI 中单独运行，对照官方参考实现逐字段验证）。

### 4. 提交 PR

PR 描述使用下方模板，并自行对照「13 条评审标准」在描述中逐项勾选自查结果。CI（build + test + typecheck + lint + fsrs-verify）必须全绿；`main` 分支受保护，禁止绕过 PR 直推（惯例，CI 门槛兜底）。评审通过为合入惯例，非 GitHub 强制门槛（原因见「评审流程」）。

### PR 模板

新建 Pull Request 时，请将以下内容填入描述：

```markdown
## 变更说明

<!-- 这个 PR 做了什么，解决什么问题（关联 issue：RAY-xxx） -->

## 变更类型

- [ ] 新功能
- [ ] 修复
- [ ] 文档
- [ ] 重构 / 测试 / 其他

## 自查清单（对照 13 条评审标准）

- [ ] 1. `pnpm build` 无报错；`pnpm test` 全绿；新增代码带测试
- [ ] 2. FSRS-7：`fsrs-verify` 用例全部通过（涉及 `packages/fsrs` 时）
- [ ] 3. TypeScript：`tsc --noEmit` 零错误；无 `any`；数据模型有类型定义
- [ ] 4. 数据安全：IndexedDB 改动走版本迁移；导出可原样导回
- [ ] 5. local-first：无必须联网功能；AI 代码仅在 `packages/ai`
- [ ] 6. 隐私：不发送学习数据；无埋点上报
- [ ] 7. 风格：Prettier + ESLint 通过；命名清晰；无死代码
- [ ] 8. 结构：界面在 `apps/web`，算法在 `packages/`，跨包走公开 API
- [ ] 9. 文档：新模块有说明；接口变化同步文档
- [ ] 10. 深色模式：走 design tokens，无硬编码颜色
- [ ] 11–13. 性能 / 可维护性 / UX：如已注意请简述

## 评审豁免申请

<!-- 若某条 B 级标准（7–10）无法满足，请在此说明理由，由评审员判定是否豁免 -->

## 许可证确认

- [ ] 我确认本 PR 的代码按 GPL-3.0-or-later 贡献
- [ ] 若复用了他人的代码，已在下方说明来源与许可证：
```

## 评审流程

1. **提交 PR**：在 PR 描述中完成 13 条自查勾选。若不适用（如纯文档改动），直接标注「不适用」。
2. **评审指派**：PR 提交后由项目维护者指派代码评审员，按 13 条标准逐项打勾。
3. **评审结论**：评审意见用中文书写，结论为「通过」或「打回」；打回时附逐条原因。
   - A 级（1–6）不满足 → 打回，修复后重新评审。
   - B 级（7–10）不满足 → 通常打回；有合理理由可豁免，豁免由评审员判定并记录。
   - C 级（11–13）不满足 → 不打回，在评审中提出建议。
4. **跟进修改**：修复评审问题后，在 PR 中回复逐条处理结果；评审员确认后通过。
5. **合并要求**：CI 全绿为强制门槛，评审通过为合入惯例；合并前禁止绕过 PR 直推 `main`（惯例，CI 门槛兜底）。仓库未开启「评审通过数 ≥ 1」的分支保护：Multica 协作模式下全体 Agent 与所有者共用同一 GitHub 账户，开启后任何人都无法批准自己的 PR——故评审以流程惯例执行，不靠 GitHub 强制。

## 发版流程（Release Checklist）

应用版本号的唯一来源是 `apps/web/package.json` 的 `version`（构建时经 Vite `define` 注入，设置页底部展示）。发版请按以下顺序执行，**版本号与 tag 必须一致**，否则页面显示的版本会与发布的 tag 漂移：

1. **档案对账**：发版前由 Mell 对账「Release 档案对内版（活文档）」（RAY-285，Mell 维护）与 issue 树，状态不一致先修正档案，再继续发版。
2. **Bump 版本号**：在发布 PR 中把 `apps/web/package.json` 的 `version` 更新为新版本（如 `0.1.0-alpha.2`）。设置页底部版本号会自动跟随，无需改动任何组件代码。
3. **合入 main**：版本 bump 与功能变更一起走 PR（禁止绕过 PR 直推 `main`），CI 全绿后合并。
4. **打 tag**：在包含该版本 bump 的 main 合并提交上打 tag，格式为 `v<版本号>`（与 package.json 完全一致，如 `v0.1.0-alpha.2`），并推送 tag。
5. **部署验证**（RAY-297 双通道）：推送 tag 自动触发 Release 通道部署（`.github/workflows/deploy-release.yml`，发布到 `rayysummers.github.io/Lexii/` 根路径）；`main` 每次合入自动触发 Dev 通道部署（`.github/workflows/deploy-dev.yml`，发布到 `/Lexii/dev/` 子路径，保留 RAY-241 以来的 main push 预览行为）。两通道每次部署都发布自洽的完整站点（互相携带对方快照），任一通道的部署不会把另一通道冲成 404。部署完成后：在根路径真机确认设置页底部版本号与 tag 一致；在 `/Lexii/dev/` 确认开发预览正常。两个通道均可经 `workflow_dispatch` 手动触发。
6. **从对内版活文档同步对外版**：从 Mell 维护的「Release 档案对内版（活文档）」（RAY-285，带状态标注的完整版）按「对外版」口径同步到 `docs/archive/release-pipeline-archive.md`——保留版本 / 波次分组、事项标题与父子依赖缩进；去掉状态标注（✅🔵🟡 等）、内部排期备注与 RAY 编号（对外版不带状态）。
7. **提炼 CHANGELOG**：由 Vega 从对内版活文档（RAY-285）提炼 CHANGELOG，以对外版档案为骨架、按实际合入版本归类，随 GitHub Release 公开。

## 文档与资料

- 项目背景与规划：`docs/` 目录（领域模型等设计文档）与 [ROADMAP.md](./ROADMAP.md)。
- 发版管线档案（对外公开版）：[docs/archive/release-pipeline-archive.md](./docs/archive/release-pipeline-archive.md)；完整版（含状态标注）为 Mell 维护的「Release 档案对内版（活文档）」（RAY-285），发版时按上方发版流程同步。
- 历史讨论与决策记录：项目维护者备份中的 `INFO_260812.md`（不在本仓库）。
- 算法口径：`packages/fsrs/README.md` 记录了「FSRS-7」版本口径（对照官方 ts-fsrs 参考实现验证）。

## 外部词库与数据源（重要）

当前仓库不捆绑任何第三方词典数据，内置示例词表为本项目原创。**如果你希望引入外部词库、词典、例句或词频数据，请先在 issue 中说明数据来源与许可证**，确认与 GPL-3.0 兼容并取得维护者同意后再实现。
