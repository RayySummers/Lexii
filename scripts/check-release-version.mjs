#!/usr/bin/env node
/**
 * RAY-368 — 发版一致性自检：tag 名 vs apps/web/package.json 的 version 必须一致。
 *
 * 根因：v0.9.1-alpha tag 推送时未同步 bump apps/web/package.json，导致
 * 线上设置页仍显示 0.9.0-alpha（RAY-368）。此前 RAY-332 已踩过同坑
 * (0.8.2 → 0.9.0)，RAY-348 验收口径未覆盖此检查，遂加入自动化 guardrail。
 *
 * 规则：
 * - 唯一真相源：apps/web/package.json 的 version 字段
 * - tag 格式：v<version>，如 v0.9.1-alpha（与 package.json version 的 `v` 前缀拼接完全一致）
 * - 本脚本可在本地、CI、部署前三处调用；任一处失败即阻断发布
 *
 * 用法：
 *   node scripts/check-release-version.mjs              # 检查当前 git tag 与 package.json 是否一致
 *   node scripts/check-release-version.mjs --tag v0.9.1-alpha   # 指定 tag 校验
 *   node scripts/check-release-version.mjs --version 0.9.1-alpha # 指定 version 校验（与 tag 互斥时 version 优先）
 *   node scripts/check-release-version.mjs --tag v0.9.1-alpha --version 0.9.1-alpha
 *
 * 退出码：
 *   0 — 一致（或无 tag 时跳过，仅告警）
 *   1 — 不一致
 *   2 — 用法/文件错误
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const webPackageJsonPath = resolve(repoRoot, "apps/web/package.json");

function parseArgs(argv) {
  const out = { tag: null, version: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag" && i + 1 < argv.length) out.tag = argv[++i];
    else if (a === "--version" && i + 1 < argv.length) out.version = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "用法: node scripts/check-release-version.mjs [--tag <tag>] [--version <version>]",
          "  --tag      指定 tag（如 v0.9.1-alpha），默认自动探测当前 HEAD 的 tag",
          "  --version  指定 version（如 0.9.1-alpha），默认读取 apps/web/package.json",
          "  --help     显示此帮助",
        ].join("\n"),
      );
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function readPackageVersion() {
  try {
    const raw = readFileSync(webPackageJsonPath, "utf-8");
    const json = JSON.parse(raw);
    if (typeof json.version !== "string" || json.version.trim() === "") {
      console.error(
        `[release-check] apps/web/package.json 缺少合法的 version 字段: ${webPackageJsonPath}`,
      );
      process.exit(2);
    }
    return json.version.trim();
  } catch (e) {
    console.error(`[release-check] 读取 ${webPackageJsonPath} 失败: ${e.message}`);
    process.exit(2);
  }
}

function resolveTag(explicitTag) {
  if (explicitTag) return explicitTag.trim();

  // 优先用环境变量（CI 里 GITHUB_REF_NAME / BUILD_BRANCH 可能是 tag）
  const envTag = process.env.GITHUB_REF_NAME ?? process.env.BUILD_BRANCH ?? "";
  if (envTag.startsWith("v")) return envTag.trim();

  // 本地：尝试 git describe 精确匹配当前 HEAD 的 tag
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (tag) return tag;
  } catch {
    // HEAD 不在 tag 上，属正常（开发分支），回退为探测最新 v* tag 仅作提示
  }

  // 无显式 tag 且 HEAD 不在 tag 上：跳过强校验（本地开发常态），仅提示
  return null;
}

function main() {
  const { tag: explicitTag, version: explicitVersion } = parseArgs(process.argv.slice(2));
  const pkgVersion = explicitVersion?.trim() ?? readPackageVersion();
  const tag = resolveTag(explicitTag);

  const expectedTag = `v${pkgVersion}`;

  if (!tag) {
    console.log(
      `[release-check] 跳过强校验：当前 HEAD 不在 tag 上（package.json version: ${pkgVersion}，期望 tag: ${expectedTag}）`,
    );
    console.log(
      `[release-check] 提示：发版时请确保 tag 名与 apps/web/package.json 的 version 完全一致（v 前缀拼接），如 ${expectedTag}`,
    );
    process.exit(0);
  }

  // 仅校验 v* 语义化 tag，presets-v* 等词包 tag 跳过
  if (!tag.startsWith("v")) {
    console.log(`[release-check] 跳过：当前 tag ${tag} 非发版 tag（仅校验 v*）`);
    process.exit(0);
  }

  // 严格一致性：tag 必须等于 v + version
  if (tag !== expectedTag) {
    console.error(
      `[release-check] ❌ 不一致：tag ${tag} ≠ 期望 ${expectedTag}（来自 apps/web/package.json version: ${pkgVersion}）`,
    );
    console.error(
      `[release-check] 修复：bump apps/web/package.json 的 version 至 ${tag.slice(1)}，或重打 tag 为 ${expectedTag}`,
    );
    console.error(
      `[release-check] 参考：CONTRIBUTING.md「发版流程」第 2/4 步；先例 RAY-332 / RAY-368`,
    );
    process.exit(1);
  }

  console.log(`[release-check] ✅ 一致：tag ${tag} === v + package.json version (${pkgVersion})`);
  process.exit(0);
}

main();
