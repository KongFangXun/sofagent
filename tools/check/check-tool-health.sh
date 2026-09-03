#!/usr/bin/env bash
# check-tool-health.sh — 工具脚本健康检查（阶段九执行体）
# ============================================================
# 职责：把 SOP 阶段九的人肉检查收编为确定性检查——
#   ① 审查文档路径活性：四份审查文档 + checklist 中引用的仓库内文件
#      路径逐个 test -e，报死链（「check 能查但路径已搬家」防复发）
#   ② 孤儿配置排查：不属于本项目技术栈的配置文件出现在根目录
#   ③ bump ↔ check 对照：check-version 检查的每类文件形态，
#      bump-version 的「替换范围」清单都有对应步骤（结构性覆盖）
#   ④ hook 文件头版本标记与 SSOT 一致
#   ⑤ CI workflows 覆盖的脚本/路径引用有效
#   ⑥ tools/*.sh 新变量头部初始化守卫（set -u 炸弹防复发——
#      v1.3.7 run-28 同期 fresh-eyes 实查 test-count.sh FLAKY_PKGS 实案）
#   ⑦ tools/ README 收录对账（每个 git 追踪的脚本文件名须被
#      tools/README.md 提到——漂移预警，只提示不阻断）
#
# 设计纪律（与 check-review-system.sh 一致）：
#   - 清单核对器，不判断好坏；0=全绿 / 1=有 FAIL / 2=脚本自身错误
#   - 警戒线/计数全部动态提取，禁写死（版本演进必漂）
#   - macOS bash 3.2 兼容：无 mapfile/declare -A/关联数组
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

QUIET=false
for _arg in "$@"; do
  case "$_arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "check-tool-health.sh — 工具脚本健康检查（阶段九）"
      echo "  --quiet   只输出 OK / FAIL"
      echo "  --help    显示此帮助"
      exit 0 ;;
    *) echo "未知参数: $_arg"; exit 2 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; CYAN='\033[0;36m'; NC='\033[0m'

PASS=0
FAIL=0
WARN=0

ok()   { [ "$QUIET" = false ] && echo -e "  ${GREEN}✅${NC} $1"; PASS=$((PASS + 1)); return 0; }
bad()  { echo -e "  ${RED}❌${NC} $1"; [ -n "${2:-}" ] && echo -e "    $2"; FAIL=$((FAIL + 1)); return 0; }
warn() { [ "$QUIET" = false ] && echo -e "  ${YELLOW}⚠️${NC} $1"; WARN=$((WARN + 1)); return 0; }

# ============================================================
# ① 审查文档路径活性
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ① 审查文档路径活性 ──${NC}"

DOC_SOURCES="FORGE/playbook/regression-checklist.md FORGE/playbook/fresh-eyes-review.md docs/changelog/releasing/07-tool-health.md docs/changelog/releasing/04-review-system.md"

DEAD_LINKS=0
DEAD_LIST=""
for _doc in $DOC_SOURCES; do
  [ -f "$_doc" ] || continue
  # 提取反引号内的仓库相对路径（目录或文件），逐个验证存在性
  while IFS= read -r _p; do
    [ -z "$_p" ] && continue
    # 跳过通配/参数化/明显非路径
    echo "$_p" | grep -qE '[*?{}<>\$]|^/' && continue
    # 跳过「历史教训正文」里的不存在路径示例——上下文带「不存在/误指向/断链」字样的引用是
    # 在讲这个路径曾经错了，不是活引用（fresh-eyes-review 教训段大量此形态）
    if [ "$_doc" = "FORGE/playbook/fresh-eyes-review.md" ]; then
      _ctx=$(grep -B1 -A1 "\`$_p\`" "$_doc" | grep -cE '不存在|误指向|断链|不存在的|已废弃|指向不' || true)
      [ "${_ctx:-0}" -gt 0 ] && continue
    fi
    [ -e "$_p" ] || { DEAD_LINKS=$((DEAD_LINKS + 1)); DEAD_LIST="${DEAD_LIST}  $_doc → $_p"$'\n'; }
  done <<EOF
