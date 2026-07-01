#!/usr/bin/env bash
# ============================================================
# check-version.sh · 检查全项目版本号一致性
# ============================================================
# 用法: ./tools/check-version.sh
#
# 功能: 从 package.json 读 version（SSOT），检查全项目"结构性"位置
#       的版本号是否一致，不一致则报错 exit 1。
#
# 退出码:
#   0 = 全部一致
#   1 = 发现不一致
#
# 检查范围（只查结构性位置，不做全量 grep——自然避开历史引用）:
#   1. package.json version 字段（SSOT 本身）
#   2. .ts 文件: const VERSION = 'X.Y'
#   3. index.ts: v0.94（注释 + console.log）
#   4. .sh 文件: VERSION="X.Y"
#   5. .ps1 文件: $VERSION / $VERSION_STR = "X.Y"
#   6. MD 文件头: > vX.Y · 日期/描述（带 · 分隔符的才是版本头）
#   7. README badge: version-(v?)X.Y
#   8. SKILL.md frontmatter: version: X.Y
#
# 排除目录: docs/changelog/, node_modules/, .git/, dist/
#
# 历史引用过滤策略:
#   只检查"结构性"位置（VERSION= 常量、package.json、MD 版本头标记、
#   README badge、SKILL frontmatter），不做全量 grep。
#   MD 版本头的判定: 必须是 "> vX.Y · " 格式（带 · 分隔符），
#   这样自然过滤掉 CHANGELOG/ROADMAP 正文中引用旧版本的文字。
#
# 版本号格式说明:
#   - package.json 用 3 段格式（0.94.0）
#   - .ts/.sh/.ps1 源码常量用 3 段格式（0.94.0）——check 时与 SSOT 完整 3 段比对
#   - MD 版本头 / SKILL.md frontmatter 用 2 段格式（0.94）——check 时取 SSOT 前 2 段比对
#   - README badge 用 2 段格式
# ============================================================

set -uo pipefail
# 注意: 不用 set -e，因为我们要收集所有错误后统一报告

