#!/usr/bin/env bash
# tools/check-deps.sh
# sofagent 关键依赖版本检查——发版前跑一次，或定期手动跑
#
# 检查范围：
#   🟢 通用工具库（js-yaml / zod / archiver）
#   🟡 核心框架 LangGraph 三件套（langgraph / core / openai）
#   🔴 automerge（CRDT 核心：@automerge/automerge ^3.4.1 已迁移，现状对账）
#   🔵 DSH deepseek-harness（npm 已发布 2026-08-14：@deepseek-ai/dsh + @deepseek-ai/cordis）
#
# 用法：
#   bash tools/check-deps.sh              # 全量检查（落后 → exit 1）
#   bash tools/check-deps.sh --quiet      # 只输出有问题的
#   bash tools/check-deps.sh --warn-only  # 只提示不阻断（落后仍 exit 0——评估模式）
#
# 退出码：0=全部最新（或 --warn-only） / 1=有落后版本
# --warn-only 语义（v1.4.3 P2-c）：本脚本是纯手动脚本（8 个 CI workflow 零引用），
#   exit 1 = 「提示评估」而非阻断——加旁路避免手动跑完必须改脚本才能继续的场景。

set -euo pipefail

QUIET="false"
WARN_ONLY="false"
for _arg in "$@"; do
  case "$_arg" in
    --quiet) QUIET="true" ;;
    --warn-only) WARN_ONLY="true" ;;
  esac
done

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
check_npm "js-yaml" "5.4.1"
check_npm "zod" "4.5.4"
check_npm "archiver" "8.0.0"
# ⚠️ 上方「当前版本」为脚本硬编码基线——升级依赖后必须同步更新（v1.4.1 教训：
#    基线滞后于 lock 实际版本会把「已是最新」误报成「有新版本」，门禁假红）
#    基线来源：package-lock.json 顶层 node_modules/<pkg> 的 version 字段（2026-09-01 对齐）

echo ""
echo "🟡 核心框架（LangGraph 三件套）"
echo "─────────────────────────────────────────────────────────────"
check_npm "@langchain/langgraph" "1.4.13"
check_npm "@langchain/core" "1.2.9"
check_npm "@langchain/openai" "1.5.11"

echo ""
echo "🔴 automerge（CRDT 核心）"
echo "─────────────────────────────────────────────────────────────"
# automerge 现状对账——v1.3.5 交付 4b 已完成迁移：旧包名 automerge@1.0.1-preview.7 废弃，
# core + orchestrator 均声明 @automerge/automerge ^3.4.1（Rust WASM 稳定核心）。
# 本段从 package.json 实读当前声明版本，与 npm latest 比对（不做硬编码基线，杜绝话术滞后）。
AUTOMERGE_DECLARED=$(node -e '
  const fs = require("fs");
  for (const p of ["engine/core/package.json", "engine/orchestrator/package.json"]) {
    try {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      const v = (d.dependencies || {})["@automerge/automerge"];
      if (v) { console.log(v); break; }
    } catch (e) { /* 跳过缺失文件 */ }
  }
' 2>/dev/null || echo "")
AUTOMERGE_LATEST=$(npm view @automerge/automerge version 2>/dev/null || echo "❓")
if [ -z "$AUTOMERGE_DECLARED" ]; then
  printf "%-40s %-22s %-18s %s\n" "@automerge/automerge" "❓ 未声明" "$AUTOMERGE_LATEST" "⚠️  请核对 package.json"
  HAS_OUTDATED=1
else
  AUTOMERGE_CURRENT=$(node -e '
    const lock = require("./package-lock.json");
    const entry = lock.packages["node_modules/@automerge/automerge"];
    console.log(entry ? entry.version : "❓");
  ' 2>/dev/null || echo "❓")
  check_npm "@automerge/automerge" "$AUTOMERGE_CURRENT"
  echo "   声明范围：${AUTOMERGE_DECLARED}（lock 锁定 ${AUTOMERGE_CURRENT}；跨 major 升级须先跑联邦合并与 team-state 回归）"
fi

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
  if [ "$WARN_ONLY" = "true" ]; then
    echo "⚠️  有依赖落后于最新版本——按 SOP 步骤 5 决策规则评估"
    echo "   （--warn-only 模式：exit 0 不阻断，仅提示评估）"
    exit 0
  fi
  echo "⚠️  有依赖落后于最新版本——按 SOP 步骤 5 决策规则评估"
  exit 1
else
  echo "✅ 所有可升级依赖均为最新"
  exit 0
fi
