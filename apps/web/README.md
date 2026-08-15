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
- `src/hooks/useTheme.ts` — 主题状态（RAY-261 三档偏好：浅色 / 深色 / 跟随系统，localStorage 持久化；跟随系统档位监听设备主题自动切换；跨标签页偏好变更经 storage 事件同步）；实际主题通过 `<html data-theme>` 生效
- `src/theme/resolve.ts` — 主题解析纯函数：偏好 → 实际主题（light/dark 直接采用，system/缺失/非法跟随系统），与 index.html 内联脚本共用同一套规则
- `src/theme/themeColor.ts` — 浏览器外壳色同步：`meta theme-color` 跟随主题，值取自 `--lex-bg` token（不硬编码）
- `src/App.tsx` — 应用外壳：全局导航（统计 / 设置入口，RAY-261 起 header 无主题开关）+ 首页 / 复习 / 设置 / 统计界面切换
- `src/HomeScreen.tsx` — 首页：三模式按钮（学习 / 复习 / 混合）+ 今日待学徽标（无品牌名与介绍文案，已归档 docs/archive/homepage-intro-v1.md）
- `src/components/ScreenHeader.tsx` — 内部页面统一导航头（左侧返回箭头、标题右对齐，设置页与统计页共用）
- `src/components/icons.tsx` — 内联 SVG 图标（返回箭头，stroke 继承 currentColor，不硬编码颜色；主题太阳/月亮图标已随 RAY-261 移除）
- `src/components/StatCard.tsx` — 统计数值卡片（统计页）
- `src/lib/download.ts` — 文件下载工具（`downloadTextFile` / `datedFilename` / `serializeBackup`，纯前端无网络）
- `src/lib/appVersion.ts` — 构建时注入的版本号 `APP_VERSION`（vite.config.ts `define` 读取 `apps/web/package.json` 的 version；发版只改 package.json，UI 自动跟随）
- `src/pwa/` — PWA（RAY-240）：
  - `register.ts` — Service Worker 注册（仅生产构建，失败静默降级）
  - `manifest.test.ts` — manifest 可安装性结构 + 图标完整性 + theme_color 与 index.html 一致性（CI 锁定）
  - `serviceWorker.test.ts` — `public/sw.js` 语法与生命周期处理器冒烟
- `public/` — PWA 静态产物（原样拷贝进构建输出）：
  - `manifest.webmanifest` — 应用清单（standalone / 192+512 图标 / maskable）
  - `sw.js` — Service Worker：外壳预缓存 + 从 index.html 解析构建产物预缓存 + 静态资源 stale-while-revalidate + 导航离线回退
  - `icons/` — 由 `scripts/generate-icons.mjs` 生成的 PNG 图标（`pnpm icons` 重新生成）
- `src/settings/` — 设置页（RAY-245）：
  - `types.ts` — `SettingsDataProvider` / `ImportBackupResult`（UI 与数据源之间的契约）
  - `data.ts` — IndexedDB 数据源：`createIndexedDbSettingsDataProvider`（包装 core 的 `exportLexilexiData` / `exportCsvWordlist` / `parseLexilexiExport` / `importLexilexiData`）
  - `persistenceStatus.ts` — 持久化权限状态（启动申请 + `usePersistenceStatus` hook，监听 `lexilexi:storage-permission`）
  - `SettingsScreen.tsx` — 设置页 UI：主题三档下拉选单（浅色 / 深色 / 跟随系统，RAY-261）、每日新卡上限（默认 20/日，localStorage 持久化）、持久化提示、JSON/CSV 导出、JSON 导入、关于（GitHub 仓库链接 + 反馈问题入口，纯外链新窗口打开）与底部版本号（RAY-253 起无数据概览，概览已并入统计页）
- `src/stats/` — 统计页（RAY-240）：
  - `types.ts` — `StatsSnapshot`（今日待学 / 已复习 / 连续天数）/ `StatsDataProvider`（UI 与数据源之间的契约）
  - `data.ts` — IndexedDB 数据源：`createIndexedDbStatsDataProvider`（包装 core 的 `getDueItemIds` + stats 包的 `countReviews` / `computeStreak`）；默认工厂自带无 IndexedDB 环境兜底
  - `useStats.ts` / `useStatsProvider.ts` — 快照加载与数据源创建 hooks（统计页与首页徽标共用）
  - `StatsScreen.tsx` — 统计页 UI：8 项统计卡片 + 加载 / 空状态 / 错误重试（RAY-253 起统一导航头）
