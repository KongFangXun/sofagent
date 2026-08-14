#!/usr/bin/env bash
# tools/check-deps.sh
# sofagent 关键依赖版本检查——发版前跑一次，或定期手动跑
#
# 检查范围：
#   🟢 通用工具库（js-yaml / zod / archiver）
#   🟡 核心框架 LangGraph 三件套（langgraph / core / openai）
#   🔴 精确锁版 automerge（1.0.1-preview.7 禁止升 2.x）
#   🔵 DSH deepseek-harness（npm 已发布 2026-08-14：@deepseek-ai/dsh + @deepseek-ai/cordis）
#
# 用法：
#   bash tools/check-deps.sh            # 全量检查
#   bash tools/check-deps.sh --quiet    # 只输出有问题的
#
# 退出码：0=全部最新 / 1=有落后版本

set -euo pipefail

QUIET="false"
[ "${1:-}" = "--quiet" ] && QUIET="true"

echo "🔍 sofagent 关键依赖版本检查"
echo "════════════════════════════════════════════════════════════"
printf "%-40s %-22s %-18s %s\n" "依赖" "当前版本" "最新版本" "状态"
echo "─────────────────────────────────────────────────────────────"

HAS_OUTDATED=0

check_npm() {
  local name="$1"
  local current="$2"
  local latest
  latest=$(npm view "$name" version 2>/dev/null || echo "❓ 未找到")

  local status="✅ 最新"
  if [ "$latest" = "❓ 未找到" ]; then
    status="❓ npm 上未找到"
  elif [ "$current" != "$latest" ]; then
    status="⚠️  有新版本"
    HAS_OUTDATED=1
  fi

  if [ "$QUIET" = "true" ] && [ "$status" = "✅ 最新" ]; then
    return
  fi

  printf "%-40s %-22s %-18s %s\n" "$name" "$current" "$latest" "$status"
}

echo ""
echo "🟢 通用工具库"
echo "─────────────────────────────────────────────────────────────"
check_npm "js-yaml" "5.2.0"
check_npm "zod" "4.4.3"
check_npm "archiver" "7.0.0"

echo ""
echo "🟡 核心框架（LangGraph 三件套）"
echo "─────────────────────────────────────────────────────────────"
check_npm "@langchain/langgraph" "1.4.7"
check_npm "@langchain/core" "1.2.3"
check_npm "@langchain/openai" "1.5.5"

echo ""
echo "🔴 精确锁版（禁止自动升级）"
echo "─────────────────────────────────────────────────────────────"
# automerge 特殊处理——只报告最新版，不标"有新版本"（因为 2.x 不能升）
AUTOMERGE_LATEST=$(npm view automerge version 2>/dev/null || echo "❓")
AUTOMERGE_ALPHA=$(npm view automerge dist-tags.alpha 2>/dev/null || echo "无 alpha")
printf "%-40s %-22s %-18s %s\n" "automerge" "1.0.1-preview.7" "$AUTOMERGE_LATEST" "🔒 精确锁（禁升 2.x）"
printf "%-40s %-22s %-18s %s\n" "  └ alpha 通道" "—" "$AUTOMERGE_ALPHA" "📌 跟踪用"
echo "   ⚠️  升级条件：验证 multi-device-sync 测试全绿后手动评估"

echo ""
echo "🔵 DSH (DeepSeek Harness)"
echo "─────────────────────────────────────────────────────────────"
# DSH 已发布到 npm（2026-08-14 确认）：@deepseek-ai/dsh + @deepseek-ai/cordis
DSH_VER=$(npm view @deepseek-ai/dsh version 2>/dev/null || echo "❓")
CORDIS_VER=$(npm view @deepseek-ai/cordis version 2>/dev/null || echo "❓")
DSH_GIT_TAG=$(git ls-remote --tags https://github.com/deepseek-ai/DeepSeek-Harness.git 2>/dev/null | tail -1 | grep -oE '[^/]+$' || echo "无 tag")
printf "%-40s %-22s %-18s %s\n" "@deepseek-ai/dsh" "未接入" "$DSH_VER" "🔵 npm 已发布"
printf "%-40s %-22s %-18s %s\n" "@deepseek-ai/cordis" "未接入" "$CORDIS_VER" "🔵 npm 已发布"
printf "%-40s %-22s %-18s %s\n" "  └ GitHub tag" "—" "$DSH_GIT_TAG" "📌"
echo "   v1.3.4 接入方式：optionalDependencies（npm 依赖，rc 版本缺失不阻断安装）"

echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$HAS_OUTDATED" = "1" ]; then
  echo "⚠️  有依赖落后于最新版本——评估是否升级（注意 automerge 禁升 2.x）"
  exit 1
else
  echo "✅ 所有可升级依赖均为最新"
  exit 0
fi
