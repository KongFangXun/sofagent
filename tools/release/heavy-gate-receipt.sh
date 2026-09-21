#!/usr/bin/env bash
# ============================================================
# heavy-gate-receipt.sh · 长跑门禁「一次跑、多环节复用」凭据
#
# 病根：长跑门禁在一条发布流水线里会被反复跑同一内容——`playbook/acceptance-test.sh`
#   单跑 9~15 分钟，而阶段三收口跑一次、阶段四终验跑一次、阶段五脚本层**每轮**跑一次
#   （外层循环 N=1..5）⇒ 同一内容最高 5 倍耗时，且重跑不产生任何新信息。
#
# 机制：长跑门禁**跑完即落一条凭据**（内容指纹 + exit + 摘要 + 原始日志路径），
#   后续环节先 `verify`——指纹与当前内容一致且 exit=0 ⇒ 复用结论、跳过重跑；
#   内容变了 ⇒ 返回 3，调用方照常重跑并刷新凭据。
#
# 为什么不怕"假绿"（四道防线）：
#   ① 指纹取自**内容本身**（工作区内容树对象 sha），不取自时间戳；
#   ② verify 同时要求**原始日志仍在位且非空**——凭据不是孤立断言，可回溯证据；
#   ③ 指纹算不出 / 凭据缺 / 日志缺 / 日志无绿灯摘要 ⇒ **exit 2（失明拒绝假绿）**，
#      绝不返回 0。与仓内既有纪律一致：check-forms / check-unwired-exports 同法。
#   ④ `record --pre <指纹>` 钉住「长跑**开始前**」的内容：长跑期间工作区若被编辑，
#      落凭据时当场 exit 3 拒绝。**缺这道，凭据只能自证"落盘那一刻"的内容，
#      无法自证"被实际测过"的内容**——中途改文件会产出「结论不对应内容」的假证。
#
# ------------------------------------------------------------------
# 内容指纹口径（显式声明，便于跨人复核）
#   fingerprint = **工作区内容树对象 sha**——在一个**临时 index** 上先跑
#                 `git add -A .`，再 `git write-tree`，得到「把当前工作区当作一次提交」
#                 的树哈希。
#   · 为什么不用 HEAD sha：`git commit` 本身**不改变工作区内容**，用 HEAD 会让
#     「跑完门禁 → 提交」这一步把凭据判成过期、逼出一次无意义重跑；树哈希是
#     **内容寻址**的，提交前后完全不变。
#   · 覆盖面：全部 tracked 文件 + 未忽略的 untracked 文件（.gitignore 生效）
#   · 大小写口径：不适用（整体哈希，不做字符串匹配）
#   · 注释处理 / 切块边界：不适用（同上）
#   · 已声明局限：
#     ① 只入 git 能表达的内容与 file mode（mtime / xattr 等元数据不入）
#     ② 被 .gitignore 忽略的路径**不入**指纹——含 `acceptance-raw.log` 与
#        `.sofagent/`（凭据库自身）。这是**必要的自指回避**：凭据库若入指纹，
#        写凭据这个动作就会改变指纹、凭据永远自判过期。
#   · 代价：单次约 2 秒（本仓 13 包实测），相对 9~15 分钟的门禁可忽略。
#
# 长跑门禁白名单：acceptance（`playbook/acceptance-test.sh`）。
#   扩展新 gate 的必要条件 = **该 gate 存在机器可判的绿灯摘要**（见 log_looks_green）——
#   没有可靠绿灯判据的 gate 一律不进本机制（宁可重跑，不做无法证伪的复用）。
#   `npm test` 暂不纳入：单次约 5 分钟且整条流水线只跑 2 次（阶段二 + pre-push），
#   重复成本远低于 acceptance 的外层循环；纳入前须先定义其机器可判绿灯判据。
#
# 用法：
#   bash tools/check/heavy-gate-receipt.sh fingerprint
#   bash tools/check/heavy-gate-receipt.sh verify acceptance
#   bash tools/check/heavy-gate-receipt.sh record acceptance <exit> <日志路径> [摘要...]
#   bash tools/check/heavy-gate-receipt.sh show [acceptance]
#
# 退出码：0 = 可复用（凭据有效）/ 2 = 失明（凭据或日志缺失、指纹不可算——拒绝假绿）
#         / 3 = 需重跑（内容已变或上次非 0）
# ============================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE="$REPO_ROOT/.sofagent/heavy-gate-receipts.log"
SEP=$'\x1f' # unit separator（单字节，cut -d 只接受单字符）

