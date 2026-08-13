import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initPersistenceStatus } from "./settings/persistenceStatus";
import "./styles/index.css";

// 启动时申请持久存储（local-first 数据防线，见 docs/domain-model.md §10）。
// 结果经 lexilexi:storage-permission 事件上报，设置页据此提示；不支持的环境
// 静默降级，绝不阻塞启动。
initPersistenceStatus();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
