# 设计令牌规范 — 乐希 Lexii `docs/design-tokens.md`

> **状态：P0 唯一可信来源（Single Source of Truth）**
> **冻结口径：** 单 seed `#4F46E5` → M3 Tonal Spot（官方 Theme Builder 默认变体，`Variant.TONAL_SPOT`）
> **与代码同源：** `apps/web/src/styles/tokens.css` / `apps/web/src/theme/palette.ts` 数值为准，本文件与二者保持一致；不一致时以代码为准并同步更新本文档。
> **范围：** 仅定义 token（颜色/排版/形状/动效/状态层），不含 P1 主题色选择逻辑，不含 P2 动效应用。
> **关联：** Parent RAY-394 · 本文档 RAY-395 · Token 扩展 RAY-396 · 守护测试 RAY-397
> **对照样图：** `warm-upgrade-comparison.png` 的 B（浅色）/ D（深色）两格即本规范的纯单 seed 效果

---

## 0. 概览与使用约定

### 0.1 Seed 与色板来源

- **Seed：** `#4F46E5`（indigo，HCT 287.1° / 73.3 / 40.7）
- **生成方式：** 基于 `material-color-utilities` 的 TonalSpot 调色板（`TonalPalette.fromHueAndChroma(hue,36)` · 次色 `16` · 三级 `hue+60/24` · 中性 `6` · 中性变体 `8` · 错误 `25/84` · 成功自定义 `146/32`，`contrastLevel 0.0`）按冻结 tone 映射派生，非直接取 `SchemeTonalSpot` 默认 tone 40/90 原生输出。
  - 调色板为源、tone 为冻结选取：如 light primary 取该调色板 tone 22.7 `#313066`（而非 MCU 默认 tone 40 `#5a5892`）、primaryContainer tone 45.9 `#6867a1`（而非 90 `#e2dfff`）等，以满足冻结示例与样图 B/D 效果及对比度；禁止脱离调色板手工改色相/彩度，tone 选取以本文件与 `pure-palette.json` 为准（Cale 复核后如有修正再更新）。
- **附件：** `pure-palette.json`（冻结完整色板，含 16 个中性角色 + 彩色组两套）为本文件的机器可读副本。

### 0.2 命名与前缀

- CSS 变量统一前缀 `--lex-`，后接 M3 官方角色名（kebab-case），如 `--lex-primary`、`--lex-on-primary`、`--lex-surface-container-high`。
- Tailwind v4 通过 `@theme inline` 将变量注册为语义工具类（`bg-*/text-*/border-*`），组件中**禁止硬编码 hex / rgb**，一律引用语义 token。
- 主题切换：`<html data-theme="dark">`（`useTheme` 维护），`tokens.css` 中 `:root` 为浅色、`[data-theme="dark"]` 为深色，`color-scheme` 随之切换。

### 0.3 文件同源校验

- `tokens-consistency.test.ts` 校验：本文档 ↔ `tokens.css` ↔ `palette.ts` 三处数值一致（颜色 / Shape / Type / Motion）。
- `token-contrast.test.ts` 读取 `tokens.css` 两套色板，自动计算所有 `onX vs X` 对比度 ≥ 4.5:1，CI 拦截。
- `scan-hardcoded-colors.mjs` 禁止裸 hex（白名单除外）。

---

## 1. 颜色角色表（Color Roles）

> 按 M3 官方角色名列出浅/深两套；所有 `--lex-*` 变量在 `tokens.css` 与 `palette.ts`（`light: Record<Role, string>` / `dark: Record<Role, string>`）同名同值。

### 1.1 主色组（Primary）

| 角色 | CSS 变量 | 浅色 | 深色 | 用途 |
|------|----------|------|------|------|
| primary | `--lex-primary` | `#313066` | `#dbd8ff` | 主按钮填充、强调文字、选中态主色 |
| on-primary | `--lex-on-primary` | `#ffffff` | `#2b2a60` | 位于 primary 上的文字/图标 |
| primary-container | `--lex-primary-container` | `#6867a1` | `#8c8bc8` | 含 primary 的容器（卡片高亮、选中背景） |
| on-primary-container | `--lex-on-primary-container` | `#ffffff` | `#16134a` | 位于 primary-container 上的文字 |

