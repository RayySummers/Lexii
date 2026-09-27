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
 *
 * 可测试性（RAY-494）：清单拼装抽成纯函数 `createManifest(...)`（返回 manifest
 * 对象与待写文件，不落盘），CLI 入口只负责读写文件；`build-manifest.test.mjs`
 * 直接断言「两个词包版本号都带 `-alpha`、文件名随之」。
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assertAlphaPackageVersion } from "./lib/versions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_DIR = path.join(ROOT, "scripts", "presets", "output");
const PRESETS_DIR = path.join(OUTPUT_DIR, "presets");
const MANIFEST_FILE = "manifest.json";

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
 * 按编码压缩包内容。返回 { ext, buf }；raw 直接用原始字节。
 *
 * sha256 对**解压后原始 JSON** 计算（三编码同值），与运行时
 * `downloadAndVerifyPackage` 及设计 §5.4 口径一致；
 * size 保持传输体积（压缩后字节数）。
 */
function encodeVariant(inputBuf, encoding) {
  if (encoding === "brotli") {
    return {
      ext: ".json.br",
      buf: brotliCompressSync(inputBuf, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      }),
    };
  }
  if (encoding === "gzip") {
    return { ext: ".json.gz", buf: gzipSync(inputBuf, { level: 9 }) };
  }
  return { ext: ".json", buf: inputBuf };
}

/**
 * 生成三种编码的 variant 条目与待写文件。
 * 返回 { variants, files }：variants 进 manifest，files 由 CLI 落盘。
 */
function makeVariants(inputBuf, baseName, baseUrl) {
  const variants = {};
  const files = [];
  for (const encoding of ["brotli", "gzip", "raw"]) {
    const { ext, buf } = encodeVariant(inputBuf, encoding);
    const fileName = `${baseName}${ext}`;
    files.push({ fileName, buf });
    variants[encoding] = {
      url: baseUrl + fileName,
      size: buf.length,
      // 解压后原始 JSON 的 SHA-256（三编码同值，与 §5.4 口径一致）
      sha256: sha256(inputBuf),
    };
  }
  return { variants, files };
}

/**
 * 拼装 manifest（纯函数，不落盘）。
 *
 * @param {object} input
 * @param {Buffer} input.tier1Json       build.mjs --tier 1 产物字节
 * @param {Buffer} input.tier2Json       build.mjs --tier 2 产物字节
 * @param {Buffer|null} input.enrichmentJson  build-enrichment.mjs 产物字节（可选）
 * @param {string} input.baseUrl         包文件公共基础 URL（已归一尾斜杠）
 * @param {string} input.buildCommit     仓库构建 commit
 * @param {string} [input.ecdictSourceCommit]  数据来源固定 commit
 * @param {string} [input.generatedAt]   manifest.generatedAt
 * @returns {{ manifest: object, files: {fileName: string, buf: Buffer}[], stats: object }}
 */
