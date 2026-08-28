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

# ── 收集有 test script 的 workspace 包（与 npm test --workspaces --if-present 语义一致）──
# 注意：macOS /bin/bash 是 3.2，无 mapfile 内建，用 command substitution + herestring 兼容写法
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
  (cd "$pkg_dir" && npm test > "$tmp_out" 2>&1)
  test_code=$?
  out=$(cat "$tmp_out" 2>/dev/null) || true
  rm -f "$tmp_out"
  # 取该包最后的 Tests 汇总行（vitest 每包仅一行 Tests 汇总，无跨包 grand-total）
  # v1.2.3 修复：CI 环境（GitHub Actions）vitest 即使在非 TTY 下也输出 ANSI 颜色码，
  # 行首 \033[2m 导致 ^\s*Tests 永远不匹配。先 strip ANSI 再 grep。
  line=$(echo "$out" | sed $'s/\033\[[0-9;]*m//g' | grep -E '^\s*Tests\s+' | tail -1) || true
  if [ -z "$line" ]; then
    # 无 Tests 汇总行：区分「真无测试（退出码 0 = 正常跳过）」与「崩溃/编译失败
    # （退出码非 0 = 真失败）」。后者复跑一次排除 flaky；复跑仍非零 → 报红。
    if [ "$test_code" -ne 0 ]; then
      tmp_retry="/tmp/sofagent-test-count-${pkg_name}-$$.log"
      (cd "$pkg_dir" && npm test > "$tmp_retry" 2>&1)
      retry_code=$?
      rm -f "$tmp_retry"
      if [ "$retry_code" -eq 0 ]; then
        [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠${NC} ${pkg_name}: 首跑退出码 ${test_code}（无 Tests 汇总），复跑通过 → ${GREEN}flaky 候选${NC}"
        FLAKY_PKGS="${FLAKY_PKGS}${pkg_name} "
        FLAKY_COUNT=$((FLAKY_COUNT + 1))
      else
        [ "$QUIET" = false ] && echo -e "  ${RED}✗${NC} ${pkg_name}: 无 Tests 汇总且退出码非 0（首跑 ${test_code} / 复跑 ${retry_code}，真失败）"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
        FAILED_PKGS=$((FAILED_PKGS + 1))
      fi
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
  files_line=$(echo "$out" | sed $'s/\033\[[0-9;]*m//g' | grep -E '^\s*Test Files\s+' | tail -1)
  files_done=$(echo "$files_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "")
  files_total=$(echo "$files_line" | grep -oE '\([0-9]+\)' | tr -d '()' || echo "")
  if [ -n "$files_done" ] && [ -n "$files_total" ] && echo "$files_line" | grep -qE '^\s*Test Files\s+[0-9]+ passed \([0-9]+\)\s*$'; then
    if [ "$files_done" -lt "$files_total" ]; then
      echo "  ⚠ ${pkg_name}: Test Files ${files_done}/${files_total} 漏收集——本轮计数不可信，需复跑"
      continue
    fi
  fi
  PASSED=$(echo "$line" | grep -oE '[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")
  FAILED=$(echo "$line" | grep -oE '[0-9]+\s+failed' | grep -oE '[0-9]+' || echo "0")
  TOTAL=$(echo "$line" | grep -oE '\([0-9]+\)' | grep -oE '[0-9]+' || echo "0")

  # v1.3.6 B14: flaky 候选自动复跑——全量串行逐包时 IO 争用偶发超时（orchestrator 实测
  # 745/746 单跑全绿）。复跑过 = 记录 WARN「flaky 候选」不静默（假绿温床），复跑仍败才判 FAIL。
  # 教训：假红与假绿同罪——门禁结果不可预测会消解一切门禁权威性。
  if [ "$FAILED" -gt 0 ]; then
    FAILED_ORIG=$FAILED
    # v1.3.9 四十九：复跑同样捕获退出码（tmp 文件 + $?，BSD 兼容）
    tmp_retry="/tmp/sofagent-test-count-${pkg_name}-$$.log"
    (cd "$pkg_dir" && npm test > "$tmp_retry" 2>&1)
    retry_code=$?
    retry_out=$(cat "$tmp_retry" 2>/dev/null) || true
    rm -f "$tmp_retry"
    retry_line=$(echo "$retry_out" | sed $'s/\033\[[0-9;]*m//g' | grep -E '^\s*Tests\s+' | tail -1) || true
    RETRY_PASSED=$(echo "$retry_line" | grep -oE '[0-9]+\s+passed' | grep -oE '[0-9]+' || echo "0")
    RETRY_FAILED=$(echo "$retry_line" | grep -oE '[0-9]+\s+failed' | grep -oE '[0-9]+' || echo "0")
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

if [ "$TOTAL_FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
