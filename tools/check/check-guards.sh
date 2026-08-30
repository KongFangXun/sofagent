#!/bin/bash
# check-guards.sh — 守卫的守卫（meta-guard）
# ============================================================
# 职责：门禁脚本自身会烂。本脚本静态扫四类「检查器腐烂模式」，
# 并提供 --inject 注入实测（每门禁注入坏样本验证必红、清掉必绿——
# 红不了的门禁是装饰品）。
#
# 四类静态模式（每类都有真实实案）：
#   ① sed/grep 用 \s \b（BSD sed 不认 \s、BSD grep BRE 无 \b）——跨平台炸弹
#   ② $VAR 后紧跟全角标点（bash 把多字节首字节拼进变量名）——调度 check-cjk-var.sh
#   ③ || echo 0 静默兜底（检查器故障伪装成零违规=假绿）——run-10 教训家族
#   ④ 扫描范围对账（守卫声称扫了 N 文件 vs find 实际 M 文件）——失明防御
#
# 用法：
#   bash tools/check/check-guards.sh           # 静态四扫（默认，只读，无副作用）
#   bash tools/check/check-guards.sh --inject  # 静态扫 + 注入实测（会短暂改仓内文件，
#                                              #   故前置 git 工作树干净检查；并行
#                                              #   session 工作期间勿跑）
#
# 退出码：0=全绿 / 1=有违规 / 2=脚本自身错误
#
# 设计纪律：
#   - 与 check-cjk-var.sh 同款语言与结构（check 系家族风格）
#   - 只读静态扫默认跑；注入实测显式触发（改文件的动作不默认）
#   - macOS bash 3.2 兼容（无 mapfile/declare -A）
#   - 本脚本也是 check-cjk-var 的扫描对象——注入样本用 %s 拼接全角标点，
#     保证自身源码合规（$VAR 后跟 %s 半角不触发 PATTERN）而注入产物违规
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

MODE="static"
for _arg in "$@"; do
  case "$_arg" in
    --inject) MODE="inject" ;;
    --help|-h)
      echo "check-guards.sh — 守卫的守卫（检查器腐烂模式静态扫 + 注入实测）"
      echo "  (无参数)   静态四扫：BSD 正则 / CJK 变量 / || echo 0 / 扫描范围对账"
      echo "  --inject   注入实测：每门禁注入坏样本 → 跑 → 验证必红 → 还原 → 验证必绿"
      echo "             （前置 git 干净检查；并行 session 工作期间勿跑）"
      exit 0 ;;
    *) echo "未知参数：${_arg}（支持 --inject）"; exit 2 ;;
  esac
done

VIOL=0
WARNINGS=0
SELF="tools/check/check-guards.sh"

# ── 扫描范围（守卫的守卫必须覆盖全部检查器脚本，不能只扫 tools/）──
# 实案：FORGE/playbook/acceptance-test.sh 存在 9 处 `grep -c ... || echo 0` 双零陷阱，
# 本脚本原先只 `find tools -name "*.sh"`，导致该漏检长期存在。范围在此集中定义，
# 目录重组后只改这一处，避免 ①② 两处 find 各自漂移。
# 可用环境变量覆盖：GUARD_SCAN_PATHS / GUARD_SCAN_FILES。
# 注：④ 段刻意不复用本函数——它对账的是 check-cjk-var.sh 自身的扫描范围，
# 期望值必须与对方实际范围一致，否则永久假红。
GUARD_SCAN_PATHS="${GUARD_SCAN_PATHS:-tools FORGE/playbook engine/scripts}"
GUARD_SCAN_FILES="${GUARD_SCAN_FILES:-install.sh bootstrap.sh}"
# shellcheck disable=SC2206
GUARD_SCAN_PATHS_ARR=(${GUARD_SCAN_PATHS})
# shellcheck disable=SC2206
GUARD_SCAN_FILES_ARR=(${GUARD_SCAN_FILES})
guard_scan_files() {
  find "${GUARD_SCAN_PATHS_ARR[@]}" -name "*.sh" -type f 2>/dev/null || true
  for _gf in "${GUARD_SCAN_FILES_ARR[@]}"; do [ -f "${_gf}" ] && echo "${_gf}"; done
}

echo "=== check-guards · 守卫的守卫（mode=${MODE}）==="

