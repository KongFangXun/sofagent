#!/usr/bin/env bash
# ============================================================
# fde-install.sh · FDE 工程师一键部署
# ============================================================
# 用法: bash fde-install.sh [--platform openclaw|workbuddy|codex|hermes|claude]
#       默认 --platform openclaw（编排引擎需要 OpenClaw 后台，其他平台核心约束可用）
#
# 做的事:
#   1. 装 sofagent（按平台部署 Skill + 约束层）
#   2. 写入 fde.md（加载链第三层）
#   3. 拉取 workflow/agent 模板
#   4. 验证安装
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PLATFORM="${1:-openclaw}"
PLATFORM="${PLATFORM#--platform }"
PLATFORM="${PLATFORM#--platform=}"

# Fix: if $2 is provided and $1 was --platform, use $2
if [ "$PLATFORM" = "--platform" ] && [ -n "${2:-}" ]; then
  PLATFORM="$2"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  sofagent FDE 工具箱 · 一键部署${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  平台: ${BOLD}${PLATFORM}${NC}"
echo ""

# ── 1. 装 sofagent ──
echo -e "${BOLD}[1/4] 安装 sofagent...${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/install.sh" --platform "$PLATFORM"
echo -e "${GREEN}✅ sofagent 安装完成${NC}"

if [ "$PLATFORM" != "openclaw" ]; then
  echo -e "  ${YELLOW}⚠️ 非 OpenClaw：编排引擎不可用，核心约束（4 底线 + 6 铁律）生效${NC}"
fi
echo ""

# ── 2. 写入 fde.md ──
echo -e "${BOLD}[2/4] 写入 FDE 运行规范...${NC}"
FDE_MD_TEMPLATE="$PROJECT_ROOT/sofagent/skill/data/fde.md"

case "$PLATFORM" in
  openclaw) FDE_MD_TARGET="$HOME/.openclaw/skills/sofagent/fde.md" ;;
  workbuddy) FDE_MD_TARGET="$HOME/.workbuddy/skills/sofagent/fde.md" ;;
  claude) FDE_MD_TARGET="$HOME/.claude/fde.md" ;;
  codex) FDE_MD_TARGET="$HOME/.codex/fde.md" ;;
  hermes) FDE_MD_TARGET="$HOME/.hermes/fde.md" ;;
  *) FDE_MD_TARGET="" ;;
esac

if [ -n "$FDE_MD_TARGET" ] && [ -f "$FDE_MD_TEMPLATE" ]; then
  mkdir -p "$(dirname "$FDE_MD_TARGET")" 2>/dev/null || true
  cp "$FDE_MD_TEMPLATE" "$FDE_MD_TARGET"
  echo -e "${GREEN}✅ fde.md 已写入 ${FDE_MD_TARGET}${NC}"
  echo -e "  ${CYAN}请编辑此文件，填写你的工作规则${NC}"
else
  echo -e "${CYAN}⚠️ 跳过 fde.md（模板或目标路径不存在）${NC}"
fi
echo ""

# ── 3. 拉取模板 ──
echo -e "${BOLD}[3/4] 部署 workflow + agent 模板...${NC}"
TEMPLATE_DST="$HOME/.sofagent/fde"

mkdir -p "$TEMPLATE_DST/workflow" "$TEMPLATE_DST/agents"
cp "$PROJECT_ROOT/FDE/workflow/template.yaml" "$TEMPLATE_DST/workflow/" 2>/dev/null || true
cp "$PROJECT_ROOT/FDE/agents/templates.md" "$TEMPLATE_DST/agents/" 2>/dev/null || true
echo -e "${GREEN}✅ 模板已部署到 ${TEMPLATE_DST}${NC}"
echo ""

# ── 4. 验证 ──
echo -e "${BOLD}[4/4] 验证安装...${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/verify.sh" --quick 2>&1 | tail -3
echo ""

echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  FDE 工具箱部署完成${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
if [ "$PLATFORM" = "openclaw" ]; then
  echo -e "  打开你的 Agent，它会说「我已就绪」"
else
  echo -e "  ${YELLOW}非 OpenClaw：复制 ${BOLD}FDE/README.md${NC}${YELLOW} 里的种子指令，粘贴到你的 Agent${NC}"
fi
echo -e "  详细指南见 ${CYAN}FDE/README.md${NC}"
echo -e "  ${YELLOW}💡 别忘了配 Webhook（README 最下面）${NC}"
echo ""
