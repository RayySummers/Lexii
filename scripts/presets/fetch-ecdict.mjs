/**
 * 下载 ECDICT 全量 CSV 并校验 SHA256（来源固定到 commit，保证可复现）。
 *
 * 用法：node scripts/presets/fetch-ecdict.mjs
 * 输出：scripts/presets/.data/ecdict/ecdict.csv（git 忽略）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 固定来源：ECDICT master @ bc015ed（2025-03-28） */
const ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";
const ECDICT_URL = `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}/ecdict.csv`;
const EXPECTED_SHA256 = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf";
const OUT_DIR = path.join(ROOT, "scripts", "presets", ".data", "ecdict");
const OUT_FILE = path.join(OUT_DIR, "ecdict.csv");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(OUT_FILE)) {
    const existing = sha256(readFileSync(OUT_FILE));
    if (existing === EXPECTED_SHA256) {
      console.log(`已存在且校验通过：${OUT_FILE}`);
      return;
    }
    console.log(`已存在但 SHA256 不符（${existing}），重新下载…`);
  }
  console.log(`下载 ${ECDICT_URL} …`);
  const res = await fetch(ECDICT_URL, {
    headers: { "user-agent": "lexii-preset-pipeline" },
  });
  if (!res.ok) {
    throw new Error(`下载失败：HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== EXPECTED_SHA256) {
    throw new Error(`SHA256 校验失败：期望 ${EXPECTED_SHA256}，实际 ${actual}`);
  }
  await writeFile(OUT_FILE, buf);
  console.log(`已写入 ${OUT_FILE}（${(buf.length / 1024 / 1024).toFixed(1)} MB，SHA256 校验通过）`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
