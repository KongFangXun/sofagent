#!/bin/bash
# ============================================================
# sofagent daemon.sh · daemon 主进程 · v1.0.4
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
VERSION="1.0.4"

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

# ── P2-2: daemon-notice 速率限制（每小时最多 1 次写入）──
_write_notice_if_stale() {
  local msg="$1"
  local notice_file="${SOFAGENT_DATA}/daemon-notice.md"
  local now_ts
  now_ts=$(date +%s)

  # 检查上次写入时间
  if [ -f "$notice_file" ]; then
    local file_ts
    # macOS/BSD stat vs GNU stat 兼容
    if stat -f %m "$notice_file" 2>/dev/null; then
      file_ts=$(stat -f %m "$notice_file" 2>/dev/null)
    else
      file_ts=$(stat -c %Y "$notice_file" 2>/dev/null || echo 0)
    fi
    local elapsed=$((now_ts - file_ts))
    # 3600 秒 = 1 小时
    if [ "$elapsed" -lt 3600 ]; then
      return 0
    fi
  fi

  echo "[daemon] $(date -u +"%Y-%m-%dT%H:%M:%SZ") ${msg}" > "$notice_file"
}

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
  "tasklogs_pending": 0,
  "tasklogs_last_ingest": "",
  "last_check": "${now}",
  "last_evidence_score": "unknown"
}
JSONEOF
}

# ── 查找 think.md 和 fde.md ──
_find_think() {
  local f="${REPO_ROOT}/.sofagent/think.md"
  [ -f "$f" ] && { echo "$f"; return 0; }
  echo ""
}

_find_rules() {
  for f in \
    "${HOME}/.openclaw/skills/sofagent/fde.md" \
    "${HOME}/.workbuddy/skills/sofagent/fde.md" \
    "${HOME}/.openclaw/fde.md" \
    "${HOME}/.workbuddy/fde.md"; do
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
      # 速率限制：每小时最多写一次 daemon-notice（P2-2）
      _write_notice_if_stale "think.md 已变更——下次启动时建议读取最新反思"
    fi
    if [ -n "$rules_hash" ] && [ "$rules_hash" != "${old_rules:-}" ]; then
      daemon_log "fde.md 已变更 (${old_rules:-无} → ${rules_hash})"
      _write_notice_if_stale "fde.md 已变更——下次启动时建议读取最新规则"
    fi

    # 4. 更新 daemon.json
    set_json_field "pid" "$$"
    set_json_field "detected_platforms" "$platforms"
    set_json_field "think_hash" "$think_hash"
    set_json_field "rules_hash" "$rules_hash"
    set_json_field "last_check" "$now"

    # 5. 最小可信验证：跑 verify-evidence TS 版，结果写入 daemon.json
    local evidence_score="unknown"
    local AUDIT_DIST="${SCRIPT_DIR}/../audit/dist/index.js"
    if [ -f "$AUDIT_DIST" ]; then
      evidence_score=$(node "$AUDIT_DIST" --verify-evidence 2>/dev/null && echo "verified" || echo "unverified")
    fi
    set_json_field "last_evidence_score" "$evidence_score"

    # 6. task/logs 变化检测 + Ingest 触发（v1.0.4）
    local logs_dir="${SOFAGENT_DATA}/task/logs"
    local pending_count=0
    if [ -d "$logs_dir" ]; then
      # 统计最近 30 分钟内新增的日志文件
      pending_count=$(find "$logs_dir" -name "*.md" -mmin -30 2>/dev/null | wc -l | tr -d ' ')
    fi
    local old_pending
    old_pending=$(get_json_field "tasklogs_pending" 2>/dev/null || echo "0")

    if [ "$pending_count" -gt 0 ]; then
      # 有新日志——标记待提取
      if [ "${old_pending:-0}" = "0" ]; then
        daemon_log "task/logs 检测到 ${pending_count} 个新文件——标记待提取"
      fi
      set_json_field "tasklogs_pending" "$pending_count"
      # 写通知文件（P2-2 速率限制）
      _write_notice_if_stale "task/logs 有 ${pending_count} 个新文件待知识提取（30 分钟无新变化后触发 Ingest）"
    elif [ "${old_pending:-0}" != "0" ]; then
      # 之前有待提取，现在没有新文件了（防抖结束）——触发 Ingest
      daemon_log "task/logs 防抖结束——触发知识提取 session"
      set_json_field "tasklogs_pending" "0"
      set_json_field "tasklogs_last_ingest" "$now"
      # 写 Ingest 触发通知
      _write_notice_if_stale "Ingest 触发——请运行 knowledge-maintain 提取最新 task/logs 中的知识"
    fi

    # 7. SkillOpt 自进化调度（v1.0.4 → P0-7 管道接通）
    # 读 scoring.md → 阈值检测 → 24h 防抖 → 调 skillopt-run
    _trigger_skillopt() {
      # 读取 scoring.md，检查累积评分条目数是否到阈值
      local scoring_file="${SOFAGENT_DATA}/../skill/data/scoring.md"
      local threshold=20  # 累积 20 条评分后触发
      if [ ! -f "$scoring_file" ]; then
        return
      fi
      local score_count
      score_count=$(grep -c '^|' "$scoring_file" 2>/dev/null || echo 0)
      if [ "$score_count" -lt "$threshold" ]; then
        return
      fi

      # 检查上次触发时间（24h 内不重复触发）
      local last_trigger="${SOFAGENT_DATA}/.skillopt-last-run"
      if [ -f "$last_trigger" ]; then
        local last_time
        last_time=$(cat "$last_trigger" 2>/dev/null || echo 0)
        local now
        now=$(date +%s)
        local diff=$((now - last_time))
        if [ "$diff" -lt 86400 ]; then
          return  # 24h 内已触发过
        fi
      fi

      # 检测 skillopt-sleep 是否可用
      if ! command -v skillopt-sleep &>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] SkillOpt: skillopt-sleep 未安装（需 clone github.com/microsoft/SkillOpt + pip install -e .）。scoring.md 已积累 ${score_count} 条，触发条件已满足但引擎不可用。" >> "${SOFAGENT_DATA}/daemon-notice.md"
        return
      fi

      # 真正调用——通过 npx @sofagent/audit skillopt-run
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] SkillOpt: scoring.md 累积 ${score_count} 条，触发自进化" >> "${SOFAGENT_DATA}/daemon-notice.md"
      npx @sofagent/audit skillopt-run --input "${SOFAGENT_DATA}/../skill/SKILL.md" --output "${SOFAGENT_DATA}/skill-candidate.md" --scoring "$scoring_file" 2>>"${SOFAGENT_DATA}/daemon-notice.md"
      date +%s > "$last_trigger"
    }
    _trigger_skillopt

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