> 冻结示例：浅色 `primary #313066 / primaryContainer #6867a1`；深色 `primary #dbd8ff / primaryContainer #8c8bc8`（与 `pure-palette.json` 一致）。

### 1.2 次色组（Secondary）

| 角色 | CSS 变量 | 浅色 | 深色 |
|------|----------|------|------|
| secondary | `--lex-secondary` | `#5e5c71` | `#c7c4dd` |
| on-secondary | `--lex-on-secondary` | `#ffffff` | `#2f2e42` |
| secondary-container | `--lex-secondary-container` | `#e3e0f9` | `#464559` |
| on-secondary-container | `--lex-on-secondary-container` | `#1a1a2c` | `#e3e0f9` |

### 1.3 三级色组（Tertiary）

| 角色 | CSS 变量 | 浅色 | 深色 |
|------|----------|------|------|
| tertiary | `--lex-tertiary` | `#7a5368` | `#eab9d1` |
| on-tertiary | `--lex-on-tertiary` | `#ffffff` | `#472639` |
| tertiary-container | `--lex-tertiary-container` | `#ffd8ea` | `#603c50` |
| on-tertiary-container | `--lex-on-tertiary-container` | `#2f1123` | `#ffd8ea` |

### 1.4 错误组（Error）

| 角色 | CSS 变量 | 浅色 | 深色 |
|------|----------|------|------|
| error | `--lex-error` | `#ba1a1a` | `#ffb4ab` |
| on-error | `--lex-on-error` | `#ffffff` | `#690005` |
| error-container | `--lex-error-container` | `#ffdad6` | `#93000a` |
| on-error-container | `--lex-on-error-container` | `#410002` | `#ffdad6` |

### 1.5 成功组（Success · 自定义，M3 无此角色）

> 独立 4 色，复用 tertiary 的 tone 映射逻辑，但 hue 取绿色 146° / chroma 32，避免与 error 混淆；warning 场景使用 `--lex-tertiary` 即可，无需单独 warning。

| 角色 | CSS 变量 | 浅色 | 深色 | 说明 |
|------|----------|------|------|------|
| success | `--lex-success` | `#1b5c1a` | `#76db7a` | 成功提示、完成态 |
| on-success | `--lex-on-success` | `#ffffff` | `#00390a` | 位于 success 上的文字 |
| success-container | `--lex-success-container` | `#a6f2a5` | `#005313` | 成功容器背景 |
| on-success-container | `--lex-on-success-container` | `#00210a` | `#a6f2a5` | 位于 success-container 上的文字 |

### 1.6 中性组（Neutral · 16 角色）

> 16 个中性角色构成 M3 表面系统，浅色以 `neutral tone 98→84` 阶梯，深色以 `tone 6→22` 反向阶梯；与冻结示例完全一致。

| 角色 | CSS 变量 | 浅色 | 深色 | 备注 |
|------|----------|------|------|------|
| background | `--lex-background` | `#fcf8ff` | `#131318` | 页面背景，冻结示例 `bg #fcf8ff / #131318` |
| on-background | `--lex-on-background` | `#1b1b21` | `#e5e1e9` | 背景上文字 |
| surface | `--lex-surface` | `#fcf8ff` | `#131318` | 表面基色，与 background 同值（M3 2025 phone） |
| on-surface | `--lex-on-surface` | `#1b1b21` | `#e5e1e9` | 表面上文字 |
| surface-dim | `--lex-surface-dim` | `#dcd9e0` | `#131318` | 最暗表面（分隔/阴影基色） |
| surface-bright | `--lex-surface-bright` | `#fcf8ff` | `#39383f` | 最亮表面 |
| surface-container-lowest | `--lex-surface-container-lowest` | `#ffffff` | `#0e0e13` | 容器最低层 |
| surface-container-low | `--lex-surface-container-low` | `#f6f2fa` | `#1a1c22` | 冻结浅色第 1 阶 `96` / 深色 `10` |
| surface-container | `--lex-surface-container` | `#eae7ef` | `#1f1f2a` | 冻结第 2 阶 `92` / `12` |
| surface-container-high | `--lex-surface-container-high` | `#dfdbe3` | `#2a2a33` | 冻结第 3 阶 `88` / `17` |
| surface-container-highest | `--lex-surface-container-highest` | `#d4d0d8` | `#35343d` | 冻结第 4 阶 `84` / `22` |
| surface-variant | `--lex-surface-variant` | `#e4e1ec` | `#47464f` | 冻结 `variant #e4e1ec`（`neutralVariant 90`） |
| on-surface-variant | `--lex-on-surface-variant` | `#47464f` | `#c8c5d0` | 变体表面上文字 |
| outline | `--lex-outline` | `#787680` | `#928f9a` | 边框（中强度） |
| outline-variant | `--lex-outline-variant` | `#c8c5d0` | `#47464f` | 边框（弱） |
| scrim | `--lex-scrim` | `#000000` | `#000000` | 幕布/遮罩，同浅深 |
| shadow | `--lex-shadow` | `#000000` | `#000000` | 阴影 |

