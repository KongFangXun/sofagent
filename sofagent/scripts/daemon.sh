#!/bin/bash
# ============================================================
# sofagent daemon.sh · daemon 主进程 · v0.83
# ============================================================
# 命令行接口：start / stop / status / --foreground
# 主循环每 30 秒：检测平台进程 + 文件 hash 变化 → 更新 daemon.json
#
# 用法：
#   daemon.sh start         后台启动
#   daemon.sh stop          停止
#   daemon.sh status        查询状态（委托 daemon-status.sh）
#   daemon.sh --foreground  前台运行（调试用）
# ============================================================

set -euo pipefail
VERSION="0.83"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || echo "$PWD")"

# daemon 在项目根目录运行，数据目录也在根目录下
SOFAGENT_DATA="${REPO_ROOT}/.sofagent"
DAEMON_JSON="${SOFAGENT_DATA}/daemon.json"
DAEMON_LOG="${SOFAGENT_DATA}/daemon.log"
DAEMON_PID_FILE="${SOFAGENT_DATA}/daemon.pid"

_ensure_data_dir() {
  mkdir -p "$SOFAGENT_DATA"
}

# ── 加载函数库 ──
LIB_FILE="${SCRIPT_DIR}/lib/daemon-lib.sh"
if [ -f "$LIB_FILE" ]; then
  source "$LIB_FILE"
fi

# ── 信号处理 ──
_on_signal() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] daemon 收到信号，退出 (PID $$)" >> "$DAEMON_LOG" 2>/dev/null || true
  rm -f "$DAEMON_PID_FILE"
  exit 0
}
trap '_on_signal' TERM
trap '_on_signal' INT

# ── 写入 daemon.json 初始结构 ──
_init_json() {
  local now pid
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  pid=$$
  cat > "$DAEMON_JSON" << JSONEOF
{
  "pid": ${pid},
  "started_at": "${now}",
  "mode": "full",
  "detected_platforms": "",
  "think_hash": "",
  "rules_hash": "",
  "last_check": "${now}",
  "last_evidence_score": "unknown"
}
JSONEOF
}

# ── 查找 think.md 和 rules.md ──
_find_think() {
  for f in "${REPO_ROOT}/.sofagent/think.md"; do
    [ -f "$f" ] && { echo "$f"; return 0; }
  done
  echo ""
}

_find_rules() {
  for f in \
    "${HOME}/.openclaw/skills/sofagent/rules.md" \
    "${HOME}/.workbuddy/skills/sofagent/rules.md" \
    "${HOME}/.openclaw/rules.md" \
    "${HOME}/.workbuddy/rules.md"; do
    [ -f "$f" ] && { echo "$f"; return 0; }
  done
  echo ""
}

