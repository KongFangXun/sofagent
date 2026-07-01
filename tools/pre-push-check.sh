#!/bin/bash
# ============================================================
# pre-push-check.sh · 推前预检（本地 CI 等价检查）
# ============================================================
# 在 git push 之前，本地跑一遍所有 CI workflow 的等价检查。
# 全绿才推，避免每次推上去被 CI 打回来。
#
# 对应 CI workflows:
#   - shellcheck.yml        → shellcheck 所有 .sh
#   - verify.yml            → verify.sh
#   - sofagent-audit.yml    → sofagent-audit --silent --diff HEAD~1..HEAD
#   + check-version.sh      → 版本号一致性
#   + check-docs.sh         → 文档预算+死链+Skill 行数
#   + npm test / build      → 审计引擎构建+测试
#
# 用法:
#   ./tools/pre-push-check.sh           # 全量检查
#   ./tools/pre-push-check.sh --quick   # 跳过 npm test/build（快）
#   ./tools/pre-push-check.sh --audit-only  # 只跑审计（最快）
#
# 退出码:
#   0 = 全部通过，可以 push
#   1 = 有检查不通过，先修再推
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
QUICK=false
AUDIT_ONLY=false

# ── 参数解析 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)       QUICK=true; shift ;;
    --audit-only)  AUDIT_ONLY=true; shift ;;
    --help|-h)
      echo "pre-push-check.sh — 推前预检"
      echo "  --quick        跳过 npm test/build"
      echo "  --audit-only   只跑 sofagent-audit + shellcheck"
      echo "  --help         显示帮助"
      exit 0 ;;
    *) shift ;;
  esac
done

echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  sofagent · 推前预检${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo ""

# ── 辅助函数 ──
check_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)) || true; }
check_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)) || true; }
check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((WARN++)) || true; }

run_step() {
  local name="$1" cmd="$2"
  echo -e "\n${BOLD}── ${name} ──${NC}"
  if eval "$cmd" 2>&1; then
    check_pass "${name}"
  else
    check_fail "${name}（退出码 $?）"
  fi
}

# ════════════════════════════════════════
# 1. ShellCheck（对应 shellcheck.yml）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 1. ShellCheck ──${NC}"
if command -v shellcheck &>/dev/null; then
  SHELL_FILES=$(find sofagent/scripts tools FDE -name "*.sh" -not -path "*/node_modules/*" 2>/dev/null)
  SC_FAIL=0
  for f in $SHELL_FILES; do
    if ! shellcheck -s bash -e SC2086 -e SC2155 -e SC2034 -e SC1090 -e SC1091 "$f" >/dev/null 2>&1; then
      echo -e "  ${RED}✗${NC} shellcheck: $f"
      shellcheck -s bash -e SC2086 -e SC2155 -e SC2034 -e SC1090 -e SC1091 "$f" 2>&1 | head -5
      SC_FAIL=$((SC_FAIL + 1))
    fi
  done
  if [ "$SC_FAIL" -eq 0 ]; then
    check_pass "ShellCheck 全部通过（$(echo "$SHELL_FILES" | wc -l | tr -d ' ') 个文件）"
  else
    check_fail "ShellCheck: ${SC_FAIL} 个文件有问题"
  fi
else
  check_warn "shellcheck 未安装——brew install shellcheck"
fi

# ════════════════════════════════════════
# 2. 版本号一致性（check-version.sh）
# ════════════════════════════════════════
if [ "$AUDIT_ONLY" = false ]; then
  echo -e "\n${BOLD}── 2. 版本号一致性 ──${NC}"
  if bash tools/check-version.sh >/dev/null 2>&1; then
    check_pass "check-version.sh 全部通过"
  else
    check_fail "check-version.sh 有不一致"
    bash tools/check-version.sh 2>&1 | grep "❌" | head -10
  fi
fi

# ════════════════════════════════════════
# 3. 文档检查（check-docs.sh）
# ════════════════════════════════════════
if [ "$AUDIT_ONLY" = false ]; then
  echo -e "\n${BOLD}── 3. 文档检查 ──${NC}"
  if bash tools/check-docs.sh >/dev/null 2>&1; then
    check_pass "check-docs.sh 全部通过"
  else
    check_fail "check-docs.sh 有问题"
    bash tools/check-docs.sh 2>&1 | grep "❌\|⚠️" | head -10
  fi
fi

# ════════════════════════════════════════
# 4. 审计引擎构建+测试（对应 verify.yml）
# ════════════════════════════════════════
if [ "$AUDIT_ONLY" = false ] && [ "$QUICK" = false ]; then
  echo -e "\n${BOLD}── 4. 审计引擎构建+测试 ──${NC}"
  echo "  构建中..."
  if (cd sofagent/audit && npm run build >/dev/null 2>&1); then
    check_pass "npm run build"
  else
    check_fail "npm run build 失败"
  fi

  echo "  测试中..."
  if (cd sofagent/audit && npm test >/dev/null 2>&1); then
    check_pass "npm test"
  else
    check_fail "npm test 有失败"
    (cd sofagent/audit && npm test 2>&1 | tail -20)
  fi
fi

# ════════════════════════════════════════
# 5. sofagent-audit（对应 sofagent-audit.yml）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 5. sofagent-audit ──${NC}"
if [ -f sofagent/audit/dist/index.js ]; then
  AUDIT_OUT=$(cd sofagent/audit && npx sofagent-audit --silent --diff HEAD~1..HEAD --ci 2>&1 || true)
  AUDIT_EXIT=$?
  if [ "$AUDIT_EXIT" -eq 0 ]; then
    check_pass "sofagent-audit PASS"
  elif [ "$AUDIT_EXIT" -eq 1 ]; then
    echo "$AUDIT_OUT" | grep "⚠️" | head -5
    check_warn "sofagent-audit WARN（不阻断，但请确认）"
  else
    echo "$AUDIT_OUT" | grep "❌" | head -5
    check_fail "sofagent-audit FAIL（有违规）"
  fi
else
  check_warn "sofagent-audit 未构建（dist/ 不存在），跳过"
fi

# ════════════════════════════════════════
# 总结
# ════════════════════════════════════════
TOTAL=$((PASS + FAIL + WARN))
echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  结果: ${GREEN}${PASS} 通过${NC} / ${YELLOW}${WARN} 警告${NC} / ${RED}${FAIL} 失败${NC}（共 ${TOTAL} 项）"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ 有 ${FAIL} 项失败，先修再推！${NC}"
  echo ""
  echo "  修复后重新跑: ./tools/pre-push-check.sh"
  exit 1
else
  echo -e "  ${GREEN}✅ 可以 push 了！${NC}"
  echo ""
  exit 0
fi
