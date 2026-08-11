#!/usr/bin/env bash
# ============================================================
# check-test-count.sh · 文档声称测试数 vs 实际测试数一致性校验
# ============================================================
# P1-3 根治：文档硬编码测试数必然漂移（每次新增/删除测试用例
# 都得手动改 CHANGELOG/ROADMAP/LIMITATIONS/evidence.md）。
# 本脚本自动校验——跑 test-count.sh 拿 SSOT 真值，再 grep
# 各文档当前版本声称的数字，不匹配就 exit 1。
#
# 用法:
#   ./tools/check-test-count.sh           # 人读输出
#   ./tools/check-test-count.sh --quiet   # 只输出 OK/FAIL
#
# 退出码:
#   0 = 文档声称数全部与实际一致
#   1 = 有文档漂移（会列出具体文件+行号+声称值 vs 实际值）
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

QUIET=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "check-test-count.sh — 文档声称测试数 vs 实际一致性校验"
      echo "  --quiet   只输出 OK / FAIL"
      echo "  --help    显示帮助"
      exit 0 ;;
  esac
done

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0

# ── 跑 test-count.sh 拿 SSOT 真值 ──
if [ "$QUIET" = false ]; then
  echo -e "\n${BOLD}── 文档测试数一致性校验 ──${NC}"
  echo "  跑 test-count.sh 获取实际测试数..."
fi

# v1.2.3 修复：test-count.sh 非 quiet 模式的「总计」行带 ANSI BOLD 码（总计: \033[1m1207 tests），
# 在 CI 非 TTY 环境下 grep '总计: [0-9]+' 恒失败。优先信任 test-count.sh 末尾的机器可读行
# TOTAL_TESTS=NNN（该行不受 ANSI/quiet 守卫影响，恒输出），再回退到 quiet 模式与「总计」行。
TC_OUT=$(bash tools/test-count.sh 2>/dev/null)
TC_RC=$?
# v1.3.2 P0-R8 (P1-15): 修复门禁假绿——test-count.sh 的退出码此前被 $() 吞掉。
# 若任一包测试失败，test-count.sh 退出 1 但其输出仍含 TOTAL_TESTS=NNN（总数不变），
# 旧脚本只看 TOTAL_TESTS 与文档比对 → 文档匹配就返回 OK/EXIT=0，测试实际失败仍被放行。
# 修复：test-count.sh 自身失败（RC≠0）时直接 FAIL/exit 1，门禁真实反映测试状态。
if [ "$TC_RC" -ne 0 ]; then
  if [ "$QUIET" = false ]; then
    echo -e "  ${RED}✗ test-count.sh 失败（RC=$TC_RC）——有包测试失败或脚本错误，门禁红${NC}"
    echo -e "  ${YELLOW}修法：跑 bash tools/test-count.sh 看哪个包失败，修复测试后再跑本脚本${NC}"
  else
    echo "FAIL"
  fi
  exit 1
