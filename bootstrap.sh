#!/usr/bin/env bash
# bootstrap.sh · sofagent 一行安装入口（装在企业跑 AI 节点的设备上）
# 纯新增独立入口——install.sh（~980 行）不动，零回归面。
# 用法：curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.3.7/bootstrap.sh -o bootstrap.sh && bash bootstrap.sh
# 离线：./bootstrap.sh --local /path/to/install.sh
# 透传：curl ... | bash -s -- --base-only
set -euo pipefail
# ERR trap 品牌兜底：崩溃时用户看到产品信息而非裸 bash 报错（v1.3.2 P0-B1/P2-37）
trap 'echo "❌ sofagent bootstrap 失败（exit $?）——请截图此信息到 GitHub Issues（github.com/KongFangXun/sofagent/issues）"' ERR
# v1.3.5 #31: 锁定已发布 tag（refs/tags/v1.3.7）——main 浮动导致装到的版本不可复现；
#   升级时改此 tag 与 README 安装段同步。
INSTALL_URL="https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.3.7/install.sh"
# v1.3.8 P0-1 兜底：install.sh 依赖同目录 engine/scripts/lib/ 下 6 个模块——
#   此前 bootstrap 只下载孤立 install.sh，source 立即失败（安装链全断根因）。
#   现在同时下载 lib 全部文件到同目录结构，让 install.sh 的 source 可达。
LIB_BASE_URL="https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.3.7/engine/scripts/lib"
LIB_FILES="platform-detect.sh file-deploy.sh daemon-register.sh post-install.sh daemon-lib.sh config.sh"
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
  # 下载到临时目录而非单文件——保持 engine/scripts/lib/ 相对路径结构
  TMP_DIR=$(mktemp -d /tmp/sofagent-bootstrap.XXXXXX)
  TMP_FILE="${TMP_DIR}/install.sh"
  echo "📥 下载 install.sh..."
  curl -fsSL "$INSTALL_URL" -o "$TMP_FILE" || { echo "❌ 下载失败（用 --local <path> 指定本地路径）"; rm -rf "$TMP_DIR"; exit 1; }
  # v1.3.8 P0-1 兜底：同步下载 lib 依赖（任一失败不静默——lib 缺失会让 install.sh 的
  # 仓库完整性自检触发 clone 自救，但先在这里明示下载异常，避免用户误以为只有 install.sh）
  LIB_TMP_DIR="${TMP_DIR}/engine/scripts/lib"
  mkdir -p "$LIB_TMP_DIR"
  # bash 3.2 兼容：用 set -- 展开列表拿文件个数（不用 declare -A / mapfile）
  set -- $LIB_FILES
  echo "📥 下载运行时依赖 engine/scripts/lib/（$# 个文件）..."
  LIB_FAIL=0
  for _lib in $LIB_FILES; do
    if ! curl -fsSL "${LIB_BASE_URL}/${_lib}" -o "${LIB_TMP_DIR}/${_lib}"; then
      LIB_FAIL=1
      echo "⚠️  lib/${_lib} 下载失败（install.sh 将尝试 git clone 自救）"
    fi
  done
  if [ "$LIB_FAIL" = "0" ]; then
    echo "✅ 运行时依赖下载完成"
  fi
  SCRIPT="$TMP_FILE"
fi
echo "🚀 启动 sofagent 安装..."
# v1.3.4 交付 1-E（P0 假绿修复）：`|| INSTALL_RC=$?` 捕获 install.sh 退出码（set -e 下 || 短路
# 不立即退出），失败打 ❌ 透传退出码，只有 exit 0 才打 ✅。bash 3.2 兼容：空数组先判长度再展开。
INSTALL_RC=0
if [ ${#PASSTHROUGH[@]} -gt 0 ]; then
  bash "$SCRIPT" "${PASSTHROUGH[@]}" || INSTALL_RC=$?
else
  bash "$SCRIPT" || INSTALL_RC=$?
fi
# --local 模式 TMP_FILE 为空，set -e 下条件为假会触发 exit 1，改用 if
if [[ -n "$TMP_FILE" ]]; then rm -rf "$TMP_DIR"; fi
if [ "$INSTALL_RC" -ne 0 ]; then
  echo "❌ sofagent 安装失败（exit $INSTALL_RC）——请截图此信息到 GitHub Issues（github.com/KongFangXun/sofagent/issues）"
  exit "$INSTALL_RC"
fi
echo "✅ bootstrap 完成"
