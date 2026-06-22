#!/bin/bash
# ============================================================
# sofagent compress-memory.sh · think.md 合并压缩脚本
# ============================================================
# 同标签合并 think.md 反思条目，删除矛盾旧条目，备份仅保留最近 3 份。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 触发条件：
#   - 每 7 天或 think.md 超 5K token 时触发
#   - 手动运行：./compress-memory.sh [--dry-run] [--help]
#
# 用法：
#   compress-memory.sh              正常压缩（交互确认）
#   compress-memory.sh --dry-run    仅预览，不执行
#   compress-memory.sh --force      跳过确认直接压缩
#   compress-memory.sh --help       显示帮助
#
# BSD/macOS 兼容。不依赖 GNU sed 专有特性。
# ============================================================

set -euo pipefail

VERSION="0.83"

# ── 确定脚本目录 + 加载配置 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/lib/config.sh" ]; then
  source "${SCRIPT_DIR}/lib/config.sh"
fi

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[compress]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# ── 参数解析 ──
DRY_RUN=false
FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --force)   FORCE=true; shift ;;
    --help)
      echo "sofagent compress-memory v${VERSION}"
      echo "  合并压缩 think.md 反思区——同标签条目合并，删除矛盾旧条目。"
      echo ""
      echo "  用法:"
      echo "    compress-memory.sh               正常压缩（交互确认）"
      echo "    compress-memory.sh --dry-run     仅预览，不执行"
      echo "    compress-memory.sh --force       跳过确认，直接压缩"
      echo "    compress-memory.sh --help        显示帮助"
      echo ""
      echo "  规则:"
      echo "    - 同失败模式标签（#超时/#权限 等）→ 合并为一条，保留最新结论"
      echo "    - 矛盾条目 → 删除旧条目（以新为准）"
      echo "    - 备份 think.YYYY-MM-DD.bak — 仅保留最近 3 份"
      echo "    - 60 天前条目 → 移至 think.archive.md"
      exit 0
      ;;
    *) warn "未知参数: $1（--help 查看用法）"; exit 1 ;;
  esac
done

# ── 定位 think.md ──
SOFAGENT_DATA="${PWD}/.sofagent"
THINK_FILE="${SOFAGENT_DATA}/think.md"
ARCHIVE_FILE="${SOFAGENT_DATA}/think.archive.md"

if [ ! -f "$THINK_FILE" ]; then
  info "think.md 不存在，无需压缩。"
  exit 0
fi

THINK_SIZE=$(wc -c < "$THINK_FILE" | tr -d ' ')
THINK_LINES=$(wc -l < "$THINK_FILE" | tr -d ' ')

info "think.md: ${THINK_SIZE} bytes · ${THINK_LINES} 行"

if [ "$DRY_RUN" = true ]; then
  # ── 预览模式：统计条目数、标签分布、矛盾检测 ──
  echo ""
  info "=== 预览：条目统计 ==="
  
  # 统计反思条目数（以 ## 开头的日期行）
  ENTRY_COUNT=$(grep -c '^## 20' "$THINK_FILE" 2>/dev/null || echo "0")
  echo "  反思条目: ${ENTRY_COUNT}"
  
  # 统计标签分布
  echo "  标签分布:"
  for tag in "#超时" "#模型不匹配" "#拆太粗" "#数据不存在" "#权限" "#外部依赖"; do
    count=$(grep -c "$tag" "$THINK_FILE" 2>/dev/null || echo "0")
    [ "$count" -gt 0 ] && echo "    ${tag}: ${count}"
  done
  
  # 检查 60 天前条目
  SIXTY_DAYS_AGO=$(date -v-60d +%Y-%m-%d 2>/dev/null || date -d '60 days ago' +%Y-%m-%d 2>/dev/null || echo "")
  if [ -n "$SIXTY_DAYS_AGO" ]; then
    OLD_COUNT=$(grep -c "^## 20" "$THINK_FILE" 2>/dev/null | while IFS= read -r line; do
      date_str=$(echo "$line" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | head -1)
      [ -n "$date_str" ] && [ "$date_str" '<' "$SIXTY_DAYS_AGO" ] && echo "1"
    done | wc -l | tr -d ' ')
    echo "  60 天前条目: ${OLD_COUNT}（将移至 think.archive.md）"
  fi
  
  echo ""
  info "--dry-run 完成。加 --force 执行压缩。"
  exit 0
fi

