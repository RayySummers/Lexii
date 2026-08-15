/**
 * 下载 ipa-dict 美/英双音标文件（仅 en_US / en_UK，避开仓库内个别 NC 语种文件）。
 *
 * 许可（RAY-267 核对 Credits 节原文）：en_US 基于 cmudict-ipa（MIT）派生，
 * en_UK 基于 ipacards（GPL-3.0）；repo 整体 MIT（第三方数据保留原许可）。
 * 来源固定到 commit + 逐文件 SHA256 校验（与 fetch-ecdict.mjs 同口径）。
 *
 * 用法：node scripts/presets/fetch-ipa-dict.mjs
 * 输出：scripts/presets/.data/ipa-dict/{en_US,en_UK}.txt（git 忽略）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 固定来源：open-dict-data/ipa-dict @ 43c3570（en_US/en_UK 为静态数据，长期不变） */
const IPADICT_COMMIT = "43c3570eb3553bdd19fccd2bd0091534889af023";
const FILES = [
  { name: "en_US.txt", sha256: "2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67" },
  { name: "en_UK.txt", sha256: "221394caef0cf723b4f2df81a98ac33191293257b88aed5b1fb89466d3a0dc77" },
];
const OUT_DIR = path.join(ROOT, "scripts", "presets", ".data", "ipa-dict");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { name, sha256: expected } of FILES) {
    const outFile = path.join(OUT_DIR, name);
    if (existsSync(outFile) && sha256(readFileSync(outFile)) === expected) {
      console.log(`已存在且校验通过：${name}`);
      continue;
    }
    const url = `https://raw.githubusercontent.com/open-dict-data/ipa-dict/${IPADICT_COMMIT}/data/${name}`;
    console.log(`下载 ${url} …`);
    const res = await fetch(url, { headers: { "user-agent": "lexilexi-preset-pipeline" } });
    if (!res.ok) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = sha256(buf);
    if (actual !== expected) {
      throw new Error(`SHA256 校验失败：期望 ${expected}，实际 ${actual}`);
    }
    await writeFile(outFile, buf);
    console.log(`已写入 ${outFile}（${(buf.length / 1024).toFixed(0)} KB，SHA256 校验通过）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
