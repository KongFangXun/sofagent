#!/bin/bash
# ============================================================
# test-count.sh · 汇总 workspace 各包测试数（SSOT 反查 · 门禁用）
# ============================================================
# 逐包遍历有 test script 的 workspace 包，各自跑测试并提取 Tests 数，
# 汇总总计。失败时退出码 1（供 pre-push-check.sh 门禁拦截）。
#
# 与 check-version.sh / check-docs.sh 同源定位：本脚本是"测试数"这道门禁。
# v1.1.4 修复前 test-count.sh 存在两处缺陷：
#   1. grep '^Tests\s+' 用行首锚定，但 vitest 输出带前导空格 → 永远匹配 0 行
#   2. 包名靠 engine/[a-z-]+ 提取，而 npm workspaces 吞掉包名行 → 永远显示 ?
# 现改为逐包遍历（包名已知），彻底规避解析歧义。
#
# 用法:
#   ./tools/test-count.sh           # 跑全量，汇总 + 退出码
#   ./tools/test-count.sh --quiet   # 只输出机器可读的 TOTAL_TESTS= 行（供检查脚本 grep）
#
# 退出码:
#   0 = 全部通过（部分包无测试视为正常）
#   1 = 有包测试失败
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# ── 参数 ──
QUIET=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "test-count.sh — Workspace 测试数汇总（门禁用）"
      echo "  --quiet   只输出 TOTAL_TESTS= / PASSED= / FAILED= 机器可读行"
      exit 0 ;;
  esac
done

# ── 颜色 ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ── 收集有 test script 的 workspace 包（与 npm test --workspaces --if-present 语义一致）──
# 注意：macOS /bin/bash 是 3.2，无 mapfile 内建，用 command substitution + herestring 兼容写法
PKG_LIST=$(node -e '
  const fs = require("fs"), path = require("path");
  const root = "engine";
  const dirs = [];
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      const pj = path.join(root, d, "package.json");
      if (fs.existsSync(pj)) {
        try {
          const p = JSON.parse(fs.readFileSync(pj, "utf8"));
          if (p.scripts && p.scripts.test) dirs.push(path.join(root, d));
        } catch (e) { /* 跳过非法 JSON */ }
      }
    }
  }
  console.log(dirs.join("\n"));
' 2>/dev/null)

TOTAL_TESTS=0
TOTAL_PASSED=0
TOTAL_FAILED=0
PKG_COUNT=0
FAILED_PKGS=0

if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  sofagent · Workspace 测试数汇总（门禁）${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo ""
fi

while IFS= read -r pkg_dir; do
  [ -z "$pkg_dir" ] && continue
  pkg_name=$(basename "$pkg_dir")
  # 在包目录内跑该包的 test script（通常与 npm test --workspaces 同源）
  out=$(cd "$pkg_dir" && npm test 2>&1) || true
  # 取该包最后的 Tests 汇总行（vitest 每包仅一行 Tests 汇总，无跨包 grand-total）
  # v1.2.3 修复：CI 环境（GitHub Actions）vitest 即使在非 TTY 下也输出 ANSI 颜色码，
  # 行首 \033[2m 导致 ^\s*Tests 永远不匹配。先 strip ANSI 再 grep。
  line=$(echo "$out" | sed $'s/\033\[[0-9;]*m//g' | grep -E '^\s*Tests\s+' | tail -1)
  if [ -z "$line" ]; then
    [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠${NC} ${pkg_name}: 无 Tests 输出（跳过）"
    continue
  fi
  PASSED=$(echo "$line" | grep -oE '[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")
  FAILED=$(echo "$line" | grep -oE '[0-9]+\s+failed' | grep -oE '[0-9]+' || echo "0")
  TOTAL=$(echo "$line" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")

  TOTAL_TESTS=$((TOTAL_TESTS + TOTAL))
  TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
  PKG_COUNT=$((PKG_COUNT + 1))

  if [ "$FAILED" -gt 0 ]; then
    [ "$QUIET" = false ] && echo -e "  ${RED}✗${NC} ${pkg_name}: ${PASSED} passed / ${FAILED} failed (${TOTAL} tests)"
    FAILED_PKGS=$((FAILED_PKGS + 1))
  else
    [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} ${pkg_name}: ${PASSED} passed (${TOTAL} tests)"
  fi
done <<< "$PKG_LIST"

if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "  包数: ${PKG_COUNT}  通过: ${GREEN}${TOTAL_PASSED}${NC}  总计: ${BOLD}${TOTAL_TESTS} tests${NC}"
  if [ "$TOTAL_FAILED" -gt 0 ]; then
    echo -e "  失败: ${RED}${TOTAL_FAILED}${NC}  失败包数: ${RED}${FAILED_PKGS}${NC}"
  fi
  echo ""
  echo -e "  CHANGELOG 写法: ${GREEN}${TOTAL_TESTS} tests across ${PKG_COUNT} packages（workspace 汇总口径）${NC}"
  echo ""
fi

# 机器可读行（供 regression-checklist / 其他脚本 grep）
echo "TOTAL_TESTS=$TOTAL_TESTS PASSED=$TOTAL_PASSED FAILED=$TOTAL_FAILED PKGS=$PKG_COUNT"

if [ "$TOTAL_FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