export function createManifest({
  tier1Json,
  tier2Json,
  enrichmentJson = null,
  baseUrl,
  buildCommit,
  ecdictSourceCommit = ECDICT_SOURCE_COMMIT,
  generatedAt = new Date().toISOString(),
}) {
  // 解析版本号
  const tier1Data = JSON.parse(tier1Json.toString("utf-8"));
  const tier2Data = JSON.parse(tier2Json.toString("utf-8"));
  const tier1Version = tier1Data.version || "1.0.0";
  const tier2Version = tier2Data.version || "1.0.0";

  // RAY-494 发版口径 fail-fast：词包版本号必须带 -alpha（见 lib/versions.mjs）。
  // 缺标识时直接构建失败，避免再发一版「应用带 alpha、词包版本号没带」的词包。
  assertAlphaPackageVersion(tier1Version, "core-en-tier1");
  assertAlphaPackageVersion(tier2Version, "core-en-tier2");

  // 内容哈希前 8 位（用于 URL 版本化）
  const tier1Hash = sha256(tier1Json).slice(0, 8);
  const tier2Hash = sha256(tier2Json).slice(0, 8);

  const files = [];

  // 构建 Tier 1 三种 variant
  const tier1Base = `core-en-tier1-v${tier1Version}-${tier1Hash}`;
  const tier1 = makeVariants(tier1Json, tier1Base, baseUrl);
  files.push(...tier1.files);

  // 构建 Tier 2 三种 variant
  const tier2Base = `core-en-tier2-v${tier2Version}-${tier2Hash}`;
  const tier2 = makeVariants(tier2Json, tier2Base, baseUrl);
  files.push(...tier2.files);

  // 富化包（可选）：沿用自身版本线（build-enrichment.mjs 的 ENRICHMENT_VERSION），
  // 不在 RAY-494 的「词包版本号带 -alpha」口径内
  let enrichmentEntry = null;
  let enrichmentStats = null;
  if (enrichmentJson) {
    const enrichmentData = JSON.parse(enrichmentJson.toString("utf-8"));
    const enrichmentVersion = enrichmentData.version || "1.0.0";
    const enrichmentHash = sha256(enrichmentJson).slice(0, 8);
    const enrichmentBase = `enrichment-tier1-v${enrichmentVersion}-${enrichmentHash}`;
    const enrichment = makeVariants(enrichmentJson, enrichmentBase, baseUrl);
    files.push(...enrichment.files);

    enrichmentEntry = {
      id: "core-en-tier1-enrichment",
      version: enrichmentVersion,
      variants: enrichment.variants,
    };
    enrichmentStats = { version: enrichmentVersion, brotli: enrichment.variants.brotli.size };
  }

  // 构建 manifest
  const manifest = {
    packages: [
      {
        id: "core-en-tier1",
        version: tier1Version,
        variants: tier1.variants,
        // sourceCommit = ECDICT 固定数据 commit（§5.1 口径）
        sourceCommit: ecdictSourceCommit,
        // buildCommit = 仓库构建 commit（可追溯性附加字段）
        buildCommit,
        ...(enrichmentEntry ? { enrichment: enrichmentEntry } : {}),
      },
      {
        id: "core-en-tier2",
        version: tier2Version,
        variants: tier2.variants,
        sourceCommit: ecdictSourceCommit,
        buildCommit,
      },
    ],
    generatedAt,
  };

  return {
    manifest,
    files,
    stats: {
      tier1: {
        version: tier1Version,
        entries: tier1Data.entries?.length ?? null,
        sizes: sizesOf(tier1.variants),
      },
      tier2: {
        version: tier2Version,
        entries: tier2Data.entries?.length ?? null,
        sizes: sizesOf(tier2.variants),
      },
      enrichment: enrichmentStats,
    },
  };
}

/** 三种编码的传输体积（KB 由调用方格式化） */
function sizesOf(variants) {
  return {
    brotli: variants.brotli.size,
    gzip: variants.gzip.size,
    raw: variants.raw.size,
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

  const { manifest, files, stats } = createManifest({
    tier1Json: readFileSync(tier1Path),
    tier2Json: readFileSync(tier2Path),
    enrichmentJson: existsSync(enrichmentTier1Path) ? readFileSync(enrichmentTier1Path) : null,
    baseUrl,
    buildCommit,
  });

  // 落盘：各编码包文件 + manifest.json
  mkdirSync(PRESETS_DIR, { recursive: true });
  for (const file of files) {
    writeFileSync(path.join(PRESETS_DIR, file.fileName), file.buf);
  }
  const manifestPath = path.join(PRESETS_DIR, MANIFEST_FILE);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  // 输出摘要
  const kb = (bytes) => (bytes / 1024).toFixed(0);
  console.log("manifest 构建完成：");
  console.log(
    `  Tier 1：v${stats.tier1.version} | ${stats.tier1.entries ?? "?"} 词 | brotli ${kb(stats.tier1.sizes.brotli)} KB | gzip ${kb(stats.tier1.sizes.gzip)} KB | raw ${kb(stats.tier1.sizes.raw)} KB`,
  );
  console.log(
    `  Tier 2：v${stats.tier2.version} | ${stats.tier2.entries ?? "?"} 词 | brotli ${kb(stats.tier2.sizes.brotli)} KB | gzip ${kb(stats.tier2.sizes.gzip)} KB | raw ${kb(stats.tier2.sizes.raw)} KB`,
  );
  if (stats.enrichment) {
    console.log(
      `  Tier 1 富化包：v${stats.enrichment.version} | brotli ${stats.enrichment.brotli / 1024} KB`,
    );
  }
  console.log(`  数据 commit（sourceCommit）：${ECDICT_SOURCE_COMMIT}`);
  console.log(`  构建 commit（buildCommit）：${buildCommit}`);
  console.log(`  manifest：${manifestPath}`);
}

// 仅 CLI 直跑时执行（被 import 时只暴露 createManifest 供测试使用）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
