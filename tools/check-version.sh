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
#   9. mcp package.json version
#  10. ROADMAP 「现在在哪」节标题
#  11. package-lock.json 双包版本
#  12. .ts 文件头注释版本号
#  13. 全局 npm 二进制版本（sofagent-audit --version）
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
#
# 退出码:
#   0 = 全部通过（可能有 warning，但不阻断）
#   1 = 有 error（版本号不一致）
#   2 = --strict 模式下有 warning（CI 严格模式用）
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
WARNINGS=0
STRICT=false

# ── 参数解析 ──
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=true ;;
    --help|-h)
      echo "check-version.sh — 版本号一致性校验"
      echo "  --strict   warning 也返回 exit 2（CI 严格模式）"
      echo "  --help     显示此帮助"
      exit 0
      ;;
  esac
done

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  check-version${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ── 1. 从 package.json 读 SSOT ────────────────────────────────
PACKAGE_JSON="${PROJECT_ROOT}/package.json"
if [[ ! -f "${PACKAGE_JSON}" ]]; then
  echo -e "${RED}✗ 找不到 SSOT (根 package.json): ${PACKAGE_JSON}${NC}"
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

report_warn() {
  local file="$1"
  local msg="$2"
  echo -e "  ${YELLOW}⚠${NC} ${file}"
  echo -e "    ${YELLOW}${msg}${NC}"
  CHECKS=$((CHECKS + 1))
  WARNINGS=$((WARNINGS + 1))
}

# 从匹配行中提取版本号（纯数字+点号）
extract_version() {
  echo "$1" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1
}

# ── 2. 检查 .ts 文件 const VERSION = 'X.Y'（动态扫描，不硬编码文件列表）
echo -e "${BOLD}── [1/14] TypeScript 常量 ──${NC}"
# 动态扫描 12 个子包目录（v1.1.0 多包结构）
SCAN_DIRS=()
for pkg in harness ontology eval core audit mcp orchestrator daemon ab-test work模板市场 think skillopt; do
  PKG_SRC="${PROJECT_ROOT}/sofagent/${pkg}/src"
  if [[ -d "${PKG_SRC}" ]]; then
    SCAN_DIRS+=("${PKG_SRC}")
  fi
done
while IFS= read -r ts; do
  [[ -f "${ts}" ]] || continue
  # 跳过归档目录（_archive 和 docs/archive）
  [[ "${ts}" == */_archive/* ]] && continue
  [[ "${ts}" == */docs/archive/* ]] && continue
  # mcp-server.ts 已改为从 @sofagent/audit 导入 VERSION，不再跳过
  # v1.1.3: SCHEMA_VERSION 是数据结构 schema 版本（如 checkpoint 'v1'），非产品版本，豁免
  match=$(grep -n "const [A-Z_]*VERSION = '" "${ts}" | grep -v 'PROTOCOL_VERSION' | grep -v 'SCHEMA_VERSION' | head -1)
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
  "${SCAN_DIRS[@]}" \
  2>/dev/null || true)
echo ""

# ── 3. 检查 index.ts vOLD 引用（12 子包遍历）────────────────
echo -e "${BOLD}── [2/14] index.ts 版本引用 ──${NC}"
for pkg in harness ontology eval core audit mcp orchestrator daemon ab-test work模板市场 think skillopt; do
  INDEX_TS="${PROJECT_ROOT}/sofagent/${pkg}/src/index.ts"
  if [[ ! -f "${INDEX_TS}" ]]; then
    continue
  fi
  index_ok=true
  while IFS= read -r line; do
    found_ver=$(extract_version "${line}")
    if [[ -n "${found_ver}" ]] && [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${INDEX_TS}" "v${found_ver}" "v${SSOT_VERSION}"
      index_ok=false
    fi
  # v1.1.0: 过滤注释行（//、/*、* 开头的 JSDoc），避免历史版本号误报
  # v1.1.3: 过滤 deprecation 提示行（「将在 vX.Y.Z 移除」「已弃用」是未来目标版本，非当前版本引用）
  done < <(grep -nE 'v[0-9]+\.[0-9]+' "${INDEX_TS}" | grep -vE '^[0-9]+:[[:space:]]*(//|/\*\*?|\*)' | grep -v '将在 v[0-9.]*\.[0-9]* 移除' | grep -v '已弃用')
  if ${index_ok}; then
    report_ok "${INDEX_TS}" "v${SSOT_2SEG}"
  fi
done
echo ""

# ── 4. 检查 .sh 文件 VERSION="X.Y" ────────────────────────────
echo -e "${BOLD}── [3/14] Shell 脚本 ──${NC}"
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
    # 额外检查：文件头注释中的 · vX.Y 格式（daemon 脚本等用此格式）
    header_ver=$(head -5 "${sh}" | grep -oE '· v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
    if [[ -n "${header_ver}" ]] && [[ "${header_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${sh}" "注释头 v${header_ver}" "v${SSOT_VERSION}"
    fi
  done
fi

# 检查 FDE/fde-install.sh 注释头版本号
FDE_SH="${PROJECT_ROOT}/FDE/fde-install.sh"
if [[ -f "${FDE_SH}" ]]; then
  header_ver=$(head -5 "${FDE_SH}" | grep -oE '· v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if [[ -n "${header_ver}" ]] && [[ "${header_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${FDE_SH}" "注释头 v${header_ver}" "v${SSOT_VERSION}"
  else
    report_ok "fde-install.sh" "v${header_ver:-N/A}"
  fi
fi

# 检查 LOOP/loop-install.sh 注释头版本号 + VERSION 常量
LOOP_SH="${PROJECT_ROOT}/LOOP/loop-install.sh"
if [[ -f "${LOOP_SH}" ]]; then
  header_ver=$(head -5 "${LOOP_SH}" | grep -oE '· v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if [[ -n "${header_ver}" ]] && [[ "${header_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${LOOP_SH}" "注释头 v${header_ver}" "v${SSOT_VERSION}"
  else
    report_ok "loop-install.sh" "v${header_ver:-N/A}"
  fi
  # VERSION 常量（如存在）也必须与 SSOT 一致
  ver_const=$(grep -nE '^VERSION="[0-9]+\.[0-9]+\.[0-9]+"' "${LOOP_SH}" | head -1)
  if [[ -n "${ver_const}" ]]; then
    ver_const_val=$(extract_version "${ver_const}")
    if [[ "${ver_const_val}" != "${SSOT_VERSION}" ]]; then
      report_error "${LOOP_SH}" "VERSION 常量 ${ver_const_val}" "${SSOT_VERSION}"
    fi
  fi
fi

# 检查 FDE/package.json + LOOP/package.json version 字段
for pkg_file in "${PROJECT_ROOT}/FDE/package.json" "${PROJECT_ROOT}/LOOP/package.json"; do
  if [[ -f "${pkg_file}" ]]; then
    pkg_ver=$(grep -oE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' "${pkg_file}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [[ -n "${pkg_ver}" ]] && [[ "${pkg_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${pkg_file}" "version: ${pkg_ver}" "version: ${SSOT_VERSION}"
    else
      report_ok "$(basename "$(dirname "${pkg_file}")")/package.json" "${pkg_ver:-N/A}"
    fi
  fi
done
echo ""

# ── 5. 检查 .ps1 文件 $VERSION / $VERSION_STR = "X.Y" ──────────
echo -e "${BOLD}── [4/14] PowerShell 脚本 ──${NC}"
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
echo -e "${BOLD}── [5/14] Markdown 版本头 (> vX.Y · 日期/描述) ──${NC}"
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
  -not -path '*/docs/archive/*' \
  -not -path '*/_archive/*' \
  -type f)
echo -e "  ${GREEN}✓${NC} ${md_checked} 个 MD 版本头一致（共检查 $((md_checked + md_mismatch)) 个）"
echo ""

# ── 7. 检查 README badge version-vX.Y ─────────────────────────
echo -e "${BOLD}── [6/14] README badge ──${NC}"
for readme in \
  "${PROJECT_ROOT}/README.md" \
  "${PROJECT_ROOT}/README.en.md"; do
  [[ -f "${readme}" ]] || continue
  match=$(grep -oiE 'version-v?[0-9]+\.[0-9]+(\.[0-9]+)?' "${readme}" | head -1)
  if [[ -z "${match}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 未找到 badge: $(basename "${readme}")"
    continue
  fi
  found_ver=$(extract_version "${match}")
  # badge 可能是 2 段或 3 段——取 SSOT 对应格式比较
  found_2seg=$(echo "${found_ver}" | cut -d. -f1-2)
  # 如果 badge 是 3 段格式，直接与 SSOT 3 段比较
  if [[ "${found_ver}" == *.*.* ]]; then
    if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${readme}" "version-v${found_ver}" "version-v${SSOT_VERSION}"
    else
      report_ok "$(basename "${readme}")" "v${found_ver}"
    fi
  else
    # 2 段格式：与 SSOT 2 段比较
    if [[ "${found_2seg}" != "${SSOT_2SEG}" ]]; then
      report_error "${readme}" "version-v${found_ver}" "version-v${SSOT_2SEG}"
    else
      report_ok "$(basename "${readme}")" "v${found_ver}"
    fi
  fi
done
echo ""

# ── 8. 检查 SKILL.md frontmatter version: X.Y ─────────────────
echo -e "${BOLD}── [7/14] SKILL.md frontmatter ──${NC}"
while IFS= read -r skill; do
  match=$(grep -m5 -nE '^version: [0-9]+\.[0-9]+' "${skill}" | head -1)
  if [[ -z "${match}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 无 version 字段: ${skill}"
    continue
  fi
  found_ver=$(extract_version "${match}")
  # SKILL.md 用 3 段精确比对（v1.0.x 系列 patch 号不同也要检测）
  if [[ "${found_ver}" == *.*.* ]]; then
    # 3 段格式：精确比对
    if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${skill}" "version: ${found_ver}" "version: ${SSOT_VERSION}"
    else
      report_ok "${skill#"${PROJECT_ROOT}"/}" "${found_ver}"
    fi
  else
    # 2 段格式：取前 2 段比对
    found_2seg=$(echo "${found_ver}" | cut -d. -f1-2)
    if [[ "${found_2seg}" != "${SSOT_2SEG}" ]]; then
      report_error "${skill}" "version: ${found_ver}" "version: ${SSOT_2SEG}"
    else
      report_ok "${skill#"${PROJECT_ROOT}"/}" "${found_ver}"
    fi
  fi
done < <(find "${PROJECT_ROOT}" \
  -name 'SKILL.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/templates/*' \
  -type f)
echo ""

# ── 9. 检查 package.json SSOT 格式（必须 3 段）─────────────────
echo -e "${BOLD}── [8/14] package.json SSOT 格式 ──${NC}"
seg_count=$(echo "${SSOT_VERSION}" | tr -cd '.' | wc -c | tr -d ' ')
if [[ "${seg_count}" -ne 2 ]]; then
  echo -e "  ${RED}✗${NC} package.json version 应为 3 段格式（如 0.94.0），当前: ${SSOT_VERSION}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}✓${NC} package.json version = ${SSOT_VERSION} (3 段格式正确)"
fi
echo ""

# ── 9b. 检查 12 个子包 package.json version 与 SSOT 一致 ─
echo -e "${BOLD}── [9/14] 子包版本号一致性 ──${NC}"
for pkg in harness ontology eval core audit mcp orchestrator daemon ab-test work模板市场 think skillopt; do
  PKG_JSON="${PROJECT_ROOT}/sofagent/${pkg}/package.json"
  if [[ ! -f "${PKG_JSON}" ]]; then
    continue
  fi
  pkg_ver=$(grep -o '"version": "[^"]*"' "${PKG_JSON}" | head -1 | sed 's/"version": "//;s/"//')
  if [[ -z "${pkg_ver}" ]]; then
    continue
  fi
  if [[ "${pkg_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "sofagent/${pkg}/package.json" "version: ${pkg_ver}" "version: ${SSOT_VERSION}"
  else
    report_ok "sofagent/${pkg}/package.json" "${pkg_ver}"
  fi
done
echo ""

# ── 10. 检查 sofagent/mcp 依赖 @sofagent/audit 版本（支持 ^ 范围） ─
MCP_PKG="${PROJECT_ROOT}/sofagent/mcp/package.json"
if [[ -f "${MCP_PKG}" ]]; then
  dep_line=$(grep '"@sofagent/audit":' "${MCP_PKG}")
  dep_ver=$(echo "${dep_line}" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  # v0.99.7 起 mcp 用 ^ 范围版本（如 ^0.99.6），不再要求精确匹配 SSOT
  # 规则：major.minor 必须一致，patch 可以 ≤ SSOT
  dep_major_minor=$(echo "${dep_ver}" | cut -d. -f1,2)
  ssot_major_minor=$(echo "${SSOT_VERSION}" | cut -d. -f1,2)
  dep_patch=$(echo "${dep_ver}" | cut -d. -f3)
  ssot_patch=$(echo "${SSOT_VERSION}" | cut -d. -f3)
  if [[ "${dep_major_minor}" != "${ssot_major_minor}" ]]; then
    report_error "${MCP_PKG}" "@sofagent/audit: ${dep_ver}" "major.minor = ${ssot_major_minor}.x"
  elif [[ "${dep_patch}" -gt "${ssot_patch}" ]]; then
    report_error "${MCP_PKG}" "@sofagent/audit: ${dep_ver}" "≤ ${SSOT_VERSION}"
  elif [[ $(( ssot_patch - dep_patch )) -ge 3 ]]; then
    # patch 落后 ≥ 3 提示警告（不 fail，但提示同步）
    _gap=$(( ssot_patch - dep_patch ))
    report_warn "${MCP_PKG#"${PROJECT_ROOT}"/}" "@sofagent/audit: ${dep_ver}（落后 SSOT ${_gap} 个 patch，建议同步到 ^${SSOT_VERSION}）"
  else
    report_ok "${MCP_PKG#"${PROJECT_ROOT}"/}" "@sofagent/audit: ${dep_line#*: }"
  fi
fi
echo ""

# ── 10b. 检查 sofagent/mcp 自身 version 字段与 SSOT 一致 ─
echo -e "${BOLD}── [10/14] mcp 包版本号 ──${NC}"
if [[ -f "${MCP_PKG}" ]]; then
  mcp_ver=$(grep '"version":' "${MCP_PKG}" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ -z "${mcp_ver}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 未找到 mcp version 字段"
  elif [[ "${mcp_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${MCP_PKG}" "version: ${mcp_ver}" "version: ${SSOT_VERSION}"
  else
    report_ok "${MCP_PKG#"${PROJECT_ROOT}"/}" "version: ${mcp_ver}"
  fi
fi
echo ""

# ── 10c. 检查 ROADMAP「现在在哪」节标题版本号 ─
echo -e "${BOLD}── [11/14] ROADMAP 节标题 ──${NC}"
ROADMAP="${PROJECT_ROOT}/ROADMAP.md"
if [[ -f "${ROADMAP}" ]]; then
  roadmap_ver=$(grep '^## 现在在哪：v' "${ROADMAP}" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if [[ -z "${roadmap_ver}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 未找到「现在在哪」节标题"
  else
    roadmap_2seg=$(echo "${roadmap_ver}" | cut -d. -f1-2)
    if [[ "${roadmap_2seg}" != "${SSOT_2SEG}" ]]; then
      report_error "${ROADMAP}" "现在在哪：v${roadmap_ver}" "现在在哪：v${SSOT_VERSION}"
    else
      report_ok "ROADMAP.md" "现在在哪：v${roadmap_ver}"
    fi
  fi
fi
echo ""

# ── 10c-2. 检查 package-lock.json 中双包版本与 SSOT 一致 ─
LOCK_FILE="${PROJECT_ROOT}/package-lock.json"
if [[ -f "${LOCK_FILE}" ]]; then
  # audit 和 mcp 在 lock 的 packages 段里有 version 字段
  audit_lock_ver=$(grep -A3 '"sofagent/audit":' "${LOCK_FILE}" | grep '"version"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  mcp_lock_ver=$(grep -A3 '"sofagent/mcp":' "${LOCK_FILE}" | grep '"version"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ -n "${audit_lock_ver}" ]] && [[ "${audit_lock_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${LOCK_FILE}" "audit lock: ${audit_lock_ver}" "${SSOT_VERSION}"
  elif [[ -n "${audit_lock_ver}" ]]; then
    report_ok "package-lock.json" "audit: ${audit_lock_ver}"
  fi
  if [[ -n "${mcp_lock_ver}" ]] && [[ "${mcp_lock_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${LOCK_FILE}" "mcp lock: ${mcp_lock_ver}" "${SSOT_VERSION}"
  elif [[ -n "${mcp_lock_ver}" ]]; then
    report_ok "package-lock.json" "mcp: ${mcp_lock_ver}"
  fi
fi
echo ""

# ── 10d. 检查 .ts 文件头注释中的 vX.Y.Z 残留 ─
echo -e "${BOLD}── [12/14] TS 文件头注释版本号 ──${NC}"
ts_header_errors=0
while IFS= read -r ts; do
  [[ -f "${ts}" ]] || continue
  [[ "${ts}" == */_archive/* ]] && continue
  [[ "${ts}" == */docs/archive/* ]] && continue
  [[ "${ts}" == *.test.ts ]] && continue
  [[ "${ts}" == */dist/* ]] && continue
  # 只检查文件头前 10 行的注释（与 bump-version.sh [4/13] 对齐）
  match=$(head -10 "${ts}" | grep -m2 -nE '// .*v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [[ -z "${match}" ]] && continue
  found_ver=$(echo "${match}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${ts}" "v${found_ver}" "v${SSOT_VERSION}"
    ts_header_errors=$((ts_header_errors + 1))
  fi
done < <(find "${PROJECT_ROOT}/sofagent" \
  -name '*.ts' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/_archive/*' \
  -type f 2>/dev/null || true)
if [[ ${ts_header_errors} -eq 0 ]]; then
  echo -e "  ${GREEN}✓${NC} TS 文件头注释版本号一致"
fi
echo ""

# ── 11. 检查正文中"当前 vX.Y"是否与项目版本一致 ─
echo -e "${BOLD}── [13/14] 正文版本号引用 ──${NC}"
inline_checked=0
inline_errors=0
while IFS=: read -r file line_num rest; do
  # 提取"当前 v"后面的完整版本号（2 段或 3 段）
  found_ver=$(echo "$rest" | grep -oE '当前 v[0-9]+\.[0-9]+(\.[0-9]+)?' | sed 's/当前 v//' | head -1)
  if [[ -z "$found_ver" ]]; then
    continue
  fi
  inline_checked=$((inline_checked + 1))
  # 与 SSOT 完整版本号比对（3 段 vs 3 段）
  if [[ "$found_ver" != "$SSOT_VERSION" ]]; then
    report_error "${file}:${line_num}" "当前 v${found_ver}" "当前 v${SSOT_VERSION}"
    inline_errors=$((inline_errors + 1))
  fi
done < <(grep -rn "当前 v[0-9]" --include="*.md" . 2>/dev/null | grep -v node_modules | grep -v ".workbuddy/" | grep -v "docs/changelog/" || true)
if [[ $inline_checked -eq 0 ]]; then
  echo -e "  ${YELLOW}⚠${NC} 未找到"当前 vX.Y"版本引用"
elif [[ $inline_errors -eq 0 ]]; then
  echo -e "  ${GREEN}✓${NC} ${inline_checked} 处正文版本号引用一致"
fi
echo ""

# ── 12. 检查全局 npm 二进制版本与 SSOT 是否一致 ─────────
echo -e "${BOLD}── [14/14] 全局 npm 二进制版本 ──${NC}"
if command -v sofagent-audit >/dev/null 2>&1; then
  bin_ver=$(sofagent-audit --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ -z "${bin_ver}" ]]; then
    report_warn "sofagent-audit" "无法解析二进制版本号（输出格式异常）"
  elif [[ "${bin_ver}" != "${SSOT_VERSION}" ]]; then
    report_warn "sofagent-audit" "全局安装: v${bin_ver}，SSOT: v${SSOT_VERSION} —— 请运行 npm install -g @sofagent/audit@latest"
  else
    report_ok "sofagent-audit" "v${bin_ver}"
  fi
else
  report_warn "sofagent-audit" "未找到全局安装的 sofagent-audit 二进制"
fi
echo ""

# ── 12b. v1.1.3: 检查全部 @sofagent/* 包内部依赖版本一致性 ─
echo -e "${BOLD}── 检查子包内部依赖版本 ──${NC}"
INTERNAL_DEPS_OK=true
while IFS= read -r -d '' pkg_json; do
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg_json', 'utf-8'));
    const pkgName = pkg.name;
    for (const field of ['dependencies', 'optionalDependencies']) {
      if (pkg[field]) {
        for (const [name, ver] of Object.entries(pkg[field])) {
          if (name.startsWith('@sofagent/')) {
            const verClean = ver.replace(/^[~^>=<]+/, '');
            if (verClean !== '$SSOT_VERSION') {
              console.log('MISMATCH ' + pkgName + ' → ' + name + ': ' + ver + ' (期望: ' + '$SSOT_VERSION' + ')');
            }
          }
        }
      }
    }
  " 2>/dev/null
done < <(find "$PROJECT_ROOT/sofagent" -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" -print0 2>/dev/null) | while read -r line; do
  echo "  ❌ $line"
  INTERNAL_DEPS_OK=false
  ERRORS=$((ERRORS + 1))
  CHECKS=$((CHECKS + 1))
done
if $INTERNAL_DEPS_OK; then
  echo -e "  ${GREEN}✓${NC} 所有内部 @sofagent/* 依赖版本一致"
  CHECKS=$((CHECKS + 1))
fi
echo ""

# ── 文案数字漂移扫描（v1.1.6 新增 · 维度八·任务5 强化）──────────
# 扫描 audit 源码中疑似硬编码的「N 条规则」类声称，与 SSOT 对账
# SSOT: defaultRules.length（当前 13）/ 注册总数（21）
# 防止 init.ts 输出文案、fix-suggestions.ts/qa-boundary-verify.test.ts 注释等小数字无人对账
echo "=== 13. 文案数字漂移扫描（audit 源码硬编码规则条数）==="
DOC_DRIFT_OK=true
DEFAULT_RULES_COUNT=$(awk '/export const defaultRules/{f=1; next} f && /^[[:space:]]*\{.*name:/{c++} f && /^[[:space:]]*\];/{exit} END{print c+0}' sofagent/audit/src/rules/index.ts 2>/dev/null || echo 0)
TOTAL_RULES_COUNT=$(grep -cE "^\s+\{ name: '(A|E)[0-9]+" sofagent/audit/src/rules/index.ts 2>/dev/null || echo 0)
echo "  SSOT: defaultRules.length=$DEFAULT_RULES_COUNT 注册总数=$TOTAL_RULES_COUNT"
while IFS= read -r line; do
  num=$(echo "$line" | grep -oE "[0-9]+ 条" | grep -oE "^[0-9]+" | head -1)
  if [ -n "$num" ] && [ "$num" != "$DEFAULT_RULES_COUNT" ] && [ "$num" != "$TOTAL_RULES_COUNT" ]; then
    echo "  ❌ $line （与 SSOT $DEFAULT_RULES_COUNT/$TOTAL_RULES_COUNT 不符）"
    DOC_DRIFT_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done < <(grep -rnE "[0-9]+ 条规则|[0-9]+ 条默认的|[0-9]+ 条各自的" sofagent/audit/src 2>/dev/null | grep -v "import" | grep -v "defaultRules.length")
if $DOC_DRIFT_OK; then
  echo "  [OK] audit 源码无规则条数漂移"
fi
echo ""

# ── 文档头日期一致性扫描（v1.1.7 新增 · 修复一）──────────────
# 所有 `> vX.Y · YYYY-MM-DD` 文档头日期应与发版日期一致。
# bump-version.sh 只改版本号不改日期，反复出现文档头日期漂移；
# 本扫描以发版日期为唯一基准，任何不一致都报错。随版本更新时，
# 同步修改下方 EXPECTED_DOC_DATE 与 bump-version.sh。
echo "=== 14. 文档头日期一致性扫描（> vX.Y · YYYY-MM-DD）==="
DOC_DATE_OK=true
EXPECTED_DOC_DATE="2026-07-21"
while IFS= read -r md; do
  match=$(grep -m1 -nE "^> v[0-9]+\.[0-9]+(\.[0-9]+)? · [0-9]{4}-[0-9]{2}-[0-9]{2}" "$md" 2>/dev/null)
  if [ -n "$match" ]; then
    doc_date=$(printf '%s' "$match" | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" | head -1)
    if [ "$doc_date" != "$EXPECTED_DOC_DATE" ]; then
      echo "  ❌ $md : 文档头日期 ${doc_date} ≠ 发版日期 ${EXPECTED_DOC_DATE}"
      DOC_DATE_OK=false
      ERRORS=$((ERRORS + 1))
    fi
  fi
done < <(find "${PROJECT_ROOT}" \
  -name '*.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/docs/changelog/*' \
  -not -path '*/docs/archive/*' \
  -not -path '*/_archive/*' \
  -type f)
if $DOC_DATE_OK; then
  echo -e "  ${GREEN}✓${NC} 文档头日期一致（发版日期 ${EXPECTED_DOC_DATE}）"
  CHECKS=$((CHECKS + 1))
else
  echo -e "  ${RED}✗${NC} 存在文档头日期漂移（应统一为发版日期 ${EXPECTED_DOC_DATE}）"
fi
echo ""

# ── 汇总 ──────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
if [[ ${ERRORS} -eq 0 ]]; then
  TOTAL=$((CHECKS + ERRORS))
  echo -e "${GREEN}${BOLD}  ✓ 全部一致！版本号 = ${SSOT_VERSION}${NC}"
  echo -e "  检查通过: ${CHECKS}/${TOTAL} 项"
  if [[ ${WARNINGS} -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠ ${WARNINGS} 项警告${NC}（--strict 模式会阻断）"
  fi
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  if [[ "$STRICT" = true ]] && [[ ${WARNINGS} -gt 0 ]]; then
    exit 2
  fi
  exit 0
else
  echo -e "${RED}${BOLD}  ✗ 发现 ${ERRORS} 处不一致！${NC}"
  echo -e "  期望版本: ${SSOT_VERSION} (SSOT: ${SSOT_VERSION})"
  echo -e "  修复: ./tools/bump-version.sh <旧版本> ${SSOT_VERSION}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  exit 1
fi
