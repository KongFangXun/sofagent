#!/usr/bin/env bash
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
#   + check-version.sh      → 版本号一致性（v1.4.9 G-2③：发版窗口自动加 --strict，warning 也阻断）
#   + check-docs.sh         → 文档预算+死链+Skill 行数
#   + check-literals.sh     → 手填字面量对账（真相源 vs 文档手抄件）
#   + test-count.sh         → 各包测试数汇总（任一包失败即拦截）
#   + check-test-count.sh   → 文档声称测试数 vs 实际值一致性（P1-3 根治）
#   + check-review-system.sh → 审查体系一致性（维度数/警戒线/S 编号对账 · v1.4.8 接入）
#   + check-silent-catch.mjs → 静默吞错门禁（只拦新增 · v1.4.8 接入）
#   + dependency-direction.sh → 依赖方向架构测试（13 包边界 · v1.4.8 第七章）
#   + check-tool-health.sh  → 工具健康 9 项 ✅ = ① 审查文档路径活性 / ② 孤儿配置 / ③ bump↔check 结构对照 /
#                             ④ hook 头版本标记 / ⑤ CI 引用活性 / ⑥ set -u 新变量初始化守卫（2 子项）/
#                             ⑦ tools/README.md 收录对账 + 防线失明自检（2 子项）· v1.4.9 G-12 接入
#   + check-home-resolution-parity.mjs → 家目录口径对照（harness resolveEngineHome ↔ core resolveHomeDir
#                             同输入同输出 + 已登记差异钉住 · 须在构建之后跑 · v1.4.9 G-9 接入）
#   + doc-discipline.sh    → 对外文档写作纪律（内部工单代号 / 本机私有路径 · v1.4.9 P2-27 接入）
#   + check-prepush-checklist.mjs → 本清单自身的对账：清单里的脚本名 ⊆ 实际被调用（v1.4.9 G-16 接入）
#   + check-gate-inventory.sh → 门禁清单覆盖对账：tools/check/ 守卫 ⊆ 真实调用面（抓孤儿守卫）
#   + check-forms.mjs       → 形态归属标注对账（changelog ↔ ROADMAP 双向）
#   + npm run build         → 审计模块构建
#
# 用法:
#   ./tools/release/pre-push-check.sh   # 全量检查（v1.4.0 移入 release/：四门禁聚合入口）
#   ./tools/release/pre-push-check.sh --quick   # 跳过 npm test/build（快）
#   ./tools/release/pre-push-check.sh --minimal      # 结构性快检（跳过版本号/文档/构建/测试门禁）
#
# 退出码:
#   0 = 全部通过，可以 push
#   1 = 有检查不通过，先修再推
# ============================================================

set -uo pipefail

# v1.2.2 F-03: 预防性内存限制——防止 node/shellcheck 进程 OOM (exit 137)
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

# v1.4.0：脚本从 tools/ 移入 tools/release/，仓库根定位改为上两级（原 tools/ 上 1 级）
cd "$(dirname "$0")/../.." || exit 1

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
  # v1.1.9: 补 engine/daemon（USB 启动脚本 start.sh 在 daemon/usb/）
  # v1.2.2: 补 install.sh（根目录，CI shellcheck.yml 也单独列了它）
  SHELL_FILES=$(find engine/scripts engine/daemon tools FDE FORGE -name "*.sh" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null)
  SHELL_FILES="$SHELL_FILES install.sh"
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
# 1b. 本清单自身的对账（check-prepush-checklist.mjs · v1.4.9 G-16 接入）
# 为什么需要：本文件头部的 `#   + <脚本名>` 清单长期**零对账**——没有任何守卫断言
#   「清单里写的 ⊆ 实际调用的」。v1.4.9 批 4c 把 51 项加到 52 项时，这一致性只能靠人肉 grep。
#   它守的是「**声明了 X、实现里没有 X**」这个缺陷类（G-12 = check-tool-health 声明有实则零接线；
#   G-11 = 注释声明 evolve-gate 实则无可执行；本条 = 清单声明与调用面对账）。
# 为什么排在 1b（**不能后移**）：纯静态文本分析，零构建依赖、零子进程，实测 <0.1s ⇒ 放最前面尽早拦。
# 三态语义：0 = 清单 ⊆ 实现；1 = 清单里有未被调用的脚本名；2 = 检查器失明（清单/调用面提取为空）。
# ════════════════════════════════════════
echo -e "\n${BOLD}── 1b. 检查项清单对账 ──${NC}"
if [ -f tools/check/check-prepush-checklist.mjs ]; then
  CPC_OUT=$(node tools/check/check-prepush-checklist.mjs 2>&1)
  CPC_RC=$?
  if [ "$CPC_RC" -eq 0 ]; then
    check_pass "check-prepush-checklist.mjs（清单 ⊆ 实现）"
  elif [ "$CPC_RC" -eq 2 ]; then
    check_fail "check-prepush-checklist.mjs 检查器失明（exit 2——清单或调用面提取为空，拒绝假绿）"
    printf '%s\n' "$CPC_OUT" | grep -E '^❌|^    ·' | head -6
  else
    check_fail "check-prepush-checklist.mjs 发现清单声明了未接线的脚本（exit ${CPC_RC}）"
    printf '%s\n' "$CPC_OUT" | grep -E '^❌|^    ·' | head -10
  fi
