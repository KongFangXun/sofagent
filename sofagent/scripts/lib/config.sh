#!/bin/bash
# ============================================================
# sofagent lib/config.sh · 企业合规共享配置加载器
# ============================================================
# 从 rules.md 中提取企业合规配置项，export 为环境变量。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 用法：source "$(dirname "$0")/lib/config.sh"
#
# 导出环境变量：
#   SOFA_SANITIZE         日志脱敏开关（"true" 或 ""）
#   SOFA_SANITIZE_IPS       内网 IP 脱敏开关（"true" 或 ""）
#   SOFA_RETENTION_DAYS     日志保留天数（默认 90）
#   SOFA_RETENTION_MAX      日志最大条数（默认 500）
#   SOFA_CLEANUP_ON_RECORD  写日志后是否触发清理（"true" 或 ""）
#   SOFA_CLEANUP_FREQUENCY  清理触发频率（默认 10，即 1/N 概率）
#   SOFA_AUDIT_ENABLED      审计日志开关（"true" 或 ""）
# ============================================================

# ── 定位 rules.md ──
# 优先级：当前工作目录、脚本相对路径、OPENCLAW_DIR
_find_rules() {
  local candidate
  for candidate in \
    "${PWD}/.sofagent/../rules.md" \
    "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/rules.md" \
    "${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/skills/sofagent/rules.md" \
    "${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/rules.md" \
    "$HOME/.openclaw/rules.md" \
    "$HOME/.openclaw/skills/sofagent/constitution/rules.md" \
    "$HOME/.workbuddy/rules.md"; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

SOFA_RULES_FILE="$(_find_rules)"

# ── 辅助函数：从 rules.md 提取 key: value ──
# 匹配行格式：(可选 # )key: value（# 表示注释，未启用）
_parse_conf() {
  local key="$1"
  local default="$2"
  local line

  if [ -z "$SOFA_RULES_FILE" ]; then
    echo "$default"
    return
  fi

  # 优先匹配非注释行（已启用的配置）
  line=$(grep -m1 "^${key}:" "$SOFA_RULES_FILE" 2>/dev/null || true)
  if [ -n "$line" ]; then
    echo "$line" | sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]+$//'
    return
  fi

  echo "$default"
}

# ── 导出配置 ──
# 日志脱敏
SOFA_SANITIZE="$(_parse_conf "log_sanitize" "")"
export SOFA_SANITIZE

# 内网 IP 脱敏
SOFA_SANITIZE_IPS="$(_parse_conf "log_sanitize_ips" "")"
export SOFA_SANITIZE_IPS

# 数据保留天数
SOFA_RETENTION_DAYS="$(_parse_conf "data_retention_days" "90")"
export SOFA_RETENTION_DAYS

# 数据保留最大条数
SOFA_RETENTION_MAX="$(_parse_conf "data_retention_max_entries" "500")"
export SOFA_RETENTION_MAX

# 写日志后触发清理
SOFA_CLEANUP_ON_RECORD="$(_parse_conf "data_cleanup_on_record" "")"
export SOFA_CLEANUP_ON_RECORD

# 清理触发频率（1/N 概率）
SOFA_CLEANUP_FREQUENCY="$(_parse_conf "data_cleanup_frequency" "10")"
export SOFA_CLEANUP_FREQUENCY

# 审计日志开关
SOFA_AUDIT_ENABLED="$(_parse_conf "audit_enabled" "")"
export SOFA_AUDIT_ENABLED
