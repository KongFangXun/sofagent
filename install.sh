#!/bin/bash
# ============================================================
# sofagent install.sh · 主安装器 / FDE 入口 · v1.2.0
# ============================================================
# 将 sofagent 约束层部署到目标平台，让 Agent 获得治理能力。
#
# 🧭 路径声明（v1.2.0）：本脚本在仓库根目录，是主安装器。
#    默认模式 = FDE 模式（底座 + FDE Agent Skill）。
#    --base-only 模式 = 仅装底座（约束层 + 审计 + 编排）。
#
# 📦 三个安装包边界（v1.2.0）：
#    ┌─────────────────────────────┬──────────┬──────────────────────┬─────────┐
#    │ 脚本                        │ 给谁     │ 装什么               │ 装 LOOP │
#    ├─────────────────────────────┼──────────┼──────────────────────┼─────────┤
#    │ install.sh                  │ 所有用户 │ 底座+FDE Agent Skill │   否    │
#    │ install.sh --base-only      │ 所有用户 │ 约束底座+四引擎      │   否    │
#    │ LOOP/loop-install.sh        │ 开发者   │ 底座+LOOP 自迭代包   │   是    │
#    └─────────────────────────────┴──────────┴──────────────────────┴─────────┘
#    原则：FDE 安装包不自动装 LOOP——LOOP 是 sofagent 项目的自迭代
#    开发工具包（管理代码变更，给开发者用），不属于企业交付物。
#
# 🔗 跨产品契约：LOOP/loop-install.sh 依赖本脚本（--base-only 模式）。
#    改动此文件前，确认 LOOP 的安装链路不受影响：
#    - LOOP 调用 `bash install.sh --base-only --platform "$PLATFORM"` 作为底座安装入口
#    - 改参数名/输出路径/依赖文件前必须 grep LOOP 的调用方式
#    - 删被依赖文件（如 SKILL/harness/data/fde.md）前确认 LOOP install 不再引用
# v0.98: 从 941 行拆分为 4 个 lib 模块 + 纯组装入口
# v1.0.7: ao 退役，移除 agency-orchestrator 安装逻辑
# v1.2.0: install.sh 吸收 FDE/fde-install.sh，成为主安装器+FDE 入口
#
# 平台：openclaw（完整）/ workbuddy / claude / codex / hermes / 自动探测
# 编排引擎：DeepAgents（npm 包，正式依赖）
#
# ── 跨产品调用契约（v1.2.0）──
# LOOP/loop-install.sh 在第 1 步会调用本脚本：
#   bash "$PROJECT_ROOT/install.sh" --base-only --platform "$PLATFORM"
# 版本锁定：本脚本的接口（入参/退出码/副作用）从 v1.1.5 起冻结，
# 任何 breaking change 必须 bump major 版本并同步更新 LOOP install 脚本。
# 契约约定：
#   1. 入参：--platform <name>（可选，缺省时自动探测）/ --base-only（仅装底座）
#   2. 退出码：0=成功，非 0=失败（调用方依赖 set -e 自动中断）
#   3. 副作用：写入 ~/.sofagent/ + 目标平台配置目录；不修改调用方脚本
#   4. 幂等性：重复执行安全，已存在的 hook/config 不覆盖（除非 --force）
#   5. 输出：使用 [sofagent] 前缀，调用方可据日志判断阶段
# ============================================================

set -euo pipefail
VERSION="1.2.0"

# ── 颜色输出（合并两套）──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${BLUE}[sofagent]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# ── 确定脚本所在目录（支持符号链接）──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# v1.2.0: install.sh 提升到根目录，lib/ 仍在 engine/scripts/lib/
LIB_DIR="${SCRIPT_DIR}/engine/scripts/lib"

# ── 安装日志 ──
INSTALL_LOG=""
_log() { echo "[$(date '+%H:%M:%S')] $1" >> "${INSTALL_LOG:-/dev/null}"; }