> 容器阶梯完整映射（浅色 `tone 96→92→88→84` / 深色 `10→12→17→22`）：
> `#f6f2fa → #eae7ef → #dfdbe3 → #d4d0d8` / `#1a1c22 → #1f1f2a → #2a2a33 → #35343d`，与 `pure-palette.json` 及 Theme Builder 完全一致。

### 1.7 逆色组（Inverse · Toast / Snackbar）

| 角色 | CSS 变量 | 浅色 | 深色 |
|------|----------|------|------|
| inverse-surface | `--lex-inverse-surface` | `#313036` | `#e5e1e9` |
| inverse-on-surface | `--lex-inverse-on-surface` | `#f3eff7` | `#313036` |
| inverse-primary | `--lex-inverse-primary` | `#c3c0ff` | `#5a5892` |

### 1.8 完整 palette.ts 接口（P0 预留，P1 扩展）

```ts
// apps/web/src/theme/palette.ts（P0 收敛为 light/dark 两个 Record，P1 改为 generatePalette(seed)）
export type Role = /* 上表所有 39 个角色名（kebab-case → camelCase） */
export const lightPalette: Record<Role, string> = {
  primary: "#313066", onPrimary: "#ffffff", primaryContainer: "#6867a1", onPrimaryContainer: "#ffffff",
  secondary: "#5e5c71", /* …其余同上表浅色列… */
  background: "#fcf8ff", surface: "#fcf8ff", surfaceContainerLow: "#f6f2fa", /* … */
};
export const darkPalette: Record<Role, string> = {
  primary: "#dbd8ff", onPrimary: "#2b2a60", primaryContainer: "#8c8bc8", onPrimaryContainer: "#16134a",
  /* …同上表深色列… */
};
```

> 首帧注入沿用 `index.html` 内联主题脚本机制：`resolveTheme(preference)` → `data-theme` → `palette[theme][role]` 写入 CSS 变量，`material-color-utilities` 本地运行无网络请求（local-first 红线）。

---

## 2. 对比度矩阵（Contrast Matrix）

> 测量口径：WCAG 2.1 相对亮度，`(Llighter+0.05)/(Ldarker+0.05)`，与 `token-contrast.test.ts` 同一算法；所有 `onX vs X` 满足 **≥ 4.5:1**（M3 AA 目标，正文可读性）。

