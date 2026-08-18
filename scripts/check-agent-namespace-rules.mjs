// scripts/check-agent-namespace-rules.mjs
//
// RAY-337 — agent namespace 校验的共享常量与 regex（评审建议 S1 闭环）。
// scripts/check-agent-namespace.mjs 与 scripts/test-check-agent-namespace.mjs
// 都从这里 import，避免双份维护的漂移风险。
//
// 行为约定（与 PR #92 评审共识一致）：
// - 分支匹配 AGENT_BRANCH_REGEX 才进入校验；否则 skipped。
// - head commit author email 命中以下任意一类即放行：
//   - `<name>@multica.local`（旧约定）→ 必须与分支的 <name> 一致，否则
//     mismatch=true。
//   - daemon / 平台身份（PLATFORM_IDENTITY_EMAILS）→ platform_identity
//     （commit metadata 不编码 agent，按通过处理）。
//   - 仓库 owner email → human_owner。
// - 其它身份 → unknown_author（保守兜底，触发 merge_block）。

// 评审建议 S6：大小写不敏感（保留原 `agent/` 风格约定但放过误写大写）。
export const AGENT_BRANCH_REGEX = /^agent\/([A-Za-z][A-Za-z0-9_-]{0,63})\/[^/]+$/i;

// author email 严格解析（评审 S2 修正：不做 glob 子串匹配）。
export const MULTICA_LOCAL_REGEX = /^([A-Za-z][A-Za-z0-9_-]{0,63})@multica\.local$/;

// 平台 / daemon 身份清单（精确匹配 —— 评审 S2 修正）。
export const PLATFORM_IDENTITY_EMAILS = Object.freeze([
  "hunde@example.com",
  "multica-agent@users.noreply.github.com",
]);

export const OWNER_EMAIL = "106456682+RayySummers@users.noreply.github.com";

// 纯函数：根据 head_ref + author_email 判定 namespace 结果，便于
// scripts/check-agent-namespace.mjs 与 scripts/test-check-agent-namespace.mjs
// 共用同一份判定逻辑（消除 S1 双份维护风险）。
export function classify(headRef, authorEmail) {
  let branchAgent = "";
  let claimedAgent = "";
  let status = "skipped";
  let mismatch = false;

  if (AGENT_BRANCH_REGEX.test(headRef)) {
    branchAgent = (headRef.match(AGENT_BRANCH_REGEX)[1] || "").toLowerCase();

    if (MULTICA_LOCAL_REGEX.test(authorEmail)) {
      claimedAgent = (authorEmail.match(MULTICA_LOCAL_REGEX)[1] || "").toLowerCase();
      status = "checked";
      mismatch = claimedAgent !== branchAgent;
    } else if (PLATFORM_IDENTITY_EMAILS.includes(authorEmail)) {
      status = "platform_identity";
    } else if (authorEmail === OWNER_EMAIL) {
      status = "human_owner";
    } else {
      status = "unknown_author";
    }
  }

  return { status, mismatch, branchAgent, claimedAgent };
}
