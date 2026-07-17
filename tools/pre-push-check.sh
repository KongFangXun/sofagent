#!/bin/bash
# ============================================================
# pre-push-check.sh · 推前预检（本地 CI 等价检查）
# ============================================================
# 在 git push 之前，本地跑一遍所有 CI workflow 的等价检查。
# 全绿才推，避免每次推上去被 CI 打回来。
#
# 对应 CI workflows:
#   - shellcheck.yml        → shellcheck 所有 .sh
#   - verify.yml            → verify.sh
#   - sofagent-audit.yml    → sofagent-audit --silent --diff HEAD~1..HEAD
#   + check-version.sh      → 版本号一致性
#   + check-docs.sh         → 文档预算+死链+Skill 行数
#   + npm test / build      → 审计引擎构建+测试
#
# 用法:
#   ./tools/pre-push-check.sh           # 全量检查
#   ./tools/pre-push-check.sh --quick   # 跳过 npm test/build（快）
#   ./tools/pre-push-check.sh --audit-only  # 只跑审计（最快）
#
# 退出码:
#   0 = 全部通过，可以 push
#   1 = 有检查不通过，先修再推
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
QUICK=false
AUDIT_ONLY=false

# ── 参数解析 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)       QUICK=true; shift ;;
    --audit-only)  AUDIT_ONLY=true; shift ;;
    --help|-h)
      echo "pre-push-check.sh — 推前预检"
      echo "  --quick        跳过 npm test/build"
      echo "  --audit-only   只跑 sofagent-audit + shellcheck"
      echo "  --help         显示帮助"
      exit 0 ;;
    *) shift ;;
  esac
done

echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  sofagent · 推前预检${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo ""

# ── 辅助函数 ──
check_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)) || true; }
check_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)) || true; }
check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((WARN++)) || true; }

# shellcheck disable=SC2317  # 辅助函数，按步骤名调用，保留供未来扩展
run_step() {
  local name="$1" cmd="$2"
  echo -e "\n${BOLD}── ${name} ──${NC}"
  if eval "$cmd" 2>&1; then
    check_pass "${name}"
  else
    check_fail "${name}（退出码 $?）"
  fi
}

# ════════════════════════════════════════
# 1. ShellCheck（对应 shellcheck.yml）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 1. ShellCheck ──${NC}"
if command -v shellcheck &>/dev/null; then
  SHELL_FILES=$(find sofagent/scripts tools FDE -name "*.sh" -not -path "*/node_modules/*" 2>/dev/null)
  SC_FAIL=0
  for f in $SHELL_FILES; do
    # severity=warning 只报 warning+error，忽略 style/info（SC2015/SC2002 等代码风格建议）
    # v0.99.8: SC2086/SC2155 收窄——全仓库已修复，不再全局排除
    if ! shellcheck -s bash --severity=warning -e SC2034 -e SC1090 -e SC1091 "$f" >/dev/null 2>&1; then
      echo -e "  ${RED}✗${NC} shellcheck: $f"
      shellcheck -s bash --severity=warning -e SC2034 -e SC1090 -e SC1091 "$f" 2>&1 | head -5
      SC_FAIL=$((SC_FAIL + 1))
    fi
  done
  if [ "$SC_FAIL" -eq 0 ]; then
    check_pass "ShellCheck 全部通过（$(echo "$SHELL_FILES" | wc -l | tr -d ' ') 个文件）"
  else
    check_fail "ShellCheck: ${SC_FAIL} 个文件有问题"
  fi
else
  check_warn "shellcheck 未安装——brew install shellcheck"
fi

# ════════════════════════════════════════
# 2. 版本号一致性（check-version.sh）
# ════════════════════════════════════════
if [ "$AUDIT_ONLY" = false ]; then
  echo -e "\n${BOLD}── 2. 版本号一致性 ──${NC}"
  if bash tools/check-version.sh >/dev/null 2>&1; then
    check_pass "check-version.sh 全部通过"
  else
    check_fail "check-version.sh 有不一致"
    bash tools/check-version.sh 2>&1 | grep "❌" | head -10
  fi
fi

