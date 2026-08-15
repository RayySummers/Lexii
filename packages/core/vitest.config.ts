/**
 * @lexilexi/core 的 vitest 配置。
 *
 * 测试与 bench 扫描范围钉在 src/ 内——`tsc -p tsconfig.build.json` 会把
 * src 编译进 dist/，若扫描范围放开，vitest bench 会把 dist 下编译产物
 * 里的 *.bench.js 当作测试源（dist/csv.js 的 ./termPattern.js 引用在
 * dist 中不存在，直接报 FAILED SUITE）。dist/ 仅作类型/产物校验，非
 * 运行入口（package exports 指向 src/），一律排除。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
  benchmark: {
    include: ["src/**/*.{bench,benchmark}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