# ============================================================
# ① BSD 不兼容正则：sed 表达式里的 \s \b（WARN 观察项不阻断）
# ============================================================
echo ""
echo "── ① BSD 不兼容正则（\\s \\b in sed）──"
BSD_HITS=0
# 范围收窄理由（实测口径）：macOS BSD grep 的 ERE 实际支持 \s \b（全仓 grep 用法日常跑绿），
# 真正的炸弹只在 sed——BSD sed 表达式不认 \s（GNU 认），需写 [[:space:]]。
# 检测引擎用 perl（BSD grep 对 \s 的自身解释不可靠，不能用它扫 \s）；
# node -e / perl 内嵌的 JS/PCRE 正则是合法用法，排除。
_BSD_SCAN=$(guard_scan_files | while IFS= read -r _sh; do
    [ "$_sh" = "$SELF" ] && continue
    perl -ne 'print "$.:$_" if /\bsed\b.*\\\\[sb]\b/ && !/^\s*#/ && !/node|perl/' "$_sh" 2>/dev/null \
      | sed "s|^|${_sh}:|" || true
  done | sort -u)
while IFS= read -r _line; do
  [ -z "$_line" ] && continue
  echo "  ⚠ ${_line%%:*}:$(echo "$_line" | cut -d: -f2) —— sed/grep 上下文使用 \\s 或 \\b（BSD 不兼容，建议 POSIX 类 [[:space:]] / [[:<:]]）"
  WARNINGS=$((WARNINGS + 1))
  BSD_HITS=$((BSD_HITS + 1))
done <<EOF
${_BSD_SCAN}
EOF
if [ "$BSD_HITS" -eq 0 ]; then
  echo "  ✓ 无 BSD 不兼容正则残留（sed/grep 上下文）"
fi

# ============================================================
# ② CJK 标点变量定界 —— 调度 check-cjk-var.sh（单一职责，不重复实现）
# ============================================================
echo ""
echo "── ② CJK 标点变量定界（调度 check-cjk-var.sh）──"
if bash tools/check/check-cjk-var.sh; then
  :
else
  VIOL=$((VIOL + 1))
  echo "  ↑ check-cjk-var 报违规——计入 check-guards 失败"
fi

# ============================================================
# ③ grep -c 双零地雷（|| echo 0 追加第二行成双零——真地雷只此形态）
# ============================================================
echo ""
echo "── ③ grep -c 双零地雷 ──"
# 规则口径（实测）：`grep -c` 零匹配时自行输出单行 0，`|| echo 0` 会再补一行
# 成 "0\n0" 双零，后续整数比较静默失效（v1.3.7 FLAKY_PKGS 实案）。
# 而 `grep -o ... || echo 0` 是合法兜底（grep -o 零匹配输出空，echo 0 补 0）——不扫。
# 检查器崩溃伪装零违规的 node 系（SCAN_FAIL 模式）属另一形态，此处不覆盖。
ECHO0_HITS=0
_E0_SCAN=$(guard_scan_files | while IFS= read -r _sh; do
    # [^;] 而非 [^|]：grep 参数里的 BRE alternation（如 "Ledger\|Views\|Policy"）含单个 |，
    # 用 [^|] 会在第一个 | 处截断，导致含 alternation 的双零行系统性漏检（实案：
    # acceptance-test.sh 的 727/769/770/771/1258/1260/1589 共 7 处长期漏网）。
    # 排除已归一化的形态：$({ ... || echo "0"; } | awk '{s+=$1}END{print s+0}')
    # awk 会消费掉多行并把结果压成单个数字，双零在此无害（实案：engine/scripts/cleanup.sh）
    # 这里必须用 .* 不能用 [^;]*——待排除形态是 `|| echo "0"; } | awk`，分号在 echo 与 | awk 之间。
    # 🔴 铁律：本管道内禁止插入注释行——命令替换里 `\` 续行遇注释行会断链，
    #    后续 `| grep` 变成孤行报 syntax error，而 bash -n 与 EXIT CODE 都检测不到，
    #    结果是本段静默归零、输出「✓ 无」假绿（实案：2026-08-30 本段两度踩坑）。
    grep -nE 'grep -c[^;]*\|\| *echo' "$_sh" 2>/dev/null \
      | grep -vE '^[0-9]+:[[:space:]]*#' \
      | grep -v 'guards-allow' \
      | grep -vE '\|\|[[:space:]]*echo.*\|[[:space:]]*awk' \
      | sed "s|^|${_sh}:|" || true
  done | sort -u)
while IFS= read -r _line; do
  [ -z "$_line" ] && continue
  # 豁免机制：行内含 guards-allow 标记 = 人工确认过的合法降级（如 tput 非 tty 兜底）
  echo "$_line" | grep -q "guards-allow" && continue
  echo "  ✗ ${_line}"
  echo "      修法：SSOT 计数类改 || true + \${VAR:-0}；检查器崩溃改显式 FAIL 标记（SCAN_FAIL 模式）"
  VIOL=$((VIOL + 1))
  ECHO0_HITS=$((ECHO0_HITS + 1))
