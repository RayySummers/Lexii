#!/usr/bin/env node
/**
 * RAY-491 — 写根路径前的「新鲜度判定」CLI（`deploy-dev.yml` 专用）。
 *
 * 为什么需要它：`deploy-dev.yml` 在 checkout 那一刻解析「最新 v* tag」，那台
 * runner 的 tag 列表可能已经落后（新的发版 tag 是这次构建开始之后才推上去
 * 的），而 dev 的构建又比 release 慢，落盘更晚 → 用旧快照覆盖了刚发布的稳定
 * 版（RAY-491 事故）。`concurrency: pages` 只保证按队列顺序落盘，不保证后落盘
 * 的内容更新，因此必须在「写根路径」这个动作上做内容侧的新鲜度判断。
 *
 * 本脚本在根路径构建之前运行，输出三件事（写入 $GITHUB_ENV / stdout）：
 *   ROOT_BRANCH=<tag>    根路径应当构建的 tag（不是 dev 的候选 tag 时即 adopt）
 *   ROOT_ACTION=write|adopt
 *   ROOT_REASON=<一行说明>
 *
 * 判定依据（取最新者，绝不降级）：
 *   1. 候选 tag：workflow 此前解析出的 tag（可能过时）；
 *   2. `git ls-remote --tags --refs <remote>`：此刻的权威 tag 集合；
 *   3. 线上根路径 `<base>/build-info.json` 的 branch：已部署的稳定版。
 *
 * 用法：
 *   node scripts/resolve-pages-root.mjs --candidate v0.10.5-alpha \
 *     [--live-url https://rayysummers.github.io/Lexii/build-info.json] \
 *     [--remote origin] [--skip-live] [--github-env "$GITHUB_ENV"]
 *
 * 退出码：0 正常（无论 write/adopt）；2 用法错误或判定失败。
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  compareReleaseTags,
  decideRootSnapshot,
  defaultPagesBaseUrl,
  isReleaseTag,
  parseBuildInfo,
  parseTagOutput,
  pickNewestTag,
} from "./pages-channel-lib.mjs";

/** 默认读本仓库线上根路径的构建信息（CI 里由 GITHUB_REPOSITORY 推导）。 */
const DEFAULT_LIVE_URL = `${defaultPagesBaseUrl()}build-info.json`;

function usage() {
  return [
    "用法: node scripts/resolve-pages-root.mjs --candidate <tag|main> [选项]",
    "  --candidate <ref>     必填：dev workflow 此前解析出的候选 tag（无 tag 时为 main）",
    "  --live-url <url>      线上根路径 build-info.json 地址",
    `                        默认 ${DEFAULT_LIVE_URL}`,
    "  --remote <name>       重新解析 tag 用的 git remote（默认 origin）",
    "  --skip-live           不读线上构建信息（离线/排障用）",
    "  --github-env <path>   把 ROOT_BRANCH / ROOT_ACTION / ROOT_REASON 追加写入该文件",
    "  --help                显示此帮助",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    candidate: null,
    liveUrl: DEFAULT_LIVE_URL,
    remote: "origin",
    skipLive: false,
    githubEnv: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (name) => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`[pages-root] ${name} 缺少取值\n${usage()}`);
        process.exit(2);
      }
      i += 1;
      return value;
    };
    if (arg === "--candidate") out.candidate = takeValue(arg);
    else if (arg === "--live-url") out.liveUrl = takeValue(arg);
    else if (arg === "--remote") out.remote = takeValue(arg);
    else if (arg === "--github-env") out.githubEnv = takeValue(arg);
    else if (arg === "--skip-live") out.skipLive = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`[pages-root] 未知参数: ${arg}\n${usage()}`);
      process.exit(2);
    }
  }
  return out;
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 90000,
  });
}

/** 重新解析 tag：优先远端权威列表（含本次 run 期间新推的 tag），失败回退本地 tag。 */
function resolveAvailableTags(remote) {
  try {
    const raw = git(["ls-remote", "--tags", "--refs", remote]);
    const tags = parseTagOutput(raw);
    if (tags.length > 0) return { tags, source: `git ls-remote --tags ${remote}` };
    console.log(`[pages-root] ${remote} 上没有 tag（或输出为空），回退本地 tag 列表`);
  } catch (error) {
    console.error(
      `[pages-root] git ls-remote 失败（${error.message.split("\n")[0]}），回退本地 tag 列表`,
    );
  }
  try {
    const raw = git(["tag", "--list", "v*"]);
    return { tags: parseTagOutput(raw), source: "git tag --list v*" };
  } catch (error) {
    console.error(`[pages-root] git tag --list 失败：${error.message.split("\n")[0]}`);
    return { tags: [], source: "unavailable" };
  }
}

