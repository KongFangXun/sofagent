#!/usr/bin/env bash
# bootstrap.sh · sofagent 一行安装入口（v1.3.2 · 功能 ⑧）
# 纯新增独立入口——install.sh（~980 行）不动，零回归面。
# 用法：curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/main/bootstrap.sh | bash
# 离线：./bootstrap.sh --local /path/to/install.sh
# 透传：curl ... | bash -s -- --base-only
set -euo pipefail
# ERR trap 品牌兜底：崩溃时用户看到产品信息而非裸 bash 报错（v1.3.2 P0-B1/P2-37）
trap 'echo "❌ sofagent bootstrap 失败（exit $?）——请截图此信息到 GitHub Issues（github.com/KongFangXun/sofagent/issues）"' ERR
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
# bash 3.2 兼容：set -u 下空数组展开会报 unbound variable，先判长度再展开
if [ ${#PASSTHROUGH[@]} -gt 0 ]; then
  bash "$SCRIPT" "${PASSTHROUGH[@]}"
else
  bash "$SCRIPT"
fi
# set -e 安全：--local 模式下 TMP_FILE 为空，条件为假会触发 exit 1，改用 if
if [[ -n "$TMP_FILE" ]]; then rm -f "$TMP_FILE"; fi
echo "✅ bootstrap 完成"
