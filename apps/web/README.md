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
- `src/App.tsx` — 最小页面（含深色模式切换按钮，验收点 2）

## 约束

- 只做界面与交互；算法逻辑一律放在 `packages/*`
- 跨包引用走公开 API（`@lexilexi/core` 等）
- local-first：不引入任何必须联网才能用的功能
