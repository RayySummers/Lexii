# 图标系统审计与 Material Icons 迁移映射（RAY-363）

> **状态**：已完成（Alpha 0.9.2 Stage 1）  
> **负责人**：前端 Harvey  
> **关联**：RAY-358 #6 / RAY-363（为 RAY-360 Header 图标化提供基线）

## 1. 目标

- 全量图标统一至 **Google Material Symbols Outlined**（官方字体，`material-symbols-outlined`）。
- 修复「撤销上一次」显示为实心圆的问题。
- 消除旧图标库/手写 SVG 混用残留，提供后续需求（RAY-360 移动端 Header 图标化）的可复用基线。

## 2. 全量图标审计（迁移前）

审计命令：`grep -rn "from.*icons" apps/web/src` + `grep -rn "Icon" apps/web/src --include="*.tsx"`

| # | 旧组件 | 文件 | 调用位置 | 旧实现 | 备注 |
|---|--------|------|----------|--------|------|
| 1 | `BackArrowIcon` | `components/icons.tsx` | `ScreenHeader.tsx:11`, `ReviewScreen.tsx:40`, `QuizScreen.tsx:10` | 手写 SVG `M15 18l-6-6 6-6` | 返回 |
| 2 | `SpeakerIcon` | `components/icons.tsx` | `ReviewScreen.tsx:421` | 手写扬声器 + 声波 | 发音 |
| 3 | `UndoIcon` | `components/icons.tsx` | `ReviewScreen.tsx:477` | 手写 `M3 7v6h6` + `M3 13a9 9 0 1 0 3-7.7L3 13` | **实心圆根因** |
| 4 | `RedoIcon` | `components/icons.tsx` | `ReviewScreen.tsx:498` | 手写 `M21 7v6h-6` + `M21 13a9 9...` | RAY-341 新增 |
| 5 | `SearchIcon` | `components/icons.tsx` | `SearchScreen.tsx:261` | `circle + path` 放大镜 | 搜词 |
| 6 | `CloseIcon` | `components/icons.tsx` | `SearchScreen.tsx:473` | `M6 6l12 12` 叉叉 | 历史删除 |
| 7 | `CheckIcon` | `components/icons.tsx` | `AddToListsDialog.tsx:228`, `SearchScreen.tsx:541` | `M5 13l4 4L19 7` | 已加/勾号 |
| 8 | `PlusIcon` | `components/icons.tsx` | `AddToListsDialog.tsx:188,287`, `CustomListsScreen.tsx:280,318`, `SearchScreen.tsx:543` | `M12 5v14` + `M5 12h14` | 加词/新建 |
| 9 | `BookmarkIcon` | `components/icons.tsx` | `App.tsx:232` | 书签轮廓 | 生词本 |
| 10 | `TrashIcon` | `components/icons.tsx` | `CustomListsScreen.tsx:403`, `WordbookLibraryScreen.tsx:378` | 垃圾桶 | 删除 |
| 11 | `EditIcon` | `components/icons.tsx` | `CustomListsScreen.tsx:395` | 铅笔 | 编辑 |
| 12 | `ListIcon` | `components/icons.tsx` | `App.tsx:242`, `ReviewScreen.tsx:441`, `SearchScreen.tsx:525` | 三线 + 三圆点 | 词单 |

**总量**：12 个导出的图标组件，无第三方图标库依赖（`package.json` 无 `lucide`/`heroicons`/`react-icons`/`font-awesome`）。

## 3. 替换映射（旧 → Material Symbols Outlined）

| 旧组件 | Material Symbol ligature | 官方字形说明 | 变更类型 |
|--------|--------------------------|--------------|----------|
| `BackArrowIcon` | `arrow_back` | 系统返回箭头 | 等价替换 |
| `SpeakerIcon` | `volume_up` | 扬声器 | 等价替换 |
| `UndoIcon` | `undo` | 逆时针箭头 | **修复实心圆** |
| `RedoIcon` | `redo` | 顺时针箭头 | 等价替换 |
| `SearchIcon` | `search` | 放大镜 | 等价替换 |
| `CloseIcon` | `close` | 叉叉 | 等价替换 |
| `CheckIcon` | `check` | 勾号 | 等价替换 |
| `PlusIcon` | `add` | 加号 | 等价替换 |
| `BookmarkIcon` | `bookmark` | 书签 | 等价替换 |
| `TrashIcon` | `delete` | 垃圾桶 | 语义更准（旧为手绘 trash，新为官方 delete） |
| `EditIcon` | `edit` | 铅笔 | 等价替换 |
| `ListIcon` | `lists` | 列表（词单语义） | 原 bullet 列表 → `lists`（备选 `format_list_bulleted`） |
| `BarChartIcon` *(新增)* | `bar_chart` | 柱状图 | 为 RAY-360 Header「统计」图标化预留 |
| `SettingsIcon` *(新增)* | `settings` | 齿轮 | 为 RAY-360 Header「设置」图标化预留 |
| `KeyboardIcon` *(新增)* | `keyboard` | 键盘 | 为 RAY-362 保留 key icon 提示预留 |

