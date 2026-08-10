#!/bin/bash
# ============================================================
# sofagent install.sh · 主安装器 / FDE 入口 · v1.3.1
# ============================================================
# 将 sofagent 约束层部署到目标平台，让 Agent 获得治理能力。
#
# 🧭 路径声明（v1.2.0）：本脚本在仓库根目录，是主安装器。
#    默认模式 = FDE 模式（底座 + FDE Agent Skill）。
#    --base-only 模式 = 仅装约束层（注入·审计·回溯·进化四种能力）。
#
# 📦 安装包边界（v1.2.0）：
#    ┌─────────────────────────┬──────────┬──────────────────────┐
#    │ 脚本                    │ 给谁     │ 装什么               │
#    ├─────────────────────────┼──────────┼──────────────────────┤
#    │ install.sh              │ 所有用户 │ 底座+FDE Agent Skill │
#    │ install.sh --base-only  │ 所有用户 │ 约束层              │
#    └─────────────────────────┴──────────┴──────────────────────┘
#    原则：FORGE 由 `FORGE/SKILL/<loop>/` 定义驱动，无需单独安装脚本——
#    FORGE 是 sofagent 项目的自迭代开发工具包（管理代码变更，给开发者用），
#    不属于企业交付物。
#
# 🔗 编排契约：FDE 调用本脚本（--base-only 模式）作为底座安装入口。
#    改动此文件前确认调用方不受影响：
#    - FDE 通过 `bash install.sh --base-only --platform "$PLATFORM"` 安装底座
#    - 删被依赖文件（如 SKILL/harness/fde-template.md）前确认无调用方引用
# v0.98: 从 941 行拆分为 4 个 lib 模块 + 纯组装入口
# v1.0.7: ao 退役，移除 agency-orchestrator 安装逻辑
# v1.2.0: install.sh 吸收 FDE/fde-install.sh，成为主安装器+FDE 入口
#
# 平台无关重构：默认安装不探测/不枚举任何平台，只写 sofagent 自己的目录 ~/.sofagent/；
# 平台集成改为显式 opt-in：--platform openclaw（完整）/ workbuddy / claude / codex / hermes
# 约束层四种能力：注入 / 审计 / 回溯 / 进化（FORGE 是内部开发工具，非交付引擎）。
# 编排引擎为独立可选包 @sofagent/orchestrator，需单独安装（npm install -g @sofagent/orchestrator）。
#
# ── 调用契约（v1.2.0）──
# FDE 通过以下方式调用本脚本安装底座：
#   bash "$PROJECT_ROOT/install.sh" --base-only --platform "$PLATFORM"
# 版本锁定：本脚本的接口（入参/退出码/副作用）从 v1.1.5 起冻结，
# 任何 breaking change 必须 bump major 版本并通知调用方。
# 契约约定：
#   1. 入参：--platform <name>（可选；缺省时平台无关安装，不再自动探测）/ --base-only（仅装底座）
#   2. 退出码：0=成功，非 0=失败（调用方依赖 set -e 自动中断）
#   3. 副作用：默认只写 ~/.sofagent/；显式 --platform 时额外写该平台目录；不修改调用方脚本
#   4. 幂等性：重复执行安全，已存在的 hook/config 不覆盖（除非 --force）
#   5. 输出：使用 [sofagent] 前缀，调用方可据日志判断阶段
# ============================================================

set -euo pipefail
VERSION="1.3.1"

# ── 颜色输出（合并两套）──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${BLUE}[sofagent]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# ── 确定脚本所在目录（支持符号链接）──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# v1.2.0: install.sh 提升到根目录，lib/ 仍在 engine/scripts/lib/
LIB_DIR="${SCRIPT_DIR}/engine/scripts/lib"
# 项目根目录（install.sh 位于仓库根，SCRIPT_DIR 即根）。
# 供 Step 3 本地 dist 优先优化等引用（如 $PROJECT_ROOT/engine/audit/dist/index.js）。
export PROJECT_ROOT="${SCRIPT_DIR}"

# ── 安装日志 ──
# v1.3.0-fix: INSTALL_LOG 原为空字符串导致日志写入 /dev/null，排查时无任何记录
INSTALL_LOG="${HOME}/.sofagent/install.log"
mkdir -p "${HOME}/.sofagent"
_log() { echo "[$(date '+%H:%M:%S')] $1" >> "${INSTALL_LOG}"; }

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
sofagent install.sh v${VERSION} — 主安装器（平台无关）

