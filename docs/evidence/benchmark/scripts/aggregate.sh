#!/bin/bash
# ============================================================
# aggregate.sh · 汇总 9 组实验数据，生成对比表
# ============================================================
# 读取 trials/ 下所有试次，汇总成 markdown 表格
# 输出到 stdout，可重定向到 docs/benchmark/2026-06-27-skill-chain-vs-prompt.md 的 §10
#
# 用法：./aggregate.sh > /tmp/aggregate.md
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRIALS_DIR="${SCRIPT_DIR}/../trials"

if [ ! -d "${TRIALS_DIR}" ]; then
  echo "❌ trials 目录不存在: ${TRIALS_DIR}"
  exit 1
fi

echo "<!-- 由 aggregate.sh 自动生成 · $(date -u +%Y-%m-%dT%H:%M:%SZ) -->"
echo ""

# 读取单次试次的误伤数
get_misses() {
  local trial_dir="$1"
  if [ -f "${trial_dir}/misses.txt" ]; then
    cat "${trial_dir}/misses.txt"
  else
    echo "-"
  fi
}

# 读取运行状态
get_run_status() {
  local trial_dir="$1"
  if [ -f "${trial_dir}/run-exit.txt" ]; then
    local code
    code=$(cat "${trial_dir}/run-exit.txt")
    [ "$code" = "0" ] && echo "✅" || echo "❌($code)"
  else
    echo "-"
  fi
}

# 读取加载链命中（C 组）
get_chain_hit() {
  local trial_dir="$1"
  if [ -f "${trial_dir}/chain-hit.txt" ]; then
    local raw
    raw=$(cat "${trial_dir}/chain-hit.txt")
    IFS=',' read -r L1 L2 L3 <<< "$raw"
    local hit_count=$((L1 + L2 + L3))
    echo "${hit_count}/3"
  else
    echo "-"
  fi
}

echo "## 实验结果（aggregate.sh 生成）"
echo ""
echo "### 变量名误伤率"
echo ""
echo "| 条件 | 试次 1 | 试次 2 | 试次 3 | 均值 |"
echo "|---|:---:|:---:|:---:|:---:|"

for COND in A B C; do
  LABEL=""
  case $COND in
    A) LABEL="裸 Agent" ;;
    B) LABEL="prompt 注入" ;;
    C) LABEL="真实加载链" ;;
  esac

  ROW="| ${LABEL}"
  SUM=0
  COUNT=0
  for TRIAL in 1 2 3; do
    DIR="${TRIALS_DIR}/${COND}-${TRIAL}"
    if [ -d "${DIR}" ]; then
      M=$(get_misses "${DIR}")
      ROW+=" | ${M}"
      [ "$M" != "-" ] && { SUM=$((SUM + M)); COUNT=$((COUNT + 1)); }
    else
      ROW+=" | -"
    fi
  done
  if [ "$COUNT" -gt 0 ]; then
    AVG=$(echo "scale=1; ${SUM} / ${COUNT}" | bc 2>/dev/null || echo "?")
    ROW+=" | **${AVG}** |"
  else
    ROW+=" | - |"
  fi
  echo "$ROW"
done

echo ""
echo "### 可运行性（node src/index.js exit code）"
echo ""
echo "| 条件 | 试次 1 | 试次 2 | 试次 3 |"
echo "|---|:---:|:---:|:---:|"
for COND in A B C; do
  LABEL=""
  case $COND in
    A) LABEL="裸 Agent" ;;
    B) LABEL="prompt 注入" ;;
    C) LABEL="真实加载链" ;;
  esac
  ROW="| ${LABEL}"
  for TRIAL in 1 2 3; do
    DIR="${TRIALS_DIR}/${COND}-${TRIAL}"
    if [ -d "${DIR}" ]; then
      ROW+=" | $(get_run_status "${DIR}")"
    else
      ROW+=" | -"
    fi
  done
  echo "$ROW |"
done

echo ""
echo "### 加载链命中率（仅 C 组）"
echo ""
echo "| 试次 | L1 SKILL.md | L2 think.md | L3 fde.md | 命中率 |"
echo "|---|:---:|:---:|:---:|:---:|"
for TRIAL in 1 2 3; do
  DIR="${TRIALS_DIR}/C-${TRIAL}"
  if [ -d "${DIR}" ] && [ -f "${DIR}/chain-hit.txt" ]; then
    raw=$(cat "${DIR}/chain-hit.txt")
    IFS=',' read -r L1 L2 L3 <<< "$raw"
    hit_count=$((L1 + L2 + L3))
    rate=$(echo "scale=2; ${hit_count} / 3" | bc 2>/dev/null || echo "?")
    echo "| ${TRIAL} | $([ "$L1" = "1" ] && echo "✅" || echo "❌") | $([ "$L2" = "1" ] && echo "✅" || echo "❌") | $([ "$L3" = "1" ] && echo "✅" || echo "❌") | ${rate} |"
  else
    echo "| ${TRIAL} | - | - | - | - |"
  fi
done

echo ""
echo "---"
echo ""
COMPLETED=$(find "${TRIALS_DIR}" -maxdepth 1 -type d -name "[ABC]-[123]" | wc -l | tr -d ' ')
echo "已完成试次: ${COMPLETED} / 9"
