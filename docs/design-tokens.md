# 设计令牌规范（Design Tokens）

> 冻结口径：纯 M3 单 seed `#4F46E5` Tonal spot（官方 Theme Builder 默认变体）  
> 单一真相源：`apps/web/src/theme/pure-palette.json` → `tokens.css` / `palette.ts` / 本文档三处同源，`tokens-consistency.test.ts` 自动校验  
> 对比度守护：所有 `onX vs X` ≥ 4.5:1，`token-contrast.test.ts` 读 `tokens.css` 浅/深两套自动计算，CI 拦截

## 1. 颜色角色表（M3 官方角色 + 自定义 success）

前缀 `--lex-*`，Tailwind 映射 `--color-*`（见 `src/styles/index.css` `@theme inline`）。

### 1.1 浅色（light）

| 角色                    | Token                             | 值        | 用途                      |
| ----------------------- | --------------------------------- | --------- | ------------------------- |
| primary                 | `--lex-primary`                   | `#313066` | 主色按钮/主强调           |
| onPrimary               | `--lex-on-primary`                | `#ffffff` | 主色前景（文本/图标）     |
| primaryContainer        | `--lex-primary-container`         | `#6867a1` | 主色容器背景              |
| onPrimaryContainer      | `--lex-on-primary-container`      | `#ffffff` | 容器前景                  |
| secondary               | `--lex-secondary`                 | `#5c5c71` | 次级色                    |
| onSecondary             | `--lex-on-secondary`              | `#ffffff` |                           |
| secondaryContainer      | `--lex-secondary-container`       | `#e2e0f7` |                           |
| onSecondaryContainer    | `--lex-on-secondary-container`    | `#1a1a2e` |                           |
| tertiary                | `--lex-tertiary`                  | `#775365` | 第三色                    |
| onTertiary              | `--lex-on-tertiary`               | `#ffffff` |                           |
| tertiaryContainer       | `--lex-tertiary-container`        | `#ffd8ea` |                           |
| onTertiaryContainer     | `--lex-on-tertiary-container`     | `#2c1122` |                           |
| error                   | `--lex-error`                     | `#ba1a1a` | 错误                      |
| onError                 | `--lex-on-error`                  | `#ffffff` |                           |
| errorContainer          | `--lex-error-container`           | `#ffdad6` |                           |
| onErrorContainer        | `--lex-on-error-container`        | `#410002` |                           |
| success                 | `--lex-success`                   | `#146c2e` | 成功（自定，M3 无此角色） |
| onSuccess               | `--lex-on-success`                | `#ffffff` |                           |
| successContainer        | `--lex-success-container`         | `#a6f2a6` |                           |
| onSuccessContainer      | `--lex-on-success-container`      | `#002106` |                           |
| background              | `--lex-background`                | `#fcf8ff` | 页面背景                  |
| onBackground            | `--lex-on-background`             | `#1c1b1f` |                           |
| surface                 | `--lex-surface`                   | `#fcf8ff` | 卡片/表面                 |
| onSurface               | `--lex-on-surface`                | `#1c1b1f` |                           |
| surfaceVariant          | `--lex-surface-variant`           | `#e4e1ec` | 变体表面                  |
| onSurfaceVariant        | `--lex-on-surface-variant`        | `#47464f` |                           |
| surfaceContainerLowest  | `--lex-surface-container-lowest`  | `#ffffff` | 容器阶梯最低              |
| surfaceContainerLow     | `--lex-surface-container-low`     | `#f6f2fa` |                           |
| surfaceContainer        | `--lex-surface-container`         | `#eae7ef` |                           |
| surfaceContainerHigh    | `--lex-surface-container-high`    | `#dfdbe3` |                           |
| surfaceContainerHighest | `--lex-surface-container-highest` | `#d4d0d8` | 最高                      |
| outline                 | `--lex-outline`                   | `#787680` | 边框                      |
| outlineVariant          | `--lex-outline-variant`           | `#c8c5d0` | 弱边框                    |
| scrim                   | `--lex-scrim`                     | `#000000` | 遮幕                      |
| inverseSurface          | `--lex-inverse-surface`           | `#313034` | 逆色表面（Toast）         |
| inverseOnSurface        | `--lex-inverse-on-surface`        | `#f3eff4` |                           |
| inversePrimary          | `--lex-inverse-primary`           | `#c3c0ff` | 逆色主色                  |

