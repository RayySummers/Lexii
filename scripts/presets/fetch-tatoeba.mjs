/**
 * 下载 Tatoeba 例句导出（文本 CC BY 2.0 FR / CC0 子集，ToU §6.2 原文核对见 RAY-267）。
 *
 * 文件（downloads.tatoeba.org，每日更新，无固定 commit）：
 *   - eng_sentences.tsv.bz2 / cmn_sentences.tsv.bz2  句子（id, lang, text，无表头）
 *   - eng-cmn_links.tsv.bz2                          eng↔cmn 句对链接（仅本语言对，省去
 *                                                    全量 links.tar.bz2 的 149MB）
 *   - eng_sentences_CC0.tsv.bz2 / cmn_sentences_CC0.tsv.bz2  CC0 句 id 子集（按句许可列
 *                                                     过滤的依据：导出不含逐句 license
 *                                                     列，许可以「默认 CC BY 2.0 FR +
 *                                                     CC0 子集文件标记」呈现——文本句
 *                                                     子仅这两种许可）
 * 解压用 vendored seek-bzip（MIT，纯 JS；Node 内置 zlib 不支持 bz2）。
 * 下载后逐文件计算 SHA256 写入 manifest.json，后续运行按 manifest 校验复用。
 *
 * 用法：node scripts/presets/fetch-tatoeba.mjs
 * 输出：scripts/presets/.data/tatoeba/*.tsv（git 忽略，bz2 已解压）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { bz2Decompress } from "./lib/bz2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, "scripts", "presets", ".data", "tatoeba");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");

const BASE = "https://downloads.tatoeba.org/exports/per_language";
/** [下载文件名, 解压后文件名]（解压名固定，与下载名去 .bz2） */
const FILES = [
  "eng/eng_sentences.tsv.bz2",
  "cmn/cmn_sentences.tsv.bz2",
  "eng/eng-cmn_links.tsv.bz2",
  "eng/eng_sentences_CC0.tsv.bz2",
  "cmn/cmn_sentences_CC0.tsv.bz2",
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = readManifest() ?? {};
  const files = (manifest.files ??= {});
  let changed = false;
  for (const rel of FILES) {
    const outName = rel
      .replace(/\.bz2$/, "")
      .split("/")
      .pop();
    const outFile = path.join(OUT_DIR, outName);
    const record = files[rel];
    const existing =
      record && existsSync(outFile)
        ? { sha256: sha256(readFileSync(outFile)), bytes: statSync(outFile).size }
        : null;
    if (
      existing &&
      existing.sha256 === record.decompressedSha256 &&
      existing.bytes === record.decompressedBytes
    ) {
      console.log(`已存在且校验通过：${outName}`);
      continue;
    }
    const url = `${BASE}/${rel}`;
    console.log(`下载 ${url} …`);
    const res = await fetch(url, { headers: { "user-agent": "lexilexi-preset-pipeline" } });
    if (!res.ok) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const compressed = Buffer.from(await res.arrayBuffer());
    const decompressed = bz2Decompress(compressed, `${rel} 解压失败：文件损坏或非 bz2`);
    writeFileSync(outFile, decompressed);
    files[rel] = {
      url,
      fetchedAt: new Date().toISOString(),
      lastModified: res.headers.get("last-modified") ?? "",
      compressedBytes: compressed.length,
      compressedSha256: sha256(compressed),
      decompressedBytes: decompressed.length,
      decompressedSha256: sha256(decompressed),
    };
    changed = true;
    console.log(
      `已写入 ${outName}（${(decompressed.length / 1024 / 1024).toFixed(1)} MB 解压后，SHA256 ${sha256(decompressed).slice(0, 16)}…）`,
    );
  }
  if (changed) {
    writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    console.log(`manifest：${MANIFEST_FILE}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
