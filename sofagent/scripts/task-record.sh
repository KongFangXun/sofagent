#!/bin/bash
# ============================================================
# sofagent task-record.sh · 任务记录脚本
# ============================================================
# 收集标准任务数据 → 拼成 Markdown → 追加到任务日志文件。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 数据来源：
#   1. 命令行参数（优先级最高）
#   2. 标准输入管道（JSON lines）
#   3. 环境变量 TASK_NAME / TASK_RESULT / TASK_COST 等
#
# 输出位置：
#   .sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md
#
# 用法：
#   task-record.sh --task "重构数据库" --result "成功" --cost 0.15
#   task-record.sh --task "写单元测试" --model deepseek-v4 --tokens 4500
#   task-record.sh --budget --task "数据分析报表" --steps 48 --limit 80
#   task-record.sh --closure-check --task "数据分析报表"
#   ao compose "..." | task-record.sh --from-stdin
#   task-record.sh --help
# ============================================================

set -euo pipefail

VERSION="0.83"

# ── 加载合规配置 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/lib/config.sh" ]; then
  source "${SCRIPT_DIR}/lib/config.sh"
fi

# ── 参数 ──
TASK_NAME=""
TASK_RESULT=""
TASK_MODEL=""
TASK_TOKENS=""
TASK_COST=""
TASK_SKILLS=""
TASK_STEPS=""
TASK_RETRIES=""
FROM_STDIN=false
IS_CHECKPOINT=false
IS_BUDGET=false
IS_CLOSURE_CHECK=false
BUDGET_LIMIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)    TASK_NAME="$2"; shift 2 ;;
    --result)  TASK_RESULT="$2"; shift 2 ;;
    --model)   TASK_MODEL="$2"; shift 2 ;;
    --tokens)  TASK_TOKENS="$2"; shift 2 ;;
    --cost)    TASK_COST="$2"; shift 2 ;;
    --skills)  TASK_SKILLS="$2"; shift 2 ;;
    --steps)   TASK_STEPS="$2"; shift 2 ;;
    --retries) TASK_RETRIES="$2"; shift 2 ;;
    --checkpoint) IS_CHECKPOINT=true; shift ;;
    --budget) IS_BUDGET=true; shift ;;
    --closure-check) IS_CLOSURE_CHECK=true; shift ;;
    --limit) BUDGET_LIMIT="$2"; shift 2 ;;
    --from-stdin) FROM_STDIN=true; shift ;;
    --version) echo "sofagent-task-record v${VERSION}"; exit 0 ;;
    --help)
      echo "sofagent task-record v${VERSION}"
      echo "  记录 AI Agent 任务执行数据"
      echo ""
      echo "  常规参数:"
      echo "    --task NAME      任务名称（必填）"
      echo "    --result RESULT  执行结果：成功/失败/部分完成"
      echo "    --model MODEL    使用的模型"
      echo "    --tokens N       消耗 token 数"
      echo "    --cost N         费用（美元）"
      echo "    --skills LIST    使用的 Skill（逗号分隔）"
      echo ""
      echo "  检查点参数（暂停评估时用）:"
      echo "    --checkpoint     标记为中间检查点记录"
      echo "    --steps N        当前步数"
      echo "    --retries N      当前重试次数"
      echo ""
      echo "  预算检查（Loop Agent 触发前用）:"
      echo "    --budget         检查当前步数是否达到预算阈值"
      echo "    --limit N        预估总步数上限（需配合 --budget）"
      echo "    返回: BUDGET_CHECK: 步数/上限=百分比 → ✅/⚠️"
      echo ""
      echo "  闭环检查（判断是否今日已有记录）:"
      echo "    --closure-check  检查今日 task/logs 是否有记录"
      echo "    返回: CLOSURE_CHECK: 今日记录数 → ✅/❌"
      echo ""
      echo "  管道输入:"
      echo "    --from-stdin     从管道读取 JSON 行输入"
      exit 0 ;;
    *) echo "未知参数: $1（--help 查看用法）"; exit 1 ;;
  esac
done

