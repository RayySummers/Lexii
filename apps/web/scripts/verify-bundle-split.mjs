/**
 * 构建产物拆包校验（RAY-262 评审 nit：拆包效果自动化断言，零依赖纯 Node）。
 *
 * 背景：core 子路径 `@lexii/core/presets/books` 词书数据（约 2 MB）与
 * WordbookLibraryScreen 页面均按需加载（React.lazy），必须停留在独立
 * async chunk 中。若有人改回主入口静态 import，词书数据会重新进主
 * bundle，体积与首屏加载时间回退——本脚本在 build 后立即拦下。
 *
 * 断言（宽松阈值，拦截量级回退而非逐 KB 卡点，避免正常增长误报）：
 * 1. index.html 只引用一个主 JS chunk（主入口）；
 * 2. 主 chunk < 1.5 MB（拆包后实测约 1.2 MB；拆包失效时约 3.2 MB）；
 * 3. 存在独立的词书数据 chunk（> 500 KB，拆包后实测约 1.99 MB）；
 * 4. 词书库页面为独立 chunk（> 1 KB，实测约 4.7 KB），且被主 chunk
 *    或词书数据 chunk 动态引用（react 的 __vitePreload 依赖图）。
 *
 * 用法：pnpm --filter @lexii/web verify-bundle-split
 * （由 web 的 build 脚本在 vite build 之后自动调用）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const INDEX_HTML = join(DIST, "index.html");
const ASSETS = join(DIST, "assets");

/** 宽松阈值（见文件头注释） */
const MAIN_CHUNK_MAX_BYTES = 1_500_000;
const BOOKS_CHUNK_MIN_BYTES = 500_000;
const PAGE_CHUNK_MIN_BYTES = 1_000;

function fail(message) {
  console.error(`✗ 拆包校验失败：${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✓ ${message}`);
}

const html = readFileSync(INDEX_HTML, "utf-8");

// 1. 主入口：index.html 只能引用一个 JS chunk（额外的都是拆包回归）
const entryScripts = [
  ...html.matchAll(/<script[^>]+type="module"[^>]+src="\.\/assets\/([^"]+)"/g),
].map((match) => match[1]);
if (entryScripts.length !== 1) {
  fail(`index.html 主入口 JS chunk 数应为 1，实际 ${entryScripts.length}`);
  process.exit(1);
}
const mainChunkFile = join(ASSETS, entryScripts[0]);

// 2/3/4. 按内容特征找词书数据 chunk 与词书库页面 chunk，并检查主 chunk 体积
const jsFiles = readdirSync(ASSETS).filter((name) => name.endsWith(".js"));
if (jsFiles.length === 0) {
  fail("dist/assets 下没有 JS 产物");
  process.exit(1);
}
const mainBytes = statSync(mainChunkFile).size;
if (mainBytes >= MAIN_CHUNK_MAX_BYTES) {
  fail(
    `主 chunk ${entryScripts[0]} 体积 ${(mainBytes / 1024).toFixed(1)} KB 超过阈值 1.5 MB（拆包失效？）`,
  );
} else {
  pass(`主 chunk ${entryScripts[0]} 体积 ${(mainBytes / 1024).toFixed(1)} KB < 1.5 MB`);
}

// 词书数据 chunk：按体积找（唯一 > 500 KB 的 JS chunk 即词书数据，主 chunk 已在上限之下）
const booksChunk = jsFiles
  .map((name) => ({ name, size: statSync(join(ASSETS, name)).size }))
  .find((file) => file.size > BOOKS_CHUNK_MIN_BYTES);
if (!booksChunk) {
  fail("未找到词书数据独立 chunk（> 500 KB 的 async chunk 缺失，数据回主 bundle？）");
} else {
  pass(
    `词书数据独立 chunk ${booksChunk.name} 体积 ${(booksChunk.size / 1024).toFixed(1)} KB > 500 KB`,
  );
}

// 词书库页面 chunk：按内容特征找（页面模块 import 词书数据 chunk，产物中
// 保留原始 export 名 WORDBOOK_CATALOG；而词书数据 chunk 自身也可能含该名）
const pageChunk = jsFiles.find((name) => {
  if (name === entryScripts[0] || name === booksChunk?.name) {
    return false;
  }
  const source = readFileSync(join(ASSETS, name), "utf-8");
  return (
    statSync(join(ASSETS, name)).size >= PAGE_CHUNK_MIN_BYTES &&
    source.includes("WORDBOOK_CATALOG") &&
    source.includes(`./${booksChunk?.name}`)
  );
});
if (!pageChunk) {
  fail("词书库页面未拆为独立 async chunk（懒加载失效？）");
} else {
  pass(
    `词书库页面独立 chunk ${pageChunk}（${(statSync(join(ASSETS, pageChunk)).size / 1024).toFixed(1)} KB）`,
  );
}

// 依赖图：页面 chunk 必须被主 chunk 或词书数据 chunk 动态引用（__vitePreload 元数据）
if (pageChunk) {
  const pageImportRef = pageChunk.replace(".js", "");
  const graphFiles = [mainChunkFile, booksChunk ? join(ASSETS, booksChunk.name) : null].filter(
    Boolean,
  );
  const referenced = graphFiles.some((file) => {
    const source = readFileSync(file, "utf-8");
    return source.includes(pageImportRef) || source.includes(pageChunk);
  });
  if (!referenced) {
    fail(`词书库页面 chunk ${pageChunk} 未被主 chunk 或词书数据 chunk 动态引用`);
  } else {
    pass(`词书库页面 chunk 已被动态引用（懒加载链路完整）`);
  }
}
