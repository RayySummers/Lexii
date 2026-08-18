#!/usr/bin/env bash
# scripts/test-check-agent-namespace.sh
#
# RAY-337 的本地合成验证脚本：把 workflow 的核心判断逻辑抽出来，喂合成
# (branch, author_email, author_name) 三元组，断言期望的 namespace_status /
# mismatch / branch_agent / claimed_agent。不依赖 GitHub Actions 上下文，
# 纯 bash + regex，可在任何能跑 bash 的环境（含本地）跑。
#
# 用法：bash scripts/test-check-agent-namespace.sh
# 退出码：0 = 全部用例通过；非零 = 至少一例失败。

set -euo pipefail

AGENT_BRANCH_REGEX='^agent/([a-z][a-z0-9_-]{0,63})/[^/]+$'
MULTICA_LOCAL_REGEX='^([a-z][a-z0-9_-]{0,63})@multica\.local$'
PLATFORM_IDENTITY_EMAILS='hunde@example.com multica-agent@users.noreply.github.com'
OWNER_EMAIL='106456682+RayySummers@users.noreply.github.com'

# classify <head_ref> <author_email>
# 通过全局变量回写：namespace_status, mismatch, branch_agent, claimed_agent
classify() {
  local head_ref="$1"
  local author_email="$2"
  local branch_agent=""
  local claimed_agent=""
  local status=""
  local mismatch="false"

  if [[ ! "$head_ref" =~ $AGENT_BRANCH_REGEX ]]; then
    status="skipped"
  else
    branch_agent="${BASH_REMATCH[1]}"

    if [[ "$author_email" =~ $MULTICA_LOCAL_REGEX ]]; then
      claimed_agent="${BASH_REMATCH[1]}"
      status="checked"
    elif [[ " $PLATFORM_IDENTITY_EMAILS " == *" $author_email "* ]]; then
      status="platform_identity"
    elif [[ "$author_email" == "$OWNER_EMAIL" ]]; then
      status="human_owner"
    else
      status="unknown_author"
    fi

    if [[ "$status" == "checked" && "$claimed_agent" != "$branch_agent" ]]; then
      mismatch="true"
    fi
  fi

  NAMESPACE_status="$status"
  NAMESPACE_mismatch="$mismatch"
  NAMESPACE_branch_agent="$branch_agent"
  NAMESPACE_claimed_agent="$claimed_agent"
}

# assert_case "<label>" <head_ref> <author_email> <expected_status> <expected_mismatch> <expected_branch_agent> <expected_claimed_agent>
assert_case() {
  local label="$1"
  local head_ref="$2"
  local email="$3"
  local exp_status="$4"
  local exp_mismatch="$5"
  local exp_branch="$6"
  local exp_claimed="$7"

  classify "$head_ref" "$email"

  local fail=0
  if [[ "$NAMESPACE_status" != "$exp_status" ]]; then
    echo "  ✗ [$label] status 期望=$exp_status 实际=$NAMESPACE_status"
    fail=1
  fi
  if [[ "$NAMESPACE_mismatch" != "$exp_mismatch" ]]; then
    echo "  ✗ [$label] mismatch 期望=$exp_mismatch 实际=$NAMESPACE_mismatch"
    fail=1
  fi
  if [[ "$NAMESPACE_branch_agent" != "$exp_branch" ]]; then
    echo "  ✗ [$label] branch_agent 期望=$exp_branch 实际=$NAMESPACE_branch_agent"
    fail=1
  fi
  if [[ "$NAMESPACE_claimed_agent" != "$exp_claimed" ]]; then
    echo "  ✗ [$label] claimed_agent 期望=$exp_claimed 实际=$NAMESPACE_claimed_agent"
    fail=1
  fi

  if [[ $fail -eq 0 ]]; then
    echo "  ✓ [$label] status=$NAMESPACE_status mismatch=$NAMESPACE_mismatch branch=$NAMESPACE_branch_agent claimed=$NAMESPACE_claimed_agent"
  else
    echo "    inputs: head_ref=$head_ref email=$email"
    FAILED=$((FAILED + 1))
  fi
  TOTAL=$((TOTAL + 1))
}

TOTAL=0
FAILED=0

echo "== 非 agent 分支：跳过 =="
assert_case "feat 分支 + 任意 author" \
  "feat/fsrs-7" "knox@multica.local" \
  "skipped" "false" "" ""

assert_case "main 分支 + owner" \
  "main" "106456682+RayySummers@users.noreply.github.com" \
  "skipped" "false" "" ""

assert_case "fix 分支 + 平台身份" \
  "fix/some-bug" "hunde@example.com" \
  "skipped" "false" "" ""

echo
echo "== agent 分支 + multica.local author =="
assert_case "knox 分支 + knox author（一致）" \
  "agent/knox/abc123" "knox@multica.local" \
  "checked" "false" "knox" "knox"

assert_case "harvey 分支 + harvey author（一致）" \
  "agent/harvey/xyz789" "harvey@multica.local" \
  "checked" "false" "harvey" "harvey"

echo
echo "== agent 分支 + 跨 agent author（应该 fail）=="
assert_case "RAY-337 合成用例：harvey 分支 + vega author" \
  "agent/harvey/12345" "vega@multica.local" \
  "checked" "true" "harvey" "vega"

assert_case "knox 分支 + oscar author" \
  "agent/knox/abcdef" "oscar@multica.local" \
  "checked" "true" "knox" "oscar"

echo
echo "== agent 分支 + 平台 / daemon 身份（信息性通过）=="
assert_case "knox 分支 + hunde 平台身份" \
  "agent/knox/aaa111" "hunde@example.com" \
  "platform_identity" "false" "knox" ""

assert_case "harvey 分支 + multica-agent 平台身份" \
  "agent/harvey/bbb222" "multica-agent@users.noreply.github.com" \
  "platform_identity" "false" "harvey" ""

echo
echo "== agent 分支 + owner（人工直推，通过）=="
assert_case "knox 分支 + owner" \
  "agent/knox/ccc333" "106456682+RayySummers@users.noreply.github.com" \
  "human_owner" "false" "knox" ""

echo
echo "== agent 分支 + 未知身份（保守兜底，触发 merge_block）=="
assert_case "knox 分支 + 随机邮箱" \
  "agent/knox/ddd444" "someone@example.com" \
  "unknown_author" "false" "knox" ""

assert_case "harvey 分支 + 空字符串邮箱" \
  "agent/harvey/eee555" "" \
  "unknown_author" "false" "harvey" ""

echo
echo "== 分支格式边界 =="
assert_case "agent 但 name 为空" \
  "agent//abc" "knox@multica.local" \
  "skipped" "false" "" ""

assert_case "agent 但只有一级" \
  "agent/knox" "knox@multica.local" \
  "skipped" "false" "" ""

assert_case "agent 大写 name（不符合小写约定）" \
  "agent/Knox/abc" "knox@multica.local" \
  "skipped" "false" "" ""

echo
if [[ $FAILED -eq 0 ]]; then
  echo "全部 $TOTAL 个用例通过 ✓"
  exit 0
else
  echo "$FAILED / $TOTAL 个用例失败 ✗"
  exit 1
fi