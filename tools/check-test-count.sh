#!/bin/bash
# ============================================================
# check-test-count.sh · 文档声称测试数 vs 实际测试数一致性校验
# ============================================================
# P1-3 根治：文档硬编码测试数必然漂移（每次新增/删除测试用例
# 都得手动改 CHANGELOG/ROADMAP/LIMITATIONS/evidence.md）。
# 本脚本自动校验——跑 test-count.sh 拿 SSOT 真值，再 grep
# 各文档当前版本声称的数字，不匹配就 exit 1。
#
# 用法:
#   ./tools/check-test-count.sh           # 人读输出
#   ./tools/check-test-count.sh --quiet   # 只输出 OK/FAIL
#
# 退出码:
#   0 = 文档声称数全部与实际一致
#   1 = 有文档漂移（会列出具体文件+行号+声称值 vs 实际值）
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

QUIET=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "check-test-count.sh — 文档声称测试数 vs 实际一致性校验"
      echo "  --quiet   只输出 OK / FAIL"
      echo "  --help    显示帮助"
      exit 0 ;;
  esac
done

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0

# ── 跑 test-count.sh 拿 SSOT 真值 ──
if [ "$QUIET" = false ]; then
  echo -e "\n${BOLD}── 文档测试数一致性校验 ──${NC}"
  echo "  跑 test-count.sh 获取实际测试数..."
fi

