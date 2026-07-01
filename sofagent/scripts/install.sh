#!/bin/bash
# ============================================================
# sofagent install.sh · 多平台一键安装脚本（v0.99.2）
# ============================================================
# 将 sofagent 约束层部署到目标平台，让 Agent 获得治理能力。
# v0.98: 从 941 行拆分为 4 个 lib 模块 + 纯组装入口
#
# 平台：openclaw（完整）/ workbuddy / claude / codex / hermes / 自动探测
# 外部依赖：agency-orchestrator（仅 OpenClaw）
# ============================================================

set -euo pipefail
VERSION="0.99.3"

# ── 颜色输出 ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[sofagent]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# ── 确定脚本所在目录（支持符号链接）──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 安装日志 ──
INSTALL_LOG=""
_log() { echo "[$(date '+%H:%M:%S')] $1" >> "${INSTALL_LOG:-/dev/null}"; }

# ── 快速模式（v0.73：初始化在参数解析之前，set -u 兼容）──
QUICK_MODE="${QUICK_MODE:-0}"; REMOTE_MODE="${REMOTE_MODE:-0}"

# ── source 模块 ──
source "${SCRIPT_DIR}/lib/platform-detect.sh"
source "${SCRIPT_DIR}/lib/file-deploy.sh"
source "${SCRIPT_DIR}/lib/daemon-register.sh"
source "${SCRIPT_DIR}/lib/post-install.sh"

# ── 环境检测 ──
RUNTIME_ENV=$(detect_env)

# v0.90 P0-1 修复：提前保存原始参数 + 预扫描 --remote
ORIGINAL_ARGS=("$@")
for _arg in "$@"; do [ "$_arg" = "--remote" ] && REMOTE_MODE=1; done

# ── 欢迎 ──
if [ "$QUICK_MODE" = "0" ]; then
  echo ""; echo "  ╔═══════════════════════════════════╗"
  echo "  ║   sofagent Harness · installer   ║"
  echo "  ╚═══════════════════════════════════╝"; echo ""
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
    exec bash sofagent/scripts/install.sh $REMAINING_ARGS
  else
    err "git 不可用——远程安装需要 git。请先安装 git 或使用完整安装方式："
    err "  git clone https://github.com/KongFangXun/sofagent.git && cd sofagent && bash sofagent/scripts/install.sh"
    exit 1
  fi
fi

# ── 审计：安装开始 ──
bash "${SCRIPT_DIR}/audit.sh" --operation "install" --target "开始" --result "v${VERSION}, $(uname -s)" 2>/dev/null || true

# ════════════════════════════════════════
# Step 1: 确定平台和目标路径
# ════════════════════════════════════════
info "Step 1/7 · 确定安装平台..."
parse_args "$@"
auto_detect_platform
resolve_data_dir

# 初始化安装日志
mkdir -p "$TARGET"
INSTALL_LOG="${TARGET}/.sofagent-install.log"
echo "" >> "$INSTALL_LOG"
echo "=== sofagent install $(date -u +'%Y-%m-%dT%H:%M:%SZ') ===" >> "$INSTALL_LOG"
_log "TARGET=$TARGET"; _log "SCRIPT_DIR=$SCRIPT_DIR"

RULES_SRC="${SCRIPT_DIR}/../skill/fde.md"
if [ ! -f "$RULES_SRC" ]; then
  err "找不到 fde.md。请在 sofagent 项目根目录下运行此脚本。"
  err "  当前脚本位置: $SCRIPT_DIR"; err "  期望文件: $RULES_SRC"; exit 1
fi
CONFIG_FILE=""  # Step 7 会精确判断，这里先设默认值避免 unbound variable

# ════════════════════════════════════════
# Step 2: 检查环境（Node.js + npm）
# ════════════════════════════════════════
info "Step 2/7 · 检查运行环境..."
if command -v node &>/dev/null; then
  NODE_VER=$(node --version); ok "Node.js 已安装: $NODE_VER"; _log "node=$NODE_VER"
else
  warn "Node.js 未安装。agency-orchestrator 需要 Node.js >= 18"; warn "请先安装 Node.js: https://nodejs.org/"