> **尺寸契约**：`h-4 w-4 → 16px`、`h-5 w-5 → 20px`、`h-3.5 w-3.5 → 14px`，由 `icons.tsx:resolveFontSize` 统一映射，保持既有布局不变。
> **颜色契约**：`color: currentColor` 继承文本色，随 `tokens.css` 的 `--lex-text` / `--lex-text-muted` / `--lex-primary` 等自动适配浅色/深色。

## 4. 撤销图标实心圆根因与修复

**根因**：旧 `UndoIcon` 的第二段路径 `M3 13a9 9 0 1 0 3-7.7L3 13`
- `a9 9 0 1 0 3-7.7` 中 `3-7.7` 依赖 SVG 规范「负号即分隔符」的容错解析，部分 WebKit/Blink 版本在 `stroke` + 闭合路径叠加时将弧线误判为需填充的闭合形状，叠加 `strokeWidth=2` 的渲染批次，导致视觉上出现实心圆（而非空心箭头）。
- 该写法在不同 DPI / 缩放 / 字体抗锯齿设置下表现不稳定，无法通过 `stroke-linecap` 等样式稳定修复。

**修复**：改用 Material 官方 `undo` 字形（字体字形，非手写路径），无路径歧义，跨引擎表现一致。已在本地与 CI 的 `ReviewScreen` 相关用例（撤销/重放）中验证：按钮文本「撤销上一步」与图标同现，无实心圆。

## 5. 实现清单

- `apps/web/index.html`：新增 `Material Symbols Outlined` 样式表（`opsz,wght,FILL,GRAD@20..48,400,0,0`，`display=swap`），复用卡片字体的 `preconnect`。
- `apps/web/src/styles/index.css`：新增 `.material-symbols-outlined` 可变轴与抗锯齿约定。
- `apps/web/src/components/icons.tsx`：全量重写为 `MaterialIcon` 基座 + 15 个具名导出（含 3 个 RAY-360 基线新增），移除所有手写 `<svg><path>`，保留 `IconProps` API 与 `aria-hidden` 契约。
- `public/sw.js`：无需改动，`FONT_HOSTS` 已放行 `fonts.googleapis.com` / `fonts.gstatic.com`，字体文件走缓存优先、CSS 走网络优先，离线可回退（与卡片字体同策略）。

## 6. 无混用残留校验

```bash
# 图标出口唯一性
grep -rn "from.*components/icons" apps/web/src --include="*.ts" --include="*.tsx"
# 预期：仅本文件定义 + 8 处调用（App/Review/Quiz/Search/CustomLists/Wordbook/ScreenHeader）

# 第三方图标库残留
grep -rn "lucide\|heroicons\|react-icons\|font-awesome\|@iconify" apps/web --include="*.json" --include="*.ts" --include="*.tsx"
# 预期：无命中

# 旧手写路径残留
grep -rn "<svg" apps/web/src/components --include="*.tsx"
# 预期：0 命中（本文件已无 <svg>）
```

`package.json`（`apps/web`）无图标类依赖，仅 `react`/`react-dom`。

## 7. 为 RAY-360 提供的基线

RAY-360（移动端 Header 四按钮图标化）可直接复用：

```tsx
import { SearchIcon, ListIcon, BarChartIcon, SettingsIcon } from "./components/icons";

// 搜词 → <SearchIcon className="h-4 w-4" />
// 词单 → <ListIcon className="h-4 w-4" />
// 统计 → <BarChartIcon className="h-4 w-4" />
// 设置 → <SettingsIcon className="h-4 w-4" />
```

无需二次替换，`aria-label` 契约与既有 Header 按钮一致。

## 8. 验收

- [x] 全量图标已迁移至 Google Material Symbols Outlined
- [x] 「撤销上一次」不再为实心圆，显示为官方 `undo` 字形
- [x] 提供本清单与 `icons.tsx` 头部映射表（双重文档）
- [x] 无第三方图标库/手写 SVG 残留
- [x] 为 RAY-360 提供 `BarChartIcon` / `SettingsIcon` 基线（`h-4 w-4` 尺寸契约一致）

## 9. 参考

- Google Fonts Material Symbols：https://fonts.google.com/icons
- 字体样式表：`https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0&display=swap`
- 本迁移的代码锚点：`apps/web/src/components/icons.tsx:1`、`apps/web/index.html:61`、`apps/web/src/styles/index.css:8`
