#!/bin/bash
# ============================================================
# sofagent audit.sh · 审计日志脚本
# ============================================================
# 记录关键操作（install / uninstall / orchestrate / cleanup / record）
# 到 .sofagent/task/audit/YYYY-MM/YYYY-MM-DD.md，追加 Markdown 表格行。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 用法：
#   audit.sh --operation install --target "开始" --result "v0.71, darwin"
#   audit.sh --operation orchestrate --target "重构用户模块" --result "成功, L2, 45s"
#   audit.sh --operation cleanup --target "task/logs/" --result "删除 3 个文件"
#   audit.sh --help
#
# 配置：
#   rules.md audit_enabled: true → 启用（默认关闭）
# ============================================================

set -euo pipefail

VERSION="0.83"

# ── 确定脚本目录 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 加载配置 ──
if [ -f "${SCRIPT_DIR}/lib/config.sh" ]; then
  source "${SCRIPT_DIR}/lib/config.sh"
fi

# ── 参数解析 ──
OPERATION=""
TARGET=""
RESULT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --operation) OPERATION="$2"; shift 2 ;;
    --target)    TARGET="$2"; shift 2 ;;
    --result)    RESULT="$2"; shift 2 ;;
    --version)   echo "sofagent-audit v${VERSION}"; exit 0 ;;
    --help)
      echo "sofagent audit v${VERSION}"
      echo "  记录关键操作到 .sofagent/task/audit/YYYY-MM/YYYY-MM-DD.md"
      echo ""
      echo "  用法:"
      echo "    audit.sh --operation <操作> --target <对象> --result <结果>"
      echo ""
      echo "  参数:"
      echo "    --operation   操作类型（install / uninstall / orchestrate / cleanup / record）"
      echo "    --target      操作对象"
      echo "    --result      操作结果"
      echo ""
      echo "  配置:"
      echo "    rules.md audit_enabled: true → 启用（默认关闭）"
      echo "    audit.sh 自身调用用 || true 兜底，不阻塞主流程"
      exit 0
      ;;
    *) echo "未知参数: $1（--help 查看用法）"; exit 1 ;;
  esac
done

# ── 参数校验 ──
if [ -z "$OPERATION" ]; then
  echo "错误: --operation 为必填参数。--help 查看用法。"
  exit 1
fi

# ── 审计开关检查 ──
# 仅 SOFA_AUDIT_ENABLED=true 时写入，未配置时静默退出
if [ "${SOFA_AUDIT_ENABLED:-}" != "true" ]; then
  exit 0
fi

# ── 采集上下文 ──
UTC_TIME=$(date -u +"%H:%M:%S")
USER_NAME=$(whoami 2>/dev/null || echo "unknown")
HOST_NAME=$(hostname 2>/dev/null || echo "unknown")
LOCAL_DATE=$(date +"%Y-%m-%d")
LOCAL_MONTH=$(date +"%Y-%m")

# ── 路径 ──
SOFAGENT_DATA="${PWD}/.sofagent"
AUDIT_DIR="${SOFAGENT_DATA}/task/audit/${LOCAL_MONTH}"
AUDIT_FILE="${AUDIT_DIR}/${LOCAL_DATE}.md"

# ── 创建目录和文件（如不存在）──
mkdir -p "$AUDIT_DIR"

if [ ! -f "$AUDIT_FILE" ]; then
  cat << HEADER > "$AUDIT_FILE"
# ${LOCAL_DATE} 审计记录

| 时间 (UTC) | 操作 | 对象 | 结果 | 用户 | 主机 | 详情 |
|------------|------|------|------|------|------|------|
HEADER
fi

# ── 追加审计行 ──
# 转义 Markdown 表格中的 | 字符
_escape_pipe() { echo "$1" | sed 's/|/\\|/g'; }

OP_ESC=$(_escape_pipe "$OPERATION")
TARGET_ESC=$(_escape_pipe "${TARGET:--}")
RESULT_ESC=$(_escape_pipe "${RESULT:--}")

cat << ROW >> "$AUDIT_FILE"
| ${UTC_TIME} | ${OP_ESC} | ${TARGET_ESC} | ${RESULT_ESC} | ${USER_NAME} | ${HOST_NAME} | |
ROW