# ── 快速模式（v0.73：初始化在参数解析之前，set -u 兼容）──
QUICK_MODE="${QUICK_MODE:-0}"; REMOTE_MODE="${REMOTE_MODE:-0}"

# ── FDE 模式（默认开启，--base-only 关闭）──
BASE_ONLY=0

# ── 预扫描 --base-only（在 source/参数解析前捕获）──
for _arg in "$@"; do [ "$_arg" = "--base-only" ] && BASE_ONLY=1; done

# ── source 模块 ──
# shellcheck disable=SC1091
source "${LIB_DIR}/platform-detect.sh"
# shellcheck disable=SC1091
source "${LIB_DIR}/file-deploy.sh"
# shellcheck disable=SC1091
source "${LIB_DIR}/daemon-register.sh"
# shellcheck disable=SC1091
source "${LIB_DIR}/post-install.sh"

# ── 环境检测 ──
RUNTIME_ENV=$(detect_env)

# v0.90 P0-1 修复：提前保存原始参数 + 预扫描 --remote
ORIGINAL_ARGS=("$@")
for _arg in "$@"; do [ "$_arg" = "--remote" ] && REMOTE_MODE=1; done

# ── 欢迎 ──
if [ "$QUICK_MODE" = "0" ]; then
  echo ""
  if [ "${BASE_ONLY:-0}" = "0" ]; then
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}  sofagent 主安装器 · 底座 + FDE Agent${NC}"
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  else
    echo "  ╔═══════════════════════════════════╗"
    echo "  ║   sofagent Harness · installer   ║"
    echo "  ╚═══════════════════════════════════╝"
  fi
  echo ""
  info "运行环境: $RUNTIME_ENV"
  # Windows 原生 bash（非 WSL）提示使用 PowerShell 脚本
  if [[ "$RUNTIME_ENV" == "Windows (native bash)" ]] && [ -z "${WSL_DISTRO_NAME:-}" ]; then
    warn "检测到 Windows 原生 bash 环境"
    warn "  建议使用 PowerShell 脚本: .\\install.ps1 -Platform workbuddy"
    warn "  bash 脚本在 Windows 上可能遇到 CRLF 换行符问题"
    warn "  如坚持使用 bash，请确保脚本已转换为 LF 换行符"; echo ""
  fi
fi

# ── 远程安装模式（curl pipe bash 场景）──
if [ "${REMOTE_MODE}" = "1" ]; then
  info "远程安装模式——克隆仓库..."
  REMOTE_TMP="$(mktemp -d /tmp/sofagent-remote-XXXXXX)"
  if command -v git &>/dev/null; then
    git clone https://github.com/KongFangXun/sofagent.git "$REMOTE_TMP" 2>/dev/null || { err "git clone 失败，请检查网络或手动 git clone"; exit 1; }
    ok "仓库已克隆到: $REMOTE_TMP"; cd "$REMOTE_TMP"
    REMAINING_ARGS=""
    for _arg in "${ORIGINAL_ARGS[@]}"; do [ "$_arg" = "--remote" ] && continue; REMAINING_ARGS="$REMAINING_ARGS $_arg"; done
    exec bash install.sh "${REMAINING_ARGS# }"
  else
    err "git 不可用——远程安装需要 git。请先安装 git 或使用完整安装方式："
    err "  git clone https://github.com/KongFangXun/sofagent.git && cd sofagent && bash install.sh"
    exit 1
  fi
fi

# ── 审计：安装开始 ──
bash "${SCRIPT_DIR}/engine/scripts/audit.sh" --operation "install" --target "开始" --result "v${VERSION}, $(uname -s)" 2>/dev/null || true

# ════════════════════════════════════════
# Step 1: 确定平台和目标路径
# ════════════════════════════════════════
info "Step 1/8 · 确定安装平台..."
parse_args "$@"
auto_detect_platform
resolve_data_dir

