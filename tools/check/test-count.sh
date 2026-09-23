#!/usr/bin/env bash
# ============================================================
# test-count.sh · 汇总 workspace 各包测试数（SSOT 反查 · 门禁用）
# ============================================================
# 逐包遍历有 test script 的 workspace 包，各自跑测试并提取 Tests 数，
# 汇总总计。失败时退出码 1（供 pre-push-check.sh 门禁拦截）。
#
# 与 check-version.sh / check-docs.sh 同源定位：本脚本是"测试数"这道门禁。
# v1.1.4 修复前 test-count.sh 存在两处缺陷：
#   1. grep '^Tests\s+' 用行首锚定，但 vitest 输出带前导空格 → 永远匹配 0 行
#   2. 包名靠 engine/[a-z-]+ 提取，而 npm workspaces 吞掉包名行 → 永远显示 ?
# 现改为逐包遍历（包名已知），彻底规避解析歧义。
#
# 用法:
#   ./tools/check/test-count.sh           # 跑全量，汇总 + 退出码
#   ./tools/check/test-count.sh --quiet   # 只输出机器可读的 TOTAL_TESTS= 行（供检查脚本 grep）
#
# flaky 可定位性（2026-09-12）：命中 flaky 时自动把**首跑原文**留档到
#   /tmp/sofagent-test-count-<pkg>-flaky.log（复跑留档 -flaky-retry.log），
#   并在输出中打印该路径与首跑失败用例定位行（FAIL / × / → / AssertionError）。
#   路径不含 PID ⇒ 下次复现时仍可寻回，不再「知道 flaky 存在但查不出是哪条」。
#
# 退出码:
#   0 = 全部通过（部分包无测试视为正常）
#   1 = 有包测试失败
#
# ── 追因登记（2026-08-29 v1.4.3 bugfix 批 · 任务十方案2）──
# audit 包偶发「首跑无汇总、复跑通过」（FLAKY_PKGS=audit FLAKY_COUNT=1）：
#   2026-08-29 三轮审查实证 1 次、同日复验未复现（主因排查：本机 vitest 缓存竞争，
#   三轮跑时与会话并发的 vitest 缓存活动有关）。下次复现时先清缓存跑对照组：
#     rm -rf engine/audit/node_modules/.vitest && bash tools/check/test-count.sh
#   对照组仍复现再考虑锁 vitest pool/sequence 配置根治（单次未复现事件暂缓投入）。
# ============================================================

set -uo pipefail
# set -u 下必须预初始化：flaky 复跑分支首次追加前若未赋值会崩 unbound variable
FLAKY_PKGS=""
# v1.3.9 四十九：flaky 复跑次数计数（首跑失败→复跑全绿的包数，供 human 追因与采信上限）
FLAKY_COUNT=0
# 2026-09-12：flaky 证据落盘清单（机器可读）——稳定路径、不含 PID，
# 「下次复现时」仍能寻回首跑原文。必须在此预初始化：set -u 下首次
# 自引用拼接（FLAKY_LOGS="${FLAKY_LOGS}…"）若未初始化会崩 unbound variable
# （同 FLAKY_PKGS 的 v1.3.7 实案，check-tool-health.sh ⑥ 有静态守卫）。
FLAKY_LOGS=""

cd "$(dirname "$0")/../.." || exit 1

# ── 参数 ──
QUIET=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "test-count.sh — Workspace 测试数汇总（门禁用）"
      echo "  --quiet   只输出 TOTAL_TESTS= / PASSED= / FAILED= 机器可读行"
      exit 0 ;;
  esac
done

# ── 颜色 ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ── flaky 可定位性（2026-09-12 补 · 只增可观测性，不改判据语义）──
# 缺陷背景：此前 flaky 分支只报「包级」结论（`⚠ train: 首跑 1 失败，复跑全绿`），
# 且首跑日志与复跑日志共用同一个 `-$$.log` 路径、读完当场 `rm` ⇒ 报告发出时
# **证据已销毁**，flaky 退化成一桩「知道它存在、永远查不出是哪条用例」的悬案。
# 现约定：flaky 命中时把**首跑原文**（含失败用例名/断言栈）落盘到稳定路径
# （不含 PID——带 PID 的路径下次复现就找不到了），并当场抽出失败定位行打印。
#
# 规则：$VAR 后紧跟非 ASCII 字符必须写 ${VAR} 显式定界（check-cjk-var.sh 铁律）。