else
  check_warn "tools/check/check-prepush-checklist.mjs 不存在（守卫缺失）"
fi

# ════════════════════════════════════════
# 1c. 门禁清单覆盖对账（check-gate-inventory.sh）
# 为什么需要：本仓每个守卫都进了 tools/README.md 的**登记表**，但「守卫是否真的被调用」
#   长期零对账 ⇒ **孤儿守卫**：脚本写好、登记在册、零调用点，红态无人知晓。
#   实案：check-forms.mjs 曾整批红着，而 pre-commit 钩子 / 本文件 / releasing 各阶段
#   门禁清单**全都不含它**——它只活在登记表里。**登记 ≠ 调用**，本步把两者机械化。
# 覆盖口径（四项显式声明见脚本头）：脚本面认裸名且剔注释行 · 文档面只认 `tools/check/`
#   路径化引用 · **登记表与 docs/changelog/v* 历史记述不在任何面内**（描述 ≠ 调用）·
#   区分大小写。豁免：确不在开源仓自动调用的守卫写进 `playbook/.gate-inventory-exempt`。
# 三态语义：0 = 无孤儿；1 = 有孤儿或陈旧豁免；2 = 失明（守卫 <30 / 调用面 <5 /
#   语料装载不完整——拒绝假绿）。
# 成本实测：约 6s（对全语料单次 grep，非 42×171 次进程启动）。
# ════════════════════════════════════════
echo -e "\n${BOLD}── 1c. 门禁清单覆盖对账 ──${NC}"
if [ -f tools/check/check-gate-inventory.sh ]; then
  GI_OUT=$(bash tools/check/check-gate-inventory.sh 2>&1)
  GI_RC=$?
  if [ "$GI_RC" -eq 0 ]; then
    check_pass "check-gate-inventory.sh（守卫全部有调用点或已豁免）"
  elif [ "$GI_RC" -eq 2 ]; then
    check_fail "check-gate-inventory.sh 检查器失明（exit 2——扫描面塌缩/语料漏载，拒绝假绿）"
    printf '%s\n' "$GI_OUT" | grep -E '失明' | head -3
  else
    check_fail "check-gate-inventory.sh 发现孤儿守卫或陈旧豁免（exit ${GI_RC}）"
    printf '%s\n' "$GI_OUT" | grep -E '❌|处置二选一' | head -10
  fi
else
  check_warn "tools/check/check-gate-inventory.sh 不存在（守卫缺失）"
fi

# ════════════════════════════════════════
# 2. 版本号一致性（check-version.sh）
#   v1.4.9 G-2③：**发版窗口默认开 --strict**（warning 也阻断）。
#   动机（实测）：v1.4.8 发版批里 check-version §15 已精确抓到「ROADMAP 版本头描述与
#   CHANGELOG 标题不一致」，但只计 WARNING、不带 --strict 即放行 ⇒ 已知告警随发版出门
#   （即 P1-7 的根因形态：门禁看见了，却没拦住）。窗口内告警必须当场裁决。
#   窗口判据（与 check-version §27「待发版窗口态」同源，不另造口径）：
#     已发版态（本地 tag v{SSOT} 在位）**且** 下一 patch 版开发日志在位
#     ⇒ 版本一致性天然处中间态，正是「告警必须当场裁决」的时刻。
#   窗口外维持旧行为（不带 --strict，warning 只提示）——避免把非发版期的
#   合法中间态告警变成日常推阻。
#   退出码语义：0=全绿 · 1=有 ERROR（不一致）· 2=--strict 下有 WARNING；1/2 均判 FAIL。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 2. 版本号一致性 ──${NC}"
  _cv_strict_args=""
  _cv_ssot_ver=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
  if [ -n "${_cv_ssot_ver}" ]; then
    # 注意：取 major.minor 必须用 %.* （最短后缀 ".patch"）——写成 %.*.* 会剥到只剩 major
    # （"1.4.8" → "1"，实测踩过），窗口判据随之失效。
    _cv_2seg="${_cv_ssot_ver%.*}"
    _cv_patch="${_cv_ssot_ver##*.}"
    _cv_next="${_cv_2seg}.$((_cv_patch + 1))"
    _cv_devlog="docs/changelog/v${_cv_2seg}/v${_cv_next}.md"
    if git rev-parse "v${_cv_ssot_ver}" >/dev/null 2>&1 && [ -s "${_cv_devlog}" ]; then
      _cv_strict_args="--strict"
      echo -e "  ${YELLOW}发版窗口态${NC}（tag v${_cv_ssot_ver} 在位 + v${_cv_next} 开发日志 ${_cv_devlog}）——check-version 以 --strict 跑（warning 也阻断）"
    fi
  fi
  _cv_out=$(bash tools/check/check-version.sh ${_cv_strict_args} 2>&1); _cv_rc=$?
  if [ "${_cv_rc}" -eq 0 ]; then
    check_pass "check-version.sh 全部通过${_cv_strict_args:+（--strict 发版窗口，warning 已清零）}"
  elif [ "${_cv_rc}" -eq 2 ]; then
    check_fail "check-version.sh --strict：有 warning 未裁决（发版窗口不放行）"
    echo "${_cv_out}" | grep -E "⚠|⏭️" | head -10 | sed 's/^/    /'
    echo "    裁决口径：真问题 → 当场修；合法窗口态 → 应计「降级跳过（⏭️）」而非「警告（⚠）」（见 check-version §27 先例与发版 SOP「SKIP 数逐条裁决」步骤）"
  else
    check_fail "check-version.sh 有不一致（rc=${_cv_rc}）"
    echo "${_cv_out}" | grep "❌" | head -10 | sed 's/^/    /'
  fi
  unset _cv_out _cv_rc _cv_strict_args _cv_ssot_ver _cv_2seg _cv_patch _cv_next _cv_devlog
