#!/usr/bin/env bash
# ============================================================
# tools/check/lib/coverage-line.sh · 门禁覆盖度行统一范式（v1.4.9 G-2②）
# ============================================================
#
# 门禁目的：「门禁绿 = 增量为零 ≠ 债清零」——旧门禁只报「断言全通过」，不报
#   「多少断言真的跑了、多少被跳过」。四层稀释实测（第 3 份审查报告）：
#     ① 锚定串不命中即「天然通过」放行（G-1 已修）
#     ② 只判两种形态、语义盲区不计（check-silent-catch 空 catch 之外的吞错形态）
#     ③ 文件级前置过滤静默跳过（check-silent-catch :81-82，617 个 .ts 跳过 167 个）
#     ④ 存量基线豁免（silent-catch-baseline.json 304 条）
#   共性：**跳过是看不见的**。本范式让跳过可见、可 grep、可被发版 SOP 逐条裁决。
#
# 输出格式（稳定契约，供 CI / 发版 SOP 裁决步骤 grep）：
#   [check:coverage] script=<名> asserts=<判定数> covered=<覆盖数> skipped=<跳过数>
#
# 字段语义（各脚本在调用点注释自己的口径，禁止含糊）：
#   asserts  本轮真正做出判定的断言数（PASS + FAIL）。不计入被跳过项。
#            实现口径允许两类：① 脚本自带计数器求和；② 结果行数（`  ✓` + `  ❌`）。
#   covered  本轮被读取/判定的文件数；无法廉价统计时填 `-`（**禁止编造数字**）。
#   skipped  显式跳过的断言/文件数。**不得有跳过却填 0**——静默跳过正是本范式要杀的形态。
#
# 退出码契约：**K>0 不改变调用方退出码**（跳过的合法性由发版 SOP
#   「SKIP 数逐条裁决」步骤裁定，不由门禁自裁），但**必须打印**。
#
# 用法（在 check-*.sh 内）：
#   _SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
#   . "${_SELF_DIR}/lib/coverage-line.sh"
#   ...
#   emit_coverage_line "check-docs" "${ASSERTS}" "${COVERED}" "${SKIPS}"
#   exit "${ERRORS}"-derived-code
#
# 推广方式（其余 30+ 个 check-*.sh 的落地路径，本批只落 5 个核心脚本）：
#   1. 脚本头加 `_SELF_DIR` + `. lib/coverage-line.sh` 两行（cd 之前——cd 后相对路径失效）
#   2. 初始化 `ASSERTS=0` / `SKIPS=0`（`set -u` 下缺一即 unbound 崩溃）
#   3. 结果行统一形态 `echo "  ✓ ...` / `echo "  ❌ ...` → 前缀插计数器
#      （批量手法：`sed` 对固定前缀做全量插桩，或脚本已自带 PASS/FAIL 计数器则直接求和）
#   4. 每个 skip 分支（⏭️ / continue 跳过）加 `SKIPS=$((SKIPS + 1))`
#   5. 结尾每个 `exit` 分支之前 emit（含早退分支，否则早退路径静默无覆盖度行）
#   ⚠️ 未落地的脚本 = 覆盖度盲区，与「跳过不可见」同病：分批推进，禁止为凑数牺牲正确性。
#
# Node 侧（check-silent-catch.mjs 等 .mjs 门禁）：无 source 机制，按同一行格式
#   自行 printf/console.log，字段语义与上表逐字对齐（见该脚本内 `emitCoverage`）。
# ============================================================

# emit_coverage_line <script名> <断言数> <覆盖数> <跳过数>
# F-13 空转检测（通电性硬项）：asserts=0 且 covered>0 ⇒ 门禁「装了没通电」——
#   扫了面但零判定，全绿输出与「没跑」无差别。此态 exit 2（独立于调用方自有
#   退出码语义：调用方 exit 0/1 前先被本函数前置拦截——通过写「 coaster 旗标
#   文件」由调用方在最终 exit 前检查的方式会改 45 个调用方，故取 bash 内建
#   return-code 透传：本函数 exit 2 即整个脚本 exit 2。CI 语境 exit 2 = 红）。
#   豁免面：covered 为 `-`（脚本声明无法廉价统计）不触发；asserts>0 不触发。
emit_coverage_line() {
  local _cov_script="${1:-unknown}"
  local _cov_asserts="${2:-0}"
  local _cov_covered="${3:--}"
  local _cov_skipped="${4:-0}"
  printf '[check:coverage] script=%s asserts=%s covered=%s skipped=%s\n' \
    "${_cov_script}" "${_cov_asserts}" "${_cov_covered}" "${_cov_skipped}"
  if [ "${_cov_asserts}" = "0" ] && [ "${_cov_covered}" != "-" ] && [ "${_cov_covered}" != "0" ] && [ "${_cov_covered}" != "" ]; then
    printf '❌ [check:coverage] 门禁空转：covered=%s 但零断言（asserts=0）——判定面存在而无一执行，装了没通电\n' "${_cov_covered}" >&2
    exit 2
  fi
}
