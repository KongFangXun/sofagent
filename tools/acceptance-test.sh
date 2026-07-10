#!/usr/bin/env bash
# ============================================================
# sofagent-audit · 上线前验收测试（Pre-Release Acceptance Test）
# v1.0.0 · 9 个端到端场景，覆盖完整用户旅程
# ============================================================
# 用真实 git 仓库走完整用户旅程：
#   Fresh install → --init → --doctor → 正常 commit → 违规拦截
#   → --json → --ci → 首次提交 → 故意搞坏 hook
#
# 用法：
#   bash tools/acceptance-test.sh
#
# 退出码 = 失败场景数（0 = 全部通过）
# ============================================================

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── 路径 ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUDIT_DIR="$PROJECT_ROOT/sofagent/audit"
ORIG_DIR="$(pwd)"
CLI="node $AUDIT_DIR/dist/index.js"

# 确保已 build
if [ ! -f "$AUDIT_DIR/dist/index.js" ]; then
  echo -e "${RED}❌ dist/index.js 不存在，请先 cd sofagent/audit && npm run build${NC}"
  exit 1
fi

# ── 临时仓库 + wrapper（覆盖全局旧版）────────────────────────
TMP_REPO=""
FAILED=0
PASSED=0

cleanup() {
  if [ -n "$TMP_REPO" ] && [ -d "$TMP_REPO" ]; then
    rm -rf "$TMP_REPO"
  fi
}
trap cleanup EXIT

# 创建 sofagent-audit wrapper，确保 hook 用本地 v1.0 而非全局旧版
WRAPPER_DIR=$(mktemp -d /tmp/sofagent-wrapper-XXXX)
mkdir -p "$WRAPPER_DIR/bin"
cat > "$WRAPPER_DIR/bin/sofagent-audit" << EOF
#!/bin/bash
exec node "$AUDIT_DIR/dist/index.js" "\$@"
EOF
chmod +x "$WRAPPER_DIR/bin/sofagent-audit"
export PATH="$WRAPPER_DIR/bin:$PATH"
# wrapper 也在 cleanup 时删除
WRAPPER_CLEANUP="$WRAPPER_DIR"
cleanup() {
  cd "$ORIG_DIR" 2>/dev/null || true
  [ -n "$TMP_REPO" ] && [ -d "$TMP_REPO" ] && rm -rf "$TMP_REPO"
  [ -n "$WRAPPER_CLEANUP" ] && [ -d "$WRAPPER_CLEANUP" ] && rm -rf "$WRAPPER_CLEANUP"
}

# ── 辅助函数 ──────────────────────────────────────────────────
scenario() {
  echo ""
  echo -e "${CYAN}━━━ 场景 $1: $2 ━━━${NC}"
}

pass() {
  echo -e "${GREEN}  ✅ PASS${NC}"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "${RED}  ❌ FAIL: $1${NC}"
  FAILED=$((FAILED + 1))
}

# ── 场景 1: Fresh install（--install-hook）────────────────────
scenario 1 "Fresh install（--install-hook）"

TMP_REPO=$(mktemp -d /tmp/sofagent-e2e-XXXXXX)
cd "$TMP_REPO"
git init --quiet
git config user.email "test@test.com"
git config user.name "Test"

$CLI --install-hook 2>&1 | head -5

if [ -f "$TMP_REPO/.git/hooks/pre-commit" ] && [ -x "$TMP_REPO/.git/hooks/pre-commit" ]; then
  pass
else
  fail "pre-commit hook 未安装或不可执行"
fi

# ── 场景 2: --init 一键初始化 ────────────────────────────────
scenario 2 "--init 一键初始化"

$CLI --init 2>&1 | head -10

INIT_OK=true
[ ! -f "$TMP_REPO/.sofagent/config.yml" ] && INIT_OK=false && fail ".sofagent/config.yml 未生成"
[ ! -f "$TMP_REPO/.git/hooks/pre-commit" ] && INIT_OK=false && fail "hook 未安装"

if $INIT_OK; then
  pass
fi

# ── 场景 3: --doctor 健康诊断 ─────────────────────────────────
scenario 3 "--doctor 健康诊断"

DOCTOR_OUTPUT=$($CLI --doctor 2>&1 || true)
echo "$DOCTOR_OUTPUT" | head -10

# 应有 7 项检查，每项 ✅ 或 ❌ 或 ⚠️
CHECK_COUNT=$(echo "$DOCTOR_OUTPUT" | grep -c '✅\|❌\|⚠️' || true)
if [ "$CHECK_COUNT" -ge 7 ]; then
  pass
else
  fail "诊断项不足：$CHECK_COUNT/7"
fi

# ── 场景 4: 正常 commit（单文件修复 → PASS）──────────────────
scenario 4 "正常 commit（单文件修复）"

