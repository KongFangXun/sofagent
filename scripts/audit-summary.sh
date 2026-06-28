#!/bin/bash
# sofagent audit-summary.sh
# 用法（在仓库根目录）：./scripts/audit-summary.sh [commit-count]
# 输出最近 N 次 commit 的审计结果汇总

COUNT="${1:-20}"
echo "=== sofagent 审计汇总（最近 ${COUNT} 次 commit）==="
echo ""

TOTAL=0
PASS=0
WARN=0
FAIL=0

# tac 在 macOS 不可用，用 tail -r 替代（兼容 macOS/Linux）
COMMITS=$(git log --oneline -${COUNT} | awk '{print $1}' | tail -r)

for COMMIT in $COMMITS; do
  PARENT=$(git rev-parse ${COMMIT}^ 2>/dev/null) || continue
  TOTAL=$((TOTAL + 1))

  RESULT=$(node sofagent/audit/dist/index.js --diff ${PARENT}..${COMMIT} --silent --ci 2>&1)
  EXIT_CODE=$?

  MSG=$(git log -1 --format='%s' ${COMMIT})

  case $EXIT_CODE in
    0) PASS=$((PASS + 1)); ICON="✅";;
    1) WARN=$((WARN + 1)); ICON="⚠️ ";;
    2) FAIL=$((FAIL + 1)); ICON="❌";;
  esac

  echo "${ICON} ${COMMIT:0:7} ${MSG}"
done

echo ""
echo "=== 汇总：${TOTAL} 次 commit / ✅ ${PASS} PASS / ⚠️  ${WARN} WARN / ❌ ${FAIL} FAIL ==="

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "❌ 有 ${FAIL} 次违规 commit，建议检查。"
fi
