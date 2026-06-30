#!/bin/bash
# ============================================================
# run-trial.sh · 记录单次实验结果（不跑 Agent，Agent 由作者手动操作）
# ============================================================
# 本脚本只做两件事：
#   1. 实验后：从作者指定的目录收集 git diff + node 运行结果 + 变量名误伤数
#   2. 保存到 trials/{condition}-{trial}/ 下供后续汇总
#
# 用法：
#   ./run-trial.sh --condition A --trial 1 --dir /path/to/fixture-after-agent
#   ./run-trial.sh --condition B --trial 1 --dir /path/to/fixture-after-agent
#   ./run-trial.sh --condition C --trial 1 --dir /path/to/fixture-after-agent --chain-hit "0,1,1"
#
# 参数：
#   --condition  A=裸Agent / B=prompt注入 / C=真实加载链
#   --trial      试次编号（1/2/3）
#   --dir        Agent 完成后的 fixture 目录路径
#   --chain-hit  （仅 C 组）加载链命中，格式 "L1,L2,L3"（1=命中 0=未命中）
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRIALS_DIR="${SCRIPT_DIR}/../trials"

# 参数解析
CONDITION=""
TRIAL=""
FIXTURE_DIR=""
CHAIN_HIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --condition) CONDITION="$2"; shift 2 ;;
    --trial)     TRIAL="$2"; shift 2 ;;
    --dir)       FIXTURE_DIR="$2"; shift 2 ;;
    --chain-hit) CHAIN_HIT="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# 校验
if [ -z "${CONDITION}" ] || [ -z "${TRIAL}" ] || [ -z "${FIXTURE_DIR}" ]; then
  echo "用法: ./run-trial.sh --condition <A|B|C> --trial <1|2|3> --dir <fixture-path> [--chain-hit L1,L2,L3]"
  exit 1
fi

if [[ ! "${CONDITION}" =~ ^[ABC]$ ]]; then
  echo "❌ --condition 必须是 A / B / C"
  exit 1
fi

if [ ! -d "${FIXTURE_DIR}" ]; then
  echo "❌ fixture 目录不存在: ${FIXTURE_DIR}"
  exit 1
fi

# 创建试次目录
TRIAL_NAME="${CONDITION}-${TRIAL}"
TRIAL_DIR="${TRIALS_DIR}/${TRIAL_NAME}"
mkdir -p "${TRIAL_DIR}"

echo "📋 记录试次: ${TRIAL_NAME}"
echo "   fixture: ${FIXTURE_DIR}"
echo ""

# 1. 保存 git diff
echo "📝 保存 git diff..."
cd "${FIXTURE_DIR}"
git diff > "${TRIAL_DIR}/changes.diff" 2>/dev/null || echo "（无法获取 git diff）"
DIFF_LINES=$(wc -l < "${TRIAL_DIR}/changes.diff" | tr -d ' ')
echo "   diff 行数: ${DIFF_LINES}"

# 2. 运行 node src/index.js
echo "🏃 运行 node src/index.js..."
SRC_DIR=""
for candidate in "src" "task1-camel-to-snake/src"; do
  if [ -d "${candidate}" ]; then SRC_DIR="${candidate}"; break; fi
done

if [ -n "${SRC_DIR}" ] && [ -f "${SRC_DIR}/index.js" ]; then
  if node "${SRC_DIR}/index.js" > "${TRIAL_DIR}/run-output.log" 2>&1; then
    RUN_EXIT=0
    echo "   ✅ exit 0（可运行）"
  else
    RUN_EXIT=$?
    echo "   ❌ exit ${RUN_EXIT}（运行失败）"
  fi
else
  RUN_EXIT=-1
  echo "   ⚠️  未找到 ${SRC_DIR}/index.js，跳过运行测试"
fi
echo "${RUN_EXIT}" > "${TRIAL_DIR}/run-exit.txt"

# 3. 变量名误伤检测（核心指标）
echo "🔍 检测变量名误伤..."

