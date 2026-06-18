#!/bin/bash
# ============================================================
# sofagent task-orchestrate.sh · AO 编排包装脚本
# ============================================================
# 包装 agency-orchestrator 的 ao compose，增加：
#   1. 工作区隔离（git worktree，多子任务不同分支互不干扰）
#   2. Harness 约束注入（加载链）
#   3. 编排预览（先看 DAG 再决定跑不跑）
#   4. 结果聚合 + 成本汇总
#   5. 自动清理 worktree
# 由 DeepSeek V4 Pro 辅助生成。
#

# 用法：
#   task-orchestrate.sh "帮我分析一个功能的可行性"
#   task-orchestrate.sh "重构用户模块" --dry-run
#   task-orchestrate.sh --worktree "重构用户模块"
#   task-orchestrate.sh --help
# ============================================================

# ao 不可用时降级提示（不报错退出）
if ! command -v ao &>/dev/null; then
  echo "[sofagent] ⚠️ agency-orchestrator (ao) 未安装——编排引擎不可用"
  echo "[sofagent] 降级方案：手动拆任务 → 用 task-record.sh 逐条记录 → 手动闭环"
  echo "[sofagent] 安装 ao: npm install -g agency-orchestrator  或  加 --no-ao 参数跳过"
  exit 0
fi

set -euo pipefail

VERSION="1.0.0"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[orchestrate]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# ── 四级编排深度（对应 Handbook §五）──
# 1=完整编排  2=模板复用  3=轻量调度  4=自主执行
LEVEL_DESC=("完整编排" "模板复用" "轻量调度" "自主执行")

# ── 参数 ──
TASK_DESC=""
DRY_RUN=false
USE_WORKTREE=false
AUTO_LEVEL=false
LEVEL=1  # 默认完整编排

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=true; shift ;;
    --worktree)   USE_WORKTREE=true; shift ;;
    --level)      LEVEL="$2"; shift 2 ;;
    --auto)       AUTO_LEVEL=true; shift ;;
    --version)    echo "sofagent-task-orchestrate v${VERSION}"; exit 0 ;;
    --help)
      echo "sofagent task-orchestrate v${VERSION}"
      echo "  包装 ao compose，加 worktree 隔离 + 约束注入 + 编排深度控制"
      echo ""
      echo "  用法:"
      echo "    task-orchestrate.sh \"任务描述\""
      echo "    task-orchestrate.sh \"任务描述\" --dry-run    仅预览编排"
      echo "    task-orchestrate.sh \"任务描述\" --worktree   创建独立 worktree"
      echo "    task-orchestrate.sh \"任务描述\" --level N    编排深度 (1-4)"
      echo "    task-orchestrate.sh \"任务描述\" --auto       自动选择最优深度"
      echo ""
      echo "  编排深度:"
      echo "    1=完整编排  首次运行，AO 全量分析拆解"
      echo "    2=模板复用  跳过 ao compose，直接用上次缓存的 YAML"
      echo "    3=轻量调度  从 orchestrator/ 读取预定义模板，跳过编排分析"
      echo "    4=自主执行  完全信任 Agent，裸调 ao run"
      echo ""
      echo "  智能特性:"
      echo "    --auto           基于历史成功率自动选择深度"
      echo "    工作流缓存       成功后存入 orchestrator/<hash>.yaml，下次 L2 可复用"
      echo "    成功率追踪      解析 task/logs，失败率 >40% 时写降级建议到 orchestrator/"
      echo ""
      echo "  已知局限:"
      echo "    L3 不分配子 Agent——子 Agent 分配由 ao 运行时处理"
      echo "    L3/L4 不做 Harness 约束注入和 worktree 隔离"
      echo ""
      echo "  依赖: agency-orchestrator (ao), git (worktree 模式)"
      exit 0
      ;;
    -*) err "未知参数: $1（--help 查看用法）"; exit 1 ;;
    *)  TASK_DESC="$1"; shift ;;
  esac