fi

# ════════════════════════════════════════
# 2b. 零接线导出门禁（check-unwired-exports.sh · v1.4.5 T11/A2）
#     发版闸门双跑：存量 SYMBOLS 表 + --since <上一 tag> 版本 diff 驱动
#     （新交付 @public 导出必须逐个判定接线或显式 SDK-face 白名单——
#      防接线债按版本复利累积）。上一 tag 自动探测：git describe --abbrev=0。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 2b. 零接线导出门禁 ──${NC}"
  if bash tools/check/check-unwired-exports.sh >/dev/null 2>&1; then
    check_pass "check-unwired-exports.sh（@public 符号全接线或已登记豁免）"
  else
    check_fail "check-unwired-exports.sh 发现零接线导出"
    bash tools/check/check-unwired-exports.sh 2>&1 | grep "✗" | head -5 | sed 's/^/    /'
  fi
  PREV_TAG_AUTO=$(git describe --abbrev=0 --tags 2>/dev/null || true)
  if [ -n "$PREV_TAG_AUTO" ]; then
    if bash tools/check/check-unwired-exports.sh --since "$PREV_TAG_AUTO" >/dev/null 2>&1; then
      check_pass "check-unwired-exports.sh --since ${PREV_TAG_AUTO}（版本 diff 驱动：新 @public 导出全判定）"
    else
      check_fail "check-unwired-exports.sh --since ${PREV_TAG_AUTO} 发现零接线新增导出"
      bash tools/check/check-unwired-exports.sh --since "$PREV_TAG_AUTO" 2>&1 | grep "✗" | head -5 | sed 's/^/    /'
    fi
  else
    check_pass "check-unwired-exports.sh --since 跳过（仓库无历史 tag——首版场景）"
  fi
fi

# ════════════════════════════════════════
# 2c. 模板漂移总闸（check-template-drift.sh · v1.4.5 T12/A2 同族）
#   三断言：hook 部署文件版本 / 插件双 manifest / core dist 编译时效
#   退出码 2（脚本自身错误）也算 FAIL——检查器失明不得放行
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 2c. 模板漂移总闸 ──${NC}"
  _drift_output=$(bash tools/check/check-template-drift.sh 2>&1)
  _drift_rc=$?
  if [ "$_drift_rc" -eq 0 ]; then
    check_pass "check-template-drift.sh（模板三断言 vs SSOT 一致）"
  else
    check_fail "check-template-drift.sh 发现模板漂移（rc=${_drift_rc}）"
    echo "$_drift_output" | grep "✗" | head -5 | sed 's/^/    /'
  fi
  unset _drift_output _drift_rc
fi

# ════════════════════════════════════════
# 2d. 开源边界守卫（check-open-boundary.sh · 对标 wemux public-boundary）
#   全仓 tracked 扫描补 check-docs §2c 活文档白名单外的源码盲区；
#   push 前是最后一道本地拦截。三态语义同 storefront（PASS/FAIL/SKIP-可见）
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 2d. 开源边界守卫 ──${NC}"
  _ob_output=$(bash tools/check/check-open-boundary.sh 2>&1)
  _ob_rc=$?
  if [ "$_ob_rc" -eq 0 ]; then
    check_pass "check-open-boundary.sh（全仓商业名零泄漏）"
  else
    check_fail "check-open-boundary.sh 发现商业名泄漏（rc=${_ob_rc}）"
    echo "$_ob_output" | grep "❌\|❌" | head -5 | sed 's/^/    /'
  fi
  unset _ob_output _ob_rc
fi

