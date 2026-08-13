# packages 目录：打包约定与发布 checklist

> 本文件讲「包怎么打包与发布」；各包「做什么」见各自的 `README.md`。

## 当前状态：全部 private，仅从源码消费

- 五个 packages（`ai` / `core` / `eval` / `fsrs` / `stats`）均为 `private: true`、版本 `0.0.0`，**不发布 npm**。
- `exports` / `main` / `types` 统一指向 `./src/index.ts`：pnpm workspace 与 vite/tsc 直接解析源码，开发与构建都无需预先 build 各包。
- 因此**不声明 `files` 字段**——该字段只对 npm 发布生效，对 private 包是死字段，且与 `exports` 指向 `src` 矛盾（RAY-248 已删除）。
- 新增 package 请遵循同一约定：`private: true` + `exports` 指向 `src` + 不写 `files`。

## 构建

各包 `pnpm --filter <pkg> build` 执行 `tsc -p tsconfig.build.json`，输出 `dist`（declaration + declarationMap + sourceMap，`outDir: dist`、`rootDir: src`）。当前仅供 CI 验证可编译性，不参与实际消费。

## 未来若走发布流程（checklist）

需要发布某包到 npm 时，逐项执行：

1. 该包 `private` 改为 `false`，恢复 `"files": ["dist"]`；
2. `exports` / `main` / `types` 改指构建产物：`./dist/index.js` 与 `./dist/index.d.ts`；
3. 确认构建输出就绪：`tsc -p tsconfig.build.json` 产出 `dist`（声明文件齐全，当前配置已满足）；
4. 补齐发布元数据（`license`、`repository`、`publishConfig` 等，许可为 GPL-3.0）；
5. 调整消费路径：`exports` 改指 `dist` 后，fresh clone 需先 build 各包才能 `pnpm dev`，需引入构建编排（或 predev 钩子）再落地。