done

if [ -z "$TASK_DESC" ]; then
  err "缺少任务描述。用法: task-orchestrate.sh \"你的任务\""
  exit 1
fi

# ── 前置检查 ──
if ! command -v ao &>/dev/null; then
  err "agency-orchestrator (ao) 未安装。请先运行 install.sh"
  exit 1
fi

echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║   sofagent · task orchestrate    ║"
echo "  ╚═══════════════════════════════════╝"
echo ""
LEVEL_LABEL="${LEVEL_DESC[$((LEVEL-1))]:-完整编排}"
info "任务: $TASK_DESC"
info "编排深度: L${LEVEL} — ${LEVEL_LABEL}"
echo ""

# ── 生成任务唯一标识 ──
TASK_SLUG=$(echo "$TASK_DESC" | shasum -a 256 2>/dev/null | cut -c1-8 || echo "unknown")

# ── 读取 orchestrator/ 配置（如果存在）──
SOFAGENT_DATA="${PWD}/.sofagent"
ORCHESTRATOR_DIR="${SOFAGENT_DATA}/orchestrator"
WORKFLOWS_DIR="${ORCHESTRATOR_DIR}/workflows"
mkdir -p "$WORKFLOWS_DIR" 2>/dev/null || true
if [ -d "$ORCHESTRATOR_DIR" ]; then
  # 优先读取与本任务匹配的配置
  ORCH_CONFIG="${ORCHESTRATOR_DIR}/${TASK_SLUG}.json"
  if [ ! -f "$ORCH_CONFIG" ]; then
    ORCH_CONFIG="${ORCHESTRATOR_DIR}/_index.md"
  fi
  if [ -f "$ORCH_CONFIG" ]; then
    info "读取编排配置: ${ORCH_CONFIG}"
    if command -v jq &>/dev/null; then
      CONFIG_LEVEL=$(jq -r '(.level // .suggested_level // empty)' "$ORCH_CONFIG" 2>/dev/null || echo "")
      CONFIG_THRESHOLD=$(jq -r '.checkpoint // empty' "$ORCH_CONFIG" 2>/dev/null || echo "80")
      [ -n "$CONFIG_LEVEL" ] && LEVEL="$CONFIG_LEVEL"
    fi
  fi
else
  CONFIG_THRESHOLD=80
fi

# ════════════════════════════════════════
# Loop 智能层：工作流缓存 + 成功率追踪 + 级别建议
# ════════════════════════════════════════

CACHED_YAML="${WORKFLOWS_DIR}/${TASK_SLUG}.yaml"

