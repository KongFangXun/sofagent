#!/usr/bin/env bash
# ============================================================
# bump-version.sh · 一键升级全项目版本号
# ============================================================
# 用法: ./scripts/bump-version.sh <旧版本> <新版本> [--dry-run]
#   ./scripts/bump-version.sh 0.94 0.95          # 实际替换
#   ./scripts/bump-version.sh 0.94 0.95 --dry-run # 只打印，不修改
#
# 版本号格式: 2 段（如 0.94），package.json 自动补 3 段（0.94.0）
#
# 替换范围（结构性位置，不碰历史引用）:
#   1. .ts 文件:  const VERSION = 'OLD'
#   2. .sh 文件:  VERSION="OLD"
#   3. .ps1 文件: $VERSION = "OLD" 或 $VERSION_STR = "OLD"
#   4. index.ts:  vOLD（仅 sofagent-audit/src/index.ts）
#   5. MD 文件头: > vOLD（排除 docs/changelog/）
#   6. README badge: version-vOLD
#   7. SKILL.md frontmatter: version: OLD（及 3 段格式 OLD.0）
#   8. package.json version 字段: OLD.0 → NEW.0
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

# 3 段版本号（补零）
OLD_3SEG="${OLD_2SEG}.0"
NEW_3SEG="${NEW_2SEG}.0"

# ── 项目根目录（脚本在 scripts/ 下，根在上一级）──────────────
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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

# ── 替换辅助函数（BSD sed 兼容）────────────────────────────────
# 用法: do_replace <文件> <sed表达式> <描述>
do_replace() {
  local file="$1"
  local pattern="$2"
  local desc="$3"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  # 检查是否匹配
  if ! grep -qF "$(echo "$pattern" | sed 's/.*s\///;s/\///;s/\$.*//')" "$file" 2>/dev/null; then
    # 上面的 grep 过于脆弱，直接用 sed 检查
    :
  fi

  # 用 sed 替换并检查是否有变化
  local content
  content=$(sed "$pattern" "$file")

  if [[ "$content" != "$(cat "$file")" ]]; then
    echo -e "  ${GREEN}✓${NC} $desc"
    echo -e "    ${CYAN}$file${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$content" > "$file"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
}

# ── 文件清单打印 ──────────────────────────────────────────────
echo -e "${BOLD}── 将要修改的文件 ──${NC}"
echo ""

# 1. package.json version 字段（SSOT，3 段格式）
echo -e "${BOLD}[1/8] package.json（SSOT）${NC}"
for pj in "$PROJECT_ROOT/sofagent-audit/package.json"; do
  if [[ -f "$pj" ]]; then
    local_content=$(cat "$pj")
    local_new=$(echo "$local_content" | sed "s/\"version\": \"$OLD_3SEG\"/\"version\": \"$NEW_3SEG\"/g")
    # 如果 3 段没匹配到，试 2 段格式
    if [[ "$local_new" == "$local_content" ]]; then
      local_new=$(echo "$local_content" | sed "s/\"version\": \"$OLD_2SEG\"/\"version\": \"$NEW_2SEG\"/g")
    fi
    if [[ "$local_new" != "$local_content" ]]; then
      echo -e "  ${GREEN}✓${NC} version: $OLD_3SEG → $NEW_3SEG"
      echo -e "    ${CYAN}$pj${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$local_new" > "$pj"
      fi
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  fi
done
echo ""

# 2. .ts 文件: const VERSION = 'OLD'
echo -e "${BOLD}[2/8] TypeScript 常量${NC}"
for ts in \
  "$PROJECT_ROOT/sofagent-audit/src/verify-evidence.ts" \
  "$PROJECT_ROOT/sofagent-audit/src/skill-safety-check.ts"; do
  if [[ -f "$ts" ]]; then
    local_content=$(cat "$ts")
    local_new=$(echo "$local_content" | sed "s/const VERSION = '$OLD_2SEG'/const VERSION = '$NEW_2SEG'/g")
    if [[ "$local_new" != "$local_content" ]]; then
      echo -e "  ${GREEN}✓${NC} const VERSION = '$OLD_2SEG' → '$NEW_2SEG'"
      echo -e "    ${CYAN}$ts${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$local_new" > "$ts"
      fi
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  fi
done
echo ""

# 3. index.ts: vOLD → vNEW（仅 index.ts 这一个文件）
echo -e "${BOLD}[3/8] index.ts 版本引用${NC}"
INDEX_TS="$PROJECT_ROOT/sofagent-audit/src/index.ts"
if [[ -f "$INDEX_TS" ]]; then
  local_content=$(cat "$INDEX_TS")
  # 替换 vOLD 为 vNEW（注意不能误伤 vOLDx 这种）
  local_new=$(echo "$local_content" | sed "s/v$OLD_2SEG/v$NEW_2SEG/g")
  if [[ "$local_new" != "$local_content" ]]; then
    echo -e "  ${GREEN}✓${NC} v$OLD_2SEG → v$NEW_2SEG"
    echo -e "    ${CYAN}$INDEX_TS${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$local_new" > "$INDEX_TS"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
