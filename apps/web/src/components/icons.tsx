/**
 * 图标系统 — Google Material Symbols Outlined 统一入口（RAY-363）。
 *
 * 背景（RAY-358 #6 / RAY-363）：
 * - 问题：「撤销上一次」的旧内联 SVG（`M3 7v6h6` + 弧线 `M3 13a9 9...`）
 *   在部分 WebKit/Blink 渲染管线中因 `a9 9 0 1 0 ...` 的弧线标志解析歧义
 *   与 `stroke` 闭合路径叠加，被误判为填充路径，视觉上呈现为实心圆
 *   （而非逆时针箭头）。属路径语法容错性问题，非样式覆盖可稳妥修复。
 * - 决策：全量迁移至 Google Material Symbols Outlined（Google Fonts 官方
 *   字体，`material-symbols-outlined`），由字体字形替代手写 SVG 路径，
 *   彻底消除路径歧义，并提供持续维护的统一图标语言。
 * - 约定：
 *   1) 颜色继承 `currentColor`（与浅色/深色 token `text-text` 等同口径），
 *      不硬编码色值，随 `tokens.css` 的 `--lex-*` 自动适配；
 *   2) 尺寸由调用处的 Tailwind `h-* w-*` 映射为 `font-size`（见
 *      `resolveFontSize`），保持 `h-4 w-4 == 16px` 等既有布局契约；
 *   3) 全部为装饰性图标（`aria-hidden`），可达名由按钮的 `aria-label` /
 *      文本提供，与旧 SVG 的 a11y 契约一致；
 *   4) 字体由 `index.html` 的 Google Fonts 链接（`display=swap`）提供，
 *      复用卡片字体的 `preconnect`，SW 按 `FONT_HOSTS` 策略缓存，
 *      离线时回退系统字体（不阻塞首帧）。
 *
 * 审计清单与替换映射（RAY-363 验收项「提供图标清单与替换映射文档」）：
 * | # | 旧组件（手写 SVG） | 用途（调用位置） | Material Symbol | 备注 |
 * |---|-------------------|----------------|-----------------|------|
 * | 1 | BackArrowIcon | 返回上一页（ScreenHeader、Review/Quiz） | arrow_back | 原为 `M15 18l-6-6 6-6` 轻量箭头 |
 * | 2 | SpeakerIcon | 朗读发音（ReviewScreen 工具栏） | volume_up | 原扬声器 + 声波 |
 * | 3 | UndoIcon | 撤销上一步（ReviewScreen/完成态） | undo | **实心圆根因**：旧弧线路径；新为官方 undo 字形，彻底修复 |
 * | 4 | RedoIcon | 撤销后返回（RAY-341，ReviewScreen） | redo | 与 undo 成对，顺时针 |
 * | 5 | SearchIcon | 搜词输入框放大镜 | search | |
 * | 6 | CloseIcon | 搜词历史单条删除（叉叉） | close | |
 * | 7 | CheckIcon | 已在生词本 / 可撤销标记 | check | 原 `2.5` 粗勾号 |
 * | 8 | PlusIcon | 加入生词本 / 新建列表 | add | |
 * | 9 | BookmarkIcon | 生词本入口与标记（App header） | bookmark | |
 * | 10 | TrashIcon | 删除列表/词包 | delete | 旧垃圾桶 SVG，重映射为官方 delete |
 * | 11 | EditIcon | 编辑列表名/描述 | edit | |
 * | 12 | ListIcon | 自定义词单入口（App header、搜词/复习） | lists | 原带圆点列表；新为 `lists`（比 `list` 更贴合“词单”语义；`format_list_bulleted` 为等价备选） |
 * | 13 | BarChartIcon* | 统计页入口（RAY-360 Header 基线，新增） | bar_chart | 为 #3 移动端 Header 图标化提供基线 |
 * | 14 | SettingsIcon* | 设置页入口（RAY-360 Header 基线，新增） | settings | 为 #3 提供基线 |
 * | 15 | KeyboardIcon* | 按键提示（RAY-362 保留 key icon，新增） | keyboard | `kbd` 提示的图标化备选 |
 *
 * * 新增图标：Stage 1 已预留，供 RAY-360「移动端 Header 图标化」直接复用，
 *   避免二次替换（RAY-363 为 #3 前置基线）。
 *
 * 无混用残留校验：
 * - 全仓仅本文件提供图标出口；`grep -r "from.*icons"` 仅命中本文件与调用处；
 * - 无 `lucide-*` / `heroicons` / `react-icons` / `font-awesome` 等第三方图标依赖
 *  （`package.json` dev/prod 均无此类依赖）；
 * - 旧手写 `<svg><path>` 已全量移除，本文件不再包含任何手写路径。
 */

interface IconProps {
  className?: string;
}