# 从 vitest 输出中抽「失败定位行」：文件/用例名（FAIL 行、× 行）、断言原因（→ 行）。
# 输入=原始输出（可含 ANSI）；输出=至多 20 行；无命中时输出空（不报错）。
extract_fail_locs() {
  LC_ALL=C sed $'s/\033\[[0-9;]*m//g' \
    | grep -E '^[[:space:]]*(FAIL|[×✗✕])[[:space:]]|^[[:space:]]*→ |AssertionError' \
    | head -20 \
    || true
}

# flaky 证据落盘 + 打印。$1=包名  $2=首跑原文  $3=复跑原文
# 副作用：写 2 个稳定路径日志；追加 FLAKY_LOGS 清单；非 quiet 时打印路径与失败定位。
persist_flaky_evidence() {
  _pe_pkg="$1"
  _pe_first="$2"
  _pe_retry="$3"
  _pe_log="/tmp/sofagent-test-count-${_pe_pkg}-flaky.log"
  _pe_rlog="/tmp/sofagent-test-count-${_pe_pkg}-flaky-retry.log"
  printf '%s\n' "$_pe_first" > "$_pe_log" 2>/dev/null || true
  printf '%s\n' "$_pe_retry" > "$_pe_rlog" 2>/dev/null || true
  FLAKY_LOGS="${FLAKY_LOGS}${_pe_log} "
  [ "$QUIET" = false ] || return 0
  echo -e "      首跑日志（含失败用例）: ${_pe_log}"
  echo -e "      复跑日志（对照组）:     ${_pe_rlog}"
  _pe_hits=$(printf '%s\n' "$_pe_first" | extract_fail_locs)
  if [ -n "$_pe_hits" ]; then
    echo -e "      ↓ 首跑失败定位（文件 / 用例 / 断言）:"
    printf '%s\n' "$_pe_hits" | sed 's/^/        /'
  else
    echo -e "      （首跑日志未匹配到 FAIL/×/Error 形态行——请直接查看上方日志文件全文）"
  fi
}

# ── 收集有 test script 的 workspace 包（⚠️ 与 `npm test --workspaces --if-present` 并**非**全量语义一致：本脚本统计面 = engine/ 下单层 13 个模块包；根 package.json workspaces 共 27 个、含 test script 者 25 个——插件包（dsh/openclaw）、load-chain 与 dsh-plugin-kit 工具包不在本统计面。口径详见下方 T8/R3 说明）──
# 注意：macOS /bin/bash 是 3.2，无 mapfile 内建，用 command substitution + herestring 兼容写法
#
# v1.4.5 (T8/R3) 口径说明——实测「13 包有 test script」与两处对账口径的关系
#   （v1.5.1 M12 修正：原注释仍写更名前旧名 `harness`、漏 `inject`，与实测分叉）：
#   本脚本遍历 engine/ 下「单层有 package.json 且声明 test script」的包，实测 13
#   个（ab-test / audit / core / daemon / eval / evolve / inject / mcp / ontology /
#   orchestrator / rules / think / train）。engine/umbrella 有 package.json 但无
#   test script ⇒ 不计入；engine/hooks、engine/scripts、engine/dsh-plugins、
#   engine/openclaw-plugins 是目录容器（自身无 package.json）⇒ 不经单层遍历。
#   check-test-count.sh 的 WORKSPACE_COUNT 数的是 package.json workspaces 清单里的
#   模块包，与本文**同名同值但不同源**：这里是**遍历派生**（自动跟随更名/新增），
#   那里是一张**硬编码的 13 名清单**（`engine/(inject|ontology|…)`）——因此模块包
#   **更名或新增时必须同批改两处**（v1.4.8 harness→inject 更名时本行曾漏改，正是
#   本轮修正的对象；硬编码那处见 check-version.sh §1 的同族条目 F7）。
#   嵌套包（engine/dsh-plugins/*/ 或 engine/openclaw-plugins/*/）不经 readdirSync
#   单层遍历进入本清单——它们的测试由各自包内手动跑，
#   不进 workspace 门禁汇总。
PKG_LIST=$(node -e '
  const fs = require("fs"), path = require("path");
  const root = "engine";
  const dirs = [];
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      const pj = path.join(root, d, "package.json");
      if (fs.existsSync(pj)) {
        try {
          const p = JSON.parse(fs.readFileSync(pj, "utf8"));
          if (p.scripts && p.scripts.test) dirs.push(path.join(root, d));
        } catch (e) { /* 跳过非法 JSON */ }
      }
    }
  }
  console.log(dirs.join("\n"));
