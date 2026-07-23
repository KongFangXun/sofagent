#!/bin/bash
# ============================================================
# sofagent U 盘启动脚本（Linux · bash start.sh 或双击）
# v1.1.8 新增
#
# 与 start.command 同逻辑——调 U 盘自带 Node 便携版启动 daemon
# （USB 便携模式）：验签 → 内存解密 knowledge/ → 便携化 env →
# 联邦在线。零残留：不写 ~/.sofagent / ~/.openclaw。
# ============================================================

set -euo pipefail

cd "$(dirname "$0")"
USB_ROOT="$(pwd)"

NODE_BIN="$USB_ROOT/runtime/node"
CLI_JS="$USB_ROOT/sofagent/daemon/dist/cli.js"

if [ ! -x "$NODE_BIN" ]; then
  echo "❌ 未找到 Node 便携版：$NODE_BIN"
  echo "   请确认 U 盘由 sofagent-daemon create-usb-key 写入且平台为 Linux。"
  exit 1
fi

if [ ! -f "$CLI_JS" ]; then
  echo "❌ 未找到 sofagent daemon：$CLI_JS"
  echo "   U 盘内容可能不完整（验签会 fail-closed 拒绝启动）。"
  exit 1
fi

echo "sofagent U 盘运行时 — 启动中（USB 根：$USB_ROOT）"
echo "停止：Ctrl+C；拔盘前请先停止。"
echo ""

exec "$NODE_BIN" "$CLI_JS" start --usb-root "$USB_ROOT"