# ════════════════════════════════════════
# 2e. 越包相对引用守卫（check-cross-package-relative.mjs · v1.4.9 P1-2）
#   相对 import/require 解析后越出包根 ⇒ FAIL（已登记的存量豁免除外）。
#   6 款 DSH 原子插件对 plugin-kit 的相对引用是刻意设计（见该包 //notWorkspace；v1.4.9 P2 合并批 9→6），
#   此前**只写在注释里、零守卫**；本步把它升级为可执行约束。
#   退出码：0 = 绿（可含可见 SKIP）/ 1 = 有未登记越包引用 / 2 = 检查器失明
#   （扫描面结构缺失时拒绝假绿——缺件被读成「零违规」正是要杀的形态）
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 2e. 越包相对引用守卫 ──${NC}"
  _xpr_output=$(node tools/check/check-cross-package-relative.mjs 2>&1)
  _xpr_rc=$?
  if [ "$_xpr_rc" -eq 0 ]; then
    check_pass "check-cross-package-relative.mjs（越包相对引用零新增 / 存量 §台账一致）"
  else
    check_fail "check-cross-package-relative.mjs（rc=${_xpr_rc}）"
    echo "$_xpr_output" | grep "❌\|✗" | head -5 | sed 's/^/    /'
  fi
  unset _xpr_output _xpr_rc
fi

# ════════════════════════════════════════
# 3. 文档检查（check-docs.sh）
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3. 文档检查 ──${NC}"
  if bash tools/check/check-docs.sh >/dev/null 2>&1; then
    check_pass "check-docs.sh 全部通过"
  else
    check_fail "check-docs.sh 有问题"
    bash tools/check/check-docs.sh 2>&1 | grep "❌\|⚠️" | head -10
  fi
fi

# ════════════════════════════════════════
# 3c. 手填字面量对账（check-literals.sh · v1.4.6 新增）
# 同一事实被手抄两份（真相源 + 文档手填字面量）时，抄完容易漂移：
# bootstrap 7 个 sha256、dev prompt 的日志快照行数、ARCHITECTURE 的 workspace 数
# 均已实锤漂移过。本门禁按 tools/check/literals.json 注册表逐条比对，
# 新增字面量只需登记一行、不写新代码。文件不存在/慢速条目自动跳过。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3c. 手填字面量对账 ──${NC}"
  if bash tools/check/check-literals.sh --quiet >/dev/null 2>&1; then
    check_pass "check-literals.sh 全部通过（无 error 级字面量漂移）"
  else
    check_fail "check-literals.sh 发现手填字面量漂移"
    bash tools/check/check-literals.sh 2>&1 | grep "❌" | head -10
    echo "  提示：bash tools/check/check-literals.sh --fix 可自动回填真值"
  fi
fi

# ════════════════════════════════════════
# 3b. 跨文档锚点校验（check-anchors.mjs · v1.3.1 新增）
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 4. 跨文档锚点校验 ──${NC}"
  if node tools/check/check-anchors.mjs >/dev/null 2>&1; then
    check_pass "check-anchors.mjs 全部通过（跨文件锚点引用有效）"
  else
    check_fail "check-anchors.mjs 发现锚点过时"
    node tools/check/check-anchors.mjs 2>&1 | grep "✗" | head -10
    echo "  提示：node tools/check/check-anchors.mjs --fix 可自动修复"
  fi
fi

# ════════════════════════════════════════
# 3c. 审查体系一致性（check-review-system.sh · v1.4.8 bugfix 批接入）
# 根因：此前该门禁只在发版 SOP 阶段五/七人工触发——post-release 文档
# commit 可带着红门禁推上远端（v1.4.7+4 实锤：维度数漂移存活 4 commit）。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3c. 审查体系一致性 ──${NC}"
  if bash tools/check/check-review-system.sh >/dev/null 2>&1; then
    check_pass "check-review-system.sh 全部通过"
  else
    check_fail "check-review-system.sh 有 FAIL"
    bash tools/check/check-review-system.sh 2>&1 | grep "❌" | head -10
  fi
fi

# ════════════════════════════════════════
# 3d. 静默吞错门禁（check-silent-catch.mjs · v1.4.8 F-10 门禁前移）
# 只拦新增（存量基线豁免）——关键路径 catch 空块不再无痕增长。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3d. 静默吞错检查 ──${NC}"
  if node tools/check/check-silent-catch.mjs >/dev/null 2>&1; then
    check_pass "check-silent-catch.mjs 通过（无新增静默吞错）"
  else
    check_fail "check-silent-catch.mjs 发现新增静默吞错"
    node tools/check/check-silent-catch.mjs 2>&1 | grep -E "❌|^  " | head -10
  fi
fi

# ════════════════════════════════════════
# 3e. 依赖方向架构测试（dependency-direction.sh · v1.4.8 第七章）
# build 序列 13 包依赖方向：核心层 ← 约束层 ← 适配层 ← CLI/展示层。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3e. 依赖方向架构测试 ──${NC}"
  if bash tools/check/dependency-direction.sh >/dev/null 2>&1; then
    check_pass "dependency-direction.sh 通过（13 包方向合法）"
  else
    check_fail "dependency-direction.sh 发现违规依赖边"
    bash tools/check/dependency-direction.sh 2>&1 | grep -E "❌" | head -10
  fi