| 背景 `X` | 前景 `onX` | 浅色对比度 | 深色对比度 | 是否达标 |
|----------|------------|------------|------------|----------|
| primary `#313066` / `#dbd8ff` | on-primary `#ffffff` / `#2b2a60` | 12.03:1 | 9.53:1 | ✅ |
| primary-container `#6867a1` / `#8c8bc8` | on-primary-container `#ffffff` / `#16134a` | 5.19:1 | 5.42:1 | ✅ |
| secondary `#5e5c71` / `#c7c4dd` | on-secondary `#ffffff` / `#2f2e42` | 6.47:1 | 7.78:1 | ✅ |
| secondary-container `#e3e0f9` / `#464559` | on-secondary-container `#1a1a2c` / `#e3e0f9` | 13.27:1 | 7.22:1 | ✅ |
| tertiary `#7a5368` / `#eab9d1` | on-tertiary `#ffffff` / `#472639` | 6.43:1 | 7.70:1 | ✅ |
| tertiary-container `#ffd8ea` / `#603c50` | on-tertiary-container `#2f1123` / `#ffd8ea` | 13.27:1 | 7.20:1 | ✅ |
| error `#ba1a1a` / `#ffb4ab` | on-error `#ffffff` / `#690005` | 6.46:1 | 7.72:1 | ✅ |
| error-container `#ffdad6` / `#93000a` | on-error-container `#410002` / `#ffdad6` | 13.26:1 | 7.24:1 | ✅ |
| success `#1b5c1a` / `#76db7a` | on-success `#ffffff` / `#00390a` | 8.10:1 | 7.66:1 | ✅ |
| success-container `#a6f2a5` / `#005313` | on-success-container `#00210a` / `#a6f2a5` | 12.98:1 | 7.06:1 | ✅ |
| background `#fcf8ff` / `#131318` | on-background `#1b1b21` / `#e5e1e9` | 16.33:1 | 14.35:1 | ✅ |
| surface `#fcf8ff` / `#131318` | on-surface `#1b1b21` / `#e5e1e9` | 16.33:1 | 14.35:1 | ✅ |
| surface-variant `#e4e1ec` / `#47464f` | on-surface-variant `#47464f` / `#c8c5d0` | 7.21:1 | 5.47:1 | ✅ |
| inverse-surface `#313036` / `#e5e1e9` | inverse-on-surface `#f3eff7` / `#313036` | 11.52:1 | 10.13:1 | ✅ |
| inverse-primary `#c3c0ff` / `#5a5892` | 常规文字（深/浅互比） | 7.68:1 | 6.47:1 | ✅ |

> 测试实现：`token-contrast.test.ts` 读取 `tokens.css` 的 `:root` 与 `[data-theme="dark"]` 两套变量，遍历上表所有行，逐对计算；任一 < 4.5:1 即失败并打印 16 进制与实测值。

---

## 3. Shape（形状）与组件映射

### 3.1 Radius Tokens（M3 官方值）

| Token | 值 | CSS 变量 | Tailwind |
|-------|----|----------|----------|
| xs | 4px | `--lex-radius-xs` | `rounded-xs` |
| sm | 8px | `--lex-radius-sm` | `rounded-sm` |
| md | 12px | `--lex-radius-md` | `rounded-md` |
| lg | 16px | `--lex-radius-lg` | `rounded-lg` |
| xl | 28px | `--lex-radius-xl` | `rounded-xl` |
| full | 9999px | `--lex-radius-full` | `rounded-full` |

```css
/* tokens.css */
:root {
  --lex-radius-xs: 4px;
  --lex-radius-sm: 8px;
  --lex-radius-md: 12px;
  --lex-radius-lg: 16px;
  --lex-radius-xl: 28px;
  --lex-radius-full: 9999px;
}
@theme inline { /* Tailwind v4 */
  --radius-xs: var(--lex-radius-xs);
  --radius-sm: var(--lex-radius-sm);
  --radius-md: var(--lex-radius-md);
  --radius-lg: var(--lex-radius-lg);
  --radius-xl: var(--lex-radius-xl);
  --radius-full: var(--lex-radius-full);
}
```

### 3.2 组件映射表

| 组件 / 场景 | 采用 Shape | 示例 |
|-------------|-----------|------|
| 主按钮（Filled / Filled Tonal）、图标按钮（IconButton）、FAB、Chip（选中） | `full` | `rounded-full`，胶囊形，符合 M3 默认气质 |
| 卡片（词卡、列表卡、设置分组卡） | `md` / `lg` | 列表卡 `md 12px`，复习卡/弹窗内卡 `lg 16px` |
| 输入框（搜索框、词库导入输入、设置项输入） | `sm` | `rounded-sm 8px` |
| 弹窗（Dialog / BottomSheet / Drawer） | `xl` | `rounded-xl 28px`，顶部圆角 |
| 小标签、Badge、分割线内小容器 | `xs` | `rounded-xs 4px` |

> 形状气质：全 app 不做大圆角统一，遵循 M3 默认（主按钮 full + 卡片 12/16），与 P0 设计草案一致。

---

## 4. Type Scale（排版刻度 · 15 档全建）

