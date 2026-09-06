#!/usr/bin/env bash
# bootstrap.sh · sofagent 一行安装入口（装在企业跑 AI 节点的设备上）
# 纯新增独立入口——install.sh（~1405 行）不动，零回归面。
# 用法：curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.4.5/bootstrap.sh -o bootstrap.sh && bash bootstrap.sh
# 离线：./bootstrap.sh --local /path/to/install.sh
# 透传：curl ... | bash -s -- --base-only
set -euo pipefail
# ERR trap 品牌兜底：崩溃时用户看到产品信息而非裸 bash 报错（v1.3.2 P0-B1/P2-37）
trap 'echo "❌ sofagent bootstrap 失败（exit $?）——请截图此信息到 GitHub Issues（github.com/KongFangXun/sofagent/issues）"' ERR
# v1.3.5 #31: 锁定已发布 tag（refs/tags/v1.4.4）——main 浮动导致装到的版本不可复现；
#   升级时改此 tag 与 README 安装段同步。
INSTALL_URL="https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.4.5/install.sh"
# ════════════════════════════════════════════════════════════════════════
# v1.4.3 P2-f（F-07）：下载完整性校验（curl | bash 信任模型加固）
# install.sh 是将被 bash 直接执行的代码——下载通道（HTTPS 上的 raw.githubusercontent）
# 被劫持即任意代码执行。锁 sha256 后：内容与发版时不一致 → 拒绝执行（fail-closed）。
# ⚠️ 发版同步纪律：每次发新 tag，更新下方 7 个哈希（install.sh + 6 个 lib 文件）
#   计算命令（在新 tag 打好后执行）：
#     git show vX.Y.Z:install.sh | shasum -a 256
#     for f in $LIB_FILES; do git show vX.Y.Z:engine/scripts/lib/$f | shasum -a 256; done
#   发布清单同步提醒：docs/changelog/releasing/ 09-tag.md（tag 发布阶段）
# ════════════════════════════════════════════════════════════════════════
INSTALL_SHA256="8f922724be0cd86f1392d42c3cbe74e339ffa63f553cd71a85ddf67bc0686995"  # v1.4.5 tag:install.sh
# v1.3.8 P0-1 兜底：install.sh 依赖同目录 engine/scripts/lib/ 下 6 个模块——
#   此前 bootstrap 只下载孤立 install.sh，source 立即失败（安装链全断根因）。
#   现在同时下载 lib 全部文件到同目录结构，让 install.sh 的 source 可达。
LIB_BASE_URL="https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.4.5/engine/scripts/lib"
LIB_FILES="platform-detect.sh file-deploy.sh daemon-register.sh post-install.sh daemon-lib.sh config.sh"
# lib 文件 sha256（v1.4.5 tag；与 LIB_FILES 顺序一一对应）
LIB_SHA256S="e1a77f47fd92cbae131e88785079184925dbaf548976bc49d14d5c86e824525a
dfcb89053f57e794d37a47b369eeff225efccdb0453d4a385fb14ccee5e6cdf3
e83cf4dc60d929ed7c085b7d5d93beb37e781fd5085eaa1a138d298eb37933b3
072a39d0590696aad2f456026f8c841d4f4208939ff1a12dce72a346d2d41080
bec93fd676d2524b11abfb44e1ffa4cb6dd536d13e3a05421aebee5c6bcf6fc2
10006c31386b99e1166153b3d03975d3a4c442f5000d849e08f1195efcbefb98"

# sha256 工具兼容（macOS shasum / Linux sha256sum，取输出首段哈希）
_sha256_of() { # $1=文件路径 → stdout 哈希（失败输出空）
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1
  else
    echo ""
  fi
}
# 校验并在不匹配时 fail-closed（exit 1）：被劫持/损坏的安装脚本绝不执行
_verify_or_die() { # $1=文件路径 $2=期望哈希 $3=显示名
  local actual
  actual=$(_sha256_of "$1")
  if [ -z "$actual" ]; then
    echo "❌ [bootstrap] 无法计算 $3 的 sha256（缺 shasum/sha256sum）——fail-closed 拒绝执行"
    exit 1
  fi
  if [ "$actual" != "$2" ]; then
    echo "🔴 [bootstrap] $3 完整性校验失败（sha256 不匹配）——下载内容与发版时不一致，可能被劫持，拒绝执行。"
    echo "   期望: $2"
    echo "   实际: $actual"
    echo "   处置：检查网络/代理，或到 github.com/KongFangXun/sofagent/issues 报告"
    exit 1
  fi
}
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
  # v1.4.3 P2-f：install.sh 完整性校验（下载即校验，校验失败不执行）
  _verify_or_die "$TMP_FILE" "$INSTALL_SHA256" "install.sh"
  echo "✅ install.sh 完整性校验通过（sha256）"
  # v1.3.8 P0-1 兜底：同步下载 lib 依赖（任一失败不静默——lib 缺失会让 install.sh 的
  # 仓库完整性自检触发 clone 自救，但先在这里明示下载异常，避免用户误以为只有 install.sh）
  LIB_TMP_DIR="${TMP_DIR}/engine/scripts/lib"
  mkdir -p "$LIB_TMP_DIR"
  # bash 3.2 兼容：用 set -- 展开列表拿文件个数（不用 declare -A / mapfile）
  set -- $LIB_FILES
  echo "📥 下载运行时依赖 engine/scripts/lib/（$# 个文件）..."
  LIB_FAIL=0
  # bash 3.2 兼容：并行遍历文件名与哈希列表（LIB_SHA256S 按行对应 LIB_FILES 顺序）
  _expected_list="$LIB_SHA256S"
  for _lib in $LIB_FILES; do
    _expected=$(printf '%s\n' "$_expected_list" | head -1)
    _expected_list=$(printf '%s\n' "$_expected_list" | tail -n +2)
    if curl -fsSL "${LIB_BASE_URL}/${_lib}" -o "${LIB_TMP_DIR}/${_lib}"; then
      # v1.4.3 P2-f：lib 文件同样校验（同是可执行载荷）
      _verify_or_die "${LIB_TMP_DIR}/${_lib}" "$_expected" "lib/${_lib}"
    else
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
