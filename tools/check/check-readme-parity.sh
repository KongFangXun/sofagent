#!/usr/bin/env bash
# ============================================================
# check-readme-parity.sh · 双语 README 结构对账（中英对称门禁）
# ============================================================
# 门禁目的：仓库有中英双语 README（README.md / README.en.md）。此前中英对称
#   只有一条人工 grep 兜着（playbook/regression-checklist.md 子项 j：
#   只比「双语版本段的版本号」），没有任何自动门禁——改一侧忘同步另一侧，
#   不会被任何检查拦住。本脚本把它升级为可执行断言。
#
# 🔴 设计原则：只比对【结构】，不比对【文本】。
#   中英标题本来就不可能逐字相同（「这是什么」≠「What is this」），
#   比对文本必然误报。故四项检查全部落在可比的结构量上：
#
#   ① 二级标题（`## `）数对称
#   ② 标题层级序列一致（把行首 `#+` 抽成序列 diff，位置对位置）
#   ③ shields.io badge 数一致
#   ④ 关键数字集合一致（版本号 + 3~4 位整数，逐项取集合后比对）
#
# ④ 的口径说明（刻意的窄化，用来消灭假红）：
#   - 只抽「纯数字与版本号集合」，**不比对句子**——中英同一指标词形不同
#     （`25 条规则` vs `25 rules`、`95 个 tool` vs `95 tools`），
#     若按「数字 + 单位词」提取会立刻误报：实测 CN 侧有 `17 条/20 条/9 款`，
#     EN 侧根本没有对应词形，两侧集合天然不等。
#   - 数字先 `[0-9]+` 整段取出、再按长度筛 3~4 位，而不是 `[0-9]{3,4}` 直接
#     grep：后者会在长数字串里切出子串（实测 `13312` 被切成 `1331`），口径脏。
#   - 刻意**不收 1~2 位数**：2 位数里混着 URL 片段 / Markdown 锚点 / 百分比
#     一类噪音（实测 EN 独有 80/83/86/87/88/89/92/99，CN 独有 06），
#     收进来就是误报源。代价：`95 个 tool`、`25 条规则` 这类 2 位数不在本项
#     覆盖内——它们由 check-docs.sh §17（工具数）/ §规则数专项对账覆盖。
#
# 与既有守卫的关系（不重复造轮子）：
#   - regression-checklist 子项 j 只比版本段版本号；本脚本比全量结构。
#   - check-docs.sh §17 比的是 API.md × tool-registry.ts，与双语对称无关。
#
# ⚠️ 假阳性纪律（对齐 check-literals.sh）：宁缺毋滥。误报就收窄模式，
#   🔴 绝不为了转绿而删 README 里的内容——真实漂移要报告，不要掩埋。
#
# 用法：bash tools/check/check-readme-parity.sh
# 退出码：0 = 四项全对称 / 1 = 有不对称或口径失效
# ============================================================

set -uo pipefail

_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

cd "$(dirname "$0")/../.." || exit 1

# 英文版文件名以实测为准：仓库里就是 README.en.md（ls README*.md 实测）。
CN_README="README.md"
EN_README="README.en.md"

FAILS=0
# 覆盖度计数器（v1.4.9 G-2② · 口径见 tools/check/lib/coverage-line.sh）
#   ASSERTS = 结果行数（✓ + ❌，逐 echo 插桩）· SKIPS = 显式跳过项（本脚本无跳过分支）
ASSERTS=0
SKIPS=0

# 临时文件先一次性开好再挂 trap：避免第二个 trap 覆盖第一个时留下未覆盖的窗口。
CN_LV=$(mktemp)
EN_LV=$(mktemp)
CN_NUMS_FILE=$(mktemp)
EN_NUMS_FILE=$(mktemp)
trap 'rm -f "$CN_LV" "$EN_LV" "$CN_NUMS_FILE" "$EN_NUMS_FILE"' EXIT

echo "🔍 双语 README 结构对账（${CN_README} × ${EN_README}）"
echo "════════════════════════════════════════════════════════════"

