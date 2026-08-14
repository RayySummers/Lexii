/**
 * Service Worker 注册（PWA 离线能力入口）。
 *
 * 注册失败（浏览器不支持 / 安全上下文受限 / 隐私模式禁用）一律静默降级——
 * 应用本身完全可用，离线能力仅是不可用时缺席，绝不阻塞启动。
 */
export function registerServiceWorker(scriptUrl: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.register(scriptUrl).catch(() => {
    // 注册失败静默降级（如隐私模式或磁盘配额问题），不影响在线使用
  });
}