用法:
  bash install.sh                       默认模式：平台无关安装（只写 ~/.sofagent/）+ FDE Agent Skill
  bash install.sh --base-only           仅装约束层（审计/回溯/进化）
  bash install.sh --platform <name>     显式平台集成（opt-in）：openclaw / workbuddy / claude / codex / hermes
  bash install.sh --quick               完整安装（静默模式，跳过交互确认）⚠️ 非预览，会写入文件
  bash install.sh --remote              远程安装模式（git clone）
  bash install.sh --force               升级时强制覆盖 custom/ 用户层（确认+备份）
  bash install.sh --merge               升级时三路合并 custom/ 用户层
  bash install.sh --yes, -y             配合 --force 跳过交互确认（CI 场景）
  bash install.sh --help, -h            显示此帮助

平台: 默认平台无关安装（不探测、不修改任何第三方平台配置，只写 ~/.sofagent/）；
     显式 --platform 时才做平台集成：openclaw（完整）/ workbuddy / claude / codex / hermes
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
    warn "  建议使用 PowerShell 脚本: engine\\scripts\\windows\\install.ps1 -Platform workbuddy"
    warn "  bash 脚本在 Windows 上可能遇到 CRLF 换行符问题"
    warn "  如坚持使用 bash，请确保脚本已转换为 LF 换行符"; echo ""
  fi
fi

# ── 远程安装模式（curl pipe bash 场景）──
# 安全说明：remote 模式仅从 GitHub 官方域名（github.com/KongFangXun/sofagent）git clone，URL 硬编码，不接受外部输入
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

# ── 历史注入残留检测（平台无关重构加分项）──
# 仅检测 + 提示，不自动清理（避免误删用户自己的配置）
detect_legacy_injections() {
  local legacy_found=0
  local oc_cfg="${HOME}/.openclaw/config.json"
  if [ -f "$oc_cfg" ]; then
    if grep -q 'loopDetection' "$oc_cfg" 2>/dev/null; then legacy_found=1; fi
    if grep -q 'before_prompt_build' "$oc_cfg" 2>/dev/null; then legacy_found=1; fi
  fi
  if [ -d "${HOME}/.openclaw/hooks/sofagent-load-chain" ] || [ -d "${HOME}/.openclaw/skills/sofagent" ]; then
    legacy_found=1
  fi
  if [ "$legacy_found" = "1" ]; then
    warn "检测到历史版本注入的 OpenClaw 配置残留（如 config.json 的 loopDetection/before_prompt_build）"
    warn "  sofagent 现在是平台无关安装——不会再静默修改第三方平台配置"
    warn "  运行 engine/scripts/uninstall.sh 可清理历史注入残留（会先备份，只删 sofagent 产物）"
  fi
}
detect_legacy_injections

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
chmod 700 "$SOFAGENT_HOME"  # 安全铁律：安装目录仅属主可读写执行

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

# 写入源码仓库路径标记（供升级时定位 sofagent 引擎源码位置，
# sofagent-update 等升级脚本读取此文件找到仓库根以执行 git pull + rebuild）
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

RULES_SRC="${SCRIPT_DIR}/SKILL/harness/fde-template.md"
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
  # v1.2.6: Node 版本下限检查——Node < 18 时 err 并退出（不是 warn）
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    err "Node.js 版本过低（$NODE_VER），sofagent 需要 Node.js >= 18"
    err "请升级 Node.js: https://nodejs.org/"
    exit 1
  fi
else
  err "Node.js 未安装。审计引擎（@sofagent/audit）需要 Node.js >= 18"
  err "请先安装 Node.js: https://nodejs.org/"
  exit 1
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
# Step 3: 审计引擎（@sofagent/audit）
# ════════════════════════════════════════
info "Step 3/8 · 审计引擎: @sofagent/audit（约束层审计能力）"
# 优先使用仓库本地的 engine/audit/dist/（避免 npm @latest 版本漂移）
# 仓库本地版本与用户 clone 的版本一致，npm registry 可能滞后
LOCAL_AUDIT_DIST="$PROJECT_ROOT/engine/audit/dist/index.js"
# v1.2.6: npm 10+ 废弃了 `npm bin -g`，改用 `npm prefix -g`。
# 兼容策略：优先 npm prefix -g，失败时 fallback 到 ~/.local/bin，最后 /usr/local/bin。
NPM_GLOBAL_PREFIX=$(npm prefix -g 2>/dev/null || true)
if [ -n "$NPM_GLOBAL_PREFIX" ] && [ -d "$NPM_GLOBAL_PREFIX/bin" ]; then
  NPM_GLOBAL_BIN="$NPM_GLOBAL_PREFIX/bin"
