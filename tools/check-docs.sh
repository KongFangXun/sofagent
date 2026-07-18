#!/bin/bash
# 文档一致性自动化检查
set -uo pipefail
shopt -s nullglob

cd "$(dirname "$0")/.." || exit 1
ERRORS=0

echo "=== 1. 死链检查 ==="
# 检查所有 .md 中**指向 rules.md 的 markdown 链接**是否死链。
# 注意：仅匹配真正的链接形式 ](...rules.md)，不匹配散文里的 "rules.md" 字样
# （散文描述不计入死链）。通用相对路径死链已由维度 306（第 1b 节）全量扫描覆盖。
RULES_DEAD=$(grep -rnE '\]\([^)]*rules\.md\)' --include="*.md" . 2>/dev/null | grep -v "docs/changelog/" | grep -v "CHANGELOG.md" | grep -v "node_modules" | grep -v ".workbuddy/" | grep -v ".sofagent/" | grep -c "" || true)
RULES_DEAD=${RULES_DEAD:-0}
if [ "$RULES_DEAD" -gt 0 ] 2>/dev/null; then
  echo "  rules.md 死链: ${RULES_DEAD} 处"
  ERRORS=$((ERRORS + 1))
else
  echo "  rules.md 死链: 0"
fi

echo ""
echo "=== 1b. 全仓相对路径死链扫描（维度 306）==="
# 遍历所有 .md，提取 markdown 链接并校验目标文件是否存在。
# 排除项与 section 4 公共排除保持一致（node_modules/.workbuddy/.sofagent/
# docs/changelog/docs/evidence/sofagent/skill/FDE）。
DEAD_LINKS=0
DEAD_DETAIL=""
EXCLUDE=(-not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/docs/changelog/*" -not -path "*/docs/evidence/*" -not -path "*/sofagent/skill/*" -not -path "*/FDE/*" -not -path "*/docs/archive/*")
while IFS= read -r -d '' mdfile; do
  in_fence=0
  while IFS= read -r line; do
    # 围栏代码块（``` 或 ~~~）内不检查链接
    if [[ "$line" =~ ^[[:space:]]*\`\`\` ]] || [[ "$line" =~ ^[[:space:]]*~~~ ]]; then
      in_fence=$((1 - in_fence)); continue
    fi
    if [ "$in_fence" -eq 1 ]; then continue; fi
    # 提取本行所有 markdown 链接目标（](target) 形式）
    targets=$(printf '%s\n' "$line" | grep -oE '\]\(([^)]+)\)' | sed -E 's/^\]\(//; s/\)$//' || true)
    for target in $targets; do
      # 跳过：空、纯锚点、外部协议、mailto
      case "$target" in
        ''|'#'*|'http://'*|'https://'*|'mailto:'*) continue ;;
      esac
      path_part="${target%%#*}"            # 去掉锚点
      [ -z "$path_part" ] && continue
      case "$path_part" in
        *'://'*) continue ;;               # 非 http 的其他协议
        /*) resolved=".${path_part}" ;;    # 仓库根绝对路径（去前导 /）
        *)  resolved="$(dirname "$mdfile")/$path_part" ;;
      esac
      resolved="${resolved%/}"             # 去尾斜杠（目录链接）
      # 规范化到绝对路径（路径逃逸仓库时回退原值）
      resolved="$(cd "$(dirname "$resolved")" >/dev/null 2>&1 && echo "$(pwd)/$(basename "$resolved")" || echo "$resolved")"
      if [ ! -e "$resolved" ]; then
        DEAD_LINKS=$((DEAD_LINKS + 1))
        DEAD_DETAIL="${DEAD_DETAIL}  ${mdfile}: ${target}\n"
      fi
    done
  done < "$mdfile"
done < <(find . -name "*.md" "${EXCLUDE[@]}" -print0)

if [ "$DEAD_LINKS" -gt 0 ]; then
  echo "  全仓相对路径死链: ${DEAD_LINKS} 处"
  printf "%b" "$DEAD_DETAIL"
  ERRORS=$((ERRORS + 1))
else
  echo "  全仓相对路径死链: 0"
fi

echo ""
echo "=== 2. 术语一致性检查 ==="
# 检查三处关键文件的铁律编号
# v1.1.4 起仅 A1-A14 / A1-A11 是过时编号（早期规则数）；
# "4 底线" "7 铁律" 是当前正确结构，不算过时
for file in sofagent/skill/SKILL.md HANDBOOK.md DEVELOPMENT.md; do
  if [ -f "$file" ]; then
    COUNT=$(grep -cE "A1-A14|A1-A11" "$file" 2>/dev/null || echo "0")
    echo "  $file: 过时术语出现 $COUNT 处"
  fi
done

echo ""
echo "=== 3. 版本号同步检查 ==="
VERSION_PKG=$(node -e "console.log(require('./sofagent/audit/package.json').version)" 2>/dev/null || echo "N/A")
echo "  package.json: $VERSION_PKG"

echo ""
echo "=== 4. 文档分层预算 ==="

# 公共排除条件（所有分层都排除的目录）
COMMON_EXCLUDE='-not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/docs/changelog/*" -not -path "*/docs/evidence/*" -not -path "*/sofagent/skill/*" -not -path "*/FDE/*"'

# 计算函数：count_md <find_args>
count_md() {
  find . -name "*.md" "$@" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}'
}

# A 层：用户文档（根目录 *.md + audit/README + mcp/README + hooks/HOOK.md）
# 排除：B/C/D/E 层目录 + 公共排除
LAYER_A=$(find . -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.workbuddy/*" \
  -not -path "*/.sofagent/*" \
  -not -path "*/docs/changelog/*" \
  -not -path "*/docs/evidence/*" \
  -not -path "*/sofagent/skill/*" \
  -not -path "*/FDE/*" \
  -not -path "*/docs/verification/*" \
  -not -path "*/docs/guides/*" \
  -not -path "*/docs/design/*" \
  -not -path "*/LOOP/*" \
  -not -path "*/agents/*" \
  -not -path "*/.github/*" \
  -not -path "*/sofagent/hooks/*" \
  -not -path "*/模板市场/*" \
  -not -path "*/docs/DEVELOPMENT.md" \
  -not -path "*/docs/archive/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}' || echo 0)