$(grep -oE '`[a-zA-Z][a-zA-Z0-9_./-]{2,}`' "$_doc" | tr -d '`' | grep -E '^(tools|engine|docs|FORGE|FDE|SKILL|\.github)/' | sort -u)
EOF
done
if [ "$DEAD_LINKS" -eq 0 ]; then
  ok "审查文档引用的仓库路径全部存在"
else
  bad "审查文档存在 $DEAD_LINKS 个死路径引用" "$DEAD_LIST"
fi

# ============================================================
# ② 孤儿配置排查（不属于本项目技术栈的根目录配置）
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ② 孤儿配置排查 ──${NC}"

ORPHAN_CANDIDATES="pnpm-workspace.yaml yarn.lock Pipfile requirements.txt pyproject.toml Cargo.toml go.mod Gemfile composer.json pom.xml build.gradle Makefile.cmake"
ORPHANS=0
for _oc in $ORPHAN_CANDIDATES; do
  if [ -e "$_oc" ]; then
    bad "根目录存在非本项目技术栈的孤儿配置：$_oc"
    ORPHANS=$((ORPHANS + 1))
  fi
done
[ "$ORPHANS" -eq 0 ] && ok "无孤儿配置文件"

# ============================================================
# ③ bump ↔ check 结构对照
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ③ bump ↔ check 结构对照 ──${NC}"

BUMP="tools/release/bump-version.sh"
CHECKV="tools/check/check-version.sh"
for _f in "$BUMP" "$CHECKV"; do
  [ -f "$_f" ] || { echo "❌ 脚本缺失: $_f" >&2; exit 2; }
done

# check-version 的检查类别标记 vs bump 的替换范围清单（结构性关键词对照）
# 原理：check 检查到的「位置形态」，bump 必须有对应替换步骤——对照两脚本的
# 自述清单关键词，缺哪类报哪类（不判断语义，只报结构缺口）
declare -a CATEGORY_PAIRS=(
  "TypeScript 常量:VERSION ="
  "shell 脚本:VERSION="
  "package.json:package.json"
  "README badge:badge"
  "SKILL.md:SKILL"
  "文档头:MD 文件头"
  "action.yml:action"
  "bootstrap:bootstrap"
)
CAT_MISSING=0
while IFS= read -r _pair; do
  _cv_label="${_pair%%:*}"
  _bump_kw="${_pair#*:}"
  [ -z "$_cv_label" ] || [ -z "$_bump_kw" ] && continue
  if ! grep -q "$_cv_label" "$CHECKV" 2>/dev/null; then
    # check 没这个类别标记不算 FAIL（类别命名可能演进）——仅当 bump 有而 check 全无时报 WARN
    :
  fi
done <<EOF
$(printf '%s\n' "${CATEGORY_PAIRS[@]}")
EOF

# 核心对照：bump「替换范围」清单里提到的每一类目标文件，check 侧有对应关键词
BUMP_RANGE=$(sed -n '/^# 替换范围/,/^# 不处理/p' "$BUMP" | grep -oE '[0-9]+\. .+' || true)
STRUCT_GAP=0
while IFS= read -r _line; do
  echo "$_line" | grep -qE '^\s*$' && continue
  # 提取该替换步骤的核心关键词（如 ".ts 文件"→"ts"、"README badge"→"README"）
  _kw=$(echo "$_line" | grep -oE '(README|SKILL|package\.json|index\.ts|MD 文件|\.ts|\.sh|\.ps1)' | head -1 || echo "")
  [ -z "$_kw" ] && continue
  if ! grep -q "$_kw" "$CHECKV"; then
    warn "bump 替换范围「${_line}」在 check-version 中未见对应检查关键词「${_kw}」——人工确认是否有检查覆盖"
    STRUCT_GAP=$((STRUCT_GAP + 1))
  fi
done <<EOF
$BUMP_RANGE
EOF
[ "$STRUCT_GAP" -eq 0 ] && ok "bump 替换范围与 check-version 检查面结构对照无缺口"

# ============================================================
# ④ hook 文件头版本标记 vs SSOT
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ④ hook 头版本标记 ──${NC}"

SSOT_VER=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
[ -z "$SSOT_VER" ] && { echo "❌ 无法读取 package.json version" >&2; exit 2; }

