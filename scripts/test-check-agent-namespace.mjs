#!/usr/bin/env node
// scripts/test-check-agent-namespace.mjs
//
// RAY-337 — agent namespace 校验的本地测试。用 `node:test`（Node ≥ 18 自带）
// 直接覆盖 scripts/check-agent-namespace-rules.mjs 的真实 classify 函数
// 路径，不依赖任何工作流运行时；评审 B3 的逻辑层证据由此给出。
//
// 用法：
//   node --test scripts/test-check-agent-namespace.mjs
//
// 注意：end-to-end CI 验证（label / comment 实际挂载）由评审 B3 的合成 PR
// 单独给出，不在单测范围内。

import test from "node:test";
import assert from "node:assert/strict";
import { classify, OWNER_EMAIL } from "./check-agent-namespace-rules.mjs";

function case_(label, headRef, email, exp) {
  test(label, () => {
    const got = classify(headRef, email);
    assert.equal(got.status, exp.status, `status`);
    assert.equal(got.mismatch, exp.mismatch, `mismatch`);
    assert.equal(got.branchAgent, exp.branchAgent, `branchAgent`);
    assert.equal(got.claimedAgent, exp.claimedAgent, `claimedAgent`);
  });
}

// ---- 非 agent 分支：跳过 ----
case_("feat 分支 + 任意 author → skipped", "feat/fsrs-7", "knox@multica.local", {
  status: "skipped",
  mismatch: false,
  branchAgent: "",
  claimedAgent: "",
});
case_("main 分支 + owner → skipped", "main", OWNER_EMAIL, {
  status: "skipped",
  mismatch: false,
  branchAgent: "",
  claimedAgent: "",
});
case_("fix 分支 + 平台身份 → skipped", "fix/some-bug", "hunde@example.com", {
  status: "skipped",
  mismatch: false,
  branchAgent: "",
  claimedAgent: "",
});

// ---- agent 分支 + multica.local author 一致 ----
case_("knox 分支 + knox author", "agent/knox/abc123", "knox@multica.local", {
  status: "checked",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "knox",
});
case_("harvey 分支 + harvey author", "agent/harvey/xyz789", "harvey@multica.local", {
  status: "checked",
  mismatch: false,
  branchAgent: "harvey",
  claimedAgent: "harvey",
});

// ---- agent 分支 + 跨 agent author（必须 fail）----
case_("RAY-337 验收：harvey 分支 + vega author", "agent/harvey/12345", "vega@multica.local", {
  status: "checked",
  mismatch: true,
  branchAgent: "harvey",
  claimedAgent: "vega",
});
case_("knox 分支 + oscar author", "agent/knox/abcdef", "oscar@multica.local", {
  status: "checked",
  mismatch: true,
  branchAgent: "knox",
  claimedAgent: "oscar",
});

// ---- agent 分支 + 平台 / daemon 身份（信息性通过）----
case_("knox 分支 + hunde 平台身份", "agent/knox/aaa111", "hunde@example.com", {
  status: "platform_identity",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "",
});
case_(
  "harvey 分支 + multica-agent 平台身份",
  "agent/harvey/bbb222",
  "multica-agent@users.noreply.github.com",
  {
    status: "platform_identity",
    mismatch: false,
    branchAgent: "harvey",
    claimedAgent: "",
  },
);

// ---- agent 分支 + owner ----
case_("knox 分支 + owner", "agent/knox/ccc333", OWNER_EMAIL, {
  status: "human_owner",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "",
});

// ---- 未知身份（保守兜底）----
case_("knox 分支 + 随机邮箱", "agent/knox/ddd444", "someone@example.com", {
  status: "unknown_author",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "",
});
case_("harvey 分支 + 空字符串邮箱", "agent/harvey/eee555", "", {
  status: "unknown_author",
  mismatch: false,
  branchAgent: "harvey",
  claimedAgent: "",
});

// ---- S2：glob 元字符误判应被拦截 ----
case_("S2 修正：email 含 `*` glob 不应被误判平台身份", "agent/knox/fff666", "hunde@example.com*", {
  status: "unknown_author",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "",
});
case_("S2 修正：email 含 `?` glob 不应被误判", "agent/knox/ggg777", "hunde@example.com?", {
  status: "unknown_author",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "",
});

// ---- S6：大写 / 混合大小写前缀 ----
case_("S6：大写 Agent/ 前缀应被识别", "Agent/knox/hhh888", "knox@multica.local", {
  status: "checked",
  mismatch: false,
  branchAgent: "knox",
  claimedAgent: "knox",
});
case_("S6：混合大小写 AGENT/ 前缀应被识别", "AGENT/harvey/iii999", "harvey@multica.local", {
  status: "checked",
  mismatch: false,
  branchAgent: "harvey",
  claimedAgent: "harvey",
});

// ---- 分支格式边界 ----
case_("agent 但 name 为空 → skipped", "agent//abc", "knox@multica.local", {
  status: "skipped",
  mismatch: false,
  branchAgent: "",
  claimedAgent: "",
});
case_("agent 但只有一级 → skipped", "agent/knox", "knox@multica.local", {
  status: "skipped",
  mismatch: false,
  branchAgent: "",
  claimedAgent: "",
});
case_("agent 但 session 为空 → skipped", "agent/knox/", "knox@multica.local", {
  status: "skipped",
  mismatch: false,
  branchAgent: "",
  claimedAgent: "",
});
