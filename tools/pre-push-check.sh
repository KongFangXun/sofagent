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
#   + test-count.sh         → 各包测试数汇总（任一包失败即拦截）
#   + npm run build         → 审计引擎构建
#
# 用法:
#   ./tools/pre-push-check.sh           # 全量检查
#   ./tools/pre-push-check.sh --quick   # 跳过 npm test/build（快）
#   ./tools/pre-push-check.sh --minimal      # 结构性快检（跳过版本号/文档/构建/测试门禁）
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
MINIMAL=false

# ── 参数解析 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)       QUICK=true; shift ;;
    --minimal)     MINIMAL=true; shift ;;
    --help|-h)
      echo "pre-push-check.sh — 推前预检"
      echo "  --quick        跳过 npm test/build"
      echo "  --minimal     结构性快检：只跑 shellcheck+CLI验证+安装路径+tag+依赖图，跳过 版本号/文档/构建/测试门禁"
      echo "  --help         显示帮助"
      exit 0 ;;
    *) shift ;;
  esac
done

echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  sofagent · 推前预检${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"

if [ "$MINIMAL" = true ]; then
  echo -e "  ${YELLOW}⚠ --minimal 模式：已跳过 版本号校验 / 文档检查 / 构建 / 测试门禁${NC}"
  echo -e "  ${YELLOW}  此结果不能替代完整 pre-push-check，请勿据此直接 push 未经测试的代码${NC}"
fi

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
  # v1.1.6: 补 LOOP（CI shellcheck.yml 扫全仓，列表必须与 CI 保持一致）
  SHELL_FILES=$(find sofagent/scripts tools FDE LOOP -name "*.sh" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null)
  SC_FAIL=0

  # ShellCheck 版本兼容性：CI 用 v0.11.0，本地 ≥0.11.0 才能保证与 CI 一致
  # v0.10.0 对 SC2155 等 warning 判定宽松（exit 0），v0.11.0 exit 1
  SC_VER=$(shellcheck --version 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1)
  sc_ver_major=$(echo "$SC_VER" | cut -d. -f1)
  sc_ver_minor=$(echo "$SC_VER" | cut -d. -f2)
  if [ -n "$SC_VER" ] && { [ "$sc_ver_major" -lt 0 ] || { [ "$sc_ver_major" -eq 0 ] && [ "$sc_ver_minor" -lt 11 ]; }; } 2>/dev/null; then
    check_warn "shellcheck $SC_VER < 0.11.0（CI 用 v0.11.0）——建议 brew upgrade shellcheck"
  fi

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
if [ "$MINIMAL" = false ]; then
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
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3. 文档检查 ──${NC}"
  if bash tools/check-docs.sh >/dev/null 2>&1; then
    check_pass "check-docs.sh 全部通过"
  else
    check_fail "check-docs.sh 有问题"
    bash tools/check-docs.sh 2>&1 | grep "❌\|⚠️" | head -10
  fi
fi

# ════════════════════════════════════════
# 4. 审计引擎构建 + 测试数汇总（对应 verify.yml + test-count.sh 门禁）
# ════════════════════════════════════════
if [ "$MINIMAL" = false ] && [ "$QUICK" = false ]; then
  echo -e "\n${BOLD}── 4. 审计引擎构建 + 测试数汇总 ──${NC}"
  echo "  构建中..."
  if (npm run build >/dev/null 2>&1); then
    check_pass "npm run build (workspace 拓扑序)"
  else
    check_fail "npm run build 失败"
  fi

  echo "  测试+汇总中（test-count.sh，任一包失败即拦截）..."
  TEST_OUT=$(bash tools/test-count.sh 2>&1)
  TEST_RC=$?
  # 输出 test-count.sh 的人读明细（每包 ✓/✗）
  echo "$TEST_OUT" | grep -E '✓|✗|⚠|TOTAL_TESTS' | sed 's/^/  /'
  if [ "$TEST_RC" -eq 0 ]; then
    check_pass "test-count.sh（workspace 全量，0 失败）"
  else
    check_fail "test-count.sh 有失败（RC=$TEST_RC，见上方 ✗ 明细）"
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

  # v1.1.3 教训补强：tag 指向的 commit message 也必须含版本号
  # （v1.1.1/v1.1.2 tag 本身 subject 正确，但指向的 commit message 不含版本号，
  #  导致 changelog 索引交叉验证失败。此检查预防此类问题）
  # v1.1.4 修复策略（路径 3：历史豁免）：
  #   - tag 指向的 commit == HEAD（当前发版刚打的 tag）：commit message 不含版本号 → FAIL（阻断）
  #   - tag 指向的 commit != HEAD（历史 tag）：静默豁免，不再报 WARN
  # 理由：历史 commit message 不可改（rebase 重写会级联影响 52 个 tag），
  #   pre-push-check 的职责是预防未来，不是追溯历史。历史污点在 LIMITATIONS.md 标注即可。
  TAG_COMMIT_MSG=$(git log -1 "v${SSOT_VERSION}^{commit}" --format=%s 2>/dev/null || true)
  if [ -n "$TAG_COMMIT_MSG" ]; then
    if echo "$TAG_COMMIT_MSG" | grep -q "${SSOT_VERSION}"; then
      check_pass "Tag v${SSOT_VERSION} 指向的 commit message 含版本号"
    else
      # 判断是历史污点还是当前发版的问题：tag 指向的 commit 是否等于 HEAD
      TAG_COMMIT_HASH=$(git rev-parse "v${SSOT_VERSION}^{commit}" 2>/dev/null || true)
      HEAD_COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || true)
      if [ "$TAG_COMMIT_HASH" = "$HEAD_COMMIT_HASH" ]; then
        # tag 指向 HEAD = 当前发版的 commit，commit message 不含版本号是本轮问题 → FAIL
        check_fail "Tag v${SSOT_VERSION} 指向当前 HEAD commit，但 commit message 不含版本号（commit: \"${TAG_COMMIT_MSG}\"）。请在 commit message 中包含版本号 ${SSOT_VERSION}"
      else
        # tag 指向历史 commit = 历史豁免，不阻断也不告警
        check_pass "Tag v${SSOT_VERSION} 指向历史 commit（非 HEAD），commit message 不含版本号属历史污点——已豁免"
      fi
    fi
  fi

  # ── 全量历史 tag 扫描（v1.0.0+ 正式版 · v1.1.6 新增）──
  # 遍历所有 v1.* tag，检查 commit message 是否含对应版本号
  # 原则：历史 commit message 不可改（rebase 会级联影响 50+ tag）
  # 全量扫描职责是"暴露历史污点"而非阻断推送——非 HEAD 历史 tag 一律 WARN 豁免，
  # 只有指向当前 HEAD 的 tag（=本轮发版 tag）不含版本号才 FAIL
  echo ""
  echo -e "  ${BOLD}── 全量历史 tag 扫描（v1.0.0+）──${NC}"
  HISTORY_TAG_TOTAL=0
  HISTORY_DIRTY_EXEMPT=0
  HISTORY_NEW_ISSUES=0
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    HISTORY_TAG_TOTAL=$((HISTORY_TAG_TOTAL + 1))
    hv=$(echo "$t" | sed 's/^v//')
    hmsg=$(git log -1 "$t^{commit}" --format=%s 2>/dev/null || true)
    if echo "$hmsg" | grep -q "$hv"; then
      : # commit message 含版本号，正常
    else
      # 历史 commit message 不可改（rebase 重写会级联影响 50+ tag）
      # 只有指向当前 HEAD 的 tag（= 本轮发版的 tag）commit message 不含版本号才 FAIL，
      # 其余所有历史 tag 一律 WARN 豁免，并在 LIMITATIONS.md 记录。
      TAG_COMMIT_HASH=$(git rev-parse "$t^{commit}" 2>/dev/null || true)
      HEAD_COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || true)
      if [ "$TAG_COMMIT_HASH" = "$HEAD_COMMIT_HASH" ]; then
        check_fail "$t: commit message 不含 ${hv}（msg: ${hmsg}）—— 当前发版 tag 必须含版本号"
        HISTORY_NEW_ISSUES=$((HISTORY_NEW_ISSUES + 1))
      else
        check_warn "$t: commit message 不含 ${hv}（历史污点，已豁免）"
        HISTORY_DIRTY_EXEMPT=$((HISTORY_DIRTY_EXEMPT + 1))
      fi
    fi
  done < <(git tag -l "v1.*" --sort=-creatordate 2>/dev/null)
  echo -e "  ${GREEN}✓${NC} 共扫描 ${HISTORY_TAG_TOTAL} 个 tag，${HISTORY_DIRTY_EXEMPT} 个历史污点豁免，${HISTORY_NEW_ISSUES} 个新问题"
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
