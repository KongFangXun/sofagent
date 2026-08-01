#!/usr/bin/env bash
# ============================================================
# FORGE/playbook/release-gate-orchestrator.sh
#
# release-gate-loop 外层编排脚本（方案 A+C 组合）。
#
# 每个步骤启动一个独立的 Node 进程（driver --step <name>），
# 跑完即退、内存归零，避免 LangGraph 实例跨步骤累积导致 OOM。
#
# 支持断点续跑：如果某步的产物已存在（之前跑成功过），跳过该步。
#
# 用法：
#   bash FORGE/playbook/release-gate-orchestrator.sh <version> [--skip-acceptance]
#   bash FORGE/playbook/release-gate-orchestrator.sh v1.2.4
#   bash FORGE/playbook/release-gate-orchestrator.sh v1.2.4 --skip-acceptance
# ============================================================

set -euo pipefail

# ─── 项目路径 ────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DRIVER="${REPO_ROOT}/FORGE/src/release-gate-driver.mjs"

# ─── run 目录基础路径（与 driver 的 resolveRunDir 逻辑一致）──
SOFAGENT_HOME="${SOFAGENT_HOME:-${HOME}/.sofagent}"
RUNS_BASE="${SOFAGENT_HOME}/data/forge-runs/release-gate-loop"

# ─── 步骤定义 ────────────────────────────────────────────────
STEPS=("acceptance" "regression" "coverage" "consolidate" "verdict")

# 每步的产物文件名（与 driver STEPS[].outputs 一致）
declare -A STEP_ARTIFACTS=(
  ["acceptance"]="acceptance.md"
  ["regression"]="regression.md"
  ["coverage"]="coverage.md"
  ["consolidate"]="stage6-report.md"
  ["verdict"]="verdict.md"
)

# ─── 参数解析 ────────────────────────────────────────────────
TARGET="${1:-}"
EXTRA_ARGS=""

if [[ -z "${TARGET}" ]]; then
  echo "用法: bash $0 <version> [--skip-acceptance]"
  echo "示例: bash $0 v1.2.4"
  echo "      bash $0 v1.2.4 --skip-acceptance"
  exit 1
fi
shift

