#!/usr/bin/env bash
# ============================================================
# check-version.sh · 检查全项目版本号一致性
# ============================================================
# v1.3.9: 补 locale export——CI/sandbox 默认 LANG=C 会把含中文的文件
# 判成二进制（BSD grep 误判 .md 为 binary），版本比对静默失效（v1.3.1 run-10 阻塞复发防御）。
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
# 用法: ./tools/check/check-version.sh
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
#  14. 文档示例版本号占位符（docs/ 下 @sofagent/*@<真实版本> = bug，应用 <LATEST>）
#  15-24. ROADMAP/WIKI/MCP 工具数/安装入口 tag/构建产物/lock 同步/CHANGELOG 顶版漂移等
#  25. 待发版窗口三态一致性（B1：CHANGELOG 收录 × 双语 README 状态行 × 安装 URL 配套齐）
#  26. 工具数全仓口径（B8：11 处活文档工具数叙事必含当前实数，防口径漏改）
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

# v1.2.2 F-03: 预防性内存限制——防止 node 进程 OOM (exit 137)
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

# ── 颜色 ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 覆盖度行范式（v1.4.9 G-2②）──
# 必须在取 PROJECT_ROOT 之前定位自身目录（cd/相对路径问题在此脚本内表现为 $0 相对路径）。
_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

# ── 项目根目录 ────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ERRORS=0
CHECKS=0
WARNINGS=0
# SKIPS（v1.4.9 G-2②）：显式「降级跳过」计数——与 WARNINGS **分列**。
# 理由：合法的窗口态降级（如 §27 待发版窗口白名单）计入 WARNINGS 会让 --strict
# 在发版窗口自锁（窗口态每次发版窗口必然出现，非「问题」）；分列后 --strict 只阻断
# 真问题，跳过项则由覆盖度行暴露、由发版 SOP「SKIP 数逐条裁决」步骤裁定。
SKIPS=0
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

# ── rhythm 段读取辅助（v1.4.8 第七章/第〇批）─────────────────────
# tools/check/dependency-direction.yml 的 rhythm 段 = 版本节奏 SSOT（sync/independent/detached）。
# 读 YAML 的依赖事实：js-yaml 经 @sofagent/audit 依赖链进入根 node_modules；本脚本直接
# require，缺依赖时报解析器缺失（环境缺 node_modules，非 YAML 配置问题）。
DD_YML="${PROJECT_ROOT}/tools/check/dependency-direction.yml"

# rhythm_dump → 逐行打印 CSV 风格行（制表符分隔）：
#   "SYNC<TAB>包名<TAB>包路径"   —— 严格同频包（§9b 据此生成校验清单）
#   "GLOB<TAB>段名<TAB>路径glob" —— independent / detached 段路径 glob（§9e 覆盖判定用）
# 包路径解析：优先取 packages 段的 path（load-chain → engine/hooks/sofagent-load-chain），
# 缺省回退 "engine/<包名>"（umbrella）。SSOT 缺失/解析失败时输出为空，由调用方 fail-loud。
# 解析器可用性一次性预检（顶层执行）：$(rhythm_dump) 内的 exit 只退出子 shell
# 杀不死主流程，会继续走到「段缺失」误导行——故在首次使用前于顶层探测，
# 命中哨兵即整脚本退出，只报「环境缺依赖」一行。
_YAML_PROBE_ERR=$(node -e '
  try { require("js-yaml"); }
  catch {
    try { require(require("path").join(process.argv[1], "node_modules/js-yaml")); }
    catch { process.stderr.write("SOFAGENT_YAML_PARSER_MISSING"); process.exit(3); }
  }
' "${PROJECT_ROOT}" 2>&1 1>/dev/null) || true
if [[ "${_YAML_PROBE_ERR}" == *SOFAGENT_YAML_PARSER_MISSING* ]]; then
  echo "✗ js-yaml 不可用——本脚本的 rhythm 段解析依赖根 node_modules/js-yaml，先在仓库根执行 npm install（环境缺依赖，非 YAML 配置问题）" >&2
  exit 1
fi

rhythm_dump() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    let yaml;
    try { yaml = require("js-yaml"); }
    catch { yaml = require(path.join(process.argv[1], "node_modules/js-yaml")); }
    const spec = yaml.load(fs.readFileSync(process.argv[2], "utf8")) || {};
    const rhythm = spec.rhythm || {};
    const pkgs = spec.packages || {};
    const asPath = (e) => (typeof e === "string" ? e : (e && e.path) || "");
    for (const entry of rhythm.sync || []) {
      // v1.5.2 章九二轮：sync 条目支持显式 { name, path } 形态（与下方 independent/detached 的
      //   asPath 用法同构）——供「随主线同版发布、但目录不在 engine/<name> 且未登记进 packages: 段」
      //   的包（如 engine/dsh-plugins/plugin-kit）声明精确路径，§9b/§9e/§12b 三个消费者无需改动。
      const name = typeof entry === "string" ? entry : (entry && entry.name) || "";
      const p = (entry && entry.path) || (pkgs[name] && pkgs[name].path) || "engine/" + name;
      console.log(["SYNC", name, p].join("\t"));
    }
    for (const seg of ["independent", "detached"]) {
      for (const entry of rhythm[seg] || []) {
        console.log(["GLOB", seg, asPath(entry)].join("\t"));
      }
    }
  ' "${PROJECT_ROOT}" "${DD_YML}" 2>/dev/null || true
}

# ── 2. 检查 .ts 文件 const VERSION = 'X.Y'（动态扫描，不硬编码文件列表）
echo -e "${BOLD}── [1/14] TypeScript 常量 ──${NC}"
# 包目录派生（v1.5.1 F7：**消除硬编码包清单**）。
#   旧实现是一张手写的 12 名清单（`for pkg in harness ontology … evolve`），实测与仓库**分叉**：
#     · `harness` 已是死条目——`@sofagent/harness` 早已更名 `@sofagent/inject`，`engine/harness/src`
#       不存在，循环内 `[[ -d … ]]` 把它**静默跳过**（既不报错也不计数）；
#     · `inject` 与 `rules` 目录真实存在却**漏列** ⇒ 静默漏扫；
#     · 净结果实为 11 项，而注释声称 12 项。
#   ⇒ 这正是「拿着一张过时/不全的清单扫」的空转形态：**清单项数必须 == 实测存在的项数**。
#   判据改为**结构性**（不再人工维护）：`engine/*/src` 存在即纳入。
#   SSOT 关系：与 package.json `workspaces` 里 13 个单段 `engine/<pkg>` 模块包**同值**
#     （`engine/umbrella` 是 npm 裸名总包、无 `src/` ⇒ 不计；`engine/hooks/…`、
#      `dsh-plugins/*`、`openclaw-plugins/*` 为多段 workspace 路径 ⇒ 不经本单层遍历）。
#   本清单同时供 [1/14]（.ts 常量）与 [2/14]（index.ts 版本引用）两节消费——一处派生、两处消费。
PKG_DIRS=()
for _pkg_dir in "${PROJECT_ROOT}"/engine/*/; do
  if [[ -d "${_pkg_dir}src" ]]; then PKG_DIRS+=("${_pkg_dir%/}"); fi
done
# 守卫不空转：派生结果为空 ⇒ 判定面塌了（路径错/源码树消失）⇒ 必须 FAIL，不得当「无漂移」放行
if [[ "${#PKG_DIRS[@]}" -eq 0 ]]; then
  echo -e "  ${RED}✗ 包目录派生为空（${PROJECT_ROOT}/engine/*/src 均不存在）——判定面塌了，拒绝假绿${NC}"
  ERRORS=$((ERRORS + 1))
fi
SCAN_DIRS=()
if [[ "${#PKG_DIRS[@]}" -gt 0 ]]; then
  for _pkg_dir in "${PKG_DIRS[@]}"; do SCAN_DIRS+=("${_pkg_dir}/src"); done