' 2>/dev/null)

TOTAL_TESTS=0
TOTAL_PASSED=0
TOTAL_FAILED=0
PKG_COUNT=0
FAILED_PKGS=0

# ── 低内存机器 vitest 串行化（2026-08-30 修复：并行假红三连发）──
# 8GB 本机实测（run-20260829-01 后三跑门禁）：vitest 默认并行 file 模式下
# daemon/mcp/audit/orchestrator/rules 反复「无 Tests 汇总且退出码非 0」假红，
# 同包 --no-file-parallelism 串行复跑全绿（daemon 274/274、mcp 154/154、
# audit 915/919→单跑 15/15、rules 93/93）。根因=并行 worker 抢 8GB 内存，
# vitest fork 崩溃无汇总输出。修 harness 不修测试：≤8GB 机器给包内 vitest
# 注入 --no-file-parallelism（file 级串行，测试本身仍并行语义不变），大内存
# 机器不受影响。CI（GitHub Actions 7GB 报告内存）同样受益。
MEM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%d", $1/1073741824}')
SERIAL_FLAG=""
if [ -n "$MEM_GB" ] && [ "$MEM_GB" -le 8 ]; then
  SERIAL_FLAG="--no-file-parallelism"
  if [ "$QUIET" = false ]; then
    echo "  [串行化] 物理内存 ${MEM_GB}GB ≤ 8GB → vitest 注入 ${SERIAL_FLAG}（防并行假红）"
  fi
fi
export SOFAGENT_TEST_COUNT_SERIAL="$SERIAL_FLAG"

