/**
 * Service Worker 注册（PWA 离线能力入口）。
 *
 * 注册失败（浏览器不支持 / 安全上下文受限 / 隐私模式禁用 / 脚本 404）一律
 * 不打断应用——离线能力仅是不可用时缺席，绝不阻塞启动。但失败原因对排查
 * 至关重要（如 http 非安全上下文、sw.js 未部署），因此 console.warn 保留
 * 线索而非完全静默（Oscar 复审建议）。
 */
export function registerServiceWorker(scriptUrl: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.register(scriptUrl).catch((error: unknown) => {
    console.warn(
      `Service Worker 注册失败（离线能力不可用）：${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
