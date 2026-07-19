#!/usr/bin/env bash
# ============================================================
# loop-install.sh · LOOP 自迭代工具包一键部署 · v1.1.6
# ============================================================
# 用法: bash loop-install.sh [--platform openclaw|workbuddy|codex|hermes|claude]
#       默认 --platform openclaw（编排引擎需要 OpenClaw 后台）
#
# 这个脚本装什么:
#   1. 装 sofagent 底座（三层引擎：约束底座 + 审计引擎 + 编排引擎）
#   2. 安装内置 Agent Skill（@sofagent-engineer + @sofagent-reviewer）
#   3. 写入环境配置模板（loop.env.example）
#   4. 【v1.1.5 新增】交互式配置 LLM（provider + key + smoke test）
#   5. 验证安装
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
# 调用契约见 sofagent/scripts/install.sh 头部「跨产品调用契约」段（v1.1.5）
echo -e "${BOLD}[1/5] 安装 sofagent 底座（三层引擎）...${NC}"
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
echo -e "${BOLD}[2/5] 安装工程 Agent Skill（engineer + reviewer）...${NC}"
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

  # releaser (v1.1.5 新增——按需，仅发版场景激活)
  if [ -d "$SKILL_SRC/sofagent-releaser" ]; then
    cp -r "$SKILL_SRC/sofagent-releaser" "$SKILL_DIR/sofagent-releaser"
    echo -e "${GREEN}✅ @sofagent-releaser（发布工程师）已安装${NC}"
  else
    echo -e "${YELLOW}⚠️ sofagent-releaser Skill 未找到，跳过${NC}"
  fi
else
  echo -e "${CYAN}⚠️ 跳过 Agent Skill 安装（模板或目标路径不存在）${NC}"
fi
echo ""

# ── 3. 写入环境配置模板 ──
echo -e "${BOLD}[3/5] 写入环境配置模板...${NC}"
cat > "$SCRIPT_DIR/loop.env.example" << 'EOF'
# ============================================================
# LOOP 自迭代工具包 · 环境变量配置
# 复制为 loop.env 并编辑，然后 source loop.env
# ============================================================

# ── LLM Provider（必填）──
# 格式: provider:modelName
# 预置 provider: glm / kimi / deepseek（走 OpenAI 兼容 API）
# 自定义 provider: custom（配合 SOFAGENT_LLM_BASE_URL 使用，任意 OpenAI 兼容 API）

# 开发 engineer（建议用性价比模型）
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat

# 审查 reviewer（建议用推理能力更强的模型）
export SOFAGENT_LLM_REVIEWER=glm:glm-4-flash

# ── API Key（必填）──
# 默认路径：直接用 OPENAI_API_KEY（所有 OpenAI 兼容 API 通用）
# 你的 key 不会发到 OpenAI，只发到上面 SOFAGENT_LLM_* 指定的 provider。
export OPENAI_API_KEY=your-api-key-here

# ── API Key 高级用法（可选，不需要的不要取消注释）──
# 如果要让 engineer 和 reviewer 用不同账号（开发便宜账号 / 审查高质量账号分账）：
# export SOFAGENT_LLM_ENGINEER_API_KEY=sk-cheap
# export SOFAGENT_LLM_REVIEWER_API_KEY=sk-premium
#
# 完整 fallback 顺序（任一命中即可）：
#   SOFAGENT_LLM_{ROLE}_API_KEY > SOFAGENT_LLM_API_KEY > OPENAI_API_KEY

# ── 自定义 provider（可选）──
# 如果用 custom provider，需要设置 base URL
# 预置 provider（glm/kimi/deepseek）不需要设这个
# export SOFAGENT_LLM_BASE_URL=https://your-endpoint/v1/

# ── LOOP 模式（可选）──
# 设为 1 启用全自动模式（reviewer IS_PASS 自动判定，不弹 y/n）
# 不设则保持 HITL（每次审查后等人工确认）
export LOOP_AUTO=1
EOF
echo -e "${GREEN}✅ 环境配置模板已写入 ${SCRIPT_DIR}/loop.env.example${NC}"
echo ""

# ── 4. 交互式配置 LLM（v1.1.5 新增）──
echo -e "${BOLD}[4/5] 配置 LLM（交互式）...${NC}"
LOOP_ENV_FILE="$SCRIPT_DIR/loop.env"