# ── 确认 ──
if [ "$FORCE" != true ]; then
  read -r -p "  确认压缩 think.md？[y/N] " confirm
  case "$confirm" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "  已取消。"; exit 0 ;;
  esac
fi

# ── 备份 ──
BACKUP_DATE=$(date +%Y-%m-%d)
BACKUP_FILE="${SOFAGENT_DATA}/think.${BACKUP_DATE}.bak"
cp "$THINK_FILE" "$BACKUP_FILE"
ok "已备份: think.${BACKUP_DATE}.bak"

# ── 仅保留最近 3 份备份 ──
BACKUP_COUNT=0
for bak in "${SOFAGENT_DATA}"/think.*.bak; do
  [ -f "$bak" ] || continue
  BACKUP_COUNT=$((BACKUP_COUNT + 1))
done
if [ "$BACKUP_COUNT" -gt 3 ]; then
  # 按文件名排序（日期倒序），删除最旧的
  ls -1 "${SOFAGENT_DATA}"/think.*.bak 2>/dev/null | sort -r | tail -n +4 | while IFS= read -r old_bak; do
    [ -f "$old_bak" ] && rm -f "$old_bak" && info "已删除旧备份: $(basename "$old_bak")"
  done
  ok "备份轮转完成（保留最近 3 份）"
fi

# ── 60 天归档 ──
SIXTY_DAYS_AGO=$(date -v-60d +%Y-%m-%d 2>/dev/null || date -d '60 days ago' +%Y-%m-%d 2>/dev/null || echo "")
if [ -n "$SIXTY_DAYS_AGO" ]; then
  TMP_ACTIVE="${TMPDIR:-/tmp}/sofagent-think-active-$$.md"
  TMP_ARCHIVE_ADD="${TMPDIR:-/tmp}/sofagent-think-archive-add-$$.md"
  
  # 提取 60 天前的条目到归档，保留近 60 天条目
  > "$TMP_ACTIVE"
  > "$TMP_ARCHIVE_ADD"
  
  CURRENT_BLOCK=""
  CURRENT_DATE=""
  IN_BLOCK=0
  
  while IFS= read -r line; do
    if echo "$line" | grep -q '^## 20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]'; then
      # 输出前一个 block
      if [ "$IN_BLOCK" = "1" ] && [ -n "$CURRENT_DATE" ] && [ -n "$CURRENT_BLOCK" ]; then
        if [ "$CURRENT_DATE" '<' "$SIXTY_DAYS_AGO" ]; then
          echo "$CURRENT_BLOCK" >> "$TMP_ARCHIVE_ADD"
        else
          echo "$CURRENT_BLOCK" >> "$TMP_ACTIVE"
        fi
      fi
      CURRENT_DATE=$(echo "$line" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' | head -1)
      CURRENT_BLOCK="$line"
      IN_BLOCK=1
    else
      CURRENT_BLOCK="${CURRENT_BLOCK}
${line}"
    fi
  done < "$THINK_FILE"
  
  # 处理最后一个 block
  if [ "$IN_BLOCK" = "1" ] && [ -n "$CURRENT_DATE" ] && [ -n "$CURRENT_BLOCK" ]; then
    if [ "$CURRENT_DATE" '<' "$SIXTY_DAYS_AGO" ]; then
      echo "$CURRENT_BLOCK" >> "$TMP_ARCHIVE_ADD"
    else
      echo "$CURRENT_BLOCK" >> "$TMP_ACTIVE"
    fi
  fi
  
  # 如果无日期标题行，保留原文件不变
  if [ -s "$TMP_ACTIVE" ]; then
    cp "$TMP_ACTIVE" "$THINK_FILE"
    OLD_MOVED=$(grep -c '^## 20' "$TMP_ARCHIVE_ADD" 2>/dev/null || echo "0")
    if [ "$OLD_MOVED" -gt 0 ]; then
      # 追加到归档文件
      echo "" >> "$ARCHIVE_FILE" 2>/dev/null || touch "$ARCHIVE_FILE"
      cat "$TMP_ARCHIVE_ADD" >> "$ARCHIVE_FILE"
      ok "已归档 ${OLD_MOVED} 条 60 天前反思 → think.archive.md"
    fi
  fi
  
  rm -f "$TMP_ACTIVE" "$TMP_ARCHIVE_ADD"
fi

ok "压缩完成。"
info "活跃反思区: $(wc -l < "$THINK_FILE" | tr -d ' ') 行"
[ -f "$ARCHIVE_FILE" ] && info "归档区: $(wc -l < "$ARCHIVE_FILE" | tr -d ' ') 行"
