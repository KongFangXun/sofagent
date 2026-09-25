#!/usr/bin/env bash
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
    echo "  跳过：编排模块 / Hook / 断路器 / daemon / 配套脚本"; echo ""
    echo "  降 80% 复杂度，保 60% 价值。非交互式平台推荐先用 Lite 体验核心约束。"; echo ""; exit 0
  fi
  echo ""; echo "  ╔══════════════════════════════════════════╗"
  echo "  ║  sofagent · 安装完成！                  ║"
  echo "  ╚══════════════════════════════════════════╝"; echo ""
  case "$PLATFORM" in
    "")
      # 平台无关安装：未指定平台，只写了自己的目录
      echo "  已部署文件："
      echo "    Skill 文件:     $SOFAGENT_HOME/skill/（统一路径，平台无关安装）"
      echo "    配套脚本:       $TARGET/scripts/{task-record,cleanup,audit}.sh"
      echo "    数据目录:       $SOFAGENT_DATA"; echo ""
      echo "  ┌──────────────────────────────────────────┐"
      echo "  │  平台无关安装：只写了 ~/.sofagent/        │"
      echo "  │  未探测/未修改任何第三方平台配置          │"
      echo "  └──────────────────────────────────────────┘" ;;
    openclaw)
      echo "  已部署文件："
      echo "    宪法文件:      $TARGET/skills/sofagent/fde.md（宪法内联在 SKILL.md）"
      echo "    Skill 文件:     $TARGET/skills/sofagent/（SKILL.md + 分层 rules/ + harness 约束骨架与 agents 子 Skill，以 SKILL/ 目录实际清单为准）"
      echo "    加载链 Hook:    $TARGET/hooks/sofagent-load-chain/（HOOK.md + handler.ts）"
      echo "    配套脚本:       $TARGET/scripts/{task-record,cleanup,audit}.sh"
      echo "    断路器:         ${CONFIG_FILE:-未配置}（tools.loopDetection）"
      echo "    数据目录:       $SOFAGENT_DATA"; echo ""
      echo "  ┌──────────────────────────────────────────┐"
      echo "  │  OpenClaw: 完整就绪                       │"
      echo "  │  三层加载链自动注入 + Hook 强制加载        │"
      echo "  │  + 编排模块 + 脚本 + 断路器，全部可用      │"
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
      echo "    Skill 文件:     $TARGET/skills/sofagent/（SKILL.md + 分层 rules/ + harness 约束骨架，以 SKILL/ 目录实际清单为准）"
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
  # v1.4.5 (T5/R4): 按安装形态分流指路——原「bash engine/scripts/verify.sh」与
  # 「cat docs/HANDBOOK.md」是仓库相对路径，仅在 git clone install.sh 形态下成立。
  # npm 全局安装形态（install.sh 内 npm install -g @sofagent/audit 分支）下
  # CWD 无 engine/ 与 docs/ 目录，指路断链。判定：安装产物目录里有 verify.sh
  # 则给仓库内相对路径；否则给全局命令形态（sofagent-core verify / npm docs）。
  if [ -f "${SOFAGENT_HOME}/bin/sofagent" ] && command -v sofagent-core >/dev/null 2>&1; then
    # npm 全局形态：CLI 已入 PATH
    echo "  1. 验证安装：sofagent-core verify"
    echo "  2. 在你的 git 项目初始化审计：sofagent-audit --init"
    echo "  3. 体验效果：cd 你的 git 项目 && git commit（hook 自动触发）"
    echo "  4. 5 分钟入门：npm docs @sofagent/audit（或访问仓库 docs/HANDBOOK.md）"
  else
    # 仓库形态兜底：git clone 形态（SCRIPT_DIR = 仓库根）给绝对路径，任何 CWD 均有效；
    # bootstrap（curl | bash）形态磁盘上无 engine/（临时目录只有 install.sh + lib），
    # 相对路径必断链，按 verify.sh 存在性分流，改指全局命令 + PATH 修复提示（v1.4.8 修复）
    if [ -f "${SCRIPT_DIR:-}/engine/scripts/verify.sh" ]; then
      echo "  1. 验证安装：bash \"${SCRIPT_DIR}/engine/scripts/verify.sh\""
      echo "  2. 在你的 git 项目初始化审计：sofagent-audit --init"
      echo "  3. 体验效果：cd 你的 git 项目 && git commit（hook 自动触发）"
      echo "  4. 5 分钟入门：cat \"${SCRIPT_DIR}/docs/HANDBOOK.md\""
    else
      echo '  1. 验证安装：npm install -g @sofagent/core && sofagent-core verify（bootstrap 形态只装 @sofagent/audit，core 属按需可选包；若 command not found，先: export PATH="$HOME/.local/bin:$PATH"，步骤 2 的 sofagent-audit --init 同样依赖此 PATH）'
      echo "  2. 在你的 git 项目初始化审计：sofagent-audit --init"
      echo "  3. 体验效果：cd 你的 git 项目 && git commit（hook 自动触发）"
      echo "  4. 5 分钟入门：npm docs @sofagent/audit（或访问仓库 docs/HANDBOOK.md）"
    fi
  fi
  echo ""
  echo "  如需卸载：删除 ~/.sofagent/、~/.sofagent-key 即可（保留你的项目数据）"
  echo '  卸载审计 hook（--install-hook 安装了三个，需全部删除）：'
  echo '    rm -f "$(git rev-parse --git-path hooks)/pre-commit"'
  echo '    rm -f "$(git rev-parse --git-path hooks)/commit-msg"'
  echo '    rm -f "$(git rev-parse --git-path hooks)/post-commit"'
  echo '  ⚠️ 若安装前仓库已有自有 hook（--install-hook 会将其保存为 <hook>.pre-sofagent 并链式调用），先还原再删，否则自有 hook 将被孤儿化：'
  echo '    for f in pre-commit commit-msg post-commit; do [ -f "$(git rev-parse --git-path hooks)/$f.pre-sofagent" ] && mv "$(git rev-parse --git-path hooks)/$f.pre-sofagent" "$(git rev-parse --git-path hooks)/$f"; done'
  echo "  历史拦截：全新安装，审计历史将从第一次提交开始记录。"
  echo ""
  # F-16：按 hook 实态三分支（INSTALL_HOOK_STATUS 由 install.sh Step 6.5 导出）——
  # 原无条件「已就绪，下次 commit 自动生效」在 hook 未装成时是假承诺。
  case "${INSTALL_HOOK_STATUS:-skipped}" in
    ok)      echo "  ✅ sofagent 已就绪，下次 git commit 自动生效" ;;
    failed)  echo "  ⚠️  git hook 安装失败——下次 git commit 不会自动审计，请手动运行: sofagent-audit --init" ;;
    *)       echo "  ℹ️  当前目录非 git 仓库或引擎未就绪——hook 未安装；进入 git 项目后运行: sofagent-audit --init" ;;
  esac
  [ "$PLATFORM" = "openclaw" ] || return 0
  # API Key 提醒 + Hook 状态提示（仅 OpenClaw）
  [ "${NO_CONFIG_INJECT:-0}" = "1" ] && echo "  ⚠️  --no-config-inject 已启用：未注入断路器配置，需手动配置 tools.loopDetection"
  if [ -z "${DEEPSEEK_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
    echo "  🔑 配置 LLM API Key（这是你已有的模型 Key，三选一）："
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
  echo '  💡 运行 `sofagent-core verify` 验证安装是否完整。'
}
# v1.2.2 F-09: 关键组件部署校验——安装后自检
verify_component_integrity() {
  local MISSING_COMPONENTS=""
  for f in "${SOFAGENT_HOME}/bin/sofagent" "${TARGET}/scripts/task-record.sh" "${TARGET}/scripts/cleanup.sh"; do
    [ -f "$f" ] || MISSING_COMPONENTS="${MISSING_COMPONENTS}  ${f}\n"
  done
  if [ -n "$MISSING_COMPONENTS" ]; then
    echo ""
    warn "以下关键组件未成功部署："
    echo -e "${MISSING_COMPONENTS}"
    warn "  可能原因：源文件路径错误或权限不足。请重新运行 bash install.sh"
    exit 1
  fi
}

