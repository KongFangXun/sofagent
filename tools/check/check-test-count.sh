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
#   ./tools/check/check-test-count.sh           # 人读输出
#   ./tools/check/check-test-count.sh --quiet   # 只输出 OK/FAIL
#
# 退出码:
#   0 = 文档声称数全部与实际一致
#   1 = 有文档漂移（会列出具体文件+行号+声称值 vs 实际值）
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

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
# v1.3.3 #10: 提前初始化 TC_RC + 显式 || TC_RC=$? 兜底，避免 set -u 下失败路径崩溃。
TC_RC=0
TC_OUT=$(bash tools/check/test-count.sh 2>/dev/null) || TC_RC=$?
# v1.3.2 P0-R8 (P1-15): 修复门禁假绿——test-count.sh 的退出码此前被 $() 吞掉。
# 若任一包测试失败，test-count.sh 退出 1 但其输出仍含 TOTAL_TESTS=NNN（总数不变），
# 旧脚本只看 TOTAL_TESTS 与文档比对 → 文档匹配就返回 OK/EXIT=0，测试实际失败仍被放行。
# 修复：test-count.sh 自身失败（RC≠0）时直接 FAIL/exit 1，门禁真实反映测试状态。
if [ "$TC_RC" -ne 0 ]; then
  if [ "$QUIET" = false ]; then
    echo -e "  ${RED}✗ test-count.sh 失败（RC=${TC_RC}）——有包测试失败或脚本错误，门禁红${NC}"
    echo -e "  ${YELLOW}修法：跑 bash tools/check/test-count.sh 看哪个包失败，修复测试后再跑本脚本${NC}"
  else
    echo "FAIL"
  fi
  exit 1
