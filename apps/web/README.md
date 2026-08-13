# @lexilexi/web

Lexilexi Web / PWA 应用（Vite + React + TypeScript + Tailwind CSS）。

## 开发

```bash
pnpm install
pnpm dev            # 启动 dev server
pnpm test           # Vitest
pnpm build          # tsc --noEmit + vite build
```

## 结构

- `src/styles/tokens.css` — 语义化 design tokens（浅色/深色两套，组件禁止硬编码颜色）
- `src/hooks/useTheme.ts` — 主题状态：localStorage 优先，其次跟随系统偏好；通过 `<html data-theme>` 生效
- `src/theme/themeColor.ts` — 浏览器外壳色同步：`meta theme-color` 跟随主题，值取自 `--lex-bg` token（不硬编码）
- `src/App.tsx` — 应用外壳：品牌头部 + 主题切换 + 首页 / 复习界面切换
- `src/HomeScreen.tsx` — 首页（品牌与复习入口）
- `src/review/` — 复习界面（RAY-237）：
  - `types.ts` — `ReviewCard` / `ReviewDataProvider` / `GradeContext`（UI 与数据源之间的契约）
  - `queue.ts` — `buildReviewQueue`：到期条目 → 可复习卡片（完整性校验 + 排序，纯函数）
  - `grade.ts` — 评分预览与文案：`previewGradeDueLabels`（按钮到期时间预览，走 `@lexilexi/fsrs` 公开 API）+ `formatDueLabel`（中文相对时间）
  - `data.ts` — IndexedDB 数据源：`createIndexedDbReviewDataProvider`（包装 core 的 `getDueItemIds` / `gradeReview` / `importCsvWordlist`）
  - `useReviewSession.ts` — 会话状态机（loading / empty / no-due / reviewing / done / error）
  - `ReviewCard.tsx` / `RatingButtons.tsx` / `ReviewScreen.tsx` — 卡片正反面、四档评分按钮、会话容器

## 复习界面交互

- 卡片点击或**空格**翻面（正面词条，背面释义）；
- **1–4** 或 **A / H / G / E** 评分（Again / Hard / Good / Easy，与按钮等价），评分后进入下一张卡；
- 评分按钮副文案为各档到期时间预览（与真实排期一致）；
- 空库时提供「导入内置示例词表」入口（数据来自 `@lexilexi/core` 的 `SAMPLE_WORDLIST_CSV`）。

## 约束

- 只做界面与交互；算法逻辑一律放在 `packages/*`
- 跨包引用走公开 API（`@lexilexi/core` 等）
- local-first：不引入任何必须联网才能用的功能