# 初始化安装日志
mkdir -p "$TARGET"
INSTALL_LOG="${TARGET}/.sofagent-install.log"
echo "" >> "$INSTALL_LOG"
echo "=== sofagent install $(date -u +'%Y-%m-%dT%H:%M:%SZ') ===" >> "$INSTALL_LOG"
_log "TARGET=$TARGET"; _log "SCRIPT_DIR=$SCRIPT_DIR"

RULES_SRC="${SCRIPT_DIR}/SKILL/harness/data/fde.md"
if [ ! -f "$RULES_SRC" ]; then
  err "找不到 fde.md。请在 sofagent 项目根目录下运行此脚本。"
  err "  当前脚本位置: $SCRIPT_DIR"; err "  期望文件: $RULES_SRC"; exit 1
fi
# CONFIG_FILE 不预声明——Step 7 中用 local 声明（避免 SC2034 unused 警告）

# ════════════════════════════════════════
# Step 2: 检查环境（Node.js + npm）
# ════════════════════════════════════════
info "Step 2/8 · 检查运行环境..."
if command -v node &>/dev/null; then
  NODE_VER=$(node --version); ok "Node.js 已安装: $NODE_VER"; _log "node=$NODE_VER"
else
  warn "Node.js 未安装。编排引擎（DeepAgents）需要 Node.js >= 18"; warn "请先安装 Node.js: https://nodejs.org/"
fi
if command -v npm &>/dev/null; then
  NPM_VER=$(npm --version); ok "npm 已安装: v$NPM_VER"
  NPM_ROOT=$(npm root -g 2>/dev/null || echo "")
  if [ -n "$NPM_ROOT" ] && [ ! -w "$NPM_ROOT" ]; then
    warn "npm 全局目录不可写 ($NPM_ROOT)"; warn "  npm install -g 可能需要 sudo。考虑以下方案："
    warn "  方案 1: 使用 nvm 或更改 npm prefix（免 sudo）"
    warn "    https://docs.npmjs.com/resolving-eacces-permissions-errors"
  fi
else warn "npm 未安装"; fi

# ════════════════════════════════════════
# Step 3: 编排引擎（v1.0.7：DeepAgents，正式依赖）
# ════════════════════════════════════════
info "Step 3/8 · 编排引擎: DeepAgents（@sofagent/audit 正式依赖）"
# 优先使用仓库本地的 engine/audit/dist/（避免 npm @latest 版本漂移）
# 仓库本地版本与用户 clone 的版本一致，npm registry 可能滞后
LOCAL_AUDIT_DIST="$PROJECT_ROOT/engine/audit/dist/index.js"
NPM_GLOBAL_BIN=$(npm bin -g 2>/dev/null || echo "/usr/local/bin")

if command -v npm &>/dev/null; then
  if [ -f "$LOCAL_AUDIT_DIST" ]; then
    # 仓库本地构建已就绪，创建 wrapper 到全局路径
    mkdir -p "$NPM_GLOBAL_BIN" 2>/dev/null || true
    cat > "$NPM_GLOBAL_BIN/sofagent-audit" << 'WRAPPER_EOF'
#!/usr/bin/env bash
# sofagent-audit wrapper（从仓库本地 dist 安装）
exec node "WRAPPER_EOF
    echo "$LOCAL_AUDIT_DIST" >> "$NPM_GLOBAL_BIN/sofagent-audit"
    echo '"$@"' >> "$NPM_GLOBAL_BIN/sofagent-audit"
    chmod +x "$NPM_GLOBAL_BIN/sofagent-audit" 2>/dev/null || true
    ok "  @sofagent/audit 已从仓库本地安装（$(node -e "console.log(require('./engine/audit/package.json').version)" 2>/dev/null || echo "v1.2.0")）"
  else
    info "  执行: npm install -g @sofagent/audit@latest"
    if npm install -g "@sofagent/audit@latest" 2>&1 | tail -1; then
      ok "  @sofagent/audit 已全局安装（含 DeepAgents 编排引擎）"
    else
      warn "  npm install -g @sofagent/audit 失败（网络/权限问题）"
      warn "  请手动安装: npm install -g @sofagent/audit"
    fi
  fi
