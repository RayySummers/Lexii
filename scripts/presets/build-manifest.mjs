/**
 * RAY-294 Phase 3：构建 manifest.json（扩展词包发布清单）。
 *
 * 读取 build.mjs / build-enrichment.mjs 产出的 tier1.json / tier2.json /
 * enrichment.tier1.json → 逐个 brotli / gzip 压缩 + SHA-256 校验 →
 * 生成 manifest.json（含版本/SHA256/体积/源 commit / enrichment 子字段）。
 *
 * 产物目录：scripts/presets/output/presets/（manifest.json + 各 variant 包文件）
 *
 * 用法：node scripts/presets/build-manifest.mjs [--base-url <url>]
 *   --base-url：包文件的公共基础 URL（默认 "./presets/"，兼容 Pages 子路径部署）
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_DIR = path.join(ROOT, "scripts", "presets", "output");
const PRESETS_DIR = path.join(OUTPUT_DIR, "presets");

/**
 * 获取当前构建 commit（仓库 HEAD，CI 环境从 GITHUB_SHA 读取）。
 * 用于 manifest.buildCommit 字段（构建可追溯性）。
 */
function getBuildCommit() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * ECDICT 固定数据 commit（与 fetch-ecdict.mjs 一致）。
 * manifest.sourceCommit 语义 = 数据来源固定 commit（非仓库 commit）。
 */
const ECDICT_SOURCE_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * 压缩并写入文件，返回 { fileName, size, sha256 }。
 *
 * sha256 对**解压后原始 JSON** 计算（三编码同值），与运行时
 * `downloadAndVerifyPackage` 及设计 §5.4 口径一致。
 * size 保持传输体积（压缩后字节数）。
 */
