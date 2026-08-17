/**
 * Lexilexi Service Worker（PWA 离线能力）。
 *
 * 路径策略（重要）：本文件所有应用内路径一律「相对 SW 自身位置」解析
 * （resolveUrl），缓存键统一为绝对 URL。因此应用可部署在任意子路径下
 * （GitHub Pages 的 /Lexilexi/、根路径、自定义域名），无需按部署环境改写。
 * 与 Vite base "./"、manifest / index.html 的相对路径策略保持一致。
 *
 * 缓存策略（全部仅限同源 GET，不缓存任何跨域请求）：
 * - install：预缓存应用外壳（HTML / 清单 / 图标），并从 index.html 解析出
 *   带 hash 的静态资源 URL（js / css / 图标等）一并预缓存——不依赖构建期
 *   清单，首次在线访问完成安装后即可完全离线使用；成功后立即接管页面。
 *   预缓存逐项 allSettled：个别资源 404（如某些静态托管不给目录索引）不使
 *   整个安装失败，与全文件「静默降级」哲学一致（Oscar 评审 C2）。
 * - activate：清理旧版本缓存，并接管已打开的页面（clients.claim）。
 * - fetch：
 *   · 导航请求：网络优先，失败回退缓存的 index.html（离线打开应用）；
 *   · 静态资源：stale-while-revalidate（命中缓存即时响应，后台更新）。
 *
 * CACHE_NAME 在「缓存结构或预缓存清单变化」时递增；纯内容更新无需改版本。
 * 本文件为纯静态资源（public/ 原样拷贝进产物），不经 Vite 构建。
 */
const CACHE_NAME = "lexilexi-shell-v1";

/** 以 SW 自身位置解析应用内路径为绝对 URL（同源）。 */
function resolveUrl(path) {
  return new URL(path, self.location.href).href;
}

/** 应用外壳：导航回退与安装即用所需的最小集合（相对 SW 位置，缓存键为绝对 URL） */
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
].map(resolveUrl);

/** 导航回退与外壳解析使用的入口 URL */
const INDEX_URL = resolveUrl("./index.html");
const ROOT_URL = resolveUrl("./");

/**
 * 逐项预缓存（成功项保留，失败项静默跳过）。
 * 不用 cache.addAll：它任一项失败即整体 reject，会因单个 404 阻断安装。
 */
function precacheAll(cache, urls) {
  return Promise.allSettled(urls.map((url) => cache.add(url)));
}

/**
 * 从 index.html 解析同源静态资源 URL（src / href 属性），
 * 用于把带内容 hash 的构建产物（./assets/*.js、*.css 等）预缓存进当前版本。
 * 接受相对路径（./ 与 ../）与根绝对路径（/，非 //），统一经 resolveUrl
 * 解析为绝对 URL；解析失败或个别资源缓存失败均静默降级（不阻塞安装）。
 */
async function precacheAssetsFromHtml(cache) {
  let html;
  try {
    const response = await fetch(INDEX_URL, { cache: "no-cache" });
    if (!response.ok) {
      return;
    }
    html = await response.text();
  } catch {
    return;
  }
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const raw = match[1];
    // 仅应用内路径：./、../ 或单个 / 开头；跳过协议相对 URL（//）、
    // 内联 data:、锚点、以及 index.html 自身
    if (!/^(?:\.\.?\/|\/(?!\/))/.test(raw)) {
      continue;
    }
    const abs = resolveUrl(raw);
    if (abs === INDEX_URL) {
      continue;
    }
    urls.add(abs);
  }
  await precacheAll(cache, [...urls]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
});

/**
 * 安装流程：打开缓存 → 预缓存外壳 → 预缓存构建产物 → 立即接管页面。
 *
 * 注意（Oscar 复审 blocking）：Cache.add / addAll / put 按规范都解析为
 * undefined，Promise.allSettled 解析为结果数组——若用 .then 链把前一步的
 * 解析值传给下一步，拿到的是 undefined/数组而非 Cache 对象，会导致
 * 类型错误使整个安装失败（SW 进入 redundant）。这里显式 async/await，
 * 每一步都从本地变量取 cache，不依赖链上解析值。
 */
async function installShell() {
  const cache = await caches.open(CACHE_NAME);
  await precacheAll(cache, APP_SHELL);
  await precacheAssetsFromHtml(cache);
  await self.skipWaiting();
}

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

/**
 * 缓存查找统一选项：忽略 Vary。
 *
 * 关键（Oscar 复审后续，实测定性）：托管方可能给静态资源响应带
 * `Vary: Origin`（vite preview 即如此）。缓存条目由 cache.add 写入时，
 * 其内部请求不带 Origin 头；而 module script 的请求**一定带 Origin**
 * （模块脚本强制 cors 模式）。两者按 Vary 匹配即判定不一致 → 缓存未命中 →
 * 离线回退拿不到响应，module script 报 net::ERR_FAILED（经典脚本不带
 * Origin 反而能命中）。本应用全部缓存条目为同源且不按 Vary 变体区分，
 * 一律忽略 Vary 匹配。
 */
const MATCH_OPTIONS = { ignoreVary: true };

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return; // 非 GET（IndexedDB 走浏览器自身存储，不经 fetch）不拦截
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return; // 跨域请求不缓存、不干预
  }

  // RAY-294：扩展词包请求（presets 路径）不拦截、不缓存
  const presetsUrl = resolveUrl("./presets/");
  if (url.href.startsWith(presetsUrl)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match(request, MATCH_OPTIONS)) ??
          (await caches.match(INDEX_URL, MATCH_OPTIONS)) ??
          (await caches.match(ROOT_URL, MATCH_OPTIONS)),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request, MATCH_OPTIONS).then((cached) => {
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
