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
#   SOFAGENT_DATA          数据目录路径（v0.90 P0-3：统一解析，不再各自硬编码 ${PWD}/.sofagent）
#   SOFA_SANITIZE         日志脱敏开关（"true" 或 ""）
#   SOFA_SANITIZE_IPS       内网 IP 脱敏开关（"true" 或 ""）
#   SOFA_RETENTION_DAYS     日志保留天数（默认 90）
#   SOFA_RETENTION_MAX      日志最大条数（默认 500）
#   SOFA_CLEANUP_ON_RECORD  写日志后是否触发清理（"true" 或 ""）
#   SOFA_CLEANUP_FREQUENCY  清理触发频率（默认 10，即 1/N 概率）
#   SOFA_AUDIT_ENABLED      审计日志开关（"true" 或 ""）
# ============================================================

# ── v0.90 P0-3 统一数据目录解析 ──
# 优先级：环境变量 > 安装时写入的标记文件 > 当前目录
# 解决问题：install.sh --project-dir 装在 A 目录，audit/verify 硬编码 ${PWD} 导致找不到数据
_sofa_find_data_dir() {
  # 1. 环境变量显式指定
  if [ -n "${SOFAGENT_DATA:-}" ] && [ -d "${SOFAGENT_DATA:-}" ]; then
    echo "$SOFAGENT_DATA"
    return 0
  fi

  # 2. 当前工作目录有 .sofagent/
  if [ -d "${PWD}/.sofagent" ]; then
    echo "${PWD}/.sofagent"
    return 0
  fi

  # 3. 安装时写入的数据目录标记（install.sh --project-dir 时写入）
  local marker
  for marker in \
    "${HOME}/.openclaw/skills/sofagent/.sofagent-data-path" \
    "${HOME}/.workbuddy/skills/sofagent/.sofagent-data-path"; do
    if [ -f "$marker" ]; then
      local data_path
      data_path=$(cat "$marker" 2>/dev/null | tr -d '[:space:]')
      if [ -n "$data_path" ] && [ -d "$data_path" ]; then
        echo "$data_path"
        return 0
      fi
    fi
  done

  # 4. fallback：当前目录（即使不存在也返回，让调用方决定是否创建）
  echo "${PWD}/.sofagent"
  return 0
}

SOFAGENT_DATA="$(_sofa_find_data_dir)"
export SOFAGENT_DATA

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
# v0.90 P0-3 连带修复：_parse_conf 在 rules.md 无匹配时返回空值，
# 会覆盖环境变量（如 SOFA_AUDIT_ENABLED=true 被 rules.md 无配置时清空）。
# 修复：先读 rules.md，仅在 rules.md 有明确值时覆盖；否则保留已有环境变量。

# 日志脱敏
if [ -n "$(_parse_conf "log_sanitize" "")" ]; then
  SOFA_SANITIZE="$(_parse_conf "log_sanitize" "")"
fi
export SOFA_SANITIZE

# 内网 IP 脱敏
if [ -n "$(_parse_conf "log_sanitize_ips" "")" ]; then
  SOFA_SANITIZE_IPS="$(_parse_conf "log_sanitize_ips" "")"
fi
export SOFA_SANITIZE_IPS

# 数据保留天数
SOFA_RETENTION_DAYS="$(_parse_conf "data_retention_days" "${SOFA_RETENTION_DAYS:-90}")"
export SOFA_RETENTION_DAYS

# 数据保留最大条数
SOFA_RETENTION_MAX="$(_parse_conf "data_retention_max_entries" "${SOFA_RETENTION_MAX:-500}")"
export SOFA_RETENTION_MAX

# 写日志后触发清理
if [ -n "$(_parse_conf "data_cleanup_on_record" "")" ]; then
  SOFA_CLEANUP_ON_RECORD="$(_parse_conf "data_cleanup_on_record" "")"
fi
export SOFA_CLEANUP_ON_RECORD

# 清理触发频率（1/N 概率）
SOFA_CLEANUP_FREQUENCY="$(_parse_conf "data_cleanup_frequency" "${SOFA_CLEANUP_FREQUENCY:-10}")"
export SOFA_CLEANUP_FREQUENCY

# 审计日志开关
if [ -n "$(_parse_conf "audit_enabled" "")" ]; then
  SOFA_AUDIT_ENABLED="$(_parse_conf "audit_enabled" "")"
fi
export SOFA_AUDIT_ENABLED
