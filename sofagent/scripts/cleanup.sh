#!/bin/bash
# ============================================================
# sofagent cleanup.sh · 数据保留清理脚本
# ============================================================
# 按保留策略清理 .sofagent/task/logs/ 下的过期日志。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 用法：
#   cleanup.sh                   正常清理（交互确认）
#   cleanup.sh --dry-run         仅预览，不执行删除
#   cleanup.sh --force           跳过确认直接删除
#   cleanup.sh --purge           等同 --force（合规术语：purge = 强制清理）
#   cleanup.sh --before DATE     只清理 DATE 之前的日志（DATE 格式 YYYY-MM-DD）
#   cleanup.sh --help            显示帮助
#   cleanup.sh --version         显示版本
#
# 清理逻辑：
#   1. 按天：删除 mtime 超过保留期的日志文件（或 --before 指定日期之前）
#   2. 按条：条目总数超过上限时从最旧月开始删除
#   3. 归档：删除前先 tar.gz 到 archive/，确认成功后再 rm
#   4. 审计：清理后调用 audit.sh 记录
# ============================================================

# ════════════════════════════════════════
# 调用说明：本脚本通常由 task-record.sh 概率触发（默认 1/10），
# 而非每次任务记录后都执行。此举意在避免每次写入后都做全量磁盘扫描。
# 概率参数由 rules.md 的 data_cleanup_frequency 控制（默认 10）。
# 也可独立运行：cleanup.sh --dry-run / cleanup.sh --force
# ════════════════════════════════════════
set -euo pipefail

VERSION="0.83"

# ── 确定脚本目录 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 加载配置 ──
if [ -f "${SCRIPT_DIR}/lib/config.sh" ]; then
  source "${SCRIPT_DIR}/lib/config.sh"
fi

# ── 参数解析 ──
DRY_RUN=false
FORCE=false
PURGE=false
BEFORE_DATE=""
SHOW_HELP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --force)   FORCE=true; shift ;;
    --purge)   PURGE=true; FORCE=true; shift ;;  # --purge 等同 --force（合规术语）
    --before)
      BEFORE_DATE="$2"
      # 校验日期格式 YYYY-MM-DD
      if ! echo "$BEFORE_DATE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
        echo "[cleanup] 错误：--before 需要日期格式 YYYY-MM-DD（收到：${BEFORE_DATE}）"
        exit 1
      fi
      shift 2
      ;;
    --before=*) BEFORE_DATE="${1#*=}"; FORCE=true; shift ;;
    --version) echo "sofagent-cleanup v${VERSION}"; exit 0 ;;
    --help)    SHOW_HELP=true; shift ;;
    *) echo "未知参数: $1（--help 查看用法）"; exit 1 ;;
  esac
done

if [ "$SHOW_HELP" = true ]; then
  echo "sofagent cleanup v${VERSION}"
  echo "  按保留策略清理 .sofagent/task/logs/ 下的过期日志"
  echo ""
  echo "  用法:"
  echo "    cleanup.sh              正常清理（交互确认）"
  echo "    cleanup.sh --dry-run    仅预览，不执行删除"
  echo "    cleanup.sh --force      跳过确认直接删除"
  echo "    cleanup.sh --purge      等同 --force（合规术语）"
  echo "    cleanup.sh --before DATE  只清理 DATE（YYYY-MM-DD）之前的日志"
  echo "    cleanup.sh --help       显示此帮助"
  echo "    cleanup.sh --version    显示版本"
  echo ""
  echo "  组合示例:"
  echo "    cleanup.sh --purge --before 2026-01-01   强制清理 2026 年之前的日志"
  echo "    cleanup.sh --dry-run --before 2026-06-01 预览清理 6 月之前的日志"
  echo ""
  echo "  配置项（rules.md）："
  echo "    data_retention_days         日志保留天数（默认 90）"
  echo "    data_retention_max_entries   日志最大条数（默认 500）"
  echo "    audit_enabled                审计开关"
  exit 0
fi

# ── 配置默认值 ──
RETENTION_DAYS="${SOFA_RETENTION_DAYS:-90}"
RETENTION_MAX="${SOFA_RETENTION_MAX:-500}"

# ── 路径 ──
LOGS_DIR="${PWD}/.sofagent/task/logs"
ARCHIVE_DIR="${PWD}/.sofagent/task/logs/archive"

# ── glob 安全检查 ──
if [ ! -d "$LOGS_DIR" ]; then
  echo "[cleanup] task/logs/ 目录不存在，无需清理。"
  exit 0
fi