# 剩余参数透传给 driver（如 --skip-acceptance）
while [[ $# -gt 0 ]]; do
  EXTRA_ARGS="${EXTRA_ARGS} $1"
  shift
done

# ─── 发现或创建 run 目录 ─────────────────────────────────────
# 逻辑：
#   1. 如果今天的 run 目录已存在且至少有 1 个产物文件 -> 复用（断点续跑）
#   2. 否则创建新的 run-NN 目录
TODAY=$(date +%Y-%m-%d)
TODAY_DIR="${RUNS_BASE}/${TODAY}"

# 找到今天最新的 run 目录（如果存在）
LATEST_RUN_DIR=""
if [[ -d "${TODAY_DIR}" ]]; then
  # 找最新的 run-NN 目录
  LATEST_RUN_DIR=$(ls -d "${TODAY_DIR}"/run-* 2>/dev/null | sort -V | tail -1 || true)
fi

if [[ -n "${LATEST_RUN_DIR}" && -d "${LATEST_RUN_DIR}" ]]; then
  # 检查该目录是否已有产物文件（断点续跑）
  HAS_ARTIFACT=false
  for step in "${STEPS[@]}"; do
    artifact="${LATEST_RUN_DIR}/${STEP_ARTIFACTS[$step]}"
    if [[ -f "${artifact}" ]]; then
      HAS_ARTIFACT=true
      break
    fi
  done
  if [[ "${HAS_ARTIFACT}" == "true" ]]; then
    RUN_DIR="${LATEST_RUN_DIR}"
    echo "[orchestrator] 断点续跑，复用已有 run 目录: ${RUN_DIR}"
  else
    # 目录存在但无产物，可能是个空目录或失败的 run，新建下一个
    LAST_NUM=$(basename "${LATEST_RUN_DIR}" | sed 's/run-//')
    NEXT_NUM=$((LAST_NUM + 1))
    RUN_DIR="${TODAY_DIR}/run-$(printf '%02d' "${NEXT_NUM}")"
    mkdir -p "${RUN_DIR}"
    echo "[orchestrator] 新建 run 目录: ${RUN_DIR}"
  fi
else
  # 今天还没有 run 目录，创建 run-01
  RUN_DIR="${TODAY_DIR}/run-01"
  mkdir -p "${RUN_DIR}"
  echo "[orchestrator] 新建 run 目录: ${RUN_DIR}"
fi

echo "[orchestrator] target    = ${TARGET}"
echo "[orchestrator] extra     =${EXTRA_ARGS}"
echo "[orchestrator] run-dir   = ${RUN_DIR}"
echo ""

# ─── 逐步执行 ────────────────────────────────────────────────
FAILED_STEPS=()
TOTAL_START=$(date +%s)

for step in "${STEPS[@]}"; do
  step_index=$((${STEPS[*]/$step//} == ${STEPS[*]} ? 0 : 1))
  # 计算步骤序号
  step_num=0
  for i in "${!STEPS[@]}"; do
    if [[ "${STEPS[$i]}" == "${step}" ]]; then
      step_num=$((i + 1))
      break
    fi
  done

  artifact="${RUN_DIR}/${STEP_ARTIFACTS[$step]}"

  echo "=== [${step}] 启动 $(date '+%H:%M:%S') ==="
  echo "    步骤 ${step_num}/${#STEPS[@]}"

  # 断点续跑：产物已存在则跳过
  if [[ -f "${artifact}" ]]; then
    echo "    跳过（已完成）：${artifact} 已存在"
    echo "=== [${step}] 跳过 ==="
    echo ""
    continue
  fi

  # 启动 driver 单步模式
  step_start=$(date +%s)
  set +e
  eval "node '${DRIVER}' --target '${TARGET}' --step '${step}' --run-dir '${RUN_DIR}' ${EXTRA_ARGS}"
  EXIT_CODE=$?
  set -e
  step_end=$(date +%s)
  step_elapsed=$((step_end - step_start))

  if [[ ${EXIT_CODE} -ne 0 ]]; then
    echo "=== [${step}] 失败 exit_code=${EXIT_CODE} 耗时 ${step_elapsed}s ==="
    # 检查产物是否在失败前已生成（部分成功）
    if [[ ! -f "${artifact}" ]]; then
      echo "[orchestrator] 错误：步骤 ${step} 失败且产物 ${STEP_ARTIFACTS[$step]} 不存在"
      echo "[orchestrator] 编排中止。修复后重新运行可断点续跑："
      echo "    bash $0 ${TARGET}${EXTRA_ARGS:+ ${EXTRA_ARGS}}"
      exit 1
    else
      echo "[orchestrator] 警告：步骤 ${step} exit code=${EXIT_CODE}，但产物已生成，继续下一步"
    fi
  else
    echo "=== [${step}] 完成 耗时 ${step_elapsed}s ==="
  fi
  echo ""
done

TOTAL_END=$(date +%s)
TOTAL_ELAPSED=$((TOTAL_END - TOTAL_START))

# ─── 总结 ────────────────────────────────────────────────────
VERDICT_PATH="${RUN_DIR}/verdict.md"

echo "============================================================"
echo "[orchestrator] 全部步骤完成"
echo "  总耗时:    ${TOTAL_ELAPSED}s"
echo "  run 目录:  ${RUN_DIR}"
echo "  verdict:   ${VERDICT_PATH}"
echo "============================================================"

if [[ -f "${VERDICT_PATH}" ]]; then
  echo ""
  echo "--- verdict.md ---"
  cat "${VERDICT_PATH}"
  echo "--- end ---"
fi