elif [ -d "$HOME/.local/bin" ]; then
  NPM_GLOBAL_BIN="$HOME/.local/bin"
else
  NPM_GLOBAL_BIN="/usr/local/bin"
fi

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
    ok "  @sofagent/audit 已从仓库本地安装（$(node -e "console.log(require('./engine/audit/package.json').version)" 2>/dev/null || echo "v${VERSION}")）"
  else
    info "  执行: npm install -g @sofagent/audit@latest"
    if npm install -g "@sofagent/audit@latest" 2>&1 | tail -1; then
      ok "  @sofagent/audit 已全局安装"
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
# Step 5c: HMAC 密钥自动生成（v1.2.6 新增）
# ════════════════════════════════════════
# 审计历史的 HMAC 防篡改链需要 ~/.sofagent-key。
# 此前密钥不存在时降级为 SHA-256（无密钥校验），现在 config 签名改为 fail-closed 后
# 必须有密钥才能启动。install.sh 自动生成密钥（权限 600），避免用户遗忘。
SOFAGENT_KEY_PATH="${HOME}/.sofagent-key"
if [ ! -f "$SOFAGENT_KEY_PATH" ]; then
  info "Step 5c · 生成 HMAC 密钥（~/.sofagent-key）..."
  # 用 openssl 生成 32 字节随机密钥（hex 编码 = 64 字符），权限 600
  if command -v openssl &>/dev/null; then
    (umask 077 && openssl rand -hex 32 > "$SOFAGENT_KEY_PATH")
  else
    # fallback：用 /dev/urandom + xxd 或 hexdump
    (umask 077 && head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n' > "$SOFAGENT_KEY_PATH")
  fi
  if [ -f "$SOFAGENT_KEY_PATH" ]; then
    chmod 600 "$SOFAGENT_KEY_PATH"
    ok "  HMAC 密钥已生成（权限 600）——用于审计历史防篡改链 + 配置签名"
  else
    warn "  HMAC 密钥生成失败（后续可用 openssl rand -hex 32 > ~/.sofagent-key 手动创建）"
  fi
else
  ok "  HMAC 密钥已存在（~/.sofagent-key），跳过生成"
fi

# ════════════════════════════════════════
# Step 6-7: Hook + 断路器
# ════════════════════════════════════════
deploy_hook            # Step 6: 部署加载链 Hook（仅 OpenClaw）

# Step 6.5: 安装 git commit-msg + post-commit hook（让 git commit 触发审计）
# v1.2.2 F-28 修复：install.sh 只装 OpenClaw 平台 hook，不装 git commit-msg + post-commit hook，
# 导致 README 演示中的 commit 拦截跑不通。此处补装 git hook。
if command -v sofagent-audit >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  info "Step 6.5 · 安装 git commit-msg + post-commit hook..."
  if sofagent-audit --install-hook 2>/dev/null; then
    ok "  git commit-msg + post-commit hook 已安装"
  else
    warn "  git hook 安装失败，请手动运行 sofagent-audit --init"
  fi
fi

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

# 编排引擎为独立可选包（不随 @sofagent/audit 自动安装，需按需单独安装）
echo "  💡 编排引擎为独立可选包 @sofagent/orchestrator，需单独安装（npm install -g @sofagent/orchestrator）"

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
# sofagent CLI · v1.2.3 安装路径分离新增
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
    # 启动 Dashboard（v1.2.2 已实现，install 时自动软链到 $SOFAGENT_HOME/bin/sofagent-dashboard）
    if [ -x "$SOFAGENT_HOME/bin/sofagent-dashboard" ]; then
      exec "$SOFAGENT_HOME/bin/sofagent-dashboard" "$@"
    else
      echo "Dashboard v1.2.4 · 数据面板:"
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
    echo "  sofagent dashboard  Open dashboard (v1.2.4)"
    echo "  sofagent data       Open data directory in Finder"
    echo "  sofagent help       Show this help"
    ;;
esac
CLIEOF
  chmod +x "$bin_dir/sofagent"

  # Dashboard 入口软链（v1.2.2 真实实现 tools/sofagent-dashboard.sh，零前端依赖 bash+jq）
  # wrapper dashboard 分支检查 -x "$SOFAGENT_HOME/bin/sofagent-dashboard"，故软链目标不带 .sh 后缀
  local dashboard_src="${SCRIPT_DIR}/tools/sofagent-dashboard.sh"
  local dashboard_link="$bin_dir/sofagent-dashboard"
  if [ -f "$dashboard_src" ]; then
    ln -sf "$dashboard_src" "$dashboard_link" 2>/dev/null || true
    chmod +x "$dashboard_link" 2>/dev/null || true
    ok "  Dashboard 入口已注册：sofagent-dashboard → $bin_dir/sofagent-dashboard"
  else
    warn "  Dashboard 实现脚本缺失（$dashboard_src），跳过软链；wrapper 占位分支兜底"
  fi

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

    # 平台无关重构：仅当用户显式指定平台时才向该平台目录建 symlink——
    # 默认安装不再创建/修改任何第三方平台目录（如 ~/.openclaw/skills、~/.workbuddy/skills）
    case "$PLATFORM" in
      openclaw|workbuddy)
        local psd="${HOME}/.${PLATFORM}/skills/sofagent"
        mkdir -p "$(dirname "$psd")" 2>/dev/null || true
        ln -sfn "$SOFAGENT_HOME/skill" "$psd" 2>/dev/null || true
        if [ ! -L "$psd" ]; then
          warn "  Symlink 创建失败：${psd}（可能已被普通目录占用）"
        fi
        ok "  Skill 统一路径已建立：${SOFAGENT_HOME}/skill/ → ${psd}（显式平台集成）"
        ;;
      *)
        ok "  Skill 已安装到统一路径：$SOFAGENT_HOME/skill/（平台无关安装，未修改任何平台目录）"
        ;;
    esac
  fi
}