> 数值 = M3 规范 `sp ÷ 16` 转 `rem`（Web 版 sp = rem×16）；`line-height` 为绝对 `rem`；`letter-spacing` 为 `em`（相对）；中文场景 `letter-spacing` 按 `0` 处理（M3 负字距对中文不适用）。

| 类别 | 档位 | Token（CSS / Tailwind） | Size | Line-Height | Letter-Spacing | Weight | 用途举例 |
|------|------|-------------------------|------|-------------|----------------|--------|----------|
| **Display** | large | `--lex-typescale-display-large-*` / `text-display-large` | 3.5625rem (57sp) | 4rem (64sp) | -0.0156em (-0.25sp) | 400 | 空状态大标题 |
| | medium | `display-medium` | 2.8125rem (45sp) | 3.25rem (52sp) | 0em | 400 | 启动页标题 |
| | small | `display-small` | 2.25rem (36sp) | 2.75rem (44sp) | 0em | 400 | 分组大标题 |
| **Headline** | large | `headline-large` | 2rem (32sp) | 2.5rem (40sp) | 0em | 400 | 页面主标题 |
| | medium | `headline-medium` | 1.75rem (28sp) | 2.25rem (36sp) | 0em | 400 | 卡片标题 |
| | small | `headline-small` | 1.5rem (24sp) | 2rem (32sp) | 0em | 400 | 分组标题 |
| **Title** | large | `title-large` | 1.375rem (22sp) | 1.75rem (28sp) | 0em | 400 | 列表项标题、Dialog 标题 |
| | medium | `title-medium` | 1rem (16sp) | 1.5rem (24sp) | 0.0094em (0.15sp) | 500 | 词条标题 |
| | small | `title-small` | 0.875rem (14sp) | 1.25rem (20sp) | 0.0071em (0.1sp) | 500 | 小标题、按钮文字 |
| **Body** | large | `body-large` | 1rem (16sp) | 1.5rem (24sp) | 0.0313em (0.5sp) | 400 | 正文、释义 |
| | medium | `body-medium` | 0.875rem (14sp) | 1.25rem (20sp) | 0.0179em (0.25sp) | 400 | 次要正文、设置说明 |
| | small | `body-small` | 0.75rem (12sp) | 1rem (16sp) | 0.0333em (0.4sp) | 400 | 辅助信息、时间戳 |
| **Label** | large | `label-large` | 0.875rem (14sp) | 1.25rem (20sp) | 0.0071em (0.1sp) | 500 | 按钮标签、Chip |
| | medium | `label-medium` | 0.75rem (12sp) | 1rem (16sp) | 0.0417em (0.5sp) | 500 | 过滤标签 |
| | small | `label-small` | 0.6875rem (11sp) | 1rem (16sp) | 0.0455em (0.5sp) | 500 | 角标、Caption |

```css
/* tokens.css — Type Scale（示例：title-large / body-medium） */
:root {
  --lex-typescale-display-large-size: 3.5625rem; --lex-typescale-display-large-line-height: 4rem; --lex-typescale-display-large-tracking: -0.0156em; --lex-typescale-display-large-weight: 400;
  --lex-typescale-title-large-size: 1.375rem;  --lex-typescale-title-large-line-height: 1.75rem; --lex-typescale-title-large-tracking: 0em; --lex-typescale-title-large-weight: 400;
  --lex-typescale-body-medium-size: 0.875rem;   --lex-typescale-body-medium-line-height: 1.25rem; --lex-typescale-body-medium-tracking: 0.0179em; --lex-typescale-body-medium-weight: 400;
  /* …其余 12 档同理，Tailwind 注册为 --text-* 与 --text-*--line-height */
}
@theme inline {
  --text-display-large: var(--lex-typescale-display-large-size);
  --text-display-large--line-height: var(--lex-typescale-display-large-line-height);
  --tracking-display-large: var(--lex-typescale-display-large-tracking);
}
```

> **字体栈：** `--lex-font-sans: "MiSans", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif`（Alpha 0.10.1 已在做全局统一）+ `--lex-font-mono` 备用；**卡片 7 档字体保持独立不动**（`--lex-card-font` / `--lex-card-font-weight` 已在 `tokens.css` 定义，见 `cardFont.ts`），P0 不改动。
> **中文排版：** 上表 `letter-spacing` 为英文最优；中文场景（含中英混排）统一按 `0` 处理，组件层通过 `:lang(zh)` 或 `lang="zh"` 覆盖，避免负字距导致中文字符粘连。