### 1.2 深色（dark, `[data-theme="dark"]`）

| 角色                    | Token                             | 值        |
| ----------------------- | --------------------------------- | --------- |
| primary                 | `--lex-primary`                   | `#dbd8ff` |
| onPrimary               | `--lex-on-primary`                | `#2e2a7a` |
| primaryContainer        | `--lex-primary-container`         | `#8c8bc8` |
| onPrimaryContainer      | `--lex-on-primary-container`      | `#000060` |
| secondary               | `--lex-secondary`                 | `#c7c4dd` |
| onSecondary             | `--lex-on-secondary`              | `#2e2d42` |
| secondaryContainer      | `--lex-secondary-container`       | `#444559` |
| onSecondaryContainer    | `--lex-on-secondary-container`    | `#e2e0f7` |
| tertiary                | `--lex-tertiary`                  | `#eab9d1` |
| onTertiary              | `--lex-on-tertiary`               | `#463041` |
| tertiaryContainer       | `--lex-tertiary-container`        | `#5e3c4d` |
| onTertiaryContainer     | `--lex-on-tertiary-container`     | `#ffd8ea` |
| error                   | `--lex-error`                     | `#ffb4ab` |
| onError                 | `--lex-on-error`                  | `#690005` |
| errorContainer          | `--lex-error-container`           | `#93000a` |
| onErrorContainer        | `--lex-on-error-container`        | `#ffdad6` |
| success                 | `--lex-success`                   | `#88d88a` |
| onSuccess               | `--lex-on-success`                | `#00390f` |
| successContainer        | `--lex-success-container`         | `#00531a` |
| onSuccessContainer      | `--lex-on-success-container`      | `#a6f2a6` |
| background              | `--lex-background`                | `#131318` |
| onBackground            | `--lex-on-background`             | `#e5e1e6` |
| surface                 | `--lex-surface`                   | `#131318` |
| onSurface               | `--lex-on-surface`                | `#e5e1e6` |
| surfaceVariant          | `--lex-surface-variant`           | `#47464f` |
| onSurfaceVariant        | `--lex-on-surface-variant`        | `#c8c5d0` |
| surfaceContainerLowest  | `--lex-surface-container-lowest`  | `#0f0e13` |
| surfaceContainerLow     | `--lex-surface-container-low`     | `#1a1c22` |
| surfaceContainer        | `--lex-surface-container`         | `#1f1f2a` |
| surfaceContainerHigh    | `--lex-surface-container-high`    | `#2a2a33` |
| surfaceContainerHighest | `--lex-surface-container-highest` | `#35343d` |
| outline                 | `--lex-outline`                   | `#928f9a` |
| outlineVariant          | `--lex-outline-variant`           | `#47464f` |
| scrim                   | `--lex-scrim`                     | `#000000` |
| inverseSurface          | `--lex-inverse-surface`           | `#e5e1e6` |
| inverseOnSurface        | `--lex-inverse-on-surface`        | `#313034` |
| inversePrimary          | `--lex-inverse-primary`           | `#4f46e5` |

### 1.3 旧别名（deprecated，兼容存量组件，禁止新代码使用）

| 旧 Token                 | 指向新角色                 | 浅色等价  | 深色等价  |
| ------------------------ | -------------------------- | --------- | --------- |
| `--lex-bg`               | `--lex-background`         | `#fcf8ff` | `#131318` |
| `--lex-surface-raised`   | `--lex-surface-container`  | `#eae7ef` | `#1f1f2a` |
| `--lex-border`           | `--lex-outline-variant`    | `#c8c5d0` | `#47464f` |
| `--lex-text`             | `--lex-on-background`      | `#1c1b1f` | `#e5e1e6` |
| `--lex-text-muted`       | `--lex-on-surface-variant` | `#47464f` | `#c8c5d0` |
| `--lex-primary-contrast` | `--lex-on-primary`         | `#ffffff` | `#2e2a7a` |
| `--lex-accent`           | `--lex-tertiary`           | `#775365` | `#eab9d1` |
| `--lex-danger`           | `--lex-error`              | `#ba1a1a` | `#ffb4ab` |
| `--lex-focus-ring`       | `--lex-primary`            | `#313066` | `#dbd8ff` |

