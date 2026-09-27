/**
 * RAY-494：扩展词包 manifest 版本号口径回归（`node --test`，零依赖）。
 *
 * 覆盖：
 * - 发版护栏：词包版本号必须带 `-alpha`（`1.0.0` / `1.0.0-beta` 直接 fail-fast）；
 * - 构建产物断言：`createManifest` 生成的 manifest 里 `core-en-tier1` 与
 *   `core-en-tier2` 的 version 就是 build.mjs 用的真实常量，且都带 `-alpha`；
 * - 文件名随之：`core-en-tier2-v1.1.0-alpha-<8 位内容哈希>.json[.br|.gz]`，
 *   三种编码的 url 都带 `-alpha` 与同一内容哈希；
 * - 完整性字段：raw 字节数 = 产物字节数，sha256 = 解压后原始 JSON 的哈希（三编码同值）。
 *
 * 运行：`pnpm test:presets`（根脚本，已挂在 `pnpm test` 里，CI 一起跑）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { createManifest } from "./build-manifest.mjs";
import {
  PACKAGE_VERSION,
  TIER2_PACKAGE_VERSION,
  assertAlphaPackageVersion,
} from "./lib/versions.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** 造一份最小 tier JSON 产物（结构同 build.mjs 输出：id/version/entries 元组数组） */
function tierJson(id, version) {
  return Buffer.from(
    JSON.stringify({
      id,
      version,
      name: id,
      generatedAt: "2026-09-27T00:00:00.000Z",
      source: "test fixture",
      entries: [["alpha", "n. 阿尔法", "n.", "ˈælfə", "高频", "n."]],
    }),
  );
}

function buildFixture({
  tier1Version = PACKAGE_VERSION,
  tier2Version = TIER2_PACKAGE_VERSION,
} = {}) {
  const tier1Json = tierJson("core-en-tier1", tier1Version);
  const tier2Json = tierJson("core-en-tier2", tier2Version);
  const result = createManifest({
    tier1Json,
    tier2Json,
    baseUrl: "./presets/",
    buildCommit: "testcommit",
    generatedAt: "2026-09-27T00:00:00.000Z",
  });
  return { ...result, tier1Json, tier2Json };
}

test("真实词包版本常量带 -alpha（Tier 0/1 = 1.0.0-alpha、Tier 2 = 1.1.0-alpha）", () => {
  assert.equal(PACKAGE_VERSION, "1.0.0-alpha");
  assert.equal(TIER2_PACKAGE_VERSION, "1.1.0-alpha");
  assertAlphaPackageVersion(PACKAGE_VERSION, "core-en-tier1");
  assertAlphaPackageVersion(TIER2_PACKAGE_VERSION, "core-en-tier2");
});

test("发版护栏：不带 -alpha 的版本号 fail-fast", () => {
  // 合法形态
  for (const ok of [
    "1.0.0-alpha",
    "1.1.0-alpha",
    "1.1.0-alpha.1",
    "1.1.0-alpha-1",
    "1.1.0-alpha+build.7",
  ]) {
    assert.equal(assertAlphaPackageVersion(ok, "core-en-tier2"), ok);
  }
  // 非法形态：无预发布 / 别的预发布线 / 非 semver
  for (const bad of [
    "1.0.0",
    "1.1.0",
    "1.1.0-beta",
    "1.1.0-alpha1beta",
    "v1.1.0-alpha",
    "",
    undefined,
  ]) {
    assert.throws(
      () => assertAlphaPackageVersion(bad, "core-en-tier2"),
      /缺少 -alpha 标识/,
      `应拒绝：${String(bad)}`,
    );
  }
});

test("构建产物：manifest 里两个词包版本号都带 -alpha", () => {
  const { manifest, stats } = buildFixture();
  assert.deepEqual(
    manifest.packages.map((pkg) => pkg.id),
    ["core-en-tier1", "core-en-tier2"],
  );
  for (const pkg of manifest.packages) {
    assert.match(pkg.version, /-alpha$/, `${pkg.id} 的版本号必须带 -alpha`);
  }
  assert.equal(manifest.packages[0].version, PACKAGE_VERSION);
  assert.equal(manifest.packages[1].version, TIER2_PACKAGE_VERSION);
  // 摘要里也带着（发版核对用）
  assert.equal(stats.tier1.version, PACKAGE_VERSION);
  assert.equal(stats.tier2.version, TIER2_PACKAGE_VERSION);
});