# ── 非交互确认 ──
if [ "$DRY_RUN" = false ] && [ "$FORCE" = false ]; then
  echo "[cleanup] 即将扫描 ${LOGS_DIR} 进行清理。"
  echo "[cleanup] 保留策略: 保留 ${RETENTION_DAYS} 天内日志，最多 ${RETENTION_MAX} 条记录。"
  if [ -n "$BEFORE_DATE" ]; then
    echo "[cleanup] ⚠️ 仅清理 ${BEFORE_DATE} 之前的日志"
  fi
  read -r -p "  确认执行？[y/N] " confirm
  case "$confirm" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "  已取消。"; exit 0 ;;
  esac
fi

# ════════════════════════════════════════
# 1. 按天清理：删除 mtime 超过保留期的日志文件（或 --before 指定日期之前）
# ════════════════════════════════════════
deleted_files=0
deleted_entries=0

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[cleanup] === DRY RUN 预览 ==="
  echo "[cleanup] 保留天数: ${RETENTION_DAYS}"
  [ -n "$BEFORE_DATE" ] && echo "[cleanup] --before 过滤: ${BEFORE_DATE}"
  echo "[cleanup] 扫描目录: ${LOGS_DIR}"
  echo ""
fi

# 收集过期文件列表
# --before 指定日期优先（精准日期过滤），否则按 RETENTION_DAYS 天数过滤
expired_files=()
shopt -s nullglob 2>/dev/null || true
if [ -n "$BEFORE_DATE" ]; then
  # --before 模式：按文件名日期（YYYY-MM/YYYY-MM-DD.md）过滤
  # 文件命名约定：task/logs/YYYY-MM/YYYY-MM-DD.md
  while IFS= read -r -d '' file; do
    expired_files+=("$file")
  done < <(find "$LOGS_DIR" -name "*.md" -not -path "*/archive/*" -print0 2>/dev/null | while IFS= read -r -d '' f; do
    # 提取文件名日期：task/logs/2026-03/2026-03-15.md → 2026-03-15
    fname=$(basename "$f" .md)
    if echo "$fname" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && [[ "$fname" < "$BEFORE_DATE" ]]; then
      printf '%s\0' "$f"
    fi
  done || true)
else
  # 默认模式：按 mtime 过滤
  while IFS= read -r -d '' file; do
    expired_files+=("$file")
  done < <(find "$LOGS_DIR" -name "*.md" -not -path "*/archive/*" -mtime "+${RETENTION_DAYS}" -print0 2>/dev/null || true)
fi
shopt -u nullglob 2>/dev/null || true