else
  warn "  npm 不可用，跳过 @sofagent/audit 安装"
  warn "  请安装 Node.js + npm 后手动运行: npm install -g @sofagent/audit"
fi

# ════════════════════════════════════════
# Step 4-5b: 部署文件
# ════════════════════════════════════════
deploy_constitution    # Step 4: 创建目录 + 复制宪法文件
deploy_skill_files     # Step 5: 复制 Skill + 数据文件
deploy_scripts         # Step 5b: 部署配套脚本 + 数据目录

# ════════════════════════════════════════
# Step 6-7: Hook + 断路器
# ════════════════════════════════════════
deploy_hook            # Step 6: 部署加载链 Hook（仅 OpenClaw）
inject_loopdetect      # Step 7: 注入断路器配置（仅 OpenClaw）

# ════════════════════════════════════════
# Step 8: 种子指令 + 完成输出 + daemon + 审计
# ════════════════════════════════════════
write_seed_instructions
print_completion_summary
install_daemon
log_install_audit

# SkillOpt 自进化引擎（可选）
# 注意：pip install skillopt 不包含 skillopt-sleep CLI
# 需要完整安装：
#   git clone https://github.com/microsoft/SkillOpt.git ~/SkillOpt
#   cd ~/SkillOpt && pip install -e .
echo "ℹ️ SkillOpt 自进化引擎（可选）：clone github.com/microsoft/SkillOpt + pip install -e ."

# ── v1.1.0: 可选包提示（这些不在自动安装范围内，仅提示）──
echo ""
echo "可选 npm 包（上述未自动安装，按需运行）："
echo "  npm install -g @sofagent/orchestrator   # 独立编排引擎"
echo "  npm install -g @sofagent/daemon          # 守护进程"
echo "  npm install -g @sofagent/core            # 基础设施（doctor/verify）"
echo "  npm install -g @sofagent/ontology        # 本体模型"

# deepagents Sub Agent 引擎（正式依赖——npm install @sofagent/audit 自动安装）
echo "  💡 Sub Agent 引擎: deepagents（@sofagent/audit 正式依赖，npm install 自动安装）"