# ── 分析历史成功率（近 5 次同名 or 同类任务）──
analyze_track_record() {
  local slug="$1"
  local total=0 success=0
  # 搜索 task/logs 中匹配的记录
  shopt -s nullglob 2>/dev/null || true
  for logfile in "${SOFAGENT_DATA}"/task/logs/*/*/*.md; do
    [ -f "$logfile" ] || continue
    grep -q "$slug" "$logfile" 2>/dev/null || continue
    while IFS= read -r line; do
      if echo "$line" | grep -q '状态 | 成功'; then
        ((success++)) || true; ((total++)) || true
      elif echo "$line" | grep -q '状态 | 失败'; then
        ((total++)) || true
      fi
    done < "$logfile"
  done
  shopt -u nullglob 2>/dev/null || true
  echo "$total $success"
}
sliding_window_rollback() {
  local slug="$1" current_level="$2" success_count=0 total=0
  shopt -s nullglob 2>/dev/null || true
  for logfile in "${SOFAGENT_DATA}"/task/logs/*/*/*.md; do
    [ -f "$logfile" ] || continue
    # 用 awk 提取匹配任务的执行状态行，支持 bash/sh 无引号转义
    awk -v task="$TASK_DESC" '
      /^## / { in_block = (index($0, task) > 0) ? 1 : 0 }
      in_block && /\| 状态/ { print }
    ' "$logfile"
  done | tail -5 > "${TMPDIR:-/tmp}/sofagent-rollback-$$.txt"
  while IFS= read -r line; do
    if echo "$line" | grep -q "成功"; then ((success_count++)) || true; fi
    ((total++)) || true
  done < "${TMPDIR:-/tmp}/sofagent-rollback-$$.txt"
  rm -f "${TMPDIR:-/tmp}/sofagent-rollback-$$.txt"
  if [ "$total" -ge 3 ] && [ $(( total - success_count )) -ge 2 ] && [ "$current_level" -gt 1 ]; then
    local new_level=$(( current_level - 1 ))
    info "滑窗回滚: 近 ${total} 次中 $(( total - success_count )) 次失败，建议 L${new_level}"
    mkdir -p "$ORCHESTRATOR_DIR"
    echo "{\"level\": ${new_level}, \"reason\": \"近${total}次运行中$((total-success_count))次失败\", \"last_update\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\", \"rolling_window_total\": ${total}, \"rolling_window_failures\": $((total-success_count))}" > "${ORCHESTRATOR_DIR}/${slug}.json"
    ok "回滚建议已写入: ${slug}.json"
  fi
}

TRACK_RECORD=$(analyze_track_record "$TASK_DESC")
read -r TOTAL_RUNS SUCCESS_RUNS <<< "$TRACK_RECORD"
TOTAL_RUNS=$(( TOTAL_RUNS > 0 ? TOTAL_RUNS : 0 ))
SUCCESS_RUNS=$(( SUCCESS_RUNS > 0 ? SUCCESS_RUNS : 0 ))
FAIL_RUNS=$(( TOTAL_RUNS - SUCCESS_RUNS ))

# ── 自动级别建议 ──
SUGGESTED_LEVEL="$LEVEL"
if [ "$TOTAL_RUNS" -ge 5 ] && [ "$SUCCESS_RUNS" -ge "$TOTAL_RUNS" ]; then
  # 100% 成功率 → 建议最高级
  SUGGESTED_LEVEL=4
elif [ "$TOTAL_RUNS" -ge 3 ] && [ "$SUCCESS_RUNS" -ge $(( TOTAL_RUNS - 1 )) ]; then
  # 3次以上且最多1次失败 → 建议跳过编排
  SUGGESTED_LEVEL=3
elif [ "$TOTAL_RUNS" -ge 1 ] && [ "$SUCCESS_RUNS" -ge 1 ] && [ -f "$CACHED_YAML" ]; then
  # 有成功记录且有缓存 → 建议模板复用
  SUGGESTED_LEVEL=2
fi

# ── 显示历史数据 ──
if [ "$TOTAL_RUNS" -gt 0 ]; then
  SUCCESS_PCT=$(( SUCCESS_RUNS * 100 / TOTAL_RUNS ))
  info "历史记录: ${TOTAL_RUNS} 次运行 · 成功率 ${SUCCESS_PCT}%"
  if [ "$SUGGESTED_LEVEL" -gt "$LEVEL" ]; then
    info "💡 建议升级到 L${SUGGESTED_LEVEL}（${LEVEL_DESC[$((SUGGESTED_LEVEL-1))]}），添加 --level ${SUGGESTED_LEVEL}"
  fi
fi

# ── --auto 模式：自动采纳建议级别 ──
if [ "$AUTO_LEVEL" = true ]; then
  LEVEL="$SUGGESTED_LEVEL"
  LEVEL_LABEL="${LEVEL_DESC[$((LEVEL-1))]}"
  info "🎯 自动模式: 采用 L${LEVEL} (${LEVEL_LABEL})"
fi

# ── 共享出口：滑窗回滚 + 清理 → exit（避免多出口散落）──
_exit_orchestrate() {
  local code="${1:-0}"
  sliding_window_rollback "$TASK_SLUG" "$LEVEL" || true
  exit "$code"
}