test("构建产物：包文件名随版本号带 -alpha，且带 8 位内容哈希", () => {
  const { manifest, files, tier1Json, tier2Json } = buildFixture();
  const [tier1, tier2] = manifest.packages;

  const hash1 = sha256(tier1Json).slice(0, 8);
  const hash2 = sha256(tier2Json).slice(0, 8);

  assert.equal(Object.keys(tier1.variants).join(","), "brotli,gzip,raw");
  assert.equal(tier1.variants.brotli.url, `./presets/core-en-tier1-v1.0.0-alpha-${hash1}.json.br`);
  assert.equal(tier1.variants.gzip.url, `./presets/core-en-tier1-v1.0.0-alpha-${hash1}.json.gz`);
  assert.equal(tier1.variants.raw.url, `./presets/core-en-tier1-v1.0.0-alpha-${hash1}.json`);
  assert.equal(tier2.variants.brotli.url, `./presets/core-en-tier2-v1.1.0-alpha-${hash2}.json.br`);
  assert.equal(tier2.variants.gzip.url, `./presets/core-en-tier2-v1.1.0-alpha-${hash2}.json.gz`);
  assert.equal(tier2.variants.raw.url, `./presets/core-en-tier2-v1.1.0-alpha-${hash2}.json`);

  // 每个词包都产出三种编码文件，文件名与 manifest url 一一对应
  const names = files.map((f) => f.fileName);
  assert.equal(names.length, 6);
  for (const pkg of manifest.packages) {
    for (const variant of Object.values(pkg.variants)) {
      assert.ok(names.includes(variant.url.replace("./presets/", "")), `缺文件：${variant.url}`);
    }
  }
});

test("构建产物：variant 体积与 sha256 口径（sha256 = 解压后原始 JSON）", () => {
  const { manifest, files, tier1Json } = buildFixture();
  const tier1 = manifest.packages[0];
  const byName = new Map(files.map((f) => [f.fileName, f.buf]));

  const raw = byName.get(`core-en-tier1-v1.0.0-alpha-${sha256(tier1Json).slice(0, 8)}.json`);
  const br = byName.get(`core-en-tier1-v1.0.0-alpha-${sha256(tier1Json).slice(0, 8)}.json.br`);
  const gz = byName.get(`core-en-tier1-v1.0.0-alpha-${sha256(tier1Json).slice(0, 8)}.json.gz`);
  assert.deepEqual(raw, tier1Json);
  assert.deepEqual(brotliDecompressSync(br), tier1Json);
  assert.deepEqual(gunzipSync(gz), tier1Json);

  assert.equal(tier1.variants.raw.size, tier1Json.length);
  assert.equal(tier1.variants.brotli.size, br.length);
  assert.equal(tier1.variants.gzip.size, gz.length);
  // 三编码同值：sha256 对解压后原始 JSON 计算
  const expected = sha256(tier1Json);
  assert.equal(tier1.variants.raw.sha256, expected);
  assert.equal(tier1.variants.brotli.sha256, expected);
  assert.equal(tier1.variants.gzip.sha256, expected);
});

test("构建产物：Version bump 后文件名随之变化（内容哈希 + 版本号都在名字里）", () => {
  const before = buildFixture({ tier1Version: "1.0.0-alpha" });
  const after = buildFixture({ tier1Version: "1.1.1-alpha" });
  assert.notEqual(
    before.manifest.packages[0].variants.raw.url,
    after.manifest.packages[0].variants.raw.url,
  );
});

test("构建产物：版本号带 alpha 缺失时 createManifest 直接抛错（发版护栏接入链路）", () => {
  assert.throws(() => buildFixture({ tier1Version: "1.0.0" }), /缺少 -alpha 标识/);
  assert.throws(() => buildFixture({ tier2Version: "1.1.0" }), /缺少 -alpha 标识/);
});
