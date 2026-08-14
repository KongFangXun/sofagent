#!/usr/bin/env bash
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
# 排除项说明：
#   - 本段是"全仓死链扫描"（阻断），排除的是【不产出文档链接的目录】：
#     node_modules/.workbuddy/.sofagent/（非文档）、docs/changelog（历史冻结）、
#     docs/archive + FORGE/archive（归档·冻结历史，改由下方"归档区告警扫描"非阻断覆盖）、commercial（商务）
#   - 🔴 v1.2.5 P0-13/P0-14：docs/evidence 不再排除！此前 evidence/ 的 12 条死链
#     因排除而漏检（假绿根因之一）。evidence/ 是核心证据文档，链接必须纳入检查。
#   - SKILL/harness 排除：harness 模板含运行时动态路径占位（非真实链接）
#   - 🔴 v1.2.4 P4：FDE/ 不再排除！FDE/GUIDE.md + FDE/README.md + FDE/templates/
#     是核心人读文档，链接必须纳入自动检查（此前整目录排除 = 死链盲区）。
#     ⚠️ 注意：section 4 文档预算仍排除 FDE（预算口径，FDE 目录行数单独管理），
#     与本段死链检查的排除解耦——此处只考虑"链接有效性"，不考虑"预算归属"。
DEAD_LINKS=0
DEAD_DETAIL=""
EXCLUDE=(-not -path "*/node_modules/*" -not -path "*/.workbuddy/*" -not -path "*/.sofagent/*" -not -path "*/docs/changelog/*" -not -path "*/SKILL/harness/*" -not -path "*/docs/archive/*" -not -path "*/FORGE/archive/*" -not -path "*/commercial/*")
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

