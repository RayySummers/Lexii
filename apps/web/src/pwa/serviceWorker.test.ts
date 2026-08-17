/**
 * Service Worker 行为测试（Node vm 加载真实 sw.js + mock 浏览器 API）。
 *
 * 前身是纯字符串冒烟测试，抓不住「安装链值传递」这类运行时回归
 * （Cache.add/addAll/put 按规范解析为 undefined，链式误传会让 install
 * 静默失败——Oscar 复审 blocking）。本套用例在 sandbox 里真实执行
 * install / activate / fetch 处理器并断言缓存内容与回退行为：
 *
 * - install 完成且预缓存应用外壳 + 从 index.html 解析出的带 hash 构建产物；
 * - 外壳中个别资源 404 不阻断安装（allSettled 降级，评审 C2）；
 * - activate 清理旧版本缓存并接管页面；
 * - 导航请求离线时回退到缓存的 index.html（验收点「离线可打开应用」）；
 * - 静态资源未命中缓存时走网络并回填缓存（stale-while-revalidate）；
 * - 非 GET 与跨域请求不拦截。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SW_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/sw.js");

/** 模拟生产构建产物：index.html 引用了带 hash 的 js/css（Vite base "./" 的相对产物） */
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <link rel="stylesheet" href="./assets/index-def456.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/index-abc123.js"></script>
  </body>
