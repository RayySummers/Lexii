/**
 * Lexilexi Service Worker（PWA 离线能力）。
 *
 * 缓存策略（全部仅限同源 GET，不缓存任何跨域请求）：
 * - install：预缓存应用外壳（HTML / 清单 / 图标），并从 index.html 解析出
 *   带 hash 的静态资源 URL（js / css / 图标等）一并预缓存——不依赖构建期
 *   清单，首次在线访问完成安装后即可完全离线使用；成功后立即接管页面。
 *   预缓存逐项 allSettled：个别资源 404（如某些静态托管不给 `/` 返回目录
 *   索引）不使整个安装失败，与全文件「静默降级」哲学一致（Oscar 评审 C2）。
 * - activate：清理旧版本缓存，并接管已打开的页面（clients.claim）。
 * - fetch：
 *   · 导航请求：网络优先，失败回退缓存的 index.html（离线打开应用）；
 *   · 静态资源：stale-while-revalidate（命中缓存即时响应，后台更新）。
 *
 * CACHE_NAME 在「缓存结构或预缓存清单变化」时递增；纯内容更新无需改版本。
 * 本文件为纯静态资源（public/ 原样拷贝进产物），不经 Vite 构建。
 */
const CACHE_NAME = "lexilexi-shell-v1";

/** 应用外壳：导航回退与安装即用所需的最小集合 */
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

/**
 * 逐项预缓存（成功项保留，失败项静默跳过）。
 * 不用 cache.addAll：它任一项失败即整体 reject，会因单个 404 阻断安装。
 */
function precacheAll(cache, urls) {
  return Promise.allSettled(urls.map((url) => cache.add(url)));
}

/**
 * 从 index.html 解析同源静态资源 URL（src / href 属性），
 * 用于把带内容 hash 的构建产物（/assets/*.js、*.css 等）预缓存进当前版本。
 * 解析失败或个别资源缓存失败均静默降级（不阻塞安装）。
 */
async function precacheAssetsFromHtml(cache) {
  let html;
  try {
    const response = await fetch("/index.html", { cache: "no-cache" });
    if (!response.ok) {
      return;
    }
    html = await response.text();
  } catch {
    return;
  }
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    // 仅同源绝对路径静态资源；跳过协议相对 URL、内联 data:、锚点等
    if (url.startsWith("/") && !url.startsWith("//") && url !== "/index.html") {
      urls.add(url);
    }
  }
  await precacheAll(cache, [...urls]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => precacheAll(cache, APP_SHELL))
      .then((cache) => precacheAssetsFromHtml(cache))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return; // 非 GET（IndexedDB 走浏览器自身存储，不经 fetch）不拦截
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return; // 跨域请求不缓存、不干预
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match(request)) ??
          (await caches.match("/index.html")) ??
          (await caches.match("/")),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? fetched;
    }),
  );
});
