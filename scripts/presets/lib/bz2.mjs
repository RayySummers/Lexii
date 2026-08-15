/**
 * bz2 解压薄封装（Node 内置 zlib 不支持 bz2）。
 *
 * 实现为 vendored seek-bzip（MIT，https://www.npmjs.com/package/seek-bzip，
 * 完整许可文本见 lib/vendor/seek-bzip/LICENSE）。仅构建期使用：
 * Tatoeba 官方导出为 .bz2 压缩，解压一次后产物（.tsv）进入 .data/ 缓存，
 * 运行时与产物均不依赖本模块。
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const seekBzip = require("./vendor/seek-bzip/lib/index.js");

/**
 * 解压 bz2 数据为 Buffer。
 *
 * @param {Buffer} compressed bz2 压缩数据
 * @param {string} errorMessage 解压失败时的错误前缀
 * @returns {Buffer} 解压后数据（UTF-8 文本）
 */
export function bz2Decompress(compressed, errorMessage = "bz2 解压失败") {
  try {
    const out = seekBzip.decode(compressed);
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  } catch (err) {
    throw new Error(`${errorMessage}：${err instanceof Error ? err.message : String(err)}`);
  }
}