install_cli
install_skill_unified

# 安装完整性自检——必须在 install_cli 之后（bin/sofagent 由 install_cli 创建）
verify_component_integrity

# ════════════════════════════════════════
# Step 8.6: v1.2.2 P3 Skill 分层升级三策略
# ════════════════════════════════════════
# 引擎层 vs 用户层分离：
#   引擎层（官方维护，升级可覆盖） = SKILL.md + sofagent/ + agents/
#   用户层（用户私有，默认不动）  = custom/
# 三策略：
#   默认      → 只同步引擎层；custom/ 不动；引擎层备份到 .backup/{ts}/
#   --force   → 警告确认后覆盖所有层（含 custom/）；备份所有层
#   --merge   → 三路合并 custom/（git merge-file）；备份所有层
# 幂等：重复执行安全；custom/ 不存在时三策略行为一致（直接安装）
# 调用时机：install_skill_unified 已把 SKILL 复制到 ~/.sofagent/skill/ 并 symlink 到
#   ~/.workbuddy/skills/sofagent/，因此本函数作用在用户层 symlink 指向的实体上。
# ────────────────────────────────────────────────────────────────

# 备份保留份数
SOFAGENT_BACKUP_KEEP=5

# 目标用户层根目录（~/.workbuddy/skills/sofagent，可能是 symlink 到 ~/.sofagent/skill/）
# 注意：UPGRADE_ROOT 解析 symlink 拿到实体路径，避免在 symlink 上建 .backup 失败
_resolve_upgrade_root() {
  local root="${HOME}/.workbuddy/skills/sofagent"
  if [ -L "$root" ]; then
    # macOS readlink 无 -f；用 cd+pwd 解析
    ( cd "$root" 2>/dev/null && pwd -P ) || echo "$root"
  elif [ -d "$root" ]; then
    echo "$root"
  else
    echo ""  # 用户层不存在
  fi
}

