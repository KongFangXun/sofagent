#!/bin/bash
# post-install.sh · 种子指令 + 完成输出 + 审计日志
# 导出：write_seed_instructions / print_completion_summary / log_install_audit

write_seed_instructions() {  # 手动平台：输出 + 自动写入种子指令（claude/codex/hermes）
  [ "$PLATFORM" != "claude" ] && [ "$PLATFORM" != "codex" ] && [ "$PLATFORM" != "hermes" ] && return 0
  # P1-5: 按平台确定种子指令目标文件和内容
  local SEED_FILE="" SEED_PLATFORM_LABEL=""
  case "$PLATFORM" in
    claude) SEED_FILE="$HOME/.claude/CLAUDE.md";  SEED_PLATFORM_LABEL="$HOME/.claude/fde.md" ;;
    codex)  SEED_FILE="$HOME/.codex/AGENTS.md";   SEED_PLATFORM_LABEL="$HOME/.codex/fde.md" ;;
    hermes) SEED_FILE="$HOME/.hermes/SOUL.md";    SEED_PLATFORM_LABEL="$HOME/.hermes/fde.md" ;;
  esac
  local SEED_CONTENT="每次对话开始时，读取以下文件并执行 sofagent 入口流程：
1. fde.md：${SEED_PLATFORM_LABEL}（宪法已在 SKILL.md 内联）
2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思
如果数据文件（.sofagent/）不存在，先创建空模板。"
  # P1-5: 自动写入种子指令（查重：已含 sofagent 则跳过）
  if [ -f "$SEED_FILE" ] && grep -q 'sofagent' "$SEED_FILE" 2>/dev/null; then ok "种子指令已存在于 ${SEED_FILE}，跳过写入"
  else mkdir -p "$(dirname "$SEED_FILE")"; echo "" >> "$SEED_FILE"; echo "$SEED_CONTENT" >> "$SEED_FILE"; ok "种子指令已自动写入 $SEED_FILE"; fi
  echo ""; echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║  📋 种子指令已自动写入配置文件            ║"
  echo "  ╚══════════════════════════════════════════════╝"; echo ""
  echo ""; echo "  目标文件：$SEED_FILE"; echo ""; echo "  ── 写入内容 ──"; echo ""
  echo "  每次对话开始时，读取以下文件并执行 sofagent 入口流程："
  echo "  1. fde.md：${SEED_PLATFORM_LABEL}（宪法已在 SKILL.md 内联）"
  echo "  2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思"
  echo "  如果数据文件（.sofagent/）不存在，先创建空模板。"; echo ""
  echo "  💡 在下一轮对话中回复「sofagent」验证是否加载成功。"; echo ""
}
print_completion_summary() {  # 安装完成 · 使用说明（按平台）
  if [ "${LITE_MODE:-0}" = "1" ]; then
    echo ""; echo "  ╔══════════════════════════════════════════╗"
    echo "  ║  sofagent Lite · 安装完成！              ║"
    echo "  ╚══════════════════════════════════════════╝"; echo ""
    echo "  已部署：宪法（SKILL.md）+ 反思区（think.md）+ 规则（fde.md）"
    echo "  跳过：编排引擎 / Hook / 断路器 / daemon / 配套脚本"; echo ""
    echo "  降 80% 复杂度，保 60% 价值。非交互式平台推荐先用 Lite 体验核心约束。"; echo ""; exit 0
  fi
  echo ""; echo "  ╔══════════════════════════════════════════╗"
  echo "  ║  sofagent · 安装完成！                  ║"
  echo "  ╚══════════════════════════════════════════╝"; echo ""
  case "$PLATFORM" in
    openclaw)
      echo "  已部署文件："
      echo "    宪法文件:      $TARGET/skills/sofagent/fde.md（宪法内联在 SKILL.md）"
      echo "    Skill 文件:     $TARGET/skills/sofagent/（6 核心 + 4 数据模板）"
      echo "    加载链 Hook:    $TARGET/hooks/sofagent-load-chain/（HOOK.md + handler.ts）"
      echo "    配套脚本:       $TARGET/scripts/{task-record,cleanup,audit}.sh"
      echo "    断路器:         ${CONFIG_FILE:-未配置}（tools.loopDetection）"
      echo "    数据目录:       $SOFAGENT_DATA"; echo ""
      echo "  ┌──────────────────────────────────────────┐"
      echo "  │  OpenClaw: 完整就绪                       │"
      echo "  │  三层加载链自动注入 + Hook 强制加载        │"
      echo "  │  + 编排引擎 + 脚本 + 断路器，全部可用      │"
      echo "  └──────────────────────────────────────────┘" ;;
    claude|codex|hermes)
      echo "  已部署文件："
      echo "    宪法文件:      $TARGET/fde.md（宪法内联在 SKILL.md）"
      echo "    数据目录:       $SOFAGENT_DATA"; echo ""
      echo "  ⚠️  ${PLATFORM} 是手动平台——请复制上方种子指令到配置文件。"; echo ""
      echo "  ┌──────────────────────────────────────────┐"
      echo "  │  ${PLATFORM}: 仅基础约束生效              │"
      echo "  │  SKILL.md 底线+铁律有效；Hook/编排不可用   │"
      echo "  └──────────────────────────────────────────┘" ;;
    workbuddy)
      echo "  已部署文件："
      echo "    Skill 文件:     $TARGET/skills/sofagent/（6 核心 + 4 数据模板）"
      echo "    数据目录:       $SOFAGENT_DATA"; echo ""
      echo "  ┌──────────────────────────────────────────┐"
      echo "  │  WorkBuddy: 仅基础约束生效                │"
      echo "  │  Skill 系统加载底线+铁律；脚本沙箱受限     │"
      echo "  └──────────────────────────────────────────┘" ;;
  esac
  echo ""
  echo "  ┌──────────────────────────────────────────┐"
  echo "  │  下一步                                   │"
  echo "  └──────────────────────────────────────────┘"
  echo ""
  echo "  1. 验证安装：bash sofagent/scripts/verify.sh"
  echo "  2. 体验审计：cd 你的 git 项目 && git commit（pre-commit hook 自动触发）"
  echo "  3. 了解更多：cat README.md 或 cat HANDBOOK.md"
  echo ""
  [ "$PLATFORM" = "openclaw" ] || return 0
  # API Key 提醒 + Hook 状态提示（仅 OpenClaw）
  [ "${NO_CONFIG_INJECT:-0}" = "1" ] && echo "  ⚠️  --no-config-inject 已启用：未注入断路器配置，需手动配置 tools.loopDetection"
  if command -v ao &>/dev/null && [ -z "${DEEPSEEK_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
    echo "  🔑 配置 AO API Key（这是你已有的 LLM Key，三选一）："
    echo "     export DEEPSEEK_API_KEY=你的DeepSeek密钥"
    echo "     export ANTHROPIC_API_KEY=你的Claude密钥"
    echo "     export OPENAI_API_KEY=你的OpenAI密钥"; echo "     写入 ~/.zshrc 永久生效"; echo ""
  fi
  if [ -f "${HOOK_CONFIG:-}" ] && grep -q '"sofagent-load-chain"' "$HOOK_CONFIG" 2>/dev/null; then
    echo "  ✅ Hook 已自动注册（openclaw.json）→ 每次启动自动注入约束"
  else
    echo "  ⚠️  Hook 未注册 → 约束层不会自动加载"
    echo "     在 ${HOOK_CONFIG} 的 hooks.internal.entries 添加："; echo '     {"sofagent-load-chain":{"enabled":true}}'
  fi
  echo "  💡 运行 verify.sh 验证安装是否完整。"
}
log_install_audit() {  # 审计：安装完成
  bash "${SCRIPT_DIR}/audit.sh" --operation "install" --target "完成" --result "成功" 2>/dev/null || true
  _log "install complete: constitution=1(rules) skills=6 hook=1 loopdetect=1"
  _log "install log saved to $INSTALL_LOG"
}