fi
# 主路径：机器可读行 TOTAL_TESTS=NNN（strip ANSI 后 grep，最鲁棒）
TOTAL_TESTS=$(echo "$TC_OUT" | sed $'s/\033\[[0-9;]*m//g' | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+' || echo "0")
# 回退 1：quiet 模式（同样有机器可读行）
if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  TOTAL_TESTS=$(bash tools/test-count.sh --quiet 2>/dev/null | sed $'s/\033\[[0-9;]*m//g' | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+' || echo "0")
fi
# 回退 2：非 quiet 的「总计: NNN tests」人读行（strip ANSI 后再匹配）
if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  TOTAL_TESTS=$(echo "$TC_OUT" | sed $'s/\033\[[0-9;]*m//g' | grep -oE '总计: [0-9]+ tests' | grep -oE '[0-9]+' || echo "0")
fi

if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  echo -e "  ${RED}✗ 无法获取实际测试数（test-count.sh 失败）${NC}"
  exit 1
fi

# P0-13: 实际包数（有 test script 的 workspace 包，SSOT 口径 "12 包"）——机器可读行 PKGS=NNN
PKG_COUNT=$(echo "$TC_OUT" | sed $'s/\033\[[0-9;]*m//g' | grep -oE 'PKGS=[0-9]+' | grep -oE '[0-9]+' | head -1 || echo "0")
[ -z "$PKG_COUNT" ] && PKG_COUNT=0

# audit 包单独数（从 test-count.sh 全量输出的逐包明细行提取，格式「✓ audit: 498 passed (498 tests)」）。
# v1.2.3 修复：不再单独跑 engine/audit && npm test —— 该路径的 vitest 输出同样带 ANSI 码，
# 在 CI 非 TTY 下 grep '^\s*Tests\s+' 恒失败。复用 TC_OUT 的明细行，strip ANSI 后提取。
AUDIT_TESTS=$(echo "$TC_OUT" | sed $'s/\033\[[0-9;]*m//g' | grep -E 'audit:.*passed' | grep -oE '\([0-9]+ tests\)' | grep -oE '[0-9]+' | head -1 || echo "0")
[ -z "$AUDIT_TESTS" ] && AUDIT_TESTS=0

if [ "$QUIET" = false ]; then
  echo -e "  实际值：workspace ${TOTAL_TESTS} / audit ${AUDIT_TESTS}"
fi

# ── 校验各文档声称的当前版本测试数 ──
# 策略：grep 文档中 v1.1.7 段（最新已发布版）声称的测试数，与实际值比对。
# CHANGELOG.md: "**质量验证**：NNN tests" 格式（最新版本段）
# ROADMAP.md: "质量验证：NNN tests" 格式
# LIMITATIONS.md: "审计核心 NNN 个、全 workspace NNN 个" 格式
# evidence.md: "v1.1.7 为 NNN" 格式（历史快照最后一列）

check_doc() {
  local label="$1" file="$2" pattern="$3" expected="$4"
  local actual
  actual=$(grep -oE "$pattern" "$file" 2>/dev/null | head -1 | grep -oE '[0-9]+' || echo "")
  if [ -z "$actual" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ ${label}：未找到测试数声明（grep 模式未命中），跳过${NC}"
    fi
    return 0
  fi
  if [ "$actual" = "$expected" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ ${label}：${actual}${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ ${label}：声称 ${actual}，实际 ${expected}${NC}"
    echo -e "    文件：${file}"
    ((FAIL++)) || true
  fi
}

# 当前版本开发日志 — CHANGELOG.md 已改为纯目录索引（不再含测试数声明），
# 测试数声明在开发日志的「开发完成快照」行。F-09 (v1.3.0 bugfix)：
# 校验目标改为 docs/changelog/vX.Y/vX.Y.Z.md（从 engine/audit/package.json 提取版本号自动拼路径）。
# 格式："开发完成快照：... NNN 单元（单元测试数，与 SSOT 一致）" 或 "NNN tests across NN packages"。
# grep 未命中 → FAIL（与 WIKI/README 校验段一致，禁止静默跳过）。
CUR_VERSION=$(node -p "require('./engine/audit/package.json').version" 2>/dev/null || echo "1.2.9")
CUR_MAJOR_MINOR=$(echo "$CUR_VERSION" | cut -d. -f1-2)
DEVLOG_FILE="docs/changelog/v${CUR_MAJOR_MINOR}/v${CUR_VERSION}.md"
if [ -f "$DEVLOG_FILE" ]; then
  # v1.3.2 修复：未发版的占位 changelog（含「尚未实现」）跳过校验，不算 FAIL
  if grep -q '尚未实现' "$DEVLOG_FILE" 2>/dev/null; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ ${DEVLOG_FILE}：占位文件（尚未实现），跳过测试数校验${NC}"
    fi
  else
  # 优先「开发完成快照」行的单元数（1650 单元），回退 "NNN tests across"
  DEVLOG_LINE=$(grep -nE '开发完成快照.*[0-9]+ 单元|[0-9]+ tests across' "$DEVLOG_FILE" | head -1)
  if [ -n "$DEVLOG_LINE" ]; then
    DEVLOG_CLAIMED=$(echo "$DEVLOG_LINE" | grep -oE '[0-9]+ 单元' | head -1 | grep -oE '[0-9]+')
    if [ -z "$DEVLOG_CLAIMED" ]; then
      DEVLOG_CLAIMED=$(echo "$DEVLOG_LINE" | grep -oE '[0-9]+ tests across' | head -1 | grep -oE '[0-9]+')
    fi
    DEVLOG_LINENO=$(echo "$DEVLOG_LINE" | cut -d: -f1)
    if [ "$QUIET" = false ]; then
      echo -e "  校验 ${DEVLOG_FILE}（行 ${DEVLOG_LINENO}）..."
    fi
    if [ "$DEVLOG_CLAIMED" = "$TOTAL_TESTS" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ${DEVLOG_FILE}：${DEVLOG_CLAIMED}${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ ${DEVLOG_FILE}（行 ${DEVLOG_LINENO}）：声称 ${DEVLOG_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
      ((FAIL++)) || true
    fi
  else
    echo -e "  ${RED}✗ ${DEVLOG_FILE} 未找到「开发完成快照」测试数声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
    echo -e "    提示：CHANGELOG 已改为纯索引，测试数声明在开发日志中。请在本脚本校验目标处补正则。"
    ((FAIL++)) || true
  fi
  fi  # v1.3.2 修复：闭合「尚未实现」占位跳过的 if-else
else
  echo -e "  ${RED}✗ 当前版本开发日志 ${DEVLOG_FILE} 不存在（无法校验 → FAIL，禁止静默跳过）${NC}"
  ((FAIL++)) || true
fi

# ROADMAP.md — "质量验证：NNN tests" 格式（最新版本段）
ROADMAP_LINE=$(grep -nE '质量验证：[0-9]+ tests' docs/ROADMAP.md | head -1)
if [ -n "$ROADMAP_LINE" ]; then
  ROADMAP_CLAIMED=$(echo "$ROADMAP_LINE" | grep -oE '[0-9]+ tests' | head -1 | grep -oE '[0-9]+')
  ROADMAP_LINENO=$(echo "$ROADMAP_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 ROADMAP.md（行 ${ROADMAP_LINENO}）..."
  fi
  if [ "$ROADMAP_CLAIMED" = "$TOTAL_TESTS" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ ROADMAP.md：${ROADMAP_CLAIMED}${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ ROADMAP.md（行 ${ROADMAP_LINENO}）：声称 ${ROADMAP_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
    ((FAIL++)) || true
  fi
fi

# LIMITATIONS.md — "审计核心 NNN 个、全 workspace NNN 个" 格式
LIMITATIONS_LINE=$(grep -nE '审计核心 [0-9]+ 个、全 workspace [0-9]+ 个' docs/LIMITATIONS.md | head -1)
if [ -n "$LIMITATIONS_LINE" ]; then
  LIMITATIONS_AUDIT=$(echo "$LIMITATIONS_LINE" | grep -oE '审计核心 [0-9]+' | grep -oE '[0-9]+')
  LIMITATIONS_TOTAL=$(echo "$LIMITATIONS_LINE" | grep -oE '全 workspace [0-9]+' | grep -oE '[0-9]+')
  LIMITATIONS_LINENO=$(echo "$LIMITATIONS_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）..."
  fi
  local_fail=0
  if [ "$LIMITATIONS_AUDIT" != "$AUDIT_TESTS" ]; then
    echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）：audit 声称 ${LIMITATIONS_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$LIMITATIONS_TOTAL" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）：workspace 声称 ${LIMITATIONS_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ LIMITATIONS.md：audit ${LIMITATIONS_AUDIT} / workspace ${LIMITATIONS_TOTAL}${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
fi

# evidence.md — 历史快照最后一列（最新版本）"vX.Y.Z 为 NNN（audit 包）" + "全 workspace ... vX.Y.Z 为 NNN"
# evidence.md 是历史时间线，只校验最后一个版本（当前版本）的声称值
EVIDENCE_AUDIT=$(grep -oE 'v1\.1\.[0-9]+ 为 [0-9]+（audit 包）' docs/evidence/evidence.md | tail -1 | grep -oE '[0-9]+（audit' | grep -oE '[0-9]+' || echo "")
EVIDENCE_TOTAL=$(grep -oE '全 workspace.*v1\.1\.[0-9]+ 为 [0-9]+' docs/evidence/evidence.md | tail -1 | grep -oE '为 [0-9]+$' | grep -oE '[0-9]+' || echo "")
if [ -n "$EVIDENCE_AUDIT" ] && [ -n "$EVIDENCE_TOTAL" ]; then
  if [ "$QUIET" = false ]; then
    echo -e "  校验 docs/evidence/evidence.md..."
  fi
  local_fail=0
  if [ "$EVIDENCE_AUDIT" != "$AUDIT_TESTS" ]; then
    echo -e "  ${RED}✗ evidence.md：最新快照 audit ${EVIDENCE_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$EVIDENCE_TOTAL" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ evidence.md：最新快照 workspace ${EVIDENCE_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ evidence.md：audit ${EVIDENCE_AUDIT} / workspace ${EVIDENCE_TOTAL}${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
fi

# WIKI.md — "NNN 测试 / NN 包全绿" 格式
# P0-13: grep 未命中 → FAIL（不再静默跳过——正则失配说明检查正则有 bug 或文档缺失声明）
WIKI_LINE=$(grep -nE '[0-9]+ 测试 / [0-9]+ 包' docs/WIKI.md 2>/dev/null | head -1)
if [ -n "$WIKI_LINE" ]; then
  WIKI_CLAIMED=$(echo "$WIKI_LINE" | grep -oE '[0-9]+ 测试' | grep -oE '[0-9]+')
  WIKI_PKGS=$(echo "$WIKI_LINE" | grep -oE '[0-9]+ 包' | grep -oE '[0-9]+')
  WIKI_LINENO=$(echo "$WIKI_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 docs/WIKI.md（行 ${WIKI_LINENO}）..."
  fi
  local_fail=0
  if [ "$WIKI_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ WIKI.md（行 ${WIKI_LINENO}）：声称 ${WIKI_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ -n "$WIKI_PKGS" ] && [ "$WIKI_PKGS" != "$PKG_COUNT" ]; then
    echo -e "  ${RED}✗ WIKI.md（行 ${WIKI_LINENO}）：声称 ${WIKI_PKGS} 包，实际 ${PKG_COUNT} 包${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ WIKI.md：${WIKI_CLAIMED} 测试 / ${WIKI_PKGS} 包${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ docs/WIKI.md 未找到「N 测试 / N 包全绿」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  ((FAIL++)) || true
fi

# README.md — "NNN 测试 / NN 包" 格式（P0-13: grep 未命中 → FAIL）
README_PKG_LINE=$(grep -nE '[0-9]+ 测试 / [0-9]+ 包' README.md 2>/dev/null | head -1)
if [ -n "$README_PKG_LINE" ]; then
  README_CLAIMED=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 测试' | grep -oE '[0-9]+')
  README_PKGS=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 包' | grep -oE '[0-9]+')
  README_LINENO=$(echo "$README_PKG_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 README.md（行 ${README_LINENO}）..."
  fi
  local_fail=0
  if [ "$README_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_CLAIMED} 测试，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ -n "$README_PKGS" ] && [ "$README_PKGS" != "$PKG_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PKGS} 包，实际 ${PKG_COUNT} 包${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ README.md：${README_CLAIMED} 测试 / ${README_PKGS} 包${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ README.md 未找到「N 测试 / N 包」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  ((FAIL++)) || true
fi

# ARCHITECTURE.md — "audit ✅ 已实现（NNN 测试）" 逐包校验
# 获取各包实际测试数
for pkg in audit core orchestrator daemon; do
  PKG_LINE=$(grep -nE "\| ${pkg} \|.*已实现（[0-9]+ 测试）" docs/ARCHITECTURE.md 2>/dev/null | head -1)
  if [ -n "$PKG_LINE" ]; then
    PKG_CLAIMED=$(echo "$PKG_LINE" | grep -oE '已实现（[0-9]+ 测试' | grep -oE '[0-9]+')
    PKG_LINENO=$(echo "$PKG_LINE" | cut -d: -f1)
    PKG_ACTUAL=$(echo "$TC_OUT" | grep "${pkg}:.*passed" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
    if [ -z "$PKG_ACTUAL" ]; then
      PKG_ACTUAL=0
    fi
    if [ "$QUIET" = false ]; then
      echo -e "  校验 ARCHITECTURE.md ${pkg}（行 ${PKG_LINENO}）..."
    fi
    if [ "$PKG_CLAIMED" = "$PKG_ACTUAL" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ARCHITECTURE.md ${pkg}：${PKG_CLAIMED}${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ ARCHITECTURE.md（行 ${PKG_LINENO}）：${pkg} 声称 ${PKG_CLAIMED}，实际 ${PKG_ACTUAL}${NC}"
      ((FAIL++)) || true
    fi
  fi
done

# ── acceptance-test.sh 场景数守卫（F-01/F-02）──
# SSOT = acceptance-test.sh 头部「NNN 个场景」声明。三处文档
# （DEVELOPMENT.md / LIMITATIONS.md / changelog v1.2.3.md）必须与之一致。
# 绝不允许静默跳过：头部声明缺失 → 黄色 WARN（不骗绿）；
# 文档数字与 SSOT 不一致 → exit 1 并列出文件+行号。
ACCEPTANCE_ACTUAL=$(head -10 FORGE/playbook/acceptance-test.sh 2>/dev/null | grep -oE '[0-9]+ 个场景' | head -1 | grep -oE '[0-9]+' || echo "")
if [ -z "$ACCEPTANCE_ACTUAL" ]; then
  echo -e "  ${YELLOW}⚠ acceptance-test.sh 头部未找到「NNN 个场景」声明，场景守卫跳过（请在脚本头部补 SSOT 声明）${NC}"
else
  if [ "$QUIET" = false ]; then
    echo -e "  场景数 SSOT：acceptance-test.sh 头部声明 ${ACCEPTANCE_ACTUAL} 个场景"
  fi

  # ── 回数控件（v1.2.4 修复）：实测文件真实 scenario 调用数 vs SSOT 声明 ──
  # 这是守卫的核心，此前完全缺失——只比对"头部↔文档"，从不回数文件里的真实调用，
  # 导致 v1.2.3/v1.2.4 用带 bug 的裸 grep（把 echo 探针 "scenario 48/49" 误当声明）
  # 数出脏数 100/105 仍一路骗绿。精确口径：'scenario N "'（数字后紧跟空格+引号），
  # 真实场景调用恒为此格式；echo 探针为 'scenario 48"'（引号紧贴数字、前有空格），天然可区分。
  # v1.2.5: 正则扩展支持字母后缀（34b/34c/167a/167b），[0-9]+ → [0-9]+[a-z]?
  SCENARIO_REAL=$(grep -oE 'scenario [0-9]+[a-z]? "' FORGE/playbook/acceptance-test.sh 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SCENARIO_REAL" = "$ACCEPTANCE_ACTUAL" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ acceptance-test.sh 实测 ${SCENARIO_REAL} 个真实场景调用，与 SSOT 声明一致${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ acceptance-test.sh 实测 ${SCENARIO_REAL} 个真实场景调用，SSOT 声明 ${ACCEPTANCE_ACTUAL} —— 头部数字与文件实际不符${NC}"
    echo -e "    计数命令：grep -oE 'scenario [0-9]+[a-z]? \"' FORGE/playbook/acceptance-test.sh | wc -l"
    echo -e "    提示：勿用裸 grep 'scenario [0-9]+'（会把 echo 探针文本误算进去）"
    ((FAIL++)) || true
  fi

  # 逐个校验三处文档的场景数声称值
  check_scenario_doc() {
    local label="$1" file="$2" lineno="$3" claimed="$4"
    if [ "$claimed" = "$ACCEPTANCE_ACTUAL" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ${label}（行 ${lineno}）：${claimed} 场景${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ ${label}（行 ${lineno}）：声称 ${claimed} 场景，SSOT 声明 ${ACCEPTANCE_ACTUAL}${NC}"
      echo -e "    文件：${file}"
      ((FAIL++)) || true
    fi
  }

  # ① DEVELOPMENT.md — "acceptance-test.sh（NNN 场景）"
  DEV_LINE=$(grep -nE 'acceptance-test\.sh.*[0-9]+ 场景' docs/DEVELOPMENT.md 2>/dev/null | head -1)
  if [ -n "$DEV_LINE" ]; then
    check_scenario_doc "DEVELOPMENT.md" "docs/DEVELOPMENT.md" \
      "$(echo "$DEV_LINE" | cut -d: -f1)" \
      "$(echo "$DEV_LINE" | grep -oE '[0-9]+ 场景' | grep -oE '[0-9]+')"
  fi

  # ② LIMITATIONS.md — "acceptance-test.sh NNN 场景"（当前版本口径，取「发版前手动覆盖」行）
  # 注意：该行同时含「OpenClaw 验收 63 场景」，必须 head -1 只取 acceptance 的紧邻数字，
  # 否则 grep -oE 会连带捕获 63 造成误报。
  LIM_SCN_LINE=$(grep -nE 'acceptance-test\.sh [0-9]+ 场景' docs/LIMITATIONS.md 2>/dev/null | head -1)
  if [ -n "$LIM_SCN_LINE" ]; then
    check_scenario_doc "docs/LIMITATIONS.md" "docs/LIMITATIONS.md" \
      "$(echo "$LIM_SCN_LINE" | cut -d: -f1)" \
      "$(echo "$LIM_SCN_LINE" | grep -oE 'acceptance-test\.sh [0-9]+ 场景' | head -1 | grep -oE '[0-9]+')"
  fi

  # ③ changelog v1.2.3.md — 历史冻结文档，场景数不随当前 SSOT 变化（v1.2.3 发版时 SSOT=100）
  #    仅校验文档内部自洽（分母=分子），不与当前 SSOT 比对
  CHG_SCN_LINE=$(grep -nE '[0-9]+/[0-9]+ 场景 PASS' docs/changelog/v1.2/v1.2.3.md 2>/dev/null | head -1)
  if [ -n "$CHG_SCN_LINE" ]; then
    CHG_CLAIMED="$(echo "$CHG_SCN_LINE" | grep -oE '[0-9]+/[0-9]+ 场景' | head -1 | grep -oE '^[0-9]+')"
    CHG_DENOM="$(echo "$CHG_SCN_LINE" | grep -oE '[0-9]+/[0-9]+ 场景' | head -1 | grep -oE '/[0-9]+' | tr -d '/')"
    CHG_LINENO=$(echo "$CHG_SCN_LINE" | cut -d: -f1)
    if [ "$CHG_CLAIMED" = "$CHG_DENOM" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ changelog v1.2.3.md（行 ${CHG_LINENO}）：历史冻结 ${CHG_CLAIMED}/${CHG_DENOM}（内部自洽，不与当前 SSOT 比对）${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ changelog v1.2.3.md（行 ${CHG_LINENO}）：${CHG_CLAIMED}/${CHG_DENOM} 分母分子不自洽${NC}"
      ((FAIL++)) || true
    fi
  fi
  # ④ changelog v1.2.6.md — 历史冻结文档（v1.2.7 起 v1.2.6 不再是当前版本）
  # v1.2.7: 改为历史冻结校验（场景数不随当前 SSOT 变化，v1.2.6 发版时 SSOT=132）
  CHG126_SCN_LINE=$(grep -nE '[0-9]+ 场景' docs/changelog/v1.2/v1.2.6.md 2>/dev/null | head -1)
  if [ -n "$CHG126_SCN_LINE" ]; then
    CHG126_CLAIMED=$(echo "$CHG126_SCN_LINE" | grep -oE '[0-9]+ 场景' | grep -oE '[0-9]+' | head -1)
    CHG126_LINENO=$(echo "$CHG126_SCN_LINE" | cut -d: -f1)
    echo -e "  ${GREEN}✓ changelog v1.2.6.md（行 ${CHG126_LINENO}）：历史冻结 ${CHG126_CLAIMED} 场景（v1.2.6 发版时 SSOT，不与当前比对）${NC}"
  fi
fi

# LIMITATIONS.md — 多行检查（"审计核心 NNN 个、全 workspace NNN 个" 可能出现多次）
LIMITATIONS_ALL=$(grep -nE '审计核心 [0-9]+ 个、全 workspace [0-9]+ 个' docs/LIMITATIONS.md 2>/dev/null)
if [ -n "$LIMITATIONS_ALL" ]; then
  while IFS= read -r line_info; do
    [ -z "$line_info" ] && continue
    LIM_LINENO=$(echo "$line_info" | cut -d: -f1)
    LIM_AUDIT=$(echo "$line_info" | grep -oE '审计核心 [0-9]+' | grep -oE '[0-9]+')
    LIM_TOTAL=$(echo "$line_info" | grep -oE '全 workspace [0-9]+' | grep -oE '[0-9]+')
    LIM_FAIL=0
    if [ "$LIM_AUDIT" != "$AUDIT_TESTS" ]; then
      echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIM_LINENO}）：audit 声称 ${LIM_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
      LIM_FAIL=1
    fi
    if [ "$LIM_TOTAL" != "$TOTAL_TESTS" ]; then
      echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIM_LINENO}）：workspace 声称 ${LIM_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
      LIM_FAIL=1
    fi
    if [ "$LIM_FAIL" = "0" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ LIMITATIONS.md（行 ${LIM_LINENO}）：audit ${LIM_AUDIT} / workspace ${LIM_TOTAL}${NC}"
      fi
      ((PASS++)) || true
    else
      ((FAIL++)) || true
    fi
  done <<< "$LIMITATIONS_ALL"
fi

# ── 结果汇总 ──
if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════${NC}"
fi

if [ "$FAIL" -gt 0 ]; then
  if [ "$QUIET" = true ]; then
    echo "FAIL"
  else
    echo -e "  ${RED}✗ ${FAIL} 处文档测试数漂移${NC}"
    echo -e "  ${YELLOW}修法：跑 bash tools/test-count.sh 拿实际数，手动更新上述文件的声称值${NC}"
    echo -e "  ${YELLOW}或更好：让文档引用 tools/test-count.sh 动态值，不硬编码${NC}"
  fi
  exit 1
else
  if [ "$QUIET" = true ]; then
    echo "OK"
  else
    echo -e "  ${GREEN}✓ 文档测试数全部一致（${PASS} 处校验通过）${NC}"
  fi
  exit 0
fi