# ── 根据编排深度选择执行路径 ──
SKIP_AO_COMPOSE=false
SKIP_ORCHESTRATE=false

case $LEVEL in
  4) # L4 自主执行：完全信任 Agent，跳过所有编排
    info "L4 自主执行模式 — 跳过编排，直接交付 Agent"
    SKIP_ORCHESTRATE=true
    ;;
  3) # L3 模板调度：读 orchestrator/ JSON，用 AO 内置模板直接 ao run
    if [ -f "${ORCHESTRATOR_DIR}/${TASK_SLUG}.json" ]; then
      AO_TEMPLATE=$(jq -r '.ao_template // empty' "${ORCHESTRATOR_DIR}/${TASK_SLUG}.json" 2>/dev/null || echo "")
      if [ -n "$AO_TEMPLATE" ]; then
        info "L3 模板调度 — ao run ${AO_TEMPLATE}"
        # 直接从 JSON 提取输入变量
        AO_INPUTS=""
        while IFS= read -r pair; do
          [ -n "$pair" ] && AO_INPUTS="$AO_INPUTS --input $pair"
        done < <(jq -r '.inputs // {} | to_entries[] | "\(.key)=\(.value)"' "${ORCHESTRATOR_DIR}/${TASK_SLUG}.json" 2>/dev/null)
        info "Step 1-3/4 · L3 — 跳过编排，直接执行模板"
        START_TIME=$(date +%s)
        ao run "$AO_TEMPLATE" $AO_INPUTS 2>&1; EXIT_CODE=$?
        END_TIME=$(date +%s); ELAPSED=$(( END_TIME - START_TIME ))
        echo ""
        [ $EXIT_CODE -eq 0 ] && ok "任务完成（耗时 ${ELAPSED}s）" || warn "任务结束（exit $EXIT_CODE）"
        TLOG="$(cd "$(dirname "$0")" && pwd)/task-record.sh"
        [ -x "$TLOG" ] && bash "$TLOG" --task "${TASK_DESC} (L3/${AO_TEMPLATE})" --result "$([ $EXIT_CODE -eq 0 ] && echo '成功' || echo '失败')" --skills "orchestrate-L3,${AO_TEMPLATE}" 2>/dev/null || true
        echo ""
        echo "  编排结束。exit code: $EXIT_CODE · 深度: L3 (模板: ${AO_TEMPLATE})"
        _exit_orchestrate "$EXIT_CODE"
      fi
    fi
    warn "L3 模板缺失或 ao_template 字段为空，降级到 L2 缓存复用"
    LEVEL=2
    # fall through to L2
    if [ -f "$CACHED_YAML" ]; then
      WORKFLOW_FILE="$CACHED_YAML"
      ok "L2 模板复用 — 复用历史: ${TASK_SLUG}.yaml"
      SKIP_AO_COMPOSE=true
    else
      warn "L2 缓存缺失，降级到 L1 完整编排"
      LEVEL=1
    fi
    ;;
  2) # L2 模板复用：加载缓存的 YAML
    if [ -f "$CACHED_YAML" ]; then
      WORKFLOW_FILE="$CACHED_YAML"
      ok "L2 模板复用 — 复用历史: ${TASK_SLUG}.yaml"
      SKIP_AO_COMPOSE=true
    else
      warn "L2 缓存缺失，降级到 L1 完整编排"
      LEVEL=1
    fi
    ;;
esac

echo ""