done <<EOF
${_E0_SCAN}
EOF
if [ "$ECHO0_HITS" -eq 0 ]; then
  echo "  ✓ 无 || echo 0 静默兜底（guards-allow 豁免除外）"
fi

# ============================================================
# ④ 扫描范围对账：守卫声称的扫描文件数 vs find 实际
# ============================================================
echo ""
echo "── ④ 扫描范围对账（glob 声称 vs find 实际）──"
# 实案：check-cjk-var 顶层 glob 在目录重组后漏扫 19 个子目录脚本
GLOB_ACCOUNT_FAIL=0
# 期望值 = find 总数 - 1：check-cjk-var 自排除自身（SELF 豁免），属正常扣减而非失明
# 注意：此处刻意保持 tools/ 原范围，不复用 guard_scan_files——本段对账的是
# check-cjk-var.sh 自己报告的扫描数，期望值必须等于对方的实际范围，否则永久假红。
# 若将来把 check-cjk-var.sh 的扫描面也扩到 FORGE/playbook、engine/scripts，此处同步扩。
_cjk_expect=$(find tools -name "*.sh" -type f | grep -v "check-cjk-var.sh" | wc -l | tr -d ' ')
# check-cjk-var 的输出两种格式：成功「N 个 shell 脚本无违规」/ 失败「N 个文件扫描」
_cjk_report=$(bash tools/check/check-cjk-var.sh 2>/dev/null | grep -oE '[0-9]+ 个 (shell 脚本|文件)' | grep -oE '^[0-9]+' | head -1 || true)
_cjk_report=${_cjk_report:-0}
if [ "$_cjk_report" -ne "$_cjk_expect" ]; then
  echo "  ✗ check-cjk-var 报告扫描 ${_cjk_report} 文件 ≠ find 实际 ${_cjk_expect}（已扣 SELF 豁免）——守卫失明（glob 未跟随目录重组）"
  VIOL=$((VIOL + 1))
  GLOB_ACCOUNT_FAIL=1
else
  echo "  ✓ check-cjk-var 扫描面 ${_cjk_report} = find 实际 ${_cjk_expect}（含 SELF 豁免扣减）"
fi