/** 读线上根路径构建信息；403/404/网络错误都只降级为「不可读」，不阻塞部署。 */
async function readLiveBuildInfo(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const cacheBusted = `${url}${url.includes("?") ? "&" : "?"}_ray491=${Date.now()}-${attempt}`;
    try {
      const response = await fetch(cacheBusted, {
        cache: "no-store",
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        console.error(
          `[pages-root] 线上构建信息不可读（HTTP ${response.status}，第 ${attempt} 次）`,
        );
        continue;
      }
      return parseBuildInfo(await response.text());
    } catch (error) {
      console.error(
        `[pages-root] 线上构建信息读取失败（第 ${attempt} 次）：${error?.message ?? String(error)}`,
      );
    }
  }
  return null;
}

function toEnvValue(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.candidate) {
    console.error(`[pages-root] 缺少 --candidate\n${usage()}`);
    process.exit(2);
  }

  const { tags, source } = resolveAvailableTags(options.remote);
  const newestAvailable = pickNewestTag(tags);
  console.log(
    `[pages-root] 候选 ${options.candidate}；远端最新 ${newestAvailable ?? "无"}（来源 ${source}，共 ${tags.length} 个 tag）`,
  );

  const liveBuildInfo = options.skipLive ? null : await readLiveBuildInfo(options.liveUrl);
  console.log(
    `[pages-root] 线上根路径：${
      liveBuildInfo
        ? `branch=${liveBuildInfo.branch} sha=${liveBuildInfo.sha} time=${liveBuildInfo.time}`
        : "不可读（按 git 信号判定）"
    }`,
  );

  const decision = decideRootSnapshot({
    candidate: options.candidate,
    availableTags: tags,
    liveBuildInfo,
  });

  // 防御性后置条件：判定结果绝不允许落后于任何已知更新信号（RAY-491 的根因）
  const liveTag = liveBuildInfo && isReleaseTag(liveBuildInfo.branch) ? liveBuildInfo.branch : null;
  for (const [label, tag] of [
    ["远端最新 tag", newestAvailable],
    ["线上根路径", liveTag],
  ]) {
    if (tag && isReleaseTag(decision.branch) && compareReleaseTags(decision.branch, tag) < 0) {
      console.error(`[pages-root] 内部错误：判定结果 ${decision.branch} 落后于${label} ${tag}`);
      process.exit(2);
    }
  }

  console.log(`[pages-root] 判定：${decision.action} → 根路径构建 ${decision.branch}`);
  console.log(`[pages-root] 理由：${decision.reason}`);

  if (options.githubEnv) {
    const lines = [
      `ROOT_BRANCH=${toEnvValue(decision.branch)}`,
      `ROOT_ACTION=${toEnvValue(decision.action)}`,
      `ROOT_REASON=${toEnvValue(decision.reason)}`,
      `ROOT_LATEST_TAG=${toEnvValue(newestAvailable ?? "")}`,
      `ROOT_LIVE_BRANCH=${toEnvValue(liveBuildInfo?.branch ?? "")}`,
    ];
    appendFileSync(options.githubEnv, `${lines.join("\n")}\n`, "utf-8");
    console.log(
      `[pages-root] 已写入 $GITHUB_ENV：${lines.map((line) => line.split("=")[0]).join(", ")}`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### RAY-491 根路径新鲜度判定",
        "",
        `| 项 | 值 |`,
        `| --- | --- |`,
        `| 候选 tag | \`${options.candidate}\` |`,
        `| 判定 | **${decision.action}** |`,
        `| 根路径将构建 | \`${decision.branch}\` |`,
        `| 线上根路径 branch | \`${liveBuildInfo?.branch ?? "不可读"}\` |`,
        `| 理由 | ${decision.reason} |`,
        "",
      ].join("\n"),
      "utf-8",
    );
  }
}

main().catch((error) => {
  console.error(`[pages-root] 失败：${error?.stack ?? error}`);
  process.exit(2);
});
