#!/bin/bash
# ============================================================
# sofagent install.sh · 主安装器 / FDE 入口 · v1.2.1
# ============================================================
# 将 sofagent 约束层部署到目标平台，让 Agent 获得治理能力。
#
# 🧭 路径声明（v1.2.0）：本脚本在仓库根目录，是主安装器。
#    默认模式 = FDE 模式（底座 + FDE Agent Skill）。
#    --base-only 模式 = 仅装底座（约束层 + 审计 + 编排）。
#
# 📦 安装包边界（v1.2.0）：
#    ┌─────────────────────────┬──────────┬──────────────────────┐
#    │ 脚本                    │ 给谁     │ 装什么               │
#    ├─────────────────────────┼──────────┼──────────────────────┤
#    │ install.sh              │ 所有用户 │ 底座+FDE Agent Skill │
#    │ install.sh --base-only  │ 所有用户 │ 约束底座+四引擎      │
#    └─────────────────────────┴──────────┴──────────────────────┘
#    原则：FORGE 由 `FORGE/SKILL/<loop>/` 定义驱动，无需单独安装脚本——
#    FORGE 是 sofagent 项目的自迭代开发工具包（管理代码变更，给开发者用），
#    不属于企业交付物。
#
# 🔗 编排契约：FDE 调用本脚本（--base-only 模式）作为底座安装入口。
#    改动此文件前确认调用方不受影响：
#    - FDE 通过 `bash install.sh --base-only --platform "$PLATFORM"` 安装底座
#    - 删被依赖文件（如 SKILL/harness/data/fde.md）前确认无调用方引用
# v0.98: 从 941 行拆分为 4 个 lib 模块 + 纯组装入口
# v1.0.7: ao 退役，移除 agency-orchestrator 安装逻辑
# v1.2.0: install.sh 吸收 FDE/fde-install.sh，成为主安装器+FDE 入口
#
# 平台：openclaw（完整）/ workbuddy / claude / codex / hermes / 自动探测
# 编排引擎：LangGraph createReactAgent（@langchain/langgraph，正式依赖）
#
# ── 调用契约（v1.2.0）──
# FDE 通过以下方式调用本脚本安装底座：
#   bash "$PROJECT_ROOT/install.sh" --base-only --platform "$PLATFORM"
# 版本锁定：本脚本的接口（入参/退出码/副作用）从 v1.1.5 起冻结，
# 任何 breaking change 必须 bump major 版本并通知调用方。
# 契约约定：
#   1. 入参：--platform <name>（可选，缺省时自动探测）/ --base-only（仅装底座）
#   2. 退出码：0=成功，非 0=失败（调用方依赖 set -e 自动中断）
#   3. 副作用：写入 ~/.sofagent/ + 目标平台配置目录；不修改调用方脚本
#   4. 幂等性：重复执行安全，已存在的 hook/config 不覆盖（除非 --force）
#   5. 输出：使用 [sofagent] 前缀，调用方可据日志判断阶段
# ============================================================

set -euo pipefail
VERSION="1.2.1"

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
# 项目根目录（install.sh 位于仓库根，SCRIPT_DIR 即根）。
# 供 Step 3 本地 dist 优先优化等引用（如 $PROJECT_ROOT/engine/audit/dist/index.js）。
export PROJECT_ROOT="${SCRIPT_DIR}"

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

# ── 帮助 ──
show_help() {
  cat <<EOF
sofagent install.sh v${VERSION} — 主安装器

用法:
  bash install.sh                       默认模式：底座 + FDE Agent Skill
  bash install.sh --base-only           仅装底座（约束层 + 四引擎）
  bash install.sh --platform <name>     指定平台：openclaw / workbuddy / claude / codex / hermes
  bash install.sh --quick               快速模式
  bash install.sh --remote              远程安装模式（git clone）
  bash install.sh --force               升级时强制覆盖 custom/ 用户层（确认+备份）
  bash install.sh --merge               升级时三路合并 custom/ 用户层
  bash install.sh --yes, -y             配合 --force 跳过交互确认（CI 场景）
  bash install.sh --help, -h            显示此帮助

平台: openclaw（完整）/ workbuddy / claude / codex / hermes / 自动探测
EOF
}