# 归档区告警扫描（非阻断）——docs/archive + FORGE/archive 是冻结历史，链接腐烂不阻断发版，
# 但必须可见。v1.2.5 教训：archive 排除 = 死链盲区（planning 文件指向已删的 ROADMAP 锚点
# CI 永远抓不到）。此处只告警不计 ERRORS，保持归档冻结性的同时消除盲区。
ARCHIVE_DEAD=0
ARCHIVE_DETAIL=""
while IFS= read -r -d '' mdfile; do
  in_fence=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*\`\`\` ]] || [[ "$line" =~ ^[[:space:]]*~~~ ]]; then
      in_fence=$((1 - in_fence)); continue
    fi
    [ "$in_fence" -eq 1 ] && continue
    targets=$(printf '%s\n' "$line" | grep -oE '\]\(([^)]+)\)' | sed -E 's/^\]\(//; s/\)$//' || true)
    for target in $targets; do
      case "$target" in ''|'#'*|'http://'*|'https://'*|'mailto:'*) continue ;; esac
      path_part="${target%%#*}"
      [ -z "$path_part" ] && continue
      case "$path_part" in *'://'*|*'/vX.Y'*|*'vX.Y.Z'*|*'vX.Y.md'*) continue ;;
        /*) resolved=".${path_part}" ;; *) resolved="$(dirname "$mdfile")/$path_part" ;; esac
      resolved="${resolved%/}"
      resolved="$(cd "$(dirname "$resolved")" >/dev/null 2>&1 && echo "$(pwd)/$(basename "$resolved")" || echo "$resolved")"
      if [ ! -e "$resolved" ]; then
        ARCHIVE_DEAD=$((ARCHIVE_DEAD + 1))
        ARCHIVE_DETAIL="${ARCHIVE_DETAIL}  ${mdfile}: ${target}\n"
      fi
    done
  done < "$mdfile"
done < <(find docs/archive FORGE/archive -name "*.md" -print0 2>/dev/null)
if [ "$ARCHIVE_DEAD" -gt 0 ]; then
  echo "  ⚠ 归档区死链: ${ARCHIVE_DEAD} 处（冻结历史，不阻断发版，仅供参考）"
else
  echo "  归档区死链: 0"
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

# 公共排除条件（所有分层都排除的目录，手动展开到各层 find 命令）
# ⚠️ P0-13 排除理由（明确化，非静默漏洞）：
#   - docs/changelog + docs/archive + docs/evidence：历史冻结文档（发版后不再改），
#     预算约束的是「当前维护中的活文档」体量——历史文档只增不减，纳入预算会让
#     预算随版本累积线性爆炸，失去约束意义。archive/changelog 的体量由
#     releasing.md 阶段五的归档瘦身流程单独管理。
#   - SKILL/harness：模板目录，行数在 section 5 单独预算。
#   - FDE：独立产品目录，行数由 FDE 侧单独管理。
# shellcheck disable=SC2034  # 变量供文档参考，实际展开在各 LAYER find 命令中
COMMON_EXCLUDE='node_modules .workbuddy .sofagent docs/changelog docs/evidence SKILL/harness FDE'

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
  -not -path "*/FORGE/*" \
  -not -path "*/docs/guides/*" \
  -not -path "*/docs/architecture/*" \
  -not -path "*/docs/prd/*" \
  -not -path "*/FORGE/*" \
  -not -path "*/agents/*" \
  -not -path "*/.github/*" \
  -not -path "*/engine/hooks/*" \
  -not -path "*/commercial/*" \
  -not -path "*/docs/DEVELOPMENT.md" \
  -not -path "*/docs/archive/*" \
  -not -path "*/data/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_A=${LAYER_A:-0}

# B 层：开发者参考（FORGE/ + agents/ + .github/ + hooks/HOOK.md + DEVELOPMENT.md）
# v1.2.1: 排除 fresh-eyes runs/ 运行时产物（check/findings/result.md 是审查轮输出，
# 已被 .gitignore 忽略，不是开发者参考文档——不计入文档预算）
# v1.2.1: 排除 data/forge-runs/（同属审查轮运行时产物，数据重构后从 .sofagent/ 迁来）
LAYER_B=$(find ./FORGE ./agents ./.github ./engine/hooks ./docs/DEVELOPMENT.md \
  -name "*.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/fresh-eyes-loop/runs/*" \
  -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_B=${LAYER_B:-0}

# C 层：审查体系（FORGE/playbook/，原 FORGE/releaser/ 已拆散）
LAYER_C=$(find ./FORGE/SKILL/fresh-eyes-loop/specs -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_C=${LAYER_C:-0}

# D 层：设计文档（docs/architecture/ + docs/prd/）
# 注：部分子目录可能暂不存在，find 会报错但 stderr 已抑制；用 `{ ...; } 2>/dev/null || true` 防止 pipefail 传播
LAYER_D=$({ find ./docs/architecture ./docs/prd -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}'; } || true)
LAYER_D=${LAYER_D:-0}

# E 层：运维指南（docs/guides/）
LAYER_E=$(find ./docs/guides -name "*.md" -print0 2>/dev/null | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1+0}')
LAYER_E=${LAYER_E:-0}

# 上限定义
LIMIT_A=6400  # v1.2.8: A 层 6379 行（v1.2.8 开发日志 + 功能描述自然增长），上调 6300→6400 留余量
LIMIT_B=8800  # v1.3.4: B 层 8703 行（发版收尾+stash 恢复竞品段+审查体系优化），上调 8500→8800 留余量
LIMIT_C=6300  # v1.1.3: 审查体系维度固化 + Harness 可见性视角 + releasing.md tag 门禁；内容增长上调 5800→6300 + 5% 余量
LIMIT_D=2000  # v1.1.9: D 层纳入口径修正——docs/architecture（v1.1.9 设计 876 行）+ docs/prd（193 行）从 A 层归入 D 层（工程文档与设计文档同语义），700→2000 容纳
LIMIT_E=3100  # v1.2.5: E 层 2905 行（新增 dashboard-html-dev.md 219 行 + enterprise-deploy 扩展），上调 2700→3100 留余量
LIMIT_TOTAL=15200  # v1.3.4: 随 LIMIT_B 8500→8800 同步上调（A+B=6400+8800）

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
  if [ "$LINES" -gt 200 ]; then
    STATUS="超标"
    ERRORS=$((ERRORS + 1))
  else
    STATUS="OK"
  fi
  echo "    ${STATUS} $(basename "$f"): ${LINES} 行 (上限 200)"
done
# v1.2.4 P4: 子 Skill 包 80-120 行/个
for f in SKILL/skills/*.md; do
  [ -f "$f" ] || continue
  LINES=$(wc -l < "$f" | tr -d ' ')
  STATUS=""
  if [ "$LINES" -lt 80 ] || [ "$LINES" -gt 120 ]; then
    STATUS="超标"
    ERRORS=$((ERRORS + 1))
  else
    STATUS="OK"
  fi
  echo "    ${STATUS} $(basename "$f"): ${LINES} 行 (预算 80-120)"
done

echo ""
echo "=== 6. 铁律措辞检查 ==="
IRON_FAIL=0
for f in SKILL/harness/*.md SKILL/skills/*.md; do
  if [ -f "$f" ]; then
    WEAK=$(grep -n '建议\|应该\|尽量' "$f" 2>/dev/null | grep -v 'not_when\|Gotcha\|场景\|如果\|注\|说明\|这不是\|给用户看\|咨询式\|FDE Agent\|人工确认\|用户拍板\|展示推导\|辅助\|LLM' || true)
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
# 用 node 替代 grep（BSD grep 对多字节 UTF-8 中文 .md 有二进制误判 bug）
AUDIT_README_COUNT=$(node -e '
const s = require("fs").readFileSync("engine/audit/README.md", "utf8");
console.log(s.split("\n").filter(l => /^\| (A|E)[0-9]+ /.test(l)).length);
' 2>/dev/null || echo "0")
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
# 注意：macOS BSD grep 对含多字节 UTF-8 中文的 .md 文件有二进制误判 bug
# （file 命令报 data，grep 输出 "Binary file matches"），改用 node 做文本检查
MISSING_CLASS=$(node -e '
const fs = require("fs");
const content = fs.readFileSync("engine/audit/README.md", "utf8");
const lines = content.split("\n");
const classes = ["业务底线", "能力拐杖", "工程规范"];
let errs = 0;

// A. 每个规则表行必须含合法 ruleClass
for (const line of lines) {
  if (/^\| (A|E)[0-9]+ .+ \|/.test(line)) {
    const hasClass = classes.some(c => line.includes(c));
    if (!hasClass) {
      console.log("  ❌ " + line.trim() + " （缺少合法 ruleClass）");
      errs++;
    }
  }
}

// B. 三个 ruleClass 关键词必须都在文件里定义过
for (const cls of classes) {
  if (!content.includes(cls)) {
    console.log("  ❌ audit/README.md 未定义 ruleClass: " + cls);
    errs++;
  }
}
console.log(errs === 0 ? "  [OK] 规则表 ruleClass 完整且定义齐全" : "");
process.exit(errs > 0 ? 1 : 0);
' 2>&1)
NODE_RC=$?
echo "$MISSING_CLASS"
if [ "$NODE_RC" -ne 0 ]; then
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=== 9. River 比喻跨文档计数（F-09）==="
# River 比喻词（堤坝/自来水厂/管网）在非 README 文档中应 ≤4 处
# README.md 是锚点，不限制
RIVER_DOCS="docs/ARCHITECTURE.md docs/PHILOSOPHY.md docs/VALIDATION.md FDE/GUIDE.md"
RIVER_WARN=0
for doc in $RIVER_DOCS; do
  if [ -f "$doc" ]; then
    # 🔴 v1.2.5 修复整数比较 bug：grep -c 无匹配时输出 "0" 且退出码 1，
    #    原 `|| echo "0"` 会再补一个 "0" 使 RIVER_COUNT="0\n0"，
    #    导致下方 `[ -gt ]` 报 "integer expression expected"。
    #    改用 `|| true`（只稳退出码、不追加输出）+ 默认值兜底文件不可读(exit 2)的空值。
    RIVER_COUNT=$(grep -c "堤坝\|自来水厂\|管网" "$doc" 2>/dev/null || true)
    RIVER_COUNT=${RIVER_COUNT:-0}
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
echo "=== 11. 跨文档 #锚点 死链扫描（F-20 · P0-13 起纳入 ERRORS）==="
# 扫描 .md 中的跨文档锚点引用 [text](path.md#anchor)，检查目标文件和锚点是否存在
# P0-13: 锚点告警不再只是 echo——纳入 ERRORS 计数（假绿根因之一：告警不阻断）。
# 算法按 GitHub sanitize_anchor_name 修正（此前 [-\s]+ 折叠连字符 + 保留 emoji 导致
# 11 条 100% 误报）：\p{Word}=字母/数字/下划线；保留空格/连字符；其余删除（含 emoji）；
# 空格转连字符（不折叠已有连字符）。
# v1.3.4：WorkBuddy 环境降级——shim 拦截嵌套 read 循环导致本项超时（维度 101 同款环境问题）。
#   锚点死链检查由 tools/check-anchors.mjs（node 版，pre-push 第 4 步独立跑）全覆盖——
#   本项是 bash 逐行重复实现。CI（非 shim 环境）跑完整版；本地设 SKIP_ANCHOR_SCAN=1 跳过。
if [ "${SKIP_ANCHOR_SCAN:-0}" = "1" ]; then
  echo "  ⏭️ 跳过（SKIP_ANCHOR_SCAN=1）——锚点检查由 check-anchors.mjs 覆盖（pre-push 第 4 步）"
else
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
        echo "  ❌ ${mdfile}: 目标文件不存在 → ${target}"
        ANCHOR_WARN=$((ANCHOR_WARN + 1))
        continue
      fi
      # 用同一算法归一化链接锚点与标题锚点后比对（GitHub sanitize_anchor_name 语义）
      anchor_norm=$(printf '%s' "$anchor_part" | node -e '
let s = require("fs").readFileSync(0, "utf8").replace(/\n$/, "").trim().toLowerCase();
s = s.replace(/[^\p{L}\p{N}_\s-]/gu, "");
s = s.trim();
s = s.replace(/\t/g, " ");
s = s.replace(/ /g, "-");
console.log(s);')
      found_match=false
      while IFS= read -r heading; do
        norm=$(printf '%s' "$heading" | node -e '
let h = require("fs").readFileSync(0, "utf8").replace(/\n$/, "");
let a = h.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
a = a.replace(/[^\p{L}\p{N}_\s-]/gu, "");
a = a.trim();
a = a.replace(/\t/g, " ");
a = a.replace(/ /g, "-");
console.log(a);')
        if [ "$norm" = "$anchor_norm" ]; then
          found_match=true
          break
        fi
      done < <(grep -E '^#{1,6} ' "$resolved" 2>/dev/null)
      if ! $found_match; then
        echo "  ⚠ ${mdfile}: 锚点失效 → ${target}"
        ANCHOR_WARN=$((ANCHOR_WARN + 1))
      fi
    done
  done < "$mdfile"
done < <(find . -name "*.md" "${EXCLUDE[@]}" -print0)
if [ "$ANCHOR_WARN" -eq 0 ]; then
  echo "  ✓ 跨文档锚点无死链"
else
  echo "  共 ${ANCHOR_WARN} 处锚点死链（已计入 ERRORS）"
  ERRORS=$((ERRORS + ANCHOR_WARN))
fi
fi  # SKIP_ANCHOR_SCAN 降级块结束

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "发现 ${ERRORS} 个问题"
  exit 1
else
  echo "全部通过"
fi
