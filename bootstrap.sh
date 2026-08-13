#!/usr/bin/env bash
# bootstrap.sh · sofagent 一行安装入口（装在企业跑 AI 节点的设备上）
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
# v1.3.4 交付 1-E（P0）：捕获 install.sh 退出码——假绿修复
# 原 bug：即使 install.sh 失败（非 0 退出），bootstrap.sh 也无条件打印「✅ bootstrap 完成」
# 修复：用 `|| INSTALL_RC=$?` 捕获退出码（set -e 下 || 短路使其不立即退出），
#       只有成功路径才打印「✅ bootstrap 完成」
INSTALL_RC=0
# bash 3.2 兼容：set -u 下空数组展开会报 unbound variable，先判长度再展开
if [ ${#PASSTHROUGH[@]} -gt 0 ]; then
  bash "$SCRIPT" "${PASSTHROUGH[@]}" || INSTALL_RC=$?
else
  bash "$SCRIPT" || INSTALL_RC=$?
fi

# set -e 安全：--local 模式下 TMP_FILE 为空，条件为假会触发 exit 1，改用 if
if [[ -n "$TMP_FILE" ]]; then rm -f "$TMP_FILE"; fi

# 交付 1-E：只在 install.sh 成功（exit 0）时打印完成消息
if [ "$INSTALL_RC" -ne 0 ]; then
  echo "❌ sofagent 安装失败（exit $INSTALL_RC）——请截图此信息到 GitHub Issues（github.com/KongFangXun/sofagent/issues）"
  exit "$INSTALL_RC"
fi
echo "✅ bootstrap 完成"