fi

# ════════════════════════════════════════
# 3f. 工具健康（check-tool-health.sh · v1.4.9 G-12 接入）
# 根因（实测取证，非推断）：`grep check-tool-health tools/release/pre-push-check.sh` **零命中**——
#   该门禁此前只在 .github/workflows/pr-check.yml:171-172 被调用，**本地推前链路完全看不到它**。
#   后果：v1.4.9 P1-2 批新增的 2 个 tools/check/ 文件未被 tools/README.md 收录，⑦ 收录对账
#   报红而 pre-push 毫无反应（直到另一个批次偶然单跑该脚本才暴露）——**同一类「前序批次真实漏网」**。
# 三态映射（按该脚本退出码 + 警告计数「落对应态」，不改它的退出码语义）：
#   0 且 0 警告 → pass ／ 0 且 警告>0 → warn ／ 1 → fail ／ 2 → fail（**检查器失明**，单独报）
#   ⚠️ exit 2 必须单独报：该脚本以 exit 2 表示「自身失明/结构缺失」（如 SSOT 读不到、
#   tools/README.md 缺失）——若与 exit 1 同归一语，就丢了「拒绝假绿」这一层语义。
# 成本实测：4.5s（含⑦的防线失明故障注入），相对 pre-push 全量 ~5min 可忽略。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3f. 工具健康 ──${NC}"
  TH_OUT=$(bash tools/check/check-tool-health.sh 2>&1)
  TH_RC=$?
  # 摘要行形态：`工具健康全通过（9 项 ✅ · 0 警告）` / `工具健康 FAIL：N 项不通过（M 警告）`
  TH_WARN=$(printf '%s\n' "$TH_OUT" | grep -oE '· [0-9]+ 警告' | head -1 | grep -oE '[0-9]+' || echo "")
  TH_SUMMARY=$(printf '%s\n' "$TH_OUT" | grep -E '工具健康(全通过|FAIL)' | head -1 | sed 's/^ *//')
  if [ "$TH_RC" -eq 0 ]; then
    if [ -z "$TH_WARN" ]; then
      # 摘要行形态漂移 ⇒ 不静默当作「0 警告」（守卫不空转）
      check_warn "check-tool-health.sh 退出 0，但警告计数提取为空（摘要行形态漂移，请核对）"
      printf '%s\n' "$TH_OUT" | grep -E '工具健康' | head -3
    elif [ "$TH_WARN" -gt 0 ]; then
      check_warn "check-tool-health.sh 通过但有 ${TH_WARN} 警告：${TH_SUMMARY}"
    else
      check_pass "check-tool-health.sh ${TH_SUMMARY:-全部通过}"
    fi
  elif [ "$TH_RC" -eq 2 ]; then
    check_fail "check-tool-health.sh 检查器失明（exit 2——结构缺失/SSOT 不可读，拒绝假绿）"
    printf '%s\n' "$TH_OUT" | tail -10
  else
    check_fail "check-tool-health.sh 有 FAIL（exit ${TH_RC}）"
    printf '%s\n' "$TH_OUT" | grep -E '❌|⚠️' | head -10
  fi
fi

# ════════════════════════════════════════
# ========================================
# 3g. 对外文档写作纪律（doc-discipline.sh · v1.4.9 P2-27）
# 依据 CONTRIBUTING.md:137-140：对外公开文档不写内部工单/审查代号、本机私有路径。
# 与 3d 静默吞错同款纪律——把「人工记得」升级为「机器拦得住」。
# ========================================
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3g. 对外文档写作纪律 ──${NC}"
  if bash tools/check/doc-discipline.sh >/dev/null 2>&1; then
    check_pass "doc-discipline.sh 通过（对外文档零内部代号 / 零本机私有路径）"
  else
    check_fail "doc-discipline.sh 发现违规（内部工单代号或本机私有路径）"
    bash tools/check/doc-discipline.sh 2>&1 | grep -E "❌|命中" | head -10
  fi
fi

# ════════════════════════════════════════
# 3h. 形态归属标注对账（check-forms.mjs）
# 为什么需要：changelog 每章须挂 `> **形态归属**：` 行、形态词走封闭枚举、ROADMAP
#   声明的形态计数与 changelog 实测**逐版双向对账**——这些此前只靠人肉自查
#   （实测：38 章标注里 7 章曾标错或标缺，无一条被守卫拦住）。
#   本步把它升级为可执行约束：加章漏挂标注 / 声明数与实测不符 / 计数 pin 被偷改，
#   都在推前当场红。
# 三态语义：0 = 全绿；1 = 违规/缺失/越界/自相矛盾/对账不符；2 = 失明（扫描面 <6 文件
#   或需标注章 <30——拒绝假绿）。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 3h. 形态归属标注对账 ──${NC}"
  CF_OUT=$(node tools/check/check-forms.mjs 2>&1)
  CF_RC=$?
  if [ "$CF_RC" -eq 0 ]; then
    check_pass "check-forms.mjs（changelog ↔ ROADMAP 形态归属一致）"
  elif [ "$CF_RC" -eq 2 ]; then
    check_fail "check-forms.mjs 检查器失明（exit 2——扫描面塌缩，拒绝假绿）"
    printf '%s\n' "$CF_OUT" | tail -8
  else
    check_fail "check-forms.mjs 发现形态标注违规（exit ${CF_RC}）"
    printf '%s\n' "$CF_OUT" | grep -E '❌|✗' | head -10
  fi
  unset CF_OUT CF_RC
