#!/usr/bin/env bash
# bootstrap.sh · sofagent 一行安装入口（v1.2.7 · 功能 ⑧）
# 纯新增独立入口——install.sh（~980 行）不动，零回归面。
# 用法：curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/main/bootstrap.sh | bash
# 离线：./bootstrap.sh --local /path/to/install.sh
# 透传：curl ... | bash -s -- --base-only
set -euo pipefail
INSTALL_URL="https://raw.githubusercontent.com/KongFangXun/sofagent/main/install.sh"
LOCAL_PATH=""; PASSTHROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) LOCAL_PATH="$2"; shift 2 ;;
    --help|-h) echo "用法: bootstrap.sh [--local <path>] [--base-only]"; exit 0 ;;
    *) PASSTHROUGH+=("$1"); shift ;;
  esac
done
command -v curl >/dev/null 2>&1 || { echo "❌ curl 未安装"; exit 1; }
TMP_FILE=""
if [[ -n "$LOCAL_PATH" ]]; then
  [[ -f "$LOCAL_PATH" ]] || { echo "❌ 本地 install.sh 不存在: $LOCAL_PATH"; exit 1; }
  SCRIPT="$LOCAL_PATH"
else
  TMP_FILE=$(mktemp /tmp/sofagent-install.XXXXXX.sh)
  echo "📥 下载 install.sh..."
  curl -fsSL "$INSTALL_URL" -o "$TMP_FILE" || { echo "❌ 下载失败（用 --local <path> 指定本地路径）"; rm -f "$TMP_FILE"; exit 1; }
  SCRIPT="$TMP_FILE"
fi
echo "🚀 启动 sofagent 安装..."
bash "$SCRIPT" "${PASSTHROUGH[@]}"
[[ -n "$TMP_FILE" ]] && rm -f "$TMP_FILE"
echo "✅ bootstrap 完成"