# ── L4: 跳过所有编排步骤 → 直接执行 ──
if [ "$SKIP_ORCHESTRATE" = true ]; then
  info "Step 1-3/4 · L4 — 跳过编排/Harness/worktree"
  info "Step 4/4 · 直接执行任务..."
  START_TIME=$(date +%s)
  ao run "$TASK_DESC" 2>&1; EXIT_CODE=$?
  END_TIME=$(date +%s); ELAPSED=$(( END_TIME - START_TIME ))
  echo ""
  if [ $EXIT_CODE -eq 0 ]; then
    ok " 任务完成（耗时 ${ELAPSED}s）"
  else
    warn " 任务结束（exit $EXIT_CODE，耗时 ${ELAPSED}s）"
  fi
  TLOG="$(cd "$(dirname "$0")" && pwd)/task-record.sh"
  [ -x "$TLOG" ] && bash "$TLOG" --task "${TASK_DESC} (L4)" --result "$([ $EXIT_CODE -eq 0 ] && echo '成功' || echo '失败')" --skills "orchestrate-L4" 2>/dev/null || true
  echo ""
  echo "  ════════════════════════════════════"
  echo "  编排结束。exit code: $EXIT_CODE · 深度: L4 (自主执行)"
  echo ""
  exit $EXIT_CODE
fi

# ── Step 1: AO 编排预览 ──
if [ "$SKIP_AO_COMPOSE" = true ]; then
  info "Step 1/4 · L${LEVEL} — 跳过 ao compose，使用缓存模板"
  if [ "$DRY_RUN" = true ]; then
    ao explain "$WORKFLOW_FILE" 2>/dev/null || cat "$WORKFLOW_FILE" | head -10
    _exit_orchestrate 0
  fi
else
  # 正常路径：ao compose
  info "Step 1/4 · AO 编排分析..."

WORKFLOW_FILE="${TMPDIR:-/tmp}/sofagent-workflow-$$.yaml"

ao compose "$TASK_DESC" > "$WORKFLOW_FILE" 2>/dev/null || {
  warn "ao compose 未生成 YAML，尝试直接执行..."
  if [ "$DRY_RUN" = false ]; then
    ao compose "$TASK_DESC" --run
  fi
  EXIT_CODE=$?
}
# ao compose 失败时生成空工作流占位
[ -s "$WORKFLOW_FILE" ] || echo "# ao compose failed" > "$WORKFLOW_FILE"

# 显示编排计划
if [ -s "$WORKFLOW_FILE" ]; then
  ok "编排计划已生成"
  if command -v ao &>/dev/null; then
    info "编排预览:"
    ao explain "$WORKFLOW_FILE" 2>/dev/null || cat "$WORKFLOW_FILE" | head -20
  fi
else
  warn "编排计划为空，直接执行"
  if [ "$DRY_RUN" = false ]; then
    ao compose "$TASK_DESC" --run
  fi
  rm -f "$WORKFLOW_FILE"
  exit 0
fi

fi  # 结束 SKIP_AO_COMPOSE 分支

echo ""

# ── Dry-run 在此退出 ──
if [ "$DRY_RUN" = true ]; then
  info "dry-run 模式，编排计划已生成: $WORKFLOW_FILE"
  _exit_orchestrate 0
fi

# ── Step 2: Worktree 隔离 ──
WORKTREES=()
cleanup_worktrees() {
  for wt in "${WORKTREES[@]}"; do
    if [ -d "$wt" ]; then
      info "清理 worktree: $wt"
      git worktree remove "$wt" --force 2>/dev/null || rm -rf "$wt"
    fi
  done
}
trap cleanup_worktrees EXIT

