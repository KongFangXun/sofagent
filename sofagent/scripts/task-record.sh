#!/bin/bash
# ============================================================
# sofagent task-record.sh · 任务记录脚本
# ============================================================
# 收集标准任务数据 → 拼成 Markdown → 追加到任务日志文件。
# 由 DeepSeek V4 Pro 辅助生成。
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

VERSION="1.0.0"

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
    --version) echo "sofagent-task-log v${VERSION}"; exit 0 ;;
    --help)
      echo "sofagent task-log v${VERSION}"
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

# ── 构建 Markdown 条目 ──
if [ ! -f "$LOG_FILE" ]; then
  echo "# ${TODAY} 任务记录" > "$LOG_FILE"
  echo "" >> "$LOG_FILE"
fi

if [ "$IS_CHECKPOINT" = true ]; then
  cat << ENTRY >> "$LOG_FILE"

## ${TIMESTAMP} — #checkpoint ${TASK_NAME}

| 字段 | 值 |
|------|------|
| 检查点 | ${TASK_RESULT:-评估中} |
| 当前步数 | ${TASK_STEPS:--} |
| 重试次数 | ${TASK_RETRIES:--} |
| 已用 Token | ${TASK_TOKENS:--} |
| 已用费用 | ${TASK_COST:--} |
| Skills | ${TASK_SKILLS:--} |
ENTRY
else
  cat << ENTRY >> "$LOG_FILE"

## ${TIMESTAMP} — ${TASK_NAME}

| 字段 | 值 |
|------|------|
| 状态 | ${TASK_RESULT:-未记录} |
| 模型 | ${TASK_MODEL:-未记录} |
| Token | ${TASK_TOKENS:--} |
| 费用 | ${TASK_COST:--} |
| Skills | ${TASK_SKILLS:--} |
ENTRY
fi

echo "  已记录: ${TASK_NAME} → ${LOG_FILE}"