# ── --help / -h 前置处理 ──
case "${1:-}" in
  --help|-h) show_help; exit 0 ;;
esac

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

# ════════════════════════════════════════
# Step 1.5: v1.2.1 安装路径分离——SOFAGENT_HOME 创建 + 数据迁移
# ════════════════════════════════════════
# v1.2.1：代码仓库与运行时数据物理分离
#   安装根目录 SOFAGENT_HOME (默认 ~/.sofagent/)
#     ├── data/       用户可见运行数据（审计/知识库/反思/任务日志/编排/IM 队列）
#     ├── internal/   引擎内部状态（checkpoint / .git-shadow / watch.yml）
#     ├── .sofagent/  项目级配置目录（config.yml 在 ${cwd}/.sofagent/config.yml）
#     ├── bin/        CLI 入口脚本（symlink 到 PATH）
#     ├── skill/      Skill 文件（从仓库复制，单一真相源）
#     ├── VERSION     安装版本标记
#     └── REPO_PATH   源码仓库路径标记（供升级时定位）
info "Step 1.5 · 创建安装目录结构（v1.2.1 安装路径分离）..."

# 安装根目录（resolve_data_dir 已解析 SOFAGENT_HOME）
mkdir -p "$SOFAGENT_HOME"

# 数据目录（用户可见数据）
DATA_ROOT="$SOFAGENT_HOME/data"
INTERNAL_ROOT="$SOFAGENT_HOME/internal"
SKILL_DIR="$SOFAGENT_HOME/skill"

mkdir -p "$DATA_ROOT/audit" "$DATA_ROOT/sovereignty" \
         "$DATA_ROOT/task/logs" "$DATA_ROOT/task/plans" \
         "$DATA_ROOT/knowledge" "$DATA_ROOT/orchestrator" \
         "$DATA_ROOT/forge-runs" "$DATA_ROOT/dashboard" "$DATA_ROOT/im-outbox"

# 引擎内部状态（Q4 决策：internal/，非 .sofagent/，避免双层嵌套）
mkdir -p "$INTERNAL_ROOT/checkpoint" "$INTERNAL_ROOT/.git-shadow" "$INTERNAL_ROOT/subagents"

# 写入版本标记
echo "${VERSION}" > "$SOFAGENT_HOME/VERSION"

# 写入源码仓库路径标记（供升级时定位）
echo "$SCRIPT_DIR" > "$SOFAGENT_HOME/REPO_PATH"

# ── 迁移旧数据（Q2 决策：自动迁移）──
# 仓库内 data/ → SOFAGENT_HOME/data/
# 仓库内 .sofagent/ → SOFAGENT_HOME/internal/
migrate_to_install_dir() {
  local old_data="${SCRIPT_DIR}/data"
  local new_data="$SOFAGENT_HOME/data"

  if [ -d "$old_data" ] && [ "$(ls -A "$old_data" 2>/dev/null)" ]; then
    info "检测到旧数据目录 ${old_data}，开始迁移..."
    # 不覆盖已有文件（cp -Rn）
    cp -Rn "$old_data"/. "$new_data"/ 2>/dev/null || true
    # 迁移成功后清理仓库内的 data/
    rm -rf "$old_data"
    # 同步迁移引擎内部状态（.sofagent/ → internal/）
    local old_internal="${SCRIPT_DIR}/.sofagent"
    local new_internal="$SOFAGENT_HOME/internal"
    if [ -d "$old_internal" ]; then
      cp -Rn "$old_internal"/. "$new_internal"/ 2>/dev/null || true
      rm -rf "$old_internal"
    fi
    ok "数据已迁移到 ${SOFAGENT_HOME}"
  fi

  # 迁移旧版安装标记（v1.2.0 的 ~/.openclaw/skills/sofagent/.sofagent-data-path 指向的目录）
  local old_marker="${HOME}/.openclaw/skills/sofagent/.sofagent-data-path"
  if [ -f "$old_marker" ]; then
    local old_path
    old_path=$(tr -d '[:space:]' < "$old_marker" 2>/dev/null)
    if [ -n "$old_path" ] && [ -d "$old_path" ]; then
      cp -Rn "$old_path"/. "$new_data"/ 2>/dev/null || true
      rm -f "$old_marker"
      ok "旧版安装数据已迁移"
    fi
  fi
}
migrate_to_install_dir

