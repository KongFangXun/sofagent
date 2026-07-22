#!/bin/bash
# ============================================================
# sofagent U 盘启动脚本（macOS · 双击 .command）
# v1.1.8 新增
#
# 由 create-usb-key 复制到 U 盘根目录。双击后：
#   1. cd 到 U 盘根（脚本所在目录）
#   2. 调 U 盘自带的 Node 便携版启动 daemon（USB 便携模式）
#   3. daemon 验签 → 内存解密 knowledge/ → 设置便携化 env → 联邦在线
#
# 零残留：所有路径相对 U 盘根，不写 ~/.sofagent / ~/.openclaw。
# 停止：关闭终端窗口或 Ctrl+C，拔掉 U 盘前请先停止 daemon。
# ============================================================

set -euo pipefail

# 切到脚本所在目录（U 盘根）——路径可能含空格，必须引号包裹
cd "$(dirname "$0")"
USB_ROOT="$(pwd)"

NODE_BIN="$USB_ROOT/runtime/node"
CLI_JS="$USB_ROOT/sofagent/daemon/dist/cli.js"

if [ ! -x "$NODE_BIN" ]; then
  echo "❌ 未找到 Node 便携版：$NODE_BIN"
  echo "   请确认 U 盘由 sofagent-daemon create-usb-key 写入且平台为 macOS。"
  read -r -p "按回车退出..."
  exit 1
fi

if [ ! -f "$CLI_JS" ]; then
  echo "❌ 未找到 sofagent daemon：$CLI_JS"
  echo "   U 盘内容可能不完整（验签会 fail-closed 拒绝启动）。"
  read -r -p "按回车退出..."
  exit 1
fi

echo "sofagent U 盘运行时 — 启动中（USB 根：$USB_ROOT）"
echo "停止：Ctrl+C 或关闭本窗口；拔盘前请先停止。"
echo ""

# --usb-root 指向 U 盘根：daemon 走 startUsbRuntime 便携路径
exec "$NODE_BIN" "$CLI_JS" start --usb-root "$USB_ROOT"
