import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 相对 base：产物可部署在任意子路径下（如 GitHub Pages 的 /Lexilexi/），
  // 也兼容根路径与自定义域名。PWA 的 manifest / sw.js / 图标路径均已按
  // 「相对自身位置」解析（见 public/sw.js 头注释），与 base 策略一致。
  base: "./",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