# B 层：开发者参考（LOOP/ + agents/ + .github/ + hooks/HOOK.md + DEVELOPMENT.md）
LAYER_B=$(find ./LOOP ./agents ./.github ./sofagent/hooks ./docs/DEVELOPMENT.md \
  -name "*.md" \
  -not -path "*/node_modules/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}' || echo 0)

# C 层：审查体系（docs/verification/）
LAYER_C=$(find ./docs/verification -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}' || echo 0)

# D 层：设计文档（docs/design/）
LAYER_D=$(find ./docs/design -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}' || echo 0)

# E 层：运维指南（docs/guides/）
LAYER_E=$(find ./docs/guides -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}' || echo 0)

# 上限定义
LIMIT_A=4500  # v1.1.0: 五个引擎重构 + ARCHITECTURE 叙事升级 + README 内容增长
LIMIT_B=2000
LIMIT_C=6300  # v1.1.3: 审查体系维度固化 + Harness 可见性视角 + releasing.md tag 门禁；内容增长上调 5800→6300 + 5% 余量
LIMIT_D=700  # v1.1.4: 架构师产出 v1.1.4 系统设计文档（604 行），从 500 上调到 700 容纳架构设计自然增长
LIMIT_E=1000  # v1.1.3 P0-1: 从 600 上调到 1000，多设备同步指南等 E 层文档扩展导致自然增长
LIMIT_TOTAL=6200  # v1.1.0: A 层文档五个引擎重构导致自然增长

# 输出各层
echo "  A 用户文档:     ${LAYER_A} 行 / ${LIMIT_A} 上限"
echo "  B 开发者参考:   ${LAYER_B} 行 / ${LIMIT_B} 上限"
echo "  C 审查体系:     ${LAYER_C} 行 / ${LIMIT_C} 上限"
echo "  D 设计文档:     ${LAYER_D} 行 / ${LIMIT_D} 上限"
echo "  E 运维指南:     ${LAYER_E} 行 / ${LIMIT_E} 上限"
echo "  ─────────────────────────"
AB_TOTAL=$(( ${LAYER_A:-0} + ${LAYER_B:-0} ))
echo "  A+B 合计:       ${AB_TOTAL} 行 / ${LIMIT_TOTAL} 上限"

# 检查各层
check_layer() {
  local name="$1" lines="$2" limit="$3"
  if [ "${lines:-0}" -gt "$limit" ]; then
    echo "  ${name} 超标！${lines} > ${limit}"
    ERRORS=$((ERRORS + 1))
  fi
}

check_layer "A 用户文档" "$LAYER_A" "$LIMIT_A"
check_layer "B 开发者参考" "$LAYER_B" "$LIMIT_B"
check_layer "C 审查体系" "$LAYER_C" "$LIMIT_C"
check_layer "D 设计文档" "$LAYER_D" "$LIMIT_D"
check_layer "E 运维指南" "$LAYER_E" "$LIMIT_E"
check_layer "A+B 合计" "$AB_TOTAL" "$LIMIT_TOTAL"

if [ "$ERRORS" -eq 0 ] || [ $((ERRORS)) -eq 0 ]; then
  echo "  未超标"
fi

echo ""
echo "=== 5. Skill 文件行数检查 ==="
for f in sofagent/skill/*.md; do
  LINES=$(wc -l < "$f" | tr -d ' ')
  STATUS=""
  if [ "$LINES" -gt 100 ]; then
    STATUS="超标"
    ERRORS=$((ERRORS + 1))
  else
    STATUS="OK"
  fi
  echo "    ${STATUS} $(basename "$f"): ${LINES} 行 (上限 100)"
done

echo ""
echo "=== 6. 铁律措辞检查 ==="
IRON_FAIL=0
for f in sofagent/skill/*.md FDE/SKILL.md LOOP/SKILL.md; do
  if [ -f "$f" ]; then
    WEAK=$(grep -n '建议\|应该\|尽量' "$f" 2>/dev/null | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明\|这不是' || true)
    if [ -n "$WEAK" ]; then
      echo "  $(basename "$f") 有弱措辞残留:"
      echo "$WEAK" | sed 's/^/     /'
      IRON_FAIL=$((IRON_FAIL + 1))
    fi
  fi
done
if [ "$IRON_FAIL" -gt 0 ]; then
  echo "  共 ${IRON_FAIL} 个文件有弱措辞残留"
  ERRORS=$((ERRORS + IRON_FAIL))
else
  echo "  全部 Skill 文件铁律措辞合格"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "发现 ${ERRORS} 个问题"
  exit 1
else
  echo "全部通过"
fi