# ============================================================
# --inject 注入实测（显式触发）：每门禁注入坏样本验证必红
# ============================================================
if [ "$MODE" = "inject" ]; then
  echo ""
  echo "════════════════════════════════════════════"
  echo "── --inject 注入实测 ──"
  echo "════════════════════════════════════════════"
  # 前置：注入目标文件必须干净（注入还原用 git checkout -- <file>，只还原注入
  # 时触碰的那几个文件；并行 session 在其他文件上的工作不受影响。检查收窄到
  # 文件级而非全仓级——全仓检查会让并行协作期间永远无法跑 --inject）
  INJECT_TARGETS="tools/check/check-action-pins.sh README.md tools/check/check-deps.sh"
  _dirty_targets=""
  for _t in $INJECT_TARGETS; do
    if git status --porcelain -- "$_t" 2>/dev/null | grep -q .; then
      _dirty_targets="${_dirty_targets} $_t"
    fi
  done
  if [ -n "$_dirty_targets" ]; then
    echo "❌ 注入目标文件不干净：${_dirty_targets}——还原步骤（git checkout --）会吞掉这些改动，拒绝执行"
    echo "   先 commit/stash 上述文件后再跑 --inject"
    exit 1
  fi

  INJECT_FAIL=0

  # ── 注入用例一：check-cjk-var —— 塞入全角标点变量 ──
  # 样本用 %s 拼接全角逗号：本脚本源码保持合规，注入产物是 $VAR，全角 违规行
  echo ""
  echo "── 注入一：check-cjk-var（全角标点变量）──"
  printf '\necho "$GUARDS_INJECT_VAR%s失败"\n' '，' >> tools/check/check-action-pins.sh
  bash tools/check/check-cjk-var.sh > /dev/null 2>&1
  _rc=$?
  if [ "$_rc" -ne 0 ]; then
    echo "  ✓ 坏样本必红（exit=${_rc}）"
  else
    echo "  ❌ 坏样本未红——check-cjk-var 是装饰品！"
    INJECT_FAIL=$((INJECT_FAIL + 1))
  fi
  git checkout -- tools/check/check-action-pins.sh
  if bash tools/check/check-cjk-var.sh > /dev/null 2>&1; then echo "  ✓ 还原后必绿"; else echo "  ❌ 还原后未绿——注入未清干净"; INJECT_FAIL=$((INJECT_FAIL + 1)); fi

  # ── 注入用例二：check-docs 死链扫描 ──
  echo ""
  echo "── 注入二：check-docs（死链注入）──"
  printf '\n[测试死链](./no-such-file-abc123.md)\n' >> README.md
  bash tools/check/check-docs.sh > /tmp/guards-inject-docs.log 2>&1
  _rc=$?
  _hit=$(grep -c "no-such-file-abc123" /tmp/guards-inject-docs.log 2>/dev/null || true)
  _hit=${_hit:-0}
  if [ "$_rc" -ne 0 ] && [ "$_hit" -ge 1 ]; then
    echo "  ✓ 坏样本必红（exit=${_rc}，死链被点名）"
  else
    echo "  ❌ 坏样本未红或未点名——check-docs 死链扫描可疑（exit=${_rc}，点名 ${_hit} 次）"
    INJECT_FAIL=$((INJECT_FAIL + 1))
  fi
  git checkout -- README.md
  rm -f /tmp/guards-inject-docs.log

  # ── 注入用例三：check-version 版本漂移 ──
  echo ""
  echo "── 注入三：check-version（README badge 版本漂移）──"
  # README badge 形态：https://img.shields.io/badge/Version-vX.Y.Z-<色>（HTML img，非 markdown）
  _badge=$(grep -oE 'badge/Version-v[0-9.]+' README.md | head -1 || true)
  if [ -n "${_badge:-}" ]; then
    sed -i '' "s|${_badge}|badge/Version-v9.9.9|" README.md
    bash tools/check/check-version.sh > /tmp/guards-inject-version.log 2>&1
    _rc=$?
    if [ "$_rc" -ne 0 ]; then
      echo "  ✓ 坏样本必红（exit=${_rc}）"
    else
      echo "  ❌ badge 版本漂移未红——check-version 装饰品警报"
      INJECT_FAIL=$((INJECT_FAIL + 1))
    fi
    git checkout -- README.md
    rm -f /tmp/guards-inject-version.log
  else
    echo "  ⚠ 未找到 README version badge——跳过本用例"
  fi

  # ── 注入用例四：check-guards 自身（③ 的自检）──
  echo ""
  echo "── 注入四：check-guards 自身（|| echo 0 自检）──"
  printf '\n_SELF_TEST=$(grep -c "no_such_pattern_xyz" package.json || echo 0)\n' >> tools/check/check-deps.sh  # guards-allow: 注入样本字面量（printf 产物非本行执行）
  bash tools/check/check-guards.sh > /tmp/guards-self-test.log 2>&1
  _rc=$?
  _hit=$(grep -c "check-deps.sh" /tmp/guards-self-test.log 2>/dev/null || true)
  _hit=${_hit:-0}
  if [ "$_rc" -ne 0 ] && [ "$_hit" -ge 1 ]; then
    echo "  ✓ 坏样本必红（exit=${_rc}，check-deps 被点名）"
  else
    echo "  ❌ 自检失败——③ 的 || echo 0 扫描抓不住注入样本（exit=${_rc}，点名 ${_hit} 次）"
    INJECT_FAIL=$((INJECT_FAIL + 1))
  fi
  git checkout -- tools/check/check-deps.sh
  rm -f /tmp/guards-self-test.log

  # 收尾：注入目标文件必须还原干净（文件级检查——只看注入触碰过的文件）
  echo ""
  _after=""
  for _t in $INJECT_TARGETS; do
    if git status --porcelain -- "$_t" 2>/dev/null | grep -q .; then
      _after="${_after} $_t"
    fi
  done
  if [ -n "$_after" ]; then
    echo "❌ 注入后目标文件残留：${_after}——检查 git checkout 还原逻辑"
    exit 1
  fi
  if [ "$INJECT_FAIL" -gt 0 ]; then
    echo "❌ 注入实测 ${INJECT_FAIL} 项失败——存在装饰品门禁"
    VIOL=$((VIOL + INJECT_FAIL))
  else
    echo "✓ 注入实测四项全过——门禁非装饰品（坏样本必红、还原必绿、目标文件还原干净）"
  fi
fi

# ============================================================
# 汇总
# ============================================================
echo ""
echo "════════════════════════════════════════════"
if [ "$VIOL" -eq 0 ]; then
  echo "✓ check-guards 全绿（违规 0 / 警告 ${WARNINGS}——① BSD 正则为 WARN 观察项不阻断）"
  exit 0
else
  echo "✗ check-guards 发现 ${VIOL} 项违规（另有警告 ${WARNINGS} 项）"
  exit 1
fi
