#!/usr/bin/env node
// scripts/check-agent-namespace.mjs
//
// RAY-337 — agent namespace 校验的可执行入口（CI workflow 通过 node 调用）。
// 共享常量与 classify 逻辑落在 scripts/check-agent-namespace-rules.mjs，
// 本文件只做参数转发、git 调用、stdout / GITHUB_OUTPUT 副作用（评审 S1 落地：
// 消除 workflow 与测试脚本之间的逻辑双份维护）。
//
// 用法（GitHub Actions 内）：
//   node scripts/check-agent-namespace.mjs "$HEAD_REF" "$HEAD_SHA" "$GITHUB_WORKSPACE"
// 用法（本地自检）：
//   node scripts/check-agent-namespace.mjs <head_ref> <head_sha> <repo_root>
//
// 输出：
// - stdout：单行 JSON，字段 namespace_status / branch_agent / claimed_agent
//   / mismatch / author_name / author_email / head_ref / head_sha。
// - 若环境变量 GITHUB_OUTPUT 已设置：额外以 `key=value` 形式追加同一份
//   结果，便于 workflow 下游步骤用 `${{ steps.<id>.outputs.<key> }}` 读取。
// - 退出码：
//   - 0：pass / skipped / platform_identity / human_owner
//   - 1：mismatch 或 unknown_author

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { classify } from "./check-agent-namespace-rules.mjs";

const [, , headRefArg, headShaArg, repoRootArg] = process.argv;

if (typeof headRefArg !== "string" || headRefArg === "") {
  console.error("usage: check-agent-namespace.mjs <head_ref> <head_sha> [repo_root]");
  process.exit(2);
}
if (typeof headShaArg !== "string" || headShaArg === "") {
  console.error("usage: check-agent-namespace.mjs <head_ref> <head_sha> [repo_root]");
  process.exit(2);
}

const repoRoot = typeof repoRootArg === "string" && repoRootArg !== "" ? repoRootArg : ".";

function gitLogFormat(repoRoot, sha, fmt) {
  const res = spawnSync("git", ["-C", repoRoot, "log", "-1", `--format=${fmt}`, sha], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    console.error(`git log failed: ${res.stderr.trim()}`);
    process.exit(2);
  }
  return res.stdout.trim();
}

const authorName = gitLogFormat(repoRoot, headShaArg, "%an");
const authorEmail = gitLogFormat(repoRoot, headShaArg, "%ae");

const { status, mismatch, branchAgent, claimedAgent } = classify(headRefArg, authorEmail);

const result = {
  namespace_status: status,
  branch_agent: branchAgent,
  claimed_agent: claimedAgent,
  mismatch: mismatch,
  author_name: authorName,
  author_email: authorEmail,
  head_ref: headRefArg,
  head_sha: headShaArg,
};

const line = JSON.stringify(result);
console.log(line);

// GITHUB_OUTPUT 写盘（仅当调用方提供）。Action 文档：每行 `key=value`，多行值
// 支持 heredoc 语法（<<EOF ... EOF），但本脚本所有字段都是单行，省去该复杂度。
if (process.env.GITHUB_OUTPUT) {
  const out = process.env.GITHUB_OUTPUT;
  for (const [k, v] of Object.entries(result)) {
    appendFileSync(out, `${k}=${v}\n`);
  }
}

// 退出码：mismatch 或 unknown_author → 1；其它 → 0。
// workflow 在「通过」分支不依赖退出码判断（基于 outputs.mismatch）。
if (mismatch || status === "unknown_author") {
  process.exit(1);
}
process.exit(0);
