#!/bin/bash
# ============================================================
# sofagent daemon-status.sh · daemon 状态查询 · v0.83
# ============================================================
# 默认：运行状态 + PID + 时长 + mode + detected_platforms
# --detect：仅进程检测，输出平台列表
# --json：JSON 格式（供 CI/程序读取）
#
# 用法：
#   daemon-status.sh             默认输出
#   daemon-status.sh --detect    进程检测
#   daemon-status.sh --json      JSON 格式
# ============================================================

set -euo pipefail
VERSION="0.83"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOFAGENT_DATA="${PWD}/.sofagent"
DAEMON_JSON="${SOFAGENT_DATA}/daemon.json"
DAEMON_PID_FILE="${SOFAGENT_DATA}/daemon.pid"

# 尝试读取 config.sh
[ -f "$SCRIPT_DIR/lib/config.sh" ] && source "$SCRIPT_DIR/lib/config.sh" 2>/dev/null || true
[ -f "$SCRIPT_DIR/lib/daemon-lib.sh" ] && source "$SCRIPT_DIR/lib/daemon-lib.sh" 2>/dev/null || true

# ── 简易内联函数（不依赖 daemon-lib.sh 时使用）──
_get_pid() {
  cat "$DAEMON_PID_FILE" 2>/dev/null || echo ""
}

_is_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

_get_uptime() {
  local pid="$1"
  if [ -n "$pid" ] && _is_running "$pid"; then
    local elapsed start_sec
    start_sec=$(ps -o lstart= -p "$pid" 2>/dev/null | head -1 || true)
    if [ -n "$start_sec" ]; then
      elapsed=$(($(date +%s) - $(date -j -f "%a %b %d %T %Y" "$start_sec" +%s 2>/dev/null || echo 0)))
    else
      # 备选：从 daemon.json 的 started_at 解析
      local started_at
      started_at=$(grep -o '"started_at"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || true)
      if [ -n "$started_at" ]; then
        local started_epoch
        started_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$started_at" +%s 2>/dev/null || echo 0)
        elapsed=$(($(date +%s) - started_epoch))
      else
        elapsed=0
      fi
    fi
    # 格式化：Xh Ym Zs
    local h=$((elapsed / 3600)) m=$(((elapsed % 3600) / 60)) s=$((elapsed % 60))
    echo "${h}h ${m}m ${s}s"
  else
    echo "-"
  fi
}

# ── JSON 输出 ──
output_json() {
  local pid status mode platforms uptime started_at think_hash rules_hash last_check
  pid=$(_get_pid)
  if [ -n "$pid" ] && _is_running "$pid"; then
    status="running"
  else
    status="stopped"
  fi

  mode="unknown"
  platforms=""
  started_at=""
  think_hash=""
  rules_hash=""
  last_check=""
  uptime="-"

  if [ -f "$DAEMON_JSON" ]; then
    mode=$(grep -o '"mode"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "unknown")
    platforms=$(grep -o '"detected_platforms"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    started_at=$(grep -o '"started_at"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    think_hash=$(grep -o '"think_hash"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    rules_hash=$(grep -o '"rules_hash"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    last_check=$(grep -o '"last_check"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    evidence_score=$(grep -o '"last_evidence_score"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "unknown")
    [ "$status" = "running" ] && uptime=$(_get_uptime "$pid")
  fi

  cat << JSONEOF
{
  "status": "${status}",
  "pid": ${pid:-0},
  "uptime": "${uptime}",
  "mode": "${mode}",
  "detected_platforms": "${platforms}",
  "started_at": "${started_at}",
  "think_hash": "${think_hash}",
  "rules_hash": "${rules_hash}",
  "last_check": "${last_check}",
  "last_evidence_score": "${evidence_score:-unknown}"
}
JSONEOF
}

# ── 简洁输出 ──
output_default() {
  local pid status mode platforms uptime
  pid=$(_get_pid)
  if [ -n "$pid" ] && _is_running "$pid"; then
    status="✅ running"
  else
    status="⏹ stopped"
  fi

  mode="unknown"
  platforms=""
  uptime="-"
  evidence_score="unknown"

  if [ -f "$DAEMON_JSON" ]; then
    mode=$(grep -o '"mode"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "unknown")
    platforms=$(grep -o '"detected_platforms"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    evidence_score=$(grep -o '"last_evidence_score"[[:space:]]*:[[:space:]]*"[^"]*"' "$DAEMON_JSON" 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/' || echo "unknown")
    [ "$status" = "✅ running" ] && uptime=$(_get_uptime "$pid")
  fi

  echo "sofagent daemon v${VERSION}"
  echo ""
  echo "  状态: $status"
  echo "  PID: ${pid:-无}"
  echo "  运行时长: $uptime"
  echo "  模式: $mode"
  echo "  检测平台: ${platforms:-无}"
  echo "  可信证据: ${evidence_score:-unknown}"
}

# ── 路由 ──
case "${1:-}" in
  --detect)
    if [ -f "$SCRIPT_DIR/lib/daemon-lib.sh" ]; then
      source "$SCRIPT_DIR/lib/daemon-lib.sh" 2>/dev/null
      detect_platforms 2>/dev/null || echo ""
    else
      # 内联检测
      found=""
      pgrep_out=""
      pgrep_out=$(pgrep -f "openclaw" 2>/dev/null | head -1 || true)
      [ -n "$pgrep_out" ] && found="${found}openclaw "
      pgrep_out=$(pgrep -f "[Ww]ork[Bb]uddy" 2>/dev/null | head -1 || true)
      [ -n "$pgrep_out" ] && found="${found}workbuddy "
      pgrep_out=$(pgrep -f "[Cc]laude" 2>/dev/null | head -1 || true)
      [ -n "$pgrep_out" ] && found="${found}claude "
      pgrep_out=$(pgrep -f "[Cc]odex" 2>/dev/null | head -1 || true)
      [ -n "$pgrep_out" ] && found="${found}codex "
      pgrep_out=$(pgrep -f "[Hh]ermes" 2>/dev/null | head -1 || true)
      [ -n "$pgrep_out" ] && found="${found}hermes "
      echo "${found%" "}"
    fi
    ;;
  --json)
    output_json
    ;;
  *)
    output_default
    ;;
esac