HOOK_FILES="engine/audit/hooks/commit-msg engine/audit/hooks/post-commit"
HOOK_STALE=0
for _h in $HOOK_FILES; do
  if [ -f "$_h" ]; then
    _hook_ver=$(head -4 "$_h" | grep -oE 'v?1\.[0-9]+\.[0-9]+' | head -1 | sed 's/^v//' || echo "")
    if [ -n "$_hook_ver" ] && [ "$_hook_ver" != "$SSOT_VER" ]; then
      bad "hook 版本标记滞后：$_h = v$_hook_ver ≠ SSOT v$SSOT_VER" "    修复：随版 bump（check-version 覆盖项，此处前置拦截）"
      HOOK_STALE=$((HOOK_STALE + 1))
    fi
  fi
done
[ "$HOOK_STALE" -eq 0 ] && ok "hook 文件头版本标记与 SSOT 一致（v${SSOT_VER}）"

# ============================================================
# ⑤ CI workflows 引用有效性
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ⑤ CI workflows 引用 ──${NC}"

CI_DIR=".github/workflows"
CI_DEAD=0
CI_LIST=""
for _yml in "$CI_DIR"/*.yml "$CI_DIR"/*.yaml; do
  [ -f "$_yml" ] || continue
  while IFS= read -r _p; do
    [ -z "$_p" ] && continue
    echo "$_p" | grep -qE '[*?{<>\$]|^\$|^https?:' && continue
    [ -e "$_p" ] || { CI_DEAD=$((CI_DEAD + 1)); CI_LIST="${CI_LIST}  $_yml → $_p"$'\n'; }
  done <<EOF
$(grep -oE '(tools|engine|FORGE|docs)/[a-zA-Z0-9_./-]+(\*[a-zA-Z0-9_./-]*)?' "$_yml" | grep -vE '\$\{' | while IFS= read -r _raw; do
  # glob 前缀引用（daemon* / lib/daemon*）是 CI paths 过滤器合法形态——
  # 验证「* 前的父目录」存在且前缀能匹配到至少一个文件；非 glob 原样通过
  echo "$_raw" | grep -q '\*' || { echo "$_raw"; continue; }
  _prefix="${_raw%%\**}"
  _dir="${_prefix%/*}"
  if [ -d "$_dir" ]; then
    ls "${_raw%\**}"* >/dev/null 2>&1 || ls "${_prefix}"* >/dev/null 2>&1 || echo "$_raw(glob 无匹配)"
  else
    echo "$_raw(父目录不存在)"
  fi
done | sort -u)
EOF
done
if [ "$CI_DEAD" -eq 0 ]; then
  ok "CI workflows 引用的本地路径全部有效"
else
  bad "CI workflows 存在 $CI_DEAD 个无效路径引用" "$CI_LIST"
fi

# ============================================================
# ⑥ tools/ 全部 .sh（含子目录——v1.3.9 分目录后 pre-push-check 移入 release/，tools/*.sh 顶层已无脚本）set -u 新变量初始化守卫
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ⑥ set -u 新变量初始化守卫 ──${NC}"

GUARD_VIOL=0
GUARD_LIST=""
for _sh in $(find tools -name '*.sh' -type f | sort); do
  [ -f "$_sh" ] || continue
  grep -qE '^\s*set\s+-.*u' "$_sh" || continue   # 只检查声明了 set -u 的脚本
  # 找「自引用赋值」：VAR="${VAR}..."（变量名与引用名相同才算自引用——拼接其它
  # 已初始化变量如 PATH="${ROOT}/bin" 不算）。行首或 do/then/; 之后；若该 VAR
  # 从未在之前显式初始化（VAR= 赋值 或 :- / := 兜底）即违规。v1.3.7 实案：
  # test-count.sh FLAKY_PKGS 在 `do FLAKY_PKGS="${FLAKY_PKGS}..."` 首次赋值即炸
  while IFS= read -r _assign; do
    _lineno=$(echo "$_assign" | grep -oE '^[0-9]+' || echo "0")
    # 提取「="${VAR}」紧邻左侧的赋值目标变量名（跳过行号/do/then/for 头等任意前缀）
    _var=$(echo "$_assign" | grep -oE '[A-Za-z_][A-Za-z_0-9]*="\$\{[A-Za-z_][A-Za-z_0-9]*\}' | grep -oE '^[A-Za-z_][A-Za-z_0-9]*' || echo "")
    [ -z "$_var" ] && continue
    # 自引用确认：赋值行内出现 "${VAR}（任意后缀）——用 -F 匹配 "${VAR 前缀
    echo "$_assign" | grep -qF '"${'"${_var}"'}' || continue
    # 在该赋值行之前找初始化：VAR= 赋值行（含缩进/local/declare 前缀）或 ${VAR:= / ${VAR:- 兜底
    _init=$(head -n $((_lineno - 1)) "$_sh" | grep -cE "^[[:space:]]*(local |declare [-a-zA-Z]+ )?${_var}=|\${${_var}:-|\${${_var}:=" || true)
    if [ "${_init:-0}" -eq 0 ]; then
      GUARD_VIOL=$((GUARD_VIOL + 1))
      GUARD_LIST="${GUARD_LIST}  $_sh:$_lineno → $_var 未初始化即自引用"$'\n'
    fi
  done <<EOF
$(grep -nE '(^|[;[:space:]])(do[[:space:]]+|then[[:space:]]+)?[A-Za-z_][A-Za-z_0-9]*="\$\{[A-Za-z_][A-Za-z_0-9]*\}' "$_sh" | grep -vE '^[0-9]+:\s*#' || true)
EOF
done
if [ "$GUARD_VIOL" -eq 0 ]; then
  ok "set -u 脚本无「未初始化自引用」炸弹"
else
  bad "发现 $GUARD_VIOL 处未初始化自引用（set -u 炸弹模式）" "$GUARD_LIST"
fi

# ============================================================
# ⑦ tools/ README 收录对账（只提示不阻断——漂移预警，新机制渐进纪律）
# ============================================================
# 原理：tools/ 下每个 git 追踪的脚本/数据文件（.sh/.mjs/.json/.html），
# tools/README.md 必须提到它的文件名——README 未收录 = 漂移（新脚本
# 落地没登记，或脚本搬家 README 没跟）。只 WARN 不 FAIL：新机制先
# 跑观察期，与 spec-first 门禁同款「只提示不阻断」纪律。
[ "$QUIET" = false ] && echo -e "\n${BOLD}${CYAN}── ⑦ README 收录对账（漂移预警） ──${NC}"

README_MD="tools/README.md"
[ -f "$README_MD" ] || { echo "❌ 缺 tools/README.md" >&2; exit 2; }

UNLISTED=0
UNLISTED_LIST=""
while IFS= read -r _tf; do
  [ -z "$_tf" ] && continue
  _base=$(basename "$_tf")
  # README 提到该文件名即视为已收录（表格条目/正文引用均可）
  grep -qF "$_base" "$README_MD" || {
    UNLISTED=$((UNLISTED + 1))
    UNLISTED_LIST="${UNLISTED_LIST}  $_tf"$'\n'
  }
done <<EOF
$(git ls-files 'tools/*.sh' 'tools/*.mjs' 'tools/*.json' 'tools/*.html' 'tools/*/*.sh' 'tools/*/*.mjs' 'tools/*/*.json' 'tools/*/*.html' | grep -v 'README.md' | grep -v 'audit-questionnaires/' || true)
EOF
if [ "$UNLISTED" -eq 0 ]; then
  ok "tools/ 全部脚本均被 tools/README.md 收录"
else
  warn "有 $UNLISTED 个文件未收录进 tools/README.md（漂移预警——不阻断）" "$UNLISTED_LIST"
fi

# ============================================================
# 汇总
# ============================================================
[ "$QUIET" = false ] && echo -e "\n${BOLD}═══════════════════════════════════════════════${NC}"
if [ "$FAIL" -gt 0 ]; then
  [ "$QUIET" = false ] && echo -e "  ${RED}工具健康 FAIL：${FAIL} 项不通过（${WARN} 警告）${NC}"
  [ "$QUIET" = true ] && echo "FAIL"
  exit 1
else
  [ "$QUIET" = false ] && echo -e "  ${GREEN}工具健康全通过（${PASS} 项 ✅ · ${WARN} 警告）${NC}"
  [ "$QUIET" = true ] && echo "OK"
  exit 0
fi
