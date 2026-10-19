#!/usr/bin/env bash
# ============================================================
# check-docs-all.sh · 收尾自检套餐（一站式，全绿口径 = 全套而非惯用子集）
# ============================================================
# 动机（2026-10-07 实录）：文档批收尾时惯跑「四门禁」全绿，但换跑 doc-score
#   一抓就是 3 个红项（考古标签 / 括号残留 / 加粗过载）——覆盖面盲区靠自觉填
#   等于没填。本脚本一个入口串行跑全套文档面检查，汇总各 rc，给总退出码。
#
# 用法：
#   bash tools/check/check-docs-all.sh            # 全量（含 doc-score 全量档 ~60s+）
#   bash tools/check/check-docs-all.sh --fast     # 快速档（doc-score 用 --fast，
#                                                 #   跳过实跑测试与 check-claims）
#
# 套餐成员（顺序 = 快到慢，最快失败尽早退出报告）：
#   ① check-forms.mjs          形态标注与计数对账
#   ② check-anchors.mjs        锚点与章号一致
#   ③ check-docs.sh            文档预算与死链
#   ④ doc-discipline.sh        六面文档纪律（可读性/字数棘轮/来源块/考古…）
#   ⑤ check-sop-integrity.mjs  SOP 阶段文件结构 pin
#   ⑥ doc-score.mjs[--fast]    文档质量六维评分
#
# 退出码：0 = 全套绿；1 = 任一成员红（明细见上方各成员自带输出）。
# 定性：**收尾自检套餐非 CI 门禁**——CI/push 防线仍由 pre-push-check 承担
#   （本套餐是它的文档面子集 + doc-score 六维扩充，覆盖面更宽、定位是
#   「落盘批收尾的最后一眼」）。
# ============================================================
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

FAST=""
[[ "${1:-}" == "--fast" ]] && FAST="--fast"

declare -a NAMES=(check-forms check-anchors check-docs doc-discipline check-sop-integrity check-stale-docs doc-score check-retired-refs check-release-state check-devlog-unique check-env-wiring gen-capability-manifest)
declare -a CMDS=(
  "node tools/check/check-forms.mjs"
  "node tools/check/check-anchors.mjs"
  "bash tools/check/check-docs.sh"
  "bash tools/check/doc-discipline.sh"
  "node tools/check/check-sop-integrity.mjs"
  "node tools/check/check-stale-docs.mjs"
  "node tools/check/doc-score.mjs${FAST:+ }${FAST}"
  "bash tools/check/check-retired-refs.sh"
  "node tools/check/check-release-state.mjs"
  "node tools/check/check-devlog-unique.mjs"
  "node tools/check/check-env-wiring.mjs"
  "node tools/gen/gen-capability-manifest.mjs"
)

echo "════════ 收尾自检套餐（${FAST:+FAST 档}全量档）════════"
echo ""

FAILED=0
declare -a RESULTS=()

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  cmd="${CMDS[$i]}"
  echo "── [$((i+1))/${#NAMES[@]}] $name ──"
  # 输出透传，rc 直取（不经管道——已有教训：| tail 会掩盖真实 rc）
  if bash -c "$cmd" > /tmp/check-docs-all-$$.log 2>&1; then
    RESULTS+=("✓ $name")
    tail -2 /tmp/check-docs-all-$$.log | sed 's/^/    /'
  else
    RESULTS+=("✗ $name")
    FAILED=$((FAILED+1))
    grep -E '✗|❌|违规|未通过|超标' /tmp/check-docs-all-$$.log | head -5 | sed 's/^/    /'
  fi
  echo ""
done
rm -f /tmp/check-docs-all-$$.log

echo "════════ 汇总 ════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
if [[ $FAILED -eq 0 ]]; then
  echo "✅ 全套通过（${#NAMES[@]} 项）"
  exit 0
else
  echo "❌ $FAILED/${#NAMES[@]} 项未过——逐项看上方明细"
  exit 1
fi