function compressAndWrite(inputBuf, baseName, encoding, presetsDir) {
  let compressed;
  let ext;
  if (encoding === "brotli") {
    compressed = brotliCompressSync(inputBuf, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    });
    ext = ".json.br";
  } else if (encoding === "gzip") {
    compressed = gzipSync(inputBuf, { level: 9 });
    ext = ".json.gz";
  } else {
    // raw
    compressed = inputBuf;
    ext = ".json";
  }
  const fileName = `${baseName}${ext}`;
  const filePath = path.join(presetsDir, fileName);
  writeFileSync(filePath, compressed);
  return {
    fileName,
    size: compressed.length,
    // 解压后原始 JSON 的 SHA-256（三编码同值，与 §5.4 口径一致）
    sha256: sha256(inputBuf),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const baseUrlIdx = argv.indexOf("--base-url");
  const rawBaseUrl = baseUrlIdx >= 0 ? argv[baseUrlIdx + 1] : "./presets/";
  // 确保尾斜杠归一（避免 URL 拼接断裂）
  const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`;

  const buildCommit = getBuildCommit();

  // 读取 Tier 1 / Tier 2 原始 JSON
  const tier1Path = path.join(OUTPUT_DIR, "tier1.json");
  const tier2Path = path.join(OUTPUT_DIR, "tier2.json");
  const enrichmentTier1Path = path.join(OUTPUT_DIR, "enrichment.tier1.json");

  if (!existsSync(tier1Path) || !existsSync(tier2Path)) {
    console.error("错误：tier1.json 或 tier2.json 不存在，请先运行 build.mjs --tier 1/2");
    process.exitCode = 1;
    return;
  }

  const tier1Json = readFileSync(tier1Path);
  const tier2Json = readFileSync(tier2Path);

  // 解析版本号
  const tier1Data = JSON.parse(tier1Json.toString("utf-8"));
  const tier2Data = JSON.parse(tier2Json.toString("utf-8"));
  const tier1Version = tier1Data.version || "1.0.0";
  const tier2Version = tier2Data.version || "1.0.0";

  // 内容哈希前 8 位（用于 URL 版本化）
  const tier1Hash = sha256(tier1Json).slice(0, 8);
  const tier2Hash = sha256(tier2Json).slice(0, 8);

  mkdirSync(PRESETS_DIR, { recursive: true });

  // 构建 Tier 1 三种 variant
  const tier1Base = `core-en-tier1-v${tier1Version}-${tier1Hash}`;
  const tier1Brotli = compressAndWrite(tier1Json, tier1Base, "brotli", PRESETS_DIR);
  const tier1Gzip = compressAndWrite(tier1Json, tier1Base, "gzip", PRESETS_DIR);
  const tier1Raw = compressAndWrite(tier1Json, tier1Base, "raw", PRESETS_DIR);

  // 构建 Tier 2 三种 variant
  const tier2Base = `core-en-tier2-v${tier2Version}-${tier2Hash}`;
  const tier2Brotli = compressAndWrite(tier2Json, tier2Base, "brotli", PRESETS_DIR);
  const tier2Gzip = compressAndWrite(tier2Json, tier2Base, "gzip", PRESETS_DIR);
  const tier2Raw = compressAndWrite(tier2Json, tier2Base, "raw", PRESETS_DIR);

  // 富化包（可选）
  let enrichmentEntry = null;
  if (existsSync(enrichmentTier1Path)) {
    const enrichmentJson = readFileSync(enrichmentTier1Path);
    const enrichmentData = JSON.parse(enrichmentJson.toString("utf-8"));
    const enrichmentVersion = enrichmentData.version || "1.0.0";
    const enrichmentHash = sha256(enrichmentJson).slice(0, 8);
    const enrichmentBase = `enrichment-tier1-v${enrichmentVersion}-${enrichmentHash}`;
    const enrichmentBrotli = compressAndWrite(
      enrichmentJson,
      enrichmentBase,
      "brotli",
      PRESETS_DIR,
    );
    const enrichmentGzip = compressAndWrite(enrichmentJson, enrichmentBase, "gzip", PRESETS_DIR);
    const enrichmentRaw = compressAndWrite(enrichmentJson, enrichmentBase, "raw", PRESETS_DIR);

    enrichmentEntry = {
      id: "core-en-tier1-enrichment",
      version: enrichmentVersion,
      variants: {
        brotli: {
          url: baseUrl + enrichmentBrotli.fileName,
          size: enrichmentBrotli.size,
          sha256: enrichmentBrotli.sha256,
        },
        gzip: {
          url: baseUrl + enrichmentGzip.fileName,
          size: enrichmentGzip.size,
          sha256: enrichmentGzip.sha256,
        },
        raw: {
          url: baseUrl + enrichmentRaw.fileName,
          size: enrichmentRaw.size,
          sha256: enrichmentRaw.sha256,
        },
      },
    };
  }

  // 构建 manifest
  const manifest = {
    packages: [
      {
        id: "core-en-tier1",
        version: tier1Version,
        variants: {
          brotli: {
            url: baseUrl + tier1Brotli.fileName,
            size: tier1Brotli.size,
            sha256: tier1Brotli.sha256,
          },
          gzip: {
            url: baseUrl + tier1Gzip.fileName,
            size: tier1Gzip.size,
            sha256: tier1Gzip.sha256,
          },
          raw: { url: baseUrl + tier1Raw.fileName, size: tier1Raw.size, sha256: tier1Raw.sha256 },
        },
        // sourceCommit = ECDICT 固定数据 commit（§5.1 口径）
        sourceCommit: ECDICT_SOURCE_COMMIT,
        // buildCommit = 仓库构建 commit（可追溯性附加字段）
        buildCommit,
        ...(enrichmentEntry ? { enrichment: enrichmentEntry } : {}),
      },
      {
        id: "core-en-tier2",
        version: tier2Version,
        variants: {
          brotli: {
            url: baseUrl + tier2Brotli.fileName,
            size: tier2Brotli.size,
            sha256: tier2Brotli.sha256,
          },
          gzip: {
            url: baseUrl + tier2Gzip.fileName,
            size: tier2Gzip.size,
            sha256: tier2Gzip.sha256,
          },
          raw: { url: baseUrl + tier2Raw.fileName, size: tier2Raw.size, sha256: tier2Raw.sha256 },
        },
        sourceCommit: ECDICT_SOURCE_COMMIT,
        buildCommit,
      },
    ],
    generatedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(PRESETS_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  // 输出摘要
  console.log("manifest 构建完成：");
  console.log(
    `  Tier 1：${tier1Data.entries?.length ?? "?"} 词 | brotli ${(tier1Brotli.size / 1024).toFixed(0)} KB | gzip ${(tier1Gzip.size / 1024).toFixed(0)} KB | raw ${(tier1Raw.size / 1024).toFixed(0)} KB`,
  );
  console.log(
    `  Tier 2：${tier2Data.entries?.length ?? "?"} 词 | brotli ${(tier2Brotli.size / 1024).toFixed(0)} KB | gzip ${(tier2Gzip.size / 1024).toFixed(0)} KB | raw ${(tier2Raw.size / 1024).toFixed(0)} KB`,
  );
  if (enrichmentEntry) {
    console.log(`  Tier 1 富化包：brotli ${enrichmentEntry.variants.brotli.size / 1024} KB`);
  }
  console.log(`  数据 commit（sourceCommit）：${ECDICT_SOURCE_COMMIT}`);
  console.log(`  构建 commit（buildCommit）：${buildCommit}`);
  console.log(`  manifest：${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