fi
# 主路径：机器可读行 TOTAL_TESTS=NNN（strip ANSI 后 grep，最鲁棒）
TOTAL_TESTS=$(echo "$TC_OUT" | sed $'s/\033\[[0-9;]*m//g' | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+' || echo "0")
# 回退 1：quiet 模式（同样有机器可读行）
if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  TOTAL_TESTS=$(bash tools/check/test-count.sh --quiet 2>/dev/null | sed $'s/\033\[[0-9;]*m//g' | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+' || echo "0")
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

# B13: workspace 总包数（package.json workspaces 数组条目数，README 声称「13 包」对账用）
# v1.4.0：只数 13 个发布到 npm 的引擎包——engine/dsh-plugins/ 下 9 个插件包为 private（不发布），不计入
WORKSPACE_COUNT=$(grep -cE '^\s*"engine/(harness|ontology|eval|core|think|audit|orchestrator|daemon|ab-test|skillopt|mcp|rules|hooks/)' package.json || echo "0")
[ -z "$WORKSPACE_COUNT" ] && WORKSPACE_COUNT=0

# 任务八方案A（2026-08-29）：README 包数口径升级为双口径「13 引擎包 + 13 插件（9 DSH + 4 OpenClaw）」。
# 插件数 SSOT = 插件目录数（每目录一份 package.json），与 README 声称对账；引擎包 SSOT 仍为 WORKSPACE_COUNT。
DSH_PLUGIN_COUNT=$(find engine/dsh-plugins -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
DSH_PLUGIN_COUNT=${DSH_PLUGIN_COUNT:-0}
OPENCLAW_PLUGIN_COUNT=$(find engine/openclaw-plugins -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
OPENCLAW_PLUGIN_COUNT=${OPENCLAW_PLUGIN_COUNT:-0}
PLUGIN_TOTAL=$(( DSH_PLUGIN_COUNT + OPENCLAW_PLUGIN_COUNT ))

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
  # v1.3.6 修复：已发布版本的历史 devlog（含「✅ 已开发」状态行）冻结——
  # v1.3.9 bugfix：状态行可能带 markdown 加粗（✅ **已开发**），grep 放宽为 ✅[ *]*已开发 容错——
  # v1.4.0：v1.3.9 状态行措辞为「✅ **已交付。**」——冻结条件放宽为 已开发|已交付
  # 其测试数是发版时快照，不随后续版本新增测试漂移（v1.3.5 发布后 v1.3.6 bugfix
  # 新增 6 测试致 2286→2292，历史 devlog 被误报 FAIL——已发布文档不回头改）。
  elif grep -qE '✅[ *]*(已开发|已交付)' "$DEVLOG_FILE" 2>/dev/null; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ ${DEVLOG_FILE}：已发布版本（历史冻结），测试数不与当前 SSOT 比对${NC}"
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

# README.md — "NNN 测试 / NN 引擎包 + NN 插件（N DSH + N OpenClaw）" 格式
# （P0-13: grep 未命中 → FAIL；B13: 包数拆双口径——引擎数对 WORKSPACE_COUNT、插件数对 PLUGIN_TOTAL；
#  任务八方案A 2026-08-29：旧格式「N 测试 / N 包（N 个含测试）」升级为引擎+插件双口径，
#  完整呈现交付物面——引擎包 workspace 13 / 发布实体 26 两个数字可区分，消除「交付物只有 13 包」误读）
README_PKG_LINE=$(grep -nE '[0-9]+ 测试 / [0-9]+ 引擎包 \+ [0-9]+ 插件' README.md 2>/dev/null | head -1)
if [ -n "$README_PKG_LINE" ]; then
  README_CLAIMED=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 测试' | grep -oE '[0-9]+')
  README_PKGS=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 引擎包' | grep -oE '[0-9]+')
  README_PLUGIN_TOTAL=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 插件' | grep -oE '[0-9]+')
  README_PLUGIN_DSH=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ DSH' | grep -oE '[0-9]+')
  README_PLUGIN_OC=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ OpenClaw' | grep -oE '[0-9]+')
  README_LINENO=$(echo "$README_PKG_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 README.md（行 ${README_LINENO}）..."
  fi
  local_fail=0
  if [ "$README_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_CLAIMED} 测试，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ -n "$README_PKGS" ] && [ "$README_PKGS" != "$WORKSPACE_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PKGS} 引擎包（workspace 引擎总数），实际 ${WORKSPACE_COUNT} 包${NC}"
    local_fail=1
  fi
  if [ -n "$README_PLUGIN_TOTAL" ] && [ "$README_PLUGIN_TOTAL" != "$PLUGIN_TOTAL" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PLUGIN_TOTAL} 插件（DSH+OpenClaw 合计），实际 ${PLUGIN_TOTAL} 插件${NC}"
    local_fail=1
  fi
  if [ -n "$README_PLUGIN_DSH" ] && [ "$README_PLUGIN_DSH" != "$DSH_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PLUGIN_DSH} DSH 插件，实际 ${DSH_PLUGIN_COUNT}${NC}"
    local_fail=1
  fi
  if [ -n "$README_PLUGIN_OC" ] && [ "$README_PLUGIN_OC" != "$OPENCLAW_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PLUGIN_OC} OpenClaw 插件，实际 ${OPENCLAW_PLUGIN_COUNT}${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ README.md：${README_CLAIMED} 测试 / ${README_PKGS} 引擎包 + ${README_PLUGIN_TOTAL} 插件（${README_PLUGIN_DSH} DSH + ${README_PLUGIN_OC} OpenClaw）${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ README.md 未找到「N 测试 / N 引擎包 + N 插件」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  ((FAIL++)) || true
fi

# README.en.md — "NNN tests / NN engine packages + NN plugins (N DSH + N OpenClaw)" 格式
# （P1 B2b: 英文版曾二次漂移 2283，根因是门禁只校验中文 README。补齐英文校验，grep 未命中 → FAIL，
#  与中文版 P0-13 语义一致；任务八方案A 2026-08-29：随中文版同步升级为引擎+插件双口径）
README_EN_LINE=$(grep -nE '[0-9]+ tests? / [0-9]+ engine packages \+ [0-9]+ plugins' README.en.md 2>/dev/null | head -1)
if [ -n "$README_EN_LINE" ]; then
  README_EN_CLAIMED=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ tests?' | grep -oE '[0-9]+')
  README_EN_PKGS=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ engine packages' | grep -oE '[0-9]+')
  README_EN_PLUGIN_TOTAL=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ plugins' | grep -oE '[0-9]+')
  README_EN_PLUGIN_DSH=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ DSH' | grep -oE '[0-9]+')
  README_EN_PLUGIN_OC=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ OpenClaw' | grep -oE '[0-9]+')
  README_EN_LINENO=$(echo "$README_EN_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 README.en.md（行 ${README_EN_LINENO}）..."
  fi
  local_fail=0
  if [ "$README_EN_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_CLAIMED} tests，实际 ${TOTAL_TESTS}${NC}"
    local_fail=1
  fi
  if [ -n "$README_EN_PKGS" ] && [ "$README_EN_PKGS" != "$WORKSPACE_COUNT" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PKGS} engine packages（workspace 引擎总数），实际 ${WORKSPACE_COUNT} 包${NC}"
    local_fail=1
  fi
  if [ -n "$README_EN_PLUGIN_TOTAL" ] && [ "$README_EN_PLUGIN_TOTAL" != "$PLUGIN_TOTAL" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PLUGIN_TOTAL} plugins（DSH+OpenClaw 合计），实际 ${PLUGIN_TOTAL} 插件${NC}"
    local_fail=1
  fi
  if [ -n "$README_EN_PLUGIN_DSH" ] && [ "$README_EN_PLUGIN_DSH" != "$DSH_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PLUGIN_DSH} DSH plugins，实际 ${DSH_PLUGIN_COUNT}${NC}"
    local_fail=1
  fi
  if [ -n "$README_EN_PLUGIN_OC" ] && [ "$README_EN_PLUGIN_OC" != "$OPENCLAW_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PLUGIN_OC} OpenClaw plugins，实际 ${OPENCLAW_PLUGIN_COUNT}${NC}"
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ README.en.md：${README_EN_CLAIMED} tests / ${README_EN_PKGS} engine packages + ${README_EN_PLUGIN_TOTAL} plugins (${README_EN_PLUGIN_DSH} DSH + ${README_EN_PLUGIN_OC} OpenClaw)${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ README.en.md 未找到「N tests / N engine packages + N plugins」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
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
# v1.3.5 #5 元教训（四份审查独立命中「守卫之死」）：凡是「未找到 X 则跳过」的守卫，
#   跳过本身必须算 FAIL——否则守卫的存在感为零（守卫空转比没有守卫更危险）。
#   本脚本此前 head -10 读不到第 11 行的 SSOT 声明（v1.3.1 加 LANG export 挤行所致），
#   WARN 每次出现但从未有人在意，场景守卫长期失效。现改为：
#   ① head -10 → head -20（声明行挪动几行不再失明）
#   ② 头部声明缺失 → 直接 FAIL（exit 1），不再 WARN 跳过
ACCEPTANCE_ACTUAL=$(head -20 FORGE/playbook/acceptance-test.sh 2>/dev/null | grep -oE '[0-9]+ 个场景' | head -1 | grep -oE '[0-9]+' || echo "")
if [ -z "$ACCEPTANCE_ACTUAL" ]; then
  echo -e "  ${RED}✗ acceptance-test.sh 头部（前 20 行）未找到「NNN 个场景」声明——场景守卫 FAIL（不再静默跳过）${NC}"
  echo -e "    守卫空转比没有守卫更危险：请在脚本头部补 SSOT 声明「# 场景数：NNN 个场景」"
  ((FAIL++)) || true
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

# ── CHANGELOG 索引行测试数校验（v1.4.1 F-06：补盲区）──
# 背景：F-01 的 2978 三处错数字从这个盲区漏出去——开发日志有「历史冻结」豁免，
# CHANGELOG 索引行却无人校验。本段对最新版本索引行做两条校验：
#   ① 算术自洽：测试 NNNN→**MMM**（+KKK → 要求 NNN+KKK=MMM
#   ② 口径对齐：识别「workspace 口径 NNNN/12 包」标注——workspace 值必须等于
#      test-count.sh 实测 TOTAL_TESTS；全量值必须等于 workspace + DSH 插件 27 +
#      OpenClaw 插件 17（双口径换算式：2981 = 2937 + 27 + 17，写死防漂移）
# 双口径防误判：ROADMAP/CHANGELOG 的「全量 NNNN」与「workspace 口径 NNNN」是两个
# 合法并存口径（报告二误判教训的机制化）——按各自口径比对各自真值，不得把全量判为漂移。
CHANGELOG_LINE=$(grep -nE '测试 [0-9]+→\*\*[0-9]+\*\*（\+[0-9]+' CHANGELOG.md 2>/dev/null | head -1)
if [ -z "$CHANGELOG_LINE" ]; then
  echo -e "  ${RED}✗ CHANGELOG.md 未找到「测试 NNNN→**MMM**（+KKK」索引行声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  ((FAIL++)) || true
else
  CL_LINENO=$(echo "$CHANGELOG_LINE" | cut -d: -f1)
  # 锚定「测试 N→**M**（+K」整段后按位取数——CHANGELOG 索引行常含多个「→**数字**」
  # （如 MCP 67→**76**），旧模式 grep -oE '→\*\*[0-9]+\*\*' 多值命中导致
  # 「[: 76\n3349: integer expression expected」噪声（判定结果虽对但脏输出）
  CL_ANCHOR=$(echo "$CHANGELOG_LINE" | grep -oE '测试 [0-9]+→\*\*[0-9]+\*\*（\+[0-9]+' | grep -oE '[0-9]+')
  CL_PREV=$(echo "$CL_ANCHOR" | sed -n '1p')
  CL_CUR=$(echo "$CL_ANCHOR" | sed -n '2p')
  CL_DELTA=$(echo "$CL_ANCHOR" | sed -n '3p')
  cl_fail=0
  # 锚定段防御：必须恰好 3 个数字（前值/当前值/增量），结构异常 fail-loud 不静默
  CL_COUNT=$(echo "$CL_ANCHOR" | grep -c . )
  if [ "$CL_COUNT" -ne 3 ] || [ -z "$CL_PREV" ] || [ -z "$CL_CUR" ] || [ -z "$CL_DELTA" ]; then
    echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：锚定段数字解析异常（期望 3 个，实得 ${CL_COUNT} 个：prev=${CL_PREV:-空} cur=${CL_CUR:-空} delta=${CL_DELTA:-空}）${NC}"
    cl_fail=1
  fi
  # ① 算术自洽：前值 + 增量 = 当前值（解析异常时短路，防空值参与算术产生新噪声）
  if [ "$cl_fail" = "0" ]; then
    CL_SUM=$((CL_PREV + CL_DELTA))
    if [ "$CL_SUM" -ne "$CL_CUR" ]; then
      echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：算术不自洽——${CL_PREV}+${CL_DELTA}=${CL_SUM} ≠ ${CL_CUR}${NC}"
      cl_fail=1
    fi
  fi
  # ② 双口径对齐（历史快照语义）：CHANGELOG 最新版本行是发版时点快照（同开发日志
  #    「历史冻结」），不与当前 TOTAL_TESTS 比对（发版后新增测试属正常漂移）。
  #    只校验「workspace 口径 NNNN」标注与同版本开发日志快照一致——开发日志才是
  #    该版本测试数的 SSOT。双口径换算式写死防漂移：全量 = workspace + 27(DSH) + 17(OpenClaw)。
  CL_WS_MARK=$(echo "$CHANGELOG_LINE" | grep -oE 'workspace 口径 [0-9]+' | grep -oE '[0-9]+' || echo "")
  if [ -n "$CL_WS_MARK" ]; then
    # 找同版本开发日志的 workspace 快照（「NNNN tests across 12 packages」或「workspace NNNN」）
    # 注意只取第一个数字（该模式含两个数字——测试数与包数，head -1 取测试数）
    # v1.4.1 适配：DEVLOG_FILE 按 package.json 版本指向（版本未 bump 时指向上版已发日志），
    # 而 CHANGELOG 最新行已是开发中版本——优先在「下一版开发日志」找快照：若 CHANGELOG 行
    # 版本号 ≠ CUR_VERSION，则优先探测 docs/changelog/vX.Y/v<行版本>.md（存在即用），否则回退 DEVLOG_FILE。
    CL_VER=$(echo "$CHANGELOG_LINE" | grep -oE '\*\*v[0-9]+\.[0-9]+\.[0-9]+\*\*' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
    CL_DEVLOG="${DEVLOG_FILE}"
    if [ -n "$CL_VER" ] && [ "$CL_VER" != "$CUR_VERSION" ]; then
      CL_MAJOR_MINOR=$(echo "$CL_VER" | cut -d. -f1-2)
      CL_CAND="docs/changelog/v${CL_MAJOR_MINOR}/v${CL_VER}.md"
      [ -f "$CL_CAND" ] && CL_DEVLOG="$CL_CAND"
    fi
    DEVLOG_SNAPSHOT=$(grep -oE '[0-9]+ tests across 12 packages' "${CL_DEVLOG}" 2>/dev/null | head -1 | grep -oE '^[0-9]+' || echo "")
    if [ -n "$DEVLOG_SNAPSHOT" ]; then
      if [ "$CL_WS_MARK" != "$DEVLOG_SNAPSHOT" ]; then
        echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：workspace 口径声称 ${CL_WS_MARK}，开发日志快照 ${DEVLOG_SNAPSHOT}（${CL_DEVLOG}）${NC}"
        cl_fail=1
      fi
      # 全量口径 = workspace + DSH 插件 27 + OpenClaw 插件 17（换算式写死，防口径漂移）
      # ⚠️ 插件包（engine/dsh-plugins/、engine/openclaw-plugins/ 嵌套二级目录）不在 test-count
      #    的 12 包扫描内（只扫 engine/ 一级），workspace 快照永远不含插件测试——一律叠加 27+17
      CL_FULL_EXPECT=$((DEVLOG_SNAPSHOT + 27 + 17))
      if [ "$CL_CUR" -ne "$CL_FULL_EXPECT" ]; then
        echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：全量口径 ${CL_CUR} ≠ workspace ${DEVLOG_SNAPSHOT} + 27(DSH) + 17(OpenClaw) = ${CL_FULL_EXPECT}（开发日志快照换算）${NC}"
        cl_fail=1
      fi
    fi
  fi
  if [ "$cl_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ CHANGELOG.md 索引行（行 ${CL_LINENO}）：${CL_PREV}+${CL_DELTA}=${CL_CUR} 算术自洽${CL_WS_MARK:+，workspace 口径 ${CL_WS_MARK} 对齐}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
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
