#!/usr/bin/env bash
# ============================================================
# bump-version.sh · 一键升级全项目版本号
# ============================================================
# 用法: ./tools/bump-version.sh <旧版本> <新版本> [--dry-run]
#   ./tools/bump-version.sh 0.94 0.95          # 实际替换
#   ./tools/bump-version.sh 0.94 0.95 --dry-run # 只打印，不修改
#
# 版本号格式: 2 段（如 0.94），package.json 自动补 3 段（0.94.0）
#
# ⚠️ 不支持 patch 级版本号变更（如 0.99.3 → 0.99.4）。
#    只支持 major.minor → major.minor 替换（如 0.99 → 1.0）。
#    patch bump 需手工执行以下步骤：
#      1. vi sofagent/audit/package.json          # 改 version 字段
#      2. vi sofagent/audit/src/index.ts           # 改 v0.99.3 → v0.99.4
#      3. vi sofagent/scripts/*.sh                 # 改 VERSION="0.99.3"
#      4. vi sofagent/scripts/windows/*.ps1        # 改 $VERSION = "0.99.3"
#      5. vi ROADMAP.md                             # 改文件头 > v0.99.3 ·
#      6. vi ARCHITECTURE.md                        # 改文件头 > v0.99.3 ·
#      7. vi HANDBOOK.md                            # 改文件头 > v0.99.3 ·
#      8. vi README.md README.en.md                 # 改 badge Version-v0.99.3
#      9. vi sofagent/skill/SKILL.md                # 改 frontmatter + 正文标题
#     10. vi sofagent/skill/data/*.md               # 改正文标题 · v0.99.3
#     11. vi FDE/SKILL.md                           # 改 frontmatter
#     12. 跑 ./tools/check-version.sh 确认一致性
#
# 替换范围（结构性位置，不碰历史引用）:
#   1. .ts 文件:  const VERSION = 'OLD'
#   2. .sh 文件:  VERSION="OLD"
#   3. .ps1 文件: $VERSION = "OLD" 或 $VERSION_STR = "OLD"
#   4. index.ts:  vOLD（仅 sofagent/audit/src/index.ts）
#   5. MD 文件头: > vOLD（排除 docs/changelog/）
#   6. README badge: version-OLD
#   7. SKILL.md frontmatter: version: OLD（及 3 段格式 OLD.0）
#   8. package.json version 字段: OLD.0 → NEW.0
#   9. SKILL.md 正文标题: # · vOLD
#  10. MD 尾部署名: *vOLD，日期*
#
# 不处理: docs/changelog/ 目录下任何文件
#
# BSD sed 兼容: 不用 sed -i，用 sed > tmp && mv tmp
# ============================================================

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── 参数检查 ──────────────────────────────────────────────────
DRY_RUN=false
if [[ "${3:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if [[ $# -lt 2 ]] || [[ $# -gt 3 ]]; then
  echo -e "${RED}用法:${NC} $0 <旧版本> <新版本> [--dry-run]"
  echo -e "  例: $0 0.94 0.95"
  echo -e "  例: $0 0.94 0.95 --dry-run"
  exit 1
fi

OLD_VERSION="$1"
NEW_VERSION="$2"

# 验证版本号格式（2 段或 3 段，数字+点号）
for v in "$OLD_VERSION" "$NEW_VERSION"; do
  if ! echo "$v" | grep -qE '^[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
    echo -e "${RED}错误:${NC} 版本号格式无效: '$v'（期望如 0.94 或 0.94.0）"
    exit 1
  fi
done

# 提取 2 段版本号（去掉可能的第 3 段）
OLD_2SEG=$(echo "$OLD_VERSION" | cut -d. -f1-2)
NEW_2SEG=$(echo "$NEW_VERSION" | cut -d. -f1-2)

# 3 段版本号（从实际 package.json 读取，而非 .0 补零）
# 注意：根 package.json 无 version 字段（workspaces 根），SSOT 在 sofagent/audit/package.json

# 用于实际文件替换的模式——优先 3 段精确匹配
# 这是因为大多数文件中的版本号是 3 段格式（如 VERSION="0.99.3"），
# 而 MD 头 / SKILL frontmatter 固定用 2 段格式（如 > v0.99 · / version: 0.99）
if [[ "$OLD_VERSION" == *.*.* ]]; then
  HAS_PATCH=true
else
  HAS_PATCH=false
fi

# ── 项目根目录（脚本在 tools/ 下，根在上一级）──────────────
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 从实际 SSOT 读取 3 段版本号（audit/package.json），而非 .0 补零
PJ_SSOT="${PROJECT_ROOT}/sofagent/audit/package.json"
OLD_3SEG=$(grep '"version":' "${PJ_SSOT}" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
# NEW_3SEG: 新版本是 3 段时直接用用户输入；2 段时用 new_2seg + old_patch
if [[ "$NEW_VERSION" == *.*.* ]]; then
  NEW_3SEG="$NEW_VERSION"
else
  NEW_3SEG="${NEW_2SEG}.$(echo "${OLD_3SEG}" | cut -d. -f3)"
fi

# 2 段相同但 3 段不同（如同一个 major.minor 内的小版本升级，如 0.99.3→0.99.4）——只做 3 段替换
if $HAS_PATCH && [[ "$OLD_2SEG" == "$NEW_2SEG" ]] && [[ "$OLD_3SEG" != "$NEW_3SEG" ]]; then
  PATCH_ONLY=true
else
  PATCH_ONLY=false
fi
# 如果旧版本是 2 段格式，新版本也保持 2 段 + .0
if [[ "${OLD_VERSION}" != *.*.* ]]; then
  NEW_3SEG="${NEW_2SEG}.0"
fi

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  bump-version${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  ${BOLD}项目:${NC}     $PROJECT_ROOT"
echo -e "  ${BOLD}旧版本:${NC}   ${OLD_2SEG} (package.json: ${OLD_3SEG})"
echo -e "  ${BOLD}新版本:${NC}   ${NEW_2SEG} (package.json: ${NEW_3SEG})"
if $DRY_RUN; then
  echo -e "  ${YELLOW}模式:${NC}     DRY-RUN（只打印，不修改）${NC}"
else
  echo -e "  ${GREEN}模式:${NC}     实际替换${NC}"
fi
echo ""

# ── 统计变量 ──────────────────────────────────────────────────
TOTAL_CHANGED=0

# ── 替换辅助函数（BSD sed 兼容，SC2001 无警告）─────────────────
# sed_inplace_replace <文件> <旧字符串> <新字符串> <描述>
# 使用 sed 直接读文件（非 echo | sed），避免 SC2001
sed_inplace_replace() {
  local file="$1"
  local old_str="$2"
  local new_str="$3"
  local desc="$4"

  [[ -f "$file" ]] || return 0

  local content new_content
  content=$(cat "$file")
  new_content=$(sed "s|${old_str}|${new_str}|g" "$file")

  if [[ "$new_content" != "$content" ]]; then
    echo -e "  ${GREEN}✓${NC} $desc"
    echo -e "    ${CYAN}$file${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$new_content" > "$file"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
}

# ── 文件清单打印 ──────────────────────────────────────────────
echo -e "${BOLD}── 将要修改的文件 ──${NC}"
echo ""

# 1. package.json version 字段（SSOT，3 段格式）
echo -e "${BOLD}[1/13] package.json（SSOT）${NC}"
PJ="$PROJECT_ROOT/sofagent/audit/package.json"
if [[ -f "$PJ" ]]; then
  pj_content=$(cat "$PJ")
  if $PATCH_ONLY; then
    pj_new=$(sed "s/\"version\": \"$OLD_3SEG\"/\"version\": \"$NEW_3SEG\"/g" "$PJ")
  else
    pj_new=$(sed "s/\"version\": \"$OLD_3SEG\"/\"version\": \"$NEW_3SEG\"/g" "$PJ")
    # 如果 3 段没匹配到，试 2 段格式
    if [[ "$pj_new" == "$pj_content" ]]; then
      pj_new=$(sed "s/\"version\": \"$OLD_2SEG\"/\"version\": \"$NEW_2SEG\"/g" "$PJ")
    fi
  fi
  if [[ "$pj_new" != "$pj_content" ]]; then
    echo -e "  ${GREEN}✓${NC} version: $OLD_3SEG → $NEW_3SEG"
    echo -e "    ${CYAN}$PJ${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$pj_new" > "$PJ"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
fi
echo ""

# 1b. mcp/package.json version 字段
echo -e "${BOLD}[2/13] mcp/package.json${NC}"
MCP_PJ="$PROJECT_ROOT/sofagent/mcp/package.json"
if [[ -f "$MCP_PJ" ]]; then
  mcp_content=$(cat "$MCP_PJ")
  mcp_new=$(sed "s/\"version\": \"$OLD_3SEG\"/\"version\": \"$NEW_3SEG\"/g" "$MCP_PJ")
  if [[ "$mcp_new" == "$mcp_content" ]]; then
    mcp_new=$(sed "s/\"version\": \"$OLD_2SEG\"/\"version\": \"$NEW_2SEG\"/g" "$MCP_PJ")
  fi
  if [[ "$mcp_new" != "$mcp_content" ]]; then
    echo -e "  ${GREEN}✓${NC} mcp version: $OLD_3SEG → $NEW_3SEG"
    echo -e "    ${CYAN}$MCP_PJ${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$mcp_new" > "$MCP_PJ"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
fi
echo ""

# 1c. FDE/package.json + LOOP/package.json version 字段
echo -e "${BOLD}[2b/13] FDE/package.json + LOOP/package.json${NC}"
for pkg_file in "$PROJECT_ROOT/FDE/package.json" "$PROJECT_ROOT/LOOP/package.json"; do
  if [[ -f "$pkg_file" ]]; then
    pkg_content=$(cat "$pkg_file")
    pkg_new=$(sed "s/\"version\": \"$OLD_3SEG\"/\"version\": \"$NEW_3SEG\"/g" "$pkg_file")
    if [[ "$pkg_new" == "$pkg_content" ]]; then
      pkg_new=$(sed "s/\"version\": \"$OLD_2SEG\"/\"version\": \"$NEW_2SEG\"/g" "$pkg_file")
    fi
    if [[ "$pkg_new" != "$pkg_content" ]]; then
      echo -e "  ${GREEN}✓${NC} $(basename "$(dirname "$pkg_file")") version: $OLD_3SEG → $NEW_3SEG"
      echo -e "    ${CYAN}$pkg_file${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$pkg_new" > "$pkg_file"
      fi
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  fi
done
echo ""

# 2. .ts 文件: const VERSION = 'OLD'（动态扫描，不硬编码文件列表）
echo -e "${BOLD}[3/13] TypeScript 常量${NC}"
ts_count=0
while IFS= read -r ts; do
  [[ -f "$ts" ]] || continue
  ts_content=$(cat "$ts")
  if $PATCH_ONLY; then
    ts_new=$(sed "s/const VERSION = '$OLD_3SEG'/const VERSION = '$NEW_3SEG'/g" "$ts")
  else
    ts_new=$(sed "s/const VERSION = '$OLD_2SEG'/const VERSION = '$NEW_2SEG'/g" "$ts")
    # 2 段没匹配到，试 3 段格式
    if $HAS_PATCH && [[ "$ts_new" == "$ts_content" ]]; then
      ts_new=$(sed "s/const VERSION = '$OLD_3SEG'/const VERSION = '$NEW_3SEG'/g" "$ts")
    fi
  fi
  if [[ "$ts_new" != "$ts_content" ]]; then
    if [[ $ts_count -eq 0 ]]; then
      echo -e "  ${GREEN}✓${NC} const VERSION = '$OLD_2SEG' → '$NEW_2SEG'"
    fi
    echo -e "    ${CYAN}$ts${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$ts_new" > "$ts"
    fi
    ts_count=$((ts_count + 1))
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done < <(grep -rl "const VERSION = '" \
  --include='*.ts' \
  "$PROJECT_ROOT/sofagent/audit/src/" \
  2>/dev/null || true)
if [[ $ts_count -eq 0 ]]; then
  echo -e "  ${YELLOW}（无匹配——可能已是 $NEW_2SEG 或 audit/src/ 下无 const VERSION）${NC}"
fi
echo ""

# 2b. .ts 文件头注释中的 vX.Y.Z（匹配注释行，与 check-version [11/12] 检测范围对齐）
echo -e "${BOLD}[4/13] TS 文件头注释版本号${NC}"
ts_header_count=0
while IFS= read -r ts; do
  [[ -f "$ts" ]] || continue
  [[ "$ts" == */_archive/* ]] && continue
  [[ "$ts" == *.test.ts ]] && continue
  [[ "$ts" == */dist/* ]] && continue
  # 只处理文件头前 10 行的注释（文件头版本号声明区域）
  ts_head=$(head -10 "$ts")
  ts_rest=$(tail -n +11 "$ts")
  ts_head_new=$(echo "$ts_head" | sed \
    -e "s/v${OLD_3SEG}/v${NEW_3SEG}/g" \
    -e "s/v${OLD_2SEG}\([^0-9.]\)/v${NEW_2SEG}\1/g")
  if [[ "$ts_head_new" != "$ts_head" ]]; then
    echo -e "  ${GREEN}✓${NC} 文件头注释: v$OLD_3SEG → v$NEW_3SEG"
    echo -e "    ${CYAN}$ts${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$ts_head_new" > "$ts"
      printf '%s\n' "$ts_rest" >> "$ts"
    fi
    ts_header_count=$((ts_header_count + 1))
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done < <(find "$PROJECT_ROOT/sofagent" \
  -name '*.ts' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/_archive/*' \
  -type f 2>/dev/null || true)
if [[ $ts_header_count -eq 0 ]]; then
  echo -e "  ${YELLOW}（无匹配——可能已是 $NEW_3SEG）${NC}"
fi
echo ""

# 3. index.ts: vOLD → vNEW（仅 index.ts 这一个文件）
echo -e "${BOLD}[5/13] index.ts 版本引用${NC}"
INDEX_TS="$PROJECT_ROOT/sofagent/audit/src/index.ts"
if [[ -f "$INDEX_TS" ]]; then
  idx_content=$(cat "$INDEX_TS")
  # 替换 vOLD 为 vNEW（注意不能误伤 vOLDx 这种）
  if $PATCH_ONLY; then
    idx_new=$(sed "s/v$OLD_3SEG/v$NEW_3SEG/g" "$INDEX_TS")
  else
    idx_new=$(sed "s/v$OLD_2SEG/v$NEW_2SEG/g" "$INDEX_TS")
    # 2 段没匹配到，试 3 段格式
    if $HAS_PATCH && [[ "$idx_new" == "$idx_content" ]]; then
      idx_new=$(sed "s/v$OLD_3SEG/v$NEW_3SEG/g" "$INDEX_TS")
    fi
  fi
  if [[ "$idx_new" != "$idx_content" ]]; then
    echo -e "  ${GREEN}✓${NC} v$OLD_2SEG → v$NEW_2SEG"
    echo -e "    ${CYAN}$INDEX_TS${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$idx_new" > "$INDEX_TS"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
fi
echo ""

# 4. .sh 文件: VERSION="OLD"
echo -e "${BOLD}[6/13] Shell 脚本${NC}"
SH_DIR="$PROJECT_ROOT/sofagent/scripts"
FDE_SH="$PROJECT_ROOT/FDE/fde-install.sh"
if [[ -d "$SH_DIR" ]] || [[ -f "$FDE_SH" ]]; then
  sh_count=0
  # 收集 scripts/*.sh + FDE/fde-install.sh
  sh_files=()
  if [[ -d "$SH_DIR" ]]; then
    for sh in "$SH_DIR"/*.sh; do
      [[ -f "$sh" ]] && sh_files+=("$sh")
    done
  fi
  [[ -f "$FDE_SH" ]] && sh_files+=("$FDE_SH")

  for sh in "${sh_files[@]}"; do
    sh_content=$(cat "$sh")
    if $PATCH_ONLY; then
      sh_new=$(sed "s/VERSION=\"$OLD_3SEG\"/VERSION=\"$NEW_3SEG\"/g" "$sh")
    else
      sh_new=$(sed "s/VERSION=\"$OLD_2SEG\"/VERSION=\"$NEW_2SEG\"/g" "$sh")
      # 2 段没匹配到，试 3 段格式
      if $HAS_PATCH && [[ "$sh_new" == "$sh_content" ]]; then
        sh_new=$(sed "s/VERSION=\"$OLD_3SEG\"/VERSION=\"$NEW_3SEG\"/g" "$sh")
      fi
    fi
    # 额外：替换文件头注释中的版本号格式
    # 格式 1: （vX.Y.Z）全角括号
    # 格式 2: · vX.Y.Z 中圆点（daemon 脚本等用此格式）
    sh_new=$(echo "$sh_new" | sed \
      -e "s/（v${OLD_3SEG}）/（v${NEW_3SEG}）/g" \
      -e "s/（v${OLD_2SEG}）/（v${NEW_2SEG}）/g" \
      -e "s/· v${OLD_3SEG}/· v${NEW_3SEG}/g" \
      -e "s/· v${OLD_2SEG}\([^0-9.]\)/· v${NEW_2SEG}\1/g")
    if [[ "$sh_new" != "$sh_content" ]]; then
      if [[ $sh_count -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} VERSION=\"$OLD_2SEG\" → VERSION=\"$NEW_2SEG\""
      fi
      echo -e "    ${CYAN}$sh${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$sh_new" > "$sh"
      fi
      sh_count=$((sh_count + 1))
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  done
fi
echo ""

# 5. .ps1 文件: $VERSION 或 $VERSION_STR = "OLD"
echo -e "${BOLD}[7/13] PowerShell 脚本${NC}"
PS1_DIR="$PROJECT_ROOT/sofagent/scripts/windows"
if [[ -d "$PS1_DIR" ]]; then
  ps1_count=0
  for ps1 in "$PS1_DIR"/*.ps1; do
    [[ -f "$ps1" ]] || continue
    ps1_content=$(cat "$ps1")
    if $PATCH_ONLY; then
      ps1_new=$(sed -E "s/\\\$VERSION(_STR)? = \"$OLD_3SEG\"/\$VERSION\1 = \"$NEW_3SEG\"/g" "$ps1")
    else
      ps1_new=$(sed -E "s/\\\$VERSION(_STR)? = \"$OLD_2SEG\"/\$VERSION\1 = \"$NEW_2SEG\"/g" "$ps1")
      # 2 段没匹配到，试 3 段格式
      if $HAS_PATCH && [[ "$ps1_new" == "$ps1_content" ]]; then
        ps1_new=$(sed -E "s/\\\$VERSION(_STR)? = \"$OLD_3SEG\"/\$VERSION\1 = \"$NEW_3SEG\"/g" "$ps1")
      fi
    fi
    if [[ "$ps1_new" != "$ps1_content" ]]; then
      if [[ $ps1_count -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} \$VERSION[_STR]? = \"$OLD_2SEG\" → \"$NEW_2SEG\""
      fi
      echo -e "    ${CYAN}$ps1${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$ps1_new" > "$ps1"
      fi
      ps1_count=$((ps1_count + 1))
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  done
fi
echo ""

# 6. MD 文件头: > vOLD · → > vNEW ·（排除 docs/changelog/）
echo -e "${BOLD}[8/13] Markdown 文件头（排除 docs/changelog/）${NC}"
md_count=0
# 收集所有 MD 文件（排除 docs/changelog/, node_modules/, .git/, dist/）
while IFS= read -r md; do
  md_content=$(cat "$md")
  # 用 sed 管道一次处理，全部从文件读取，避免 heredoc 和 Unicode 编码问题
  # 先匹配 3 段格式（> v0.99.3 ·），再匹配 2 段格式（> v0.99 ·）
  md_new=$(sed \
    -e "s/^> v${OLD_3SEG} · /> v${NEW_3SEG} · /g" \
    -e "s/^> v${OLD_2SEG} · /> v${NEW_2SEG} · /g" \
    -e "s/^> v${OLD_3SEG}·/> v${NEW_3SEG}·/g" \
    -e "s/^> v${OLD_2SEG}·/> v${NEW_2SEG}·/g" \
    -e "s/^> > v${OLD_3SEG} · /> > v${NEW_3SEG} · /g" \
    -e "s/^> > v${OLD_2SEG} · /> > v${NEW_2SEG} · /g" \
    -e "s/^> > v${OLD_3SEG}·/> > v${NEW_3SEG}·/g" \
    -e "s/^> > v${OLD_2SEG}·/> > v${NEW_2SEG}·/g" \
    -e "s/· v${OLD_3SEG}/· v${NEW_3SEG}/g" \
    -e "s/· v${OLD_2SEG}/· v${NEW_2SEG}/g" \
    "$md")
  # ROADMAP「现在在哪」节标题单独处理
  md_new=$(echo "$md_new" | sed \
    -e "s/^## 现在在哪：v${OLD_3SEG}/## 现在在哪：v${NEW_3SEG}/g" \
    -e "s/^## 现在在哪：v${OLD_2SEG}/## 现在在哪：v${NEW_2SEG}/g")
  # SECURITY.md 状态标注单独处理（支持 2 段和 3 段格式）
  md_new=$(echo "$md_new" | sed \
    -e "s/\*\*当前状态（v${OLD_3SEG}）\*\*/\*\*当前状态（v${NEW_3SEG}）\*\*/g" \
    -e "s/\*\*当前状态（v${OLD_2SEG}）\*\*/\*\*当前状态（v${NEW_2SEG}）\*\*/g")
  if [[ "$md_new" != "$md_content" ]]; then
    echo -e "  ${GREEN}✓${NC} > v$OLD_2SEG · → > v$NEW_2SEG ·"
    echo -e "    ${CYAN}$md${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$md_new" > "$md"
    fi
    md_count=$((md_count + 1))
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done < <(find "$PROJECT_ROOT" \
  -name '*.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/docs/changelog/*' \
  -type f)
echo -e "  ${YELLOW}已扫描 $md_count 个 MD 文件有匹配${NC}"
echo ""

# 7. README badge: version-OLD → version-NEW（兼容 v 前缀有无）
echo -e "${BOLD}[9/13] README badge${NC}"
for readme in \
  "$PROJECT_ROOT/README.md" \
  "$PROJECT_ROOT/README.en.md"; do
  [[ -f "$readme" ]] || continue
  readme_content=$(cat "$readme")
  # 匹配 version-v0.94、Version-v0.94、version-0.94 三种格式
  readme_new=$(sed -E \
    -e "s/ersion-v${OLD_3SEG}/ersion-v${NEW_3SEG}/g" \
    -e "s/ersion-v${OLD_2SEG}/ersion-v${NEW_2SEG}/g" \
    -e "s/ersion-${OLD_3SEG}/ersion-${NEW_3SEG}/g" \
    -e "s/ersion-${OLD_2SEG}/ersion-${NEW_2SEG}/g" \
    "$readme")
  if [[ "$readme_new" != "$readme_content" ]]; then
    echo -e "  ${GREEN}✓${NC} version-(v?)$OLD_2SEG → version-v$NEW_2SEG"
    echo -e "    ${CYAN}$readme${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$readme_new" > "$readme"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done
echo ""

# 8. index.html hero badge version
echo -e "${BOLD}[10/13] index.html hero badge${NC}"
# index.html 是 landing page，不含版本号标签——此步骤为设计预期的无匹配
# 如果未来 index.html 加了版本号标签，此步骤会自动替换
index_html="$PROJECT_ROOT/index.html"
if [[ -f "$index_html" ]]; then
  html_content=$(cat "$index_html")
  search_2=">v$OLD_2SEG<" replace_2=">v$NEW_2SEG<"
  search_3=">v$OLD_3SEG<" replace_3=">v$NEW_3SEG<"
  html_new=$(cat "$index_html")
  html_new="${html_new//$search_2/$replace_2}"
  html_new="${html_new//$search_3/$replace_3}"
  if [[ "$html_new" != "$html_content" ]]; then
    echo -e "  ${GREEN}✓${NC} hero badge: v$OLD_2SEG → v$NEW_2SEG"
    echo -e "    ${CYAN}$index_html${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$html_new" > "$index_html"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  else
    echo -e "  ${YELLOW}没有匹配到 v$OLD_2SEG 或 v$OLD_3SEG${NC}"
  fi
else
  echo -e "  ${YELLOW}跳过（文件不存在）${NC}"
fi
echo ""

# 9. SKILL.md frontmatter: version: OLD → version: NEW（含 3 段格式）+ 正文标题
echo -e "${BOLD}[11/13] SKILL.md frontmatter + 正文标题${NC}"
skill_count=0
while IFS= read -r skill; do
  skill_content=$(cat "$skill")
  # frontmatter 2 段格式: version: 0.94
  skill_new=$(sed "s/^version: $OLD_2SEG$/version: $NEW_2SEG/g" "$skill")
  # frontmatter 3 段格式: version: 0.94.0（需正则锚点，无法用 bash 原生替换）
  # shellcheck disable=SC2001
  skill_new=$(sed "s/^version: $OLD_3SEG$/version: $NEW_3SEG/g" <<< "$skill_new")
  # 正文标题: # SKILL.md · v0.94（需全局替换含 · 前缀）
  # shellcheck disable=SC2001
  skill_new=$(sed "s/· v$OLD_2SEG/· v$NEW_2SEG/g" <<< "$skill_new")
  if [[ "$skill_new" != "$skill_content" ]]; then
    echo -e "  ${GREEN}✓${NC} version/frontmatter: $OLD_2SEG → $NEW_2SEG"
    echo -e "    ${CYAN}$skill${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$skill_new" > "$skill"
    fi
    skill_count=$((skill_count + 1))
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done < <(find "$PROJECT_ROOT" \
  -name 'SKILL.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -type f)
echo ""

# 9. MD tail signature: > *vOLD,date* -> > *vNEW,date* (blockquote italic)
echo -e "${BOLD}[12/13] MD tail signature (> *vOLD...*)${NC}"
sig_count=0
while IFS= read -r md; do
  md_content=$(cat "$md")
  # Only match "> *v0.94" or "> *v0.94.3" at start of line (signature format)
  md_new=$(sed \
    -e "s/^> \*v${OLD_3SEG}/> \*v${NEW_3SEG}/g" \
    -e "s/^> \*v${OLD_2SEG}/> \*v${NEW_2SEG}/g" \
    "$md")
  if [[ "$md_new" != "$md_content" ]]; then
    echo -e "  ${GREEN}✓${NC} > *v$OLD_2SEG -> > *v$NEW_2SEG"
    echo -e "    ${CYAN}$md${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$md_new" > "$md"
    fi
    sig_count=$((sig_count + 1))
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done < <(find "$PROJECT_ROOT" \
  -name '*.md' \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/docs/changelog/*' \
  -type f)
if [[ $sig_count -eq 0 ]]; then
  echo -e "  ${YELLOW}(no match)${NC}"
fi
echo ""

# 9b. v1.1.3: bump 子包 package.json 中 @sofagent/* 依赖版本
# 各包的 dependencies/optionalDependencies 中对其他 @sofagent/* 包的引用也需要同步
BUMP_INTERNAL_DEPS_COUNT=0
while IFS= read -r -d '' pkg_json; do
  CHANGED=false
  NEW_CONTENT=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$pkg_json', 'utf-8'));
    let changed = false;
    for (const field of ['dependencies', 'optionalDependencies']) {
      if (pkg[field]) {
        for (const [name, ver] of Object.entries(pkg[field])) {
          if (name.startsWith('@sofagent/')) {
            // 检查版本是否匹配旧版本（精确匹配或 3 段匹配）
            const ver_2seg = ver.replace(/\.[^.]+$/, '');  // 去掉 patch
            if (ver_2seg === '$OLD_2SEG' || ver === '$OLD_2SEG.0' || ver === '$OLD_VERSION') {
              // 保持原有的语义（如果有 ^ 前缀就保留）
              const prefix = ver.match(/^[~^>=<]+/) || '';
              pkg[field][name] = prefix ? prefix[0] + '$NEW_2SEG.0' : '$NEW_VERSION';
              changed = true;
            }
          }
        }
      }
    }
    if (changed) {
      fs.writeFileSync('$pkg_json', JSON.stringify(pkg, null, 2) + '\n');
      console.log('CHANGED');
    }
  ")
  if [ "$NEW_CONTENT" = "CHANGED" ]; then
    BUMP_INTERNAL_DEPS_COUNT=$((BUMP_INTERNAL_DEPS_COUNT + 1))
    echo -e "  ${GREEN}✓${NC} $pkg_json (内部依赖已同步)"
  fi
done < <(find "$SCRIPT_DIR/../sofagent" -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" -print0 2>/dev/null)
TOTAL_CHANGED=$((TOTAL_CHANGED + BUMP_INTERNAL_DEPS_COUNT))

# 10. 汇总
echo -e "${BOLD}[13/13] 完成${NC}"
echo ""

# ── 汇总 ──────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
if $DRY_RUN; then
  echo -e "${YELLOW}  DRY-RUN 完成: 发现 $TOTAL_CHANGED 处可替换${NC}"
  echo -e "  如需实际替换，去掉 --dry-run 参数"
else
  if [[ $TOTAL_CHANGED -eq 0 ]]; then
    echo -e "${YELLOW}  无文件需要修改（版本号可能已经是 ${NEW_2SEG}）${NC}"
  else
    echo -e "${GREEN}  ✓ 完成: 共修改 $TOTAL_CHANGED 处${NC}"
    echo -e "  建议运行 ${CYAN}./tools/check-version.sh${NC} 确认一致性"
  fi
fi
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"

# ── 手动检查提醒（v1.0 新增，bump-version 盲区防护）────────
if ! $DRY_RUN; then
  echo ""
  echo -e "  ${YELLOW}⚠️  手动检查提醒（bump-version.sh 只改版本号，不碰正文叙事）：${NC}"
  echo "    1. ROADMAP.md「现在在哪」段落的叙事内容是否已更新为新版本？"
  echo "    2. ROADMAP.md「现在在哪」的开发日志链接是否指向新版本？"
  echo "    3. CHANGELOG.md 是否已新增新版本的索引条目？"
  echo "    4. ROADMAP.md 迭代历程表是否已新增新版本行？"
  echo ""
fi
