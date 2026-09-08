#!/bin/bash
# check-forge-branches.sh — FORGE 分支收编标记对账（收编即标记机制）
# Forge branch incorporation-mark reconciliation.
#
# 问题：FORGE 循环的工作分支（forge/*）修复被收编进 main 后，分支本身不会
#   消失（收编方式是逐文件 apply 重开 commit，不是 merge——分支永远「非空」）。
#   一旦某分支的修复在收编前被 reset --hard 洗掉，没有任何机制报警，只能靠
#   人工翻孤儿分支追回——修复静默丢失的温床。
# 防御：「收编即标记」——收编完成的分支打上标记（tag forge-merged-* 或分支名
#   含 -merged-YYYYMMDD），本脚本对账：未标记的 forge/* 分支逐一列出（分支名 /
#   独有 commit 数 / 涉及文件 / 各文件在 main 的最后改动），供人工确认后补标记。
#
# 判据红线（实测教训，勿改回）：
#   - 禁用 `git log main..<分支>` 判「已收编」——逐文件 apply 收编下恒非空，
#     用它等于永久红
#   - 禁用 `git cherry`（patch-id）判「已收编」——拆分/合并收编下假阳性
#   - 唯一判定依据 = 标记存在（tag 或分支名），标记由人工确认收编后打
#
# 级别口径：INFO 不阻断（对账对象含人工判断——按快照对账 warn 级原则，
#   error 级只留给硬事实）。本脚本永不因「存在未标记分支」而非 0。
#
# 用法：bash tools/check/check-forge-branches.sh [--family fresh-eyes|release-gate]
# 退出码：0 = 对账完成（可能有 INFO 待办） / 2 = 脚本自身错误（非 git 仓等）
#
# 标记方式（二选一，判定时两者任一命中即视为已收编）：
#   git tag forge-merged-<分支名中 / 换 ->          # 推荐：不动分支名
#   git branch -m <旧名> <旧名>-merged-YYYYMMDD      # 改名式（会动引用，少用）

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

# 参数：--family 过滤分支家族（fresh-eyes / release-gate），缺省全部
FAMILY_FILTER=""
for _arg in "$@"; do
  case "${_arg}" in
    --family) : ;;  # 值由下一参数承接（见下循环简化：直接支持 --family=xxx）
    --family=*) FAMILY_FILTER="${_arg#--family=}" ;;
    --help|-h)
      echo "check-forge-branches.sh — FORGE 分支收编标记对账（INFO 级，不阻断）"
      echo "  (无参数)             枚举全部 forge/* 分支"
      echo "  --family=fresh-eyes  只看 fresh-eyes 家族"
      echo "  --family=release-gate 只看 release-gate 家族"
      exit 0 ;;
    *) echo "未知参数：${_arg}"; exit 2 ;;
  esac
done

if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "✗ 非 git 仓库——本脚本只对账 git 分支"
  exit 2
fi

echo "=== check-forge-branches · FORGE 分支收编标记对账 ==="

# 标记命中判定：tag forge-merged-<safe-name> 存在，或分支名含 -merged-YYYYMMDD
# safe-name = 分支名去掉 forge/ 前缀后把 / 换成 -（tag 命名稳定可推导）
is_marked() {
  # $1 = 完整分支名（如 forge/fresh-eyes/20260907-02-r2-bfix）
  case "$1" in
    *-merged-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) return 0 ;;
  esac
  local _safe="${1#forge/}"
  _safe="${_safe//\//-}"
  git rev-parse -q --verify "refs/tags/forge-merged-${_safe}" > /dev/null 2>&1
}

# ── 枚举与分组 ────────────────────────────────────────────────
BRANCHES=$(git branch --list 'forge/*' --format='%(refname:short)' 2>/dev/null | LC_ALL=C sort)
if [ -z "$BRANCHES" ]; then
  echo "✓ 无 forge/* 分支——无可对账对象"
  exit 0
fi

TOTAL=0
MARKED=0
UNMARKED=0
UNMARKED_LIST=""

while IFS= read -r _b; do
  [ -z "${_b}" ] && continue
  # 家族过滤（--family 值与 forge/<family>/ 前缀匹配）
  if [ -n "${FAMILY_FILTER}" ]; then
    case "${_b}" in
      "forge/${FAMILY_FILTER}"/*) : ;;
      *) continue ;;
    esac
  fi
  TOTAL=$((TOTAL + 1))
  if is_marked "${_b}"; then
    MARKED=$((MARKED + 1))
  else
    UNMARKED=$((UNMARKED + 1))
    UNMARKED_LIST="${UNMARKED_LIST}${_b}"$'\n'
  fi
done <<EOF
${BRANCHES}
EOF

echo "forge/* 分支共 ${TOTAL} 个：已标记（收编完成）${MARKED} · 未标记（待人工确认）${UNMARKED}"
echo ""

if [ "${UNMARKED}" -eq 0 ]; then
  echo "✓ 全部 forge 分支已带收编标记——无静默丢失风险敞口"
  exit 0
fi

# ── 未标记分支明细（INFO 级对账信息）─────────────────────────
# 展示口径：独有 commit 数与涉及文件仅是**线索**不是收编判定（见头部判据红线）；
# 各文件在 main 的最后改动 commit 供人工比对「分支改的东西 main 是否已有」。
echo "── 未标记分支明细（INFO，不阻断——确认收编后打标记）──"
while IFS= read -r _b; do
  [ -z "${_b}" ] && continue
  if [ -n "${FAMILY_FILTER}" ]; then
    case "${_b}" in
      "forge/${FAMILY_FILTER}"/*) : ;;
      *) continue ;;
    esac
  fi
  _safe="${_b#forge/}"
  _safe="${_safe//\//-}"
  _ahead=$(git rev-list --count "main..${_b}" 2>/dev/null || echo '?')
  echo ""
  echo "  ◇ ${_b}（main 领先视角独有 commit：${_ahead}）"
  _files=$(git diff --name-only "main...${_b}" 2>/dev/null | head -10)
  if [ -n "${_files}" ]; then
    echo "$_files" | while IFS= read -r _f; do
      [ -z "${_f}" ] && continue
      _mc=$(git log -1 --format='%h %s' -- "${_f}" 2>/dev/null | head -c 80)
      echo "      - ${_f}（main 最后改动：${_mc:-（main 无此文件）}）"
    done
  else
    echo "      -（相对 merge-base 无文件改动——内容已全在 main 或纯快进）"
  fi
  echo "      处置：确认已收编 → git tag forge-merged-${_safe}"
done <<EOF
${UNMARKED_LIST}
EOF

echo ""
echo "ℹ 以上为对账信息（INFO 级）：未标记 ≠ 未收编——需人工确认；确认后打标记消除敞口"
exit 0
