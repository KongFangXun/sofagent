#!/usr/bin/env bash
# ============================================================
# sofagent-dashboard.test.sh · Dashboard bash 渲染测试（v1.2.3）
#
# 覆盖（对应 T03 验收标准）：
#   1. graph-state.json 新格式 → 控制图渲染（节点/状态图标/子任务/wave/降级）
#   2. graph-state.json 不存在 → 兜底文本
#   3. 旧三字段格式 → 向后兼容渲染（不崩溃）
#   4. forge latest.json 不存在 → 兜底文本
#   5. forge latest.json 存在 → A/B 状态 + 轮次 + 当前文件渲染
#   6. workspace-changes.jsonl 不存在 → 兜底文本
#   7. workspace-changes.jsonl 存在 → 最近变更渲染
#   8. humanize_status 映射（默认用户可读 / --technical 技术状态）
#   9. 整帧渲染不崩溃（fixture 数据全量）
#
# 机制：SOFAGENT_HOME 指向 fixture 目录；SOFAGENT_DASHBOARD_LIB_ONLY=1
# source dashboard 脚本复用 render_* 函数（不触发主入口渲染循环）。
# ============================================================

set -u

TESTS_RUN=0
TESTS_FAILED=0

TEST_ROOT="$(mktemp -d -t sofagent-dashboard-test.XXXXXX)"
trap 'rm -rf "$TEST_ROOT"' EXIT

# ────────────────────────────────
# 断言工具（TAP 风格输出）
# ────────────────────────────────

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    printf 'ok %d - %s\n' "$TESTS_RUN" "$label"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf 'not ok %d - %s\n' "$TESTS_RUN" "$label"
    printf '%s\n' "  期望包含: $needle"
    printf '%s\n' "$haystack" | sed 's/^/  实际: /' | head -20
  fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf 'not ok %d - %s\n' "$TESTS_RUN" "$label"
    printf '%s\n' "  期望不含: $needle"
  else
    printf 'ok %d - %s\n' "$TESTS_RUN" "$label"
  fi
}

# ────────────────────────────────
# fixture：SOFAGENT_HOME 指向临时目录
# ────────────────────────────────

export SOFAGENT_HOME="$TEST_ROOT/fake-home"
export SOFAGENT_DASHBOARD_NO_COLOR=1
export SOFAGENT_DASHBOARD_LIB_ONLY=1
mkdir -p "$SOFAGENT_HOME/data/dashboard"

DASHBOARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=sofagent-dashboard.sh
# shellcheck disable=SC1091  # 动态路径 source（fixture 机制），shellcheck 无法跟随——属误报
source "$DASHBOARD_DIR/sofagent-dashboard.sh"

# 渲染函数到内容（清空缓冲区后捕获）
render_to() {
  : > "$BUFFER_FILE"
  "$@"
  cat "$BUFFER_FILE"
}

DATA_ROOT_TEST="$SOFAGENT_HOME/data"

# ════════════════════════════════════════
# 1. graph-state.json 新格式 → 完整控制图渲染
# ════════════════════════════════════════

cat > "$DATA_ROOT_TEST/dashboard/graph-state.json" <<'EOF'
{
  "nodes": [
    {"id": "plan", "type": "planner", "label": "Planner", "status": "completed"},
    {"id": "engineer-1", "type": "engineer", "label": "Engineer", "status": "running",
     "subtasks": [
       {"id": "st-1", "desc": "实现 worktree 隔离", "status": "done"},
       {"id": "st-2", "desc": "实现 merge gate", "status": "pending"}
     ]},
    {"id": "audit-1", "type": "audit", "label": "Audit", "status": "pending"},
    {"id": "reviewer-1", "type": "reviewer", "label": "Reviewer", "status": "pending"},
    {"id": "human-1", "type": "human", "label": "Human Confirm", "status": "pending"}
  ],
  "edges": [
    {"from": "plan", "to": "engineer-1", "type": "data-flow"},
    {"from": "engineer-1", "to": "audit-1", "type": "data-flow"},
    {"from": "audit-1", "to": "reviewer-1", "type": "data-flow"},
    {"from": "reviewer-1", "to": "human-1", "type": "data-flow"}
  ],
  "wave": 2,
  "degradationLevel": 1,
  "activeNode": "engineer",
  "workGraphTasks": 2,
  "updatedAt": "2026-07-30T00:00:00Z"
}
EOF

