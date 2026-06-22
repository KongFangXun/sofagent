#!/bin/bash
# ============================================================
# sofagent lib/daemon-lib.sh · daemon 共享函数库 · v0.83
# ============================================================
# 纯 bash 实现，零外部依赖。被 daemon.sh / daemon-status.sh 共用。
# 前提：调用方需先设置 DAEMON_JSON / DAEMON_LOG / DAEMON_PID_FILE 变量。
# ============================================================

# ── JSON 读写（扁平字段，纯 bash，零 jq 依赖）──

# TODO-v0.9: 当 daemon.json 字段 >10 个或出现嵌套时，迁移到 jq 或 python3 -c。
# 当前 grep+sed 方案的限制：
#   1. value 含 | 字符会断（sed 分隔符冲突）
#   2. 同名 key 匹配错（head -1 只取第一条）
#   3. 无引号转义（value 含特殊字符）
# 触发迁移的条件：字段数 >10 或出现嵌套对象
# 迁移目标：json_read() { jq -r ".$1" "$DAEMON_JSON"; }
#           json_write() { jq ".$1 = \"$2\"" "$DAEMON_JSON" > tmp && mv tmp "$DAEMON_JSON"; }

# get_json_field "key" → 输出 value
get_json_field() {
  local key="$1" out
  [ ! -f "$DAEMON_JSON" ] && return 1
  # 优先匹配字符串值 "key": "value"
  out=$(grep "\"${key}\"[[:space:]]*:" "$DAEMON_JSON" 2>/dev/null | head -1 || true)
  [ -z "$out" ] && return 1
  # 提取字符串值
  local val
  val=$(echo "$out" | sed -n 's/.*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -n "$val" ]; then
    echo "$val"
    return 0
  fi
  # 提取数字值 "key": 123
  val=$(echo "$out" | sed -n 's/.*:[[:space:]]*\([0-9]\{1,\}\).*/\1/p')
  if [ -n "$val" ]; then
    echo "$val"
    return 0
  fi
  return 1
}

# set_json_field "key" "value" → 更新 daemon.json 中的字段
# 字段存在 → 原地替换；不存在 → 在 last_check 行后追加
set_json_field() {
  local key="$1" value="$2"
  [ ! -f "$DAEMON_JSON" ] && return 1
  if grep -q "\"${key}\"[[:space:]]*:" "$DAEMON_JSON" 2>/dev/null; then
    # 字符串值字段
    if grep -q "\"${key}\"[[:space:]]*:[[:space:]]*\"" "$DAEMON_JSON" 2>/dev/null; then
      sed -i '' -e "s|\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"${key}\": \"${value}\"|" "$DAEMON_JSON" 2>/dev/null || \
      sed -i    -e "s|\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"${key}\": \"${value}\"|" "$DAEMON_JSON" 2>/dev/null || true
    else
      # 数字值字段
      sed -i '' -e "s|\"${key}\"[[:space:]]*:[[:space:]]*[0-9]\{1,\}|\"${key}\": ${value}|" "$DAEMON_JSON" 2>/dev/null || \
      sed -i    -e "s|\"${key}\"[[:space:]]*:[[:space:]]*[0-9]\{1,\}|\"${key}\": ${value}|" "$DAEMON_JSON" 2>/dev/null || true
    fi
  fi

  # P1-7 修复：写入后校验 JSON 基本完整性——大括号配对
  local brace_open=0 brace_close=0
  while IFS= read -r -n1 ch; do
    [ "$ch" = "{" ] && brace_open=$((brace_open + 1))
    [ "$ch" = "}" ] && brace_close=$((brace_close + 1))
  done < "$DAEMON_JSON"
  if [ "$brace_open" -ne "$brace_close" ]; then
    return 1
  fi
  return 0
}

# ── 文件 hash ──

compute_hash() {
  local file="$1"
  if [ -f "$file" ] && [ -r "$file" ]; then
    shasum -a 256 "$file" 2>/dev/null | cut -c1-16
  else
    echo ""
  fi
}

# ── 进程检测 ──

detect_platforms() {
  local found="" pgrep_out

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
}

# ── 降级 ──

graceful_degrade() {
  local reason="$1"
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[${now}] DEGRADE: $reason" >> "$DAEMON_LOG"

  if grep -q '"mode"[[:space:]]*:[[:space:]]*"full"' "$DAEMON_JSON" 2>/dev/null; then
    sed -i '' -e 's|"mode"[[:space:]]*:[[:space:]]*"full"|"mode": "file_only"|' "$DAEMON_JSON" 2>/dev/null || \
    sed -i    -e 's|"mode"[[:space:]]*:[[:space:]]*"full"|"mode": "file_only"|' "$DAEMON_JSON" 2>/dev/null || true
  fi
}

# ── 日志 ──

daemon_log() {
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[${now}] $1" >> "$DAEMON_LOG"
}

# ── PID 管理 ──

get_daemon_pid() {
  if [ -f "$DAEMON_PID_FILE" ]; then
    cat "$DAEMON_PID_FILE" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

daemon_running() {
  local pid
  pid=$(get_daemon_pid)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}