ok "  安装目录结构就绪：${SOFAGENT_HOME}/ (data/ + internal/ + bin/ + skill/)"
_log "SOFAGENT_HOME=${SOFAGENT_HOME} structure created"

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
  warn "Node.js 未安装。编排引擎（LangGraph createReactAgent）需要 Node.js >= 18"; warn "请先安装 Node.js: https://nodejs.org/"
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
# Step 3: 编排引擎（v1.2.0：LangGraph createReactAgent，正式依赖）
# ════════════════════════════════════════
info "Step 3/8 · 编排引擎: LangGraph createReactAgent（@sofagent/audit 正式依赖）"
# 优先使用仓库本地的 engine/audit/dist/（避免 npm @latest 版本漂移）
# 仓库本地版本与用户 clone 的版本一致，npm registry 可能滞后
LOCAL_AUDIT_DIST="$PROJECT_ROOT/engine/audit/dist/index.js"
NPM_GLOBAL_BIN=$(npm bin -g 2>/dev/null || echo "/usr/local/bin")

if command -v npm &>/dev/null; then
  if [ -f "$LOCAL_AUDIT_DIST" ]; then
    # 仓库本地构建已就绪，创建 wrapper 到全局路径
    mkdir -p "$NPM_GLOBAL_BIN" 2>/dev/null || true
    cat > "$NPM_GLOBAL_BIN/sofagent-audit" << WRAPPER_EOF
#!/usr/bin/env bash
# sofagent-audit wrapper（从仓库本地 dist 安装）
exec node "$LOCAL_AUDIT_DIST" "\$@"
WRAPPER_EOF
    chmod +x "$NPM_GLOBAL_BIN/sofagent-audit" 2>/dev/null || true
    ok "  @sofagent/audit 已从仓库本地安装（$(node -e "console.log(require('./engine/audit/package.json').version)" 2>/dev/null || echo "v1.2.0")）"
  else
    info "  执行: npm install -g @sofagent/audit@latest"
    if npm install -g "@sofagent/audit@latest" 2>&1 | tail -1; then
      ok "  @sofagent/audit 已全局安装（含 LangGraph 编排引擎）"
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

# LangGraph Sub Agent 引擎（正式依赖——npm install @sofagent/audit 自动安装）
echo "  💡 Sub Agent 引擎: LangGraph createReactAgent（@sofagent/audit 正式依赖，npm install 自动安装）"

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
# Step 8.5: v1.2.1 安装路径分离——CLI 入口 + Skill 统一路径 + symlink
# ════════════════════════════════════════