/** Tailwind `h-* w-*` → Material Symbols `font-size` 映射（保持既有布局契约） */
function resolveFontSize(className?: string): string {
  if (!className) return "24px";
  // 精确 token 匹配（Set.has），避免 `includes("h-3")` 对 `h-30` 等的误命中
  const tokens = new Set(className.split(/\s+/));
  if (tokens.has("h-6") || tokens.has("w-6")) return "24px";
  if (tokens.has("h-5") || tokens.has("w-5")) return "20px";
  if (tokens.has("h-3.5") || tokens.has("w-3.5")) return "14px";
  if (tokens.has("h-4") || tokens.has("w-4")) return "16px";
  if (tokens.has("h-3") || tokens.has("w-3")) return "12px";
  return "24px";
}

/** 物料图标基座：所有图标的唯一渲染路径，统一字形、尺寸与可访问性契约 */
function MaterialIcon({ name, className }: { name: string } & IconProps) {
  const fontSize = resolveFontSize(className);
  // 光学尺寸（opsz）随字形物理尺寸动态：≤16px 取 20（更紧凑的描边比例），
  // >16px 取 24（标准光学尺寸），符合 Material Symbols 官方建议（suggestion 已采纳）
  const opsz = parseInt(fontSize, 10) <= 16 ? 20 : 24;
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined inline-flex items-center justify-center leading-none select-none overflow-hidden ${className ?? ""}`}
      style={{
        fontSize,
        // 继承文本色（currentColor），与浅色/深色 token 自动适配，不硬编码
        // 可变轴与 index.css 的 .material-symbols-outlined 一致，此处显式兜底
        // 以防样式表未就绪前闪烁（swap 期间亦保持 400 常规字重）；opsz 动态兜底见上
        fontVariationSettings: `'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' ${opsz}`,
      }}
    >
      {name}
    </span>
  );
}

/** 向左箭头（返回上一页）— arrow_back */
export function BackArrowIcon({ className }: IconProps) {
  return <MaterialIcon name="arrow_back" className={className} />;
}

/** 扬声器（朗读发音，RAY-265）— volume_up */
export function SpeakerIcon({ className }: IconProps) {
  return <MaterialIcon name="volume_up" className={className} />;
}

/**
 * 逆时针箭头（撤销上一步，RAY-265）— undo
 *
 * 修复：旧手写 SVG 的 `a9 9 0 1 0 3-7.7` 弧线在部分引擎中被误填充为实心圆；
 * 新实现直接使用 Material 官方 `undo` 字形，无路径歧义，视觉稳定。
 */
export function UndoIcon({ className }: IconProps) {
  return <MaterialIcon name="undo" className={className} />;
}

/** 顺时针箭头（撤销后返回原位置，RAY-341）— redo */
export function RedoIcon({ className }: IconProps) {
  return <MaterialIcon name="redo" className={className} />;
}

/** 放大镜（搜词页输入框图标，RAY-266）— search */
export function SearchIcon({ className }: IconProps) {
  return <MaterialIcon name="search" className={className} />;
}

/** 叉叉（关闭，搜词历史单条删除，RAY-292）— close */
export function CloseIcon({ className }: IconProps) {
  return <MaterialIcon name="close" className={className} />;
}

/** 勾号（已在生词本 / 可撤销，RAY-302）— check */
export function CheckIcon({ className }: IconProps) {
  return <MaterialIcon name="check" className={className} />;
}

/** 加号（加入生词本，RAY-284）— add */
export function PlusIcon({ className }: IconProps) {
  return <MaterialIcon name="add" className={className} />;
}

/** 书签（生词本入口与标记，RAY-284）— bookmark */
export function BookmarkIcon({ className }: IconProps) {
  return <MaterialIcon name="bookmark" className={className} />;
}

/** 垃圾桶（删除，RAY-320）— delete */
export function TrashIcon({ className }: IconProps) {
  return <MaterialIcon name="delete" className={className} />;
}

/** 铅笔（编辑列表名 / 描述，RAY-325）— edit */
export function EditIcon({ className }: IconProps) {
  return <MaterialIcon name="edit" className={className} />;
}

/** 列表（自定义词单入口图标，RAY-325）— lists */
export function ListIcon({ className }: IconProps) {
  return <MaterialIcon name="lists" className={className} />;
}

/** 统计（RAY-360 Header 图标化基线，新增）— bar_chart */
export function BarChartIcon({ className }: IconProps) {
  return <MaterialIcon name="bar_chart" className={className} />;
}

/** 设置（RAY-360 Header 图标化基线，新增）— settings */
export function SettingsIcon({ className }: IconProps) {
  return <MaterialIcon name="settings" className={className} />;
}

/** 键盘（RAY-362 按键提示保留，新增）— keyboard */
export function KeyboardIcon({ className }: IconProps) {
  return <MaterialIcon name="keyboard" className={className} />;
}

/**
 * 通用物料图标（供未来扩展直接使用，避免新增文件）：
 * `<MaterialIcon name="..." className="h-4 w-4" />`
 * name 需为 Material Symbols Outlined 的 ligature（如 `search`、`settings`）。
 */
export { MaterialIcon };