# ── 从 stdin 读取 ──
if [ "$FROM_STDIN" = true ]; then
  if [ ! -t 0 ]; then
    stdin_data=$(cat)
    # 尝试解析为 JSON 数组
    if command -v jq &>/dev/null && echo "$stdin_data" | jq empty 2>/dev/null; then
      entries=$(echo "$stdin_data" | jq -c '.[]' 2>/dev/null)
      echo "$entries" | while IFS= read -r entry; do
        t=$(echo "$entry" | jq -r '.task // empty')
        r=$(echo "$entry" | jq -r '.result // "未知"')
        m=$(echo "$entry" | jq -r '.model // "未记录"')
        tk=$(echo "$entry" | jq -r '.tokens // "?"')
        c=$(echo "$entry" | jq -r '.cost // "?"')
        sk=$(echo "$entry" | jq -r '.skills // "-"')
        bash "$0" --task "$t" --result "$r" --model "$m" --tokens "$tk" --cost "$c" --skills "$sk"
      done
      exit 0
    fi
  fi
  echo "警告: --from-stdin 需要管道输入且安装 jq"
  exit 0
fi

# ── 必填检查 ──
if [ -z "$TASK_NAME" ]; then
  echo "错误: --task 为必填参数。--help 查看用法。"
  exit 1
fi

# ── 预算检查（非写入操作，输出后退出）──
if [ "$IS_BUDGET" = true ]; then
  if [ -z "$TASK_STEPS" ] || [ -z "$BUDGET_LIMIT" ]; then
    echo "BUDGET_CHECK: 参数不完整（需 --steps 和 --limit）"
    exit 0
  fi
  PCT=$(( TASK_STEPS * 100 / BUDGET_LIMIT ))
  if [ "$PCT" -ge 60 ]; then
    echo "BUDGET_CHECK: ${TASK_STEPS}/${BUDGET_LIMIT}=${PCT}% → ⚠️ 已达预算 60%，建议调 Loop Agent (checkpoint)"
  else
    echo "BUDGET_CHECK: ${TASK_STEPS}/${BUDGET_LIMIT}=${PCT}% → ✅ 预算内，继续"
  fi
  exit 0
fi

# ── 闭环检查（非写入操作，输出后退出）──
if [ "$IS_CLOSURE_CHECK" = true ]; then
  TODAY=$(date +"%Y-%m-%d")
  MONTH=$(date +"%Y-%m")
  LOG_DIR="${PWD}/.sofagent/task/logs/${MONTH}"
  LOG_FILE="${LOG_DIR}/${TODAY}.md"
  if [ -f "$LOG_FILE" ]; then
    COUNT=$(grep -c "^## " "$LOG_FILE" 2>/dev/null || echo "0")
    echo "CLOSURE_CHECK: ${LOG_FILE} 存在 ${COUNT} 条记录 → ✅ 已闭合"
  else
    echo "CLOSURE_CHECK: ${LOG_FILE} 不存在 → ❌ 今日无闭环记录，需警惕"
  fi
  exit 0
fi

# ── 路径 ──
SOFAGENT_DATA="${PWD}/.sofagent"
TODAY=$(date +"%Y-%m-%d")
MONTH=$(date +"%Y-%m")
LOG_DIR="${SOFAGENT_DATA}/task/logs/${MONTH}"
LOG_FILE="${LOG_DIR}/${TODAY}.md"
TIMESTAMP=$(date +"%H:%M:%S")

# ── 创建目录 ──
mkdir -p "$LOG_DIR"

