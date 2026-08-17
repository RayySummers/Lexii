import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrapTier0Preset } from "./presets/bootstrap";
import { registerServiceWorker } from "./pwa/register";
import { initPersistenceStatus } from "./settings/persistenceStatus";
import "./styles/index.css";

// ─── Lexilexi → Lexii 改名迁移（RAY-307 Oscar suggestion 3）────────────
// 一次性迁移：将旧 lexilexi:* localStorage 键迁移到 lexii:*。
// 仅在首次加载新版时执行（迁移后旧键已删除，后续启动跳过）。
// 产品口径：Rayy 确认当前仅一个用户，迁移为锦上添花，绝不阻塞启动。
try {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("lexilexi:")) {
      const newKey = key.replace("lexilexi:", "lexii:");
      window.localStorage.setItem(newKey, window.localStorage.getItem(key)!);
      window.localStorage.removeItem(key);
    }
  }
} catch {
  // localStorage 不可用时静默忽略，绝不阻塞启动
}

// 启动时申请持久存储（local-first 数据防线，见 docs/domain-model.md §10）。
// 结果经 lexii:storage-permission 事件上报，设置页据此提示；不支持的环境
// 静默降级，绝不阻塞启动。
initPersistenceStatus();

// 首启引导：全新库自动安装 Tier 0 内置核心词表（RAY-258，local-first 开箱可用）。
// fire-and-forget：分块落库、可续装、幂等，失败不阻塞启动（错误仅记录 console）。
bootstrapTier0Preset();

// PWA：仅生产构建注册 Service Worker。开发环境跳过，避免缓存干扰 Vite HMR。
// 注册路径相对当前文档（BASE_URL 为 "./" 时相对部署子路径，如 /Lexii/），
// 与 sw.js 内部「相对 SW 自身位置」的路径策略一致。
if (import.meta.env.PROD) {
  registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
