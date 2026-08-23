#!/usr/bin/env bash
# tools/check-deps.sh
# sofagent 关键依赖版本检查——发版前跑一次，或定期手动跑
#
# 检查范围：
#   🟢 通用工具库（js-yaml / zod / archiver）
#   🟡 核心框架 LangGraph 三件套（langgraph / core / openai）
#   🔴 automerge（v1.3.5 排期升级：automerge@1.0.1-preview.7 → @automerge/automerge@3.4.1，前置 multi-device-sync 回归测试）
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
check_npm "js-yaml" "5.3.0"
check_npm "zod" "4.4.3"
check_npm "archiver" "8.0.0"

echo ""
echo "🟡 核心框架（LangGraph 三件套）"
echo "─────────────────────────────────────────────────────────────"
check_npm "@langchain/langgraph" "1.4.10"
check_npm "@langchain/core" "1.2.8"
check_npm "@langchain/openai" "1.5.8"

echo ""
echo "🔴 automerge（v1.3.5 排期升级）"
echo "─────────────────────────────────────────────────────────────"
# automerge 特殊处理——旧包名 automerge@1.0.1-preview.7 当前在用（v1.3.5 切换前）
# 升级 PR 仅作参考（Dependabot 标 DO-NOT-MERGE），不自动合并
# v1.3.5 排期切换到新包名 @automerge/automerge@^3.4.1（前置：multi-device-sync 回归测试跑绿）
AUTOMERGE_LATEST=$(npm view automerge version 2>/dev/null || echo "❓")
AUTOMERGE_NEW=$(npm view @automerge/automerge version 2>/dev/null || echo "❓")
printf "%-40s %-22s %-18s %s\n" "automerge（旧包名）" "1.0.1-preview.7" "$AUTOMERGE_LATEST" "🔒 v1.3.5 前禁升"
printf "%-40s %-22s %-18s %s\n" "@automerge/automerge（新包名）" "—" "$AUTOMERGE_NEW" "📋 v1.3.5 切换目标"
echo "   ⚠️  切换前置：multi-device-sync 回归测试跑绿后再执行（7 处 API 调用同步改）"

echo ""
echo "🔵 DSH (DeepSeek Harness)"
echo "─────────────────────────────────────────────────────────────"
# DSH 已发布到 npm（2026-08-14 确认）：@deepseek-ai/dsh + @deepseek-ai/cordis
DSH_VER=$(npm view @deepseek-ai/dsh version 2>/dev/null || echo "❓")
CORDIS_VER=$(npm view @deepseek-ai/cordis version 2>/dev/null || echo "❓")
DSH_GIT_TAG=$(git ls-remote --tags https://github.com/deepseek-ai/DeepSeek-Harness.git 2>/dev/null | tail -1 | grep -oE '[^/]+$' || echo "无 tag")
# v1.4.0：DSH 已真实接入（orchestrator dependencies @deepseek-ai/dsh，SOFAGENT_FORCE_DSH=1 启用）
if grep -q '"@deepseek-ai/dsh"' engine/orchestrator/package.json 2>/dev/null; then
  DSH_STATUS="已接入"
else
  DSH_STATUS="未接入"
fi
printf "%-40s %-22s %-18s %s\n" "@deepseek-ai/dsh" "$DSH_STATUS" "$DSH_VER" "🔵 npm 已发布"
printf "%-40s %-22s %-18s %s\n" "@deepseek-ai/cordis" "随 dsh 安装" "$CORDIS_VER" "🔵 npm 已发布"
printf "%-40s %-22s %-18s %s\n" "  └ GitHub tag" "—" "$DSH_GIT_TAG" "📌"
echo "   v1.4.0 接入方式：orchestrator dependencies（@deepseek-ai/dsh，rc 期）+ SOFAGENT_FORCE_DSH=1 走 DSH CLI 桥接；正式版发布后守卫自动放行"

echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$HAS_OUTDATED" = "1" ]; then
  echo "⚠️  有依赖落后于最新版本——按 SOP 步骤 5 决策规则评估（automerge v1.3.5 前禁升）"
  exit 1
else
  echo "✅ 所有可升级依赖均为最新"
  exit 0
fi