# ── 前置：两文件必须在。缺一即口径失效，直接红——不放静默假绿 ──
if [ ! -f "$CN_README" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 中文 README 不存在：${CN_README}——脚本口径可能过期"
  exit 1
fi
if [ ! -f "$EN_README" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ 英文 README 不存在：${EN_README}——若已改名，请同步本脚本的 EN_README"
  exit 1
fi
echo "  对账文件：${CN_README}（中文）× ${EN_README}（英文）"
echo ""

# ── ① 二级标题数对称（口径 = 全部 `## ` 二级标题）──
# 注：本项是 ② 在 h2 切片上的「人可读摘要」（② 位置对位置，严格更强）；
#     保留 ① 是为了失败时能立刻报出一个直观数字。
# grep -c 零匹配时返回码为 1 且自行输出 0——故用 `|| true` 兜码、`${VAR:-0}` 兜值，
# 绝不用 `|| echo 0`（那会输出 "0\n0" 双零，后续整数比较静默失效）。
CN_H2=$(grep -cE '^## ' "$CN_README" || true)
EN_H2=$(grep -cE '^## ' "$EN_README" || true)
CN_H2=${CN_H2:-0}
EN_H2=${EN_H2:-0}
if [ "$CN_H2" -eq "$EN_H2" ] && [ "$CN_H2" -gt 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [①二级标题数] 中 ${CN_H2} = 英 ${EN_H2}"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [①二级标题数] 中 ${CN_H2} ≠ 英 ${EN_H2}——一侧加了/删了章节，另一侧未同步"
  FAILS=$((FAILS + 1))
fi

# ── ② 标题层级序列一致（位置对位置；同一位置层级必须相同）──
grep -oE '^#+' "$CN_README" > "$CN_LV" || true
grep -oE '^#+' "$EN_README" > "$EN_LV" || true
CN_LV_N=$(wc -l < "$CN_LV" | tr -d ' ')
EN_LV_N=$(wc -l < "$EN_LV" | tr -d ' ')
if [ "$CN_LV_N" -eq 0 ] || [ "$EN_LV_N" -eq 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [②标题层级序列] 提取为空（中 ${CN_LV_N} / 英 ${EN_LV_N}）——正则或文件口径失效"
  FAILS=$((FAILS + 1))
elif diff -q "$CN_LV" "$EN_LV" >/dev/null 2>&1; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [②标题层级序列] 逐位置一致（共 ${CN_LV_N} 个标题：$(tr '\n' ' ' < "$CN_LV" | sed 's/ $//')）"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [②标题层级序列] 中英标题层级序列不一致——层级升降位置不同（漏加/多加标题，或标题层级写错）"
  # 只看前若干行差异，避免巨量噪声；diff 返回 1 属预期，不设 set -e
  diff "$CN_LV" "$EN_LV" 2>/dev/null | head -20 | sed 's/^/       /' || true
  echo "       （左=中文，右=英文；< 为中文侧独有，> 为英文侧独有）"
  FAILS=$((FAILS + 1))
fi

# ── ③ badge 数一致（顶部徽章 = shields.io 徽章）──
CN_BADGE=$(grep -cE 'img\.shields\.io' "$CN_README" || true)
EN_BADGE=$(grep -cE 'img\.shields\.io' "$EN_README" || true)
CN_BADGE=${CN_BADGE:-0}
EN_BADGE=${EN_BADGE:-0}
if [ "$CN_BADGE" -eq "$EN_BADGE" ] && [ "$CN_BADGE" -gt 0 ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [③badge 数] 中 ${CN_BADGE} = 英 ${EN_BADGE}"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [③badge 数] 中 ${CN_BADGE} ≠ 英 ${EN_BADGE}——一侧增删徽章，另一侧未同步"
  FAILS=$((FAILS + 1))
fi

# ── ④ 关键数字集合一致（版本号 vX.Y.Z + 3~4 位整数；取集合后比对）──
# 抽「纯数字与版本号集合」，不比对句子（理由见文件头 ④）。sort -u 消重后
# 用空格连成一行做字符串等值比较；不一致时打双向差集方便定位。
extract_key_nums() {
  {
    grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' "$1" || true
    grep -oE '[0-9]+' "$1" | awk 'length($0) >= 3 && length($0) <= 4' || true
  } | LC_ALL=C sort -u
}
extract_key_nums "$CN_README" > "$CN_NUMS_FILE"
extract_key_nums "$EN_README" > "$EN_NUMS_FILE"
CN_NUMS=$(tr '\n' ' ' < "$CN_NUMS_FILE" | sed 's/ $//')
EN_NUMS=$(tr '\n' ' ' < "$EN_NUMS_FILE" | sed 's/ $//')
if [ -z "$CN_NUMS" ] || [ -z "$EN_NUMS" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [④关键数字集合] 提取为空（中「${CN_NUMS}」/ 英「${EN_NUMS}」）——口径失效，宁可疑不假绿"
  FAILS=$((FAILS + 1))
elif [ "$CN_NUMS" = "$EN_NUMS" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [④关键数字集合] 中英一致：${CN_NUMS}"
else
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [④关键数字集合] 中英不一致——某侧版本号/测试数/工具数/场景数漂移未同步"
  echo "       仅中文侧有：$(LC_ALL=C comm -23 "$CN_NUMS_FILE" "$EN_NUMS_FILE" | tr '\n' ' ')"
  echo "       仅英文侧有：$(LC_ALL=C comm -13 "$CN_NUMS_FILE" "$EN_NUMS_FILE" | tr '\n' ' ')"
  echo "       中文集合：${CN_NUMS}"
  echo "       英文集合：${EN_NUMS}"
  FAILS=$((FAILS + 1))
fi

# ── ④b 同文件测试数多值冲突检测 ──────────────────────────────
# 背景：「中英一致地错」——4805/4807 在中英两版各自分裂但分裂方式完全对称
# （122↔124、298↔299），④ 集合比对照绿。多值本身合法（发版时点 vs 当前值），
# 但每处必须带口径标记词（发版时点 / 当前 / as of / current）——无标记的多值
# 才是漂移。本段对每个文件独立扫描：命中「N 测试 / N tests」形态的 4 位数值，
# 同文件出现 ≥2 个不同值时逐处检查口径标记，缺标记即 FAIL。
# 豁免通道：确有合法多值场景时在下方数组登记（文件:行号 | 理由），默认为空——
# 禁止「检测不到就跳过」的静默形态。
declare -a TESTCOUNT_EXEMPT=()
TESTCOUNT_EXEMPT_COUNT=0
TESTCOUNT_MARKERS='发版时点|当前|as of|current'
MULTIVALUE_FAILS=0
for f in "$CN_README" "$EN_README"; do
  [ -f "$f" ] || continue
  # 匹配测试数声称行：「(测试|tests) NUM」或「NUM (测试|tests)」双向形态，
  # 邻域窗 24 覆盖「测试 4429 → **4805**（发版时点口径）」加粗/箭头长形态
  # （实测 122 行 4805 与前导「测试」间隔约 20 字符）；不误伤无测试词邻域的年份/章节号。
  hits_f=$(grep -nE '(测试|tests)[^0-9]{0,24}[0-9]{4}|[0-9]{4}[^0-9]{0,24}(测试|tests)' "$f" 2>/dev/null)
  [ -z "$hits_f" ] && continue
  uniq_f=$(echo "$hits_f" | grep -oE '[0-9]{4}' | sort -u | wc -l | tr -d ' ')
  [ "$uniq_f" -lt 2 ] && continue
  # 同文件多值：逐命中行查口径标记（豁免登记行跳过）
  file_bad=0
  while IFS= read -r line; do
    lineno="${line%%:*}"; content="${line#*:}"
    exempt_key="${f}:${lineno}"; is_exempt=0
    # BSD/bash 3.2 兼容：set -u 下空数组遍历会炸（TESTCOUNT_EXEMPT[@]: unbound），
    # 用计数守卫替代直接展开；豁免键格式「文件:行号 | 理由」
    _idx=0
    while [ "$_idx" -lt "$TESTCOUNT_EXEMPT_COUNT" ]; do
      ex="${TESTCOUNT_EXEMPT[$_idx]}"
      [[ "$ex" == "${exempt_key} |"* ]] && is_exempt=1 && break
      _idx=$((_idx + 1))
    done
    if [ "$is_exempt" = "0" ] && ! grep -qE "$TESTCOUNT_MARKERS" <<< "$content"; then
      echo "  ❌ [④b测试数多值] ${f}:${lineno}：测试数命中行无口径标记（需 ${TESTCOUNT_MARKERS} 之一）——多值漂移无解释"
      file_bad=$((file_bad + 1))
    fi
  done <<< "$hits_f"
  ASSERTS=$((ASSERTS + 1))
  if [ "$file_bad" -gt 0 ]; then
    echo "  ❌ [④b测试数多值] ${f}：${uniq_f} 个不同测试数值，${file_bad} 处无口径标记"
    MULTIVALUE_FAILS=$((MULTIVALUE_FAILS + file_bad))
  else
    echo "  ✓ [④b测试数多值] ${f}：${uniq_f} 个不同测试数值，均有口径标记"
  fi
done
if [ "$MULTIVALUE_FAILS" -gt 0 ]; then
  FAILS=$((FAILS + MULTIVALUE_FAILS))
fi

echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$FAILS" -gt 0 ]; then
  echo "  FAIL=${FAILS}——双语 README 结构不对称，改一侧必须同步另一侧"
  echo "  🔴 真实漂移请报告差异清单，不要为转绿而删 README 内容"
else
  echo "  FAIL=0——双语 README 四项结构对账通过"
fi
# ── 覆盖度行（v1.4.9 G-2②）──
# covered 口径：本脚本的**精确**扫描面 = 2 个双语 README（非上界，直接计数）
COVERED=2
[ -f "$CN_README" ] || COVERED=$((COVERED - 1))
[ -f "$EN_README" ] || COVERED=$((COVERED - 1))
emit_coverage_line "check-readme-parity" "$ASSERTS" "$COVERED" "$SKIPS"
if [ "$FAILS" -gt 0 ]; then
  exit 1
else
  exit 0
fi
