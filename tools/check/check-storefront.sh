#!/usr/bin/env bash
# ============================================================
# check-storefront.sh · 仓外门面对账（v1.4.4 P-6 · C-3 + D-11-1 合并落地）
#
# 门禁目的：仓内数字有 check-docs/check-test-count 守护，仓外门面
#   （GitHub description / homepage / topics 数量）此前零守卫——
#   「66 tools」漂移三版无人拦的根因（v1.4.4 审查第四份 P1 实证）。
#   一条对外声称 = 一条可执行断言（含仓外元数据）。
#
# 对账面（三断言）：
#   ① description 工具数 = tool-registry.ts 实数（name: 'xxx' 去重计数）
#   ② description 插件数 = dsh-plugins + openclaw-plugins 目录实数
#   ③ homepage = https（非 http），且 package.json version 与发版时点对齐提示
#
# 降级语义：gh / npm 不可达（离线/无凭证）→ SKIP 并显著提示，
#   不静默假绿（门禁三态：PASS / FAIL / SKIP-可见）。
#   CI 中 gh 凭证缺失时本节自动 SKIP——发布流程在本地跑（有 gh 登录态）。
#
# 用法：bash tools/check/check-storefront.sh
#   EXIT 0 = 全部对账通过；EXIT 1 = 有 FAIL；SKIP 不影响退出码但打印醒目提示
# ============================================================

cd "$(dirname "$0")/../.." || exit 1

FAILS=0
SKIPS=0

echo "🔍 仓外门面对账（GitHub 元数据 × 仓库实数）"
echo "════════════════════════════════════════════════════════════"

# ── 仓内实数提取（与 check-docs §15 同源口径）──
TOOL_COUNT=$(node -e "
const fs = require('fs');
const regSrc = fs.readFileSync('engine/mcp/src/tool-registry.ts', 'utf8');
const regCount = new Set([...regSrc.matchAll(/name:\s*'([a-z_]+)',/g)].map(m => m[1])).size;
console.log(regCount);
" 2>/dev/null || echo "")

DSH_COUNT=0
for d in engine/dsh-plugins/cordis-plugin-sofagent-*; do
  [ -d "$d" ] && DSH_COUNT=$((DSH_COUNT + 1))
done
OC_COUNT=0
for d in engine/openclaw-plugins/sofagent-*; do
  [ -d "$d" ] && OC_COUNT=$((OC_COUNT + 1))
done
PLUGIN_TOTAL=$((DSH_COUNT + OC_COUNT))

if [ -z "$TOOL_COUNT" ] || [ "$TOOL_COUNT" = "0" ]; then
  echo "  ❌ tool-registry.ts 解析失败（TOOL_COUNT 空）——脚本口径可能过期"
  FAILS=$((FAILS + 1))
fi
echo "  仓内实数：MCP tools = ${TOOL_COUNT} · 插件 = ${PLUGIN_TOTAL}（DSH ${DSH_COUNT} + OpenClaw ${OC_COUNT}）"
echo ""

# ── gh 可达性探测（三态门禁的 SKIP 分支）──
GH_DESC=$(gh api repos/KongFangXun/sofagent --jq .description 2>/dev/null)
GH_HOME=$(gh api repos/KongFangXun/sofagent --jq .homepage 2>/dev/null)
GH_TOPIC_COUNT=$(gh api repos/KongFangXun/sofagent --jq '.topics | length' 2>/dev/null)

if [ -z "$GH_DESC" ] && [ -z "$GH_HOME" ] && [ -z "$GH_TOPIC_COUNT" ]; then
  echo "  ⏭️  SKIP：gh 不可达（离线 / 未登录）——仓外门面本轮未对账，发布流程须在本地补跑"
  SKIPS=$((SKIPS + 1))
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  SKIP=${SKIPS} FAIL=0（SKIP 不阻断，发布前必须补跑）"
  exit 0
fi

# ── 断言 ①：description 工具数 ──
# 匹配「(N tools」形态——括号内可以是「(79 tools)」单声称，也可「(80 tools, 13 plugins)」复合声称
DESC_TOOLS=$(echo "$GH_DESC" | grep -oE '\(([0-9]+) tools' | grep -oE '[0-9]+' || echo "")
if [ -z "$DESC_TOOLS" ]; then
  echo "  ❌ [description] 未找到「(N tools)」声称——description 格式漂移或被改写"
  echo "      当前：${GH_DESC}"
  FAILS=$((FAILS + 1))
elif [ "$DESC_TOOLS" != "$TOOL_COUNT" ]; then
  echo "  ❌ [description] 工具数漂移：声称 ${DESC_TOOLS} ≠ 实数 ${TOOL_COUNT}"
  echo "      当前：${GH_DESC}"
  echo "      修法：gh repo edit --description 更新（数字以 tool-registry.ts 实数为准）"
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [description] 工具数 ${DESC_TOOLS} = 实数 ${TOOL_COUNT}"
fi

# ── 断言 ②：description 插件数 ──
DESC_PLUGINS=$(echo "$GH_DESC" | grep -oE '([0-9]+) plugins' | grep -oE '[0-9]+' || echo "")
if [ -z "$DESC_PLUGINS" ]; then
  echo "  ❌ [description] 未找到「N plugins」声称——description 格式漂移或被改写"
  FAILS=$((FAILS + 1))
elif [ "$DESC_PLUGINS" != "$PLUGIN_TOTAL" ]; then
  echo "  ❌ [description] 插件数漂移：声称 ${DESC_PLUGINS} ≠ 实数 ${PLUGIN_TOTAL}（DSH ${DSH_COUNT} + OC ${OC_COUNT}）"
  echo "      修法：gh repo edit --description 更新"
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [description] 插件数 ${DESC_PLUGINS} = 实数 ${PLUGIN_TOTAL}"
fi

# ── 断言 ③：homepage https ──
if echo "$GH_HOME" | grep -q '^http://'; then
  echo "  ❌ [homepage] 使用 http 非 https：${GH_HOME}"
  echo "      修法：gh repo edit --homepage（https 版）"
  FAILS=$((FAILS + 1))
elif [ -z "$GH_HOME" ]; then
  echo "  ⏭️  [homepage] 未设置——非阻断（有值时纳入 https 断言）"
  SKIPS=$((SKIPS + 1))
else
  echo "  ✓ [homepage] ${GH_HOME}"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$FAILS" -gt 0 ]; then
  echo "  FAIL=${FAILS} SKIP=${SKIPS}——仓外门面与仓内实数不一致，发版前必须修正"
  exit 1
else
  echo "  FAIL=0 SKIP=${SKIPS}——仓外门面对账通过"
  exit 0
fi
