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
# docs/changelog/docs/evidence/SKILL/FDE）。
DEAD_LINKS=0
DEAD_DETAIL=""
EXCLUDE=(-not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/docs/changelog/*" -not -path "*/docs/evidence/*" -not -path "*/SKILL/harness/*" -not -path "*/FDE/*" -not -path "*/docs/archive/*" -not -path "*/commercial/*")
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
        # v1.1.5 起豁免：SOP 文档里的模板占位符 vX.Y / vX.Y.Z 不是真实链接
        *'/vX.Y'*|*'vX.Y.Z'*|*'vX.Y.md'*) continue ;;
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
for file in SKILL/SKILL.md HANDBOOK.md DEVELOPMENT.md; do
  if [ -f "$file" ]; then
    COUNT=$(grep -cE "A1-A14|A1-A11" "$file" 2>/dev/null || echo "0")
    echo "  $file: 过时术语出现 $COUNT 处"
  fi
done

echo ""
echo "=== 3. 版本号同步检查 ==="
VERSION_PKG=$(node -e "console.log(require('./engine/audit/package.json').version)" 2>/dev/null || echo "N/A")
echo "  package.json: $VERSION_PKG"

echo ""
echo "=== 4. 文档分层预算 ==="

# 公共排除条件（所有分层都排除的目录）
COMMON_EXCLUDE='-not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/docs/changelog/*" -not -path "*/docs/evidence/*" -not -path "*/SKILL/harness/*" -not -path "*/FDE/*"'

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
  -not -path "*/SKILL/*" \
  -not -path "*/FDE/*" \
  -not -path "*/LOOP/*" \
  -not -path "*/docs/guides/*" \
  -not -path "*/docs/design/*" \
  -not -path "*/docs/architecture/*" \
  -not -path "*/docs/prd/*" \
  -not -path "*/LOOP/*" \
  -not -path "*/agents/*" \
  -not -path "*/.github/*" \
  -not -path "*/engine/hooks/*" \
  -not -path "*/commercial/*" \
  -not -path "*/docs/DEVELOPMENT.md" \
  -not -path "*/docs/archive/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_A=${LAYER_A:-0}

# B 层：开发者参考（LOOP/ + agents/ + .github/ + hooks/HOOK.md + DEVELOPMENT.md）
LAYER_B=$(find ./LOOP ./agents ./.github ./engine/hooks ./docs/DEVELOPMENT.md \
  -name "*.md" \
  -not -path "*/node_modules/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_B=${LAYER_B:-0}

# C 层：审查体系（LOOP/releaser/，v1.2.0 从 docs/verification/ 迁入）
LAYER_C=$(find ./LOOP/releaser -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_C=${LAYER_C:-0}

# D 层：设计文档（docs/design/ + docs/architecture/ + docs/prd/）
# 注：部分子目录可能暂不存在，find 会报错但 stderr 已抑制；用 `{ ...; } 2>/dev/null || true` 防止 pipefail 传播
LAYER_D=$({ find ./docs/design ./docs/architecture ./docs/prd -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}'; } || true)
LAYER_D=${LAYER_D:-0}

# E 层：运维指南（docs/guides/）
LAYER_E=$(find ./docs/guides -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_E=${LAYER_E:-0}

# 上限定义
LIMIT_A=4700  # v1.1.9: SECURITY.md 按主题重构（F-41）+ LIMITATIONS.md 安全补充（F-17/F-31/F-32）
LIMIT_B=2100  # v1.1.9: DEVELOPMENT.md 新增 USB 运行时代码架构 + DAG Runner + A/B 自动调度器，B 层自然增长 2000→2100
LIMIT_C=6300  # v1.1.3: 审查体系维度固化 + Harness 可见性视角 + releasing.md tag 门禁；内容增长上调 5800→6300 + 5% 余量
LIMIT_D=2000  # v1.1.9: D 层纳入口径修正——docs/architecture（v1.1.9 设计 876 行）+ docs/prd（193 行）从 A 层归入 D 层（工程文档与设计文档同语义），700→2000 容纳
LIMIT_E=1000  # v1.1.3 P0-1: 从 600 上调到 1000，多设备同步指南等 E 层文档扩展导致自然增长
LIMIT_TOTAL=6700  # v1.1.9: SECURITY.md 按主题重构 + 安全文档补充导致 A 层自然增长

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
for f in SKILL/harness/*.md; do
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
for f in SKILL/harness/*.md FDE/SKILL.md LOOP/SKILL.md; do
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
echo "=== 7. 规则数跨文档对照（v1.1.5 审-9 新增）==="
# 比对三个来源的规则数：
#   A. engine/audit/README.md 规则表行数（A 类 + E 类）
#   B. engine/audit/src/rules/index.ts 注册规则数
#   C. 主 README.md 声称的 "N 条规则"
# 三者不一致即告警——避免审-1（A18/A19 漂移）类问题再次出现

# A. audit/README 规则表行数（数 | A* 或 | E* 开头的表行）
AUDIT_README_COUNT=$(grep -cE "^\| (A|E)[0-9]+ " engine/audit/README.md 2>/dev/null || echo "0")
AUDIT_README_COUNT=$(echo "$AUDIT_README_COUNT" | tr -d '[:space:]')

# B. rules/index.ts 注册规则数（数 { name: 'A* 或 'E* 开头的对象）
INDEX_TS_COUNT=$(grep -cE "^\s+\{ name: '(A|E)[0-9]+" engine/audit/src/rules/index.ts 2>/dev/null || echo "0")
INDEX_TS_COUNT=$(echo "$INDEX_TS_COUNT" | tr -d '[:space:]')

# C. 主 README 声称的规则数（从 "21 条规则" 这种措辞提取）
MAIN_README_COUNT=$(grep -oE "[0-9]+ 条规则" README.md 2>/dev/null | head -1 | grep -oE "^[0-9]+" || echo "0")
MAIN_README_COUNT=$(echo "$MAIN_README_COUNT" | tr -d '[:space:]')

echo "  audit/README.md 规则表行数: $AUDIT_README_COUNT"
echo "  rules/index.ts 注册规则数:   $INDEX_TS_COUNT"
echo "  主 README.md 声称规则数:     $MAIN_README_COUNT"

MISMATCH=0
if [ "$AUDIT_README_COUNT" != "$INDEX_TS_COUNT" ]; then
  echo "  ❌ audit/README ($AUDIT_README_COUNT) ≠ index.ts ($INDEX_TS_COUNT)"
  MISMATCH=$((MISMATCH + 1))
fi
if [ "$MAIN_README_COUNT" != "0" ] && [ "$MAIN_README_COUNT" != "$INDEX_TS_COUNT" ]; then
  echo "  ❌ 主 README ($MAIN_README_COUNT) ≠ index.ts ($INDEX_TS_COUNT)"
  MISMATCH=$((MISMATCH + 1))
fi
if [ "$MISMATCH" -eq 0 ]; then
  echo "  ✅ 三者一致"
else
  ERRORS=$((ERRORS + MISMATCH))
fi

echo ""
echo "=== 8. audit/README 规则表 ruleClass 完整性（v1.1.6 回归追加）==="
VALID_CLASSES="业务底线|能力拐杖|工程规范"
MISSING_CLASS=0
while IFS= read -r row; do
  if ! echo "$row" | grep -qE "$VALID_CLASSES"; then
    echo "  ❌ $row （缺少合法 ruleClass）"
    MISSING_CLASS=$((MISSING_CLASS + 1))
  fi
done < <(grep -nE "^\| (A|E)[0-9]+ .* \|" engine/audit/README.md 2>/dev/null)
for cls in 业务底线 能力拐杖 工程规范; do
  if ! grep -q "$cls" engine/audit/README.md; then
    echo "  ❌ audit/README.md 未定义 ruleClass: $cls"
    MISSING_CLASS=$((MISSING_CLASS + 1))
  fi
done
if [ "$MISSING_CLASS" -eq 0 ]; then
  echo "  [OK] 规则表 ruleClass 完整且定义齐全"
else
  ERRORS=$((ERRORS + MISSING_CLASS))
fi

echo ""
echo "=== 9. River 比喻跨文档计数（F-09）==="
# River 比喻词（堤坝/自来水厂/管网）在非 README 文档中应 ≤4 处
# README.md 是锚点，不限制
RIVER_DOCS="docs/ARCHITECTURE.md docs/PHILOSOPHY.md FDE/FDE.md"
RIVER_WARN=0
for doc in $RIVER_DOCS; do
  if [ -f "$doc" ]; then
    RIVER_COUNT=$(grep -c "堤坝\|自来水厂\|管网" "$doc" 2>/dev/null || echo "0")
    if [ "$RIVER_COUNT" -gt 4 ]; then
      echo "  ⚠ $doc River 比喻 ${RIVER_COUNT} 处（建议 ≤4）"
      RIVER_WARN=$((RIVER_WARN + 1))
    else
      echo "  ✓ $doc River 比喻 ${RIVER_COUNT} 处"
    fi
  fi
done
if [ "$RIVER_WARN" -gt 0 ]; then
  echo "  共 ${RIVER_WARN} 个文档超标"
else
  echo "  全部在阈值内"
fi

echo ""
echo "=== 10. SKILL.md 底线/铁律数一致性（F-19）==="
SKILL_FILE="SKILL/SKILL.md"
if [ -f "$SKILL_FILE" ]; then
  # 提取标题声称的底线数
  BOTTOM_CLAIMED=$(grep -oE "### ([0-9]+) 底线" "$SKILL_FILE" | grep -oE "[0-9]+" | head -1)
  # 提取标题声称的铁律数
  IRON_CLAIMED=$(grep -oE "### ([0-9]+) 则铁律" "$SKILL_FILE" | grep -oE "[0-9]+" | head -1)
  # 提取实际底线条数（### N 底线 到下一个 ### 之间的 - 开头行）
  if [ -n "$BOTTOM_CLAIMED" ]; then
    BOTTOM_ACTUAL=$(sed -n "/^### ${BOTTOM_CLAIMED} 底线/,/^### /p" "$SKILL_FILE" | grep -cE "^[0-9]+\. |^- " || echo "0")
  else
    BOTTOM_ACTUAL=0
  fi
  if [ -n "$IRON_CLAIMED" ]; then
    IRON_ACTUAL=$(sed -n "/^### ${IRON_CLAIMED} 则铁律/,/^### /p" "$SKILL_FILE" | grep -cE "^[0-9]+\. |^- " || echo "0")
  else
    IRON_ACTUAL=0
  fi
  echo "  底线: 标题声称 ${BOTTOM_CLAIMED:-N/A} 条，实际 ${BOTTOM_ACTUAL} 条"
  echo "  铁律: 标题声称 ${IRON_CLAIMED:-N/A} 条，实际 ${IRON_ACTUAL} 条"
  if [ "${BOTTOM_CLAIMED:-0}" != "${BOTTOM_ACTUAL}" ] 2>/dev/null; then
    echo "  ❌ 底线数不一致: 标题 ${BOTTOM_CLAIMED} vs 实际 ${BOTTOM_ACTUAL}"
    ERRORS=$((ERRORS + 1))
  fi
  if [ "${IRON_CLAIMED:-0}" != "${IRON_ACTUAL}" ] 2>/dev/null; then
    echo "  ❌ 铁律数不一致: 标题 ${IRON_CLAIMED} vs 实际 ${IRON_ACTUAL}"
    ERRORS=$((ERRORS + 1))
  fi
  if [ "${BOTTOM_CLAIMED:-0}" = "${BOTTOM_ACTUAL}" ] && [ "${IRON_CLAIMED:-0}" = "${IRON_ACTUAL}" ] 2>/dev/null; then
    echo "  ✓ 底线/铁律数一致"
  fi
else
  echo "  ⚠ SKILL.md 不存在: $SKILL_FILE"
fi

echo ""
echo "=== 11. 跨文档 #锚点 死链扫描（F-20，WARN 级）==="
# 扫描 .md 中的跨文档锚点引用 [text](path.md#anchor)，检查目标文件和锚点是否存在
# 排除 archive/changelog/node_modules
ANCHOR_WARN=0
while IFS= read -r -d '' mdfile; do
  in_fence=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*\`\`\` ]] || [[ "$line" =~ ^[[:space:]]*~~~ ]]; then
      in_fence=$((1 - in_fence)); continue
    fi
    [ "$in_fence" -eq 1 ] && continue
    # 提取含 #锚点 的 markdown 链接
    targets=$(printf '%s\n' "$line" | grep -oE '\]\([^)]+\.md#[^)]+\)' | sed -E 's/^\]\(//; s/\)$//' || true)
    for target in $targets; do
      file_part="${target%%#*}"
      anchor_part="${target#*#}"
      [ -z "$file_part" ] && continue
      # 解析相对路径
      resolved="$(dirname "$mdfile")/$file_part"
      resolved="$(cd "$(dirname "$resolved")" >/dev/null 2>&1 && echo "$(pwd)/$(basename "$resolved")" || echo "$resolved")"
      if [ ! -f "$resolved" ]; then
        echo "  ⚠ ${mdfile}: 目标文件不存在 → ${target}"
        ANCHOR_WARN=$((ANCHOR_WARN + 1))
        continue
      fi
      # 粗略检查锚点是否对应标题（GitHub 规则：小写+空格转-+去标点）
      # 提取标题行，转成锚点格式，与 anchor_part 比对
      anchor_lower=$(echo "$anchor_part" | tr '[:upper:]' '[:lower:]')
      found_match=false
      while IFS= read -r heading; do
        # 模拟 GitHub 锚点生成：去 # 前缀 → 小写 → 空格转 - → 删特殊字符
        norm=$(echo "$heading" | sed 's/^#\+ *//' | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]/-/g; s/[，。、（）()【】\[\]：:，,。！？?！]/-/g; s/--*/-/g' | sed 's/^-//;s/-$//')
        if [ "$norm" = "$anchor_lower" ]; then
          found_match=true
          break
        fi
      done < <(grep -E '^#{1,6} ' "$resolved" 2>/dev/null)
      if ! $found_match; then
        echo "  ⚠ ${mdfile}: 锚点可能失效 → ${target}"
        ANCHOR_WARN=$((ANCHOR_WARN + 1))
      fi
    done
  done < "$mdfile"
done < <(find . -name "*.md" "${EXCLUDE[@]}" -print0)
if [ "$ANCHOR_WARN" -eq 0 ]; then
  echo "  ✓ 跨文档锚点无死链"
else
  echo "  共 ${ANCHOR_WARN} 处可能死链（人工确认）"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "发现 ${ERRORS} 个问题"
  exit 1
else
  echo "全部通过"
fi