OUT="$(render_to render_graph_engine 100)"
assert_contains "控制图：5 节点链渲染" "$OUT" "[plan] ──→ [engineer] ──→ [audit] ──→ [reviewer] ──→ [confirm]"
assert_contains "控制图：completed 状态用户可读（已完成）" "$OUT" "已完成"
assert_contains "控制图：running 状态用户可读（正在执行）" "$OUT" "正在执行"
assert_contains "控制图：completed 图标 ✅" "$OUT" "✅"
assert_contains "控制图：running 图标 🔵" "$OUT" "🔵"
assert_contains "控制图：engineer 子任务 st-1 展开" "$OUT" "st-1"
assert_contains "控制图：子任务描述渲染" "$OUT" "实现 worktree 隔离"
assert_contains "控制图：子任务 st-2 pending 图标 ⏳" "$OUT" "⏳"
assert_contains "控制图：Wave 渲染" "$OUT" "Wave: 2"
assert_contains "控制图：降级等级 L1 + 人类可读说明" "$OUT" "L1（已简化任务范围（核心功能优先））"

# ════════════════════════════════════════
# 2. graph-state.json 不存在 → 兜底文本
# ════════════════════════════════════════

mv "$DATA_ROOT_TEST/dashboard/graph-state.json" "$TEST_ROOT/graph-state.bak"
OUT="$(render_to render_graph_engine 100)"
assert_contains "graph-state 缺失：兜底文本" "$OUT" "控制图数据不可用（编排引擎未运行）"
mv "$TEST_ROOT/graph-state.bak" "$DATA_ROOT_TEST/dashboard/graph-state.json"

# ════════════════════════════════════════
# 3. 旧三字段格式 → 向后兼容（不崩溃）
# ════════════════════════════════════════

mv "$DATA_ROOT_TEST/dashboard/graph-state.json" "$TEST_ROOT/graph-state-v2.bak"
cat > "$DATA_ROOT_TEST/dashboard/graph-state.json" <<'EOF'
{"activeNode": "audit", "workGraphTasks": 3, "updatedAt": "2026-07-30T00:00:00Z"}
EOF
OUT="$(render_to render_graph_engine 100)"
assert_contains "旧格式：活跃节点渲染" "$OUT" "活跃节点: audit"
assert_contains "旧格式：Work Graph 任务数渲染" "$OUT" "Work Graph 任务数: 3"
# 活跃节点在流转链中以 [ ] 高亮（这里是 [audit]）
assert_contains "旧格式：ASCII 流转链保留（活跃节点高亮）" "$OUT" "plan → engineer → [audit] → reviewer → human_confirm"
assert_not_contains "旧格式：不渲染新控制图节点链" "$OUT" "[plan] ──→ [engineer]"
mv "$TEST_ROOT/graph-state-v2.bak" "$DATA_ROOT_TEST/dashboard/graph-state.json"

# ════════════════════════════════════════
# 4. forge latest.json 不存在 → 兜底文本
# ════════════════════════════════════════

OUT="$(render_to render_forge_progress 100)"
assert_contains "FORGE：latest.json 缺失兜底" "$OUT" "无正在运行的 FORGE 审查"

# ════════════════════════════════════════
# 5. forge latest.json 存在 → A/B 进度面板
# ════════════════════════════════════════

FORGE_RUN_DIR="$DATA_ROOT_TEST/forge-runs/fresh-eyes-loop/2026-07-30/run-01"
mkdir -p "$FORGE_RUN_DIR/round-02"
cat > "$DATA_ROOT_TEST/forge-runs/fresh-eyes-loop/latest.json" <<'EOF'
{
  "runDir": "forge-runs/fresh-eyes-loop/2026-07-30/run-01",
  "round": 2,
  "totalRounds": 5,
  "stopReason": null,
  "agentA": { "status": "running", "currentFile": "graph.ts", "findings": 3, "cumulative": "P0×1 P1×4" },
  "agentB": { "status": "running", "currentFile": "nodes.ts", "findings": 1, "cumulative": "P0×0 P1×2" },
  "updatedAt": "2026-07-30T00:30:00Z"
}
EOF
# sub-progress jsonl 的当前文件优先于 latest.json 的 currentFile
cat > "$FORGE_RUN_DIR/round-02/sub-progress-A.jsonl" <<'EOF'
{"ts":"2026-07-30T00:29:00Z","role":"A","tool":"sf_read","target":"/abs/repo/src/loop/graph.ts","phase":"start"}
{"ts":"2026-07-30T00:30:00Z","role":"A","tool":"sf_read","target":"/abs/repo/src/loop/live-file.ts","phase":"start"}
EOF