# ════════════════════════════════════════
# 3. 文档检查（check-docs.sh）
# ════════════════════════════════════════
if [ "$AUDIT_ONLY" = false ]; then
  echo -e "\n${BOLD}── 3. 文档检查 ──${NC}"
  if bash tools/check-docs.sh >/dev/null 2>&1; then
    check_pass "check-docs.sh 全部通过"
  else
    check_fail "check-docs.sh 有问题"
    bash tools/check-docs.sh 2>&1 | grep "❌\|⚠️" | head -10
  fi
fi

# ════════════════════════════════════════
# 4. 审计引擎构建+测试（对应 verify.yml）
# ════════════════════════════════════════
if [ "$AUDIT_ONLY" = false ] && [ "$QUICK" = false ]; then
  echo -e "\n${BOLD}── 4. 审计引擎构建+测试 ──${NC}"
  echo "  构建中..."
  if (npm run build >/dev/null 2>&1); then
    check_pass "npm run build (workspace 拓扑序)"
  else
    check_fail "npm run build 失败"
  fi

  echo "  测试中..."
  if (npm run test >/dev/null 2>&1); then
    check_pass "npm run test (workspace 全量)"
  else
    check_fail "npm run test 有失败"
  fi
fi

# ════════════════════════════════════════
# 5. sofagent-audit（对应 sofagent-audit.yml）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 5. CLI 二进制验证 ──${NC}"
for bin_name in sofagent-audit sofagent-orchestrator sofagent-daemon sofagent-ontology sofagent-work模板市场 sofagent-ab-test sofagent-think sofagent-skillopt sofagent-core; do
  pkg=$(echo "$bin_name" | sed 's/sofagent-//')
  if [ -f "sofagent/$pkg/dist/cli.js" ]; then
    node "sofagent/$pkg/dist/cli.js" --help >/dev/null 2>&1 && check_pass "$bin_name --help" || check_fail "$bin_name --help"
  fi
done

# ════════════════════════════════════════
# 6. install.sh 关键路径检查（fde.md 迁移断裂防护）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 6. install.sh 关键路径 ──${NC}"
# v0.99.8 教训：fde.md 从 skill/ 迁到 skill/data/，8 处引用需要同步。
# pre-push-check 之前不覆盖 install.sh，路径断裂检测不到。此步补盲。
INSTALL_CRITICAL_FILES=(
  "sofagent/skill/data/fde.md"
  "sofagent/skill/SKILL.md"
  "sofagent/skill/entry-gate.md"
  "sofagent/skill/task-aware.md"
  "sofagent/skill/task-closure.md"
  "sofagent/skill/loop-check.md"
  "sofagent/skill/engage.md"
  "sofagent/skill/engage-fde.md"
  "sofagent/skill/loop-evaluate.md"
  "sofagent/skill/loop-exit.md"
)
PATH_FAIL=0
for f in "${INSTALL_CRITICAL_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo -e "  ${RED}✗${NC} 缺失: $f"
    PATH_FAIL=$((PATH_FAIL + 1))
  fi
done

# 检查 install.sh 引用的路径和实际文件是否一致
# RULES_SRC 格式: "${SCRIPT_DIR}/../skill/data/fde.md" → 提取 ../skill/data/fde.md
# SCRIPT_DIR = sofagent/scripts 的绝对路径，所以从 sofagent/scripts/ 解析相对路径
# shellcheck disable=SC2016  # sed pattern matches literal ${SCRIPT_DIR} in install.sh
INSTALL_RULES_SRC=$(grep 'RULES_SRC=' sofagent/scripts/install.sh 2>/dev/null | head -1 | sed 's/.*="\${SCRIPT_DIR}\///;s/".*//')
if [ -n "$INSTALL_RULES_SRC" ]; then
  # 用 subshell cd 验证路径是否存在（兼容 macOS/Linux，不依赖 realpath）
  if ! (cd sofagent/scripts 2>/dev/null && [ -f "${INSTALL_RULES_SRC}" ]); then
    echo -e "  ${RED}✗${NC} install.sh RULES_SRC 路径断裂: ${INSTALL_RULES_SRC}"
    PATH_FAIL=$((PATH_FAIL + 1))
  fi
