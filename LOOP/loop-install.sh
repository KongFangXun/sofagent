#!/usr/bin/env bash
# ============================================================
# loop-install.sh · LOOP 自迭代工具包一键部署 · v1.1.4
# ============================================================
# 用法: bash loop-install.sh [--platform openclaw|workbuddy|codex|hermes|claude]
#       默认 --platform openclaw（编排引擎需要 OpenClaw 后台）
#
# 这个脚本装什么:
#   1. 装 sofagent 底座（三层引擎：约束底座 + 审计引擎 + 编排引擎）
#   2. 安装内置 Agent Skill（@sofagent-engineer + @sofagent-reviewer）
#   3. 写入环境配置模板（loop.env.example）
#   4. 验证安装
#
# 装完之后:
#   你的电脑就可以用 LOOP 做自迭代了——
#   编排层（WorkBuddy 等）产出 workflow.yml → LOOP 自动执行子任务循环。
#
# 使用方式:
#   SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat \
#   SOFAGENT_LLM_REVIEWER=glm:glm-5.2 \
#   LOOP_AUTO=1 \
#   sofagent-orchestrator loop --task "..."
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

if [ "$PLATFORM" = "--platform" ] && [ -n "${2:-}" ]; then
  PLATFORM="$2"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}  sofagent LOOP 自迭代工具包 · 一键部署${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  平台: ${BOLD}${PLATFORM}${NC}"
echo ""

# ── 1. 装 sofagent 底座 ──
echo -e "${BOLD}[1/4] 安装 sofagent 底座（三层引擎）...${NC}"
echo -e "  ${CYAN}约束底座 + 审计引擎 + 编排引擎（sofagent-orchestrator）${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/install.sh" --platform "$PLATFORM"
echo -e "${GREEN}✅ sofagent 底座安装完成${NC}"

if [ "$PLATFORM" = "openclaw" ]; then
  echo -e "  ${GREEN}编排引擎已就绪（sofagent-orchestrator 可用）${NC}"
else
  echo -e "  ${YELLOW}⚠️ 非 OpenClaw：编排引擎不可用，核心约束（约束底座 + 审计引擎）生效${NC}"
fi
echo ""

# ── 2. 安装 Engineering Agent Skill ──
echo -e "${BOLD}[2/4] 安装工程 Agent Skill（engineer + reviewer）...${NC}"
SKILL_SRC="$PROJECT_ROOT/agents/SKILL"

# 确定 Skill 安装目标目录
case "$PLATFORM" in
  openclaw) SKILL_DIR="$HOME/.openclaw/skills/sofagent" ;;
  workbuddy) SKILL_DIR="$HOME/.workbuddy/skills/sofagent" ;;
  claude) SKILL_DIR="$HOME/.claude/skills" ;;
  codex) SKILL_DIR="$HOME/.codex/skills" ;;
  hermes) SKILL_DIR="$HOME/.hermes/skills" ;;
  *) SKILL_DIR="" ;;
esac

if [ -n "$SKILL_DIR" ] && [ -d "$SKILL_SRC" ]; then
  mkdir -p "$SKILL_DIR"

  # engineer
  if [ -d "$SKILL_SRC/sofagent-engineer" ]; then
    cp -r "$SKILL_SRC/sofagent-engineer" "$SKILL_DIR/sofagent-engineer"
    echo -e "${GREEN}✅ @sofagent-engineer（软件工程师）已安装${NC}"
  else
    echo -e "${YELLOW}⚠️ sofagent-engineer Skill 未找到，跳过${NC}"
  fi

  # reviewer
  if [ -d "$SKILL_SRC/sofagent-reviewer" ]; then
    cp -r "$SKILL_SRC/sofagent-reviewer" "$SKILL_DIR/sofagent-reviewer"
    echo -e "${GREEN}✅ @sofagent-reviewer（代码审查员）已安装${NC}"
  else
    echo -e "${YELLOW}⚠️ sofagent-reviewer Skill 未找到，跳过${NC}"
  fi

  # audit (LOOP 依赖审计引擎)
  if [ -d "$SKILL_SRC/sofagent-audit" ]; then
    cp -r "$SKILL_SRC/sofagent-audit" "$SKILL_DIR/sofagent-audit"
    echo -e "${GREEN}✅ @sofagent-audit（合规审计员）已安装${NC}"
  fi
else
  echo -e "${CYAN}⚠️ 跳过 Agent Skill 安装（模板或目标路径不存在）${NC}"
fi
echo ""

# ── 3. 写入环境配置模板 ──
echo -e "${BOLD}[3/4] 写入环境配置模板...${NC}"
ENV_EXAMPLE="$SCRIPT_DIR/loop.env.example"
cat > "$SCRIPT_DIR/loop.env.example" << 'EOF'
# ============================================================
# LOOP 自迭代工具包 · 环境变量配置
# 复制为 loop.env 并编辑，然后 source loop.env
# ============================================================

# ── LLM 提供商（必填）──
# 格式: provider:modelName
# 支持: glm(智谱) / kimi(月之暗面) / deepseek

# 开发 engineer（建议用便宜的模型）
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat

# 审查 reviewer（建议用贵的强模型）
export SOFAGENT_LLM_REVIEWER=glm:glm-5.2

# API Key（三家都兼容 OpenAI 格式）
export OPENAI_API_KEY=your-api-key-here

# ── LOOP 模式（可选）──
# 设为 1 启用全自动模式（reviewer IS_PASS 自动判定，不弹 y/n）
# 不设则保持 HITL（每次审查后等人工确认）
export LOOP_AUTO=1
EOF
echo -e "${GREEN}✅ 环境配置模板已写入 ${SCRIPT_DIR}/loop.env.example${NC}"
echo -e "  ${CYAN}请复制并编辑: cp loop.env.example loop.env && source loop.env${NC}"
echo ""

# ── 4. 验证 ──
echo -e "${BOLD}[4/4] 验证安装...${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/verify.sh" --quick 2>&1 | tail -3
echo ""

echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ 你的电脑现在可以跑 LOOP 自迭代了${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}内置 Agent：${NC}"
echo -e "    @sofagent-engineer（软件工程师）— 执行代码变更"
echo -e "    @sofagent-reviewer（代码审查员）— 审查 + 自动门控"
echo -e "    @sofagent-audit（合规审计员）— A1-A19 规则检查"
echo ""
echo -e "  ${BOLD}快速开始：${NC}"
echo -e "  1. 在 WorkBuddy 中用软件开发团队做完编排，拿到 workflow.yml"
echo -e "  2. source loop.env"
echo -e "  3. sofagent-orchestrator loop --task \"你的任务描述\""
echo ""
echo -e "  ${CYAN}详细文档见 LOOP/README.md${NC}"
echo ""
