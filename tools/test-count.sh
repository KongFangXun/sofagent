#!/bin/bash
# ============================================================
# test-count.sh · 汇总 workspace 各包测试数
# ============================================================
# 跑 npm test --workspaces --if-present，汇总各包 Tests 数
# 输出总计（供发版时填 changelog）。
#
# 用法:
#   ./tools/test-count.sh
#
# 退出码:
#   0 = 全部通过（部分包无测试视为正常）
#   1 = 有包测试失败
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# ── 颜色 ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  sofagent · Workspace 测试数汇总${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo ""

# ── 跑 workspace 全量测试并提取各包数字 ──
TOTAL_TESTS=0
TOTAL_PASSED=0
TOTAL_FAILED=0
PKG_COUNT=0
FAILED_PKGS=0

# 用 --if-present 跳过无 test script 的包
while IFS= read -r line; do
  # 匹配 vitest 输出: "Tests  342 passed (342)"  或 "Tests  1 failed | 341 passed (342)"
  if echo "$line" | grep -qE '^Tests\s+'; then
    PKG_NAME=$(echo "$line" | grep -oE 'sofagent/[a-z-]+' | head -1 || echo "?")
    PASSED=$(echo "$line" | grep -oE '[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")
    FAILED=$(echo "$line" | grep -oE '[0-9]+\s+failed' | grep -oE '[0-9]+' || echo "0")
    TOTAL=$(echo "$line" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")
    
    TOTAL_TESTS=$((TOTAL_TESTS + TOTAL))
    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
    PKG_COUNT=$((PKG_COUNT + 1))
    
    if [ "$FAILED" -gt 0 ]; then
      echo -e "  ${RED}✗${NC} ${PKG_NAME}: ${PASSED} passed / ${FAILED} failed (${TOTAL} tests)"
      FAILED_PKGS=$((FAILED_PKGS + 1))
    else
      echo -e "  ${GREEN}✓${NC} ${PKG_NAME}: ${PASSED} passed (${TOTAL} tests)"
    fi
  fi
done < <(npm test --workspaces --if-present 2>&1 || true)

echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  包数: ${PKG_COUNT}  通过: ${GREEN}${TOTAL_PASSED}${NC}  总计: ${BOLD}${TOTAL_TESTS} tests${NC}"

if [ "$TOTAL_FAILED" -gt 0 ]; then
  echo -e "  失败: ${RED}${TOTAL_FAILED}${NC}  失败包数: ${RED}${FAILED_PKGS}${NC}"
fi

echo ""
echo -e "  CHANGELOG 写法: ${GREEN}${TOTAL_TESTS} tests across ${PKG_COUNT} packages（workspace 汇总口径）${NC}"
echo ""

if [ "$TOTAL_FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