fi
echo ""

# 4. .sh 文件: VERSION="OLD"
echo -e "${BOLD}[4/8] Shell 脚本${NC}"
SH_DIR="$PROJECT_ROOT/sofagent/scripts"
if [[ -d "$SH_DIR" ]]; then
  sh_count=0
  for sh in "$SH_DIR"/*.sh; do
    [[ -f "$sh" ]] || continue
    local_content=$(cat "$sh")
    local_new=$(echo "$local_content" | sed "s/VERSION=\"$OLD_2SEG\"/VERSION=\"$NEW_2SEG\"/g")
    if [[ "$local_new" != "$local_content" ]]; then
      if [[ $sh_count -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} VERSION=\"$OLD_2SEG\" → VERSION=\"$NEW_2SEG\""
      fi
      echo -e "    ${CYAN}$sh${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$local_new" > "$sh"
      fi
      sh_count=$((sh_count + 1))
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  done
fi
echo ""

# 5. .ps1 文件: $VERSION 或 $VERSION_STR = "OLD"
echo -e "${BOLD}[5/8] PowerShell 脚本${NC}"
PS1_DIR="$PROJECT_ROOT/sofagent/scripts/windows"
if [[ -d "$PS1_DIR" ]]; then
  ps1_count=0
  for ps1 in "$PS1_DIR"/*.ps1; do
    [[ -f "$ps1" ]] || continue
    local_content=$(cat "$ps1")
    # 覆盖 $VERSION 和 $VERSION_STR 两种变量名
    local_new=$(echo "$local_content" | sed -E "s/\\\$VERSION(_STR)? = \"$OLD_2SEG\"/\$VERSION\1 = \"$NEW_2SEG\"/g")
    if [[ "$local_new" != "$local_content" ]]; then
      if [[ $ps1_count -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} \$VERSION[_STR]? = \"$OLD_2SEG\" → \"$NEW_2SEG\""
      fi
      echo -e "    ${CYAN}$ps1${NC}"
      if ! $DRY_RUN; then
        printf '%s\n' "$local_new" > "$ps1"
      fi
      ps1_count=$((ps1_count + 1))
      TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
    fi
  done
fi
echo ""

# 6. MD 文件头: > vOLD → > vNEW（排除 docs/changelog/）
echo -e "${BOLD}[6/8] Markdown 文件头（排除 docs/changelog/）${NC}"
md_count=0
# 收集所有 MD 文件（排除 docs/changelog/, node_modules/, .git/, dist/）
while IFS= read -r md; do
  local_content=$(cat "$md")
  # 只替换版本头格式 "> vOLD · "（带 · 分隔符），避免误改叙述正文
  local_new=$(echo "$local_content" | sed "s/^> v$OLD_2SEG · /> v$NEW_2SEG · /g")
  if [[ "$local_new" != "$local_content" ]]; then
    echo -e "  ${GREEN}✓${NC} > v$OLD_2SEG · → > v$NEW_2SEG ·"
    echo -e "    ${CYAN}$md${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$local_new" > "$md"
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

# 7. README badge: version-vOLD → version-vNEW
echo -e "${BOLD}[7/8] README badge${NC}"
for readme in \
  "$PROJECT_ROOT/README.md" \
  "$PROJECT_ROOT/README.en.md"; do
  [[ -f "$readme" ]] || continue
  local_content=$(cat "$readme")
  local_new=$(echo "$local_content" | sed "s/version-v$OLD_2SEG/version-v$NEW_2SEG/g")
  if [[ "$local_new" != "$local_content" ]]; then
    echo -e "  ${GREEN}✓${NC} version-v$OLD_2SEG → version-v$NEW_2SEG"
    echo -e "    ${CYAN}$readme${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$local_new" > "$readme"
    fi
    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
  fi
done
echo ""

# 8. SKILL.md frontmatter: version: OLD → version: NEW（含 3 段格式）
echo -e "${BOLD}[8/8] SKILL.md frontmatter${NC}"
skill_count=0
while IFS= read -r skill; do
  local_content=$(cat "$skill")
  # 尝试 2 段格式: version: 0.94
  local_new=$(echo "$local_content" | sed "s/^version: $OLD_2SEG$/version: $NEW_2SEG/g")
  # 尝试 3 段格式: version: 0.94.0
  local_new=$(echo "$local_new" | sed "s/^version: $OLD_3SEG$/version: $NEW_3SEG/g")
  if [[ "$local_new" != "$local_content" ]]; then
    echo -e "  ${GREEN}✓${NC} version: $OLD_2SEG → version: $NEW_2SEG"
    echo -e "    ${CYAN}$skill${NC}"
    if ! $DRY_RUN; then
      printf '%s\n' "$local_new" > "$skill"
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
    echo -e "  建议运行 ${CYAN}./scripts/check-version.sh${NC} 确认一致性"
  fi
fi
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
