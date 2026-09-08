#!/usr/bin/env bash
# ============================================================
# check-open-boundary.sh · 开源/商业边界守卫（对标 wemux
#   scripts/open-core/public-boundary.mjs，2026-09-08 吸收）
#
# 门禁目的：商业产品名（GrapHub / FlowHub）不得进入开源仓。
#   check-docs.sh §2c 只扫 45 个活文档白名单；本脚本补两个盲区：
#   ① 全仓 git tracked 文件（1480+ 个，含全部 .ts/.mjs/.sh 源码）
#   ② --staged 模式：只查暂存区新增/修改文件（PR 级拦截，同 wemux）
#
# AIR 不进断言：三字母大写英文语境误报率不可控，
#   沿用 check-docs.sh §2c 同一拍板（人工自查）。
# CHANGELOG 豁免：历史事实档案（v1.4.4 记录了断言本身的落地），
#   与 check-docs §2c 豁免口径一致。
#
# 三态语义（对齐 check-storefront.sh）：PASS / FAIL / SKIP-可见。
#
# 用法：
#   bash tools/check/check-open-boundary.sh          # 全仓 tracked 扫描
#   bash tools/check/check-open-boundary.sh --staged # 只查暂存区变更文件
# EXIT 0 = 通过；EXIT 1 = 有泄漏；EXIT 2 = 脚本自身错误（守卫失明不得放行）
# ============================================================

cd "$(dirname "$0")/../.." || exit 2

# BSD 兼容：pattern 用 ERE；字面管道符在引号内无歧义
PATTERN='GrapHub|FlowHub'

# 豁免清单（历史事实档案 + 守卫自身——断言 pattern 里的字面量不是泄漏）。
# 实际豁免走两处 case 分支（staged/全仓），此处仅文档化口径：
#   ^\.git/ ^docs/changelog/ ^tools/check/check-docs\.sh$ ^tools/check/check-open-boundary\.sh$

fail() {
  echo "❌ $1"
  exit 1
}

# ── 模式分派 ──
if [ "$1" = "--staged" ]; then
  # staged 模式：只查暂存区新增/修改（PR 级拦截）
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "SKIP：非 git 仓库环境（--staged 需要 git）"
    exit 0
  fi
  STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
  if [ -z "$STAGED" ]; then
    echo "✅ staged 模式：暂存区无变更文件"
    exit 0
  fi
  HITS=""
  TOTAL=0
  SCANNED=0
  for f in $STAGED; do
    case "$f" in
      .git/*|docs/changelog/*|tools/check/check-docs.sh|tools/check/check-open-boundary.sh) continue ;;
    esac
    [ -f "$f" ] || continue
    TOTAL=$((TOTAL + 1))
    HIT=$(grep -nE "$PATTERN" "$f" 2>/dev/null || true)
    if [ -n "$HIT" ]; then
      HITS="$HITS
$f: $HIT"
    fi
    SCANNED=$((SCANNED + 1))
  done
  if [ -n "$HITS" ]; then
    echo "❌ 暂存区泄漏（${SCANNED} 个变更文件中命中）："
    printf "%s\n" "$HITS" | grep "." | head -20
    exit 1
  fi
  echo "✅ staged 模式：${SCANNED} 个变更文件零命中"
  exit 0
fi

# ── 全仓模式（默认）──
if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "SKIP：git 不可用——全仓模式需要 git ls-files"
  exit 0
fi

TRACKED=$(git ls-files 2>/dev/null)
if [ -z "$TRACKED" ]; then
  echo "SKIP：无 tracked 文件（空仓或异常）"
  exit 0
fi

HITS=""
SCANNED=0
TOTAL_TRACKED=$(printf "%s\n" "$TRACKED" | grep -c "." || true)
TOTAL_TRACKED=${TOTAL_TRACKED:-0}

while IFS= read -r f; do
  case "$f" in
    .git/*|docs/changelog/*|tools/check/check-docs.sh|tools/check/check-open-boundary.sh) continue ;;
  esac
  # 二进制快速跳过：git 的 = 后缀标记或 file 探测
  if file "$f" 2>/dev/null | grep -qE "binary|Binary"; then
    continue
  fi
  [ -f "$f" ] || continue
  HIT=$(grep -nE "$PATTERN" "$f" 2>/dev/null || true)
  if [ -n "$HIT" ]; then
    HITS="$HITS
$f: $HIT"
  fi
  SCANNED=$((SCANNED + 1))
done <<EOF
$TRACKED
EOF

if [ -n "$HITS" ]; then
  echo "❌ 开源边界违规：tracked 文件存在商业产品名（GrapHub/FlowHub）"
  printf "%s\n" "$HITS" | grep "." | head -20
  exit 1
fi

echo "✅ 开源边界守卫：${SCANNED}/${TOTAL_TRACKED} 个 tracked 文件扫描，GrapHub/FlowHub 零命中"
echo "   （AIR 沿用人工自查拍板；CHANGELOG 历史档案豁免）"
exit 0