# 如果 loop.env 已存在且包含有效 key，跳过向导
# 匹配 OPENAI_API_KEY / SOFAGENT_LLM_API_KEY / SOFAGENT_LLM_{ROLE}_API_KEY 任一非空赋值
if [ -f "$LOOP_ENV_FILE" ] && grep -qE "(OPENAI_API_KEY|SOFAGENT_LLM_API_KEY|SOFAGENT_LLM_(ENGINEER|REVIEWER)_API_KEY)=[^[:space:]]+" "$LOOP_ENV_FILE" 2>/dev/null; then
  echo -e "  ${GREEN}检测到已有 loop.env 配置，跳过向导${NC}"
  echo -e "  ${CYAN}如需重新配置，删除 loop.env 后重跑本脚本${NC}"
else
  echo -e "  ${CYAN}LOOP 需要 LLM 才能工作。engineer 写代码（性价比模型），${NC}"
  echo -e "  ${CYAN}reviewer 审查（推理能力强的模型）。两者都是 OpenAI 兼容 API。${NC}"
  echo -e "  ${CYAN}所有主流 provider（DeepSeek/GLM/Kimi/OpenRouter/本地部署）都走同一种 key 格式。${NC}"
  echo ""

  # ── 选 engineer 模型 ──
  echo -e "  ${BOLD}── engineer（写代码）用什么模型？ ──${NC}"
  echo -e "  可选 provider:"
  echo -e "    1) deepseek（预置 · 性价比推荐）"
  echo -e "    2) glm（预置 · 智谱）"
  echo -e "    3) kimi（预置 · 月之暗面）"
  echo -e "    4) custom（任意 OpenAI 兼容 API）"
  echo -e "    5) 跳过，稍后手动配置 loop.env"
  printf "  选择 [1-5]: "
  read -r ENGINEER_CHOICE </dev/tty

  ENGINEER_LINE=""
  case "$ENGINEER_CHOICE" in
    1) ENGINEER_LINE="export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat" ;;
    2) ENGINEER_LINE="export SOFAGENT_LLM_ENGINEER=glm:glm-4-flash" ;;
    3) ENGINEER_LINE="export SOFAGENT_LLM_ENGINEER=kimi:moonshot-v1-8k" ;;
    4)
      printf "  Custom API Base URL (OpenAI 兼容): "
      read -r CUSTOM_BASE </dev/tty
      printf "  Custom Model Name: "
      read -r CUSTOM_MODEL </dev/tty
      ENGINEER_LINE="export SOFAGENT_LLM_ENGINEER=custom:${CUSTOM_MODEL}\nexport SOFAGENT_LLM_BASE_URL=${CUSTOM_BASE}"
      ;;
    5)
      echo -e "  ${YELLOW}跳过 engineer 配置${NC}"
      ;;
    *) echo -e "  ${YELLOW}无效选项，跳过${NC}" ;;
  esac
  echo ""

  # ── 选 reviewer 模型 ──
  echo -e "  ${BOLD}── reviewer（审查）用什么模型？ ──${NC}"
  echo -e "  可选 provider:"
  echo -e "    1) glm（预置 · 推理能力强推荐）"
  echo -e "    2) deepseek（预置 · 复用 engineer）"
  echo -e "    3) kimi（预置 · 月之暗面）"
  echo -e "    4) custom（任意 OpenAI 兼容 API）"
  echo -e "    5) 跳过，稍后手动配置 loop.env"
  printf "  选择 [1-5]: "
  read -r REVIEWER_CHOICE </dev/tty

  REVIEWER_LINE=""
  case "$REVIEWER_CHOICE" in
    1) REVIEWER_LINE="export SOFAGENT_LLM_REVIEWER=glm:glm-4-flash" ;;
    2) REVIEWER_LINE="export SOFAGENT_LLM_REVIEWER=deepseek:deepseek-chat" ;;
    3) REVIEWER_LINE="export SOFAGENT_LLM_REVIEWER=kimi:moonshot-v1-8k" ;;
    4)
      printf "  Custom API Base URL: "
      read -r CUSTOM_BASE_R </dev/tty
      printf "  Custom Model Name: "
      read -r CUSTOM_MODEL_R </dev/tty
      REVIEWER_LINE="export SOFAGENT_LLM_REVIEWER=custom:${CUSTOM_MODEL_R}"
      ;;
    5)
      echo -e "  ${YELLOW}跳过 reviewer 配置${NC}"
      ;;
    *) echo -e "  ${YELLOW}无效选项，跳过${NC}" ;;
  esac
  echo ""

  # ── API key 模式（默认统一 key，高级分账号）──
  echo -e "  ${BOLD}── API Key 模式 ──${NC}"
  echo -e "    1) 统一 key（推荐 · engineer 和 reviewer 共用一个账号）"
  echo -e "    2) 分账号（高级 · engineer/reviewer 各自一个 key，分别控成本）"
  printf "  选择 [1-2]: "
  read -r KEY_MODE_CHOICE </dev/tty

  COMMON_KEY_LINE=""
  ENGINEER_KEY_LINE=""
  REVIEWER_KEY_LINE=""

  if [ "$KEY_MODE_CHOICE" = "2" ]; then
    # 分账号模式
    if [ -n "$ENGINEER_LINE" ] && [ "$ENGINEER_CHOICE" != "5" ]; then
      printf "  engineer API Key (sk-...): "
      read -r ENGINEER_KEY </dev/tty
      [ -n "$ENGINEER_KEY" ] && ENGINEER_KEY_LINE="export SOFAGENT_LLM_ENGINEER_API_KEY=${ENGINEER_KEY}"
    fi
    if [ -n "$REVIEWER_LINE" ] && [ "$REVIEWER_CHOICE" != "5" ]; then
      printf "  reviewer API Key (sk-...): "
      read -r REVIEWER_KEY </dev/tty
      [ -n "$REVIEWER_KEY" ] && REVIEWER_KEY_LINE="export SOFAGENT_LLM_REVIEWER_API_KEY=${REVIEWER_KEY}"
    fi
  else
    # 统一 key 模式（默认）——直接用 OPENAI_API_KEY
    printf "  API Key (sk-...，OpenAI 兼容格式): "
    read -r COMMON_KEY </dev/tty
    if [ -n "$COMMON_KEY" ]; then
      COMMON_KEY_LINE="export OPENAI_API_KEY=${COMMON_KEY}"
    fi
  fi
  echo ""

  # ── LOOP_AUTO 选项 ──
  printf "  启用全自动模式 (LOOP_AUTO=1)？推荐 [Y/n]: "
  read -r AUTO_CHOICE </dev/tty
  AUTO_LINE="export LOOP_AUTO=1"
  if [ "${AUTO_CHOICE:-Y}" = "n" ] || [ "${AUTO_CHOICE:-Y}" = "N" ]; then
    AUTO_LINE="# export LOOP_AUTO=1  # HITL 模式（每次审查后弹 y/n）"
  fi

  # 写入 loop.env
  {
    echo "# ============================================================"
    echo "# LOOP 自迭代工具包 · 运行时配置（由 loop-install.sh 生成）"
    echo "# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "# 生效方式: source $(basename "$LOOP_ENV_FILE")"
    echo "# ============================================================"
    echo ""
    [ -n "$ENGINEER_LINE" ] && echo -e "$ENGINEER_LINE"
    [ -n "$ENGINEER_KEY_LINE" ] && echo "$ENGINEER_KEY_LINE"
    [ -n "$REVIEWER_LINE" ] && echo "$REVIEWER_LINE"
    [ -n "$REVIEWER_KEY_LINE" ] && echo "$REVIEWER_KEY_LINE"
    [ -n "$COMMON_KEY_LINE" ] && echo "$COMMON_KEY_LINE"
    echo ""
    echo "$AUTO_LINE"
  } > "$LOOP_ENV_FILE"

  # 权限收紧（API key 是敏感数据）
  chmod 600 "$LOOP_ENV_FILE" 2>/dev/null || true

  echo -e "${GREEN}✅ 配置已写入 ${LOOP_ENV_FILE}（权限 600）${NC}"
  echo -e "  ${CYAN}生效方式: source ${LOOP_ENV_FILE}${NC}"
  echo -e "  ${CYAN}永久生效: 将配置追加到 ~/.zshrc 或 ~/.bashrc${NC}"
