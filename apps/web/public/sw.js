/**
 * Lexii Service Worker（PWA 离线能力）。
 *
 * 路径策略（重要）：本文件所有应用内路径一律「相对 SW 自身位置」解析
 * （resolveUrl），缓存键统一为绝对 URL。因此应用可部署在任意子路径下
 * （GitHub Pages 的 /Lexii/、根路径、自定义域名），无需按部署环境改写。
 * 与 Vite base "./"、manifest / index.html 的相对路径策略保持一致。
 *
 * 缓存策略：
 * - install：预缓存应用外壳（HTML / 清单 / 图标），并从 index.html 解析出
 *   带 hash 的静态资源 URL（js / css / 图标等）一并预缓存——不依赖构建期
 *   清单，首次在线访问完成安装后即可完全离线使用；成功后立即接管页面。
 *   预缓存逐项 allSettled：个别资源 404（如某些静态托管不给目录索引）不使
 *   整个安装失败，与全文件「静默降级」哲学一致（Oscar 评审 C2）。
 *   RAY-323：卡片字体（Google Fonts CSS + 字体文件）同样在 install 预缓存
 *   （见 precacheCardFonts）——离线时复习卡保持所选字面，不退回系统字体。
 * - activate：清理旧版本缓存，并接管已打开的页面（clients.claim）。
 * - fetch：
 *   · 导航请求：网络优先，失败回退缓存的 index.html（离线打开应用）；
 *   · 静态资源：stale-while-revalidate（命中缓存即时响应，后台更新）；
 *   · Google Fonts（fonts.googleapis.com / fonts.gstatic.com）：
 *     字体文件缓存优先（版本化 URL 不可变）；CSS 网络优先（内容随 UA
 *     变化，SW 预缓存副本仅作离线回退）。
 *   · 其余跨域请求不拦截、不缓存（local-first 红线：不碰第三方数据）。
 *
 * CACHE_NAME 在「缓存结构或预缓存清单变化」时递增；纯内容更新无需改版本。
 * 本文件为纯静态资源（public/ 原样拷贝进产物），不经 Vite 构建。
 */
const CACHE_NAME = "lexii-shell-v2";

/**
 * 卡片字体 CSS 入口（RAY-323）：与 index.html 的 <link href> 完全一致，
 * 否则离线回退的 CSS 缓存键与页面请求对不上。字体文件 URL 不写死——
 * 由下方 precacheCardFonts 在安装时从该 CSS 的 @font-face src 解析，
 * 规避 Google 升版本号后 URL 失效（与从 index.html 解析构建产物的
 * 策略同口径）。
 */
const CARD_FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@800&family=Newsreader:wght@600&family=Playpen+Sans:wght@600&family=Google+Sans+Flex:wght@600&display=swap";

/** Google Fonts 域名（fetch 处理器放行的唯一跨域白名单） */
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

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

/**
 * 预缓存卡片字体（RAY-323，Oscar 评审 suggestion 3）：离线时复习卡保持
 * 所选字面，不退回系统字体。
 *
 * 安装时抓取 CARD_FONT_CSS_URL（仅在线可完成），把 CSS 本体与其中
 * @font-face src 引用的字体文件一并预缓存。任何一步失败都静默跳过——
 * 字体是装饰层，离线时回退系统字体栈也不阻断安装（与外壳预缓存同哲学）。
 *
 * CSS 内容随 UA 变化：预缓存副本是 SW UA 的形态，仅作离线回退；
 * 在线时 fetch 处理器对 CSS 走网络优先，页面仍拿到与自己 UA 匹配的 CSS。
 */
async function precacheCardFonts(cache) {
  let response;
  try {
    response = await fetch(CARD_FONT_CSS_URL, { cache: "no-cache" });
    if (!response.ok) {
      return;
    }
    const css = await response.clone().text();
    // 先存 CSS 本体（页面 <link> 的缓存键），再逐项存字体文件；
    // put 失败（响应体已消费等异常）不阻断其余流程
    try {
      await cache.put(CARD_FONT_CSS_URL, response);
    } catch {
      return;
    }
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
    await precacheAll(cache, urls);
  } catch {
    // 离线安装 / 网络失败：跳过字体预缓存，在线后下次安装补上
  }
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
  await precacheCardFonts(cache);
  await self.skipWaiting();
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            // RAY-307 Oscar suggestion 5：额外清理旧版 lexilexi-shell-* 缓存
            // （改名前残留，activate 的 name !== CACHE_NAME 已覆盖，此处显式
            // 匹配确保即使未来 CACHE_NAME 前缀变化也能清理旧缓存）
            .concat(
              names.filter((name) => name.startsWith("lexilexi-shell-") && name !== CACHE_NAME),
            )
            .filter((name, i, arr) => arr.indexOf(name) === i) // 去重
            .map((name) => caches.delete(name)),
        ),
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

/**
 * RAY-323（Oscar 评审 suggestion 3）：Google Fonts 请求处理。
 * - fonts.gstatic.com（字体文件）：缓存优先——版本化 URL 内容不可变，
 *   命中即离线可用；未命中走网络并在成功时回填缓存（与同源静态资源的
 *   stale-while-revalidate 同款），页面 UA 请求的文件可能不在安装预缓存
 *   里（CSS 随 UA 变化），首次在线请求后补齐。
 * - fonts.googleapis.com（CSS）：网络优先——CSS 内容随 UA 变化，SW 预缓存
 *   副本（SW UA 形态）仅作离线回退；网络失败时回退缓存，无缓存则让请求
 *   自然失败（浏览器按 font-display: swap 走字体回退，不影响页面）。
 */
function respondWithFont(request, url, event) {
  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(
      fetch(request).catch(async () => {
        const hit = await caches.match(request, MATCH_OPTIONS);
        if (!hit) {
          throw new TypeError("字体 CSS 离线且无缓存");
        }
        return hit;
      }),
    );
    return;
  }
  event.respondWith(
    caches.match(request, MATCH_OPTIONS).then((hit) => {
      if (hit) {
        return hit;
      }
      return fetch(request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
    }),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return; // 非 GET（IndexedDB 走浏览器自身存储，不经 fetch）不拦截
  }
  const url = new URL(request.url);

  // RAY-323：Google Fonts 是唯一放行的跨域白名单，其余跨域请求不缓存、不干预
  if (FONT_HOSTS.has(url.hostname)) {
    respondWithFont(request, url, event);
    return;
  }
  if (url.origin !== self.location.origin) {
    return;
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
