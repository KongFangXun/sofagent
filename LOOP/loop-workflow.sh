#!/usr/bin/env bash
# ============================================================
# loop-workflow.sh — 运行 workflow.yml 中的子任务循环
# 用法: bash loop-workflow.sh path/to/workflow.yml
# ============================================================
set -euo pipefail

WORKFLOW_FILE="${1:-}"
if [ -z "$WORKFLOW_FILE" ]; then
  echo "用法: bash loop-workflow.sh <workflow.yml>"
  exit 1
fi

if [ ! -f "$WORKFLOW_FILE" ]; then
  echo "❌ 文件不存在: $WORKFLOW_FILE"
  exit 1
fi

if [ "${LOOP_AUTO:-}" != "1" ]; then
  echo "⚠️  提示: 建议设置 LOOP_AUTO=1 启用全自动模式，否则每个子任务后需人工确认"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 用 tsx 运行 workflow 引擎（需要 Node.js）
npx tsx -e "
import { runLoopWorkflow } from '${SCRIPT_DIR}/src/workflow';
runLoopWorkflow('${WORKFLOW_FILE}', { stopOnBlocked: true })
  .then(r => {
    console.log('\\n=== 结果 ===');
    console.log('工作流: ' + r.workflowName);
    console.log('完成: ' + r.nodesCompleted + '/' + r.nodesTotal);
    console.log('终态: ' + r.finalStatus);
    process.exit(r.finalStatus === 'completed' ? 0 : 2);
  })
  .catch(e => {
    console.error(e.message || e);
    process.exit(1);
  });
"
