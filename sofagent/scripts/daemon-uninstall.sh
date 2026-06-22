#!/bin/bash
# ============================================================
# sofagent daemon-uninstall.sh · daemon 卸载脚本 · v0.83
# ============================================================
# 停止 daemon、移除系统服务注册、删除脚本文件。
# 不删 daemon.json / daemon.log / .sofagent 用户数据。
#
# 用法：bash daemon-uninstall.sh
# ============================================================

set -euo pipefail
VERSION="0.83"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_DIR="$REPO_ROOT/sofagent/scripts"
OS="$(uname -s)"

echo "卸载 sofagent daemon..."

# ── 停止 daemon ──
if [ -x "$TARGET_DIR/daemon.sh" ]; then
  "$TARGET_DIR/daemon.sh" stop 2>/dev/null || true
fi

# ── 移除系统服务注册 ──
case "$OS" in
  Darwin)
    PLIST_FILE="$HOME/Library/LaunchAgents/com.sofagent.daemon.plist"
    if [ -f "$PLIST_FILE" ]; then
      launchctl unload "$PLIST_FILE" 2>/dev/null || true
      rm -f "$PLIST_FILE"
      echo "已移除 launchd 服务: $PLIST_FILE"
    fi
    ;;
  Linux)
    SERVICE_FILE="$HOME/.config/systemd/user/sofagent-daemon.service"
    if [ -f "$SERVICE_FILE" ]; then
      systemctl --user stop sofagent-daemon.service 2>/dev/null || true
      systemctl --user disable sofagent-daemon.service 2>/dev/null || true
      rm -f "$SERVICE_FILE"
      systemctl --user daemon-reload 2>/dev/null || true
      echo "已移除 systemd 服务: $SERVICE_FILE"
    fi
    ;;
esac

# ── 清理脚本文件 ──
rm -f "$TARGET_DIR/daemon.sh"
rm -f "$TARGET_DIR/lib/daemon-lib.sh"
echo "已移除 daemon 脚本"

# 不移除 daemon.json / daemon.log / .sofagent 用户数据
echo "daemon.json / daemon.log 等用户数据已保留在 .sofagent/ 中"
echo ""
echo "✅ daemon 已卸载。"
