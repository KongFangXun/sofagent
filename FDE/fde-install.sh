#!/usr/bin/env bash
# ============================================================
# fde-install.sh · FDE 工具包一键部署 · v1.1.2
# ============================================================
# 用法: bash fde-install.sh [--platform openclaw|workbuddy|codex|hermes|claude]
#       默认 --platform openclaw（编排引擎需要 OpenClaw 后台）
#
# 这个脚本装什么:
#   1. 装 sofagent 底座（三层引擎：约束底座 + 审计引擎 + 编排引擎）
#   2. 写入 fde.md（harness 层第三层——企业专属约束）
#   3. 安装内置 Agent Skill（@sofagent-fde + @sofagent-audit，v1.0.7 新增）
#   4. 验证安装
#
# 这个脚本不装什么:
#   - 不装 templates/（那是给 FDE 读的案例参考，不是部署目标）
#   - 不装 workflow/ agents/（已删除，FDE.md 是唯一知识源）
#   - 不装 nodes/ 和 skills/（那是 FDE 走完 12 步后基于模板填出来的）
#
# 装完之后:
#   你的电脑就是一个 FDE 节点了——打开 Agent 就能开始帮企业做部署。
# ============================================================

set -euo pipefail

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
echo -e "${BOLD}${CYAN}  sofagent FDE 工具包 · 一键部署${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  平台: ${BOLD}${PLATFORM}${NC}"
echo ""

# ── 1. 装 sofagent 底座 ──
echo -e "${BOLD}[1/3] 安装 sofagent 底座（三层引擎）...${NC}"
echo -e "  ${CYAN}约束底座 + 审计引擎 + 编排引擎（sofagent-orchestrator）${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/install.sh" --platform "$PLATFORM"
echo -e "${GREEN}✅ sofagent 底座安装完成${NC}"

if [ "$PLATFORM" = "openclaw" ]; then
  echo -e "  ${GREEN}编排引擎已就绪（sofagent-orchestrator compose 可用）${NC}"
else
  echo -e "  ${YELLOW}⚠️ 非 OpenClaw：编排引擎不可用，核心约束（约束底座 + 审计引擎）生效${NC}"
fi
echo ""

# ── 2. 写入 fde.md ──
echo -e "${BOLD}[2/3] 写入 FDE 运行规范（harness 层第三层）...${NC}"
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

  # v1.0.7: 同时安装 FDE + Audit 两个内置 Agent 的 Skill
  SKILL_SRC="$PROJECT_ROOT/agents/SKILL"
  SKILL_DIR="$(dirname "$FDE_MD_TARGET")"
  if [ -d "$SKILL_SRC/sofagent-fde" ]; then
    cp -r "$SKILL_SRC/sofagent-fde" "$SKILL_DIR/sofagent-fde"
    echo -e "${GREEN}✅ FDE Agent Skill 已安装（@sofagent-fde 可用）${NC}"
  fi
  if [ -d "$SKILL_SRC/sofagent-audit" ]; then
    cp -r "$SKILL_SRC/sofagent-audit" "$SKILL_DIR/sofagent-audit"
    echo -e "${GREEN}✅ Audit Agent Skill 已安装（@sofagent-audit 可用）${NC}"
  fi
else
  echo -e "${CYAN}⚠️ 跳过 fde.md（模板或目标路径不存在）${NC}"
fi
echo ""

# ── 3. 验证 ──
echo -e "${BOLD}[3/3] 验证安装...${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/verify.sh" --quick 2>&1 | tail -3
echo ""

echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ 你的电脑现在是一个 FDE 节点了${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}下一步：${NC}"
if [ "$PLATFORM" = "openclaw" ]; then
  echo -e "  1. 打开你的 Agent——它会检测到 FDE 场景，自动加载工作台"
  echo -e "  2. 告诉 Agent 企业基本信息（名称/行业/规模），开始 §1 确定场景"
  echo -e "  3. 走完 11 步后，找台闲置设备装上 sofagent 底座给客户"
else
  echo -e "  1. 在你的 Agent 中输入 ${BOLD}@sofagent-fde${NC} 开始部署"
  echo -e "  2. Agent 读完后按 FDE 流程引导你梳理工作流"
fi
echo ""
echo -e "  ${CYAN}内置 Agent：${NC}@sofagent-fde（部署工程师）+ @sofagent-audit（合规审计员）"
echo -e "  ${CYAN}详细指南见 FDE/README.md${NC}"
echo ""
