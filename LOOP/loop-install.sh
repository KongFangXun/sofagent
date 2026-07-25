#!/usr/bin/env bash
# ============================================================
# loop-install.sh · LOOP 开发循环一键安装 · v1.2.0
# ============================================================
# 用法: bash loop-install.sh [--platform openclaw|workbuddy|codex|hermes|claude]
#       默认 --platform openclaw（编排引擎需要 OpenClaw 后台）
#
# 这个脚本装什么:
#   1. 装 sofagent 底座（约束+审计+daemon+mcp）
#   2. 安装 engineer + reviewer Sub Agent Skill
#   3. 安装 LOOP 开发循环工具链
#
# 这个脚本不装什么:
#   - 不装 FDE Agent（那是 install.sh 默认模式的活）
#   - 不装 audit Agent（install.sh 默认模式装）
#
# 装完之后:
#   你的电脑就能用 sofagent 的 LOOP 自迭代开发循环了——
#   engineer 写代码 → audit 审计 → reviewer 审查 → IS_PASS 自动判定。
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
echo -e "${BOLD}${CYAN}  sofagent LOOP 开发循环 · 一键安装${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  平台: ${BOLD}${PLATFORM}${NC}"
echo -e "  用途: 自动迭代开发（engineer 写代码 → audit 审计 → reviewer 审查）${NC}"
echo ""

# ── 1. 装 sofagent 底座 ──
echo -e "${BOLD}[1/3] 安装 sofagent 底座（约束+审计+daemon+mcp）...${NC}"
bash "$PROJECT_ROOT/install.sh" --base-only --platform "$PLATFORM"
echo -e "${GREEN}✅ sofagent 底座安装完成${NC}"
echo ""

# ── 2. 安装 engineer + reviewer Skill ──
echo -e "${BOLD}[2/3] 安装 LOOP Sub Agent Skill...${NC}"
SKILL_SRC="$PROJECT_ROOT/SKILL"

case "$PLATFORM" in
  openclaw) SKILL_DIR="$HOME/.openclaw/skills" ;;
  workbuddy) SKILL_DIR="$HOME/.workbuddy/skills" ;;
  claude) SKILL_DIR="$HOME/.claude/skills" ;;
  codex) SKILL_DIR="$HOME/.codex/skills" ;;
  hermes) SKILL_DIR="$HOME/.hermes/skills" ;;
  *) SKILL_DIR="" ;;
esac

if [ -z "$SKILL_DIR" ]; then
  echo -e "${YELLOW}⚠️ 未知平台 $PLATFORM，跳过 Skill 安装${NC}"
else
  mkdir -p "$SKILL_DIR"

  # 安装 engineer
  if [ -d "$SKILL_SRC/agents/engineer" ]; then
    cp -r "$SKILL_SRC/agents/engineer" "$SKILL_DIR/sofagent-engineer"
    echo -e "${GREEN}✅ engineer Skill 已安装（@sofagent-engineer 可用）${NC}"
  else
    echo -e "${YELLOW}⚠️ engineer Skill 源不存在，跳过${NC}"
  fi

  # 安装 reviewer
  if [ -d "$SKILL_SRC/agents/reviewer" ]; then
    cp -r "$SKILL_SRC/agents/reviewer" "$SKILL_DIR/sofagent-reviewer"
    echo -e "${GREEN}✅ reviewer Skill 已安装（@sofagent-reviewer 可用）${NC}"
  else
    echo -e "${YELLOW}⚠️ reviewer Skill 源不存在，跳过${NC}"
  fi
fi
echo ""

# ── 3. 验证 ──
echo -e "${BOLD}[3/3] 验证安装...${NC}"
if [ -x "$PROJECT_ROOT/engine/scripts/verify.sh" ]; then
  bash "$PROJECT_ROOT/engine/scripts/verify.sh" --quick 2>&1 | tail -3
else
  echo -e "${CYAN}  verify.sh 不存在，跳过自动验证${NC}"
  echo -e "${CYAN}  手动验证：npm test${NC}"
fi
echo ""

echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ LOOP 开发循环已就绪${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}快速开始：${NC}"
echo -e "  1. 设模型：${CYAN}export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat${NC}"
echo -e "  2. 设 Key：${CYAN}export OPENAI_API_KEY=sk-xxx${NC}"
echo -e "  3. 跑任务：${CYAN}sofagent-orchestrator loop --task \"在 README.md 加项目简介\"${NC}"
echo ""
echo -e "  ${CYAN}LOOP 自动流转：${NC}engineer 写代码 → audit 审计 → reviewer 审查 → IS_PASS 判定"
echo -e "  ${CYAN}详细指南见 LOOP/README.md${NC}"
echo ""