known_gate() {
  case "$1" in
    acceptance) return 0 ;;
    *) return 1 ;;
  esac
}

# ── 内容指纹（输出单行 tree sha；失败即调用方按失明处理）──
#    用临时 index 快照整份工作区内容——不碰真实 index（调用方可能正有 staged 内容），
#    也不碰 HEAD。临时文件用完即删，不落在仓库内。
compute_fingerprint() {
  local idx tree
  idx="$(mktemp -u -t sofagent-gate-idx.XXXXXX)" || return 1
  rm -f "$idx"
  tree="$(GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" add -A . >/dev/null 2>&1 &&
    GIT_INDEX_FILE="$idx" git -C "$REPO_ROOT" write-tree 2>/dev/null)"
  rm -f "$idx"
  [ -n "$tree" ] || return 1
  printf '%s\n' "$tree"
}

last_receipt() {
  [ -f "$STORE" ] || return 1
  LC_ALL=C grep "^gate=${1}${SEP}" "$STORE" 2>/dev/null | tail -1
}

# ── 绿灯判据：凭据不得与日志冲突（防"凭据说绿、日志说红"）──
log_looks_green() {
  local gate="$1" log="$2" line num den
  [ -s "$log" ] || return 1
  case "$gate" in
    acceptance)
      # 期望形如「SUMMARY: 446/446 passed · SKIP: 0 · EXIT: 0」
      line="$(LC_ALL=C grep -a 'SUMMARY:' "$log" 2>/dev/null | tail -1)"
      [ -n "$line" ] || return 1
      num="$(printf '%s' "$line" | sed -n 's/.*SUMMARY: \([0-9][0-9]*\)\/\([0-9][0-9]*\) passed.*/\1/p')"
      den="$(printf '%s' "$line" | sed -n 's/.*SUMMARY: \([0-9][0-9]*\)\/\([0-9][0-9]*\) passed.*/\2/p')"
      [ -n "$num" ] && [ -n "$den" ] || return 1
      [ "$num" = "$den" ] || return 1
      printf '%s' "$line" | grep -q 'EXIT: 0' || return 1
      return 0
      ;;
    *) return 1 ;;
  esac
}

cmd_fingerprint() {
  local fpr
  fpr="$(compute_fingerprint)" || {
    echo "❌ 失明：内容指纹算不出（git 不可用或不在仓库内）" >&2
    return 2
  }
  printf '%s\n' "$fpr"
}