---

## 5. Motion Token（动效令牌 · P0 建 token + 全局规则，P2 应用）

### 5.1 Durations（M3 官方）

| Token | 值 | CSS 变量 |
|-------|----|----------|
| short1 | 50ms | `--lex-motion-duration-short1` |
| short2 | 100ms | `--lex-motion-duration-short2` |
| medium1 | 250ms | `--lex-motion-duration-medium1` |
| medium2 | 300ms | `--lex-motion-duration-medium2` |
| long1 | 450ms | `--lex-motion-duration-long1` |
| long2 | 500ms | `--lex-motion-duration-long2` |

### 5.2 Easings（M3 官方 cubic-bezier）

| Token | 值 | CSS 变量 |
|-------|----|----------|
| standard | `cubic-bezier(0.2, 0, 0, 1)` | `--lex-motion-easing-standard` |
| standard-decelerate | `cubic-bezier(0, 0, 0, 1)` | `--lex-motion-easing-standard-decelerate` |
| standard-accelerate | `cubic-bezier(0.3, 0, 1, 1)` | `--lex-motion-easing-standard-accelerate` |
| emphasized-decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` | `--lex-motion-easing-emphasized-decelerate` |
| emphasized-accelerate | `cubic-bezier(0.3, 0, 0.8, 0.15)` | `--lex-motion-easing-emphasized-accelerate` |

```css
:root {
  --lex-motion-duration-short1: 50ms; --lex-motion-duration-short2: 100ms;
  --lex-motion-duration-medium1: 250ms; --lex-motion-duration-medium2: 300ms;
  --lex-motion-duration-long1: 450ms; --lex-motion-duration-long2: 500ms;
  --lex-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --lex-motion-easing-emphasized-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);
  --lex-motion-easing-emphasized-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);
  --lex-motion-easing-standard-decelerate: cubic-bezier(0, 0, 0, 1);
  --lex-motion-easing-standard-accelerate: cubic-bezier(0.3, 0, 1, 1);
}
```

### 5.3 全局规则 `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

> P0 落地该全局降级；P2 再将评分确认 / 卡片翻面 / 队列切换等交互接入上述 durations + easings。

---

## 6. 状态层规则（State Layer）

> 不设固定色，统一规则：`color-mix(in srgb, currentColor <opacity>, transparent)` 叠于容器色之上；`currentColor` 取前景色（通常为 `on-*`），与 M3 state layer 语义一致。

| 状态 | 透明度 | CSS 变量 | 用法 |
|------|--------|----------|------|
| hover | 8% | `--lex-state-hover-opacity: 8%` | `background: color-mix(in srgb, currentColor 8%, transparent)` |
| focus | 10% | `--lex-state-focus-opacity: 10%` | 键盘聚焦环内层 |
| pressed | 12% | `--lex-state-pressed-opacity: 12%` | 按下态 |
| dragged | 16% | `--lex-state-dragged-opacity: 16%` | 拖拽态 |

```css
:root {
  --lex-state-hover-opacity: 8%;
  --lex-state-focus-opacity: 10%;
  --lex-state-pressed-opacity: 12%;
  --lex-state-dragged-opacity: 16%;
}
/* 组件示例：按钮 hover */
.lex-button:hover { background: color-mix(in srgb, currentColor var(--lex-state-hover-opacity), transparent); }
```

> 颜色本身由角色决定（如 `primary` 上的状态层用 `on-primary` 的 `currentColor`），不新增角色；与日夜间模式自动适配。

---

## 7. 旧 Token 别名清单及删除计划

### 7.1 旧别名（deprecated，保留至迁移完成）

> 现存 `tokens.css` 中的旧语义 token（`--lex-bg` 等）将保留为已弃用别名，指向新角色，避免一次性全量替换导致回归风险。