log_install_audit() {  # 审计：安装完成 + HMAC key 生成
  # v1.2.0 P0⑥ 修复：自动生成 HMAC 签名密钥（~/.sofagent-key，chmod 600）
  # 无此密钥时 history.jsonl 仅用 SHA-256 hash chain（可追溯非强防篡改），
  # 有此密钥时每条记录带 HMAC-SHA256 签名（防 Agent 篡改后重算整链）
  local HMAC_KEY="$HOME/.sofagent-key"
  if [ ! -f "$HMAC_KEY" ]; then
    # 生成 32 字节随机密钥（hex 编码 = 64 字符）
    local GENERATED_KEY
    if [ -c /dev/urandom ]; then
      GENERATED_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    else
      GENERATED_KEY=$(date +%s%N | md5sum | head -c 64)
    fi
    if [ -n "$GENERATED_KEY" ]; then
      echo "$GENERATED_KEY" > "$HMAC_KEY"
      chmod 600 "$HMAC_KEY"
      ok "HMAC 签名密钥已生成（$HMAC_KEY · chmod 600）— history.jsonl 强防篡改已启用"
      _log "hmac-key generated: $HMAC_KEY"
    fi
  else
    ok "HMAC 签名密钥已存在（${HMAC_KEY}）— history.jsonl 强防篡改已启用"
  fi
  bash "${SCRIPT_DIR}/audit.sh" --operation "install" --target "完成" --result "成功" 2>/dev/null || true
  _log "install complete: constitution=1(rules) skills=6 hook=1 loopdetect=1"
  _log "install log saved to $INSTALL_LOG"
}
