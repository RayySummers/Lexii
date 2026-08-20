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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const webPackageJsonPath = resolve(repoRoot, "apps/web/package.json");

function parseArgs(argv) {
  const out = { tag: null, version: null, skipHardcoded: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag" && i + 1 < argv.length) out.tag = argv[++i];
    else if (a === "--version" && i + 1 < argv.length) out.version = argv[++i];
    else if (a === "--skip-hardcoded-check") out.skipHardcoded = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "用法: node scripts/check-release-version.mjs [--tag <tag>] [--version <version>] [--skip-hardcoded-check]",
          "  --tag                    指定 tag（如 v0.9.1-alpha），默认自动探测当前 HEAD 的 tag",
          "  --version                指定 version（如 0.9.1-alpha），默认读取 apps/web/package.json",
          "  --skip-hardcoded-check   跳过硬编码版本扫描（仅保留 tag vs package.json 一致性）",
          "  --help                   显示此帮助",
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

/**
 * RAY-368 追加护栏：apps/web/src 内不应出现硬编码版本字面量。
 * 根因：DeveloperPanel 会镜像 releaseTags 文本，测试用单数 getByText 查询
 * 在 bump 后因两处同文本（分支字段 + 版本回退外链）炸裂。
 * 本检查防止未来在源码中写死 "0.9.1-alpha" / "0.9." 等字面量，
 * 迫使所有版本展示走 __APP_VERSION__ / __APP_BUILD__ 注入。
 *
 * 扫描规则：
 * - 根：apps/web/src，仅 .ts/.tsx
 * - 跳过：*.test.*（fixture 允许）、注释行（//、块注释、* 前缀）、docs 注释示例
 * - 命中：当前 pkgVersion 字面量（如 0.9.1-alpha）或通用 alpha 版本形态（\\d+\\.\\d+\\.\\d+-alpha）
 *   出现在代码文本中
 */
function checkNoHardcodedVersion(pkgVersion) {
  const srcRoot = resolve(repoRoot, "apps/web/src");
  if (!existsSync(srcRoot)) return;
  // 当前版本与通用 alpha 版本正则（覆盖未来 0.9.2 / 0.10.0 等）
  const escapedVersion = pkgVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const currentVersionRE = new RegExp(`\\b${escapedVersion}\\b`);
  const genericAlphaRE = /\b\d+\.\d+\.\d+-alpha\b/;

  /** 递归收集 .ts/.tsx 文件 */
  function collect(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...collect(full));
      else if (st.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) out.push(full);
    }
    return out;
  }

  const files = collect(srcRoot);
  const violations = [];

  for (const file of files) {
    // 测试文件、story、fixture 允许出现版本号（示例数据）
    if (/\.test\.(ts|tsx)$/.test(file) || /\.stories\.(ts|tsx)$/.test(file)) continue;
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined) continue;
      const trimmed = raw.trim();
      // 跳过纯注释行与文档注释示例（如 v0.1.0-alpha.6 在 buildInfo 注释中）
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("*/")
      )
        continue;
      // 行内注释前的代码部分才参与检查；若整行被注释语义包裹则已跳过
      // 简单剥离行内 // 注释后的尾缀再匹配，避免注释示例误报
      const codePart = raw.split("//")[0] ?? raw;
      // 允许 buildInfo.ts 中 JSDoc 示例携带的历史 tag（如 v0.1.0-alpha.6）
      if (file.endsWith("buildInfo.ts") && raw.includes("v0.1.0-alpha")) continue;

      const hitCurrent = currentVersionRE.test(codePart);
      const hitGeneric = genericAlphaRE.test(codePart);
      // 仅当命中且不在测试允许范围时记录；对 generic 命中的误报用额外过滤：
      // - 0.9 这种数值（request_retention: 0.9）不在 \d+\.\d+\.\d+-alpha 范畴，已被 generic 排除
      // - 只有包含 -alpha 的完整版本才算违规
      if (hitCurrent || (hitGeneric && codePart.includes("-alpha"))) {
        // 统一视为违规，迫使走注入而非硬编码（测试 fixture / 注释已提前跳过）
        violations.push({
          file: file.replace(repoRoot + "/", ""),
          line: i + 1,
          snippet: raw.trim().slice(0, 120),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      "[release-check] ❌ 发现 apps/web/src 内硬编码版本字面量（应走 __APP_VERSION__ / __APP_BUILD__ 注入）：",
    );
    for (const v of violations.slice(0, 10)) {
      console.error(`  - ${v.file}:${v.line}: ${v.snippet}`);
    }
    if (violations.length > 10) console.error(`  ... 及其它 ${violations.length - 10} 处`);
    console.error(
      "[release-check] 修复：移除源码中的版本字面量，改为 import { APP_VERSION } / APP_BUILD；测试 fixture / 注释除外",
    );
    process.exit(1);
  }
  console.log("[release-check] ✅ 源码硬编码版本扫描通过（apps/web/src 无违规字面量）");
}

function main() {
  const {
    tag: explicitTag,
    version: explicitVersion,
    skipHardcoded,
  } = parseArgs(process.argv.slice(2));
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
    if (!skipHardcoded) checkNoHardcodedVersion(pkgVersion);
    process.exit(0);
  }

  // 仅校验 v* 语义化 tag，presets-v* 等词包 tag 跳过
  if (!tag.startsWith("v")) {
    console.log(`[release-check] 跳过：当前 tag ${tag} 非发版 tag（仅校验 v*）`);
    if (!skipHardcoded) checkNoHardcodedVersion(pkgVersion);
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

  // RAY-368 追加护栏：硬编码版本扫描（默认开启，deploy/CI 均执行；可用 --skip-hardcoded-check 跳过）
  if (!skipHardcoded) {
    checkNoHardcodedVersion(pkgVersion);
  }

  process.exit(0);
}

main();