# ── v1.1.0: TencentDB Memory 集成（--with-memory flag）──
if [[ "${WITH_MEMORY:-0}" == "1" ]]; then
  MEMORY_DIR="$HOME/.openclaw/memory-tdai"
  CONFIG_PATH="${TARGET}/.sofagent/config.yml"

  echo ""
  echo "  📝 配置 TencentDB Memory 集成..."

  if [[ ! -d "$MEMORY_DIR" ]]; then
    echo "  ⚠️  $MEMORY_DIR 不存在"
    echo "     先在 OpenClaw 上跑 3-5 天对话产生记忆数据，memory-sync 会自动处理"
    echo "     安装继续——memory 集成在目录出现后自动生效（防断裂机制）"
  else
    echo "  ✅ TencentDB Memory 集成已启用"
    echo "     persona.md 将从 $MEMORY_DIR 自动同步"
  fi

  # 写入 config.yml 开启 memory_sync
  if [[ -f "$CONFIG_PATH" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -e 's/memory_sync: false/memory_sync: true/g' "$CONFIG_PATH" > "${CONFIG_PATH}.tmp" && mv "${CONFIG_PATH}.tmp" "$CONFIG_PATH"
    else
      sed -i 's/memory_sync: false/memory_sync: true/g' "$CONFIG_PATH"
    fi
    echo "  ✅ config.yml memory_sync 已开启"
  fi
fi

# ════════════════════════════════════════
# FDE 专属步骤（仅默认模式，--base-only 时跳过）
# ════════════════════════════════════════
if [ "${BASE_ONLY:-0}" = "0" ]; then

  echo ""
  echo -e "${BOLD}[FDE] 写入 FDE 运行规范 + 安装 Agent Skill...${NC}"

  # ── 写入 fde.md（按平台选目标路径）──
  # ⚠️ 路径必须与 handler.ts / checks.ts 的读取路径对齐：skills/sofagent/
  # （v1.2.0 仓库改名 /sofagent/→/engine/ 不影响部署目标路径——消费方仍读 skills/sofagent/）
  case "$PLATFORM" in
    openclaw) FDE_MD_TARGET="$HOME/.openclaw/skills/sofagent/fde.md" ;;
    workbuddy) FDE_MD_TARGET="$HOME/.workbuddy/skills/sofagent/fde.md" ;;
    claude) FDE_MD_TARGET="$HOME/.claude/fde.md" ;;
    codex) FDE_MD_TARGET="$HOME/.codex/fde.md" ;;
    hermes) FDE_MD_TARGET="$HOME/.hermes/fde.md" ;;
    *) FDE_MD_TARGET="" ;;
  esac

  if [ -n "$FDE_MD_TARGET" ] && [ -f "$RULES_SRC" ]; then
    mkdir -p "$(dirname "$FDE_MD_TARGET")" 2>/dev/null || true
    cp "$RULES_SRC" "$FDE_MD_TARGET"
    echo -e "${GREEN}✅ fde.md 已写入 ${FDE_MD_TARGET}${NC}"
    echo -e "  ${CYAN}请编辑此文件，填写你的工作规则${NC}"

    # v1.0.7: 同时安装 FDE + Audit 两个内置 Agent 的 Skill
    # v1.2.0: Skill 收敛到 /SKILL/（agents/SKILL/ → SKILL/agents/）
    SKILL_SRC="${SCRIPT_DIR}/SKILL"
    SKILL_DIR="$(dirname "$FDE_MD_TARGET")"
    if [ -f "$SKILL_SRC/SKILL.md" ]; then
      cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/sofagent-fde/SKILL.md" 2>/dev/null || cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/SKILL.md"
      echo -e "${GREEN}✅ FDE Agent Skill 已安装（@sofagent-fde 可用）${NC}"
    fi
    if [ -d "$SKILL_SRC/agents/audit" ]; then
      cp -r "$SKILL_SRC/agents/audit" "$SKILL_DIR/sofagent-audit"
      echo -e "${GREEN}✅ Audit Agent Skill 已安装（@sofagent-audit 可用）${NC}"
    fi
  else
    echo -e "${CYAN}⚠️ 跳过 fde.md（模板或目标路径不存在）${NC}"
  fi

  # ── 验证安装 ──
  echo ""
  echo -e "${BOLD}[FDE] 验证安装...${NC}"
  bash "${SCRIPT_DIR}/engine/scripts/verify.sh" --quick --platform "$PLATFORM" 2>&1 | tail -3
  echo ""

  # ── FDE 完成输出 ──
  echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${GREEN}  ✅ 你的电脑现在是一个 FDE 节点了${NC}"
  echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${BOLD}下一步：${NC}"
  if [ "$PLATFORM" = "openclaw" ]; then
    echo -e "  1. 打开你的 Agent——它会检测到 FDE 场景，自动加载工作台"
    echo -e "  2. 告诉 Agent 企业基本信息（名称/行业/规模），开始 §1 确定场景"
    echo -e "  3. 走完 12 步后，找台闲置设备装上 sofagent 底座给客户"
  else
    echo -e "  1. 在你的 Agent 中输入 ${BOLD}@sofagent-fde${NC} 开始部署"
    echo -e "  2. Agent 读完后按 FDE 流程引导你梳理工作流"
  fi
  echo ""
  echo -e "  ${CYAN}内置 Agent：${NC}@sofagent-fde（部署工程师）+ @sofagent-audit（合规审计员）"
  echo -e "  ${CYAN}详细指南见 FDE/README.md${NC}"
  echo ""

else
  # ── 底座-only 完成输出 ──
  echo ""
  echo -e "${GREEN}✅ sofagent 底座安装完成（--base-only 模式）${NC}"
  echo ""
fi
