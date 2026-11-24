#!/usr/bin/env node
/**
 * RAY-491 — Pages 通道回归检查（部署后断言 + 定时巡检共用）。
 *
 * 断言线上构建信息（`<base>/build-info.json`、`<base>/dev/build-info.json`）：
 * - 根路径：channel = release；branch = 期望 tag（默认取最新 v* tag）；
 *   releaseTags 含该 tag —— 覆盖 RAY-491 的验收口径「根路径 branch ＝ 该 tag、
 *   releaseTags 含它」；
 * - dev 通道：channel = dev（branch 仅作信息展示，手动 dispatch 可能指定 ref）。
 *
 * 用于三处：
 * 1. `deploy-release.yml` 部署后断言 —— 不符则重发同一 artifact 重写一次，
 *    仍不符直接 fail（不让「success 但产物是旧的」静默通过）；
 * 2. `.github/workflows/check-pages-channels.yml` 每日定时巡检；
 * 3. 本地排障：`node scripts/check-pages-channels.mjs --expect-branch v0.10.5-alpha`。
 *
 * 用法：
 *   node scripts/check-pages-channels.mjs [--base-url <url>] [--expect-branch <tag>]
 *     [--latest-tag <tag>] [--only root|dev|both] [--wait-seconds <n>] [--poll-interval <n>]
 *
 * 退出码：0 通过；1 断言失败/无法验证（fail-closed）；2 用法错误。
 */

import { execFileSync } from "node:child_process";
import {
  checkPagesChannels,
  defaultPagesBaseUrl,
  formatCheckResult,
  parseTagOutput,
  pickNewestTag,
} from "./pages-channel-lib.mjs";

const DEFAULT_BASE_URL = defaultPagesBaseUrl();

function usage() {
  return [
    "用法: node scripts/check-pages-channels.mjs [选项]",
    `  --base-url <url>        站点根地址（默认 ${DEFAULT_BASE_URL}）`,
    "  --expect-branch <tag>   期望的根路径 branch（发版后断言用；默认解析最新 v* tag）",
    "  --latest-tag <tag>      指定「最新 v* tag」，跳过 git 解析（离线/排障用）",
    "  --only root|dev|both    只查根路径 / 只查 dev 通道 / 都查（默认 both）",
    "  --wait-seconds <n>      轮询等待总时长，容忍 Pages CDN 传播延迟（默认 0）",
    "  --poll-interval <n>     轮询间隔秒（默认 15）",
    "  --help                  显示此帮助",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    expectBranch: null,
    latestTag: null,
    only: "both",
    waitSeconds: 0,
    pollInterval: 15,
  };
  const takeValue = (name, i) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`[pages-check] ${name} 缺少取值\n${usage()}`);
      process.exit(2);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      out.baseUrl = takeValue(arg, i);
      i += 1;
    } else if (arg === "--expect-branch") {
      out.expectBranch = takeValue(arg, i);
      i += 1;
    } else if (arg === "--latest-tag") {
      out.latestTag = takeValue(arg, i);
      i += 1;
    } else if (arg === "--only") {
      out.only = takeValue(arg, i);
      i += 1;
    } else if (arg === "--wait-seconds") {
      out.waitSeconds = Number(takeValue(arg, i));
      i += 1;
    } else if (arg === "--poll-interval") {
      out.pollInterval = Number(takeValue(arg, i));
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`[pages-check] 未知参数: ${arg}\n${usage()}`);
      process.exit(2);
    }
  }
  if (!["root", "dev", "both"].includes(out.only)) {
    console.error(`[pages-check] --only 只能是 root / dev / both\n${usage()}`);
    process.exit(2);
  }
  if (!Number.isFinite(out.waitSeconds) || out.waitSeconds < 0) {
    console.error(`[pages-check] --wait-seconds 必须是非负数\n${usage()}`);
    process.exit(2);
  }
  if (!Number.isFinite(out.pollInterval) || out.pollInterval <= 0) {
    console.error(`[pages-check] --poll-interval 必须是正数\n${usage()}`);
    process.exit(2);
  }
  return out;
}

/** 解析最新 v* tag：远端权威列表优先，回退本地 tag（不依赖网络时可用 --latest-tag 覆盖）。 */
function resolveLatestTag() {
  try {
    const raw = execFileSync("git", ["ls-remote", "--tags", "--refs", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 90000,
    });
    const newest = pickNewestTag(parseTagOutput(raw));
    if (newest) return newest;
  } catch (error) {
    console.error(
      `[pages-check] git ls-remote 失败，回退本地 tag：${error.message.split("\n")[0]}`,
    );
  }
  try {
    const raw = execFileSync("git", ["tag", "--list", "v*"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    return pickNewestTag(parseTagOutput(raw));
  } catch (error) {
    console.error(`[pages-check] git tag --list 失败：${error.message.split("\n")[0]}`);
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const latestTag = options.latestTag ?? (options.expectBranch ? null : resolveLatestTag());
  if (!options.expectBranch && !latestTag) {
    console.error(
      "[pages-check] 无法确定期望 tag：未提供 --expect-branch，且未解析到任何 v* tag（可用 --latest-tag 指定）",
    );
    process.exit(1);
  }

  console.log(
    `[pages-check] 目标 ${options.baseUrl}；期望 branch ${options.expectBranch ?? latestTag ?? "（仅查 dev）"}；范围 ${options.only}`,
  );

  const result = await checkPagesChannels({
    baseUrl: options.baseUrl,
    expectBranch: options.expectBranch,
    latestTag,
    only: options.only,
    waitSeconds: options.waitSeconds,
    pollIntervalMs: options.pollInterval * 1000,
    log: (message) => console.log(`[pages-check] ${message}`),
  });

  for (const line of formatCheckResult(result)) console.log(line);

  if (!result.ok) {
    console.error(
      `[pages-check] 断言失败（${result.problems.length} 项）：构建信息与期望不符，稳定通道可能被旧快照覆盖。`,
    );
    process.exit(1);
  }
  console.log("[pages-check] 通过：线上构建信息与期望一致。");
}

main().catch((error) => {
  console.error(`[pages-check] 执行失败：${error?.stack ?? error}`);
  process.exit(1);
});