fi

# 4. 审计模块构建 + 测试数汇总（对应 verify.yml + test-count.sh 门禁）
# ════════════════════════════════════════
if [ "$MINIMAL" = false ] && [ "$QUICK" = false ]; then
  echo -e "\n${BOLD}── 5. 审计模块构建 + 测试数汇总 ──${NC}"
  echo "  构建中..."
  if (npm run build >/dev/null 2>&1); then
    check_pass "npm run build (workspace 拓扑序)"
  else
    check_fail "npm run build 失败"
  fi

  echo "  测试+汇总中（test-count.sh，任一包失败即拦截）..."
  TEST_OUT=$(bash tools/check/test-count.sh 2>&1)
  TEST_RC=$?
  # 输出 test-count.sh 的人读明细（每包 ✓/✗）
  echo "$TEST_OUT" | grep -E '✓|✗|⚠|TOTAL_TESTS' | sed 's/^/  /'
  if [ "$TEST_RC" -eq 0 ]; then
    check_pass "test-count.sh（workspace 全量，0 失败）"
  else
    check_fail "test-count.sh 有失败（RC=${TEST_RC}，见上方 ✗ 明细）"
  fi

  # 4b. 文档声称测试数 vs 实际值一致性（P1-3 根治 · v1.1.7 起）
  echo -e "\n  ${BOLD}文档测试数一致性（check-test-count.sh）...${NC}"
  if bash tools/check/check-test-count.sh --quiet 2>/dev/null | grep -q "^OK$"; then
    check_pass "check-test-count.sh（文档声称数 = 实际值）"
  else
    check_fail "check-test-count.sh 检测到文档测试数漂移"
    bash tools/check/check-test-count.sh 2>&1 | grep "✗" | head -5 | sed 's/^/    /'
  fi
fi

# ════════════════════════════════════════
# 4b. FORGE driver 冒烟测试（import/export 接线 + 测试文件）
# ════════════════════════════════════════
# FORGE/ 不在 npm workspaces 内，npm test 不覆盖 FORGE/src/*.test.mjs。
# driver 的接线断裂（如 DEFAULT_BUDGET 缺 export）只有手动跑 driver 时才暴露。
# 此步在推前自动验证：模块可加载 + dry-run 不崩 + 测试文件可运行。
if [ "$MINIMAL" = false ] && [ "$QUICK" = false ]; then
  echo -e "\n${BOLD}── 6. FORGE driver 冒烟测试 ──${NC}"
  FORGE_OUT=$(bash tools/forge/forge-smoke-test.sh 2>&1)
  FORGE_RC=$?
  echo "$FORGE_OUT" | grep -E "通过|失败|✗|⚠" | sed 's/^/  /'
  if [ "$FORGE_RC" -eq 0 ]; then
    check_pass "forge-smoke-test.sh（模块加载 + 测试文件）"
  else
    check_fail "forge-smoke-test.sh 有失败项"
  fi
fi

# ════════════════════════════════════════
# 5. sofagent-audit（对应 sofagent-audit.yml）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 7. CLI 二进制验证 ──${NC}"
for bin_name in sofagent-audit sofagent-orchestrator sofagent-daemon sofagent-ontology sofagent-ab-test sofagent-think sofagent-evolve sofagent-core; do
  pkg=$(echo "$bin_name" | sed 's/sofagent-//')
  if [ -f "engine/$pkg/dist/cli.js" ]; then
    node "engine/$pkg/dist/cli.js" --help >/dev/null 2>&1 && check_pass "$bin_name --help" || check_fail "$bin_name --help"
  fi
done

# ════════════════════════════════════════
# 6. install.sh 关键路径检查（fde.md 迁移断裂防护）
# ════════════════════════════════════════
echo -e "\n${BOLD}── 8. install.sh 关键路径 ──${NC}"
# v0.99.8 教训：fde.md 从 skill/ 迁到 skill/data/，8 处引用需要同步。
# pre-push-check 之前不覆盖 install.sh，路径断裂检测不到。此步补盲。
# v1.2.2 更新：harness/data/ 目录取消，fde.md 提升为 harness/fde-template.md
INSTALL_CRITICAL_FILES=(
  "SKILL/harness/fde-template.md"
  "SKILL/SKILL.md"
  "SKILL/AGENTS.md"
  "SKILL/agents/fde/SKILL.md"
  "SKILL/agents/audit/SKILL.md"
  "SKILL/agents/engineer/SKILL.md"
  "SKILL/agents/reviewer/SKILL.md"
  "SKILL/harness/entry-gate.md"
  "SKILL/harness/task-aware.md"
  "SKILL/harness/task-closure.md"
  "SKILL/harness/loop-check.md"
  "SKILL/harness/engage.md"
  "SKILL/harness/engage-fde.md"
  "SKILL/harness/loop-evaluate.md"
  "SKILL/harness/loop-exit.md"
)
PATH_FAIL=0
for f in "${INSTALL_CRITICAL_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo -e "  ${RED}✗${NC} 缺失: $f"
    PATH_FAIL=$((PATH_FAIL + 1))
  fi