- `src/review/` — 复习界面（RAY-237，RAY-253 三模式）：
  - `types.ts` — `ReviewCard` / `ReviewDataProvider` / `GradeContext`（UI 与数据源之间的契约）
  - `queue.ts` — `buildReviewQueue`：id 列表 → 可复习卡片（完整性校验，纯函数，保持 core 给定的顺序）
  - `grade.ts` — 评分预览与文案：`previewGradeDueLabels`（按钮到期时间预览，走 `@lexilexi/fsrs` 公开 API）+ `formatDueLabel`（中文相对时间）
  - `data.ts` — IndexedDB 数据源：`createIndexedDbReviewDataProvider`（包装 core 的 `getStudyQueueItemIds` / `gradeReview` / `importCsvWordlist`）
  - `useReviewSession.ts` — 会话状态机（loading / empty / no-due / reviewing / done / error）
  - `ReviewCard.tsx` / `RatingButtons.tsx` / `ReviewScreen.tsx` — 卡片正反面、四档评分按钮、会话容器

## 三模式学习队列（RAY-253）

首页三个入口对应 `@lexilexi/core` 的 `StudyMode`（`getStudyQueueItemIds`）：

- **学习**（learn）：仅未评分新词（`reps === 0`），按 due 升序
- **复习**（review）：仅已评分且到期的卡（`reps > 0 && due <= now`），按 due 升序
- **混合**（mixed）：复习卡为主干，每 2 张复习卡穿插 1 张新词卡

队列筛选、排序与穿插全部在 `packages/core`（算法层）；`apps/web` 只做完整性校验与渲染。

**每日新卡上限**（RAY-260）：learn / mixed 模式的新词侧受上限约束——数据层
（`review/data.ts`）按「设置值（默认 20/日，设置页可调，localStorage）− 今日已学
新词数」折算剩余额度，经 `getStudyQueueItemIds` 的 `newCardLimit` 参数截取新词；
复习侧不受限。读取路径（Oscar 复评 suggestion 1）：今日复习事件走 time 索引区间
查询，「是否今日首次复习」反向扫描时间索引取证据、候选集清零即提前停止，
不再整表读历史事件；「今日已学」口径复用 `@lexilexi/stats` 的
`computeLearnedTodayCount`（事件投影）。首页有待学词时展示「今日新卡额度剩余
N 张」，说明徽标数字（未截断到期数）与每日实际可学队列的关系（复评 suggestion 2）。

## PWA（可安装 + 离线）

- 安装：浏览器访问部署地址后出现「安装应用」提示（需 HTTPS 或 localhost）；
  图标由 `scripts/generate-icons.mjs` 生成（品牌主色 + 闪卡图形，零依赖纯 Node），
  改设计或品牌色后运行 `pnpm icons` 重新生成并提交。
- 离线：Service Worker 在**首次在线访问**时预缓存应用外壳与构建产物；
  之后断网也能打开应用并复习（学习数据本就在本机 IndexedDB，不经过网络）。
- 开发：Service Worker 仅在生产构建（`import.meta.env.PROD`）注册，避免干扰 Vite HMR。
- 缓存版本：`public/sw.js` 顶部 `CACHE_NAME` 在缓存结构或预缓存清单变化时递增。
- 路径策略（部署无关）：Vite `base: "./"`，manifest / index.html / sw.js 全部按
  「相对自身位置」解析路径，因此产物可部署在任意子路径（如 GitHub Pages 的
  `/Lexilexi/`）、根路径或自定义域名，无需按环境改写（`serviceWorker.test.ts`
  有子路径部署回归用例锁定）。
- 已知限制（记录在案）：manifest 的 `theme_color` / `background_color` 是静态浅色值，
  深色主题下安装启动屏/标题栏仍为浅色——manifest 静态配色是平台限制；
  页面内 `meta theme-color` 已由 `themeColor.ts` 随主题动态同步，不受此限。

## 复习界面交互

- 卡片点击或**空格**翻面（正面词条，背面释义）；
- **1–4** 或 **A / H / G / E** 评分（Again / Hard / Good / Easy，与按钮等价），评分后进入下一张卡；
- 评分按钮副文案为各档到期时间预览（与真实排期一致）；
- 空库时提供「导入内置示例词表」入口（数据来自 `@lexilexi/core` 的 `SAMPLE_WORDLIST_CSV`）。

## 约束

- 只做界面与交互；算法逻辑一律放在 `packages/*`
- 跨包引用走公开 API（`@lexilexi/core` 等）
- local-first：不引入任何必须联网才能用的功能