# ── 颜色 ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 项目根目录 ────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ERRORS=0
CHECKS=0

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  check-version${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ── 1. 从 package.json 读 SSOT ────────────────────────────────
PACKAGE_JSON="${PROJECT_ROOT}/sofagent/audit/package.json"
if [[ ! -f "${PACKAGE_JSON}" ]]; then
  echo -e "${RED}✗ 找不到 SSOT: ${PACKAGE_JSON}${NC}"
  exit 1
fi

SSOT_VERSION=$(grep -o '"version": "[^"]*"' "${PACKAGE_JSON}" | head -1 | sed 's/"version": "//;s/"//')

if [[ -z "${SSOT_VERSION}" ]]; then
  echo -e "${RED}✗ 无法从 package.json 读取 version 字段${NC}"
  exit 1
fi

# 提取 2 段版本号（用于与 .ts/.sh/.ps1/MD 等位置比对）
SSOT_2SEG=$(echo "${SSOT_VERSION}" | cut -d. -f1-2)

echo -e "  ${BOLD}SSOT (package.json):${NC}  ${SSOT_VERSION}"
echo -e "  ${BOLD}期望版本 (完整):${NC}   ${SSOT_VERSION}"
echo -e "  ${BOLD}项目根:${NC}             ${PROJECT_ROOT}"
echo ""

# ── 检查辅助函数 ──────────────────────────────────────────────
report_error() {
  local file="$1"
  local found="$2"
  local expected="$3"
  echo -e "  ${RED}✗${NC} ${file}"
  echo -e "    ${RED}期望: ${expected}${NC}"
  echo -e "    ${RED}实际: ${found}${NC}"
  ERRORS=$((ERRORS + 1))
}

report_ok() {
  local file="$1"
  local found="$2"
  echo -e "  ${GREEN}✓${NC} ${file} (${found})"
  CHECKS=$((CHECKS + 1))
}

# 从匹配行中提取版本号（纯数字+点号）
extract_version() {
  echo "$1" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1
}

# ── 2. 检查 .ts 文件 const VERSION = 'X.Y'（动态扫描，不硬编码文件列表）
echo -e "${BOLD}── [1/8] TypeScript 常量 ──${NC}"
while IFS= read -r ts; do
  [[ -f "${ts}" ]] || continue
  match=$(grep -n "const [A-Z_]*VERSION = '" "${ts}" | head -1)
  if [[ -z "${match}" ]]; then
    continue
  fi
  found_ver=$(extract_version "${match}")
  if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${ts}" "${found_ver}" "${SSOT_VERSION}"
  else
    report_ok "${ts}" "${found_ver}"
  fi
done < <(grep -rl "const [A-Z_]*VERSION = '" \
  --include='*.ts' \
  "${PROJECT_ROOT}/sofagent/audit/src/" \
  "${PROJECT_ROOT}/sofagent/mcp/src/" \
  2>/dev/null || true)
echo ""

# ── 3. 检查 index.ts vOLD 引用 ────────────────────────────────
echo -e "${BOLD}── [2/8] index.ts 版本引用 ──${NC}"
INDEX_TS="${PROJECT_ROOT}/sofagent/audit/src/index.ts"
if [[ ! -f "${INDEX_TS}" ]]; then
  echo -e "  ${YELLOW}⚠${NC} 文件不存在: ${INDEX_TS}"
else
  index_ok=true
  while IFS= read -r line; do
    found_ver=$(extract_version "${line}")
    if [[ -n "${found_ver}" ]] && [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${INDEX_TS}" "v${found_ver}" "v${SSOT_VERSION}"
      index_ok=false
    fi
  done < <(grep -nE 'v[0-9]+\.[0-9]+' "${INDEX_TS}")
  if ${index_ok}; then
    report_ok "${INDEX_TS}" "v${SSOT_2SEG}"
  fi
fi
echo ""

# ── 4. 检查 .sh 文件 VERSION="X.Y" ────────────────────────────
echo -e "${BOLD}── [3/8] Shell 脚本 ──${NC}"
SH_DIR="${PROJECT_ROOT}/sofagent/scripts"
if [[ ! -d "${SH_DIR}" ]]; then
  echo -e "  ${YELLOW}⚠${NC} 目录不存在: ${SH_DIR}"
else
  for sh in "${SH_DIR}"/*.sh; do
    [[ -f "${sh}" ]] || continue
    # 跳过我们自己的工具脚本（工具不是产品）
    case "$(basename "${sh}")" in
      bump-version.sh|check-version.sh) continue ;;
    esac
    match=$(grep -n 'VERSION="' "${sh}" | head -1)
    if [[ -z "${match}" ]]; then
      # 没有 VERSION 行，可能是特殊脚本（如 check-portability.sh, run-envs.sh），跳过
      continue
    fi
    found_ver=$(extract_version "${match}")
    if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${sh}" "${found_ver}" "${SSOT_VERSION}"
    else
      report_ok "$(basename "${sh}")" "${found_ver}"
    fi
  done
fi
echo ""

# ── 5. 检查 .ps1 文件 $VERSION / $VERSION_STR = "X.Y" ──────────
echo -e "${BOLD}── [4/8] PowerShell 脚本 ──${NC}"
PS1_DIR="${PROJECT_ROOT}/sofagent/scripts/windows"
if [[ ! -d "${PS1_DIR}" ]]; then
  echo -e "  ${YELLOW}⚠${NC} 目录不存在: ${PS1_DIR}"
else
  ps1_found_any=false
  for ps1 in "${PS1_DIR}"/*.ps1; do
    [[ -f "${ps1}" ]] || continue
    # 同时匹配 $VERSION = " 和 $VERSION_STR = " 两种变量名
    # shellcheck disable=SC2016
    match=$(grep -nE '\$VERSION(_STR)? = "' "${ps1}" | head -1)
    if [[ -z "${match}" ]]; then
      continue
    fi
    ps1_found_any=true
    found_ver=$(extract_version "${match}")
    if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${ps1}" "${found_ver}" "${SSOT_VERSION}"
    else
      report_ok "$(basename "${ps1}")" "${found_ver}"
    fi
  done
  if ! ${ps1_found_any}; then
    echo -e "  ${YELLOW}⚠${NC} 未在任何 .ps1 中找到 \$VERSION 定义"
  fi
fi
echo ""

# ── 6. 检查 MD 文件头 > vX.Y · date（版本头格式）──────────────
# 只匹配 "> vX.Y · " 格式（带 · 分隔符），这是版本头标记。
# 正文中引用旧版本的 "> v0.84 只记录..." 不带 · 分隔符，自然被过滤。
echo -e "${BOLD}── [5/8] Markdown 版本头 (> vX.Y · 日期/描述) ──${NC}"
md_checked=0
md_mismatch=0
while IFS= read -r md; do
  # 只匹配版本头: "> vX.Y · " 格式（· 是版本头分隔符）
  match=$(grep -m3 -nE '^> v[0-9]+\.[0-9]+(\.[0-9]+)? · ' "${md}" | head -1)
  if [[ -z "${match}" ]]; then
    # 没有 · 分隔符的版本头——不是版本头格式，跳过
    continue
  fi
  found_ver=$(extract_version "${match}")
  if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${md}" "> v${found_ver}" "> v${SSOT_VERSION}"
    md_mismatch=$((md_mismatch + 1))
  else
    md_checked=$((md_checked + 1))
  fi
done < <(find "${PROJECT_ROOT}" \
  -name '*.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/docs/changelog/*' \
  -type f)
echo -e "  ${GREEN}✓${NC} ${md_checked} 个 MD 版本头一致"
echo ""

# ── 7. 检查 README badge version-vX.Y ─────────────────────────
echo -e "${BOLD}── [6/8] README badge ──${NC}"
for readme in \
  "${PROJECT_ROOT}/README.md" \
  "${PROJECT_ROOT}/README.en.md"; do
  [[ -f "${readme}" ]] || continue
  match=$(grep -oiE 'version-v?[0-9]+\.[0-9]+' "${readme}" | head -1)
  if [[ -z "${match}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 未找到 badge: $(basename "${readme}")"
    continue
  fi
  found_ver=$(extract_version "${match}")
  if [[ "${found_ver}" != "${SSOT_2SEG}" ]]; then
    report_error "${readme}" "version-v${found_ver}" "version-v${SSOT_2SEG}"
  else
    report_ok "$(basename "${readme}")" "v${found_ver}"
  fi
done
echo ""

# ── 8. 检查 SKILL.md frontmatter version: X.Y ─────────────────
echo -e "${BOLD}── [7/8] SKILL.md frontmatter ──${NC}"
while IFS= read -r skill; do
  match=$(grep -m5 -nE '^version: [0-9]+\.[0-9]+' "${skill}" | head -1)
  if [[ -z "${match}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 无 version 字段: ${skill}"
    continue
  fi
  found_ver=$(extract_version "${match}")
  # SKILL.md 可能用 2 段或 3 段，取前 2 段比对
  found_2seg=$(echo "${found_ver}" | cut -d. -f1-2)
  if [[ "${found_2seg}" != "${SSOT_2SEG}" ]]; then
    report_error "${skill}" "version: ${found_ver}" "version: ${SSOT_2SEG}"
  else
    report_ok "${skill#"${PROJECT_ROOT}"/}" "${found_ver}"
  fi
done < <(find "${PROJECT_ROOT}" \
  -name 'SKILL.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -type f)
echo ""

# ── 9. 检查 package.json SSOT 格式（必须 3 段）─────────────────
echo -e "${BOLD}── [8/8] package.json SSOT 格式 ──${NC}"
seg_count=$(echo "${SSOT_VERSION}" | tr -cd '.' | wc -c | tr -d ' ')
if [[ "${seg_count}" -ne 2 ]]; then
  echo -e "  ${RED}✗${NC} package.json version 应为 3 段格式（如 0.94.0），当前: ${SSOT_VERSION}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}✓${NC} package.json version = ${SSOT_VERSION} (3 段格式正确)"
fi
echo ""

# ── 10. 检查 sofagent/mcp 依赖 @sofagent/audit 版本与 SSOT 一致 ─
MCP_PKG="${PROJECT_ROOT}/sofagent/mcp/package.json"
if [[ -f "${MCP_PKG}" ]]; then
  dep_ver=$(grep '"@sofagent/audit":' "${MCP_PKG}" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if [[ "${dep_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${MCP_PKG}" "@sofagent/audit: ${dep_ver}" "@sofagent/audit: ${SSOT_VERSION}"
  else
    report_ok "${MCP_PKG#"${PROJECT_ROOT}"/}" "${dep_ver}"
  fi
fi
echo ""

# ── 汇总 ──────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
if [[ ${ERRORS} -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ✓ 全部一致！版本号 = ${SSOT_VERSION}${NC}"
  echo -e "  检查通过: ${CHECKS} 项"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}  ✗ 发现 ${ERRORS} 处不一致！${NC}"
  echo -e "  期望版本: ${SSOT_VERSION} (SSOT: ${SSOT_VERSION})"
  echo -e "  修复: ./tools/bump-version.sh <旧版本> ${SSOT_VERSION}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  exit 1
fi