done

# 检查 install.sh 引用的路径和实际文件是否一致
# v1.2.0: install.sh 已从 engine/scripts/ 提升到根目录，SCRIPT_DIR = 项目根目录
# RULES_SRC 格式: "${SCRIPT_DIR}/SKILL/harness/fde-template.md" → 从项目根目录解析相对路径
INSTALL_RULES_SRC=$(grep 'RULES_SRC=' install.sh 2>/dev/null | head -1 | sed 's/.*="\${SCRIPT_DIR}\///;s/".*//')
if [ -n "$INSTALL_RULES_SRC" ]; then
  if [ ! -f "$INSTALL_RULES_SRC" ]; then
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
echo -e "\n${BOLD}── 9. Tag message 校验 ──${NC}"
SSOT_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null) || true
if [ -n "$SSOT_VERSION" ] && git tag -l "v${SSOT_VERSION}" | grep -q "v${SSOT_VERSION}" 2>/dev/null; then
  TAG_MSG=$(git tag -l "v${SSOT_VERSION}" --format='%(subject)' 2>/dev/null || true)
  if grep -q "${SSOT_VERSION}" <<< "$TAG_MSG"; then
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
  #   pre-push-check 的职责是预防未来，不是追溯历史。历史污点在 docs/LIMITATIONS.md 标注即可。
  TAG_COMMIT_MSG=$(git log -1 "v${SSOT_VERSION}^{commit}" --format=%s 2>/dev/null || true)
  if [ -n "$TAG_COMMIT_MSG" ]; then
    if grep -q "${SSOT_VERSION}" <<< "$TAG_COMMIT_MSG"; then
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
    if grep -q "$hv" <<< "$hmsg"; then
      : # commit message 含版本号，正常
    else
      # 历史 commit message 不可改（rebase 重写会级联影响 50+ tag）
      # 只有指向当前 HEAD 的 tag（= 本轮发版的 tag）commit message 不含版本号才 FAIL，
      # 其余所有历史 tag 一律 WARN 豁免，并在 docs/LIMITATIONS.md 记录。
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
echo -e "\n${BOLD}── 10. 依赖图循环检测 ──${NC}"
CYCLE_CHECK=$(node -e '
const fs = require("fs");
const path = require("path");
const dirs = fs.readdirSync("engine").filter(d => {
  try { return fs.statSync(path.join("engine", d)).isDirectory(); } catch(e) { return false; }
});
const edges = {}; // pkgName -> Set of depPkgNames
for (const d of dirs) {
  const pjPath = path.join("engine", d, "package.json");
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
let cycles = [];
for (const [a, depsA] of Object.entries(edges)) {
  for (const b of depsA) {
    if (edges[b] && edges[b].has(a)) {
      const key = [a.replace("@sofagent/",""), b.replace("@sofagent/","")].sort().join("↔");
      cycles.push(key);
    }
  }
}
if (cycles.length > 0) {
  console.log("CYCLE:" + cycles.join(","));
} else {
  console.log("OK");
}
' 2>&1)
if grep -q "^OK$" <<< "$CYCLE_CHECK"; then
  check_pass "依赖图无循环"
elif grep -q "^CYCLE:" <<< "$CYCLE_CHECK"; then
  check_fail "依赖图发现循环：$(echo "$CYCLE_CHECK" | sed 's/CYCLE://')"
else
  check_warn "依赖图循环检测执行异常（跳过）"
fi

# ════════════════════════════════════════
# F-17: CHANGELOG 纯度扫描
# ════════════════════════════════════════
echo -e "\n${BOLD}── 11. CHANGELOG 纯度扫描 ──${NC}"
CHANGELOG_FILE="CHANGELOG.md"
if [ -f "$CHANGELOG_FILE" ]; then
  # 提取当前版本号：优先从 package.json（SSOT），fallback 到 CHANGELOG
  LATEST_VER=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
  if [ -z "$LATEST_VER" ]; then
    # fallback: 从 CHANGELOG 提取（兼容旧格式 ### [vX.Y.Z] 和新格式 - **vX.Y.Z**）
    LATEST_VER=$(grep -m1E "^\- \*\*v|^\#\#\# \[v" "$CHANGELOG_FILE" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/^v//')
  fi
  if [ -n "$LATEST_VER" ]; then
    # 提取当前版本条目段落（兼容两种 CHANGELOG 格式）
    CHANGELOG_SECTION=$(sed -n "/\*\*v${LATEST_VER}\*\*\|^### \[v${LATEST_VER}\]/,/\*\*v\|^### \[v/p" "$CHANGELOG_FILE" | sed '$d')
    # 扫描审查元信息关键词（P0×N / P1×N 等带乘号计数模式 + fresh-eyes 审查描述）
    META_HITS=$(echo "$CHANGELOG_SECTION" | grep -cE "P[0-2]×|fresh-eyes 独立审查|审查轮次|审查发现 [0-9]+" || true); META_HITS=${META_HITS:-0}
    if [ "$META_HITS" -gt 0 ] 2>/dev/null; then
      check_fail "CHANGELOG ${LATEST_VER} 条目含 ${META_HITS} 处审查元信息（P0×N / fresh-eyes / 审查轮次）"
      echo "$CHANGELOG_SECTION" | grep -nE "P[0-2]×|fresh-eyes 独立审查|审查轮次|审查发现 [0-9]+" | head -5 | while read -r hit; do
        echo "    $hit"
      done
    else
      check_pass "CHANGELOG ${LATEST_VER} 条目无审查元信息残留"
    fi
  else
    check_warn "无法从 CHANGELOG 提取当前版本号"
  fi
else
  check_warn "CHANGELOG.md 不存在"
fi

# ════════════════════════════════════════
echo -e "\n${BOLD}── 12. shell 变量定界守卫（CJK 标点）──${NC}"
# v1.3.6 后新增：$VAR 后紧跟全角标点 = bash 把标点拼进变量名，set -u 下崩溃。
# 实案：pre-push-check.sh $TEST_RC， 潜伏一个月（仅失败分支触发），08-18 修复
if [ -f tools/check/check-cjk-var.sh ]; then
  if bash tools/check/check-cjk-var.sh; then
    check_pass "check-cjk-var.sh（\${VAR} 定界）"
  else
    check_fail "check-cjk-var.sh 发现变量定界违规（修法：花括号显式定界）"
  fi
else
  check_warn "tools/check/check-cjk-var.sh 不存在（守卫缺失）"
fi

# ════════════════════════════════════════
echo -e "\n${BOLD}── 13. 防线失明自检（故障注入 fail-loud）──${NC}"
# 守卫依赖的检测引擎故障时必须报红而非假绿——「0 处违规但根本没在看」
# 比没有防线更坏。本步用 PATH 劫持假引擎实测守卫的 fail-loud 行为。
if [ -f tools/check/check-guard-fail-loud.sh ]; then
  if bash tools/check/check-guard-fail-loud.sh; then
    check_pass "check-guard-fail-loud.sh（守卫失明必失声）"
  else
    check_fail "check-guard-fail-loud.sh 发现失明不自知的守卫（引擎故障下仍 exit 0）"
  fi
else
  check_warn "tools/check/check-guard-fail-loud.sh 不存在（失明自检缺失）"
fi

# ════════════════════════════════════════
# 14. 家目录口径对照（check-home-resolution-parity.mjs · v1.4.9 G-9 接入）
# 为什么需要：dependency-direction.yml 把 harness 定为 layer 0 · allow: [] ⇒
#   harness 不能 import core 的 resolveHomeDir，只能本地重实现 resolveEngineHome()
#   ——**被迫重复 ≠ 允许不可见**（P1-4 就是口径漂移的实案）。
# 为什么排在 14（**不能前移**）：该守卫两侧都跑**真实调用**（require 各包 dist）
#   ⇒ 依赖第 5 步的构建产物；前移到构建之前会在干净检出上误报「dist 缺失」。
# 三态语义：0 = 口径与登记表一致；1 = 未登记差异 / 守卫失明（提取不到实现或观测不到哨兵）。
# 成本实测：约 0.4s（6 行矩阵 × 1 个子进程）。
# ════════════════════════════════════════
if [ "$MINIMAL" = false ]; then
  echo -e "\n${BOLD}── 14. 家目录口径对照 ──${NC}"
  if [ -f tools/check/check-home-resolution-parity.mjs ]; then
    HP_OUT=$(node tools/check/check-home-resolution-parity.mjs 2>&1)
    HP_RC=$?
    if [ "$HP_RC" -eq 0 ]; then
      check_pass "check-home-resolution-parity.mjs（harness ↔ core 口径一致，登记差异已钉住）"
    else
      check_fail "check-home-resolution-parity.mjs 发现未登记差异或守卫失明（exit ${HP_RC}）"
      printf '%s\n' "$HP_OUT" | grep -E '^❌|^⇒' | head -10
    fi
  else
    check_warn "tools/check/check-home-resolution-parity.mjs 不存在（守卫缺失）"
  fi
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
  echo "  修复后重新跑: ./tools/release/pre-push-check.sh"
  exit 1
else
  echo -e "  ${GREEN}✅ 可以 push 了！${NC}"
  echo ""
  exit 0
fi
