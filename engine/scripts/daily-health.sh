#!/usr/bin/env bash
# ============================================================
# sofagent daily-health.sh · 每日健康巡检独立脚本 · v1.5.3
# ============================================================
# OS 原生 cron 承接的每日巡检（原 TS daemon scheduler 内 tick 的
# daily-health 任务改为本脚本）——不依赖任何常驻进程，cron 直接拉起。
# 产物：${SOFAGENT_DATA}/dashboard/daily-health-YYYY-MM-DD.md
# 用法：bash daily-health.sh（由 crontab 每日 00:00 调用，也可手动执行）
# ============================================================

set -euo pipefail
# shellcheck disable=SC2034  # VERSION 供版本追踪用，不直接引用
VERSION="1.5.3"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 统一解析数据目录（与 daemon-status.sh 同款 config.sh 加载链）
if [ -f "$SCRIPT_DIR/lib/config.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/config.sh" 2>/dev/null || true
fi
SOFAGENT_DATA="${SOFAGENT_DATA:-${SOFAGENT_HOME:-$HOME/.sofagent}/data}"

REPORT_DIR="${SOFAGENT_DATA}/dashboard"
mkdir -p "$REPORT_DIR" 2>/dev/null || true
REPORT="${REPORT_DIR}/daily-health-$(date +%Y-%m-%d).md"

{
  echo "# 每日健康巡检 · $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo ""
  echo "## daemon 状态"
  echo ""
  if [ -f "${SOFAGENT_DATA}/daemon.pid" ] && kill -0 "$(cat "${SOFAGENT_DATA}/daemon.pid" 2>/dev/null)" 2>/dev/null; then
    echo "- daemon：运行中（PID $(cat "${SOFAGENT_DATA}/daemon.pid")）"
  else
    echo "- daemon：未运行（TS daemon 为手动 start 定位，非常驻服务）"
  fi
  echo ""
  echo "## 审计历史增量"
  echo ""
  AUDIT_LOG="${SOFAGENT_DATA}/audit/history.jsonl"
  if [ -f "$AUDIT_LOG" ]; then
    TOTAL=$(wc -l < "$AUDIT_LOG" | tr -d ' ')
    TODAY=$(date +%Y-%m-%d)
    INCR=$(grep -c "$TODAY" "$AUDIT_LOG" 2>/dev/null || true)
    echo "- 审计历史总条数：${TOTAL}"
    echo "- 今日新增（按日期串匹配）：${INCR:-0}"
  else
    echo "- 审计历史不存在（${AUDIT_LOG}）"
  fi
  echo ""
  echo "## WARN 累积"
  echo ""
  if [ -f "$AUDIT_LOG" ]; then
    WARN_COUNT=$(grep -c '"WARN"\|"level":"warn"\|WARN' "$AUDIT_LOG" 2>/dev/null || true)
    echo "- 历史累计 WARN 相关行：${WARN_COUNT:-0}"
  else
    echo "- 无审计历史可统计"
  fi
  echo ""
} > "$REPORT"

echo "[sofagent] daily-health 日报已生成：${REPORT}"