# ── CLI 命令入口（用户感知层）──
# 数据藏在 ~/.sofagent/（隐藏目录），但注册 sofagent 命令到 PATH，
# 让用户像 brew/git/node 一样，安装后终端输入 sofagent 即可感知。
install_cli() {
  local bin_dir="$SOFAGENT_HOME/bin"
  mkdir -p "$bin_dir"

  # 写入主入口脚本
  cat > "$bin_dir/sofagent" << 'CLIEOF'
#!/bin/bash
# sofagent CLI · v1.2.1 安装路径分离新增
# 用户感知入口——数据藏在 ~/.sofagent/，通过这个命令操作

SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
COMMAND="${1:-help}"
shift 2>/dev/null || true

case "$COMMAND" in
  status)
    # 快速状态：版本 + daemon 运行状态 + 今日审计概览
    echo "sofagent $(cat "$SOFAGENT_HOME/VERSION" 2>/dev/null || echo 'unknown')"
    if [ -f "$SOFAGENT_HOME/data/daemon.json" ]; then
      echo "daemon: $(node -e 'const d=require(process.argv[1]);console.log(d.mode||"stopped")' "$SOFAGENT_HOME/data/daemon.json" 2>/dev/null || echo 'unknown')"
    else
      echo "daemon: not initialized"
    fi
    echo "data: $SOFAGENT_HOME/data/"
    ;;
  where)
    # 安装位置
    echo "Install:  $SOFAGENT_HOME"
    echo "Data:     $SOFAGENT_HOME/data/"
    echo "Skill:    $SOFAGENT_HOME/skill/"
    echo "Internal: $SOFAGENT_HOME/internal/"
    ;;
  version)
    cat "$SOFAGENT_HOME/VERSION" 2>/dev/null || echo "unknown"
    ;;
  dashboard)
    # 启动 Dashboard（v1.2.2 实现，v1.2.1 先占位）
    if [ -x "$SOFAGENT_HOME/bin/sofagent-dashboard" ]; then
      exec "$SOFAGENT_HOME/bin/sofagent-dashboard" "$@"
    else
      echo "Dashboard coming in v1.2.2. Current data:"
      ls -la "$SOFAGENT_HOME/data/" 2>/dev/null
    fi
    ;;
  data)
    # 打开数据目录（macOS 用 Finder，Linux 用 xdg-open）
    if command -v open >/dev/null 2>&1; then
      open "$SOFAGENT_HOME/data/"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$SOFAGENT_HOME/data/"
    else
      echo "$SOFAGENT_HOME/data/"
    fi
    ;;
  help|*)
    echo "sofagent $(cat "$SOFAGENT_HOME/VERSION" 2>/dev/null || echo 'unknown')"
    echo ""
    echo "Commands:"
    echo "  sofagent status     Show version + daemon status + data location"
    echo "  sofagent where      Show all install paths"
    echo "  sofagent version    Show version only"
    echo "  sofagent dashboard  Open dashboard (v1.2.2)"
    echo "  sofagent data       Open data directory in Finder"
    echo "  sofagent help       Show this help"
    ;;
esac
CLIEOF
  chmod +x "$bin_dir/sofagent"

  # symlink 到 PATH（优先 /usr/local/bin，fallback ~/.local/bin）
  local target="/usr/local/bin/sofagent"
  if [ -w "/usr/local/bin" ] || sudo -n true 2>/dev/null; then
    ln -sf "$bin_dir/sofagent" "$target" 2>/dev/null || true
  else
    target="$HOME/.local/bin/sofagent"
    mkdir -p "$HOME/.local/bin"
    ln -sf "$bin_dir/sofagent" "$target"
    # 提示用户 ~/.local/bin 需要在 PATH 里（BSD 兼容：用 case 而非 grep -q）
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) ;;
      *)
        warn "  请将 ~/.local/bin 加入 PATH："
        warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
        ;;
    esac
  fi

  ok "  CLI 命令注册完成：sofagent → $target"
}

# ── Skill 统一路径（Q3 决策：单一真相源 + symlink）──
# 把 Skill 文件复制到 ~/.sofagent/skill/（单一真相源），
# 然后向各平台目录建 symlink，保留平台发现机制。
install_skill_unified() {
  local skill_src="${SCRIPT_DIR}/SKILL"
  if [ -d "$skill_src" ]; then
    # 复制 Skill 到统一路径
    mkdir -p "$SOFAGENT_HOME/skill"
    cp -R "$skill_src"/. "$SOFAGENT_HOME/skill/" 2>/dev/null || true

    # 向平台目录 symlink（保留平台发现机制）
    local platform_skill_dirs=(
      "${HOME}/.openclaw/skills/sofagent"
      "${HOME}/.workbuddy/skills/sofagent"
    )
    for psd in "${platform_skill_dirs[@]}"; do
      mkdir -p "$(dirname "$psd")" 2>/dev/null || true
      ln -sfn "$SOFAGENT_HOME/skill" "$psd" 2>/dev/null || true
    done
    ok "  Skill 统一路径已建立：$SOFAGENT_HOME/skill/ → 平台 symlink"
  fi
}

install_cli
install_skill_unified

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