</html>`;

const SW_SOURCE = readFileSync(SW_PATH, "utf8");

interface FakeRequest {
  method: string;
  url: string;
  mode: string;
}

/** Cache.match 的选项（只关心 ignoreVary） */
interface MatchOptions {
  ignoreVary?: boolean;
}

/** SW 事件处理器可拿到的事件面（install/activate 只用 waitUntil，fetch 用 request/respondWith） */
interface SwEventLike {
  request?: FakeRequest;
  waitUntil(promise: Promise<unknown>): void;
  respondWith?(promise: Promise<unknown>): void;
}

/**
 * 测试接缝：sw.js 内 fetch 的 mock 实现（输入与真实 fetch 一致：string 或 Request 对象）。
 * sandbox 与 FakeCache 都经由本变量取值，测试中可随时改指（如安装后断网）。
 */
let sandboxFetch: (input: string | FakeRequest) => Promise<Response>;

/** 与 sw.js sandbox 一致的 SW 源（相对 URL 按此解析为绝对 URL） */
const SW_ORIGIN = "http://localhost";

/** SW 脚本默认位置（位于站点根；子路径部署用例会覆盖） */
const DEFAULT_SW_HREF = "http://localhost/sw.js";

/** 归一化缓存键：相对路径按 SW 全局作用域解析为绝对 URL（模拟真实 Cache API） */
function toKey(input: string | FakeRequest): string {
  const raw = typeof input === "string" ? input : input.url;
  return raw.startsWith("/") ? `${SW_ORIGIN}${raw}` : raw;
}

/** 按规范实现的最小 Cache mock：add/put 均解析为 undefined（正是回归点） */
class FakeCache {
  readonly entries = new Map<string, Response>();

  /** 最近一次 match 调用收到的选项（回归断言用） */
  lastMatchOptions: MatchOptions | undefined;

  constructor(readonly name: string) {}

  /** 与规范一致：解析为 undefined（链式误传值会被本套测试抓住） */
  async add(input: string): Promise<void> {
    const response = await sandboxFetch(input);
    this.entries.set(toKey(input), response);
  }

  async put(input: string | FakeRequest, response: Response): Promise<void> {
    this.entries.set(toKey(input), response);
  }

  async match(input: string | FakeRequest, options?: MatchOptions): Promise<Response | undefined> {
    this.lastMatchOptions = options;
    return this.entries.get(toKey(input));
  }
}

interface SwHarness {
  /** 注册在 self 上的事件处理器（install/activate/fetch） */
  handlers: Map<string, (event: SwEventLike) => void>;
  /** 各缓存实例（按名字查找） */
  cachesByName: Map<string, FakeCache>;
  /** CacheStorage mock（含 match 调用记录） */
  cacheStorage: {
    lastMatchOptions?: MatchOptions;
  };
  /** self 上的方法 mock（skipWaiting / clients.claim） */
  skipWaiting: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
}

/** 默认网络：index.html 返回文档，其余资源返回 200 占位内容 */
function defaultFetch(input: string | FakeRequest): Promise<Response> {
  const url = typeof input === "string" ? input : input.url;
  if (url === "/index.html" || url.endsWith("/index.html")) {
    return Promise.resolve(new Response(INDEX_HTML, { status: 200 }));
  }
  return Promise.resolve(new Response(`content of ${url}`, { status: 200 }));
}

/** 加载 sw.js 到 vm sandbox，返回事件处理器与缓存实例（swHref 决定相对路径解析基准） */
function loadServiceWorker(
  fetchImpl: (input: string | FakeRequest) => Promise<Response> = defaultFetch,
  swHref: string = DEFAULT_SW_HREF,
): SwHarness {
  sandboxFetch = fetchImpl;
  const cachesByName = new Map<string, FakeCache>();
  const handlers = new Map<string, (event: SwEventLike) => void>();
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockResolvedValue(undefined);
  const swLocation = new URL(swHref);

  const cacheStorage = {
    /** 最近一次 CacheStorage.match 收到的选项（回归断言用） */
    lastMatchOptions: undefined as MatchOptions | undefined,
    async open(name: string): Promise<FakeCache> {
      let cache = cachesByName.get(name);
      if (!cache) {
        cache = new FakeCache(name);
        cachesByName.set(name, cache);
      }
      return cache;
    },
    async keys(): Promise<string[]> {
      return [...cachesByName.keys()];
    },
    async delete(name: string): Promise<boolean> {
      return cachesByName.delete(name);
    },
    async match(
      input: string | FakeRequest,
      options?: MatchOptions,
    ): Promise<Response | undefined> {
      // CacheStorage.match：跨全部缓存查找（SW 导航回退依赖）
      this.lastMatchOptions = options;
      const key = toKey(input);
      for (const cache of cachesByName.values()) {
        const hit = cache.entries.get(key);
        if (hit) {
          return hit;
        }
      }
      return undefined;
    },
  };

  const self = {
    location: { origin: swLocation.origin, href: swHref },
    addEventListener(type: string, handler: (event: SwEventLike) => void) {
      handlers.set(type, handler);
    },
    skipWaiting,
    clients: { claim },
  };

  const sandbox: Record<string, unknown> = {
    self,
    caches: cacheStorage,
    // 经包装器取 sandboxFetch：测试可随时替换网络层（如安装完成后断网）
    fetch: (input: string | FakeRequest) => sandboxFetch(input),
    URL,
    Response,
    Request,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox);
  return { handlers, cachesByName, cacheStorage, skipWaiting, claim };
}

/** 运行 install 事件（捕获 waitUntil 的 promise 并等待落定） */
async function runInstall(harness: SwHarness): Promise<void> {
  let work: Promise<unknown> = Promise.resolve();
  harness.handlers.get("install")!({
    waitUntil: (promise: Promise<unknown>) => {
      work = promise;
    },
  });
  await work;
}

/** 运行 activate 事件 */
async function runActivate(harness: SwHarness): Promise<void> {
  let work: Promise<unknown> = Promise.resolve();
  harness.handlers.get("activate")!({
    waitUntil: (promise: Promise<unknown>) => {
      work = promise;
    },
  });
  await work;
}

/** 触发一次 fetch 事件，返回 respondWith 收到的 promise 的解析值 */
async function dispatchFetch(
  harness: SwHarness,
  request: FakeRequest,
): Promise<Response | undefined> {
  let responsePromise: Promise<unknown> | undefined;
  harness.handlers.get("fetch")!({
    request,
    waitUntil: () => undefined,
    respondWith: (promise: Promise<unknown>) => {
      responsePromise = promise;
    },
  });
  return (await responsePromise) as Response | undefined;
}

/** 等待浮动的后台 promise（SWR 回填缓存等）落定 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("public/sw.js（vm 沙箱行为测试）", () => {
  it("install 完成：预缓存应用外壳 + 从 index.html 解析的带 hash 构建产物", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);

    const cache = harness.cachesByName.get("lexii-shell-v1");
    expect(cache).toBeDefined();
    for (const shellUrl of [
      "http://localhost/",
      "http://localhost/index.html",
      "http://localhost/manifest.webmanifest",
      "http://localhost/icons/icon-192.png",
    ]) {
      expect(cache!.entries.has(shellUrl)).toBe(true);
    }
    // 回归核心：构建产物必须从 HTML 解析并预缓存（旧版链式误传会在这里缺项）
    expect(cache!.entries.has("http://localhost/assets/index-abc123.js")).toBe(true);
    expect(cache!.entries.has("http://localhost/assets/index-def456.css")).toBe(true);
    expect(harness.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("外壳中个别资源 404 不阻断安装（allSettled 降级，评审 C2）", async () => {
    const harness = loadServiceWorker((url) => {
      if (url === "http://localhost/") {
        return Promise.reject(new TypeError("Failed to fetch")); // 模拟托管方不返回目录索引
      }
      return defaultFetch(url);
    });
    await runInstall(harness);

    const cache = harness.cachesByName.get("lexii-shell-v1");
    expect(cache!.entries.has("http://localhost/")).toBe(false);
    expect(cache!.entries.has("http://localhost/index.html")).toBe(true);
    expect(cache!.entries.has("http://localhost/assets/index-abc123.js")).toBe(true);
  });

  it("activate 清理旧版本缓存并接管已打开的页面", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);
    harness.cachesByName.set("lexii-shell-v0", new FakeCache("lexii-shell-v0"));

    await runActivate(harness);

    expect(harness.cachesByName.has("lexii-shell-v0")).toBe(false);
    expect(harness.cachesByName.has("lexii-shell-v1")).toBe(true);
    expect(harness.claim).toHaveBeenCalledTimes(1);
  });

  it("activate 清理旧版 lexilexi-shell-* 残留缓存（RAY-307 改名迁移）", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);
    // 模拟旧版缓存残留
    harness.cachesByName.set("lexilexi-shell-v1", new FakeCache("lexilexi-shell-v1"));
    harness.cachesByName.set("lexilexi-shell-v0", new FakeCache("lexilexi-shell-v0"));

    await runActivate(harness);

    expect(harness.cachesByName.has("lexilexi-shell-v0")).toBe(false);
    expect(harness.cachesByName.has("lexilexi-shell-v1")).toBe(false);
    expect(harness.cachesByName.has("lexii-shell-v1")).toBe(true);
    expect(harness.claim).toHaveBeenCalledTimes(1);
  });

  it("导航请求离线时回退到缓存的 index.html（验收点：离线可打开应用）", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);

    // 安装后模拟断网：任何网络请求都失败
    sandboxFetch = () => Promise.reject(new TypeError("Failed to fetch"));

    const response = await dispatchFetch(harness, {
      method: "GET",
      url: "http://localhost/some/route",
      mode: "navigate",
    });

    expect(response).toBeDefined();
    expect(response!.ok).toBe(true);
    expect(await response!.text()).toContain("/assets/index-abc123.js");
  });

  it("缓存查找统一忽略 Vary（module script 带 Origin 头也能命中，回归锁定）", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);
    sandboxFetch = () => Promise.reject(new TypeError("Failed to fetch"));

    // module script 请求：cors 模式（真实浏览器会带 Origin 头，
    // 与缓存条目按 Vary: Origin 匹配即判不一致 → 未命中 → 离线崩溃）
    const response = await dispatchFetch(harness, {
      method: "GET",
      url: "http://localhost/assets/index-abc123.js",
      mode: "cors",
    });

    expect(response).toBeDefined();
    expect(response!.ok).toBe(true);
    // 回归锁定：静态资源与导航回退都必须以 ignoreVary 查找缓存
    expect(harness.cacheStorage.lastMatchOptions).toEqual({ ignoreVary: true });
  });

  it("静态资源未命中缓存时走网络并回填缓存（stale-while-revalidate）", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);
    const cache = harness.cachesByName.get("lexii-shell-v1")!;

    const response = await dispatchFetch(harness, {
      method: "GET",
      url: "http://localhost/assets/extra-chunk.js",
      mode: "no-cors",
    });

    expect(response).toBeDefined();
    expect(await response!.text()).toBe("content of http://localhost/assets/extra-chunk.js");
    await flushMicrotasks();
    expect(cache.entries.has("http://localhost/assets/extra-chunk.js")).toBe(true);
  });

  it("非 GET 请求与跨域请求不拦截", async () => {
    const harness = loadServiceWorker();
    await runInstall(harness);
    sandboxFetch = vi.fn().mockRejectedValue(new Error("should not be called"));

    // POST：不 respondWith，也不发起网络
    const postResponse = await dispatchFetch(harness, {
      method: "POST",
      url: "http://localhost/api/review",
      mode: "same-origin",
    });
    expect(postResponse).toBeUndefined();
    expect(sandboxFetch).not.toHaveBeenCalled();

    // 跨域 GET：直接放行，不缓存
    const crossOriginResponse = await dispatchFetch(harness, {
      method: "GET",
      url: "http://cdn.example.com/font.woff2",
      mode: "no-cors",
    });
    expect(crossOriginResponse).toBeUndefined();
    expect(sandboxFetch).not.toHaveBeenCalled();
  });

  it("子路径部署（GitHub Pages /Lexii/）：外壳与构建产物按 SW 位置解析缓存键（RAY-241 回归锁定）", async () => {
    const SW_HREF = "https://rayysummers.github.io/Lexii/sw.js";
    const harness = loadServiceWorker(defaultFetch, SW_HREF);
    await runInstall(harness);

    const cache = harness.cachesByName.get("lexii-shell-v1");
    expect(cache).toBeDefined();
    for (const shellUrl of [
      "https://rayysummers.github.io/Lexii/",
      "https://rayysummers.github.io/Lexii/index.html",
      "https://rayysummers.github.io/Lexii/manifest.webmanifest",
      "https://rayysummers.github.io/Lexii/icons/icon-192.png",
    ]) {
      expect(cache!.entries.has(shellUrl)).toBe(true);
    }
    // 构建产物同样解析到子路径下，而非站点根
    expect(
      cache!.entries.has("https://rayysummers.github.io/Lexii/assets/index-abc123.js"),
    ).toBe(true);
    expect(
      cache!.entries.has("https://rayysummers.github.io/Lexii/assets/index-def456.css"),
    ).toBe(true);

    // 子路径下的导航请求离线时回退到子路径下的 index.html
    sandboxFetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const response = await dispatchFetch(harness, {
      method: "GET",
      url: "https://rayysummers.github.io/Lexii/review",
      mode: "navigate",
    });
    expect(response).toBeDefined();
    expect(response!.ok).toBe(true);
    expect(await response!.text()).toContain("./assets/index-abc123.js");
  });
});