if [ "$USE_WORKTREE" = true ] && git rev-parse --git-dir &>/dev/null; then
  info "Step 2/4 · 创建 worktree 隔离..."

  # 统计子任务数（从 YAML 中解析）
  sub_count=$(grep -c 'subtask\|agent\|workflow' "$WORKFLOW_FILE" 2>/dev/null || echo "1")
  sub_count=$(( sub_count > 0 ? sub_count : 1 ))
  [ "$sub_count" -gt 5 ] && sub_count=5  # 上限 5 个 parallel worktree

  BASE_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")

  for i in $(seq 1 "$sub_count"); do
    wt_name="sofagent-task-${i}-$$"
    wt_path="${TMPDIR:-/tmp}/${wt_name}"
    info "  创建 worktree $i/$sub_count: $wt_path"
    git worktree add "$wt_path" "$BASE_BRANCH" 2>/dev/null && WORKTREES+=("$wt_path") || {
      warn "  worktree 创建失败（可能已有同名 worktree），跳过隔离"
    }
  done

  if [ ${#WORKTREES[@]} -gt 0 ]; then
    ok "${#WORKTREES[@]} 个 worktree 就绪"
  fi
fi

echo ""

# ── Step 3: Harness 约束注入 ──
info "Step 3/4 · 注入 Harness 约束..."
OPENCLAW_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
HOOK_PATH="${OPENCLAW_DIR}/hooks/load-chain.sh"

if [ -f "$HOOK_PATH" ] && [ -x "$HOOK_PATH" ]; then
  # 生成约束块
  constraint_block=$(OPENCLAW_STATE_DIR="$OPENCLAW_DIR" bash "$HOOK_PATH" 2>/dev/null || echo "")
  if [ -n "$constraint_block" ]; then
    # 写入临时约束文件
    CONSTRAINT_FILE="${TMPDIR:-/tmp}/sofagent-constraint-$$.txt"
    echo "$constraint_block" > "$CONSTRAINT_FILE"
    ok "Harness 约束已注入 (${#constraint_block} 字符)"
    # AO 通过环境变量感知约束文件
    export SOFAGENT_CONSTRAINT_FILE="$CONSTRAINT_FILE"
  else
    warn "加载链未输出约束，检查安装状态"
  fi
else
  warn "加载链 Hook 未找到: $HOOK_PATH"
  warn "请先运行 install.sh 完成部署"
fi

echo ""

# ── Step 4: 执行编排 ──
info "Step 4/4 · 执行任务编排..."
START_TIME=$(date +%s)

ao run "$WORKFLOW_FILE" 2>&1
EXIT_CODE=$?

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))

echo ""

# ── 结果汇总 ──
if [ $EXIT_CODE -eq 0 ]; then
  ok " 任务完成（耗时 ${ELAPSED}s）"
  # 成功后缓存工作流（Level 1 时才生成新 YAML，值得缓存）
  if [ "$SKIP_AO_COMPOSE" = false ] && [ -f "$WORKFLOW_FILE" ]; then
    mkdir -p "$ORCHESTRATOR_DIR"
    cp "$WORKFLOW_FILE" "$CACHED_YAML" 2>/dev/null && \
      info "工作流已缓存: ${TASK_SLUG}.yaml (下次可用 L2 复用)"
  fi
else
  warn " 任务结束（exit $EXIT_CODE，耗时 ${ELAPSED}s）"
fi

# 记录到 task/logs
if command -v bash &>/dev/null; then
  TASK_LOG_SCRIPT="$(cd "$(dirname "$0")" && pwd)/task-record.sh"
  if [ -x "$TASK_LOG_SCRIPT" ]; then
    bash "$TASK_LOG_SCRIPT" \
      --task "${TASK_DESC} (L${LEVEL})" \
      --result "$([ $EXIT_CODE -eq 0 ] && echo '成功' || echo '失败')" \
      --model "${AO_MODEL:-未记录}" \
      --cost "${AO_COST:--}" \
      --skills "orchestrate-L${LEVEL}" 2>/dev/null || true
  fi
fi

# ── 滑窗回滚：分析最近 5 次，写降级建议 ──

# 清理
rm -f "$WORKFLOW_FILE" "${SOFAGENT_CONSTRAINT_FILE:-}"

echo ""
echo "  ════════════════════════════════════"
echo "  编排结束。exit code: $EXIT_CODE · 深度: L${LEVEL} (${LEVEL_LABEL})"
echo ""

_exit_orchestrate "$EXIT_CODE"
