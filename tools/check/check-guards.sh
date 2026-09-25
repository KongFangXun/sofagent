#!/bin/bash
# check-guards.sh — 守卫的守卫（meta-guard）
# ============================================================
# 职责：门禁脚本自身会烂。本脚本静态扫五类「检查器腐烂模式」，
# 并提供 --inject 注入实测（每门禁注入坏样本验证必红、清掉必绿——
# 红不了的门禁是装饰品）。
#
# 五类静态模式（每类都有真实实案）：
#   ① sed/grep 用 \s \b（BSD sed 不认 \s、BSD grep BRE 无 \b）——跨平台炸弹
#   ② $VAR 后紧跟全角标点（bash 把多字节首字节拼进变量名）——调度 check-cjk-var.sh
#   ③ || echo 0 静默兜底（检查器故障伪装成零违规=假绿）——run-10 教训家族
#   ④ 扫描范围对账（守卫声称扫了 N 文件 vs find 实际 M 文件）——失明防御
#   ⑤ echo|grep -q SIGPIPE 毒方（`echo "$VAR" | grep -q PAT` 在 pipefail 下，
#      变量大输出 + grep -q 提前退出 → 假红）——详见下方第⑤段
#
# 用法：
#   bash tools/check/check-guards.sh           # 静态五扫（默认，只读，无副作用）
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
# 实案：playbook/acceptance-test.sh 存在 9 处 `grep -c ... || echo 0` 双零陷阱，
# 本脚本原先只 `find tools -name "*.sh"`，导致该漏检长期存在。范围在此集中定义，
# 目录重组后只改这一处，避免 ①② 两处 find 各自漂移。
# 可用环境变量覆盖：GUARD_SCAN_PATHS / GUARD_SCAN_FILES。
# 注：④ 段刻意不复用本函数——它对账的是 check-cjk-var.sh 自身的扫描范围，
# 期望值必须与对方实际范围一致，否则永久假红。
GUARD_SCAN_PATHS="${GUARD_SCAN_PATHS:-tools playbook engine/scripts}"
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
# 注意：不复用 guard_scan_files——本段对账的是 check-cjk-var.sh 自己报告的扫描数，
# 期望值必须与对方的 find 范围**同源同排除集**，否则永久假红。
# check-cjk-var 的扫描面已扩到**全仓 .sh**（含 playbook/ 与 engine/scripts），本行同步扩——
# 两处范围是同一事实，改一处必须改另一处（扩面只扩一半 ⇒ 本项当场转红）。
# v1.5.2 A-9：check-cjk-var 扫描面已改为「shebang 匹配 bash|sh|zsh 或可执行位」——
# 期望值必须与对方同一判据派生（复用对方的判据脚本片段，而非旧 find -name "*.sh" 口径：
# 两套口径必然漂移——新面含 hooks/.command 等无扩展名执行文件）。
_cjk_expect=$(
  {
    git ls-files
    find . -name "*.sh" -type f \
      -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "./.git/*"
  } | LC_ALL=C sort -u | sed 's|^\./||' | grep -vE '(^|/)(node_modules|dist|\.git)/' | while IFS= read -r _f; do
      [ -f "$_f" ] || continue
      if head -n 1 "$_f" 2>/dev/null | grep -qE '^#!.*((ba)?sh|zsh)'; then printf '%s\n' "$_f"; continue; fi
      [ -x "$_f" ] && printf '%s\n' "$_f"
    done | grep -v "check-cjk-var.sh" | wc -l | tr -d ' ')
# 提取口径：check-cjk-var 的扫描数一律是「N 个文件扫描」这一个 token（其三条退出路径
# 同一措辞）。**提取为空与数字不等必须分成两条判定**——合并成一条会给出错误归因：
#   曾因对方两套措辞并存，违规分支提取落空 → 回落 0 → 报「守卫失明（glob 未跟随目录重组）」，
#   而真因是「有违规」。判据：提取为空 = 对方输出契约变了/没跑起来，与 glob 范围无关。
_cjk_raw=$(bash tools/check/check-cjk-var.sh 2>/dev/null | grep -oE '[0-9]+ 个文件扫描' | grep -oE '^[0-9]+' | head -1 || true)
if [ -z "$_cjk_raw" ]; then
  echo "  ✗ check-cjk-var 未输出扫描数（「N 个文件扫描」token 缺失）——输出契约变更或脚本未运行，本项无法判绿"
  VIOL=$((VIOL + 1))
  GLOB_ACCOUNT_FAIL=1
