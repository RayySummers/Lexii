/**
 * 下载 OpenEtymology 五个考试词本 EPUB（词根/词缀拆解 + 中文词源与释义）。
 *
 * 许可：代码 Apache-2.0（LICENSE），单词本数据 CC BY-SA 4.0（DATA_LICENSE.md，
 * RAY-267 已核对原文）。五册 TXT 为纯词表，词根词缀结构化内容在 EPUB 内
 * （打包管线解析 EPUB 的 XHTML 章节）。来源固定到 commit + 逐文件 SHA256。
 *
 * 用法：node scripts/presets/fetch-openetymology.mjs
 * 输出：scripts/presets/.data/openetymology/{CET4,CET6,TEM8,TOEFL,GRE8000}.epub
 *       + DATA_LICENSE.md / LICENSE（许可出处随缓存保留，git 忽略）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 固定来源：openetymology/OpenEtymology @ 7d89f36（2026-08-15 抓取时的 main HEAD） */
const OE_COMMIT = "7d89f3697abf26e305fe2627f181b692c2c10b28";
const FILES = [
  {
    rel: "CET4/CET4.epub",
    sha256: "878f104ef6e7ae1779cea3a3d4ff6f4db84c17841fba7ec375c359df89b7a1c7",
  },
  {
    rel: "CET6/CET6.epub",
    sha256: "f3cee386eb02e9a75004147deec358f4fff91058bb85c168f00e9db85ef7b55a",
  },
  {
    rel: "TEM8/TEM8.epub",
    sha256: "0db749f72a59853712dcbd7b5120c3ae8ee465658fe0262e3ce569793c387c3e",
  },
  {
    rel: "TOEFL/TOEFL.epub",
    sha256: "822b460b121f0088e19f3d546b2819485127069388ec15b64389f1a14c8d6015",
  },
  {
    rel: "GRE8000/GRE8000.epub",
    sha256: "e0563269bf0802b65e2265471bdac1ce23cd19d69e3819f1bbe860c2949b7201",
  },
  { rel: "DATA_LICENSE.md", sha256: null },
  { rel: "LICENSE", sha256: null },
];
const OUT_DIR = path.join(ROOT, "scripts", "presets", ".data", "openetymology");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { rel, sha256: expected } of FILES) {
    const outFile = path.join(OUT_DIR, path.basename(rel));
    const alreadyOk =
      expected !== null && existsSync(outFile) && sha256(readFileSync(outFile)) === expected;
    if (alreadyOk) {
      console.log(`已存在且校验通过：${path.basename(rel)}`);
      continue;
    }
    const url = `https://raw.githubusercontent.com/openetymology/OpenEtymology/${OE_COMMIT}/${rel}`;
    console.log(`下载 ${url} …`);
    const res = await fetch(url, { headers: { "user-agent": "lexii-preset-pipeline" } });
    if (!res.ok) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (expected !== null) {
      const actual = sha256(buf);
      if (actual !== expected) {
        throw new Error(`SHA256 校验失败：期望 ${expected}，实际 ${actual}`);
      }
    }
    await writeFile(outFile, buf);
    console.log(
      `已写入 ${outFile}（${(buf.length / 1024).toFixed(0)} KB${expected !== null ? "，SHA256 校验通过" : ""}）`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