TC_OUT=$(bash tools/test-count.sh --quiet 2>/dev/null)
TOTAL_TESTS=$(echo "$TC_OUT" | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+')
PKGS=$(echo "$TC_OUT" | grep -oE 'PKGS=[0-9]+' | grep -oE '[0-9]+')

if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  echo -e "  ${RED}✗ 无法获取实际测试数（test-count.sh 失败）${NC}"
  exit 1
fi

# audit 包单独数（从 test-count.sh 全量输出提取，--quiet 没有逐包明细，用 npm test 取）
AUDIT_OUT=$(cd sofagent/audit && npm test 2>&1 || true)
AUDIT_TESTS=$(echo "$AUDIT_OUT" | grep -E '^\s*Tests\s+' | tail -1 | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")

if [ "$QUIET" = false ]; then
  echo -e "  实际值：workspace ${TOTAL_TESTS} / audit ${AUDIT_TESTS}"
fi

# ── 校验各文档声称的当前版本测试数 ──
# 策略：grep 文档中 v1.1.7 段（最新已发布版）声称的测试数，与实际值比对。
# CHANGELOG.md: "**质量验证**：NNN tests" 格式（最新版本段）
# ROADMAP.md: "质量验证：NNN tests" 格式
# LIMITATIONS.md: "审计核心 NNN 个、全 workspace NNN 个" 格式
# evidence.md: "v1.1.7 为 NNN" 格式（历史快照最后一列）

check_doc() {
  local label="$1" file="$2" pattern="$3" expected="$4"
  local actual
  actual=$(grep -oE "$pattern" "$file" 2>/dev/null | head -1 | grep -oE '[0-9]+' || echo "")
  if [ -z "$actual" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ ${label}：未找到测试数声明（grep 模式未命中），跳过${NC}"
    fi
    return 0
  fi
  if [ "$actual" = "$expected" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ ${label}：${actual}${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ ${label}：声称 ${actual}，实际 ${expected}${NC}"
    echo -e "    文件：${file}"
    ((FAIL++)) || true
  fi
}

# CHANGELOG.md — 最新版本段的质量验证行
# 格式："**质量验证**：781 tests across 12 packages"（取第一条，即最新版本）
CHANGELOG_LINE=$(grep -nE '\*\*质量验证\*\*：[0-9]+ tests' CHANGELOG.md | head -1)
if [ -n "$CHANGELOG_LINE" ]; then
  CHANGELOG_CLAIMED=$(echo "$CHANGELOG_LINE" | grep -oE '[0-9]+ tests' | head -1 | grep -oE '[0-9]+')
  CHANGELOG_LINENO=$(echo "$CHANGELOG_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 CHANGELOG.md（行 ${CHANGELOG_LINENO}）..."
  fi
  if [ "$CHANGELOG_CLAIMED" = "$TOTAL_TESTS" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ CHANGELOG.md：${CHANGELOG_CLAIMED}${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ CHANGELOG.md（行 ${CHANGELOG_LINENO}）：声称 ${CHANGELOG_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
    ((FAIL++)) || true
  fi
fi

# ROADMAP.md — "质量验证：NNN tests" 格式（最新版本段）
ROADMAP_LINE=$(grep -nE '质量验证：[0-9]+ tests' ROADMAP.md | head -1)
if [ -n "$ROADMAP_LINE" ]; then
  ROADMAP_CLAIMED=$(echo "$ROADMAP_LINE" | grep -oE '[0-9]+ tests' | head -1 | grep -oE '[0-9]+')
  ROADMAP_LINENO=$(echo "$ROADMAP_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 ROADMAP.md（行 ${ROADMAP_LINENO}）..."
  fi
  if [ "$ROADMAP_CLAIMED" = "$TOTAL_TESTS" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ ROADMAP.md：${ROADMAP_CLAIMED}${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ ROADMAP.md（行 ${ROADMAP_LINENO}）：声称 ${ROADMAP_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
    ((FAIL++)) || true
  fi
fi

# LIMITATIONS.md — "审计核心 NNN 个、全 workspace NNN 个" 格式
LIMITATIONS_LINE=$(grep -nE '审计核心 [0-9]+ 个、全 workspace [0-9]+ 个' LIMITATIONS.md | head -1)
if [ -n "$LIMITATIONS_LINE" ]; then
  LIMITATIONS_AUDIT=$(echo "$LIMITATIONS_LINE" | grep -oE '审计核心 [0-9]+' | grep -oE '[0-9]+')
  LIMITATIONS_TOTAL=$(echo "$LIMITATIONS_LINE" | grep -oE '全 workspace [0-9]+' | grep -oE '[0-9]+')
  LIMITATIONS_LINENO=$(echo "$LIMITATIONS_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）..."
  fi
  local_fail=0
  if [ "$LIMITATIONS_AUDIT" != "$AUDIT_TESTS" ]; then
    echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）：audit 声称 ${LIMITATIONS_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$LIMITATIONS_TOTAL" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）：workspace 声称 ${LIMITATIONS_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ LIMITATIONS.md：audit ${LIMITATIONS_AUDIT} / workspace ${LIMITATIONS_TOTAL}${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
fi

# evidence.md — 历史快照最后一列（最新版本）"vX.Y.Z 为 NNN（audit 包）" + "全 workspace ... vX.Y.Z 为 NNN"
# evidence.md 是历史时间线，只校验最后一个版本（当前版本）的声称值
EVIDENCE_AUDIT=$(grep -oE 'v1\.1\.[0-9]+ 为 [0-9]+（audit 包）' docs/evidence/evidence.md | tail -1 | grep -oE '[0-9]+（audit' | grep -oE '[0-9]+' || echo "")
EVIDENCE_TOTAL=$(grep -oE '全 workspace.*v1\.1\.[0-9]+ 为 [0-9]+' docs/evidence/evidence.md | tail -1 | grep -oE '为 [0-9]+$' | grep -oE '[0-9]+' || echo "")
if [ -n "$EVIDENCE_AUDIT" ] && [ -n "$EVIDENCE_TOTAL" ]; then
  if [ "$QUIET" = false ]; then
    echo -e "  校验 docs/evidence/evidence.md..."
  fi
  local_fail=0
  if [ "$EVIDENCE_AUDIT" != "$AUDIT_TESTS" ]; then
    echo -e "  ${RED}✗ evidence.md：最新快照 audit ${EVIDENCE_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$EVIDENCE_TOTAL" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ evidence.md：最新快照 workspace ${EVIDENCE_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ evidence.md：audit ${EVIDENCE_AUDIT} / workspace ${EVIDENCE_TOTAL}${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
fi

# ── 结果汇总 ──
if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════${NC}"
fi

if [ "$FAIL" -gt 0 ]; then
  if [ "$QUIET" = true ]; then
    echo "FAIL"
  else
    echo -e "  ${RED}✗ ${FAIL} 处文档测试数漂移${NC}"
    echo -e "  ${YELLOW}修法：跑 bash tools/test-count.sh 拿实际数，手动更新上述文件的声称值${NC}"
    echo -e "  ${YELLOW}或更好：让文档引用 tools/test-count.sh 动态值，不硬编码${NC}"
  fi
  exit 1
else
  if [ "$QUIET" = true ]; then
    echo "OK"
  else
    echo -e "  ${GREEN}✓ 文档测试数全部一致（${PASS} 处校验通过）${NC}"
  fi
  exit 0
fi