elif [ "$_cjk_raw" -ne "$_cjk_expect" ]; then
  echo "  ✗ check-cjk-var 报告扫描 ${_cjk_raw} 文件 ≠ find 实际 ${_cjk_expect}（已扣 SELF 豁免）——守卫失明（glob 未跟随目录重组）"
  VIOL=$((VIOL + 1))
  GLOB_ACCOUNT_FAIL=1
else
  echo "  ✓ check-cjk-var 扫描面 ${_cjk_raw} = find 实际 ${_cjk_expect}（含 SELF 豁免扣减）"
fi

# ============================================================
# ④b 扫描面自证（v1.5.2 A-9 · 第四轮总评建议收编）：每门禁「本次实际匹配到的
#     文件数 ≥ 1」——== 0 即红。哑守卫（glob 零匹配仍报绿）这一类整体出局：
#     「守卫真的看过东西吗」从人肉反问变成机械信号。
#     实案：regression-checklist.md:45/47 的 `docs/changelog/v*.md` 零匹配，
#     两个子项从未真正执行（第四轮 P1-1）。文件改名/落点迁移/按扩展名圈定
#     三种形态都会复发，此断言按「输出含匹配计数」的最小契约对账。
# ============================================================
echo ""
echo "── ④b 扫描面自证（每守卫匹配数 ≥1，零匹配即红）──"
SELF_ASSERT_FAIL=0
# 各守卫：名称 → 提取「实际匹配/扫描计数」的方式。契约 = 各守卫尾部汇总行。
# 命中数 == 0 且守卫声称扫描面存在 ⇒ 哑守卫判红；提取失败（token 缺失）同判红
# （输出契约变更也算失明的一种——提取不到就无人能对账）。
_self_assert() {
  # $1 = 守卫名（报告用）；$2 = 实跑输出中提取的匹配数（空=提取失败）；$3 = 判绿阈值说明
  local _name="$1" _count="$2" _note="$3"
  if [ -z "${_count}" ]; then
    echo "  ✗ ${_name}：未输出匹配/扫描计数（token 缺失）——输出契约变更或脚本未运行，无法自证"
    VIOL=$((VIOL + 1)); SELF_ASSERT_FAIL=1
  elif [ "${_count}" -lt 1 ]; then
    echo "  ✗ ${_name}：匹配 ${_count} 文件（${_note}）——哑守卫（扫描面零命中仍报绿）"
    VIOL=$((VIOL + 1)); SELF_ASSERT_FAIL=1
  else
    echo "  ✓ ${_name}：${_count} ${_note}"
  fi
}
# check-archaeology：「实际扫描 N 个」token（其头部汇总行）
_ar_raw=$(bash tools/check/check-archaeology.sh 2>/dev/null | grep -oE '实际扫描 [0-9]+ 个' | grep -oE '[0-9]+' | head -1 || true)
_self_assert "check-archaeology" "${_ar_raw}" "个规则文档实际扫描"
# check-anchors：全仓递归锚点扫描——「N 处」断言行；无 token 则按 exit 码兜底判（脚本自身 fail-loud）
_anc_out=$(node tools/check/check-anchors.mjs 2>/dev/null || true)
_anc_raw=$(printf '%s\n' "${_anc_out}" | grep -oE '[0-9]+ (个文件|个锚点|处)' | grep -oE '^[0-9]+' | head -1 || true)
if [ -z "${_anc_raw}" ]; then
  # 该守卫无统一计数 token：以「跑通且非零退出」为在岗信号（exit 0 = 扫描完成零死链）
  if node tools/check/check-anchors.mjs >/dev/null 2>&1; then
    echo "  ✓ check-anchors：exit 0（锚点扫描完成零死链——无计数 token，以通过态自证）"
  else
    echo "  ✗ check-anchors：非零退出（真断链或守卫失明——人工复跑裁定）"
    VIOL=$((VIOL + 1)); SELF_ASSERT_FAIL=1
  fi
