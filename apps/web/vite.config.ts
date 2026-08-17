import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 构建时注入版本号（RAY-251）：以 apps/web/package.json 的 version 为唯一来源，
// 设置页底部展示 `__APP_VERSION__`。发版时只需改 package.json，UI 自动跟随，
// 无需在组件里硬编码版本号。vitest 同样应用该 define，测试可引用同一常量。
const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

/**
 * 构建信息注入（RAY-297 任务 B）：commit SHA、构建时间、分支/tag、通道与
 * 历史 Release 列表全部在构建时收集，经 `define` 注入 `__APP_BUILD__`，
 * 运行时零网络请求（local-first 红线）。优先级：CI 显式环境变量 → git 命令
 * → 占位值；任何一步失败都不阻塞构建（构建信息缺失不应当让产物不可用）。
 *
 * - LEXII_CHANNEL：release / dev（两个部署 workflow 分别设置；本地默认 dev）
 * - BUILD_SHA / BUILD_BRANCH：CI 里按构建分别设置；本地回退 git rev-parse /
 *   branch --show-current（shallow 检出或非 git 环境下回退 "unknown"）
 * - 历史 Release 列表：LEXII_RELEASE_TAGS（逗号分隔）或 `git tag --list v*`
 *   按版本倒序；始终把当前版本 `v{version}` 置顶并去重，shallow 环境下
 *   列表至少包含当前版本。
 */
function runGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const buildChannel = process.env.LEXII_CHANNEL === "release" ? "release" : "dev";
const buildSha = process.env.BUILD_SHA ?? runGit(["rev-parse", "--short", "HEAD"]) ?? "unknown";
const buildBranch =
  process.env.BUILD_BRANCH ??
  process.env.GITHUB_REF_NAME ??
  runGit(["branch", "--show-current"]) ??
  "unknown";
const buildTime = new Date().toISOString();
const currentVersionTag = `v${packageJson.version}`;
const releaseTags = [
  currentVersionTag,
  ...(process.env.LEXII_RELEASE_TAGS ?? runGit(["tag", "--list", "v*", "--sort=-v:refname"]) ?? "")
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag !== currentVersionTag),
].slice(0, 21);

export default defineConfig({
  // 相对 base：产物可部署在任意子路径下（如 GitHub Pages 的 /Lexii/），
  // 也兼容根路径与自定义域名。PWA 的 manifest / sw.js / 图标路径均已按
  // 「相对自身位置」解析（见 public/sw.js 头注释），与 base 策略一致。
  // 双通道（RAY-297）下同样成立：稳定版在根路径、dev 在 /dev/ 子路径，
  // 相对 base 无需按通道改写。
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_BUILD__: JSON.stringify({
      channel: buildChannel,
      sha: buildSha,
      time: buildTime,
      branch: buildBranch,
      releaseTags,
    }),
  },
  // 体积告警阈值：词书数据惰性 chunk（约 1.99 MB，仅打开词书库时加载）
  // 是拆包后的固有体积，持续触发默认 500 KB 告警属噪声。主 bundle 回退
  // 由 build 脚本末尾的 verify-bundle-split.mjs 硬校验（< 1.5 MB）兜底，
  // 故全局阈值提到 2.5 MB 只消噪声、不放水。
  build: {
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // Playwright e2e（RAY-291 评审 nit 1）由 `pnpm test:e2e` 单独运行，
    // 不进入 vitest（浏览器断言依赖真实布局与 IndexedDB，jsdom 无法承载）。
    // 注意：自定义 exclude 会整体替换 vitest 默认排除，此处保留常用默认项。
    exclude: [
      "e2e/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.vite/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
});