# 先做一个初始 commit（hook 已装，首次提交场景 8 会单独测，这里先 base）
echo "# Test Project" > README.md
git add README.md
GIT_EDITOR=true git commit --quiet -m "init: project setup" 2>&1 || true

# 正常修复：改一个字
echo "# Test Project v2" > README.md
git add README.md

COMMIT_OUTPUT=$(GIT_EDITOR=true git commit -m "fix: update README title" 2>&1 || true)
echo "$COMMIT_OUTPUT" | head -5

# 正常 commit 应该成功（exit 0）
if echo "$COMMIT_OUTPUT" | grep -q "PASS\|master\|main\|→"; then
  pass
else
  # hook 可能没拦——检查 git log
  if git log --oneline | grep -q "update README"; then
    pass
  else
    fail "正常 commit 被拦截：$COMMIT_OUTPUT"
  fi
fi

# ── 场景 5: 违规 commit（.env → FAIL A1）──────────────────────
scenario 5 "违规 commit（提交 .env）"

echo "DATABASE_URL=postgres://user:pass@localhost/db" > .env
git add -f .env

VIOLATION_OUTPUT=$(GIT_EDITOR=true git commit -m "add env config" 2>&1 || true)
echo "$VIOLATION_OUTPUT" | head -10

# 违规 commit 应被拦截（exit 1）
if echo "$VIOLATION_OUTPUT" | grep -qi "FAIL\|敏感\|A1\|拦截\|blocked\|aborted"; then
  pass
else
  # 检查 .env 是否真的被 commit 了
  if git log --oneline | grep -q "add env config"; then
    fail ".env 被成功提交——hook 未拦截"
  else
    pass  # hook 拦截了但消息格式不同
  fi
fi

# ── 场景 6: --json 输出 ───────────────────────────────────────
scenario 6 "--json 输出"

# 先做一个正常的 diff
echo "// updated" >> README.md
git add README.md
GIT_EDITOR=true git commit --quiet -m "test: json scenario" 2>&1 || true

JSON_OUTPUT=$($CLI --diff HEAD~1..HEAD --json 2>&1 || true)
echo "$JSON_OUTPUT" | head -5

# 验证是有效 JSON，含 exitCode 和 rules
if echo "$JSON_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'exitCode' in d and 'rules' in d" 2>/dev/null; then
  pass
else
  fail "JSON 输出无效或缺少字段"
fi

# ── 场景 7: --ci 模式 ─────────────────────────────────────────
scenario 7 "--ci 模式（strict + silent）"

CI_OUTPUT=$($CLI --diff HEAD~1..HEAD --ci 2>&1 || true)
echo "$CI_OUTPUT" | head -5

# CI 模式不应有彩色输出（检查 ANSI 转义码）
if echo "$CI_OUTPUT" | grep -q $'\033\['; then
  fail "CI 模式有彩色输出"
else
  pass
fi

# ── 场景 8: 首次提交（空仓库 → 友好提示）────────────────────
scenario 8 "首次提交（空仓库）"

TMP_REPO2=$(mktemp -d /tmp/sofagent-e2e-first-XXXXXX)
cd "$TMP_REPO2"
git init --quiet
git config user.email "test@test.com"
git config user.name "Test"
$CLI --install-hook > /dev/null 2>&1

echo "# New Project" > README.md
git add README.md

FIRST_OUTPUT=$(GIT_EDITOR=true git commit -m "initial commit" 2>&1 || true)
echo "$FIRST_OUTPUT" | head -5

# 不应有 git fatal 错误
if echo "$FIRST_OUTPUT" | grep -qi "fatal\|ambiguous argument"; then
  fail "首次提交报 git fatal：$FIRST_OUTPUT"
else
  pass
fi

# 清理
rm -rf "$TMP_REPO2"

# ── 场景 9: --doctor 诊断坏环境 ───────────────────────────────
scenario 9 "--doctor 诊断坏环境（故意搞坏 hook）"

cd "$TMP_REPO"

# 故意删掉 hook
rm -f "$TMP_REPO/.git/hooks/pre-commit"

BROKEN_OUTPUT=$($CLI --doctor 2>&1 || true)
echo "$BROKEN_OUTPUT" | head -10

# 应检测到 hook 缺失（❌ + 修复建议）
if echo "$BROKEN_OUTPUT" | grep -qi "❌\|hook\|安装"; then
  pass
else
  fail "--doctor 未检测到 hook 缺失"
fi

# ── 总结 ──────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  验收测试结果：${GREEN}$PASSED 通过${NC} / ${RED}$FAILED 失败${NC} / 共 $((PASSED + FAILED))"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}❌ 有 $FAILED 个场景失败，请修复后再发版${NC}"
  exit "$FAILED"
else
  echo -e "${GREEN}✅ 全部通过，可以进入发版流程${NC}"
  exit 0
fi