| 旧 Token | 指向新角色 | 说明 |
|----------|-----------|------|
| `--lex-bg` | `--lex-background` | 页面背景（旧 `#fafaf9` → 新 `#fcf8ff`） |
| `--lex-surface` | `--lex-surface` | 表面（旧 `#ffffff` → 新 `#fcf8ff`，别名自指但保留兼容） |
| `--lex-surface-raised` | `--lex-surface-container` | 抬升表面 |
| `--lex-border` | `--lex-outline-variant` | 边框 |
| `--lex-text` | `--lex-on-surface` | 主文本（旧 `#1c1917` → 新 `#1b1b21`） |
| `--lex-text-muted` | `--lex-on-surface-variant` | 次要文本 |
| `--lex-primary` | `--lex-primary` | 主色自指（旧 `#4f46e5` → 新 `#313066` / `#dbd8ff`，别名保留） |
| `--lex-primary-contrast` | `--lex-on-primary` | 主色对比文字 |
| `--lex-accent` | `--lex-tertiary` | 强调色 → 三级色 |
| `--lex-danger` | `--lex-error` | 危险 → 错误 |
| `--lex-success` | `--lex-success` | 成功（旧 `#16a34a` → 新 `#1b5c1a`） |
| `--lex-focus-ring` | `--lex-outline` | 聚焦环 |

```css
/* tokens.css — 别名层（deprecated，迁移期保留） */
:root {
  --lex-bg: var(--lex-background);
  --lex-text: var(--lex-on-surface);
  --lex-primary-contrast: var(--lex-on-primary);
  --lex-danger: var(--lex-error);
  /* …其余同上表… */
}
```

### 7.2 删除计划（按批，独立 PR，Oscar 13 条评审）

| 批次 | 范围 | 依赖 | 截图对照 | 目标 |
|------|------|------|----------|------|
| **Batch 1** | `App` / `Header` / `Home` | Token 扩展 + 本文档 | 迁移前后真机/浏览器截图对比，外观不变 | 将三处旧别名替换为新 `--lex-*`，验证主题切换 |
| **Batch 2** | `Review` / `Quiz`（含 `MultipleChoiceCard` / `RatingButtons`） | Batch 1 | 同上，仅结构收敛 | 复习动效容器色、按钮色收敛 |
| **Batch 3** | `Settings` / `Search` / `Stats` / `Notebook` | Batch 2 | 同上 | 设置页、搜索、统计、生词本 |
| **Batch 4** | `Dialogs`（`FirstOpenDialog` / `AddToListsDialog` / `DeveloperPanel` 等） | Batch 3 | 同上 | 弹窗/抽屉的 `xl` 与遮罩 `scrim` |
| **Batch 5 — 删别名** | 全量组件迁完后 | Batch 4 | `scan-hardcoded-colors.mjs` + `tokens-consistency` 双绿 | 删除上表别名层，仅保留 M3 角色；PR 打标签 `BREAKING: remove deprecated --lex-* aliases` |

> 每批独立 PR，外观不变（行为/布局零变化），仅 token 收敛；风险控制：行为不变 + 截图对照，与 Alpha 0.10.1 并行迭代无冲突。

---

## 8. 校验与文件清单

| 校验项 | 文件 | 口径 |
|--------|------|------|
| 颜色/形状/排版/动效同源 | `tokens-consistency.test.ts` | 本文 ↔ `tokens.css` ↔ `palette.ts` 三处同值 |
| 对比度 ≥ 4.5:1 | `token-contrast.test.ts` | 读取 `tokens.css` 两套色板，WCAG 计算，失败拦截 CI |
| 禁止裸色值 | `scripts/scan-hardcoded-colors.mjs` | 源码禁 `#[0-9a-f]{3,8}` / `rgb(` 硬编码（白名单：测试/文档示例） |
| 主题切换 | `theme/resolve.ts` + `index.html` 内联脚本 | `light / dark / system` 三档，跟随系统 `prefers-color-scheme` |

**交付物：**

- `docs/design-tokens.md`（本文）
- `apps/web/src/styles/tokens.css`（浅/深两套 + 别名 + Shape/Type/Motion）
- `apps/web/src/theme/palette.ts`（`light` / `dark` Record，P1 预留 `generatePalette(seed)`）
- `apps/web/src/styles/index.css`（`@theme inline` 映射）