fi
while IFS= read -r ts; do
  [[ -f "${ts}" ]] || continue
  # 跳过归档目录（_archive 和 docs/archive）
  [[ "${ts}" == */_archive/* ]] && continue
  [[ "${ts}" == */docs/archive/* ]] && continue
  [[ "${ts}" == */FORGE/archive/* ]] && continue
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
  ${SCAN_DIRS[@]+"${SCAN_DIRS[@]}"} \
  2>/dev/null || true)
echo ""

# ── 3. 检查 index.ts vOLD 引用（子包遍历；v1.5.1 F7：与 [1/14] 共用同一份派生清单）──
echo -e "${BOLD}── [2/14] index.ts 版本引用 ──${NC}"
# 旧实现此处是第二张**独立硬编码**的同一份 12 名清单（与 §1 同死条目、同漏项）——两处各自
# 演化正是「同一职责两套实现」的又一实例。现改为消费 §1 派生的 `PKG_DIRS`（一处派生、
# 两处消费），两节覆盖面对齐，不再可能一多一少。
# 注：`${arr[@]+"${arr[@]}"}` 是 bash 3.2（macOS 自带）在 `set -u` 下展开空数组的唯一安全写法。
for _pkg_dir in ${PKG_DIRS[@]+"${PKG_DIRS[@]}"}; do
  INDEX_TS="${_pkg_dir}/src/index.ts"
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
SH_DIR="${PROJECT_ROOT}/engine/scripts"
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

# 检查 install.sh 注释头版本号
FDE_SH="${PROJECT_ROOT}/install.sh"
if [[ -f "${FDE_SH}" ]]; then
  header_ver=$(head -5 "${FDE_SH}" | grep -oE '· v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if [[ -n "${header_ver}" ]] && [[ "${header_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${FDE_SH}" "注释头 v${header_ver}" "v${SSOT_VERSION}"
  else
    report_ok "install.sh" "v${header_ver:-N/A}"
  fi
fi

# FORGE/loop-install.sh 已移除：loop 由 FORGE/SKILL/<loop>/ 定义驱动，无独立安装脚本（v1.2.x）

# 检查 FDE/package.json + FORGE/package.json version 字段
for pkg_file in "${PROJECT_ROOT}/FDE/package.json" "${PROJECT_ROOT}/FORGE/package.json"; do
  if [[ -f "${pkg_file}" ]]; then
    pkg_ver=$(grep -oE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' "${pkg_file}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [[ -n "${pkg_ver}" ]] && [[ "${pkg_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${pkg_file}" "version: ${pkg_ver}" "version: ${SSOT_VERSION}"
    else
      report_ok "$(basename "$(dirname "${pkg_file}")")/package.json" "${pkg_ver:-N/A}"
    fi
  fi
done

# 检查 install.sh 内部 VERSION= 变量（v1.2.0 新增 · P1-3 盲区修复）
INSTALL_SH="${PROJECT_ROOT}/install.sh"
if [[ -f "${INSTALL_SH}" ]]; then
  install_ver=$(grep '^VERSION="' "${INSTALL_SH}" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ -n "${install_ver}" ]] && [[ "${install_ver}" == "${SSOT_VERSION}" ]]; then
    report_ok "install.sh" "VERSION: v${install_ver}"
  elif [[ -n "${install_ver}" ]]; then
    report_error "${INSTALL_SH}" "VERSION=${install_ver}" "VERSION=${SSOT_VERSION}"
  else
    report_warn "install.sh" "未找到 VERSION= 变量定义"
  fi
fi
echo ""

# ── 5. 检查 .ps1 文件 $VERSION / $VERSION_STR = "X.Y" ──────────
echo -e "${BOLD}── [4/14] PowerShell 脚本 ──${NC}"
PS1_DIR="${PROJECT_ROOT}/engine/scripts/windows"
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
  -not -path '*/FORGE/archive/*' \
  -not -path '*/.sofagent/*' \
  -not -path '*/.workbuddy/*' \
  -not -path '*/engine/daemon/data/*' \
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
  # DSH plugin SKILL.md 走独立版本线（v1.4.0 起）：与同目录 package.json 比对而非 SSOT——
  # cordis-plugin-sofagent-* 是 0.x 独立发版（plugin 家族版本自治），不跟 sofagent 主版本走
  plugin_pkg="${skill%/SKILL.md}/package.json"
  if [[ -f "${plugin_pkg}" ]] && [[ "${skill}" == */dsh-plugins/* ]]; then
    plugin_ver=$(node -p "require('${plugin_pkg}').version" 2>/dev/null || echo "")
    if [[ -n "${plugin_ver}" && "${found_ver}" != "${plugin_ver}" ]]; then
      report_error "${skill}" "version: ${found_ver}" "version: ${plugin_ver}（同目录 package.json）"
    else
      report_ok "${skill#"${PROJECT_ROOT}"/}" "${found_ver}（plugin 线）"
    fi
    continue
  fi
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
  -not -path '*/.sofagent/*' \
  -not -path '*/.workbuddy/*' \
  -not -path '*/engine/daemon/data/*' \
  -not -path '*/vendor/*/upstream/*' \
  -type f)
# 🔴 `vendor/*/upstream/` 豁免（2026-09 复核查实）：该面是**上游原样 vendored**的第三方 skill
# （pin/哈希/本地偏差见同级 PROVENANCE.md），上游 SKILL.md 无 `version:` frontmatter 属其固有格式，
# 且不随本仓 SSOT 版本走——纳入判定只会产生每版固定误报（曾连续报 5 处「无 version 字段」）。
# 只豁免 upstream 子目录：vendor 下的本地适配层文件仍受检。
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

# ── 9b. 检查 rhythm.sync 段内子包 package.json version 与 SSOT 一致（v1.4.8：清单由 SSOT 驱动）──
# v1.4.8 第七章/第〇批：原**硬编码**包清单改为读 tools/check/dependency-direction.yml 的
#   rhythm.sync 段生成清单——「同频」由隐式（全同频）改为**显式声明**，本处不再持有任何包清单。
# 既有 bug 修正：原注释写「检查 12 个子包」，实际循环仅 11 项（原清单里的旧包名目录不存在
#   而被 `-d` 静默跳过，且漏列两个真实存在的包）——已随本批把该注释修正为真实值；
#   v1.5.1 F7 起 §1/§2 **不再持有包清单**，改为从 `engine/*/src` 结构派生（实测 13 项），
#   因此本节注释不再需要维护「循环项数」这个数字（它由文件系统决定，不可能再漂移）。
#   rhythm.sync 现为 16 包 = 原 11 包 + rules（原漏登记）+ umbrella（第 13 个 engine 包）
#   + engine/hooks/sofagent-load-chain（build 序列末位）+ train（第 7 批拆包）
#   + engine/dsh-plugins/plugin-kit（v1.5.2 章九二轮：DSH 适配层基座，只有 npm 一条通道、
#     随主线同版发布 ⇒ 归 sync；目录不在 engine/<name> 且未登记 packages: 段 ⇒ sync 条目显式给 path），
#   上述实测同为 SSOT 版本。
# 覆盖不变量（rhythm ⊇ workspace 27 项，含 engine/dsh-plugins/plugin-kit）由 §9e 断言；清单声明了却不存在的包在此 fail-loud。
echo -e "${BOLD}── [9/14] 子包版本号一致性 ──${NC}"
RHYTHM_SYNC_9B="$(rhythm_dump | awk -F'\t' '$1=="SYNC"{print $2"\t"$3}')"
if [[ -z "${RHYTHM_SYNC_9B}" ]]; then
  report_error "tools/check/dependency-direction.yml" "rhythm.sync 段缺失或解析失败" "非空 rhythm.sync 包清单"
else
  while IFS=$'\t' read -r sync_pkg sync_path; do
    [[ -z "${sync_pkg}" ]] && continue
    PKG_JSON="${PROJECT_ROOT}/${sync_path}/package.json"
    if [[ ! -f "${PKG_JSON}" ]]; then
      # v1.4.8：原实现对缺文件静默 continue（漏包不报）→ 改 fail-loud（SSOT 声明了却不存在 = 真错）
      report_error "${sync_path}/package.json" "文件缺失（rhythm.sync 已声明 ${sync_pkg}）" "version: ${SSOT_VERSION}"
      continue
    fi
    pkg_ver=$(grep -o '"version": "[^"]*"' "${PKG_JSON}" | head -1 | sed 's/"version": "//;s/"//')
    if [[ -z "${pkg_ver}" ]]; then
      continue
    fi
    if [[ "${pkg_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${sync_path}/package.json" "version: ${pkg_ver}" "version: ${SSOT_VERSION}"
    else
      report_ok "${sync_path}/package.json" "${pkg_ver}"
    fi
  done <<< "${RHYTHM_SYNC_9B}"
fi
echo ""

# ── 9c. 检查 OpenClaw plugin 家族 version 与 SSOT 一致（v1.4.1 补漏：sofagent-audit 漏 bump 教训）──
# openclaw-plugins/* 与主线同版发布（11-distribute.md 铁律「版本号与 sofagent 主线版本对齐」），
# 但 9b 的手写清单不含它们——曾经靠 bump 脚本逐文件替换，漏一个就静默漂移（1.4.1 发版实测）
# 双 manifest 都查：package.json + openclaw.plugin.json（ClawHub 发布校验两层版本必须一致——
# manifest 版本漂移会直接被 package publish 拒收，v1.4.1 发版实测 4/4 全拒）
OPENCLAW_PLUGIN_DIR="${PROJECT_ROOT}/engine/openclaw-plugins"
if [[ -d "${OPENCLAW_PLUGIN_DIR}" ]]; then
  for PKG_JSON in "${OPENCLAW_PLUGIN_DIR}"/*/package.json "${OPENCLAW_PLUGIN_DIR}"/*/openclaw.plugin.json; do
    [[ -f "${PKG_JSON}" ]] || continue
    pkg_ver=$(grep -o '"version": "[^"]*"' "${PKG_JSON}" | head -1 | sed 's/"version": "//;s/"//')
    [[ -z "${pkg_ver}" ]] && continue
    if [[ "${pkg_ver}" != "${SSOT_VERSION}" ]]; then
      report_error "${PKG_JSON#"${PROJECT_ROOT}"/}" "version: ${pkg_ver}" "version: ${SSOT_VERSION}"
    else
      report_ok "${PKG_JSON#"${PROJECT_ROOT}"/}" "${pkg_ver}"
    fi
  done
fi
echo ""

# ── 9d. 检查 MCP 工具 dataDir SSOT——禁止本地 getSofagentDataDir 定义（v1.4.2 · N-1 防复发，存量已清零转零容忍）──
# v1.4.2 N-1（P1）：11 个 fde/train 工具各带 `SOFAGENT_DATA || cwd/data` 本地兜底，与
# getDataDir SSOT（SOFAGENT_DATA > SOFAGENT_HOME/data）分叉——SOFAGENT_HOME 定制下同
# server 数据落点分裂。阶段三收编 11 处；同日用户拍板存量 19 处（tools/ 17 + resources.ts
# + think-generator.ts）一次清零——豁免清单删除，全域零容忍（engine/ 含 think 包）。
DD_HITS=$(grep -rln "getSofagentDataDir" "${PROJECT_ROOT}/engine/mcp/src/" "${PROJECT_ROOT}/engine/think/src/" 2>/dev/null || true)
if [[ -n "${DD_HITS}" ]]; then
  DD_NAMES=$(echo "${DD_HITS}" | xargs -n1 basename | tr '\n' ' ')
  report_error "engine/mcp+think" "本地 dataDir 函数残留:${DD_NAMES}" "import { getDataDir } from '@sofagent/core'（SSOT）"
else
  report_ok "engine dataDir SSOT" "零本地定义（mcp+think 全域清零，v1.4.2 收编 30 处）"
fi
echo ""

# ── 9e. rhythm 段覆盖全部 workspace 项（防漏登记 · v1.4.8 第七章/第〇批）──
# 不变量：rhythm.sync ∪ independent ∪ detached 必须覆盖**全部 workspace 项**（实为 27 项，含 engine/dsh-plugins/plugin-kit）。
# 枚举源：package.json 的 workspaces 字段——**不得**用 `ls -d engine/*/`
#   （那只得 19 个目录，漏 10 项：engine/hooks/sofagent-load-chain + 插件家族更深一层目录）。
# 命中规则：sync 段按「包路径精确相等」命中；independent / detached 段按「路径 glob」命中。
# 与 §9b（读 rhythm.sync 生成清单）、§12b（按 rhythm 分段过滤）同源，故并入本脚本一处审阅。
echo -e "${BOLD}── 检查 rhythm 段覆盖全部 workspace 项（防漏登记）──${NC}"
RHYTHM_DUMP_9E="$(rhythm_dump)"
WS_LIST_9E="$(node -e 'process.stdout.write(((require(process.argv[1]).workspaces) || []).join("\n"))' "${PROJECT_ROOT}/package.json" 2>/dev/null || true)"
SYNC_PATHS_9E="$(printf '%s\n' "${RHYTHM_DUMP_9E}" | awk -F'\t' '$1=="SYNC"{print $3}')"
GLOBS_9E="$(printf '%s\n' "${RHYTHM_DUMP_9E}" | awk -F'\t' '$1=="GLOB"{print $3}')"

if [[ -z "${RHYTHM_DUMP_9E}" ]]; then
  report_error "tools/check/dependency-direction.yml" "rhythm 段缺失或解析失败" "含 rhythm.sync / independent / detached 三段"
elif [[ -z "${WS_LIST_9E}" ]]; then
  report_error "package.json" "workspaces 为空或解析失败" "非空 workspaces 列表（枚举源）"
else
  RHYTHM_UNCOVERED=0
  RHYTHM_WS_TOTAL=0
  while IFS= read -r ws; do
    [[ -z "${ws}" ]] && continue
    RHYTHM_WS_TOTAL=$((RHYTHM_WS_TOTAL + 1))
    covered=false
    while IFS= read -r sp; do
      [[ -z "${sp}" ]] && continue
      if [[ "${ws}" == "${sp}" ]]; then covered=true; break; fi
    done <<< "${SYNC_PATHS_9E}"
    if [[ "${covered}" == "false" ]]; then
      while IFS= read -r glob; do
        [[ -z "${glob}" ]] && continue
        # shellcheck disable=SC2053  # 故意不给 RHS 加引号：这里要的正是 glob 匹配（如 engine/dsh-plugins/cordis-plugin-sofagent*）
        if [[ "${ws}" == ${glob} ]]; then covered=true; break; fi
      done <<< "${GLOBS_9E}"
    fi
    if [[ "${covered}" == "false" ]]; then
      report_error "${ws}" "未被 rhythm 任何段覆盖" "登记进 rhythm.sync / independent / detached"
      RHYTHM_UNCOVERED=$((RHYTHM_UNCOVERED + 1))
    fi
  done <<< "${WS_LIST_9E}"

  if [[ "${RHYTHM_UNCOVERED}" -eq 0 ]]; then
    RHYTHM_N_SYNC=$(printf '%s\n' "${SYNC_PATHS_9E}" | grep -c . || true)
    RHYTHM_N_GLOB=$(printf '%s\n' "${GLOBS_9E}" | grep -c . || true)
    report_ok "rhythm 覆盖率" "全部 ${RHYTHM_WS_TOTAL} 个 workspace 项已声明（sync ${RHYTHM_N_SYNC} 包 + independent/detached ${RHYTHM_N_GLOB} 条 glob）"
  else
    echo -e "    ${RED}rhythm 段漏登记 ${RHYTHM_UNCOVERED}/${RHYTHM_WS_TOTAL} 项 workspace——「不同频」必须先显式声明节奏归属${NC}"
  fi
fi
echo ""

# ── 10. 检查 engine/mcp 依赖 @sofagent/audit 版本（支持 ^ 范围） ─
MCP_PKG="${PROJECT_ROOT}/engine/mcp/package.json"
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

# ── 10b. 检查 engine/mcp 自身 version 字段与 SSOT 一致 ─
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
ROADMAP="${PROJECT_ROOT}/docs/ROADMAP.md"
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
  audit_lock_ver=$(grep -A3 '"engine/audit":' "${LOCK_FILE}" | grep '"version"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  mcp_lock_ver=$(grep -A3 '"engine/mcp":' "${LOCK_FILE}" | grep '"version"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
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
  [[ "${ts}" == */FORGE/archive/* ]] && continue
  [[ "${ts}" == *.test.ts ]] && continue
  [[ "${ts}" == */dist/* ]] && continue
  # 只检查文件头前 10 行的注释（与 tools/release/bump-version.sh [4/13] 对齐）
  # v1.3.7 修复：文件头 `//` 注释里的版本号是「功能溯源标记」（记录该文件/功能最后一次
  # 变更的版本），不是「当前版本锚点」——历史 check 把两者混为一谈，导致溯源标记
  # （如 `v1.1.9 新增`）被误判为「漏 bump」。判据改为「找到 = SSOT 的版本号即通过」：
  # 有当前版本锚点（如 `v1.3.7 交付④`）→ 校验通过；纯溯源老文件（如 `v1.1.9 新增`）→ 跳过。
  found_ver=$(head -10 "${ts}" | awk -v SSOT="${SSOT_VERSION}" '
    /^\/\// {
      s = $0
      while (match(s, /v[0-9]+\.[0-9]+\.[0-9]+/)) {
        ver = substr(s, RSTART+1, RLENGTH-1)
        if (ver == SSOT) { print ver; exit }
        s = substr(s, RSTART+RLENGTH)
      }
    }
  ')
  [[ -z "${found_ver}" ]] && continue
  if [[ "${found_ver}" != "${SSOT_VERSION}" ]]; then
    report_error "${ts}" "v${found_ver}" "v${SSOT_VERSION}"
    ts_header_errors=$((ts_header_errors + 1))
  fi
done < <(find "${PROJECT_ROOT}/engine" \
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

# ── 10d. 检查 git hook 文件头版本号（v1.2.7 F22: hook 版本签名同步）──
# v1.2.9 P0-2: 比对语义从「严格等于 SSOT」放宽为「不得早于 SSOT」。
# 原因：hook 模板的版本号承载的是「该 hook 行为的版本」——发版准备期
# 下一版（如 1.2.9）的 hook 行为改动会先于 SSOT 版本号提升（1.2.8 → 1.2.9
# 由 bump-version.sh 在发版时统一执行）落盘。hook 版本 < SSOT = 模板落后
# 于仓库代码（真问题）；hook 版本 >= SSOT = 模板与当前/下版代码同步（正常）。
echo -e "${BOLD}── Hook 文件头版本号 ──${NC}"
hook_version_errors=0
for hook_file in engine/audit/hooks/commit-msg engine/audit/hooks/post-commit; do
  if [[ -f "${hook_file}" ]]; then
    hook_ver=$(head -2 "${hook_file}" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/v//')
    if [[ -n "${hook_ver}" ]]; then
      # hook_ver < SSOT_VERSION 判定（sort -V 取最小值）
      oldest=$(printf '%s\n%s\n' "${hook_ver}" "${SSOT_VERSION}" | sort -V | head -1)
      if [[ "${oldest}" != "${SSOT_VERSION}" ]]; then
        report_error "${hook_file}" "v${hook_ver}" "v${SSOT_VERSION}（hook 版本不得早于 SSOT）"
        hook_version_errors=$((hook_version_errors + 1))
      fi
    fi
  fi
done
if [[ ${hook_version_errors} -eq 0 ]]; then
  echo -e "  ${GREEN}✓${NC} Hook 文件头版本号一致"
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

# v1.2.5: 英文版 "Current version: vX.Y" 检查（P1-4/L-1 根因：原脚本只查中文不查英文）
while IFS=: read -r file line_num rest; do
  found_ver=$(echo "$rest" | grep -oE 'Current version: v[0-9]+\.[0-9]+(\.[0-9]+)?' | sed 's/Current version: v//' | head -1)
  if [[ -z "$found_ver" ]]; then
    continue
  fi
  inline_checked=$((inline_checked + 1))
  if [[ "$found_ver" != "$SSOT_VERSION" ]]; then
    report_error "${file}:${line_num}" "Current version: v${found_ver}" "Current version: v${SSOT_VERSION}"
    inline_errors=$((inline_errors + 1))
  fi
done < <(grep -rn "Current version: v[0-9]" --include="*.md" . 2>/dev/null | grep -v node_modules | grep -v ".workbuddy/" | grep -v "docs/changelog/" || true)

# v1.2.5 阶段八① 补：dashboard.html 当前版本活引用（logo 徽章 + 页脚署名）。
# 只校验两处"当前版本"锚点；激活链里程碑标记（v1.2.5+ / ✅）属历史叙述，不校验。
dash_html="${PROJECT_ROOT}/tools/dashboard/dashboard.html"
if [[ -f "$dash_html" ]]; then
  for anchor in "logo-version\">v" "孔放勋 · v"; do
    found_ver=$(grep -F "$anchor" "$dash_html" | grep -oE "v[0-9]+\.[0-9]+(\.[0-9]+)?" | head -1 | sed 's/^v//')
    if [[ -z "$found_ver" ]]; then continue; fi
    inline_checked=$((inline_checked + 1))
    if [[ "$found_ver" != "$SSOT_VERSION" ]]; then
      report_error "dashboard.html" "v${found_ver}" "v${SSOT_VERSION}"
      inline_errors=$((inline_errors + 1))
    fi
  done
fi

if [[ $inline_errors -eq 0 ]]; then
  echo -e "  ${GREEN}✓${NC} ${inline_checked} 处中英文正文版本号引用全部一致"
fi
echo ""

# ── 12. 检查全局 npm 二进制版本与 SSOT 是否一致 ─
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
# v1.2.9 P0-4 修复三重 bug：
#   ① find 路径 $PROJECT_ROOT/sofagent 不存在（仓库根本身即 PROJECT_ROOT）→ 改扫 engine/
#   ② 原结构 `done < <(find ...) | while read` 管道使 while 在子 shell 执行，
#      INTERNAL_DEPS_OK=false 传不回父 shell → 改用命令替换收集输出后统一判定
#   ③ node stderr 被 2>/dev/null 吞掉 → 改 2>&1 保留报错信息
# v1.4.8 第七章/第〇批：按 rhythm 分段过滤——只有 rhythm.sync 段内的包参与**精确校验**；
#   independent（DSH/OpenClaw 插件家族）/ detached（FORGE，非 workspace）段豁免，
#   即「独立节奏 / 完全脱离」的声明同时解除其内部依赖的精确版本约束（各走各的发布通道）。
echo -e "${BOLD}── 检查子包内部依赖版本 ──${NC}"
INTERNAL_DEPS_OK=true

# rhythm SSOT → sync 段包路径集合（逐行一条；供 node 侧过滤）。
# ROOT 经环境变量传入，避免污染 node -e 的 argv（argv[1] 已用于传 package.json 路径）。
RHYTHM_SYNC_PATHS_12B="$(rhythm_dump | awk -F'\t' '$1=="SYNC"{print $3}')"
export SOFAGENT_RHYTHM_ROOT="${PROJECT_ROOT}"
export SOFAGENT_RHYTHM_SYNC="${RHYTHM_SYNC_PATHS_12B}"
echo -e "  ${CYAN}·${NC} 精确校验范围：rhythm.sync 段 $(printf '%s\n' "${RHYTHM_SYNC_PATHS_12B}" | grep -c . || true) 包（independent / detached 段豁免）"

# 收集 sync 段内各 workspace package.json 中的版本不一致（含 node stderr，不再吞）
MISMATCHES=$(while IFS= read -r -d '' pkg_json; do
  node -e "
    const fs = require('fs');
    const path = require('path');
    // v1.4.8：非 rhythm.sync 段（independent / detached）跳过精确校验
    const rel = path.relative(process.env.SOFAGENT_RHYTHM_ROOT, path.dirname(process.argv[1])).split(path.sep).join('/');
    const syncPaths = (process.env.SOFAGENT_RHYTHM_SYNC || '').split('\n').filter(Boolean);
    if (!syncPaths.includes(rel)) { process.exit(0); }
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
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
  " "$pkg_json" 2>&1
done < <(find "$PROJECT_ROOT/engine" -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" -print0 2>/dev/null))

# 补查根 package.json（内部依赖也应与 SSOT 对齐）
ROOT_MISMATCH=$(node -e "
    const pkg = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf-8'));
    for (const field of ['dependencies', 'devDependencies']) {
      if (pkg[field]) {
        for (const [name, ver] of Object.entries(pkg[field])) {
          if (name.startsWith('@sofagent/')) {
            const verClean = ver.replace(/^[~^>=<]+/, '');
            if (verClean !== '$SSOT_VERSION') {
              console.log('MISMATCH root → ' + name + ': ' + ver + ' (期望: ' + '$SSOT_VERSION' + ')');
            }
          }
        }
      }
    }
  " "$PROJECT_ROOT/package.json" 2>&1)

ALL_MISMATCH="${MISMATCHES}
${ROOT_MISMATCH}"
# 逐行判定：MISMATCH* / 含 Error: → 红色错误；其余非空输出（node 警告噪音）→ 黄色提示
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in
    MISMATCH*)
      echo -e "  ${RED}✗${NC} $line"
      INTERNAL_DEPS_OK=false
      ERRORS=$((ERRORS + 1))
      ;;
    *Error:*)
      echo -e "  ${RED}✗${NC} $line"
      INTERNAL_DEPS_OK=false
      ERRORS=$((ERRORS + 1))
      ;;
    *)
      echo -e "  ${YELLOW}⚠${NC} $line"
      ;;
  esac
done <<< "$ALL_MISMATCH"
if $INTERNAL_DEPS_OK; then
  echo -e "  ${GREEN}✓${NC} 所有内部 @sofagent/* 依赖版本一致"
fi
CHECKS=$((CHECKS + 1))
echo ""

# ── 文案数字漂移扫描（v1.1.6 新增 · 维度八·任务5 强化）──────────
# 扫描 audit 源码中疑似硬编码的「N 条规则」类声称，与 SSOT 对账
# SSOT: defaultRules.length（当前 17）/ 注册总数（25）
# 防止 init.ts 输出文案、fix-suggestions.ts/qa-boundary-verify.test.ts 注释等小数字无人对账
echo "=== 13. 文案数字漂移扫描（audit 源码硬编码规则条数）==="
DOC_DRIFT_OK=true
# SSOT 源文件前置存在性断言：文件丢失时 awk/grep 双静默归零，对账逻辑整体失明
# （|| echo 0 家族地雷：检查器宁可报「SSOT 丢失」也绝不假绿/假红继续跑）
if [ ! -f engine/audit/src/rules/index.ts ]; then
  echo "  ❌ SSOT 源文件丢失：engine/audit/src/rules/index.ts —— 文案数字对账无法进行"
  ERRORS=$((ERRORS + 1))
  DOC_DRIFT_OK=false
fi
# 计数兜底用 || true 而非 || echo 0：grep -c 零匹配时已自行输出单行 0，
# || echo 0 会追加第二行（双零），后续整数比较静默失效
DEFAULT_RULES_COUNT=$(awk '/export const defaultRules/{f=1; next} f && /^[[:space:]]*\{.*name:/{c++} f && /^[[:space:]]*\];/{exit} END{print c+0}' engine/audit/src/rules/index.ts 2>/dev/null || true)
TOTAL_RULES_COUNT=$(grep -cE "^[[:space:]]+\{ name: '(A|E)[0-9]+" engine/audit/src/rules/index.ts 2>/dev/null || true)
DEFAULT_RULES_COUNT=${DEFAULT_RULES_COUNT:-0}
TOTAL_RULES_COUNT=${TOTAL_RULES_COUNT:-0}
echo "  SSOT: defaultRules.length=$DEFAULT_RULES_COUNT 注册总数=$TOTAL_RULES_COUNT"
while IFS= read -r line; do
  num=$(echo "$line" | grep -oE "[0-9]+ 条" | grep -oE "^[0-9]+" | head -1)
  if [ -n "$num" ] && [ "$num" != "$DEFAULT_RULES_COUNT" ] && [ "$num" != "$TOTAL_RULES_COUNT" ]; then
    echo "  ❌ $line （与 SSOT $DEFAULT_RULES_COUNT/$TOTAL_RULES_COUNT 不符）"
    DOC_DRIFT_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done < <(grep -rnE "[0-9]+ 条规则|[0-9]+ 条默认的|[0-9]+ 条各自的" engine/audit/src 2>/dev/null | grep -v "import" | grep -v "defaultRules.length" | grep -v "\.test\.")
if $DOC_DRIFT_OK; then
  echo "  [OK] audit 源码无规则条数漂移"
fi
echo ""

# ── 对外面规则计数漂移扫描（v1.2.6 新增 · v1.5.3 D3 补漏批补强形态）──────────────
# 维度 13 只扫描 engine/audit/src 中的「N 条规则」文案，不覆盖对外面文档 / 发布描述。
# 本维度补上「文档 SSOT + npm 发布描述」的计数对账。
# 🔴 v1.5.3 D3 补漏批：原 pattern `[0-9]+ (rules|条规则)` 只抓「N 条规则」「N rules」，
#   实测三种同族写法**全部逃逸**——README.en 的「the full N」/「N-rule metadata」、
#   WIKI 与 umbrella package.json 的「N git-diff rules」。本批把 pattern 扩到覆盖这三形态。
#   失效模式复核（补漏批全仓实跑）：`N-rule`/`N git-diff`/`N audit rule` 三形态自带 rule
#   语义、无假红反例；「the full N」在本扫描面（WIKI/README/umbrella）恒指规则数，无假红命中。
echo "=== 13b. 对外面规则计数漂移扫描（WIKI/README/umbrella）==="
TABLE_DRIFT_OK=true
# 扫描面：文档 SSOT（WIKI + README 双语）+ npm 发布描述（`engine/umbrella/package.json`
#   ——对外面，npm 上用户可见的 description）；与 SSOT（TOTAL_RULES_COUNT / NPM_PKG_COUNT）对账。
# 待对账的计数形态（单一事实源 `RULE_COUNT_RE`，extraction 与 scan 共用）：
#   「N 条规则」「N rules」「N audit rule」「N-rule」「N git-diff rules」「the full **N**」
RULE_COUNT_RE="[0-9]+ (rules|条规则)|[0-9]+ audit rule|[0-9]+-rule|[0-9]+ git-diff|the full [*]{0,2}[0-9]+"
WIKI_DRIFT_FILES="docs/WIKI.md README.md README.en.md engine/umbrella/package.json"
while IFS= read -r line; do
  # 提取行内首个命中形态的数值（「the full **N**」数值在形态尾部，故不锚行首）
  num_rules=$(echo "$line" | grep -oE "$RULE_COUNT_RE" | grep -oE "[0-9]+" | head -1)
  if [ -n "$num_rules" ] && [ "$num_rules" != "$TOTAL_RULES_COUNT" ]; then
    echo "  ❌ ${line} （规则数 ${num_rules} ≠ SSOT ${TOTAL_RULES_COUNT}）"
    TABLE_DRIFT_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done < <(grep -rnE "$RULE_COUNT_RE" $WIKI_DRIFT_FILES 2>/dev/null | grep -v "node_modules" | grep -v "changelog")
# 检查「N 个发布到 npm」——SSOT 从 package.json workspaces 动态提取
NPM_PKG_COUNT=$(node -e "const p=require('./package.json'); console.log(p.workspaces.length)" 2>/dev/null || echo 13)
while IFS= read -r line; do
  num_npm=$(echo "$line" | grep -oE "[0-9]+ 个发布到 npm" | grep -oE "^[0-9]+" | head -1)
  if [ -n "$num_npm" ] && [ "$num_npm" != "$NPM_PKG_COUNT" ]; then
    echo "  ❌ ${line} （npm 包数 ${num_npm} ≠ SSOT ${NPM_PKG_COUNT}）"
    TABLE_DRIFT_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done < <(grep -rnE "[0-9]+ 个发布到 npm" $WIKI_DRIFT_FILES 2>/dev/null)
if $TABLE_DRIFT_OK; then
  echo "  [OK] WIKI/README 表格数字无漂移"
fi
echo ""

# ── 文档头日期一致性扫描（v1.1.7 新增 · 修复一）──────────────
# 所有 `> vX.Y · YYYY-MM-DD` 文档头日期应与发版日期一致。
# bump-version.sh 只改版本号不改日期，反复出现文档头日期漂移；
# 本扫描以发版日期为唯一基准，任何不一致都报错。
#
# v1.3.3 复核修复：EXPECTED_DOC_DATE 改为从 CHANGELOG 当前版本段动态提取，
# 不再硬编码——发版时无需手改脚本。提取逻辑：audit/package.json 的 version
# → CHANGELOG 里 `vX.Y.Z — ... · YYYY-MM-DD ·` 的日期。兜底：提取不到时
# 退回 LAST_KNOWN_DATE 并告警（避免开发中 CHANGELOG 还没更新时误报）。
echo "=== 14. 文档头日期一致性扫描（> vX.Y · YYYY-MM-DD）==="
DOC_DATE_OK=true
# 动态提取：从 CHANGELOG 当前版本段读发版日期（SSOT）
CUR_VER=$(node -p "require('${PROJECT_ROOT}/engine/audit/package.json').version" 2>/dev/null || echo "")
EXPECTED_DOC_DATE=""
if [ -n "$CUR_VER" ]; then
  # tail -1：一段式索引行可能含多个日期（如「待发版 · DDDD-DD-DD 开发完成 … · DDDD-DD-DD ·」），
  # 发版日期位固定在行尾——取最后一个
  EXPECTED_DOC_DATE=$(grep -m1 "v${CUR_VER}.*—" "${PROJECT_ROOT}/CHANGELOG.md" 2>/dev/null | grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" | tail -1 || echo "")
fi
# 兜底：CHANGELOG 还没当前版本段（开发中）时退回最后已知日期
# v1.3.6 开发中：文档头统一沿用上一版发版日期 2026-08-16，发版时随 CHANGELOG 段更新
LAST_KNOWN_DATE="2026-08-16"
if [ -z "$EXPECTED_DOC_DATE" ]; then
  # 🔴 v1.4.8 实锤：CHANGELOG 的当前版本索引行若**没写发版日期**，这里会静默退回一个硬编码旧值，
  # 于是**全部文档头**报「日期 ≠ 发版日期」——真因（索引行缺日期）被淹没成一堆下游噪声。
  # 故按「已发版 / 开发中」分流：
  #   已发版（存在 git tag v$CUR_VER）⇒ 索引行**必须有**日期，缺 = 真错，报 ❌ 并指名修法；
  #   开发中（无 tag）⇒ 退回上一版日期合理，但仍给出醒目提示与修法指引。
  if git -C "${PROJECT_ROOT}" rev-parse -q --verify "refs/tags/v${CUR_VER}" >/dev/null 2>&1; then
    echo "  ❌ CHANGELOG 的 v${CUR_VER} 索引行缺发版日期（该版本已有 tag v${CUR_VER} = 已发版）——"
    echo "     行尾须为「… · YYYY-MM-DD 已发版 · [开发日志](…)」；否则文档头日期校验会拿旧值兜底造成全量误报"
    DOC_DATE_OK=false
    ERRORS=$((ERRORS + 1))
  else
    echo "  ⚠ CHANGELOG 未找到 v${CUR_VER} 发版日期（该版本尚无 tag = 开发中），退回 LAST_KNOWN_DATE=${LAST_KNOWN_DATE}"
    echo "     → 发版时请在索引行尾补「· YYYY-MM-DD 已发版」，本项即转为硬校验"
  fi
  EXPECTED_DOC_DATE="$LAST_KNOWN_DATE"
fi
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
  -not -path '*/FORGE/archive/*' \
  -not -path '*/_archive/*' \
  -not -path '*/.sofagent/*' \
  -not -path '*/.workbuddy/*' \
  -not -path '*/engine/daemon/data/*' \
  -type f)
if $DOC_DATE_OK; then
  echo -e "  ${GREEN}✓${NC} 文档头日期一致（发版日期 ${EXPECTED_DOC_DATE}）"
  CHECKS=$((CHECKS + 1))
else
  echo -e "  ${RED}✗${NC} 存在文档头日期漂移（应统一为发版日期 ${EXPECTED_DOC_DATE}）"
fi
echo ""

# ── 14b. 非顶版发版日期 vs git tag（v1.4.9 P2-1 回归锁）──
# 背景（P2-1 根因）：CHANGELOG 的 v1.4.7 索引行原写「2026-09-11 已发版」，v1.4.8 发版
#   同步批的「日期同步」步骤把它**误改成 2026-09-13**（按「最新发版日」批量替换误伤上一版行，
#   考古实证：`git show 1410794c` 的 diff）。§14 只认当前版本的文档头日期，看不到**非顶版行**，
#   于是错日期随发版出门（WIKI 版本表仍写 v1.4.7 = 2026-09-11，两处互不一致）。
# 判据：CHANGELOG 里每个「· YYYY-MM-DD 已发版」行，若该版本**存在 git tag**，其日期必须
#   == 该 tag 的 creatordate（tag 是发版真值）。无 tag 的历史行不判（口径：tag 缺失即无真值可比）。
# 守卫不空转：可判行数 == 0 ⇒ FAIL（说明判据正则失效或 CHANGELOG 结构变了，而不是「全过」）。
TAG_DATE_OK=true
TAG_DATE_CHECKED=0
while IFS= read -r _cl_line; do
  _cl_ver=$(printf '%s' "$_cl_line" | grep -oE '^- \*\*v[0-9]+\.[0-9]+\.[0-9]+\*\*' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  _cl_date=$(printf '%s' "$_cl_line" | grep -oE '· [0-9]{4}-[0-9]{2}-[0-9]{2} 已发版' | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
  [ -z "$_cl_ver" ] || [ -z "$_cl_date" ] && continue
  # 🔴 固定发版时区提取（CI 时区脆弱性实锤 ×2）：%(creatordate:short) 按运行环境 TZ 渲染，
  #   且 TZ=Asia/Shanghai 前缀对 git 的 ref 过滤器在 CI（浅克隆+特定 git 版本）仍不可靠。
  #   治本：取 %(creatordate:unix) 原始时间戳（TZ 无关）再显式转上海日期。
  #   跨平台坑（×3 实锤）：BSD date 用 `-r <ts>`、GNU date 用 `-d @<ts>`——CI 是 Linux（GNU）、
  #   本仓开发机是 macOS（BSD），两条都试，谁成功用谁。
  # 🔴 固定发版时区提取（CI 时区脆弱性实锤 ×4 收官）：TZ 环境变量形态在 CI runner
  #   不可靠（TZ=Asia/Shanghai 前缀对 git ref 过滤器无效 ×1、GNU date -r 语义是
  #   --reference 文件 ×2、TZ 生效性依赖 runner tzdata/shell 传递 ×3——三层全部踩过）。
  #   治本：彻底摆脱 date/TZ——取 %(creatordate:unix) 原始时间戳，用纯 shell 算术
  #   加 8 小时（28800 秒 = UTC+8 固定偏移，中国无夏令时）后取 UTC 日期前 10 字符。
  #   零外部命令语义分歧、零 TZ 依赖、BSD/GNU 全同值。
  _tag_ts=$(git -C "${PROJECT_ROOT}" for-each-ref --format='%(creatordate:unix)' "refs/tags/v${_cl_ver}" 2>/dev/null | head -1)
  _tag_date=""
  if [ -n "${_tag_ts}" ] && command -v date >/dev/null 2>&1; then
    _tag_date=$(TZ='UTC-8' date -u -r $(( _tag_ts + 28800 )) '+%Y-%m-%d' 2>/dev/null \
      || TZ='UTC-8' date -u -d "@$(( _tag_ts + 28800 ))" '+%Y-%m-%d' 2>/dev/null \
      || true)
  fi
  if [ -z "${_tag_date}" ]; then
    _tag_date=$(TZ='Asia/Shanghai' git -C "${PROJECT_ROOT}" for-each-ref --format='%(creatordate:short)' "refs/tags/v${_cl_ver}" 2>/dev/null | head -1)
  fi
  [ -z "$_tag_date" ] && continue
  TAG_DATE_CHECKED=$((TAG_DATE_CHECKED + 1))
  # 🔴 ±1 天容差（CI 时区收尾）：tag 日期在本地（annotated tag object 时间，上海时区）
  #   与 CI（fetch 语义差异下可能落到 commit 时间戳 / UTC 渲染）可差一日——这是
  #   时区/对象层的边界差，不是 P2-1 要抓的「日期被后续发版批改坏」（那会差出
  #   完全不同的日子）。
  #   🔴 fail-closed 纪律：任一侧日期无法转 unix 时**不得回退成 0 参与比较**
  #   （那会让 gap 恒 0 = 容差吞掉一切漂移，正是负向探针抓出的 fail-open）——
  #   转换失败即回退**字符串全等比较**（严于容差，保全检测力）。
  _cl_ts=$(date -j -f "%Y-%m-%d" "$_cl_date" "+%s" 2>/dev/null || date -d "$_cl_date" "+%s" 2>/dev/null || echo "")
  _tag_ts2=$(date -j -f "%Y-%m-%d" "$_tag_date" "+%s" 2>/dev/null || date -d "$_tag_date" "+%s" 2>/dev/null || echo "")
  _date_mismatch=false
  if [ -n "$_cl_ts" ] && [ -n "$_tag_ts2" ]; then
    _cl_day_gap=$(( _cl_ts - _tag_ts2 ))
    [ "$_cl_day_gap" -lt 0 ] && _cl_day_gap=$(( 0 - _cl_day_gap ))
    [ "$_cl_day_gap" -gt 86400 ] && _date_mismatch=true
  else
    # 转换不可用 → 字符串严格比较（不放宽）
    [ "$_cl_date" != "$_tag_date" ] && _date_mismatch=true
  fi
  if $_date_mismatch; then
    echo -e "  ${RED}✗${NC} CHANGELOG v${_cl_ver} 索引行日期 ${_cl_date} ≠ tag v${_cl_ver} 日期 ${_tag_date}"
    echo -e "     发版真值 = tag；非顶版行的「已发版」日期不得随后续发版批变动（P2-1 复发防御）"
    TAG_DATE_OK=false
    ERRORS=$((ERRORS + 1))
  fi
done < "${PROJECT_ROOT}/CHANGELOG.md"
if [ "$TAG_DATE_CHECKED" -eq 0 ]; then
  echo -e "  ${RED}✗${NC} 非顶版发版日期 vs tag：可判行数为 0（判据未命中任何行）——守卫空转，判 FAIL"
  ERRORS=$((ERRORS + 1))
elif $TAG_DATE_OK; then
  echo -e "  ${GREEN}✓${NC} 非顶版发版日期与 tag 一致（可判 ${TAG_DATE_CHECKED} 行）"
  CHECKS=$((CHECKS + 1))
fi
echo ""

# ── F-08: ROADMAP 版本头描述 vs CHANGELOG 标题一致性（v1.4.9 P1-7 起 FAIL 级）──
echo "=== 15. ROADMAP 版本头描述 vs CHANGELOG 标题一致性 ==="
# v1.5.1 J1：取值方式由「硬编码第 4 行」改为**按内容定位**。
#   缺陷（实测）：ROADMAP 头部随版本迭加行（现为 L1 标题 / L3 图 / L5 引言 / L6 状态行
#   / L7 描述行），`sed -n '4p'` 恒读到空行 ⇒ 恒走 else 分支 ⇒ **只打印 ⚠，既不
#   ERRORS++ 也不 SKIPS++**（三数皆不动，在门禁汇总里表现为「这条检查不存在」）——
#   一个 P1-7 起就自陈「由 WARN 升为 FAIL」的守卫长期空转。
#   定位口径：「ROADMAP 版本头」= 头部引用块里**全部** `^> v<版本>` 行（现为 L6 状态行 +
#   L7 描述行两行；历史格式为单行 `> vX.Y.Z · <版本名> · …`，版本名在与 CHANGELOG 标题
#   可对账的独立 `·` 分段里）。原硬编码的 `4p` 命中的就是「版本名那一行」；现头部已增至
#   7 行且版本名落在 L7，故必须按内容定位、不认行号。
# v1.5.1 J1 二次修正（守卫不得空转，第二形态 = 「拿着一张不全的清单扫」）：
#   首版改法取**首条** `^> v` 行 → 命中 L6（状态行 `> vX.Y.Z · 日期 · 状态 · 作者`，**无版本名**）；
#   且原过滤器「段内含日期 或 含 →」判据过激，会把 `——治理模块`、`可见性与本体成熟：MCP 104→105 tools`
#   两个真版本名分段一起整段丢弃 ⇒ 关键词只剩 [✅ 已发版, 孔放勋] ⇒ 与 CHANGELOG 标题零重合 ⇒ 恒红。
#   现口径：**取全部 `^> v` 行的并集**，并**逐段剥掉非版本名结构**（版本号 / 日期 / 状态标注 /
#   整对括号 / `。` 后的自指句 / `：` 之后的描述后缀）——「剥前缀而非丢段」；仅丢弃**仍含 `→` 的
#   纯统计段**（`MCP 104→105`、`测试 …→…`、`acceptance …→…` 不是版本名，剥不掉只能丢）。
ROADMAP_HEADER=$(grep -E '^> v[0-9]' "${ROADMAP}" 2>/dev/null | tr '\n' ' ' || true)
if [[ -n "${ROADMAP_HEADER}" ]]; then
  # 提取 ROADMAP 版本头中的关键词（· 与 + 均为分隔段——v1.2.5 头部用 + 连接多个交付项）
  ROADMAP_KEYWORDS=$(grep -E '^> v[0-9]' "${ROADMAP}" 2>/dev/null \
    | sed -E 's/^>[[:space:]]*//; s/^[vV][0-9]+(\.[0-9]+)*[[:space:]]*//' \
    | sed -E 's/[（(][^（）()]*[）)]/ /g' \
    | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}//g' \
    | sed -E 's/(✅|⏳|📋|🚧|🔜)[[:space:]]*//g' \
    | sed -E 's/(已发版|已发布|已交付|待发版|待发布|规划中|排期中)[[:space:]]*·[^·+]*//g' \
    | sed -E 's/(已发版|已发布|已交付|待发版|待发布|规划中|排期中)//g' \
    | sed -E 's/。.*$//' \
    | sed 's/[·+]/\n/g' \
    | sed -E 's/^[[:space:]—–-]+//; s/[[:space:]]+$//' \
    | sed -E 's/：.*$//' \
    | grep -vE '→' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | grep -vE '^$' | head -8 || true)
  # 提取 CHANGELOG 当前版本标题
  # v1.2.5 起 CHANGELOG.md 改为纯目录索引格式（- **vX.Y.Z** — 摘要），旧格式 ### [vX.Y.Z] 已废弃
  CHANGELOG_TITLE=$(grep -m1 -E "^(- \*\*|### \[)v" "${PROJECT_ROOT}/CHANGELOG.md" 2>/dev/null || echo "")
  # 🔴 待发版窗口感知（与 §24-27 同口径）：CHANGELOG 顶版超前 SSOT 一版（minor/patch 后继）
  # 时处于「CHANGELOG 已收录新版、ROADMAP 版本头仍指 SSOT 旧版」的合法中间态——ROADMAP
  # 五步同步挂账 bump 后同批执行（06-doc-finalize 时序定谳），窗口内本项对「顶版 ≠ SSOT」
  # 降级跳过；仅顶版 = SSOT（发版后常态）才真比对。防窗口态假红（§15 先前无窗口感知，
  # CHANGELOG 一收录即撞「版本名疑似错版」）。
  _top_ver=$(echo "${CHANGELOG_TITLE}" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
  _s15_window_skip=false
  if [[ -n "${_top_ver}" && "${_top_ver}" != "v${SSOT_VERSION}" ]]; then
    echo -e "  ${YELLOW}⏭️${NC} 待发版窗口态：CHANGELOG 顶版 ${_top_ver} ≠ SSOT v${SSOT_VERSION}——ROADMAP 版本头随 bump 后五步同步，本项跳过（§24-27 同口径）"
    SKIPS=$((SKIPS + 1))
    CHECKS=$((CHECKS + 1))
    _s15_window_skip=true
  fi
  if ${_s15_window_skip}; then
    : # 窗口态整段跳过比对（清空标题后空串仍会走循环假红，故显式短路）
  elif [[ -z "${CHANGELOG_TITLE}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} CHANGELOG 顶版标题提取失败"
    WARNINGS=$((WARNINGS + 1))
  else
  ROADMAP_WARN=true
  while IFS= read -r kw; do
    [[ -z "${kw}" ]] && continue
    # 跳过太短的关键词（≤2 字符）
    [[ ${#kw} -lt 3 ]] && continue
    if grep -qF "${kw}" <<< "${CHANGELOG_TITLE}"; then
      ROADMAP_WARN=false
      break
    fi
  done <<< "${ROADMAP_KEYWORDS}"
  # v1.5.1 J1：此处原有「更宽松匹配」兜底——`for kw in "产品叙事" "USB" "A/B" "控制图" "BugFix"`，
  #   只要该词同时出现在 ROADMAP 头部与 CHANGELOG 标题即判通过。它是**硬编码豁免白名单**：
  #   一旦 ROADMAP 头部错版（比如挂着上一版名字「商业平台接口版」）而正文里恰好含 `控制图`、
  #   CHANGELOG 当前标题也含 `控制图`，就会**用正文偶然词把错版判成通过** = 假绿。
  #   实测该表在当前仓两边命中数均为 0（纯死代码，只贡献假绿面）。取值口径已修好，兜底无存在必要 ⇒ 删除。
  if ${ROADMAP_WARN}; then
    # v1.4.9 P1-7：由 WARN 升为 FAIL。本条早已能精确抓到 ROADMAP 版本头错版
    # （v1.4.8 头部长期挂着 v1.4.7 的版本名「商业平台接口版」），却只计 WARNING、
    # 非 --strict 即放行 ⇒ 已知告警随发版出门。ROADMAP L4 是用户第一眼看到的能力叙事，
    # 错版 = 把上一版的名字贴在本版头上 = 事实性错误（不是风格问题）→ 阻断。
    echo -e "  ${RED}❌ ROADMAP 版本头描述与 CHANGELOG 标题关键词重合度低（版本名疑似错版）${NC}"
    echo -e "    ${RED}ROADMAP:  ${ROADMAP_HEADER:0:80}...${NC}"
    echo -e "    ${RED}CHANGELOG: ${CHANGELOG_TITLE:0:80}${NC}"
    echo -e "    修法：把 docs/ROADMAP.md 版本头描述行的版本名改成与 CHANGELOG 当前版本标题一致（勿沿用上一版名字）"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} ROADMAP 版本头描述与 CHANGELOG 标题关键词重合"
    CHECKS=$((CHECKS + 1))
  fi
  fi # _s15_window_skip / 标题提取失败 / 正常比对 三分支收口
else
  # v1.5.1 J1：取值失败 ⇒ fail-loud（对齐同脚本 §14b「守卫不空转：可判行数 == 0 ⇒ FAIL」）。
  # 旧实现只打印 ⚠（不计 ERRORS / SKIPS / CHECKS）⇒ 守卫空转且汇总里不可见。
  echo -e "  ${RED}✗ 无法从 ${ROADMAP} 按内容定位版本头描述行（无 '^> v<版本>' 行）——取值失败，判 FAIL（拒绝静默）${NC}"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# ── v1.2.8 P1-11: WIKI 状态表版本号扫描 ──────────────────────
echo "=== 16. WIKI 状态表版本号扫描 ==="
WIKI_FILE="${PROJECT_ROOT}/docs/WIKI.md"
if [[ -f "${WIKI_FILE}" ]]; then
  WIKI_DRIFT_OK=true
  # v1.5.0：待发版语义行的跳过计数——下述排除不是静默跳过，行数在段尾显式打印
  WIKI_PENDING_SKIPPED=0
  # 扫描 WIKI.md 中所有 vX.Y.Z 格式版本号（排除历史叙述和 CHANGELOG 引用）
  while IFS=: read -r line_num line_content; do
    found_vers=$(echo "$line_content" | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
    [[ -z "$found_vers" ]] && continue
    found_ver=$(echo "$found_vers" | sed 's/^v//')
    # 跳过旧版本历史叙述（如"v1.2.5 引入了..."）
    # v1.5.0：先排除「待发版 / 排期中 / 下一版」语义行——这些行里的版本号是待发版号，
    #   天然不等于当前 SSOT，要求它相等是假阳性（实案：「能力全景」节的说明句
    #   「状态：✅ 已交付 · 🚀 待发版（v1.5.0） · 📋 排期中」被"状态"关键字抓成状态表行，
    #   使本节长期报 1 处不一致）。
    #   这是「排除」而非「收窄关键字」：真正声称当前版本的行——表格行
    #   「| 当前版本 | **v1.4.9**」与散文行「当前 v1.4.9」——都仍受检，检测力不损失。
    if grep -qE '待发版|排期中|下一版' <<< "$line_content"; then
      WIKI_PENDING_SKIPPED=$((WIKI_PENDING_SKIPPED + 1))
      continue
    fi
    # 只检查状态表行（含"当前"或含"状态"或含"版本"关键字的行）
    if grep -qE '当前|状态|版本' <<< "$line_content"; then
      # v1.3.8 P1-C：完整三段比较（此前只比前两段——v1.3.7 vs v1.3.8 同为 1.3，
      # 补丁号漂移漏检；SSOT 是三段全格式，直接全量比对）
      if [[ "$found_ver" != "$SSOT_VERSION" ]]; then
        echo "  ❌ WIKI.md:${line_num} 版本 ${found_ver} ≠ SSOT ${SSOT_VERSION}"
        WIKI_DRIFT_OK=false
        ERRORS=$((ERRORS + 1))
      fi
    fi
  done < <(grep -nE 'v[0-9]+\.[0-9]+' "${WIKI_FILE}" 2>/dev/null | grep -v 'changelog' || true)
  if $WIKI_DRIFT_OK; then
    echo -e "  ${GREEN}✓${NC} WIKI.md 状态表版本号一致"
    CHECKS=$((CHECKS + 1))
  fi
  # 跳过数显式打印——排除规则不允许静默生效（假门禁形态：锚串消失后静默跳过）
  if [[ "${WIKI_PENDING_SKIPPED}" -gt 0 ]]; then
    echo -e "  ${GREEN}✓${NC} WIKI.md 跳过 ${WIKI_PENDING_SKIPPED} 行待发版语义（版本号为待发版号，不比对当前 SSOT）"
  fi
  # v1.4.9 P1-7：「下一版 == 当前版本」是硬性自相矛盾（同一版既「当前」又「下一版」）。
  # 上面 §16 的漂移扫描只认含「当前|状态|版本」的行 ⇒ 「下一版」行天然漏检
  # （v1.4.8 状态表「当前版本 v1.4.8 / 下一版 v1.4.8」两侧同号长期并存正是此盲区）。
  # 故单列一条断言：WIKI「下一版」值必须 ≠ SSOT 当前版本。
  WIKI_NEXT_VER=$(grep -E '^\| *下一版 *\|' "${WIKI_FILE}" 2>/dev/null | head -1 | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 | sed 's/^v//')
  if [[ -z "${WIKI_NEXT_VER}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} WIKI.md 未找到状态表「下一版」行（表结构变更？请核对 docs/WIKI.md「六、当前状态」）"
    WARNINGS=$((WARNINGS + 1))
  elif [[ "${WIKI_NEXT_VER}" == "${SSOT_VERSION}" ]]; then
    echo -e "  ${RED}❌ WIKI.md 状态表「下一版」= ${WIKI_NEXT_VER}，与当前版本 ${SSOT_VERSION} 同号——自相矛盾${NC}"
    echo -e "    修法：docs/WIKI.md「下一版」应指向真正未发布的下一版（如 v1.4.9）"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} WIKI.md 状态表「下一版」${WIKI_NEXT_VER} ≠ 当前 ${SSOT_VERSION}"
    CHECKS=$((CHECKS + 1))
  fi
fi
echo ""

# ── v1.2.8 P1-26: MCP 工具数一致性 ──────────────────────────
echo "=== 17. MCP 工具数一致性 ==="
MCP_SRC_DIR="${PROJECT_ROOT}/engine/mcp/src"
SKILL_FILE="${PROJECT_ROOT}/SKILL/SKILL.md"
if [[ -d "${MCP_SRC_DIR}" ]] && [[ -f "${SKILL_FILE}" ]]; then
  # v1.2.9 功能⑤：mcp-server.ts 拆分后工具定义在 tool-registry.ts（TOOLS 数组）+ resources.ts
  # v1.3.2 P0-R4 修正：tools/list 实际返回 [...TOOLS, ...getDynamicTools()]（动态工具默认空），
  #   权威计数 = tool-registry.ts 的 TOOLS 数组顶层 name（不含 resources.ts——资源不是工具，
  #   旧实现把 4 个 resource 也算进去导致 39 虚高；旧 grep 只扫 tools/*.ts 又低估为 29）。
  # 只数 tool-registry.ts 顶层 name:（4 空格缩进开头，避免嵌套 schema 字段误计）
  REGISTERED_COUNT=$(grep -oE "^    name: '[^']+'" "${MCP_SRC_DIR}/tool-registry.ts" 2>/dev/null | sed "s/.*name: '//;s/'//" | sort -u | wc -l | tr -d ' ')
  # 从 SKILL.md 提取标题中声称的工具数
  SKILL_CLAIMED=$(grep -oE '[0-9]+ tools' "${SKILL_FILE}" | grep -oE '^[0-9]+' | head -1)
  if [[ -n "$SKILL_CLAIMED" ]] && [[ "$SKILL_CLAIMED" != "$REGISTERED_COUNT" ]]; then
    echo "  ❌ SKILL.md 声称 ${SKILL_CLAIMED} tools，mcp/src/ 注册 ${REGISTERED_COUNT} 个"
    ERRORS=$((ERRORS + 1))
  elif [[ -n "$SKILL_CLAIMED" ]]; then
    echo -e "  ${GREEN}✓${NC} MCP 工具数一致：${REGISTERED_COUNT} tools"
    CHECKS=$((CHECKS + 1))
  fi
  # v1.3.5 bugfix #3：ARCHITECTURE 能力总览表纳入扫描（此前只比对 SKILL.md，
  #   :149 的「38 tools」漂移因此漏检）。⚠️ 只扫「能力与状态总览」到「对外核心能力」
  #   之间的包结构表——:1036 附近的「四阶段×版本」历史对照表里的 27/390/696 是
  #   v1.2.5 时点快照，属合法历史数据，不扫不改。
  ARCH_FILE="${PROJECT_ROOT}/docs/ARCHITECTURE.md"
  if [[ -f "${ARCH_FILE}" ]]; then
    # 提取能力总览段（## 能力与状态总览 → ### 对外核心能力）中的「（N tools）」声称
    ARCH_CLAIMED=$(sed -n '/^## 能力与状态总览/,/^### 对外核心能力/p' "${ARCH_FILE}" 2>/dev/null \
      | grep -oE '[（(][0-9]+ tools[）)]' | grep -oE '[0-9]+' | head -1)
    if [[ -n "${ARCH_CLAIMED}" ]] && [[ "${ARCH_CLAIMED}" != "${REGISTERED_COUNT}" ]]; then
      echo "  ❌ ARCHITECTURE 能力总览表声称 ${ARCH_CLAIMED} tools，mcp/src/ 注册 ${REGISTERED_COUNT} 个"
      ERRORS=$((ERRORS + 1))
    elif [[ -n "${ARCH_CLAIMED}" ]]; then
      echo -e "  ${GREEN}✓${NC} ARCHITECTURE 能力总览工具数一致：${ARCH_CLAIMED} tools"
      CHECKS=$((CHECKS + 1))
    else
      echo "  ⚠ ARCHITECTURE 能力总览表未找到「（N tools）」声称，跳过比对"
    fi
  fi
fi
echo ""

# ── v1.3.0: package.json license 字段检查（fresh-eyes P1-8）──
echo "=== 18. package.json license 字段 ==="
LICENSE=$(node -e "const p=require('./package.json'); console.log(p.license || '')" 2>/dev/null || echo "")
if [[ -n "$LICENSE" ]]; then
  echo -e "  ${GREEN}✓${NC} license = ${LICENSE}"
  CHECKS=$((CHECKS + 1))
else
  echo -e "  ${RED}✗${NC} package.json 缺少 license 字段"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# ── v1.3.0: action.yml 版本锁定检查（fresh-eyes P1-10）──
echo "=== 19. action.yml @sofagent/* 版本锁定 ==="
ACTION_FILE="${PROJECT_ROOT}/action.yml"
if [[ -f "${ACTION_FILE}" ]]; then
  ACTION_LOCK_OK=true
  # 扫描 action.yml 中所有 @sofagent/* 引用，检查是否锁定到当前版本
  while IFS= read -r line; do
    # 提取 @sofagent/xxx@x.y.z 中的版本号
    locked_ver=$(echo "$line" | grep -oE '@sofagent/[a-z-]+@[0-9]+\.[0-9]+\.[0-9]+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    unlocked=$(echo "$line" | grep -oE '@sofagent/[a-z-]+[^@]' | head -1)
    if [[ -z "$locked_ver" ]] && [[ -n "$unlocked" ]]; then
      echo -e "  ${RED}✗${NC} 版本未锁定: $(echo "$line" | sed 's/^[[:space:]]*//' | head -c 80)"
      ACTION_LOCK_OK=false
      ERRORS=$((ERRORS + 1))
    elif [[ -n "$locked_ver" ]] && [[ "$locked_ver" != "$SSOT_VERSION" ]]; then
      echo -e "  ${RED}✗${NC} 版本漂移: @sofagent/*@${locked_ver} ≠ SSOT ${SSOT_VERSION}"
      ACTION_LOCK_OK=false
      ERRORS=$((ERRORS + 1))
    fi
  done < <(grep -E '@sofagent/' "${ACTION_FILE}" 2>/dev/null)
  if $ACTION_LOCK_OK; then
    echo -e "  ${GREEN}✓${NC} action.yml 中所有 @sofagent/* 引用已锁定到 v${SSOT_VERSION}"
    CHECKS=$((CHECKS + 1))
  fi
fi
echo ""

# ── v1.3.1: 文档示例版本号占位符检查（fresh-eyes 数字侦探补盲）──
# action.yml 必须锁定真实版本号（维度 19），但 docs/ 下的示例代码应该用
# 占位符（如 <LATEST>）——否则每次 bump 都会漏改文档示例（v1.3.1 发版时
# github-action.md 漏改就是这个坑）。文档示例里出现真实版本号 = bug。
echo "=== 19b. 文档示例 @sofagent/* 版本号占位符 ==="
DOC_PLACEHOLDER_OK=true
while IFS= read -r md; do
  # 扫描文档中 @sofagent/xxx@<数字开头版本号>（真实版本号）
  while IFS=: read -r line_num line_content; do
    real_ver=$(echo "$line_content" | grep -oE '@sofagent/[a-z-]+@[0-9]+\.[0-9]+\.[0-9]+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [[ -n "$real_ver" ]]; then
      echo -e "  ${RED}✗${NC} ${md}:${line_num} 文档示例含真实版本号 @sofagent/*@${real_ver}"
      echo -e "    ${RED}应改为占位符（如 <LATEST>），避免 bump 时漏改${NC}"
      DOC_PLACEHOLDER_OK=false
      ERRORS=$((ERRORS + 1))
    fi
  done < <(grep -nE '@sofagent/[a-z-]+@[0-9]' "$md" 2>/dev/null || true)
done < <(find "${PROJECT_ROOT}/docs" \
  -name '*.md' \
  -not -path '*/archive/*' \
  -not -path '*/changelog/*' \
  -type f 2>/dev/null || true)
if $DOC_PLACEHOLDER_OK; then
  echo -e "  ${GREEN}✓${NC} 文档示例无真实版本号（均用占位符或已排除）"
  CHECKS=$((CHECKS + 1))
fi
echo ""

# ── 20. 安装入口 tag 对账（v1.3.6 B3 · fresh-eyes B1 防复发）──────────────────
# README.md / README.en.md / bootstrap.sh 三处 refs/tags/vX.Y.Z 必须互相一致；
# 与 package.json version 不一致时 WARN（发版后需 bump 属预期中间态，不阻断）；
# 三方自身不一致时 ERROR 阻断（安装入口互相打架 = 用户装到不同版本）。
echo "=== 20. 安装入口 tag 对账（README × bootstrap） ==="
TAG_README_CN=$(grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/README.md" 2>/dev/null | head -1 || true)
TAG_README_EN=$(grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/README.en.md" 2>/dev/null | head -1 || true)
TAG_BOOTSTRAP=$(grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/bootstrap.sh" 2>/dev/null | head -1 || true)
if [[ -z "$TAG_README_CN" ]] || [[ -z "$TAG_README_EN" ]] || [[ -z "$TAG_BOOTSTRAP" ]]; then
  echo -e "  ${RED}✗${NC} 安装入口 tag 缺失：README.md=${TAG_README_CN:-无} README.en.md=${TAG_README_EN:-无} bootstrap.sh=${TAG_BOOTSTRAP:-无}"
  ERRORS=$((ERRORS + 1))
else
  if [[ "$TAG_README_CN" != "$TAG_README_EN" ]] || [[ "$TAG_README_CN" != "$TAG_BOOTSTRAP" ]]; then
    echo -e "  ${RED}✗${NC} 安装入口 tag 三方不一致：README.md=$TAG_README_CN README.en.md=$TAG_README_EN bootstrap.sh=$TAG_BOOTSTRAP"
    ERRORS=$((ERRORS + 1))
  elif [[ "$TAG_README_CN" != "refs/tags/v${SSOT_VERSION}" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 安装入口 tag=$TAG_README_CN 落后于当前版本 v${SSOT_VERSION}——发版后需 bump（B1 教训：tag 打完后安装入口三处随版同步，见 releasing/09-publish.md 步骤五）"
    WARNINGS=$((WARNINGS + 1))
  else
    echo -e "  ${GREEN}✓${NC} 安装入口 tag 三方一致且与当前版本对齐：${TAG_README_CN}"
    CHECKS=$((CHECKS + 1))
  fi
fi
echo ""

# ── 20b. bootstrap lib 哈希对账（v1.4.5 P0 防复发）────────────────────────
# 第 20 项只管「refs/tags/vX.Y.Z 版本号字符串」，管不到「被钉文件的实际内容」。
# v1.4.5 实锤：INSTALL_SHA256 回填之后又改了 config.sh（set -u 炸弹修复），
# 主安装路径 fail-closed 100% 装不上（用户看到「可能被劫持」红色告警），
# 而本脚本当时报全绿——7 个哈希里只有 1 个有验收式。此处逐一对账全部 lib。
# 🔴 双基准：tag 已打 → 对账 tag 内容（发版后契约）；tag 未打但 INSTALL_URL 已随版同步
#    （bump 已落盘）→ 对账**工作树**内容。后者是拦住「钉值按 bump 前内容计算」的唯一
#    时机——bump 会改写 install.sh / lib 的版本串，钉值必须在 bump 之后重算；该时序错
#    一旦带进 tag，主安装路径对全部用户 fail-closed（用户看到「可能被劫持」红色告警）。
echo "=== 20b. bootstrap lib 哈希对账（钉值 vs tag 实际内容） ==="
BOOTSTRAP_LIB_MISS=0
B_BASE=""; B_BASE_DESC=""
if git rev-parse "refs/tags/v${SSOT_VERSION}" >/dev/null 2>&1; then
  B_BASE="refs/tags/v${SSOT_VERSION}"
  B_BASE_DESC="v${SSOT_VERSION} tag"
else
  B_URL_TAG=$(grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/bootstrap.sh" 2>/dev/null | head -1 || true)
  if [[ "$B_URL_TAG" = "refs/tags/v${SSOT_VERSION}" ]]; then
    B_BASE_DESC="工作树（tag 未打 · INSTALL_URL 已随版同步）"
  else
    echo -e "  ${YELLOW}⚠${NC} 本地无 tag v${SSOT_VERSION} 且 INSTALL_URL 仍指 ${B_URL_TAG:-无}（窗口态），跳过 lib 哈希对账（发版后自动生效）"
    WARNINGS=$((WARNINGS + 1))
  fi
fi
if [[ -n "$B_BASE_DESC" ]]; then
  # 内容读取：tag 态取 tag blob / tag 前取工作树文件（口径由 B_BASE_DESC 随行打印）
  if [[ -n "$B_BASE" ]]; then
    _b_blob() { git show "${B_BASE}:$1" 2>/dev/null; }
  else
    _b_blob() { cat "${PROJECT_ROOT}/$1" 2>/dev/null; }
  fi
  B_LIB_FILES=$(sed -n 's/^LIB_FILES="\(.*\)"$/\1/p' "${PROJECT_ROOT}/bootstrap.sh" 2>/dev/null | head -1 || true)
  # 提取 LIB_SHA256S 多行块（首行带 `LIB_SHA256S="` 前缀，末行带 `"` 后缀）
  B_LIB_HASHES=$(awk '/^LIB_SHA256S="/{f=1} f{line=$0; gsub(/LIB_SHA256S="|"/,"",line); if (line != "") print line} f&&/"$/{exit}' "${PROJECT_ROOT}/bootstrap.sh" 2>/dev/null || true)
  B_INST_HASH=$(sed -n 's/^INSTALL_SHA256="\([0-9a-f]*\)".*$/\1/p' "${PROJECT_ROOT}/bootstrap.sh" 2>/dev/null | head -1 || true)
  if [[ -z "$B_LIB_FILES" || -z "$B_LIB_HASHES" ]]; then
    echo -e "  ${YELLOW}⚠${NC} bootstrap.sh 未解析到 LIB_FILES / LIB_SHA256S（格式变化？人工确认）"
    WARNINGS=$((WARNINGS + 1))
  else
    B_FILE_ARR=()
    for _lf in $B_LIB_FILES; do B_FILE_ARR+=("$_lf"); done
    B_HASH_ARR=()
    while IFS= read -r _lh; do
      [[ -n "$_lh" ]] && B_HASH_ARR+=("$_lh")
    done <<< "$B_LIB_HASHES"
    if [[ ${#B_FILE_ARR[@]} -ne ${#B_HASH_ARR[@]} ]]; then
      echo -e "  ${RED}✗${NC} LIB_FILES(${#B_FILE_ARR[@]}) 与 LIB_SHA256S(${#B_HASH_ARR[@]}) 数量不等——顺序/条数失配"
      ERRORS=$((ERRORS + 1))
    else
      # install.sh 本体哈希（与 6 个 lib 同一类契约，一并对账）
      if [[ -n "$B_INST_HASH" ]]; then
        B_INST_ACTUAL=$(_b_blob install.sh | shasum -a 256 | cut -d' ' -f1 || true)
        if [[ "$B_INST_HASH" == "$B_INST_ACTUAL" ]]; then
          echo -e "  ${GREEN}✓${NC} install.sh 哈希与 ${B_BASE_DESC} 一致"
          CHECKS=$((CHECKS + 1))
        else
          echo -e "  ${RED}✗${NC} install.sh 哈希漂移：钉值 ${B_INST_HASH:0:12}… ≠ ${B_BASE_DESC} 实际 ${B_INST_ACTUAL:0:12}…——重算回填（回填后不得再改该文件）"
          ERRORS=$((ERRORS + 1))
        fi
      fi
      B_IDX=0
      for _lfname in "${B_FILE_ARR[@]}"; do
        B_EXPECT="${B_HASH_ARR[$B_IDX]}"
        B_ACTUAL=$(_b_blob "engine/scripts/lib/${_lfname}" | shasum -a 256 | cut -d' ' -f1 || true)
        if [[ -z "$B_ACTUAL" ]]; then
          echo -e "  ${RED}✗${NC} ${B_BASE_DESC} 上无 engine/scripts/lib/${_lfname}——钉了不存在的文件"
          ERRORS=$((ERRORS + 1))
        elif [[ "$B_EXPECT" == "$B_ACTUAL" ]]; then
          CHECKS=$((CHECKS + 1))
        else
          echo -e "  ${RED}✗${NC} ${_lfname} 哈希漂移：钉值 ${B_EXPECT:0:12}… ≠ ${B_BASE_DESC} 实际 ${B_ACTUAL:0:12}…——回填后又改过该文件，重算回填"
          ERRORS=$((ERRORS + 1))
          BOOTSTRAP_LIB_MISS=$((BOOTSTRAP_LIB_MISS + 1))
        fi
        B_IDX=$((B_IDX + 1))
      done
      if [[ $BOOTSTRAP_LIB_MISS -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} ${#B_FILE_ARR[@]} 个 lib 哈希与 ${B_BASE_DESC} 全部一致（主安装链完整）"
      fi
    fi
  fi
fi
echo ""

# ── 末尾独立断言：env.local 保险（不参与编号段）────────────────
# 真实 key 文件已移出仓库目录（现为 ~/.sofagent/env.local，2026-09-12 收面批）。
# 本断言防两道万一：文件被误放回仓内 / git add -f 误提交。
# 注意：env.local.template 是模板（不含真实 key），必须排除——
# 精确匹配「以 env.local 结尾且非 template」的已跟踪文件。
echo "=== 断言. env.local 未入库（真实 key 防误提交）==="
ENV_LOCAL_TRACKED=$(git ls-files 2>/dev/null | grep -E "(^|/)env\.local$" | grep -v "template" || true)
if [ -n "${ENV_LOCAL_TRACKED}" ]; then
  echo -e "  ${RED}✗${NC} 检测到真实 key 文件被 git 跟踪："
  echo "${ENV_LOCAL_TRACKED}" | sed 's/^/    /'
  echo -e "  ${RED}立即处理：git rm --cached <file> 并确认 FORGE/.gitignore 覆盖${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${GREEN}✓${NC} env.local 未入库（template 模板除外，属预期）"
  CHECKS=$((CHECKS + 1))
fi
echo ""

# ── 21. 构建产物陈旧检查（v1.4.0 fresh-eyes F-01 防复发）──────────────────
# engine/audit/dist/index.js 等 dist 产物须与源码同版本（bump 后未 rebuild = 陈旧残留）。
# 与 SSOT 不一致时 WARN（发版前未 build 属预期中间态，阶段十 npm run build 消解；不阻断）
# 但与 package.json 版本差 ≥1 个 major 时 ERROR（陈旧过度 = 真问题）。
echo "=== 21. 构建产物版本对账（dist vs 源码） ==="
DIST_VER=$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/engine/audit/dist/index.js" 2>/dev/null | head -1 || true)
if [[ -z "$DIST_VER" ]]; then
  echo -e "  ${YELLOW}⚠${NC} engine/audit/dist/index.js 未构建或版本号缺失——阶段十 npm run build 后消解"
  WARNINGS=$((WARNINGS + 1))
elif [[ "$DIST_VER" != "v${SSOT_VERSION}" ]]; then
  echo -e "  ${YELLOW}⚠${NC} dist 版本=$DIST_VER 落后于 SSOT v${SSOT_VERSION}——bump 后未 rebuild（F-01 防复发：发版前必跑 npm run build）"
  WARNINGS=$((WARNINGS + 1))
else
  echo -e "  ${GREEN}✓${NC} dist 版本与 SSOT 一致：${DIST_VER}"
  CHECKS=$((CHECKS + 1))
fi
echo ""

# ── 22. MCP 工具数对账（v1.4.0 fresh-eyes F-05 防复发）──────────────────
# tool-registry.ts 工具注册数与文档声称数一致（F-05：DEVELOPMENT.md 曾写 60，实际 66）。
# 文档数字漂移 = 活文档同步遗漏；SSOT = tool-registry.ts 实际注册数。
echo "=== 22. MCP 工具数对账（registry vs 文档声称） ==="
# 兜底用 || true 而非 || echo 0：grep -c 零匹配已自行输出单行 0，|| echo 0 成双零；
# 且此处 MCP_REG=0 时下方条件分支会显式报错（SSOT 丢失不得静默假绿）
MCP_REG=$(grep -cE "^    name: '[a-z_]+'" "${PROJECT_ROOT}/engine/mcp/src/tool-registry.ts" 2>/dev/null || true)
MCP_REG=${MCP_REG:-0}
if [[ "${MCP_REG}" =~ ^[0-9]+$ ]] && [[ "${MCP_REG}" -gt 0 ]]; then
  echo -e "  ${GREEN}✓${NC} tool-registry.ts 注册 ${MCP_REG} 个 MCP 工具（SSOT）"
  # 文档声称数（DEVELOPMENT.md 的「当前 N 个 MCP tools」表述）
  DOC_MCP=$(grep -oE '当前 [0-9]+ 个 MCP tools' "${PROJECT_ROOT}/docs/DEVELOPMENT.md" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
  if [[ -n "$DOC_MCP" ]] && [[ "$DOC_MCP" != "$MCP_REG" ]]; then
    echo -e "  ${RED}✗${NC} DEVELOPMENT.md 声称 $DOC_MCP 个 MCP tools，实际 ${MCP_REG}——活文档数字漂移（F-05 防复发）"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} DEVELOPMENT.md MCP 数一致"
    CHECKS=$((CHECKS + 1))
  fi
else
  echo -e "  ${YELLOW}⚠${NC} tool-registry.ts 工具数解析失败（格式变化？人工确认）"
  WARNINGS=$((WARNINGS + 1))
fi

# README 双语工具数对账（v1.4.5 fresh-eyes round-1 防复发）：
# README.md / README.en.md 中所有「N MCP tools」「N 个 MCP tool」声称数逐项与 registry SSOT 核对，
# 任一处漂移即报错——防「正文已改、表格/附录残留旧值」的局部漏改（本次 80→83 表格漏改即案例）。
if [[ "${MCP_REG}" =~ ^[0-9]+$ ]] && [[ "${MCP_REG}" -gt 0 ]]; then
  # -a 强制文本模式：macOS BSD grep 对含中文行做 -o 提取时可能误判 binary（fresh-eyes 实锤），-a 通吃
  README_CLAIMS=$(grep -hoaE '[0-9]+( 个)? MCP tools?' "${PROJECT_ROOT}/README.md" "${PROJECT_ROOT}/README.en.md" 2>/dev/null | grep -oE '^[0-9]+' || true)
  README_DRIFT=0
  README_CLAIM_TOTAL=0
  while IFS= read -r _claim_num; do
    [[ -z "${_claim_num}" ]] && continue
    README_CLAIM_TOTAL=$((README_CLAIM_TOTAL + 1))
    if [[ "${_claim_num}" != "${MCP_REG}" ]]; then
      echo -e "  ${RED}✗${NC} README 工具数漂移：声称 ${_claim_num}，registry 实际 ${MCP_REG}——README 双语工具数对账（fresh-eyes round-1 防复发）"
      ERRORS=$((ERRORS + 1))
      README_DRIFT=1
    fi
  done <<< "${README_CLAIMS}"
  if [[ "${README_CLAIM_TOTAL}" -eq 0 ]]; then
    echo -e "  ${YELLOW}⚠${NC} README 未提取到任何工具数声称（格式变化？人工确认）"
    WARNINGS=$((WARNINGS + 1))
  elif [[ "${README_DRIFT}" -eq 0 ]]; then
    echo -e "  ${GREEN}✓${NC} README.md / README.en.md 共 ${README_CLAIM_TOTAL} 处工具数声称与 registry（${MCP_REG}）一致"
    CHECKS=$((CHECKS + 1))
  fi
fi
echo ""

# ── 22b. API.md 版本头工具数对账（v1.4.9 汇总报告零信任复验发现 · 防复发）──────
# 批 5 同步曾漏改 API.md 版本头行（「版本：vX.Y · N tools / M 面」格式），
# §22 既有正则只捕「当前 N 个 MCP tools」「N MCP tools?」，该行不匹配——版本头是对账盲区。
# SSOT 仍为 tool-registry.ts 实际注册数；本段锚定 API.md 头部 20 行内的版本头行。
echo "=== 22b. API.md 版本头工具数对账 ==="
if [[ "${MCP_REG}" =~ ^[0-9]+$ ]] && [[ "${MCP_REG}" -gt 0 ]]; then
  # 版本头格式「· N tools / M 面」；head -20 限定头部，避免误捕正文历史沿革叙述
  API_HEAD_TOOLS=$(sed -n '1,20p' "${PROJECT_ROOT}/docs/API.md" 2>/dev/null | grep -oE '· [0-9]+ tools? /' | grep -oE '[0-9]+' | head -1 || true)
  if [[ -z "${API_HEAD_TOOLS}" ]]; then
    echo -e "  ${RED}✗ ${NC}API.md 头部未提取到版本头工具数（格式变化？）——锚点失效须人工修，不得静默跳过"
    ERRORS=$((ERRORS + 1))
  elif [[ "${API_HEAD_TOOLS}" != "${MCP_REG}" ]]; then
    echo -e "  ${RED}✗ ${NC}API.md 版本头工具数漂移：声称 ${API_HEAD_TOOLS}，registry 实际 ${MCP_REG}——版本头行与 :3 总述行须同批同步"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} API.md 版本头工具数一致（${API_HEAD_TOOLS}）"
    CHECKS=$((CHECKS + 1))
  fi
  # ── 版本号字段对账（v1.4.9 阶段六复跑发现）────────────────────────
  # 本行「版本：vX.Y.Z（状态）· N tools / M 面」共三个字段：工具数（上一段对账）、
  # 版本号、状态措辞。后两者长期无人对账——曾出现 v1.4.8 版本头带「（已发版）」字样
  # 滞留至 1.4.9 待发版窗口（bump 不认此形态 + 状态措辞系上版机械沿用）。
  API_HEAD_VER=$(sed -n '1,20p' "${PROJECT_ROOT}/docs/API.md" 2>/dev/null | grep -oE '版本：v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
  if [[ -z "${API_HEAD_VER}" ]]; then
    echo -e "  ${RED}✗ ${NC}API.md 头部未提取到版本头版本号（格式变化？）——锚点失效须人工修，不得静默跳过"
    ERRORS=$((ERRORS + 1))
  elif [[ "${API_HEAD_VER}" != "${SSOT_VERSION}" ]]; then
    echo -e "  ${RED}✗ ${NC}API.md 版本头版本号漂移：声称 v${API_HEAD_VER}，SSOT v${SSOT_VERSION}——bump 不认「版本：vX.Y.Z」形态，须手工同步"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} API.md 版本头版本号一致（v${API_HEAD_VER}）"
    CHECKS=$((CHECKS + 1))
  fi
else
  echo -e "  ${YELLOW}⚠${NC} registry 工具数不可用，API.md 版本头对账跳过"
  WARNINGS=$((WARNINGS + 1))
fi

# ── 23. lock 与 workspace 同步（v1.4.0 发版 CI 4 红防复发 · checklist 维度 122）──
# 新增/删除 workspace 包后 lock file 必须重新生成——本地 npm install 会静默补齐掩盖问题，
# CI npm ci 严格校验直接红（v1.4.0：9 个 cordis-plugin 未入 lock，4 工作流同根因红）。
# 静态比对（快，不跑 npm ci）：package.json workspaces 声明的每个包必须在 lock.packages 有条目。
echo "=== 23. lock 与 workspace 同步（新包未入 lock = CI 必红） ==="
LOCK_WS_CHECK=$(node -e "
const fs = require('fs');
const path = '${PROJECT_ROOT}';
try {
  const pkg = JSON.parse(fs.readFileSync(path + '/package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path + '/package-lock.json', 'utf8'));
  const ws = (pkg.workspaces || []).flat();
  const missing = ws.filter(w => !lock.packages || !lock.packages[w]);
  if (missing.length) { console.log('MISSING:' + missing.join(',')); process.exit(1); }
  console.log('OK:' + ws.length);
} catch (e) { console.log('PARSE_ERR:' + e.message); process.exit(2); }
" 2>/dev/null || echo "PARSE_ERR:node-unavailable")
if [[ "$LOCK_WS_CHECK" == OK:* ]]; then
  echo -e "  ${GREEN}✓${NC} 全部 ${LOCK_WS_CHECK#OK:} 个 workspace 包已入 lock file"
  CHECKS=$((CHECKS + 1))
elif [[ "$LOCK_WS_CHECK" == MISSING:* ]]; then
  echo -e "  ${RED}✗${NC} 以下 workspace 包未入 lock file（push 后 CI npm ci 必红）："
  echo "${LOCK_WS_CHECK#MISSING:}" | tr ',' '\n' | sed 's/^/      /'
  echo -e "  ${RED}修复：npm install --package-lock-only 后随代码同 commit${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "  ${YELLOW}⚠${NC} lock 解析失败（${LOCK_WS_CHECK#PARSE_ERR:}）——人工跑 npm ci --dry-run 确认"
  WARNINGS=$((WARNINGS + 1))
fi

echo "=== 24. CHANGELOG 顶版 vs package.json SSOT（防「CHANGELOG 已收录新版本但包未 bump」漂移）==="
# v1.4.1 fresh-eyes run-01 finding-09：CHANGELOG 顶版可先于包版本收录（开发完成待发版），
# 该窗口是合法中间态——但**顶版 > 包版本**超一版即为漂移（说明上一版发完忘了 bump 或跳版收录）。
CHANGELOG_TOP_VERSION=$(grep -m1 -oE '^- \*\*v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/CHANGELOG.md" 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || echo "")
PKG_VERSION="v${SSOT_VERSION}"
if [[ -z "${CHANGELOG_TOP_VERSION}" ]]; then
  echo -e "  ${YELLOW}⚠${NC} CHANGELOG 顶版提取失败（格式变更？）——人工核对"
  WARNINGS=$((WARNINGS + 1))
else
  node -e "
const top = '${CHANGELOG_TOP_VERSION}'.slice(1).split('.').map(Number);
const pkg = '${PKG_VERSION}'.slice(1).split('.').map(Number);
// 顶版超前包版本最多 1 个版本位（patch 或 minor/major 后继——开发完成待发版窗口）；
// 超过一版 = 漂移。后继版本判定（非数值差）：minor 进位时 patch 归零（1.4.9→1.5.0）、
// major 进位时 minor/patch 归零——数值差会把 minor 后继误算成 91 倍漂移。
const isSucc = (t, p) =>
  (t[0] === p[0] && t[1] === p[1] && t[2] === p[2]) ||               // 相等（发版后常态）
  (t[0] === p[0] && t[1] === p[1] && t[2] === p[2] + 1) ||            // patch 后继
  (t[0] === p[0] && t[1] === p[1] + 1 && t[2] === 0) ||               // minor 后继（patch 归零）
  (t[0] === p[0] + 1 && t[1] === 0 && t[2] === 0);                    // major 后继（minor/patch 归零）
if (!isSucc(top, pkg)) { console.log('DRIFT:' + '${CHANGELOG_TOP_VERSION}' + '>' + '${PKG_VERSION}'); process.exit(1); }
console.log('OK:' + '${CHANGELOG_TOP_VERSION}' + ' vs ' + '${PKG_VERSION}');
" 2>/dev/null && { echo -e "  ${GREEN}✓${NC} CHANGELOG 顶版为包版本后继一版（patch/minor 待发版窗口合法）"; CHECKS=$((CHECKS + 1)); } || {
    echo -e "  ${RED}✗${NC} CHANGELOG 顶版 ${CHANGELOG_TOP_VERSION} 超前包版本 ${PKG_VERSION} 超一版——上一版发完未 bump 或跳版收录"
    echo -e "  ${RED}修复：bash tools/release/bump-version.sh <旧> <新> 后随代码同 commit${NC}"
    ERRORS=$((ERRORS + 1))
  }
fi
echo ""

echo "=== 25. 待发版窗口三态一致性（B1 防复发：CHANGELOG 收录 × badge→CHANGELOG 动线 × 安装 URL） ==="
# v1.4.1 fresh-eyes F01/B1：开发完成→发版之间，「tag/npm=旧版、代码=新版、文档=待发版标注」
# 三处状态信号必须配套齐——CHANGELOG 收录了新版但版本动向无解释，或安装 URL 已指向
# 未打的 tag，都是三态缺角（陌生人视角必误报/安装链必断）。
# v1.4.6 拍板（2026-09-07）：旧检查要求「README 头部待发版状态行」，与 06-doc-finalize.md
# 「README 头部禁止版本状态播报行」铁律（2026-09-06 拍板）直接冲突——待发版窗口内门禁红灯
# 但按铁律不能修，形成死锁。按铁律更新：版本动向不走状态行，走 badge→CHANGELOG 动线，
# 本项检查相应改为「badge 与 CHANGELOG 链接同排存在」。
# 前置条件：第 24 项已算出顶版 > SSOT（drift=1）才进入；非待发版窗口三态天然一致，跳过。
# ── 已发版态判定（§26/§27 共用口径：tag/npm 任一达 SSOT = 已发版）──
# 「待发版」标注的合法性由发版状态决定，两类窗口内活文档如实标注都不是漏翻：
#   a) 开发态（tag/npm 均未达 SSOT）—— bump→tag 间合法中间态；
#   b) 待发版窗口白名单（§27 F6 先例）—— 已发版态 + 下一版开发日志在位（下一版开发完成、
#      CHANGELOG 尚未收录、ROADMAP 如实标「开发完成（待发版）」）。
# 本判定上移供 §26/§27 共用，杜绝同一内容两套口径（检查 26 原不分窗口扫描曾在开发态
# 与 §27「开发态标注合法」同内容对撞）。
F6_RELEASED=false
if git rev-parse "v${SSOT_VERSION}" >/dev/null 2>&1; then
  F6_RELEASED=true
  F6_WHY="git tag v${SSOT_VERSION} 已存在"
fi
F6_NPM_VER=$(npm view @sofagent/audit version 2>/dev/null | head -1 || true)
if [ -n "$F6_NPM_VER" ] && [ "$F6_NPM_VER" = "$SSOT_VERSION" ]; then
  F6_RELEASED=true
  F6_WHY="npm registry @sofagent/audit@${SSOT_VERSION} 已发布${F6_WHY:+（${F6_WHY}）}"
fi
# 待发版窗口白名单条件（双判据缺一不可）：存在 docs/changelog/vX.Y/ 目录内 devlog
# （版本号 = SSOT 的后继一版）且非空——防「上一版忘翻牌」借窗口逃检。
# 后继候选三类：patch 后继（同目录段）/ minor 后继（patch 归零，目录段进位 v1.4→v1.5）/
# major 后继（minor/patch 归零，目录段进位 v1→v2）——任一候选 devlog 在位即窗口开。
# 不假设「patch 上限 9」等版本惯例：三个候选路径逐一探测，实际存在者为窗口对象。
F6_NEXT_PATCH=""
F6_NEXT_CANDIDATES=$(node -e "
const p='${SSOT_VERSION}'.split('.').map(Number);
const cands = [
  [p[0], p[1], p[2]+1].join('.'),   // patch 后继
  [p[0], p[1]+1, 0].join('.'),      // minor 后继
  [p[0]+1, 0, 0].join('.')          // major 后继
];
console.log(cands.join(' '));" 2>/dev/null || echo "")
for _cand in ${F6_NEXT_CANDIDATES}; do
  _seg=$(echo "${_cand}" | cut -d. -f1-2)
  if [ -s "${PROJECT_ROOT}/docs/changelog/v${_seg}/v${_cand}.md" ]; then
    F6_NEXT_PATCH="${_cand}"
    F6_DEVLOG_DIR="${PROJECT_ROOT}/docs/changelog/v${_seg}"
    F6_NEXT_DEVLOG="${F6_DEVLOG_DIR}/v${_cand}.md"
    break
  fi
done
F6_WINDOW=false
if [ -n "$F6_NEXT_PATCH" ] && [ -s "$F6_NEXT_DEVLOG" ]; then
  F6_WINDOW=true
fi
# 🔴 26. 活文档「待发版」残留（v1.4.8 实锤 · 已发版态扫描）
# 上面第 25 项只在**待发版窗口**（顶版 ≠ SSOT）生效 ⇒ **发版后窗口关闭，残留的「待发版」不再被查**。
# v1.4.8 实锤：`docs/ROADMAP.md` 的版本规划表行写的是「📋 规划中/待发版」这类写法（与 CHANGELOG 顶版
# 行、文档头「> vX.Y · 待发版」三种写法并列），发版翻转时只翻了后两者，ROADMAP 表行**漏翻**，
# 而门禁因窗口关闭而不报。故本项扫活文档（排除 changelog/ 与 archive/，那里的「待发版」
# 是历史当时的正确状态）；窗口语义与 §27 同口径——开发态/白名单窗口内「待发版」合法
# （降级跳过，计 SKIPS 由发版 SOP「SKIP 数逐条裁决」步骤裁定），仅已发版态真扫描。
echo "=== 26. 活文档「待发版」残留（已发版态扫描） ==="
# 🔴 v1.5.1 I2（方向甲）：**入口条件删除待发版窗口白名单分支**。
#   判据自洽问题（本条的真正根因）：白名单设立的理由是「下一版 devlog 里的『待发版』标注
#   是合法的」——但本项的扫描范围**本就排除 `docs/changelog/`**（`grep -v "/changelog/"`），
#   该理由对本项**完全不适用**；这个白名单是从 §27 复制口径时连带抄来的，对本项纯属冗余
#   **且造成漏检**。实测后果：`docs/changelog/v1.5/` 下 v1.5.1–v1.5.5 五份规划 devlog 长期
#   在位 ⇒ `F6_WINDOW` 恒为 true ⇒ 本项自引入起**从未真正执行过一次**（「装了但没通电的
#   报警器」）。故入口条件只保留「已发版态」；窗口概念对本项不再适用。
#   ⚠️ §25 / §27 的白名单逻辑**不动**——那两处的窗口语义是正确的。
#   v1.5.1 J5 同批补强（词形 + 范围）：
#     ② 词形覆盖发版态语义族：`待发版` / `待发布`（历史写法），并补 `规划中/排期中`——
#        但后者**仅在与本版绑定**（行内含 SSOT 版本号）时才算残留（未来能力的规划项不是
#        发版态残留，全量纳入会制造假红）。
#     ③ 范围扩到**根目录活文档**（README.md / README.en.md / CHANGELOG.md）——A1/A2 恰在
#        根 README，原范围只有 docs/ ⇒ 同族漏网。
#   命中判据（同批必做 · 区分两种合法语义）：
#     · 本版残留     —— 已发版，文字仍述**本版**为待发版           ⇒ 报红
#     · 下一版陈述   —— 行内出现**非当前 SSOT 的版本号**（ROADMAP「下一版 v1.5.1」导航行、
#                       版本规划表里的未来版本行）⇒ **不报红**
#     · 提及而非使用 —— 词被「…」引用（索引规则说明行）⇒ 不报红
if $F6_RELEASED; then
  _I2_CAND=$(grep -rnE "待发版|待发布|规划中|排期中" --include="*.md" \
      "${PROJECT_ROOT}/docs" "${PROJECT_ROOT}/README.md" \
      "${PROJECT_ROOT}/README.en.md" "${PROJECT_ROOT}/CHANGELOG.md" 2>/dev/null \
    | grep -vE '^[^:]*/(changelog|archive)/' || true)  # F-31：只滤文件路径前缀，不滤行内容（行内 ./changelog/ 链接曾使整行被误滤）
  # 🔴 v1.5.3 阶段六修正 · F-14 行级排除（与 §27 同口径，补 §26 当年的漏改）：
  #   本项当初（v1.5.1 I2）只删了「整段窗口白名单」（因其使 §26 从未执行），但**没补 §27
  #   后来加的 F-14 行级排除** ⇒ 在待发版窗口内，合法的「下一版」标注被 §26 误判为残留。
  #   结构性矛盾实证（两步皆可复现）：
  #     ① §25a 强制 CHANGELOG 顶版行携带「待发版」，而该行按索引规范必带开发日志链接
  #        `./docs/changelog/vX.Y/vX.Y.Z.md` —— 链接路径产出 token「X.Y」恰等于 SSOT_2SEG
  #        ⇒ ③ 的豁免（不含 SSOT 版本号）永不成立，§25a 与 §26 在 1.5.x 系列窗口内互斥。
  #        （实测：不加本排除时 CHANGELOG 顶版行必被 §26 判红。）
  #     ② ROADMAP 规划表本版行状态列按 SOP 步骤十一 #15 写「✅ 开发完成（⏳ 待发版）」，其
  #        沿革链/形态归属段天然引用 SSOT 版本号，③ 同理不豁免——而 §27 的维护者自述注释
  #        （见下方 §27「ROADMAP 如实标『开发完成（待发版）』」）明文承认该写法为合法窗口态。
  #   排除口径 = §27 F-14：行内出现**下一版**（F6_NEXT_PATCH，即窗口对象版本）号即视为合法
  #   窗口标注。F6_NEXT_PATCH 为空（无下一版 devlog）时不适用本排除 ⇒ §26 照常全判。
  #   F-31 收紧保留：不含下一版号的「SSOT 版本 + 待发版」行仍照判（残留检测能力不减）。
  _I2_NEXT_EXCL=""
  [ -n "${F6_NEXT_PATCH}" ] && _I2_NEXT_EXCL="${F6_NEXT_PATCH//./\\.}"
  _I2_HITS=""
  while IFS= read -r _ln; do
    [[ -z "${_ln}" ]] && continue
    _rest="${_ln#*:}"; _body="${_rest#*:}"   # 剥掉 `文件:` 与 `行号:` 前缀
    # ① 只认**状态位语境**的行（列表行 / 引用行 / 表格行）——正文散句里的字样不计
    printf '%s' "${_body}" | grep -qE '^[[:space:]]*(-|>|\|)' || continue
    # ② 剔除「…」引用串后再判：词被引用（提及）≠ 词被使用（状态标注本身）
    _bare=$(printf '%s' "${_body}" | sed 's/「[^」]*」//g')
    printf '%s' "${_bare}" | grep -qE '待发版|待发布|规划中|排期中' || continue
    # ③（F-31 收紧）：行内出现非 SSOT 版本号且不含 SSOT 版本号才豁免——原「含他版号
    # 即整行豁免」让 ROADMAP 规划表行（天然含 v1.5.4/v1.6.0 等）全表逃检。
    _other=false
    _has_sot=false
    for _v in $(printf '%s' "${_body}" | grep -oE 'v?[0-9]+\.[0-9]+(\.[0-9]+)?' | tr -d 'v'); do
      case "${_v}" in
        "${SSOT_VERSION}"|"${SSOT_2SEG}") _has_sot=true ;;
        *) _other=true ;;
      esac
    done
    ${_other} && ! ${_has_sot} && continue
    # ④ 「规划中/排期中」单独触发时，须与本版绑定（行内含 SSOT 版本号）**且**行内未声明
    #    本版已发版——否则是「本版已发版 + 其他条目排期」的混合状态行，不是发版态残留
    #    （全量纳入「规划中」会制造假红；未来能力的规划项同样不是残留）
    # F-31 修正：纯「规划中/排期中」行（无待发版词）描述未来版本——一律豁免
    # （原判据④「须与本版绑定」方向写反，纯未来行反被误判残留）
    if ! printf '%s' "${_bare}" | grep -qE '待发版|待发布'; then
      continue
    fi
    # ⑤（v1.5.3 阶段六 · F-14 同族）：行内提及**下一版**（窗口对象）⇒ 合法窗口标注，
    #    不计残留。与 §27 的行级排除同口径——两守卫对同一内容不得两套判据。
    if [ -n "${_I2_NEXT_EXCL}" ] && printf '%s' "${_body}" | grep -qE "${_I2_NEXT_EXCL}"; then
      continue
    fi
    _I2_HITS="${_I2_HITS}${_ln}"$'\n'
  done <<< "${_I2_CAND}"
  _STALE_ROOT=$(grep -nE "^- \*\*v[0-9.]+\*\* *— *(⏳|📋)? *待发版" "${PROJECT_ROOT}/CHANGELOG.md" 2>/dev/null || true)
  if [ -n "${_I2_HITS}${_STALE_ROOT}" ]; then
    echo -e "  ${RED}✗${NC} 活文档仍含「待发版」（发版后应已翻转为「已发版」）："
    # 逐条引用（`${var}` 必须带引号：命中行含空格，裸展开会被 word-split 打散）
    printf '%s' "${_I2_HITS}${_STALE_ROOT}" | sed '/^$/d; s/^/      /'
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} 已发版态（${F6_WHY}），活文档无「待发版」残留（changelog/archive 的历史标注不计）"
    CHECKS=$((CHECKS + 1))
  fi
else
  echo -e "  ${YELLOW}⏭️${NC} 开发态（tag/npm 均未达 v${SSOT_VERSION}）——活文档「待发版」为 bump→tag 间合法中间态，跳过（§27 同口径）"
  SKIPS=$((SKIPS + 1))
  CHECKS=$((CHECKS + 1))
fi

if [[ -n "${CHANGELOG_TOP_VERSION}" ]] && [[ "${CHANGELOG_TOP_VERSION}" != "${PKG_VERSION}" ]]; then
  # a. CHANGELOG 顶版行必须带「待发版」状态标注（索引规则自我一致：收录了就要标）
  if grep -m1 -F -- "- **${CHANGELOG_TOP_VERSION}**" "${PROJECT_ROOT}/CHANGELOG.md" 2>/dev/null | grep -q "待发版"; then
    echo -e "  ${GREEN}✓${NC} CHANGELOG 顶版行带「待发版」标注"
    CHECKS=$((CHECKS + 1))
  else
    echo -e "  ${RED}✗${NC} CHANGELOG 顶版 ${CHANGELOG_TOP_VERSION} 已收录但缺「待发版」标注——索引规则与收录条目互斥（B1）"
    ERRORS=$((ERRORS + 1))
  fi
  # b/c. 版本动向读者动线（铁律：不走状态行，走 badge→CHANGELOG）——badge（Version-vX.Y）
  # 与 CHANGELOG 链接必须同排出现（读者循 badge 找到版本历史），双语各查一次。
  if head -20 "${PROJECT_ROOT}/README.md" 2>/dev/null | grep -qE 'CHANGELOG\.md.*Version-v|Version-v.*CHANGELOG\.md'; then
    echo -e "  ${GREEN}✓${NC} README.md 版本动线经 badge→CHANGELOG（状态行铁律合规）"
    CHECKS=$((CHECKS + 1))
  else
    echo -e "  ${RED}✗${NC} README.md 头部缺 badge→CHANGELOG 版本动线（铁律：版本动向走 badge 不走状态行）"
    ERRORS=$((ERRORS + 1))
  fi
  if head -20 "${PROJECT_ROOT}/README.en.md" 2>/dev/null | grep -qE 'CHANGELOG\.md.*Version-v|Version-v.*CHANGELOG\.md'; then
    echo -e "  ${GREEN}✓${NC} README.en.md 版本动线经 badge→CHANGELOG"
    CHECKS=$((CHECKS + 1))
  else
    echo -e "  ${RED}✗${NC} README.en.md 头部缺 badge→CHANGELOG 版本动线——双语动线漂移（B1）"
    ERRORS=$((ERRORS + 1))
  fi
  # d. 安装 URL refs/tags 不得指向未发布的新版 tag（指向未来 = 安装链断）
  B1_TAG_OVER=0
  while IFS= read -r _tagurl; do
    [[ -z "${_tagurl}" ]] && continue
    _tagver="${_tagurl#refs/tags/v}"
    _cmp=$(node -e "
const a='${_tagver}'.split('.').map(Number), b='${SSOT_VERSION}'.split('.').map(Number);
console.log(((a[0]-b[0])*10000+(a[1]-b[1])*100+((a[2]||0)-(b[2]||0))) > 0 ? 'OVER' : 'OK');
" 2>/dev/null || echo "OK")
    if [[ "${_cmp}" == "OVER" ]]; then
      echo -e "  ${RED}✗${NC} ${_tagurl} 指向未发布 tag（SSOT=${SSOT_VERSION}）——安装链断（B1）"
      B1_TAG_OVER=$((B1_TAG_OVER + 1))
    fi
  done <<EOF
$(grep -ohE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+' "${PROJECT_ROOT}/README.md" "${PROJECT_ROOT}/README.en.md" "${PROJECT_ROOT}/bootstrap.sh" 2>/dev/null | sort -u || true)
EOF
  if [[ ${B1_TAG_OVER} -eq 0 ]]; then
    echo -e "  ${GREEN}✓${NC} 安装 URL tag 全部 ≤ ${SSOT_VERSION}（未指向未发布 tag）"
    CHECKS=$((CHECKS + 1))
  else
    ERRORS=$((ERRORS + B1_TAG_OVER))
  fi
else
  echo -e "  ${GREEN}✓${NC} 非待发版窗口（顶版 = 包版本），三态天然一致，跳过"
  CHECKS=$((CHECKS + 1))
fi
echo ""

echo "=== 26. 工具数口径：全仓文档声称 vs registry SSOT（B8 漏改防复发） ==="
# v1.4.1 fresh-eyes F08/B8：HANDBOOK 写「v1.4.0 现 66」与 ARCHITECTURE/SKILL/AGENTS 的 67 漂移。
# 口径：工具数变更时全仓一次全量清点——白名单内每个声称过工具数的文档，当前口径数字
# （registry 实数）必须至少出现一次；历史双态表述（66/67 并列）不豁免「缺当前数」。
# 白名单语义：这些文档实际写着工具数叙事，口径必须跟住；叙事删除时应有意识地移白名单，不静默漏。
# v1.4.6（2026-09-07 拍板）：白名单由 6 处扩至 11 处活文档（补 SKILL/AGENTS.md、docs/API.md、docs/WIKI.md、GEMINI.md、CHANGELOG.md）——不再手数处数，以本白名单为唯一同步面。
# v1.5.2（工具数覆盖洞 3 批）：补 engine/umbrella/README.md（12 处）——包级 README 原在 §15 的
#   `^engine/` 排除面外、又不在本白名单内，两道门禁都不看它（实测其工具数叙事与 registry 一致，
#   但此前无守卫）。仅收「含当前全局口径」者：engine/mcp/README.md 的唯一工具数行是**分面**计数
#   （audit 专职面 9 tools），本项判据要求出现**全局**口径，收它即假红，故不在白名单（分面计数
#   另需角色轴断言，见当日排查报告）。
# 🔴 已知盲区（与 check-docs §15 同步登记）：全仓工具数正则只覆盖「数字在词前」形态，不覆盖
#   TOOLS=N / 工具数=N（数字在词后）；受跟踪面活文档该形态当前零命中，出现时须同批扩正则。
if [[ "${MCP_REG:-0}" =~ ^[0-9]+$ ]] && [[ "${MCP_REG}" -gt 0 ]]; then
  B8_DOC_MISS=0
  for _td in SKILL/SKILL.md docs/HANDBOOK.md docs/ARCHITECTURE.md AGENTS.md README.md README.en.md SKILL/AGENTS.md docs/API.md docs/WIKI.md GEMINI.md CHANGELOG.md engine/umbrella/README.md; do
    [[ -f "${PROJECT_ROOT}/${_td}" ]] || continue
    # 口径：该文档任一含 tool 的行出现当前实数即算口径已跟（双态表述「66→67」天然含 67）
    # 🔴 管道形态防 SIGPIPE 假红：`grep -q` 命中即早退 → 首 grep 收 SIGPIPE(141) → 本脚本
    # `set -o pipefail` 把整管道判 141 = 「口径缺失」假红（实测 CHANGELOG.md 16KB tool 行体量
    # 必触发，小文件瞬间写完不触发——同为命中却一真一假）。改两段式：先落临时文件再判，
    # 每段独立退出码，命中即真。
    _b8_lines=$(grep -i "tool" "${PROJECT_ROOT}/${_td}" 2>/dev/null || true)
    if printf '%s\n' "${_b8_lines}" | grep -qE "(^|[^0-9])${MCP_REG}([^0-9]|$)"; then
      echo -e "  ${GREEN}✓${NC} ${_td} 含当前口径 ${MCP_REG} tools"
      CHECKS=$((CHECKS + 1))
    else
      echo -e "  ${RED}✗${NC} ${_td} 含 tool 叙事但缺当前口径 ${MCP_REG}——口径漏改，补数字或有意识移白名单（B8）"
      B8_DOC_MISS=$((B8_DOC_MISS + 1))
    fi
  done
  [[ ${B8_DOC_MISS} -gt 0 ]] && ERRORS=$((ERRORS + B8_DOC_MISS))
else
  echo -e "  ${YELLOW}⚠${NC} tool-registry.ts 工具数解析失败，跳过全仓口径核对（第 22 项已报原因）"
  WARNINGS=$((WARNINGS + 1))
fi

# ── 26b. 规划中 devlog 工具数逐处对账（工具数覆盖洞 2 · v1.5.2 批）──────────────
# 门禁目的：§26 B8 是「至少出现一次」语义，管不到 changelog 域；§15 又整域排除 docs/changelog。
# 两道门禁之间，规划中（未发版）devlog 是当前口径的**承诺面**（发版时会成为事实），却无人逐处
# 对账——v2.0.0.md「其余 103 tools」与 v1.5.5.md「TOOLS=104」两处漂移正是漏在此缝里。
# 设计（主理人批准 · 方案 C）：两级分闸 + 行级判定。
#   闸 1（文件级）：boundary 取根 package.json 的 version 字段作 SSOT（🔴 禁由 ROADMAP 反推）；
#     版本 > boundary 的 changelog devlog 进闸 2；<= boundary 的已发版历史段整文件排除——
#     后者是冻结的历史（实测 <=1.5.1 共 52 文件含 104 条合法历史值，整域纳入即假红洪泛）。
#   闸 2（行级）：命中行若为「历史记录行」且数字 ≠ registry 实数 → 判红。行级判据
#     **直接移植 check-docs §15 现有四谓词**（演进链历史行/历史清单行/前缀限定面/装置面自引用），
#     不新造逻辑；另加谓词 5a/5b（方案 C，收敛 v2.0.0.md B 表的 9 条分面计数）：
#     5a 括注形态：claim 后紧跟 ）/) → 「能力簇（N tools）」表格逐簇计数；
#     5b 余量短语：claim 前 6 字符内含 其余|剩余 → 减面派生子集（如「其余 101」= 105−浏览器 4）。
# 🔴 已知盲区（硬要求一登记，与 form B 同一纪律）：
#   - 5a 豁免的是**括注形态**而非内容——planning devlog 内若出现括注形态的**全局**声称
#     （（本仓 N tools））同样会被豁免，属已知取舍；分面/簇计数轴的精确断言归属将来的
#     角色轴/能力簇轴门禁（洞 3 同判据注释）。
#   - 5b 豁免的数字是减面派生值非全局口径，同上归属分面轴。
#   - 本节正则与 §15 同源：不覆盖 TOOLS=N / 工具数=N（数字在词后）形态，出现时须同批扩正则。
# 落地实测（2026-09-21）：13 个 planning 文件 · ≠105 命中 13 条 → 四谓词收敛至 9 → +5a/5b 收敛至 0。
echo "=== 26b. 规划中 devlog 工具数逐处对账（boundary > v$(node -e 'console.log(require("./package.json").version)')）==="
PDL_SCAN=$(node -e "
const fs = require('fs');
const path = require('path');
// 闸 1：boundary = 根 package.json version（SSOT；🔴 禁由 ROADMAP 反推）
const boundary = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const bp = boundary.split('.').map(Number);
const isPlanning = v => { const p = v.split('.').map(Number); for (let i = 0; i < 3; i++) { const a = p[i] || 0, b = bp[i] || 0; if (a !== b) return a > b; } return false; };
const regSrc = fs.readFileSync('engine/mcp/src/tool-registry.ts', 'utf8');
const regCount = new Set([...regSrc.matchAll(/name:\s*'([a-z_]+)',/g)].map(m => m[1])).size;
const results = [];
let planningCount = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.md')) continue;
    const vm = p.match(/v(\d+\.\d+(?:\.\d+)?)\.md$/);
    if (!vm || !isPlanning(vm[1])) continue;  // 闸 1：已发版（<= boundary）整文件排除
    planningCount++;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 词形与 check-docs §15 同源（含 token 边界约束——修正边界非收窄词形）
      for (const _mm of line.matchAll(/(?<![A-Za-z0-9_.-])([0-9]+)\s*(?:个\s*)?(?:MCP\s*)?(?:tools?|工具)(?!包)/g)) {
        const claim = _mm[0];
        const _idx = _mm.index;
        const n = parseInt(_mm[1], 10);
        // 谓词 1（§15 移植）：演进链历史行（含 vX.Y 且含 后为/起/新增/→）
        if (/v[0-9]+\.[0-9]/.test(line) && /(后为|起|新增|→)/.test(line)) continue;
        // 谓词 2（§15 移植）：历史清单行（CHANGELOG 版本行 / 版本表行 / 日期流水行）
        if (/^\s*-\s*\*\*v[0-9.]+\*\*/.test(line) || /^\s*\|\s*\*\*v[0-9.]+/.test(line) || /^\s*\|\s*20[0-9]{2}-[0-9]{2}-[0-9]{2}/.test(line)) continue;
        // 谓词 3（§15 移植）：带前缀限定的非全局声称
        if (/训练|数组|监控|模块|Browser/.test(line.slice(Math.max(0, _idx - 12), _idx))) continue;
        // 谓词 4（§15 移植）：装置面自引用与反例引用
        if (/\bgrep\b|check-version\.sh|check-docs\.sh|FAIL|反例/.test(line)) continue;
        // 谓词 5a（方案 C）：括注形态——claim 后紧跟 ）/) → 表格逐簇分面计数
        if (/[）)]/.test(line.slice(_idx + claim.length, _idx + claim.length + 1))) continue;
        // 谓词 5b（方案 C）：余量短语——claim 前 6 字符内含 其余|剩余 → 减面派生子集
        if (/(其余|剩余)/.test(line.slice(Math.max(0, _idx - 6), _idx))) continue;
        if (n !== regCount) results.push(p + ':' + (i + 1) + ' 声称 ' + n + ' ≠ registry ' + regCount + '（规划中 devlog）｜ ' + line.trim().slice(0, 80));
      }
    });
  }
}
walk('docs/changelog');
console.error('PDL_N=' + planningCount);
console.log(results.length ? results.join('\n') : '');
" 2>/tmp/pdl-reg.log)
PDL_REG_N=$(grep -oE 'PDL_N=[0-9]+' /tmp/pdl-reg.log 2>/dev/null | grep -oE '[0-9]+' || true)
PDL_REG_N=${PDL_REG_N:--1}
if [ "${PDL_REG_N}" -lt 0 ]; then
  CHECKS=$((CHECKS + 1)); echo -e "  ${RED}❌${NC} 规划域解析失败（boundary/package.json 读取异常），对账无法进行"
  ERRORS=$((ERRORS + 1))
elif [ -n "${PDL_SCAN}" ]; then
  CHECKS=$((CHECKS + 1)); echo -e "  ${RED}❌${NC} 规划中（未发版）devlog 工具数声称漂移："
  echo "${PDL_SCAN}" | sed 's/^/    /'
  ERRORS=$((ERRORS + 1))
else
  CHECKS=$((CHECKS + 1)); echo -e "  ${GREEN}✓${NC} ${PDL_REG_N} 个规划中 devlog 工具数声称与 registry 全部一致（逐处对账）"
fi
echo ""

echo "=== 27. 发版状态门禁：tag/npm 已发但活文档仍标待发版（F6 · v1.4.5 T10） ==="
# v1.4.5 (F6)：本地 tag 与 npm registry 任一已达 SSOT 版本 = 「已发版态」。
# 此态下活文档（ROADMAP「现在在哪」节 / 当前版本行）仍写「待发版」即矛盾——
# 发版 SOP 阶段十之后忘改状态会漏出去（v1.4.4 曾靠人工记忆）。
# 历史冻结文档（docs/changelog/vX.Y/ 旧版日志）不在扫描面——只查活文档。
# 已发版态判定与窗口白名单已在 §26 前上移为共用段（F6_RELEASED/F6_WINDOW），此处直接消费。

if $F6_RELEASED; then
  # 待发版窗口白名单（v1.4.8 批次 B）：已发版态 + 下一版开发日志存在 = 合法中间态
  # （下一版开发完成、CHANGELOG 尚未收录、ROADMAP 如实标「开发完成（待发版）」）。
  # 该窗口由 §25 的「CHANGELOG 顶版超前包版本 ≤1 patch」先例背书；F6 原判定只覆盖
  # 「上一版发完、下一版未开发」语境，没跟上此窗口——误报实锤：v1.4.8 devlog 46 项
  # 全勾 + ROADMAP 如实标注被拦。白名单条件（双判据缺一不可）：存在 docs/changelog/vX.Y/
  # 目录（版本号 = SSOT + 1 patch）且目录内 devlog 非空——防「上一版忘翻牌」借窗口逃检。
  # F-14：窗口行级排除（替代整段跳过）——地基期逐版排期使下一版 devlog 几乎恒在位，
  # 窗口恒开 ⇒ 本节两段真扫描自引入起从未执行（E2 残留存活 2 天的根因）。
  _F6_NEXT_VERS="${F6_NEXT_PATCH}"
  for _c in ${F6_NEXT_CANDIDATES:-}; do _F6_NEXT_VERS="${_F6_NEXT_VERS} ${_c}"; done
  if $F6_WINDOW; then
    echo -e "  ${YELLOW}⏭️${NC} 窗口态（F-14）：v${F6_NEXT_PATCH} 开发日志在位——本版已发版面照扫，仅行级排除下一版开发期标注"
    SKIPS=$((SKIPS + 1))
    CHECKS=$((CHECKS + 1))
  else
  F6_PENDING_HITS=$(grep -nE '待发版' "${PROJECT_ROOT}/docs/ROADMAP.md" 2>/dev/null || true)
  if $F6_WINDOW && [ -n "${F6_PENDING_HITS}" ]; then
    F6_PENDING_HITS=$(printf '%s\n' "${F6_PENDING_HITS}" | grep -vE "v(${_F6_NEXT_VERS// /|})" || true)
  fi
  if [ -n "$F6_PENDING_HITS" ]; then
    echo -e "  ${RED}✗${NC} 已发版态（${F6_WHY}）但 ROADMAP.md 仍有「待发版」标注——发版 SOP 阶段十后忘改状态："
    echo "$F6_PENDING_HITS" | head -3 | sed 's/^/      /'
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} 已发版态（${F6_WHY}），ROADMAP 无残留「待发版」标注"
    CHECKS=$((CHECKS + 1))
  fi
  # F6 扩展（v1.4.6 前置 · fresh-eyes P1-1 防复发）：已发版态下，活文档头不得残留
  # 「待发版」状态标记——发版翻转只覆盖「三件套」（WIKI 状态表/ROADMAP/HANDBOOK 速览），
  # v1.4.5 漏 13 份、v1.4.6 又漏 8+2 份（措辞换成「定稿待发版」即双双失守）。扫描面 =
  # docs/ 活文档（排除 changelog/archive——历史日志的「待发版」是当时正确状态，不报）。
  # 设计理由（v1.4.7 批次 B 收口）：措辞变体不可穷举，门禁锚定「待发版」语义三字；
  # 历史日志白名单靠排除 docs/changelog/ 与 docs/archive/ 目录实现，不依赖措辞。
  F6_DOC_PENDING=$(find "${PROJECT_ROOT}/docs" \
    -name '*.md' \
    -not -path '*/changelog/*' \
    -not -path '*/archive/*' \
    -type f -print0 2>/dev/null \
    | xargs -0 grep -lE '待发版' 2>/dev/null || true)
  # F-14 行级排除（-l 形态）：文件内「待发版」行全属下一版开发标注则该文件不算残留
  if $F6_WINDOW && [ -n "$F6_DOC_PENDING" ]; then
    _F6_KEPT=""
    while IFS= read -r _f6f; do
      [ -z "${_f6f}" ] && continue
      if grep -nE '待发版' "${_f6f}" 2>/dev/null | grep -qvE "v(${_F6_NEXT_VERS// /|})"; then
        _F6_KEPT="${_F6_KEPT}${_f6f}$(printf '\n')"
      fi
    done <<< "$F6_DOC_PENDING"
    F6_DOC_PENDING="${_F6_KEPT}"
  fi
  if [ -n "$F6_DOC_PENDING" ]; then
    echo -e "  ${RED}✗${NC} 已发版态（${F6_WHY}）但以下活文档仍含「待发版」字样——发版翻转遗漏（F6 扩展·语义锚定）："
    echo "$F6_DOC_PENDING" | sed "s#^#      #" | head -15
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} 已发版态（${F6_WHY}），活文档无「待发版」残留"
    CHECKS=$((CHECKS + 1))
  fi
  fi
  # F6 子断言（v1.4.7 批次 B：版本头 SSOT 对齐）：活文档「版本头行」的版本号必须等于
  # package.json version。版本头行形态 = 头部 8 行内的 `> v1.4.X · …`（发版状态头）或
  # `> 版本：v1.4.X …`（版本声明头）。只匹配这两种元数据行——正文叙事性的版本引用
  # （如「v1.4.1 块一定稿」「入口接线 v1.4.7 交付」前瞻）不属于发版状态头，不在此断言
  # 范围（误伤叙事是设计缺陷，v1.4.6 API.md「版本：v1.4.5」滞后形态才是本断言要堵的）。
  # 扫描面 = docs/ 活文档（排除 changelog/archive）+ 根级 SECURITY.md/CONTRIBUTING.md
  # + tools/README.md。
  F6_HDR_FILES=$(find "${PROJECT_ROOT}/docs" \
    -name '*.md' \
    -not -path '*/changelog/*' \
    -not -path '*/archive/*' \
    -type f 2>/dev/null; \
    echo "${PROJECT_ROOT}/SECURITY.md"; \
    echo "${PROJECT_ROOT}/CONTRIBUTING.md"; \
    echo "${PROJECT_ROOT}/tools/README.md")
  F6_HDR_MISMATCH=""
  for _f in $F6_HDR_FILES; do
    [ -f "$_f" ] || continue
    _hdr_ver=$(head -8 "$_f" | grep -E "^> *v${SSOT_2SEG}\.[0-9]+ *·|^> *版本[：:] *v${SSOT_2SEG}\.[0-9]+" \
      | grep -oE "v${SSOT_2SEG}\.[0-9]+" | head -1)
    [ -n "$_hdr_ver" ] || continue
    if [ "$_hdr_ver" != "v${SSOT_VERSION}" ]; then
      F6_HDR_MISMATCH="${F6_HDR_MISMATCH}$(basename "$_f"):头标 ${_hdr_ver} ≠ SSOT v${SSOT_VERSION}
"
    fi
  done
  if [ -n "$F6_HDR_MISMATCH" ]; then
    echo -e "  ${RED}✗${NC} 活文档版本头与 SSOT 漂移（F6 子断言·版本头 SSOT 对齐）："
    echo "$F6_HDR_MISMATCH" | sed '/^$/d' | sed "s#^#      #"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} 活文档版本头全部对齐 SSOT v${SSOT_VERSION}"
    CHECKS=$((CHECKS + 1))
  fi
  # 当前版本开发日志头「待发版」残留（docs/changelog/vX.Y/vX.Y.Z.md 头部状态行）——
  # 历史日志的「待发版」是当时正确状态，只有当前 SSOT 版本的日志头需翻转。
  F6_DEVLOG="${PROJECT_ROOT}/docs/changelog/v${SSOT_2SEG}/v${SSOT_VERSION}.md"
  if [ -f "$F6_DEVLOG" ]; then
    if head -10 "$F6_DEVLOG" 2>/dev/null | grep -qE '待发版'; then
      echo -e "  ${RED}✗${NC} 已发版态（${F6_WHY}）但当前版本开发日志头仍标「待发版」：${F6_DEVLOG#"${PROJECT_ROOT}"/}"
      ERRORS=$((ERRORS + 1))
    else
      echo -e "  ${GREEN}✓${NC} 已发版态，当前版本开发日志头无「待发版」残留"
      CHECKS=$((CHECKS + 1))
    fi
  fi
else
  echo -e "  ${GREEN}✓${NC} 开发态（tag/npm 均未达 v${SSOT_VERSION}）——「待发版」标注合法，跳过"
  CHECKS=$((CHECKS + 1))
fi
echo ""

echo "=== 28. 单 minor 补丁位上限（vX.Y.0–vX.Y.9，第 10 个位该开新 minor） ==="
# 背景：版本方案定为「一个 minor 十个位」——vX.Y.0 是主线交付，vX.Y.1–vX.Y.9 是同 minor
# 内的补丁位。旧方案曾把十余个细版塞进同一个 minor（v1.5.2 … v1.5.17），结果是版本号
# 越编越长、语义越来越糊：外部只看到 v1.5.15，读不出它离 v1.5.0 有多远。
# 本断言锚定「补丁段 ≥ 两位数字」= 溢出（vX.Y.10 起），因为一位数才在 0–9 区间内。
#   溢出 → 该开新 minor（vX.(Y+1).0）；**不得**续编 vX.Y.10 —— 补丁位越界会把
#   「第几个补丁」和「第几个 minor」压成同一维度，读者无法从号上判远近。
# 扫描面（只查**版本号本身出现的位置**，不查散文——行文里的「旧 v1.5.10」是撤并溯源，
# 属历史事实而非方案里的版本位，扫进来会把刚做完的收编误判成溢出）:
#   a) docs/ROADMAP.md 各版本表的**版本列**（行首 `| **vX.Y.Z**` 第一格）
#   b) docs/changelog/ 下的版本目录名与日志文件名（vX.Y / vX.Y.Z.md）
# 注：本条与「地基期颗粒度收编」互为见证——旧方案把 v1.5.10–v1.5.17 挤在同一 minor，
# 本条落地时正好报出这 8 个位；收编把对应文件与行删掉后本条转绿。
# 反例按需自查：把 v1.5.10 写进 ROADMAP 版本列即本段报错（下方自检已确证非空网）。
PATCH_OVERFLOW_RE='\bv[0-9]+\.[0-9]+\.[0-9]{2,}\b'
# 自检（正/反例）：v1.5.9 放行、v1.5.10 拦截——防止正则写成永不命中的空网。
_PATCH_SELFTEST=$(printf '%s\n' \
  '| **v1.5.9** | 📋 规划中 |' \
  '| **v1.5.10** | 📋 规划中 |' \
  | grep -Eo "$PATCH_OVERFLOW_RE" || true)
if [ "$_PATCH_SELFTEST" != "v1.5.10" ]; then
  echo -e "  ${RED}✗${NC} 本段自检失败：补丁位溢出正则未按预期命中（v1.5.9 应放行 / v1.5.10 应拦截），实得「${_PATCH_SELFTEST}」——断言失效，先修正则"
  ERRORS=$((ERRORS + 1))
else
  # a) ROADMAP 版本列：锚行首第一格，只取该格里的版本号
  _PATCH_FROM_ROADMAP=$(grep -hoE '^[[:space:]]*\|[[:space:]]*\*\*v[0-9]+\.[0-9]+\.[0-9]+\*\*' \
    "${PROJECT_ROOT}/docs/ROADMAP.md" 2>/dev/null \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || true)
  # b) changelog 目录名/文件名：只取 basename（目录名 vX.Y 无补丁段，自然不参与溢出判定）
  _PATCH_FROM_CHANGELOG=$(find "${PROJECT_ROOT}/docs/changelog" -maxdepth 2 \
    \( -type d -o -type f \) -name 'v[0-9]*' 2>/dev/null \
    | sed 's#.*/##' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || true)
  PATCH_OVERFLOW_HITS=$(printf '%s\n%s\n' "$_PATCH_FROM_ROADMAP" "$_PATCH_FROM_CHANGELOG" \
    | grep -E "$PATCH_OVERFLOW_RE" | sort -uV || true)
  if [ -n "$PATCH_OVERFLOW_HITS" ]; then
    _PATCH_OVERFLOW_N=$(printf '%s\n' "$PATCH_OVERFLOW_HITS" | wc -l | tr -d ' ')
    echo -e "  ${RED}✗${NC} 单 minor 补丁位溢出（上限 vX.Y.9）——${_PATCH_OVERFLOW_N} 处："
    echo "$PATCH_OVERFLOW_HITS" | sed 's/^/      /'
    echo -e "      ${YELLOW}处置：该开新 minor（vX.(Y+1).0），不得续编 vX.Y.10——补丁位越界会把「第几个补丁」"
    echo -e "      ${YELLOW}      与「第几个 minor」压成同一维度，读者无法从版本号判远近${NC}"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} 补丁位全在 vX.Y.0–vX.Y.9 内（ROADMAP 版本列 + changelog 目录/文件名）"
    CHECKS=$((CHECKS + 1))
  fi
fi
echo ""

# ── 覆盖度行（v1.4.9 G-2② · 范式见 tools/check/lib/coverage-line.sh）──
#   asserts = CHECKS + ERRORS（CHECKS 已含 WARN 项——report_warn 同时 ++CHECKS）
#   covered = 仓内 tracked 文件数**上界口径**（本脚本各段扫描面跨 docs/SKILL/engine/根级
#             多目录，无单一文件清单；上界非精确值，此处显式标注，勿当精确计数引用）
#   skipped = 显式降级跳过项（§27 待发版窗口态等）——K>0 不阻断，但必须打印
COVERED=$(git -C "${PROJECT_ROOT}" ls-files 2>/dev/null | wc -l | tr -d ' ')
COVERED=${COVERED:-0}
emit_coverage_line "check-version" "$((CHECKS + ERRORS))" "${COVERED}" "${SKIPS}"

# ── 汇总 ──────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
if [[ ${ERRORS} -eq 0 ]]; then
  TOTAL=$((CHECKS + ERRORS))
  echo -e "${GREEN}${BOLD}  ✓ 全部一致！版本号 = ${SSOT_VERSION}${NC}"
  echo -e "  检查通过: ${CHECKS}/${TOTAL} 项"
  if [[ ${WARNINGS} -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠ ${WARNINGS} 项警告${NC}（--strict 模式会阻断）"
  fi
  if [[ ${SKIPS} -gt 0 ]]; then
    echo -e "  ${YELLOW}⏭️ ${SKIPS} 项降级跳过${NC}（不阻断；发版 SOP「SKIP 数逐条裁决」步骤逐条裁定）"
  fi
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  if [[ "$STRICT" = true ]] && [[ ${WARNINGS} -gt 0 ]]; then
    exit 2
  fi
  exit 0
else
  echo -e "${RED}${BOLD}  ✗ 发现 ${ERRORS} 处不一致！${NC}"
  echo -e "  期望版本: ${SSOT_VERSION} (SSOT: ${SSOT_VERSION})"
  echo -e "  修复: ./tools/release/bump-version.sh <旧版本> ${SSOT_VERSION}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  exit 1
fi