> 别名以 `var(--lex-*)` 实现，数值随主题自动切换；新代码请直接使用 M3 命名。按批次迁移后别名将删除。

## 2. 对比度矩阵（WCAG AA ≥ 4.5:1）

`token-contrast.test.ts` 自动计算浅/深两套所有 `onX vs X` 的对比度，数值与下表一致即通过。

| 前景 / 背景                               | 浅色对比度 | 深色对比度 | 是否 ≥4.5 |
| ----------------------------------------- | ---------- | ---------- | --------- |
| onPrimary / primary                       | 12.03      | 8.84       | ✅        |
| onPrimaryContainer / primaryContainer     | 5.19       | 5.68       | ✅        |
| onSecondary / secondary                   | 6.51       | 7.88       | ✅        |
| onSecondaryContainer / secondaryContainer | 13.19      | 7.25       | ✅        |
| onTertiary / tertiary                     | 6.54       | 7.02       | ✅        |
| onTertiaryContainer / tertiaryContainer   | 13.44      | 7.29       | ✅        |
| onError / error                           | 6.46       | 7.72       | ✅        |
| onErrorContainer / errorContainer         | 13.26      | 7.24       | ✅        |
| onSuccess / success                       | 6.53       | 7.69       | ✅        |
| onSuccessContainer / successContainer     | 13.01      | 7.05       | ✅        |
| onBackground / background                 | 16.32      | 13.5       | ✅        |
| onSurface / surface                       | 16.32      | 13.5       | ✅        |
| onSurfaceVariant / surfaceVariant         | 7.21       | 7.5        | ✅        |
| inverseOnSurface / inverseSurface         | 11.2       | 11.2       | ✅        |

> surfaceContainer 阶梯（low/low/high/highest）均以 `onSurface (#1c1b1f / #e5e1e6)` 为前景，容器色阶越高对比度略降但仍 >12。实测值见测试输出。

## 3. 组件映射

### Shape（圆角）

| Token               | 值     | Tailwind       | 组件映射               |
| ------------------- | ------ | -------------- | ---------------------- |
| `--lex-radius-xs`   | 4px    | `rounded-xs`   | 细分割线、徽标         |
| `--lex-radius-sm`   | 8px    | `rounded-sm`   | 输入框、选择器         |
| `--lex-radius-md`   | 12px   | `rounded-md`   | 卡片                   |
| `--lex-radius-lg`   | 16px   | `rounded-lg`   | 卡片（大）、抽屉       |
| `--lex-radius-xl`   | 28px   | `rounded-xl`   | 弹窗、底部 Sheet       |
| `--lex-radius-full` | 9999px | `rounded-full` | 主按钮、图标按钮、胶囊 |

### Type Scale（15 档，rem = sp/16，Token 前缀 `--lex-typescale-`，中文 tracking 按 0）

