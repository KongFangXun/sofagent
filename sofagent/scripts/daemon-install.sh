#!/bin/bash
# ============================================================
# sofagent daemon-install.sh · daemon 安装脚本 · v0.83
# ============================================================
# 部署 daemon.sh + daemon-lib.sh，注册系统服务（launchd/systemd）。
# macOS: launchd plist → ~/Library/LaunchAgents/
# Linux: systemd user service → ~/.config/systemd/user/
# 其他: 提示跳过
#
# 用法：bash daemon-install.sh
# ============================================================

set -euo pipefail
VERSION="0.83"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_DIR="$REPO_ROOT/sofagent/scripts"

# ── 部署脚本 ──
echo "部署 daemon 脚本..."
mkdir -p "$TARGET_DIR/lib"
cp "$SCRIPT_DIR/daemon.sh" "$TARGET_DIR/daemon.sh" 2>/dev/null || true
cp "$SCRIPT_DIR/lib/daemon-lib.sh" "$TARGET_DIR/lib/daemon-lib.sh" 2>/dev/null || true
chmod +x "$TARGET_DIR/daemon.sh" 2>/dev/null || true

# ── 检测系统 ──
OS="$(uname -s)"
echo "检测到系统: $OS"

case "$OS" in
  Darwin)
    echo "注册 macOS launchd 服务..."
    PLIST_DIR="$HOME/Library/LaunchAgents"
    mkdir -p "$PLIST_DIR"
    PLIST_FILE="$PLIST_DIR/com.sofagent.daemon.plist"

    cat > "$PLIST_FILE" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sofagent.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$TARGET_DIR/daemon.sh</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${REPO_ROOT}/.sofagent/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${REPO_ROOT}/.sofagent/daemon.log</string>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
</dict>
</plist>
PLISTEOF

    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"
    echo "launchd 服务已注册: $PLIST_FILE"
    echo "daemon 将在系统启动时自动运行"
    ;;

  Linux)
    echo "注册 Linux systemd 用户服务..."
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"
    SERVICE_FILE="$SYSTEMD_DIR/sofagent-daemon.service"

    cat > "$SERVICE_FILE" << SERVICEEOF
[Unit]
Description=sofagent daemon
After=network.target

[Service]
Type=forking
ExecStart=$TARGET_DIR/daemon.sh start
ExecStop=$TARGET_DIR/daemon.sh stop
Restart=on-failure
RestartSec=5
WorkingDirectory=$REPO_ROOT

[Install]
WantedBy=default.target
SERVICEEOF

    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user enable sofagent-daemon.service 2>/dev/null || true
    systemctl --user start sofagent-daemon.service 2>/dev/null
    echo "systemd 服务已注册: $SERVICE_FILE"
    ;;

  *)
    echo "daemon 不支持此平台 ($OS)，跳过系统服务注册。"
    echo "你可以手动运行: bash $TARGET_DIR/daemon.sh start"
    exit 0
    ;;
esac

echo ""
echo "✅ daemon 安装完成。运行 'bash $TARGET_DIR/daemon-status.sh' 查看状态。"