# ── 主循环 ──
_main_loop() {
  local think_file rules_file

  _init_json
  daemon_log "daemon 主循环启动 (PID $$)"

  while true; do
    local now platforms think_hash rules_hash
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # 1. 进程检测
    platforms=$(detect_platforms 2>/dev/null || echo "")

    # 2. 文件 hash
    think_file=$(_find_think)
    rules_file=$(_find_rules)
    think_hash=$(compute_hash "$think_file" 2>/dev/null || echo "")
    rules_hash=$(compute_hash "$rules_file" 2>/dev/null || echo "")

    # 3. 检测变化
    local old_think old_rules
    old_think=$(get_json_field "think_hash" 2>/dev/null || echo "")
    old_rules=$(get_json_field "rules_hash" 2>/dev/null || echo "")

    if [ -n "$think_hash" ] && [ "$think_hash" != "${old_think:-}" ]; then
      daemon_log "think.md 已变更 (${old_think:-无} → ${think_hash})"
      # 最小消费动作：写通知文件，下次 Agent 启动时可注入
      echo "[daemon] $(date -u +"%Y-%m-%dT%H:%M:%SZ") think.md 已变更——下次启动时建议读取最新反思" \
        > "${SOFAGENT_DATA}/daemon-notice.md"
    fi
    if [ -n "$rules_hash" ] && [ "$rules_hash" != "${old_rules:-}" ]; then
      daemon_log "rules.md 已变更 (${old_rules:-无} → ${rules_hash})"
      echo "[daemon] $(date -u +"%Y-%m-%dT%H:%M:%SZ") rules.md 已变更——下次启动时建议读取最新规则" \
        > "${SOFAGENT_DATA}/daemon-notice.md"
    fi

    # 4. 更新 daemon.json
    set_json_field "pid" "$$"
    set_json_field "detected_platforms" "$platforms"
    set_json_field "think_hash" "$think_hash"
    set_json_field "rules_hash" "$rules_hash"
    set_json_field "last_check" "$now"

    # 5. 最小可信验证：跑 verify-evidence.sh，结果写入 daemon.json
    local evidence_score="unknown"
    if [ -x "${SCRIPT_DIR}/verify-evidence.sh" ]; then
      evidence_score=$(bash "${SCRIPT_DIR}/verify-evidence.sh" --daemon 2>/dev/null && echo "verified" || echo "unverified")
    fi
    set_json_field "last_evidence_score" "$evidence_score"

    sleep 30
  done
}

# ── start：后台启动 ──
_start() {
  _ensure_data_dir

  # 系统兼容性检查：非 macOS/Linux 拒绝启动，避免「假运行」
  local os_type
  os_type="$(uname -s)"
  case "$os_type" in
    Darwin|Linux) ;;
    *) echo "daemon 不支持此操作系统 (${os_type})——宪法层正常生效，daemon 后台监控跳过。"; return 1 ;;
  esac

  if daemon_running 2>/dev/null; then
    echo "daemon 已在运行 (PID $(get_daemon_pid))"
    return 0
  fi

  echo "启动 sofagent daemon..."
  nohup "$0" --foreground >> "$DAEMON_LOG" 2>&1 &
  local bg_pid=$!
  echo "$bg_pid" > "$DAEMON_PID_FILE"

  sleep 1
  if kill -0 "$bg_pid" 2>/dev/null; then
    echo "daemon 已启动 (PID $bg_pid)"
  else
    echo "daemon 启动失败，查看日志: $DAEMON_LOG"
    rm -f "$DAEMON_PID_FILE"
    return 1
  fi
}

# ── stop：停止 ──
_stop() {
  local pid
  pid=$(get_daemon_pid 2>/dev/null || echo "")
  if [ -z "$pid" ]; then
    echo "daemon 未运行（无 PID 文件）"
    rm -f "$DAEMON_PID_FILE"
    return 0
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "停止 daemon (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "daemon 已停止"
  else
    echo "daemon 进程 $pid 已不存在"
  fi
  rm -f "$DAEMON_PID_FILE"
}

# ── status：委托 daemon-status.sh ──
_status() {
  local status_script="${SCRIPT_DIR}/daemon-status.sh"
  if [ -x "$status_script" ]; then
    bash "$status_script" "$@"
  else
    echo "daemon-status.sh 未找到——请确保 daemon 已安装"
  fi
}

# ── 命令行路由 ──
case "${1:-}" in
  start)
    _start
    ;;
  stop)
    _stop
    ;;
  status)
    shift 2>/dev/null || true
    _status "$@"
    ;;
  --foreground)
    _ensure_data_dir
    echo "$$" > "$DAEMON_PID_FILE"
    _main_loop
    ;;
  *)
    echo "sofagent daemon v${VERSION}"
    echo ""
    echo "用法: $0 {start|stop|status|--foreground}"
    echo ""
    echo "  start         后台启动 daemon"
    echo "  stop          停止 daemon"
    echo "  status        查询状态"
    echo "  --foreground  前台运行（调试用）"
    exit 1
    ;;
esac