else
  _self_assert "check-anchors" "${_anc_raw}" "处锚点对账"
fi
# check-cjk-var：④ 段已对账（同脚本重复跑无增量），此处不重复——④ 绿即它在岗
# check-forms：「N 章已判定」token（A1 失明自检行）
_cf_raw=$(node tools/check/check-forms.mjs 2>/dev/null | grep -oE '[0-9]+ 章已判定' | grep -oE '^[0-9]+' | head -1 || true)
_self_assert "check-forms" "${_cf_raw}" "章形态标注已判定"
if [ "$SELF_ASSERT_FAIL" -eq 0 ]; then
  echo "  ✓ ④b 扫描面自证全部在岗（零匹配判红已生效）"
fi

# ============================================================
# ④c 豁免台账自证（F-26 · 防「门禁形同虚设」）：各门禁的豁免台账就是它的判定面。
#     豁免若把判定面吞干净，门禁的绿就是假的。两类假绿，各一条机械断言：
#       ① 非孤儿——台账必须被 ≥1 个 tools/check/ 脚本消费（零引用 = 判定面从未通电）
#       ② 非全覆盖——台账条目数 < 对应门禁扫描面（≥ = 判定面被豁免干净，100% 豁免）
#     每条台账逐行打印「条目数 / 扫描面 / 比值」，让豁免可见、不静默。
#     扫描面动态取自各门禁自身输出（防陈旧，不硬编码数字）；网络门禁 check-npm-claims
#     不在 meta-guard 内触发——其台账为空（0 条），空台账无 100% 豁免风险。
#     假绿探针：把任一台账条目数临时灌到 ≥ 扫描面 → 本段必红（验证记录见回报）。
# ============================================================
echo ""
echo "── ④c 豁免台账自证（非孤儿 + 非全覆盖）──"
LEDGER_FAIL=0
# 条目计数：各台账结构不同，逐条显式（禁通用猜测——结构一变就在此暴露，不静默归零）
_ledger_count() {
  case "$1" in
    tools/check/silent-catch-baseline.json)
      node -e "process.stdout.write(String(require('./tools/check/silent-catch-baseline.json').length))" 2>/dev/null ;;
    tools/check/silent-catch-prefilter-exempt.json)
      node -e "process.stdout.write(String(require('./tools/check/silent-catch-prefilter-exempt.json').length))" 2>/dev/null ;;
    tools/check/archaeology-exempt.json)
      node -e "const j=require('./tools/check/archaeology-exempt.json');process.stdout.write(String((j.exemptAnchors||[]).length+Object.keys(j.exemptPaths||{}).length))" 2>/dev/null ;;
    tools/check/cross-package-relative-exempt.json)
      node -e "process.stdout.write(String(require('./tools/check/cross-package-relative-exempt.json').length))" 2>/dev/null ;;
    tools/check/knowledge-legacy-path-exempt.json)
      node -e "process.stdout.write(String(Object.keys(require('./tools/check/knowledge-legacy-path-exempt.json')).length))" 2>/dev/null ;;
    tools/check/npm-claims-exempt.json)
      node -e "const j=require('./tools/check/npm-claims-exempt.json');process.stdout.write(String((j.exemptAnchors||[]).length))" 2>/dev/null ;;
  esac
}
# 扫描面：动态取自各门禁自身输出 token（子门禁跑得很快；meta-guard 重跑子门禁有 ④b 先例）
_SF_SILENT=$(node tools/check/check-silent-catch.mjs 2>/dev/null | grep -oE '扫描面 [0-9]+ 个源文件' | grep -oE '[0-9]+' | head -1 || true)
_SF_ARCH=$(bash tools/check/check-archaeology.sh 2>/dev/null | grep -oE '实际扫描 [0-9]+ 个' | grep -oE '[0-9]+' | head -1 || true)
_SF_XPKG=$(node tools/check/check-cross-package-relative.mjs 2>/dev/null | grep -oE '扫描 [0-9]+ 个 src' | grep -oE '[0-9]+' | head -1 || true)
_SF_LEGACY=$(node tools/check/check-legacy-knowledge-path.mjs 2>/dev/null | grep -oE 'covered=[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
_ledger_scanface() {
  case "$1" in
    tools/check/silent-catch-baseline.json|tools/check/silent-catch-prefilter-exempt.json) printf '%s' "${_SF_SILENT}" ;;
    tools/check/archaeology-exempt.json) printf '%s' "${_SF_ARCH}" ;;
    tools/check/cross-package-relative-exempt.json) printf '%s' "${_SF_XPKG}" ;;
    tools/check/knowledge-legacy-path-exempt.json) printf '%s' "${_SF_LEGACY}" ;;
    tools/check/npm-claims-exempt.json) printf '%s' "" ;;
  esac
}
_ledger_assert() {
  local _L="$1" _name _cnt _sf _refs _ratio _sfdisp _bad
  _name=$(basename "${_L}")
  _cnt=$(_ledger_count "${_L}"); [ -z "${_cnt}" ] && _cnt="?"
  _sf=$(_ledger_scanface "${_L}")
  # 非孤儿：至少一个 tools/check/ 脚本（.sh/.mjs）引用台账文件名。
  # 排除本脚本自身——④c 段逐条列出全部台账文件名，若纳入会让断言恒真（自证循环）。
  _refs=$(grep -lF "${_name}" tools/check/*.sh tools/check/*.mjs 2>/dev/null | grep -vxF "${SELF}" | tr '\n' ',' | sed 's/,$//' || true)
  _bad=""
  [ -z "${_refs}" ] && _bad="${_bad}孤儿 "
  if [ -n "${_sf}" ] && [ "${_sf}" -gt 0 ] 2>/dev/null && [ "${_cnt}" != "?" ]; then
    _ratio=$(awk "BEGIN{printf \"%.2f\", ${_cnt}/${_sf}}")
    _sfdisp="${_sf}"
    [ "${_cnt}" -ge "${_sf}" ] && _bad="${_bad}全覆盖 "
  else
    _ratio="n/a"; _sfdisp="n/a"
  fi
  if [ -n "${_bad}" ]; then
    echo "  ✗ ${_name}：${_cnt} 条 / 扫描面 ${_sfdisp}（比值 ${_ratio}）——${_bad}⇒ 门禁形同虚设"
    VIOL=$((VIOL + 1)); LEDGER_FAIL=1
  else
    echo "  ✓ ${_name}：${_cnt} 条 / 扫描面 ${_sfdisp}（比值 ${_ratio}）· 引用 ${_refs}"
  fi
}
for _L in \
  tools/check/silent-catch-baseline.json \
  tools/check/silent-catch-prefilter-exempt.json \
  tools/check/archaeology-exempt.json \
  tools/check/cross-package-relative-exempt.json \
  tools/check/knowledge-legacy-path-exempt.json \
  tools/check/npm-claims-exempt.json ; do
  _ledger_assert "${_L}"
done
if [ "$LEDGER_FAIL" -eq 0 ]; then
  echo "  ✓ ④c 豁免台账自证全部在岗（非孤儿 + 非全覆盖两条断言均已生效）"
fi

# ============================================================
# ⑤ echo|grep -q SIGPIPE 毒方：`echo "$VAR" | grep -q PAT` 在 set -o pipefail 下，
#    变量大输出 + grep -q 提前退出 → echo 收 SIGPIPE exit 141 → pipefail 判失败。
#    实案：acceptance-test.sh S378 bump dry-run（71462 字节）在 bash 下确定性假红。
#    修法：字面量改 [[ "$VAR" == *PAT* ]]；正则改 grep -q PAT <<< "$VAR"。
# ============================================================
echo ""
echo "── ⑤ echo|grep -q SIGPIPE 毒方（pipefail 下假红源）──"
SIGPIPE_HITS=0
_SIGPIPE_SCAN=$(guard_scan_files | while IFS= read -r _sh; do
    [ "$_sh" = "$SELF" ] && continue
    # 匹配 echo "$VAR" | grep -q —— 变量展开后接管道 grep 的形态（含 ${!VAR} 间接形态）
    grep -nE 'echo[[:space:]]+\"\$[A-Za-z_{][^\"]*\"[[:space:]]*\|[[:space:]]*grep[[:space:]]+-[A-Za-z]*q' "$_sh" 2>/dev/null \
      | grep -vE '^[0-9]+:[[:space:]]*#' \
      | grep -v 'guards-allow' \
      | sed "s|^|${_sh}:|" || true
  done | sort -u)
while IFS= read -r _line; do
  [ -z "$_line" ] && continue
  echo "  ✗ ${_line}"
  echo "      修法：字面量匹配改 [[ \"\$VAR\" == *PAT* ]]（bash 内建零管道）；正则改 grep -q PAT <<< \"\$VAR\"（herestring 无 SIGPIPE 面）"
  VIOL=$((VIOL + 1))
  SIGPIPE_HITS=$((SIGPIPE_HITS + 1))
done <<EOF
${_SIGPIPE_SCAN}
EOF
if [ "$SIGPIPE_HITS" -eq 0 ]; then
  echo "  ✓ 无 echo|grep -q 毒方残留（herestring/内建匹配形态）"
fi

# ============================================================
# --inject 注入实测（显式触发）：每门禁注入坏样本验证必红
# ============================================================
if [ "$MODE" = "inject" ]; then
  echo ""
  echo "════════════════════════════════════════════"
  echo "── --inject 注入实测 ──"
  echo "════════════════════════════════════════════"
  # 前置：注入目标文件必须干净。还原自 v1.4.8 第2批起改为 **cp 备份副本**
  # （原先用 `git checkout -- <file>` 还原：目标文件若带未提交改动，还原会把
  #   它们整片抹掉——实测发生过一次误伤并行 session 的事故，故彻底弃用 git 还原）。
  # 「不干净即拒绝」语义保留：cp 还原能保住注入前的字节，但注入窗口内若有并行
  # 写入仍会被覆盖，故仍拒绝在他人未提交改动上开窗口。
  INJECT_TARGETS="tools/check/check-action-pins.sh README.md tools/check/check-deps.sh"
  _dirty_targets=""
  for _t in $INJECT_TARGETS; do
    if git status --porcelain -- "$_t" 2>/dev/null | grep -q .; then
      _dirty_targets="${_dirty_targets} $_t"
    fi
  done
  if [ -n "$_dirty_targets" ]; then
    echo "❌ 注入目标文件不干净：${_dirty_targets}——注入窗口内会覆盖并行 session 的未提交改动，拒绝执行"
    echo "   先 commit 上述文件后再跑 --inject"
    exit 1
  fi

  # 备份副本：注入前逐字节快照，还原 = cp 回写（全程不调用 git，零误伤面）
  GUARDS_BACKUP_DIR="$(mktemp -d 2>/dev/null || echo "/tmp/guards-inject-backup-$$")"
  mkdir -p "${GUARDS_BACKUP_DIR}" || { echo "❌ 无法创建备份目录 ${GUARDS_BACKUP_DIR}"; exit 2; }
  for _t in $INJECT_TARGETS; do
    cp "$_t" "${GUARDS_BACKUP_DIR}/$(echo "$_t" | tr '/' '_')" || {
      echo "❌ 备份失败：$_t —— 拒绝在无备份的情况下注入"
      exit 2
    }
  done
  # 还原函数：cp 备份回写（备份缺失 = fail-loud，不静默跳过）
  # 注：用 local 避免覆盖调用方循环变量（本脚本多处用 _t 作循环变量）
  guards_restore() {
    local _t="$1"
    local _bak
    _bak="${GUARDS_BACKUP_DIR}/$(echo "$_t" | tr '/' '_')"
    if [ ! -f "${_bak}" ]; then
      echo "❌ 还原失败：备份缺失 ${_bak}（注入产物可能残留，请手工核对 ${_t}）"
      return 1
    fi
    cp "${_bak}" "$_t"
  }
  # 退出时清理备份目录（含异常路径——不让 /tmp 残留快照）
  trap 'rm -rf "${GUARDS_BACKUP_DIR}"' EXIT

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
  guards_restore tools/check/check-action-pins.sh
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
  guards_restore README.md
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
    guards_restore README.md
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
  guards_restore tools/check/check-deps.sh
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
    echo "❌ 注入后目标文件残留：${_after}——检查 guards_restore 还原逻辑"
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