| Tier            | Token 前缀                        | Size (`--lex-typescale-*-size`) | 行高         | 字距 (tracking)     | 字重 | Tailwind               |
| --------------- | --------------------------------- | ------------------------------- | ------------ | ------------------- | ---- | ---------------------- |
| display-large   | `--lex-typescale-display-large`   | 3.5625rem (57sp)                | 4rem (64sp)  | -0.016rem (-0.25sp) | 400  | `text-display-large`   |
| display-medium  | `--lex-typescale-display-medium`  | 2.8125rem (45)                  | 3.25rem (52) | 0                   | 400  | `text-display-medium`  |
| display-small   | `--lex-typescale-display-small`   | 2.25rem (36)                    | 2.75rem (44) | 0                   | 400  | `text-display-small`   |
| headline-large  | `--lex-typescale-headline-large`  | 2rem (32)                       | 2.5rem (40)  | 0                   | 400  | `text-headline-large`  |
| headline-medium | `--lex-typescale-headline-medium` | 1.75rem (28)                    | 2.25rem (36) | 0                   | 400  | `text-headline-medium` |
| headline-small  | `--lex-typescale-headline-small`  | 1.5rem (24)                     | 2rem (32)    | 0                   | 400  | `text-headline-small`  |
| title-large     | `--lex-typescale-title-large`     | 1.375rem (22)                   | 1.75rem (28) | 0                   | 400  | `text-title-large`     |
| title-medium    | `--lex-typescale-title-medium`    | 1rem (16)                       | 1.5rem (24)  | 0.009rem (0.15)     | 500  | `text-title-medium`    |
| title-small     | `--lex-typescale-title-small`     | 0.875rem (14)                   | 1.25rem (20) | 0.006rem (0.10)     | 500  | `text-title-small`     |
| body-large      | `--lex-typescale-body-large`      | 1rem (16)                       | 1.5rem (24)  | 0.031rem (0.5)      | 400  | `text-body-large`      |
| body-medium     | `--lex-typescale-body-medium`     | 0.875rem (14)                   | 1.25rem (20) | 0.016rem (0.25)     | 400  | `text-body-medium`     |
| body-small      | `--lex-typescale-body-small`      | 0.75rem (12)                    | 1rem (16)    | 0.025rem (0.4)      | 400  | `text-body-small`      |
| label-large     | `--lex-typescale-label-large`     | 0.875rem (14)                   | 1.25rem (20) | 0.006rem (0.10)     | 500  | `text-label-large`     |
| label-medium    | `--lex-typescale-label-medium`    | 0.75rem (12)                    | 1rem (16)    | 0.031rem (0.5)      | 500  | `text-label-medium`    |
| label-small     | `--lex-typescale-label-small`     | 0.6875rem (11)                  | 1rem (16)    | 0.031rem (0.5)      | 500  | `text-label-small`     |

- 字体栈 `--lex-font-sans: "MiSans", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif`；`--lex-font-mono` 备用。
- 卡片 7 档字体（inter / sentient / geist-mono / nunito / geist-pixel 等）保持独立，不走此 15 档；复用 `var(--lex-card-font)`。
- 中文场景 `letter-spacing` 按 0 处理（M3 负字距对中文不适用）；文档已注明，组件中按需覆盖。

## 4. Motion

### durations

| Token                           | 值    |
| ------------------------------- | ----- |
| `--lex-motion-duration-short1`  | 50ms  |
| `--lex-motion-duration-short2`  | 100ms |
| `--lex-motion-duration-medium1` | 250ms |
| `--lex-motion-duration-medium2` | 300ms |
| `--lex-motion-duration-long1`   | 450ms |
| `--lex-motion-duration-long2`   | 500ms |

### easings

| Token                                       | 值                                |
| ------------------------------------------- | --------------------------------- |
| `--lex-motion-easing-standard`              | `cubic-bezier(0.2, 0, 0, 1)`      |
| `--lex-motion-easing-emphasized-decelerate` | `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| `--lex-motion-easing-emphasized-accelerate` | `cubic-bezier(0.3, 0, 0.8, 0.15)` |
| `--lex-motion-easing-standard-decelerate`   | `cubic-bezier(0, 0, 0, 1)`        |
| `--lex-motion-easing-standard-accelerate`   | `cubic-bezier(0.3, 0, 1, 1)`      |

### 全局降级

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

P0 仅落地 token 与全局规则，P2 再应用到评分确认 / 卡片翻面 / 队列切换等交互。

## 5. 状态层规则

不设固定色，统一 `color-mix(in srgb, currentColor X%, transparent)`：

- hover 8%
- focus 10%
- pressed 12%
- dragged 16%

组件按需 `background: color-mix(in srgb, currentColor 8%, transparent)` 叠加。

## 6. 同源校验

- 唯一来源 `pure-palette.json`
- `tokens.css` / `palette.ts` / 本文档三处数值由 `tokens-consistency.test.ts` 校验，不一致即 CI 失败
- 守护：`token-contrast.test.ts`（对比度）、`scan-hardcoded-colors.mjs`（禁硬编码 hex/rgb）亦接入 CI