cmd_record() {
  local gate="$1" exit_code="$2" log_path="$3"
  shift 3
  local pre="" abs_log fpr
  # `summary` 必须**独占一行初始化**：check-tool-health ⑥（set -u 自引用守卫）按
  # `^\s*(local )?VAR=` 判定「此前已初始化」，合并声明（`local a="" summary=""`）不被识别。
  local summary=""
  # --pre 与摘要混在尾部：逐个取，非 --pre 的一律并入摘要（顺序保持）。
  # 刻意不用 `case`：本仓既有教训是 bash 3.2 下 `case` 与循环/重定向组合易触发
  # `syntax error near unexpected token ';;'`，`if` 分支形态在该环境下更稳。
  while [ $# -gt 0 ]; do
    if [ "$1" = "--pre" ]; then
      pre="${2:-}"
      shift 2 2>/dev/null || shift
    elif [ "$1" = "--" ]; then
      # 裸 `--` 是选项结束符（CLI 惯例），不入摘要——否则摘要前缀会带一个莫名的 "--"。
      shift
    else
      summary="${summary}${summary:+ }$1"
      shift
    fi
  done
  known_gate "$gate" || {
    echo "❌ 未登记的长跑门禁：${gate}（白名单见脚本头部）" >&2
    return 2
  }
  fpr="$(compute_fingerprint)" || {
    echo "❌ 失明：指纹算不出，凭据不落盘" >&2
    return 2
  }
  # 防线④：--pre 与当前内容不符 ⇒ 长跑期间工作区被改过，该次结果不对应当前内容。
  if [ -n "$pre" ] && [ "$pre" != "$fpr" ]; then
    echo "❌ 拒绝落凭据：--pre 指纹与当前内容不一致" >&2
    echo "   --pre（长跑开始前）：$pre" >&2
    echo "   当前内容：$fpr" >&2
    echo "   ⇒ 长跑期间工作区发生过变动 ⇒ 结果不可复用，须重跑后再落凭据" >&2
    return 3
  fi
  abs_log="$(cd "$(dirname "$log_path")" 2>/dev/null && pwd)/$(basename "$log_path")"
  [ -n "$summary" ] || summary="(未提供摘要)"
  mkdir -p "$(dirname "$STORE")"
  printf 'gate=%s%s%s%s%s%s%s%s%s%s%s\n' \
    "$gate" "$SEP" "$fpr" "$SEP" "$exit_code" "$SEP" "$abs_log" "$SEP" "$summary" "$SEP" "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
    >>"$STORE"
  echo "✅ 凭据已落盘：gate=$gate exit=$exit_code fpr=$fpr"
  echo "   日志：$abs_log"
  [ -n "$pre" ] && echo "   --pre 校验通过（长跑期间工作区未变动）"
  echo "   后续环节可跑 verify 复用本条，无需重跑。"
}

cmd_verify() {
  local gate="$1" line fpr_now rec_fpr rec_exit rec_log rec_sum rec_ts
  known_gate "$gate" || {
    echo "❌ 未登记的长跑门禁：${gate}" >&2
    return 2
  }
  fpr_now="$(compute_fingerprint)" || {
    echo "❌ 失明：指纹算不出 ⇒ 拒绝假绿（需重跑）" >&2
    return 2
  }
  line="$(last_receipt "$gate")"
  if [ -z "$line" ]; then
    echo "⏳ 无凭据 ⇒ 需重跑（${gate}）"
    return 3
  fi
  rec_fpr="$(printf '%s' "$line" | cut -d"$SEP" -f2)"
  rec_exit="$(printf '%s' "$line" | cut -d"$SEP" -f3)"
  rec_log="$(printf '%s' "$line" | cut -d"$SEP" -f4)"
  rec_sum="$(printf '%s' "$line" | cut -d"$SEP" -f5)"
  rec_ts="$(printf '%s' "$line" | cut -d"$SEP" -f6)"
  if [ "$rec_fpr" != "$fpr_now" ]; then
    echo "⏳ 内容已变 ⇒ 需重跑（${gate}）"
    echo "   凭据指纹：${rec_fpr}（${rec_ts}）"
    echo "   当前指纹：$fpr_now"
    return 3
  fi
  if [ "$rec_exit" != "0" ]; then
    echo "⏳ 上次非 0（exit=${rec_exit}）⇒ 需重跑（${gate}）"
    return 3
  fi
  if [ ! -s "$rec_log" ]; then
    echo "❌ 失明：指纹一致但原始日志缺失/为空（${rec_log}）⇒ 拒绝假绿（需重跑）" >&2
    return 2
  fi
  if ! log_looks_green "$gate" "$rec_log"; then
    echo "❌ 失明：凭据称绿但日志无绿灯摘要（${rec_log}）⇒ 拒绝假绿（需重跑）" >&2
    return 2
  fi
  echo "✅ 可复用：${gate} 结论（指纹一致，未重跑）"
  echo "   指纹：$fpr_now"
  echo "   摘要：$rec_sum"
  echo "   日志：${rec_log}（${rec_ts}）"
  return 0
}

cmd_show() {
  [ -f "$STORE" ] || {
    echo "（无凭据库：${STORE}）"
    return 0
  }
  if [ $# -gt 0 ]; then
    LC_ALL=C grep "^gate=${1}${SEP}" "$STORE" 2>/dev/null | sed "s/${SEP}/ | /g" || echo "（$1 无凭据）"
  else
    sed "s/${SEP}/ | /g" "$STORE"
  fi
}

cmd="${1:-}"
case "$cmd" in
  fingerprint)
    cmd_fingerprint
    ;;
  verify)
    shift
    [ $# -ge 1 ] || {
      echo "用法：verify <gate>" >&2
      exit 2
    }
    cmd_verify "$1"
    ;;
  record)
    shift
    [ $# -ge 3 ] || {
      echo "用法：record <gate> <exit> <log-path> [摘要...]" >&2
      exit 2
    }
    _g="$1"
    _e="$2"
    _l="$3"
    shift 3
    cmd_record "$_g" "$_e" "$_l" "$@"
    ;;
  show)
    shift
    cmd_show "$@"
    ;;
  *)
    # 用法段打印：从第 2 行到 `set -` 前一行——**按内容定界而非写死行号**，
    # 头部注释增删不必同步改这里（写死行号会让新增说明被静默截断）。
    sed -n '2,/^set -/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