# ── 脱敏函数 ──
# 优先级：API Key > Bearer Token > JWT > AWS Key > 凭证赋值 > 私钥 > 手机号 > 内网 IP
sanitize() {
  local input="$1"
  # 1. OpenAI / Anthropic API Key
  input=$(echo "$input" | sed -E 's/sk-(ant(-api)?-)?[a-zA-Z0-9_-]{20,}/sk-***REDACTED***/g')
  # 2. Bearer token
  input=$(echo "$input" | sed -E 's/Bearer +[a-zA-Z0-9._~+\/-]+=*/Bearer ***REDACTED***/g')
  # 3. JWT token（eyJ 开头的 base64url 三段式）
  input=$(echo "$input" | sed -E 's/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/***JWT-REDACTED***/g')
  # 4. AWS Access Key（AKIA 开头，20 字符）
  input=$(echo "$input" | sed -E 's/[[:<:]]AKIA[0-9A-Z]{16}[[:>:]]/***AWS-KEY-REDACTED***/g')
  # 5. 凭证赋值（password= / token= / secret= / api_key= / key=）
  #    加 [[:<:]] 词边界防误伤（如 "monkey=foo" 不会被打码）
  input=$(echo "$input" | sed -E 's/[[:<:]](password|token|secret|api_key|key)[=:][[:space:]]*[^ ]+/\1=***REDACTED***/g')
  # 6. 私钥块（PEM 格式：-----BEGIN ... PRIVATE KEY----- ... -----END）
  input=$(echo "$input" | sed -E '/-----BEGIN .*PRIVATE KEY-----/,/-----END .*PRIVATE KEY-----/{
    s/-----BEGIN .*PRIVATE KEY-----/***PRIVATE-KEY-BLOCK-REDACTED***/
    /-----BEGIN/d
    /-----END/d
  }')
  # 7. 中国大陆手机号（1[3-9] 开头 + 9 位数字，共 11 位）
  #    加 [[:<:]] 词边界，避免误伤订单号、时间戳等长数字串
  input=$(echo "$input" | sed -E 's/[[:<:]]1[3-9][0-9]{9}[[:>:]]/[PHONE-REDACTED]/g')
  # 8. 内网 IP（可选，SOFA_SANITIZE_IPS=true 时启用）
  if [ "${SOFA_SANITIZE_IPS:-}" = "true" ]; then
    input=$(echo "$input" | sed -E 's/[[:<:]](10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)[0-9]+\.[0-9]+[[:>:]]/[INTERNAL_IP]/g')
  fi
  echo "$input"
}

# ── 写入前脱敏 ──
# 用局部变量保存脱敏后值，不修改原始参数变量
if [ "${SOFA_SANITIZE:-}" = "true" ]; then
  SANE_TASK_NAME=$(sanitize "$TASK_NAME")
  SANE_TASK_RESULT=$(sanitize "${TASK_RESULT:-}")
  SANE_TASK_MODEL=$(sanitize "${TASK_MODEL:-}")
  SANE_TASK_SKILLS=$(sanitize "${TASK_SKILLS:-}")
else
  SANE_TASK_NAME="$TASK_NAME"
  SANE_TASK_RESULT="${TASK_RESULT:-}"
  SANE_TASK_MODEL="${TASK_MODEL:-}"
  SANE_TASK_SKILLS="${TASK_SKILLS:-}"
fi

# ── 构建 Markdown 条目 ──
if [ ! -f "$LOG_FILE" ]; then
  echo "# ${TODAY} 任务记录" > "$LOG_FILE"
  echo "" >> "$LOG_FILE"
fi

if [ "$IS_CHECKPOINT" = true ]; then
  cat << ENTRY >> "$LOG_FILE"

## ${TIMESTAMP} — #checkpoint ${SANE_TASK_NAME}

| 字段 | 值 |
|------|------|
| 检查点 | ${SANE_TASK_RESULT:-评估中} |
| 当前步数 | ${TASK_STEPS:--} |
| 重试次数 | ${TASK_RETRIES:--} |
| 已用 Token | ${TASK_TOKENS:--} |
| 已用费用 | ${TASK_COST:--} |
| Skills | ${SANE_TASK_SKILLS:--} |
ENTRY
else
  cat << ENTRY >> "$LOG_FILE"

## ${TIMESTAMP} — ${SANE_TASK_NAME}

| 字段 | 值 |
|------|------|
| 状态 | ${SANE_TASK_RESULT:-未记录} |
| 模型 | ${SANE_TASK_MODEL:-未记录} |
| Token | ${TASK_TOKENS:--} |
| 费用 | ${TASK_COST:--} |
| Skills | ${SANE_TASK_SKILLS:--} |
ENTRY
fi

echo "  已记录: ${SANE_TASK_NAME} → ${LOG_FILE}"

# ── 写后概率触发 cleanup.sh ──
if [ "${SOFA_CLEANUP_ON_RECORD:-}" = "true" ]; then
  FREQ="${SOFA_CLEANUP_FREQUENCY:-10}"
  if [ "$((RANDOM % FREQ))" -eq 0 ]; then
    CLEANUP_SCRIPT="${SCRIPT_DIR}/cleanup.sh"
    if [ -x "$CLEANUP_SCRIPT" ]; then
      bash "$CLEANUP_SCRIPT" --force 2>/dev/null || true
    fi
  fi
fi
