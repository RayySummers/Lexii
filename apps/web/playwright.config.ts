import { defineConfig, devices } from "@playwright/test";

/**
 * 移动端背词卡片 e2e（RAY-291，评审 nit 1：把真机形态断言沉淀进仓库）。
 *
 * - 固定 iPhone 13 视口（390×844，设备描述符保证移动仿真不抖动），
 *   与 RAY-291 真机反馈的移动端形态同口径；
 * - webServer 强制自启 vite dev（reuseExistingServer: false）：本环境对
 *   未占用的 localhost 端口会返回一个占位页，若开启「复用」会被占位页
 *   骗过、测试打到假页面上；健康检查用 /@vite/client（仅 vite dev 提供），
 *   确保就绪的是真实的开发服务器而非占位页；
 * - 只用 chromium：断言移动视口布局，无需跨浏览器矩阵；
 * - 产物（test-results / playwright-report）已加入 .gitignore。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4199",
    trace: "retain-on-failure",
  },
  // iPhone 13 描述符自带 defaultBrowserType=webkit：这里显式改回 chromium
  // （只用 chromium 验证移动视口布局，不引入 webkit 浏览器依赖）
  projects: [{ name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } }],
  webServer: {
    command: "pnpm dev --port 4199 --strictPort",
    url: "http://localhost:4199/@vite/client",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