OUT="$(render_to render_forge_progress 120)"
assert_contains "FORGE：轮次渲染" "$OUT" "第 2 轮 / 共 5 轮"
assert_contains "FORGE：Agent A 行渲染" "$OUT" "Agent A（审查模型）"
assert_contains "FORGE：Agent B 行渲染" "$OUT" "Agent B（工程模型）"
assert_contains "FORGE：A 本轮发现数" "$OUT" "本轮发现: 3"
assert_contains "FORGE：A 累计" "$OUT" "累计: P0×1 P1×4"
assert_contains "FORGE：B 累计" "$OUT" "累计: P0×0 P1×2"
assert_contains "FORGE：当前文件取自 sub-progress jsonl（优先于指针）" "$OUT" "live-file.ts"
assert_contains "FORGE：双盲状态" "$OUT" "双盲"
assert_contains "FORGE：run 标识 #01" "$OUT" "#01"

# ════════════════════════════════════════
# 6. workspace-changes.jsonl 不存在 → 兜底文本
# ════════════════════════════════════════

OUT="$(render_to render_workspace_changes 100)"
assert_contains "最近变更：jsonl 缺失兜底" "$OUT" "无变更记录"

# ════════════════════════════════════════
# 7. workspace-changes.jsonl 存在 → 最近变更渲染
# ════════════════════════════════════════

cat > "$DATA_ROOT_TEST/dashboard/workspace-changes.jsonl" <<'EOF'
{"timestamp":"2026-07-30T00:20:00Z","runId":"loop-2026-07-30-001","created":["a.ts","b.ts","c.ts"],"modified":["README.md"],"deleted":[]}
{"timestamp":"2026-07-30T00:25:00Z","runId":"loop-2026-07-30-002","created":[],"modified":["x.ts","y.ts"],"deleted":["old.ts"]}
EOF

OUT="$(render_to render_workspace_changes 100)"
assert_contains "最近变更：最新 run 在前" "$OUT" "loop-2026-07-30-002"
assert_contains "最近变更：新建计数" "$OUT" "✚ 新建 3 个文件"
assert_contains "最近变更：修改计数" "$OUT" "✎ 修改 2 个文件"
assert_contains "最近变更：删除计数" "$OUT" "✗ 删除 1 个文件"

# ════════════════════════════════════════
# 8. humanize_status 映射
# ════════════════════════════════════════

TECHNICAL=0
assert_contains "humanize：running → 正在执行" "$(humanize_status running)" "正在执行"
assert_contains "humanize：completed → 已完成" "$(humanize_status completed)" "已完成"
assert_contains "humanize：awaiting_human → 等待你的确认" "$(humanize_status awaiting_human)" "等待你的确认"
assert_contains "humanize：audit FAIL → 审计未通过" "$(humanize_status "audit FAIL")" "审计未通过"
assert_contains "humanize：degradationLevel:1 → 简化范围" "$(humanize_status "degradationLevel:1")" "已简化任务范围（核心功能优先）"
assert_contains "humanize：degradationLevel:2 → 低可信" "$(humanize_status "degradationLevel:2")" "低可信度（结果需人工复核）"
assert_contains "humanize：未知 key 原样透传" "$(humanize_status "some-unknown")" "some-unknown"

# shellcheck disable=SC2034  # TECHNICAL 被 source 进来的 dashboard 脚本读取——跨文件引用，属误报
TECHNICAL=1
assert_contains "humanize --technical：running 原样" "$(humanize_status running)" "running"
assert_contains "humanize --technical：audit FAIL 原样" "$(humanize_status "audit FAIL")" "audit FAIL"
# shellcheck disable=SC2034
TECHNICAL=0

# --technical e2e：整脚本以 --technical 运行 → 技术词而非用户可读词
# 注意：env -u 去掉 LIB_ONLY（本测试进程 export 了它，不清掉子进程会跳过主入口）
OUT="$(env -u SOFAGENT_DASHBOARD_LIB_ONLY SOFAGENT_HOME="$SOFAGENT_HOME" bash "$DASHBOARD_DIR/sofagent-dashboard.sh" --technical 2>/dev/null)"
assert_contains "--technical e2e：技术状态词 completed" "$OUT" "completed"
assert_not_contains "--technical e2e：不出现用户可读词 已完成" "$OUT" "已完成"

# ════════════════════════════════════════
# 9. 整帧渲染不崩溃（fixture 数据全量）
# ════════════════════════════════════════

OUT="$(render_to render_frame)"
assert_contains "整帧：Graph Engine 区块存在" "$OUT" "Graph Engine"
assert_contains "整帧：FORGE 区块存在" "$OUT" "FORGE 审查"
assert_contains "整帧：最近变更区块存在" "$OUT" "最近变更"

# ════════════════════════════════════════
# 汇总
# ════════════════════════════════════════

printf '\n%d 个测试，%d 失败\n' "$TESTS_RUN" "$TESTS_FAILED"
if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
printf '全部通过 ✅\n'
exit 0
