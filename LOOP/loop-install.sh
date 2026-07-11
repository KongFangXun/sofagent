#!/usr/bin/env bash
# ============================================================
# loop-install.sh · LOOP 自迭代循环一键安装 · v1.0.2
# ============================================================
# 用法: bash loop-install.sh [--platform openclaw|workbuddy]
#       默认 --platform openclaw
#
# 这个脚本装什么:
#   1. 确保 sofagent 底座已安装
#   2. 安装 LOOP Skill（SKILL.md + LOOP.md + README.md）
#   3. 验证安装
#
# 这个脚本不装什么:
#   - 不装 sofagent 底座（需要先单独装）
#   - 不装 FDE 工具包（需要先单独装，外层循环需要 FDE）
#   - 不装 agents/ 下的 Agent 定义（这些在 sofagent 主项目中）
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  sofagent LOOP · 自迭代循环安装${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  平台: ${BOLD}${PLATFORM}${NC}"
echo ""

# ── 0. 检查前置条件 ──
echo -e "${BOLD}[0/3] 检查前置条件...${NC}"

if ! command -v sofagent-audit &> /dev/null && ! command -v node &> /dev/null; then
  echo -e "${YELLOW}⚠️  sofagent-audit 未安装。请先装 sofagent 底座：${NC}"
  echo -e "  ${CYAN}bash sofagent/scripts/install.sh${NC}"
  echo ""
  echo -e "${YELLOW}LOOP 需要 sofagent 底座。安装后重跑 loop-install.sh。${NC}"
  exit 1
fi
echo -e "${GREEN}✅ sofagent 底座已安装${NC}"
echo ""

# ── 1. 安装 LOOP Skill ──
echo -e "${BOLD}[1/3] 安装 LOOP Skill...${NC}"

case "$PLATFORM" in
  openclaw)
    TARGET="$HOME/.openclaw/skills/sofagent-loop"
    mkdir -p "$TARGET"
    cp "$SCRIPT_DIR/SKILL.md" "$TARGET/"
    cp "$SCRIPT_DIR/LOOP.md" "$TARGET/"
    cp "$SCRIPT_DIR/README.md" "$TARGET/"
    ;;
  workbuddy)
    TARGET="$HOME/.workbuddy/skills/sofagent-loop"
    mkdir -p "$TARGET"
    cp "$SCRIPT_DIR/SKILL.md" "$TARGET/"
    cp "$SCRIPT_DIR/LOOP.md" "$TARGET/"
    cp "$SCRIPT_DIR/README.md" "$TARGET/"
    ;;
  *)
    echo -e "${YELLOW}⚠️  不支持的平台: $PLATFORM${NC}"
    echo -e "  支持: openclaw, workbuddy"
    exit 1
    ;;
esac

echo -e "${GREEN}✅ LOOP Skill 已安装到 ${TARGET}${NC}"
echo ""

# ── 2. 检查 FDE（可选，外层循环需要） ──
echo -e "${BOLD}[2/3] 检查 FDE 工具包（外层循环需要）...${NC}"

FDE_INSTALLED=false
if [ "$PLATFORM" = "openclaw" ] && [ -f "$HOME/.openclaw/skills/sofagent-fde/SKILL.md" ]; then
  FDE_INSTALLED=true
elif [ "$PLATFORM" = "workbuddy" ] && [ -f "$HOME/.workbuddy/skills/sofagent-fde/SKILL.md" ]; then
  FDE_INSTALLED=true
fi

if $FDE_INSTALLED; then
  echo -e "${GREEN}✅ FDE 工具包已安装——外层循环可用${NC}"
else
  echo -e "${YELLOW}⚠️  FDE 工具包未安装——外层循环 (forward-deployed-engineer) 不可用${NC}"
  echo -e "  ${CYAN}内层循环 (coding → audit → review) 不受影响${NC}"
  echo -e "  ${CYAN}要装 FDE: bash FDE/fde-install.sh${NC}"
fi
echo ""

# ── 3. 验证 ──
echo -e "${BOLD}[3/3] 验证安装...${NC}"
if [ -f "$TARGET/SKILL.md" ] && [ -f "$TARGET/LOOP.md" ]; then
  echo -e "${GREEN}✅ LOOP Skill 文件完整${NC}"
else
  echo -e "${YELLOW}⚠️  Skill 文件不完整，请手动检查${NC}"
fi
echo ""

echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ LOOP 自迭代循环安装完成${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}下一步：${NC}"
if [ "$PLATFORM" = "openclaw" ]; then
  echo -e "  1. 你的 Agent 会检测到开发循环场景，自动加载 LOOP Skill"
  echo -e "  2. 告诉 Agent: ${CYAN}@openclaw 启动 LOOP 自迭代循环：修复 issue #123${NC}"
  echo -e "  3. Agent 自动调度 sub-agent 干活，你看审查报告就行"
else
  echo -e "  1. 输入 ${BOLD}@skill:sofagent-loop${NC} 激活 LOOP Skill"
  echo -e "  2. 告诉 Agent 任务，LOOP 自动跑起来"
fi
echo ""
echo -e "  ${CYAN}详细指南见 LOOP/README.md${NC}"
echo -e "  ${YELLOW}💡 LOOP/LOOP.md 是完整设计文档——想改流程就改它${NC}"
echo ""