# 应保留的变量名（绝对不能改成 snake_case）
# 格式："变量名|期望形式"——期望形式是 camelCase 原样
check_variable_preserved() {
  local var_name="$1"
  local expected="$2"
  local hits
  # grep 查找 expected 是否仍存在（camelCase 形式）
  hits=$(grep -rn "${expected}" "${SRC_DIR}/" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${hits}" -gt 0 ]; then
    echo "   ✅ ${var_name} 保留（${hits} 处）"
    echo "0"
  else
    # 检查是否被改成了 snake_case
    local snake
    # camelCase → snake_case 转换（简单版）
    snake=$(echo "${expected}" | sed -E 's/([a-z])([A-Z])/\1_\2/g' | tr '[:upper:]' '[:lower:]')
    local bad_hits
    bad_hits=$(grep -rn "${snake}" "${SRC_DIR}/" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${bad_hits}" -gt 0 ]; then
      echo "   ❌ ${var_name} → ${snake}（${bad_hits} 处误伤）"
    else
      echo "   ⚠️  ${var_name} 既不是 ${expected} 也不是 ${snake}（可能被删除或改名）"
    fi
    echo "1"
  fi
}

MISSES=0
{
  echo "## 变量名误伤检测"
  echo ""
  echo "| 变量名 | 文件 | 状态 |"
  echo "|---|---|---|"
} >> "${TRIAL_DIR}/variable-misses.md"

# customer.js: dateFormatter, registeredAt
R=$(check_variable_preserved "dateFormatter" "dateFormatter"); MISSES=$((MISSES + R))
echo "| \`dateFormatter\` | customer.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"
R=$(check_variable_preserved "registeredAt" "registeredAt"); MISSES=$((MISSES + R))
echo "| \`registeredAt\` | customer.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"

# index.js: newOrder, userId, adminId, orderId
R=$(check_variable_preserved "newOrder" "newOrder"); MISSES=$((MISSES + R))
echo "| \`newOrder\` | index.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"
R=$(check_variable_preserved "userId" "userId"); MISSES=$((MISSES + R))
echo "| \`userId\` | index.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"
R=$(check_variable_preserved "adminId" "adminId"); MISSES=$((MISSES + R))
echo "| \`adminId\` | index.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"
R=$(check_variable_preserved "orderId" "orderId"); MISSES=$((MISSES + R))
echo "| \`orderId\` | index.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"

# user.js: newEmail
R=$(check_variable_preserved "newEmail" "newEmail"); MISSES=$((MISSES + R))
echo "| \`newEmail\` | user.js | $([ "$R" = "0" ] && echo "✅ 保留" || echo "❌ 误伤") |" >> "${TRIAL_DIR}/variable-misses.md"

echo "${MISSES}" > "${TRIAL_DIR}/misses.txt"

echo ""
echo "📊 变量名误伤总数: ${MISSES} / 7"

# 4. 加载链命中（仅 C 组）
if [ "${CONDITION}" = "C" ] && [ -n "${CHAIN_HIT}" ]; then
  echo "${CHAIN_HIT}" > "${TRIAL_DIR}/chain-hit.txt"
  IFS=',' read -r L1 L2 L3 <<< "${CHAIN_HIT}"
  HIT_COUNT=$((L1 + L2 + L3))
  HIT_RATE=$(echo "scale=2; ${HIT_COUNT} / 3" | bc 2>/dev/null || echo "?")
  echo "🔗 加载链命中: L1=${L1} L2=${L2} L3=${L3}（命中率 ${HIT_RATE}）"
fi

# 5. 汇总
echo ""
echo "============================================"
echo "试次 ${TRIAL_NAME} 记录完成"
echo "============================================"
echo "  误伤数: ${MISSES} / 7"
echo "  可运行: $([ "${RUN_EXIT}" = "0" ] && echo "✅" || echo "❌ exit ${RUN_EXIT}")"
echo "  diff:   ${DIFF_LINES} 行"
if [ "${CONDITION}" = "C" ] && [ -n "${CHAIN_HIT}" ]; then
  echo "  加载链: ${HIT_RATE}"
fi
echo ""
echo "结果已保存到: ${TRIAL_DIR}/"
echo "  - changes.diff"
echo "  - variable-misses.md"
echo "  - misses.txt"
echo "  - run-output.log / run-exit.txt"
[ "${CONDITION}" = "C" ] && echo "  - chain-hit.txt"
