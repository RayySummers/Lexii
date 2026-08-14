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

export default defineConfig({
  // 相对 base：产物可部署在任意子路径下（如 GitHub Pages 的 /Lexilexi/），
  // 也兼容根路径与自定义域名。PWA 的 manifest / sw.js / 图标路径均已按
  // 「相对自身位置」解析（见 public/sw.js 头注释），与 base 策略一致。
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