# 备份指定路径列表到 .backup/{ts}/ 下（保留目录结构）
# 用法：_backup_layers <backup_root> <path1> [path2 ...]
_backup_layers() {
  local backup_root="$1"; shift
  local ts; ts="$(date +%Y-%m-%d-%H%M%S)"
  local backup_dir="${backup_root}/${ts}"
  local p rel
  mkdir -p "$backup_dir"
  for p in "$@"; do
    [ -e "$p" ] || continue
    rel="${p#"${UPGRADE_ROOT}/"}"
    mkdir -p "$(dirname "${backup_dir}/${rel}")"
    cp -R "$p" "${backup_dir}/${rel}" 2>/dev/null || true
  done
  echo "$backup_dir"
}

# 备份轮转：保留最近 SOFAGENT_BACKUP_KEEP 份，删最旧
_rotate_backups() {
  local backup_root="$1"
  [ -d "$backup_root" ] || return 0
  # 按名称排序（YYYY-MM-DD-HHMMSS 格式时间戳 → 字典序=时间序）
  local count; count=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  if [ "$count" -gt "$SOFAGENT_BACKUP_KEEP" ]; then
    local to_delete=$((count - SOFAGENT_BACKUP_KEEP))
    find "$backup_root" -mindepth 1 -maxdepth 1 -type d | sort | head -n "$to_delete" | while read -r old; do
      rm -rf "$old"
    done
    _log "backup rotated: removed ${to_delete} oldest"
  fi
}

# 三路合并单个文件：base（上次备份）/ ours（用户当前）/ theirs（新官方）
# 返回 0=合并成功写入，1=冲突（已生成 .merge-conflict 副本），2=无需合并
_merge_one_file() {
  local base="$1" ours="$2" theirs="$3"
  # 内容一致 → 无需合并
  if cmp -s "$ours" "$theirs" 2>/dev/null; then
    return 2
  fi
  # base 缺失或等于 ours → 直接用官方版覆盖（用户没改过）
  if [ ! -f "$base" ] || cmp -s "$base" "$ours" 2>/dev/null; then
    cp "$theirs" "$ours"
    return 0
  fi
  # 三方都有改动 → git merge-file
  if command -v git >/dev/null 2>&1; then
    local tmp_out; tmp_out="$(mktemp -t sofagent-merge.XXXXXX)"
    cp "$ours" "$tmp_out"
    if git merge-file -L "用户版本" -L "上次安装" -L "官方版本" "$tmp_out" "$base" "$theirs" >/dev/null 2>&1; then
      cp "$tmp_out" "$ours"
      rm -f "$tmp_out"
      return 0
    else
      # 冲突：保留用户版，生成 .merge-conflict 副本（git merge-file 已把冲突标记写进 tmp_out）
      cp "$tmp_out" "${ours}.merge-conflict"
      rm -f "$tmp_out"
      return 1
    fi
  else
    # 无 git → 保守策略：保留用户版，复制官方版到 .merge-conflict 供手工比对
    cp "$theirs" "${ours}.merge-conflict"
    return 1
  fi
}

# 递归合并目录：对 theirs（新官方）下所有文件，与 ours 做三路合并
_merge_tree() {
  local base_root="$1" ours_root="$2" theirs_root="$3"
  local f rel base ours merged_count=0 conflict_count=0
  # find 所有官方文件（排除 .backup / .DS_Store / .merge-conflict 自身）
  while IFS= read -r -d '' f; do
    rel="${f#"${theirs_root}/"}"
    base="${base_root}/${rel}"
    ours="${ours_root}/${rel}"
    if [ ! -f "$ours" ]; then
      # 用户本地没有 → 直接拷入
      mkdir -p "$(dirname "$ours")"
      cp "$f" "$ours"
      merged_count=$((merged_count+1))
      continue
    fi
    if _merge_one_file "$base" "$ours" "$f"; then
      merged_count=$((merged_count+1))
    else
      local rc=$?
      if [ "$rc" = "1" ]; then
        conflict_count=$((conflict_count+1))
        warn "  合并冲突：${rel} → 已生成 ${rel}.merge-conflict（用户版未动）"
      fi
    fi
  done < <(find "$theirs_root" -type f \
      ! -path '*/.backup/*' ! -name '.DS_Store' ! -name '*.merge-conflict' -print0)
  echo "${merged_count}|${conflict_count}"
}