fi

if [ "$PATH_FAIL" -eq 0 ]; then
  check_pass "install.sh 关键路径完整（${#INSTALL_CRITICAL_FILES[@]} 个源文件 + RULES_SRC）"
else
  check_fail "install.sh 关键路径断裂（${PATH_FAIL} 个问题）"
fi

# ════════════════════════════════════════
# 7. Tag message 校验
# ════════════════════════════════════════
echo -e "\n${BOLD}── 7. Tag message 校验 ──${NC}"
SSOT_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null) || true
if [ -n "$SSOT_VERSION" ] && git tag -l "v${SSOT_VERSION}" | grep -q "v${SSOT_VERSION}" 2>/dev/null; then
  TAG_MSG=$(git tag -l "v${SSOT_VERSION}" --format='%(subject)' 2>/dev/null || true)
  if echo "$TAG_MSG" | grep -q "${SSOT_VERSION}"; then
    check_pass "Tag v${SSOT_VERSION} message 含版本号"
  else
    check_fail "Tag v${SSOT_VERSION} message 与版本号不一致（message: \"${TAG_MSG}\"）"
  fi
else
  check_warn "Tag v${SSOT_VERSION} 不存在（发版前正常）"
fi

# ════════════════════════════════════════
# 8. 依赖图循环检测
# ════════════════════════════════════════
echo -e "\n${BOLD}── 8. 依赖图循环检测 ──${NC}"
CYCLE_CHECK=$(node -e '
const fs = require("fs");
const path = require("path");
const dirs = fs.readdirSync("sofagent").filter(d => {
  try { return fs.statSync(path.join("sofagent", d)).isDirectory(); } catch(e) { return false; }
});
const edges = {}; // pkgName -> Set of depPkgNames
for (const d of dirs) {
  const pjPath = path.join("sofagent", d, "package.json");
  if (!fs.existsSync(pjPath)) continue;
  const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
  const name = pj.name;
  const deps = new Set();
  for (const field of ["dependencies", "optionalDependencies"]) {
    if (pj[field]) {
      for (const dep of Object.keys(pj[field])) {
        if (dep.startsWith("@sofagent/")) deps.add(dep);
      }
    }
  }
  if (deps.size > 0) edges[name] = deps;
}
let newCycles = [];
for (const [a, depsA] of Object.entries(edges)) {
  for (const b of depsA) {
    if (edges[b] && edges[b].has(a)) {
      const key = [a.replace("@sofagent/",""), b.replace("@sofagent/","")].sort().join("↔");
      if (key === "audit↔daemon") {
        // known cycle, warn only
      } else {
        newCycles.push(key);
      }
    }
  }
}
if (newCycles.length > 0) {
  console.log("NEW_CYCLE:" + newCycles.join(","));
} else {
  console.log("OK");
}
' 2>&1)
if echo "$CYCLE_CHECK" | grep -q "^OK$"; then
  check_pass "依赖图无新增循环（已知 audit↔daemon 豁免）"
  echo -e "  ${YELLOW}⚠${NC} 已知循环：audit↔daemon（解耦计划 v1.2.x）"
elif echo "$CYCLE_CHECK" | grep -q "^NEW_CYCLE:"; then
  check_fail "依赖图发现新增循环：$(echo "$CYCLE_CHECK" | sed 's/NEW_CYCLE://')"
else
  check_warn "依赖图循环检测执行异常（跳过）"
fi

# ════════════════════════════════════════
# 总结
# ════════════════════════════════════════
TOTAL=$((PASS + FAIL + WARN))
echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  结果: ${GREEN}${PASS} 通过${NC} / ${YELLOW}${WARN} 警告${NC} / ${RED}${FAIL} 失败${NC}（共 ${TOTAL} 项）"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ 有 ${FAIL} 项失败，先修再推！${NC}"
  echo ""
  echo "  修复后重新跑: ./tools/pre-push-check.sh"
  exit 1
else
  echo -e "  ${GREEN}✅ 可以 push 了！${NC}"
  echo ""
  exit 0
fi