if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  sofagent · Workspace 测试数汇总（门禁）${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo ""
fi

while IFS= read -r pkg_dir; do
  [ -z "$pkg_dir" ] && continue
  pkg_name=$(basename "$pkg_dir")
  # 在包目录内跑该包的 test script（通常与 npm test --workspaces 同源）。
  # v1.3.9 四十九（吞码修复）：命令替换 + `|| true` 会吞掉 npm test 退出码——
  # 编译失败/进程崩溃时无 Tests 汇总行，此前被误判「无测试」静默跳过 = 假绿。
  # 改为先重定向到临时文件，再 echo $? 取真实退出码（BSD/macOS 兼容写法）。
  tmp_out="/tmp/sofagent-test-count-${pkg_name}-$$.log"
  (cd "$pkg_dir" && npm test -- $SOFAGENT_TEST_COUNT_SERIAL > "$tmp_out" 2>&1)
  test_code=$?
  out=$(cat "$tmp_out" 2>/dev/null) || true
  rm -f "$tmp_out"
  # 取该包最后的 Tests 汇总行（vitest 每包仅一行 Tests 汇总，无跨包 grand-total）
  # v1.2.3 修复：CI 环境（GitHub Actions）vitest 即使在非 TTY 下也输出 ANSI 颜色码，
  # 行首 \033[2m 导致 ^\s*Tests 永远不匹配。先 strip ANSI 再 grep。
  line=$(echo "$out" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -E '^[[:space:]]*Tests[[:space:]]+' | tail -1) || true
  if [ -z "$line" ]; then
    # 无 Tests 汇总行：区分「真无测试（退出码 0 = 正常跳过）」与「崩溃/编译失败
    # （退出码非 0 = 真失败）」。后者复跑一次排除 flaky；复跑仍非零 → 报红。
    if [ "$test_code" -ne 0 ]; then
      tmp_retry="/tmp/sofagent-test-count-${pkg_name}-$$.log"
      (cd "$pkg_dir" && npm test -- $SOFAGENT_TEST_COUNT_SERIAL > "$tmp_retry" 2>&1)
      retry_code=$?
      retry_out=$(cat "$tmp_retry" 2>/dev/null) || true
      rm -f "$tmp_retry"
      if [ "$retry_code" -eq 0 ]; then
        [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠${NC} ${pkg_name}: 首跑退出码 ${test_code}（无 Tests 汇总），复跑通过 → ${GREEN}flaky 候选${NC}"
        FLAKY_PKGS="${FLAKY_PKGS}${pkg_name} "
        FLAKY_COUNT=$((FLAKY_COUNT + 1))
        persist_flaky_evidence "$pkg_name" "$out" "$retry_out"
      else
        [ "$QUIET" = false ] && echo -e "  ${RED}✗${NC} ${pkg_name}: 无 Tests 汇总且退出码非 0（首跑 ${test_code} / 复跑 ${retry_code}，真失败）"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
        FAILED_PKGS=$((FAILED_PKGS + 1))
      fi
      PKG_COUNT=$((PKG_COUNT + 1))
      continue
    fi
    # v1.4.9 阶段三：退出码 0 但**有输出却提不出汇总** = 解析失败（真事故）——
    # 此前按「无 Tests 输出（跳过）」静默不计入 ⇒ 整包测试数凭空蒸发，门禁只报「文档数字漂移」
    # （实锤：acceptance 场景 165 报「README 缺测试数 3604」= 4805 − audit 1201；根因是 ANSI
    #  剥离链在本机 locale 下遇多字节日志报 illegal byte sequence、输出为空，已改 LC_ALL=C）。
    # 判据：有输出 = 解析链失灵（红，附原文首行供定位）；无输出 = 真·无测试（跳过）。
    if [ -n "$(echo "$out" | LC_ALL=C tr -d '[:space:]')" ]; then
      echo -e "  ${RED}✗${NC} ${pkg_name}: 退出码 0 但有输出未提取到 Tests 汇总（解析失败，计数不可信）"
      echo "$out" | head -3 | sed 's/^/        /'
      TOTAL_FAILED=$((TOTAL_FAILED + 1))
      FAILED_PKGS=$((FAILED_PKGS + 1))
      PKG_COUNT=$((PKG_COUNT + 1))
      continue
    fi
    [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠${NC} ${pkg_name}: 无 Tests 输出（跳过）"
    continue
  fi
  # P0 修复（F-11 第二层）：漏收集防御——vitest 并发干扰下测试文件可能被漏收集
  # （orchestrator 实测 898→733 静默变少）。vitest v4 输出（实测）：
  #   Test Files  63 passed (63)     ← 前一个数是 done，括号内是 total
  # done < total 且全 passed = 漏收集 = 本轮结果不可信，WARN 拒绝采纳（宁缺毋假）。
  # 兜底：任一解析失败（格式变化/无该行/带 failed|skipped 段）只跳过校验不判死
  # （防御失效优于门禁误杀；带 failed 的真失败走下方 flaky 复跑/FAIL 分支，不在此拦截）。
  # 用例级漂移（文件数同步缩水）由 check-test-count.sh 的 SSOT 对账兜底，两层互补。
  files_line=$(echo "$out" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -E '^[[:space:]]*Test Files[[:space:]]+' | tail -1)
  files_done=$(echo "$files_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "")
  files_total=$(echo "$files_line" | grep -oE '\([0-9]+\)' | tr -d '()' || echo "")
  if [ -n "$files_done" ] && [ -n "$files_total" ] && grep -qE '^[[:space:]]*Test Files[[:space:]]+[0-9]+ passed \([0-9]+\)\s*$' <<< "$files_line"; then
    if [ "$files_done" -lt "$files_total" ]; then
      echo "  ⚠ ${pkg_name}: Test Files ${files_done}/${files_total} 漏收集——本轮计数不可信，需复跑"
      continue
    fi
  fi
  PASSED=$(echo "$line" | grep -oE '[0-9]+[[:space:]]+passed' | grep -oE '[0-9]+' || echo "0")
  FAILED=$(echo "$line" | grep -oE '[0-9]+[[:space:]]+failed' | grep -oE '[0-9]+' || echo "0")
  TOTAL=$(echo "$line" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")

  # v1.3.6 B14: flaky 候选自动复跑——全量串行逐包时 IO 争用偶发超时（orchestrator 实测
  # 745/746 单跑全绿）。复跑过 = 记录 WARN「flaky 候选」不静默（假绿温床），复跑仍败才判 FAIL。
  # 教训：假红与假绿同罪——门禁结果不可预测会消解一切门禁权威性。
  if [ "$FAILED" -gt 0 ]; then
    FAILED_ORIG=$FAILED
    # v1.3.9 四十九：复跑同样捕获退出码（tmp 文件 + $?，BSD 兼容）
    tmp_retry="/tmp/sofagent-test-count-${pkg_name}-$$.log"
    (cd "$pkg_dir" && npm test -- $SOFAGENT_TEST_COUNT_SERIAL > "$tmp_retry" 2>&1)
    retry_code=$?
    retry_out=$(cat "$tmp_retry" 2>/dev/null) || true
    rm -f "$tmp_retry"
    retry_line=$(echo "$retry_out" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -E '^[[:space:]]*Tests[[:space:]]+' | tail -1) || true
    RETRY_PASSED=$(echo "$retry_line" | grep -oE '[0-9]+[[:space:]]+passed' | grep -oE '[0-9]+' || echo "0")
    RETRY_FAILED=$(echo "$retry_line" | grep -oE '[0-9]+[[:space:]]+failed' | grep -oE '[0-9]+' || echo "0")
    RETRY_TOTAL=$(echo "$retry_line" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")
    if [ -n "$retry_line" ] && [ "$RETRY_FAILED" = "0" ]; then
      # 复跑全绿 → flaky 候选：采用复跑结果（PASSED/TOTAL 取复跑值），WARN 记录 + 计数
      PASSED=$RETRY_PASSED
      FAILED=0
      TOTAL=$RETRY_TOTAL
      [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠${NC} ${pkg_name}: 首跑 ${FAILED_ORIG} 失败，复跑全绿 → ${GREEN}flaky 候选${NC}（已采用复跑结果，待定位根因，勿习惯性忽略）"
      # 复跑过的包记录到 flaky 名单（供 human 追因）+ 计数
      FLAKY_PKGS="${FLAKY_PKGS}${pkg_name} "
      FLAKY_COUNT=$((FLAKY_COUNT + 1))
      # 2026-09-12：落盘首跑/复跑原文 + 打印失败用例定位——让 flaky 下次可追（不改判据）
      persist_flaky_evidence "$pkg_name" "$out" "$retry_out"
    else
      # 复跑仍失败（或无 Tests 汇总 = 复跑崩溃）→ 真失败：FAILED 保持首跑值，如实报红
      [ "$QUIET" = false ] && echo -e "  ${RED}✗${NC} ${pkg_name}: 复跑仍 ${RETRY_FAILED:-?} failed（真失败，非 flaky）"
      FAILED=$FAILED_ORIG
    fi
  fi

  TOTAL_TESTS=$((TOTAL_TESTS + TOTAL))
  TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
  PKG_COUNT=$((PKG_COUNT + 1))

  if [ "$FAILED" -gt 0 ]; then
    [ "$QUIET" = false ] && echo -e "  ${RED}✗${NC} ${pkg_name}: ${PASSED} passed / ${FAILED} failed (${TOTAL} tests)"
    FAILED_PKGS=$((FAILED_PKGS + 1))
  else
    [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} ${pkg_name}: ${PASSED} passed (${TOTAL} tests)"
  fi
done <<< "$PKG_LIST"

if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "  包数: ${PKG_COUNT}  通过: ${GREEN}${TOTAL_PASSED}${NC}  总计: ${BOLD}${TOTAL_TESTS} tests${NC}"
  if [ "$TOTAL_FAILED" -gt 0 ]; then
    echo -e "  失败: ${RED}${TOTAL_FAILED}${NC}  失败包数: ${RED}${FAILED_PKGS}${NC}"
  fi
  if [ "$FLAKY_COUNT" -gt 0 ]; then
    echo -e "  flaky 复跑: ${YELLOW}${FLAKY_COUNT}${NC} 包（首跑失败复跑全绿，待追因）"
    [ -n "$FLAKY_LOGS" ] && echo -e "  flaky 证据留档（首跑原文含失败用例）: ${FLAKY_LOGS}"
  fi
  echo ""
  echo -e "  CHANGELOG 写法: ${GREEN}${TOTAL_TESTS} tests across ${PKG_COUNT} packages（workspace 汇总口径）${NC}"
  echo ""
fi

# 机器可读行（供 regression-checklist / 其他脚本 grep）
echo "TOTAL_TESTS=$TOTAL_TESTS PASSED=$TOTAL_PASSED FAILED=$TOTAL_FAILED PKGS=$PKG_COUNT"
# v1.3.6 B14: flaky 名单机器可读行（空 = 无复跑；非空 = 有包首跑失败复跑全绿，待追因）
echo "FLAKY_PKGS=${FLAKY_PKGS:-}"
# v1.3.9 四十九：flaky 复跑次数（机器可读，供采信上限/追因对账）
echo "FLAKY_COUNT=${FLAKY_COUNT}"
# 2026-09-12：flaky 证据留档路径（机器可读；空 = 本次无 flaky）。
# 值形如 `/tmp/sofagent-test-count-<pkg>-flaky.log `（首跑原文，含失败用例名与断言栈）。
echo "FLAKY_LOGS=${FLAKY_LOGS:-}"

if [ "$TOTAL_FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