fi
if command -v npm &>/dev/null; then
  NPM_VER=$(npm --version); ok "npm 已安装: v$NPM_VER"
  NPM_ROOT=$(npm root -g 2>/dev/null || echo "")
  if [ -n "$NPM_ROOT" ] && [ ! -w "$NPM_ROOT" ]; then
    warn "npm 全局目录不可写 ($NPM_ROOT)"; warn "  npm install -g 可能需要 sudo。考虑以下方案："
    warn "  方案 1: 使用 nvm 或更改 npm prefix（免 sudo）"
    warn "    https://docs.npmjs.com/resolving-eacces-permissions-errors"
    warn "  方案 2: 本次用 sudo npm install -g（不推荐）"; warn "  方案 3: 加 --no-ao 跳过编排引擎（不影响底线约束）"
  fi
else warn "npm 未安装"; fi

# ════════════════════════════════════════
# Step 3: 安装外部依赖（仅 OpenClaw，ao compose 编排用）
# ════════════════════════════════════════
if [ "$PLATFORM" = "openclaw" ] && [ "${NO_AO:-0}" != "1" ]; then
  info "Step 3/7 · 安装外部依赖（agency-orchestrator）..."
  if command -v ao &>/dev/null; then
    AO_VER=$(ao --version 2>/dev/null || echo "unknown"); ok "agency-orchestrator 已安装: $AO_VER"
  elif command -v npm &>/dev/null; then
    info "正在安装 agency-orchestrator..."; set +e
    npm install -g agency-orchestrator@0.7.5 2>&1 | tail -1 || \
      npm install -g agency-orchestrator@0.7.5 --registry=https://registry.npmmirror.com 2>&1 | tail -1
    AO_EXIT_CODE=$?; set -e
    if [ $AO_EXIT_CODE -ne 0 ] && ! command -v ao &>/dev/null; then
      warn "npm install 失败——编排引擎（ao compose）将不可用"
      warn "  降级方案：手动拆任务 → bash scripts/task-record.sh 逐条记录 → 手动闭环"
      warn "  （地基约束层——底线+铁律不受影响）"
    fi
    if command -v ao &>/dev/null; then ok "agency-orchestrator 安装成功"; _log "ao installed successfully"
    else
      warn "ao 命令未在 PATH 中找到，可能需要重新打开终端"
      warn "编排引擎（任务自动拆解/并行执行）将不可用。地基约束层不受影响。"
      warn "降级方案：手动拆任务 → bash scripts/task-record.sh 逐条记录 → 手动闭环"
    fi
  else
    warn "跳过 agency-orchestrator 安装（npm 不可用）"
    warn "编排引擎将不可用。地基约束层（宪法/反思/规则）正常加载。"; warn "详见 Handbook §十三 常见问题"
  fi
  # AO API Key 检查
  if command -v ao &>/dev/null; then
    KEY_FOUND=""
    [ -n "${DEEPSEEK_API_KEY:-}" ] && KEY_FOUND="DeepSeek"
    [ -n "${ANTHROPIC_API_KEY:-}" ] && KEY_FOUND="Claude"
    [ -n "${OPENAI_API_KEY:-}" ] && KEY_FOUND="OpenAI"
    if [ -n "$KEY_FOUND" ]; then ok "AO API Key has been configured ($KEY_FOUND)"
    else
      warn "AO 已安装但未配置模型的 API Key——编排功能将不可用"
      warn "  ⚠️ AO 没有自己的 API Key——你需要用自己模型的 API Key："
      warn "    如果你用 DeepSeek → export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx"
      warn "    如果你用 Claude   → export ANTHROPIC_API_KEY=sk-ant-xxxxxxxx"
      warn "    如果你用 OpenAI  → export OPENAI_API_KEY=sk-proj-xxxxxxxx"
      warn "  写入 ~/.zshrc 永久生效。没有 Key？去对应模型官网申请"
    fi
  fi
fi
# --no-ao 降级方案
if [ "$PLATFORM" = "openclaw" ] && [ "${NO_AO:-0}" = "1" ]; then
  warn "--no-ao 已启用：跳过 agency-orchestrator 安装"; warn "编排引擎不可用。地基约束层不受影响。"
  warn "降级方案：手动拆任务 → bash scripts/task-record.sh 逐条记录 → 手动闭环"
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

echo ""