---

## 附录 A · pure-palette.json（摘要）

```json
{
  "seed": "#4F46E5",
  "variant": "TonalSpot",
  "platform": "phone",
  "contrastLevel": 0.0,
  "light": {
    "primary": "#313066", "onPrimary": "#ffffff", "primaryContainer": "#6867a1", "onPrimaryContainer": "#ffffff",
    "secondary": "#5e5c71", "onSecondary": "#ffffff", "secondaryContainer": "#e3e0f9", "onSecondaryContainer": "#1a1a2c",
    "tertiary": "#7a5368", "onTertiary": "#ffffff", "tertiaryContainer": "#ffd8ea", "onTertiaryContainer": "#2f1123",
    "error": "#ba1a1a", "onError": "#ffffff", "errorContainer": "#ffdad6", "onErrorContainer": "#410002",
    "success": "#1b5c1a", "onSuccess": "#ffffff", "successContainer": "#a6f2a5", "onSuccessContainer": "#00210a",
    "background": "#fcf8ff", "onBackground": "#1b1b21", "surface": "#fcf8ff", "onSurface": "#1b1b21",
    "surfaceDim": "#dcd9e0", "surfaceBright": "#fcf8ff", "surfaceContainerLowest": "#ffffff",
    "surfaceContainerLow": "#f6f2fa", "surfaceContainer": "#eae7ef", "surfaceContainerHigh": "#dfdbe3", "surfaceContainerHighest": "#d4d0d8",
    "surfaceVariant": "#e4e1ec", "onSurfaceVariant": "#47464f", "outline": "#787680", "outlineVariant": "#c8c5d0",
    "scrim": "#000000", "shadow": "#000000", "inverseSurface": "#313036", "inverseOnSurface": "#f3eff7", "inversePrimary": "#c3c0ff"
  },
  "dark": {
    "primary": "#dbd8ff", "onPrimary": "#2b2a60", "primaryContainer": "#8c8bc8", "onPrimaryContainer": "#16134a",
    "secondary": "#c7c4dd", "onSecondary": "#2f2e42", "secondaryContainer": "#464559", "onSecondaryContainer": "#e3e0f9",
    "tertiary": "#eab9d1", "onTertiary": "#472639", "tertiaryContainer": "#603c50", "onTertiaryContainer": "#ffd8ea",
    "error": "#ffb4ab", "onError": "#690005", "errorContainer": "#93000a", "onErrorContainer": "#ffdad6",
    "success": "#76db7a", "onSuccess": "#00390a", "successContainer": "#005313", "onSuccessContainer": "#a6f2a5",
    "background": "#131318", "onBackground": "#e5e1e9", "surface": "#131318", "onSurface": "#e5e1e9",
    "surfaceDim": "#131318", "surfaceBright": "#39383f", "surfaceContainerLowest": "#0e0e13",
    "surfaceContainerLow": "#1a1c22", "surfaceContainer": "#1f1f2a", "surfaceContainerHigh": "#2a2a33", "surfaceContainerHighest": "#35343d",
    "surfaceVariant": "#47464f", "onSurfaceVariant": "#c8c5d0", "outline": "#928f9a", "outlineVariant": "#47464f",
    "scrim": "#000000", "shadow": "#000000", "inverseSurface": "#e5e1e9", "inverseOnSurface": "#313036", "inversePrimary": "#5a5892"
  }
}
```

> 完整文件见同目录 `pure-palette.json`；Cale 复核后如有修正，以文件更新为准，本文随之同步。

---

## 附录 B · 变更记录

- **2026-08-23（P0 冻结）：** 单 seed `#4F46E5` Tonal Spot 确定，浅色 `bg #fcf8ff` / 深色 `bg #131318`，容器阶梯与 `variant #e4e1ec` 定版。
- 后续任何 token 新增/删除需先更新本文并通过 `tokens-consistency` 再合入 `tokens.css`。

---

> **写作说明（Vega）：** 本文为 P0 唯一可信来源，数值与 `tokens.css` / `palette.ts` 保持同源；未包含 P1 主题色选择与 P2 动效应用，仅定义 token；卡片 7 档字体与 MiSans 字体栈保持原有约定，不在 Type Scale 中重复。
