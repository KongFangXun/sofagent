#!/bin/bash
# 文档一致性自动化检查
set -euo pipefail
shopt -s nullglob

cd "$(dirname "$0")/.." || exit 1
ERRORS=0

echo "=== 1. 死链检查 ==="
# 检查所有 .md 中的 rules.md 死链（不检查 changelog 历史、workbuddy 记忆、sofagent 运行时数据）
RULES_DEAD=$(grep -rn "rules\.md" --include="*.md" . 2>/dev/null | grep -v "docs/changelog/" | grep -v "CHANGELOG.md" | grep -v "node_modules" | grep -v ".workbuddy/" | grep -v ".sofagent/" | grep -c "" || true)
RULES_DEAD=${RULES_DEAD:-0}
if [ "$RULES_DEAD" -gt 0 ] 2>/dev/null; then
  echo "❌ rules.md 死链: ${RULES_DEAD} 处"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ rules.md 死链: 0"
fi

echo ""
echo "=== 2. 术语一致性检查 ==="
# 检查三处关键文件的铁律编号
for file in sofagent/skill/SKILL.md HANDBOOK.md DEVELOPMENT.md; do
  if [ -f "$file" ]; then
    COUNT=$(grep -c "4 底线\|7 铁律\|A1-A14\|A1-A11" "$file" 2>/dev/null || echo "0")
    echo "  $file: 术语出现 $COUNT 处"
  fi
done

echo ""
echo "=== 3. 版本号同步检查 ==="
VERSION_PKG=$(node -e "console.log(require('./sofagent/audit/package.json').version)" 2>/dev/null || echo "N/A")
echo "  package.json: $VERSION_PKG"

echo ""
echo "=== 4. 文档总量预算 ==="
TOTAL=$(find . -name "*.md" -not -path "*/changelog/*" -not -path "*/evidence/*" -not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/skill/*" -not -path "*/FDE/*" -not -path "*/design/*" -print0 | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1}')
echo "  核心文档总量: ${TOTAL} 行 (硬上限 5000)"
if [ "${TOTAL:-0}" -gt 5000 ]; then
  echo "  ⚠️ 超标！需要删减旧文档"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✅ 未超标"
fi

echo ""
echo "=== 5. Skill 文件行数检查 ==="
for f in sofagent/skill/*.md; do
  LINES=$(wc -l < "$f" | tr -d ' ')
  STATUS="✅"
  if [ "$LINES" -gt 90 ]; then
    STATUS="❌ 超标"
    ERRORS=$((ERRORS + 1))
  fi
  echo "  $STATUS $(basename "$f"): ${LINES} 行 (上限 90)"
done

echo ""
echo "=== 6. 铁律措辞检查 ==="
IRON_FAIL=0
for f in sofagent/skill/*.md FDE/SKILL.md; do
  if [ -f "$f" ]; then
    WEAK=$(grep -n '建议\|应该\|尽量' "$f" 2>/dev/null | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明\|这不是' || true)
    if [ -n "$WEAK" ]; then
      echo "  ❌ $(basename "$f") 有弱措辞残留:"
      echo "$WEAK" | sed 's/^/     /'
      IRON_FAIL=$((IRON_FAIL + 1))
    fi
  fi
done
if [ "$IRON_FAIL" -gt 0 ]; then
  echo "  ❌ 共 ${IRON_FAIL} 个文件有弱措辞残留"
  ERRORS=$((ERRORS + IRON_FAIL))
else
  echo "  ✅ 全部 Skill 文件铁律措辞合格"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ 发现 ${ERRORS} 个问题"
  exit 1
else
  echo "✅ 全部通过"
fi
