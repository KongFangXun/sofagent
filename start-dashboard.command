#!/bin/bash
# ─────────────────────────────────────────────
# sofagent Dashboard 一键启动（双击本文件）
# 等价命令：node tools/serve-dashboard.mjs
# 启动后自动打开浏览器 → http://localhost:3780
# 关闭本窗口 = 关闭服务器
# ─────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未找到 node，请先安装 Node.js（https://nodejs.org）"
  echo ""
  echo "按回车关闭窗口..."
  read -r
  exit 1
fi

echo "🚀 启动 sofagent Dashboard..."
echo ""
node tools/serve-dashboard.mjs

echo ""
echo "服务器已停止。按回车关闭窗口..."
read -r
