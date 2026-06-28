#!/bin/sh
# sofagent-lite · 安装脚本（30 秒装好宪法层）
# 用法: sh install.sh [openclaw|workbuddy|--platform openclaw|--platform workbuddy]
set -u
SKILL="$(cd "$(dirname "$0")" && pwd)/SKILL.md"
P="${1:-}"

[ "$P" = "--platform" ] && P="${2:-}"

# 自动探测
{ [ -z "$P" ] || [ "$P" = "--platform" ]; } && [ -d "$HOME/.openclaw/skills" ] && P="openclaw"
{ [ -z "$P" ] || [ "$P" = "--platform" ]; } && [ -d "$HOME/.workbuddy/skills" ] && P="workbuddy"
{ [ -z "$P" ] || [ "$P" = "--platform" ]; } && P="manual"

case "$P" in
  openclaw)
    DST="$HOME/.openclaw/skills/sofagent-lite"
    mkdir -p "$DST" && cp "$SKILL" "$DST/"
    echo "✅ sofagent-lite → ~/.openclaw/skills/sofagent-lite/"
    ;;
  workbuddy)
    DST="$HOME/.workbuddy/skills/sofagent-lite"
    mkdir -p "$DST" && cp "$SKILL" "$DST/"
    echo "✅ sofagent-lite → ~/.workbuddy/skills/sofagent-lite/"
    ;;
  *)
    echo "🙋 未检测到 OpenClaw 或 WorkBuddy。"
    echo "   你的 Agent 平台（Claude Code / Codex / Hermes 等）没有技能目录。"
    echo "   下面是宪法（4 底线 + 6 则铁律）——复制粘贴到 Agent 配置顶部即可："
    echo ""
    sed -n '/^## 4 底线/,$p' "$SKILL"
    ;;
esac