fi
echo ""

# ── 5. 验证安装 + LLM smoke test ──
echo -e "${BOLD}[5/5] 验证安装...${NC}"
bash "$PROJECT_ROOT/sofagent/scripts/verify.sh" --quick 2>&1 | tail -3
echo ""

# LLM smoke test（如果配置了 loop.env）——engineer 和 reviewer 各跑一次
if [ -f "$LOOP_ENV_FILE" ]; then
  echo -e "${BOLD}LLM 连通性测试：${NC}"
  NODE_BIN="$(command -v node 2>/dev/null || echo "/usr/local/bin/node")"
  if [ -x "$NODE_BIN" ]; then
    # 把 loop.env 里的 env vars 导出成 shell 数组（不污染当前 shell）
    ENV_VARS=$(grep -E '^export ' "$LOOP_ENV_FILE" | sed 's/^export //' | tr '\n' ' ')

    # 对单个 role 跑 smoke test（参数：role 名称）
    # 返回格式："EXIT_CODE|output..."
    # 退出码：0=成功 1=失败 2=skip（未配置该角色）
    run_smoke_test() {
      local role="$1"
      local raw_output
      raw_output=$(env $ENV_VARS "$NODE_BIN" -e "
        const { ChatOpenAI } = require('@langchain/openai');
        const role = process.argv[1];
        const llmSpec = process.env['SOFAGENT_LLM_' + role.toUpperCase()];
        if (!llmSpec) { console.log('skip: 未配置 ' + role); process.exit(2); }
        const [provider, modelName] = llmSpec.split(':');
        // ⚠️ providerUrls 必须和 nodes.ts 的 LLM_PROVIDERS.baseURL 同步
        //   任何一家 base URL 改了，两处都要改
        const providerUrls = {
          deepseek: 'https://api.deepseek.com/v1/',
          glm: 'https://open.bigmodel.cn/api/paas/v4/',
          kimi: 'https://api.moonshot.cn/v1/',
        };
        // ⚠️ defaultModels 必须和 nodes.ts 的 LLM_PROVIDERS.defaultModel 同步
        const defaultModels = {
          deepseek: 'deepseek-chat',
          glm: 'glm-4-flash',
          kimi: 'moonshot-v1-8k',
        };
        const baseURL = provider === 'custom'
          ? (process.env.SOFAGENT_LLM_BASE_URL || '')
          : (providerUrls[provider] || '');
        if (!baseURL) { console.error('未知的 provider: ' + provider + '（支持 deepseek/glm/kimi/custom）'); process.exit(1); }
        // API key fallback 必须和 nodes.ts resolveApiKey(role) 一致：
        // SOFAGENT_LLM_{ROLE}_API_KEY > SOFAGENT_LLM_API_KEY > OPENAI_API_KEY
        const roleKey = process.env['SOFAGENT_LLM_' + role.toUpperCase() + '_API_KEY'];
        const apiKey = roleKey || process.env.SOFAGENT_LLM_API_KEY || process.env.OPENAI_API_KEY;
        if (!apiKey) { console.error('no api key for ' + role); process.exit(1); }
        const llm = new ChatOpenAI({
          modelName: modelName || defaultModels[provider] || 'test',
          configuration: { baseURL },
          openAIApiKey: apiKey,
          maxTokens: 5,
        });
        llm.invoke('回复一个字: ok').then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
      " "$role" 2>&1)
      local node_exit=$?
      # 只取前 3 行，避免 langchain 长 stack trace 刷屏
      local trimmed
      trimmed=$(echo "$raw_output" | head -3)
      echo "${node_exit}|${trimmed}"
    }

    SMOKE_ANY_FAIL=0
    for ROLE in engineer reviewer; do
      RAW=$(run_smoke_test "$ROLE")
      EXIT_CODE="${RAW%%|*}"
      OUTPUT="${RAW#*|}"

      if [ "$EXIT_CODE" = "2" ]; then
        echo -e "  ${CYAN}$ROLE：$(echo "$OUTPUT" | sed 's/^skip: //')${NC}"
      elif [ "$EXIT_CODE" = "0" ]; then
        echo -e "  ${GREEN}✅ $ROLE 连通性 OK${NC}"
      else
        echo -e "  ${YELLOW}⚠️  $ROLE 连通性失败（exit=$EXIT_CODE）：$(echo "$OUTPUT" | head -1)${NC}"
        SMOKE_ANY_FAIL=1
      fi
    done

    if [ "$SMOKE_ANY_FAIL" = "1" ]; then
      echo -e "  ${CYAN}常见原因: API key 错误 / 余额不足 / 网络不通 / provider 不支持${NC}"
      echo -e "  ${CYAN}LOOP 仍可使用，但跑 loop --task 时对应角色会失败——请检查 ${LOOP_ENV_FILE}${NC}"
    fi
  else
    echo -e "  ${YELLOW}⚠️  未找到 node，跳过 LLM 连通性测试${NC}"
  fi
  echo ""
fi

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
