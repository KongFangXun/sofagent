#!/usr/bin/env bash
# ============================================================
# sofagent daemon-install.sh · daemon 安装脚本 · v1.5.8
# ============================================================
# 部署 daemon.sh + daemon-lib.sh，注册系统服务（launchd/systemd）。
# macOS: launchd plist → ~/Library/LaunchAgents/
# Linux: systemd user service → ~/.config/systemd/user/
# 其他: 提示跳过
#
# 用法：bash daemon-install.sh
# ============================================================

set -euo pipefail
# shellcheck disable=SC2034  # VERSION 供版本追踪用，不直接引用
VERSION="1.5.8"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_DIR="$REPO_ROOT/engine/scripts"

# v1.5.7 F23：TS daemon 引擎部署——dist 拷贝到安装态持久根 $SOFAGENT_HOME/daemon-dist/。
# bash daemon.sh start 已改为 launcher：优先 exec node <该副本>/cli.js start，
# 使 watch.yml（install.sh 写入的 inspectors/dream-cycle 调度配置）被 TS 侧
# 真实消费。仓库 clone 清理后持久副本仍在（与 F22 router 副本同模式）。
TS_DAEMON_DIST_SRC="${REPO_ROOT}/engine/daemon/dist"
TS_DAEMON_DIST_DST="${SOFAGENT_HOME:-$HOME/.sofagent}/daemon-dist"
if [ -d "$TS_DAEMON_DIST_SRC" ] && [ -f "${TS_DAEMON_DIST_SRC}/cli.js" ]; then
  mkdir -p "$TS_DAEMON_DIST_DST"
  if cp -R "${TS_DAEMON_DIST_SRC}/." "$TS_DAEMON_DIST_DST/" 2>/dev/null && [ -f "${TS_DAEMON_DIST_DST}/cli.js" ]; then
    echo "TS daemon 引擎已部署（持久副本）: ${TS_DAEMON_DIST_DST}/cli.js"
  else
    echo "⚠️ TS daemon 引擎部署失败（${TS_DAEMON_DIST_DST}）——daemon.sh 将回退 bash 巡检模式"
  fi
else
  echo "⚠️ 未找到 TS daemon 构建产物（${TS_DAEMON_DIST_SRC}/cli.js）——"
  echo "   先在仓库根跑 npm install && npm run build --workspace=engine/daemon，再重跑本脚本"
  echo "   daemon.sh 将回退 bash 巡检模式（watch.yml 调度不生效）"
fi

# v1.5.7 F22：launchd/systemd 的 WorkingDirectory 与日志路径改用安装态持久根
# $SOFAGENT_HOME（默认 ~/.sofagent，与数据目录同根）——此前写 $REPO_ROOT，
# 仓库 clone（--remote / curl pipe bash）被清理后 daemon 工作目录与日志落点
# 全部悬空。仓库内开发态（SOFAGENT_HOME 未设）回退 $REPO_ROOT/.sofagent 保持
# 数据仍在仓库内的既有语义。
PERSISTENT_ROOT="${SOFAGENT_HOME:-$HOME/.sofagent}"
DAEMON_WORKDIR="$PERSISTENT_ROOT"
DAEMON_LOG="$PERSISTENT_ROOT/daemon.log"
mkdir -p "$DAEMON_WORKDIR"

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
    <string>${DAEMON_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${DAEMON_LOG}</string>
    <key>WorkingDirectory</key>
    <string>$DAEMON_WORKDIR</string>
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
WorkingDirectory=$DAEMON_WORKDIR

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
