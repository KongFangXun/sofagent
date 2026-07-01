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

# ── 项目根目录（脚本在 tools/ 下，根在上一级）──────────────
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 从实际 SSOT 读取 3 段版本号（audit/package.json），而非 .0 补零
PJ_SSOT="${PROJECT_ROOT}/sofagent/audit/package.json"
OLD_3SEG=$(grep '"version":' "${PJ_SSOT}" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
NEW_3SEG="${NEW_2SEG}.$(echo "${OLD_3SEG}" | cut -d. -f3)"
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
echo -e "${BOLD}[1/10] package.json（SSOT）${NC}"
PJ="$PROJECT_ROOT/sofagent/audit/package.json"
if [[ -f "$PJ" ]]; then
  pj_content=$(cat "$PJ")
  pj_new=$(sed "s/\"version\": \"$OLD_3SEG\"/\"version\": \"$NEW_3SEG\"/g" "$PJ")
  # 如果 3 段没匹配到，试 2 段格式
  if [[ "$pj_new" == "$pj_content" ]]; then
    pj_new=$(sed "s/\"version\": \"$OLD_2SEG\"/\"version\": \"$NEW_2SEG\"/g" "$PJ")
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

# 2. .ts 文件: const VERSION = 'OLD'（动态扫描，不硬编码文件列表）
echo -e "${BOLD}[2/10] TypeScript 常量${NC}"
ts_count=0
while IFS= read -r ts; do
  [[ -f "$ts" ]] || continue
  ts_content=$(cat "$ts")
  ts_new=$(sed "s/const VERSION = '$OLD_2SEG'/const VERSION = '$NEW_2SEG'/g" "$ts")
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
done < <(grep -rl "const VERSION = '$OLD_2SEG'" \
  --include='*.ts' \
  "$PROJECT_ROOT/sofagent/audit/src/" \
  2>/dev/null || true)
if [[ $ts_count -eq 0 ]]; then
  echo -e "  ${YELLOW}（无匹配——可能已是 $NEW_2SEG 或 audit/src/ 下无 const VERSION）${NC}"
fi
echo ""

# 3. index.ts: vOLD → vNEW（仅 index.ts 这一个文件）
echo -e "${BOLD}[3/10] index.ts 版本引用${NC}"
INDEX_TS="$PROJECT_ROOT/sofagent/audit/src/index.ts"
if [[ -f "$INDEX_TS" ]]; then
  idx_content=$(cat "$INDEX_TS")
  # 替换 vOLD 为 vNEW（注意不能误伤 vOLDx 这种）
  idx_new=$(sed "s/v$OLD_2SEG/v$NEW_2SEG/g" "$INDEX_TS")
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
echo -e "${BOLD}[4/10] Shell 脚本${NC}"
SH_DIR="$PROJECT_ROOT/sofagent/scripts"
if [[ -d "$SH_DIR" ]]; then
  sh_count=0
  for sh in "$SH_DIR"/*.sh; do
    [[ -f "$sh" ]] || continue
    sh_content=$(cat "$sh")
    sh_new=$(sed "s/VERSION=\"$OLD_2SEG\"/VERSION=\"$NEW_2SEG\"/g" "$sh")
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
echo -e "${BOLD}[5/10] PowerShell 脚本${NC}"
PS1_DIR="$PROJECT_ROOT/sofagent/scripts/windows"
if [[ -d "$PS1_DIR" ]]; then
  ps1_count=0
  for ps1 in "$PS1_DIR"/*.ps1; do
    [[ -f "$ps1" ]] || continue
    ps1_content=$(cat "$ps1")
    # 覆盖 $VERSION 和 $VERSION_STR 两种变量名
    ps1_new=$(sed -E "s/\\\$VERSION(_STR)? = \"$OLD_2SEG\"/\$VERSION\1 = \"$NEW_2SEG\"/g" "$ps1")
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
echo -e "${BOLD}[6/10] Markdown 文件头（排除 docs/changelog/）${NC}"
md_count=0
# 收集所有 MD 文件（排除 docs/changelog/, node_modules/, .git/, dist/）
while IFS= read -r md; do
  md_content=$(cat "$md")
  # 用 sed 管道一次处理，全部从文件读取，避免 heredoc 和 Unicode 编码问题
  md_new=$(sed \
    -e "s/^> v${OLD_2SEG} · /> v${NEW_2SEG} · /g" \
    -e "s/^> > v${OLD_2SEG} · /> > v${NEW_2SEG} · /g" \
    -e "s/· v${OLD_2SEG}/· v${NEW_2SEG}/g" \
    "$md")
  # SECURITY.md 状态标注单独处理
  md_new=$(echo "$md_new" | sed "s/\*\*当前状态（v${OLD_2SEG}）\*\*/\*\*当前状态（v${NEW_2SEG}）\*\*/g")
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
echo -e "${BOLD}[7/10] README badge${NC}"
for readme in \
  "$PROJECT_ROOT/README.md" \
  "$PROJECT_ROOT/README.en.md"; do
  [[ -f "$readme" ]] || continue
  readme_content=$(cat "$readme")
  # 匹配 version-v0.94 和 version-0.94 两种格式
  readme_new=$(sed -E "s/version-v?$OLD_2SEG/version-v$NEW_2SEG/g" "$readme")
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

# 8. SKILL.md frontmatter: version: OLD → version: NEW（含 3 段格式）+ 正文标题
echo -e "${BOLD}[8/10] SKILL.md frontmatter + 正文标题${NC}"
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
echo -e "${BOLD}[9/10] MD tail signature (> *vOLD...*)${NC}"
sig_count=0
while IFS= read -r md; do
  md_content=$(cat "$md")
  # Only match "> *v0.94" at start of line (signature format)
  md_new=$(sed "s/^> \*v$OLD_2SEG/> \*v$NEW_2SEG/g" "$md")
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

# 10. 汇总
echo -e "${BOLD}[10/10] 完成${NC}"
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