if [ ${#expired_files[@]} -gt 0 ]; then
  # 按月份分组（BSD/macOS 兼容：不用 declare -A，bash 3.2 不支持关联数组）
  months=()
  month_dirs=()
  for file in "${expired_files[@]}"; do
    month_dir=$(dirname "$file")
    month=$(basename "$month_dir")
    if [ -d "$month_dir" ]; then
      found=0
      if [ ${#months[@]} -gt 0 ]; then
        for m in "${months[@]}"; do
          [ "$m" = "$month" ] && found=1 && break
        done
      fi
      if [ "$found" -eq 0 ]; then
        months+=("$month")
        month_dirs+=("$month_dir")
      fi
    fi
  done

  for i in "${!months[@]}"; do
    month="${months[$i]}"
    month_dir="${month_dirs[$i]}"
    if [ ! -d "$month_dir" ]; then
      continue
    fi

    file_count=$(ls "$month_dir"/*.md 2>/dev/null | wc -l | tr -d ' ')
    entry_count=$({ grep -ch "^## " "$month_dir"/*.md 2>/dev/null || echo "0"; } | awk '{s+=$1}END{print s+0}')

    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] 将删除 ${month_dir}/ (${file_count} 个文件, ${entry_count} 条记录)"
    else
      echo "[cleanup] 归档并删除月份: ${month} (${file_count} 个文件, ${entry_count} 条记录)"

      # ── 归档：先 tar.gz ──
      mkdir -p "$ARCHIVE_DIR"
      ARCHIVE_FILE="${ARCHIVE_DIR}/${month}.tar.gz"

      if tar -czf "$ARCHIVE_FILE" -C "$LOGS_DIR" "${month}/" 2>/dev/null; then
        # 确认归档文件存在且非空
        if [ -f "$ARCHIVE_FILE" ] && [ -s "$ARCHIVE_FILE" ]; then
          echo "[cleanup]   归档成功: ${ARCHIVE_FILE}"
          # 归档成功 → 删除源文件
          rm -rf "$month_dir"
          echo "[cleanup]   已删除: ${month_dir}/"
          deleted_files=$((deleted_files + file_count))
          deleted_entries=$((deleted_entries + entry_count))
        else
          echo "[cleanup]   归档文件为空，跳过删除: ${month}"
        fi
      else
        echo "[cleanup]   归档失败，保留源文件: ${month}"
      fi
    fi
  done
else
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] 没有超过 ${RETENTION_DAYS} 天的过期文件"
  else
    echo "[cleanup] 没有超过 ${RETENTION_DAYS} 天的过期文件"
  fi
fi

# ════════════════════════════════════════
# 2. 按条清理：条目总数超过上限时从最旧月开始删
# ════════════════════════════════════════
total_entries=0
shopt -s nullglob 2>/dev/null || true
for logfile in "$LOGS_DIR"/*/*.md; do
  [ -f "$logfile" ] || continue
  count=$(grep -c "^## " "$logfile" 2>/dev/null || true)
  total_entries=$((total_entries + count))
done
shopt -u nullglob 2>/dev/null || true

if [ "$total_entries" -gt "$RETENTION_MAX" ]; then
  excess=$((total_entries - RETENTION_MAX))
  echo ""
  if [ "$DRY_RUN" = true ]; then
    echo "[cleanup] 条目总数 ${total_entries} 超过上限 ${RETENTION_MAX}，超出 ${excess} 条"
  else
    echo "[cleanup] 条目总数 ${total_entries} 超过上限 ${RETENTION_MAX}，超出 ${excess} 条，从最旧月开始清理..."
  fi

  # 按月排序（按目录名排序，最旧的先删）
  # 加 `|| true` 防止 set -o pipefail 下 grep 零匹配返回 exit 1 时中断
  sorted_months=()
  while IFS= read -r month_dir; do
    [ -n "$month_dir" ] && sorted_months+=("$month_dir")
  done < <({ ls -1d "$LOGS_DIR"/*/ 2>/dev/null | grep -v '/archive/' | sort || true; })

  to_remove=$excess
  for month_dir in "${sorted_months[@]}"; do
    [ "$to_remove" -le 0 ] && break
    [ -d "$month_dir" ] || continue

    month=$(basename "$month_dir")
    file_count=$(ls "$month_dir"/*.md 2>/dev/null | wc -l | tr -d ' ')
    entry_count=$({ grep -ch "^## " "$month_dir"/*.md 2>/dev/null || echo "0"; } | awk '{s+=$1}END{print s+0}')

    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] 将删除 ${month_dir}/ (${file_count} 个文件, ${entry_count} 条记录)"
    else
      echo "[cleanup] 归档并删除月份: ${month} (条目数: ${entry_count})"

      # ── 归档：先 tar.gz ──
      mkdir -p "$ARCHIVE_DIR"
      ARCHIVE_FILE="${ARCHIVE_DIR}/${month}.tar.gz"

      if tar -czf "$ARCHIVE_FILE" -C "$LOGS_DIR" "${month}/" 2>/dev/null; then
        if [ -f "$ARCHIVE_FILE" ] && [ -s "$ARCHIVE_FILE" ]; then
          echo "[cleanup]   归档成功: ${ARCHIVE_FILE}"
          rm -rf "$month_dir"
          echo "[cleanup]   已删除: ${month_dir}/"
          deleted_files=$((deleted_files + file_count))
          deleted_entries=$((deleted_entries + entry_count))
        else
          echo "[cleanup]   归档文件为空，跳过删除: ${month}"
        fi
      else
        echo "[cleanup]   归档失败，保留源文件: ${month}"
      fi
    fi

    to_remove=$((to_remove - entry_count))
  done
else
  if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "[cleanup] 条目总数 ${total_entries}，未超过上限 ${RETENTION_MAX}"
  fi
fi

# ════════════════════════════════════════
# 3. 清理中间文件（归档失败的残留）
# ════════════════════════════════════════
# 清理空的月份目录
if [ "$DRY_RUN" = false ]; then
  shopt -s nullglob 2>/dev/null || true
  for month_dir in "$LOGS_DIR"/*/; do
    [ -d "$month_dir" ] || continue
    rmdir "$month_dir" 2>/dev/null || true
  done
  shopt -u nullglob 2>/dev/null || true
fi

# ════════════════════════════════════════
# 4. 摘要输出
# ════════════════════════════════════════
echo ""
if [ "$DRY_RUN" = true ]; then
  echo "[cleanup] === DRY RUN 完成 ==="
  echo "[cleanup] 预览中未执行实际删除。添加 --force 执行清理。"
  exit 0
fi

echo "[cleanup] === 清理完成 ==="
echo "[cleanup] 删除文件数: ${deleted_files}"
echo "[cleanup] 删除条目数: ${deleted_entries}"
echo ""

# ════════════════════════════════════════
# 5. 审计记录
# ════════════════════════════════════════
AUDIT_SCRIPT="${SCRIPT_DIR}/audit.sh"
if [ -x "$AUDIT_SCRIPT" ] && [ "$deleted_files" -gt 0 ]; then
  bash "$AUDIT_SCRIPT" \
    --operation "cleanup" \
    --target "task/logs/" \
    --result "成功, 删除 ${deleted_files} 个文件, ${deleted_entries} 条记录" 2>/dev/null || true
fi
