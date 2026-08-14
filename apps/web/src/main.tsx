import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/register";
import { initPersistenceStatus } from "./settings/persistenceStatus";
import "./styles/index.css";

// 启动时申请持久存储（local-first 数据防线，见 docs/domain-model.md §10）。
// 结果经 lexilexi:storage-permission 事件上报，设置页据此提示；不支持的环境
// 静默降级，绝不阻塞启动。
initPersistenceStatus();

// PWA：仅生产构建注册 Service Worker。开发环境跳过，避免缓存干扰 Vite HMR。
// 注册路径相对当前文档（BASE_URL 为 "./" 时相对部署子路径，如 /Lexilexi/），
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