# 主入口：Skill 分层升级
upgrade_skill() {
  local SKILL_SRC="${SCRIPT_DIR}/SKILL"
  UPGRADE_ROOT="$(_resolve_upgrade_root)"
  if [ -z "$UPGRADE_ROOT" ] || [ ! -d "$UPGRADE_ROOT" ]; then
    _log "upgrade_skill: 用户层不存在，三策略等同直接安装（install_skill_unified 已完成）"
    return 0
  fi
  if [ ! -d "$SKILL_SRC" ]; then
    warn "upgrade_skill: SKILL 源目录不存在: $SKILL_SRC，跳过"
    return 0
  fi

  # 引擎层 / 用户层路径
  local engine_paths=(
    "${UPGRADE_ROOT}/SKILL.md"
    "${UPGRADE_ROOT}/AGENTS.md"
    "${UPGRADE_ROOT}/sofagent"
    "${UPGRADE_ROOT}/skills"
    "${UPGRADE_ROOT}/agents"
    "${UPGRADE_ROOT}/harness"
  )
  local user_layer="${UPGRADE_ROOT}/custom"
  local backup_root="${UPGRADE_ROOT}/.backup"

  # 计算策略名（避免在 $() 内嵌套引号——bash 解析器有 bug）
  local strategy="safe"
  if [ "${FORCE_MODE:-0}" = "1" ]; then
    strategy="force"
  elif [ "${MERGE_MODE:-0}" = "1" ]; then
    strategy="merge"
  fi
  info "Step 8.6 · Skill 分层升级（策略: ${strategy}）"

  # ── 策略 A：--force 强制覆盖（含 custom/）──
  if [ "${FORCE_MODE:-0}" = "1" ]; then
    # 高危警告：必须确认（除非 SOFAGENT_FORCE_YES=1 或 --yes/--quick）
    if [ "${SOFAGENT_FORCE_YES:-0}" != "1" ] && [ "${YES_MODE:-0}" != "1" ] && [ "${QUICK_MODE:-0}" != "1" ]; then
      warn "⚠️  --force 将覆盖你的 custom/ 目录（用户自定义），此操作不可恢复。"
      if [ -t 0 ]; then
        printf "继续？(y/N) "
        local answer; read -r answer
        case "$answer" in
          y|Y|yes|YES) : ;;
          *) warn "已取消——custom/ 保持原样"; return 0 ;;
        esac
      else
        err "非交互环境检测到 --force——请设置 SOFAGENT_FORCE_YES=1 或加 --yes 跳过确认"
        return 1
      fi
    fi
    # 备份所有层
    local bk; bk="$(_backup_layers "$backup_root" "${engine_paths[@]}" "$user_layer")"
    ok "  已备份所有层到 ${bk}"
    # 覆盖引擎层 + custom/
    for src_item in "${SKILL_SRC}"/*; do
      local base; base="$(basename "$src_item")"
      [ "$base" = ".backup" ] && continue
      [ "$base" = ".DS_Store" ] && continue
      # shellcheck disable=SC2115 # UPGRADE_ROOT 已在第 654 行做空值守卫
      rm -rf "${UPGRADE_ROOT:?}/${base}"
      cp -R "$src_item" "${UPGRADE_ROOT}/${base}"
    done
    _rotate_backups "$backup_root"
    ok "  --force 完成：所有层已覆盖为官方版本（含 custom/）"
    return 0
  fi

  # ── 策略 B：--merge 三路合并 ──
  if [ "${MERGE_MODE:-0}" = "1" ]; then
    # base = 最近一次备份的 custom/（若存在）；theirs = 新官方 custom/
    local last_backup=""
    if [ -d "$backup_root" ]; then
      last_backup=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)
    fi
    # 备份所有层（含 custom/）
    local bk; bk="$(_backup_layers "$backup_root" "${engine_paths[@]}" "$user_layer")"
    ok "  已备份所有层到 ${bk}"
    # 引擎层：直接覆盖（引擎层官方维护，不做 merge）
    for src_item in "${SKILL_SRC}"/*; do
      local base; base="$(basename "$src_item")"
      case "$base" in
        custom|.backup|.DS_Store) continue ;;
      esac
      # shellcheck disable=SC2115 # UPGRADE_ROOT 已在第 654 行做空值守卫
      rm -rf "${UPGRADE_ROOT:?}/${base}"
      cp -R "$src_item" "${UPGRADE_ROOT}/${base}"
    done
    # custom/：三路合并
    if [ -d "${SKILL_SRC}/custom" ] && [ -d "$user_layer" ]; then
      local base_dir="${last_backup:+${last_backup}/custom}"
      [ -d "$base_dir" ] || base_dir="/dev/null"
      # base 缺失场景：对 _merge_tree 传入空目录以触发"直接用官方版"路径
      local empty_base=""
      if [ "$base_dir" = "/dev/null" ]; then
        empty_base="$(mktemp -d -t sofagent-merge-base.XXXXXX)"
        base_dir="$empty_base"
      fi
      local result; result="$(_merge_tree "$base_dir" "$user_layer" "${SKILL_SRC}/custom")"
      local merged_count="${result%%|*}"
      local conflict_count="${result##*|}"
      [ -n "$empty_base" ] && rm -rf "$empty_base"
      ok "  --merge 完成：${merged_count} 个文件已合并/新增，${conflict_count} 个冲突（见 .merge-conflict）"
    else
      ok "  --merge：custom/ 源或目标不存在，跳过合并"
    fi
    _rotate_backups "$backup_root"
    return 0
  fi

  # ── 策略 C：默认安全升级（只覆盖引擎层，custom/ 不动）──
  local bk; bk="$(_backup_layers "$backup_root" "${engine_paths[@]}")"
  ok "  引擎层已备份到 ${bk}"
  for src_item in "${SKILL_SRC}"/*; do
    local base; base="$(basename "$src_item")"
    case "$base" in
      custom|.backup|.DS_Store) continue ;;
    esac
    # shellcheck disable=SC2115 # UPGRADE_ROOT 已在第 654 行做空值守卫
    rm -rf "${UPGRADE_ROOT:?}/${base}"
    cp -R "$src_item" "${UPGRADE_ROOT}/${base}"
  done
  _rotate_backups "$backup_root"
  ok "  安全升级完成：引擎层已同步到官方版本，custom/ 保持原样"
  return 0
}

# 调用升级策略（仅在用户层已存在时执行；首次安装由 install_skill_unified 完成）
upgrade_skill

# ════════════════════════════════════════
# FDE 专属步骤（仅默认模式，--base-only 时跳过）
# ════════════════════════════════════════
if [ "${BASE_ONLY:-0}" = "0" ]; then

  echo ""
  echo -e "${BOLD}[FDE] 写入 FDE 运行规范 + 安装 Agent Skill...${NC}"

  # ── 写入 fde.md（默认写 sofagent 自己的目录；显式平台时写平台目录）──
  # ⚠️ 路径必须与 handler.ts / checks.ts 的读取路径对齐：skills/sofagent/
  # （v1.2.0 仓库改名 /sofagent/→/engine/ 不影响部署目标路径——消费方仍读 skills/sofagent/）
  # 平台无关重构：未显式指定平台时写入 ${SOFAGENT_HOME}（~/.sofagent/），不碰任何第三方平台目录
  case "$PLATFORM" in
    openclaw) FDE_MD_TARGET="$HOME/.openclaw/skills/sofagent/fde.md" ;;
    workbuddy) FDE_MD_TARGET="$HOME/.workbuddy/skills/sofagent/fde.md" ;;
    claude) FDE_MD_TARGET="$HOME/.claude/fde.md" ;;
    codex) FDE_MD_TARGET="$HOME/.codex/fde.md" ;;
    hermes) FDE_MD_TARGET="$HOME/.hermes/fde.md" ;;
    *) FDE_MD_TARGET="$SOFAGENT_HOME/skills/sofagent/fde.md" ;;  # 平台无关：默认写入自己的目录
  esac

  if [ -n "$FDE_MD_TARGET" ] && [ -f "$RULES_SRC" ]; then
    mkdir -p "$(dirname "$FDE_MD_TARGET")" 2>/dev/null || true
    cp "$RULES_SRC" "$FDE_MD_TARGET"
    echo -e "${GREEN}✅ fde.md 已写入 ${FDE_MD_TARGET}${NC}"
    echo -e "  ${CYAN}请编辑此文件，填写你的工作规则${NC}"

    # v1.0.7: 同时安装 FDE + Audit 两个内置 Agent 的 Skill
    # v1.2.0: Skill 收敛到 /SKILL/（agents/SKILL/ → SKILL/agents/）
    # v1.2.2: 四 Agent 全装（fde / audit / engineer / reviewer）
    # v1.2.7: 渐进式加载分层文件同步（core-rules.md + role-*.md）
    SKILL_SRC="${SCRIPT_DIR}/SKILL"
    SKILL_DIR="$(dirname "$FDE_MD_TARGET")"
    if [ -f "$SKILL_SRC/SKILL.md" ]; then
      cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/sofagent-fde/SKILL.md" 2>/dev/null || cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/SKILL.md"
      echo -e "${GREEN}✅ FDE Agent Skill 已安装（@sofagent-fde 可用）${NC}"
      # v1.2.7: 补充分层文件到 sofagent-fde 目录（handler.ts L1 渐进式加载依赖）
      for layer_file in core-rules.md role-audit.md role-fde.md role-orchestrate.md; do
        if [ -f "$SKILL_SRC/$layer_file" ]; then
          cp "$SKILL_SRC/$layer_file" "$SKILL_DIR/sofagent-fde/$layer_file" 2>/dev/null || cp "$SKILL_SRC/$layer_file" "$SKILL_DIR/$layer_file"
        fi
      done
      echo -e "  ${CYAN}分层文件已同步（core-rules.md + role-*.md）${NC}"
    fi
    # 安装 agents/ 下所有 Sub Agent（audit / engineer / reviewer / fde）
    if [ -d "$SKILL_SRC/agents" ]; then
      for agent_dir in "$SKILL_SRC/agents"/*/; do
        [ -d "$agent_dir" ] || continue
        agent_name=$(basename "$agent_dir")
        [ -f "${agent_dir}SKILL.md" ] || continue
        mkdir -p "$SKILL_DIR/sofagent-${agent_name}"
        cp "${agent_dir}SKILL.md" "$SKILL_DIR/sofagent-${agent_name}/SKILL.md"
        echo -e "${GREEN}✅ ${agent_name} Agent Skill 已安装（@sofagent-${agent_name} 可用）${NC}"
      done
    fi
  else
    echo -e "${CYAN}⚠️ 跳过 fde.md（模板或目标路径不存在）${NC}"
  fi

  # ── 验证安装 ──
  echo ""
  echo -e "${BOLD}[FDE] 验证安装...${NC}"
  # 平台无关重构：未显式指定平台时不传 --platform（避免触发 verify.sh 自身的平台探测日志）；
  # || true 防止 verify 失败项在 set -e + pipefail 下中断安装
  if [ -n "$PLATFORM" ]; then
    bash "${SCRIPT_DIR}/engine/scripts/verify.sh" --quick --platform "$PLATFORM" 2>&1 | tail -3 || true
  else
    bash "${SCRIPT_DIR}/engine/scripts/verify.sh" --quick --quiet 2>&1 | tail -3 || true
  fi
  echo ""

  # ── 设置 data 目录权限 ──
  if [ -d "$HOME/.sofagent/data" ]; then
    chmod 700 "$HOME/.sofagent/data" 2>/dev/null || true
  fi

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
  echo -e "  ${CYAN}内置 Agent：${NC}@sofagent-fde（部署）+ @sofagent-audit（合规）+ @sofagent-engineer（编码）+ @sofagent-reviewer（审查）"
  echo -e "  ${CYAN}详细指南见 FDE/README.md${NC}"
  echo ""
  echo -e "  ${YELLOW}提示：${NC}如果 sofagent 命令找不到，请重载 shell 配置："
  echo -e "    bash:  source ~/.bashrc"
  echo -e "    zsh:   source ~/.zshrc"
  echo -e "    fish:  source ~/.config/fish/config.fish"
  echo -e "    或直接重启终端。"
  echo ""

else
  # ── 设置 data 目录权限 ──
  if [ -d "$HOME/.sofagent/data" ]; then
    chmod 700 "$HOME/.sofagent/data" 2>/dev/null || true
  fi

  # ── 底座-only 完成输出 ──
  echo ""
  echo -e "${GREEN}✅ sofagent 底座安装完成（--base-only 模式）${NC}"
  echo ""
  echo -e "  ${YELLOW}提示：${NC}如果 sofagent 命令找不到，请重载 shell 配置："
  echo -e "    bash:  source ~/.bashrc"
  echo -e "    zsh:   source ~/.zshrc"
  echo -e "    fish:  source ~/.config/fish/config.fish"
  echo -e "    或直接重启终端。"
  echo ""
fi
