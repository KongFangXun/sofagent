#!/usr/bin/env bash
# ============================================================
# sofagent install.sh · 企业设备安装器 · v1.4.5
# ============================================================
# 将 sofagent 约束层部署到企业跑 AI 节点的设备上，让 Agent 获得监控约束。
#
# 🧭 路径声明（v1.3.2 定位校准）：本脚本装在**企业设备**上（不是 FDE 的电脑）。
#    默认模式 = 全套（底座 + Agent Skill）——事前约束 + 事后拦截完整闭环。
#    --base-only 模式 = 仅装约束层（审计·回溯·daemon），不装 Agent Skill。
#
# 📦 安装包边界（v1.4.5）：
#    ┌─────────────────────────┬──────────────┬──────────────────────┐
#    │ 脚本                    │ 装在哪       │ 装什么               │
#    ├─────────────────────────┼──────────────┼──────────────────────┤
#    │ install.sh              │ 企业设备     │ 底座 + Agent Skill   │
#    │ install.sh --base-only  │ 企业设备     │ 约束层（无 Skill）   │
#    │ npx @sofagent/audit     │ 任意（临时） │ 零安装审计           │
#    └─────────────────────────┴──────────────┴──────────────────────┘
#    ⚠️ FDE 不该在自己电脑跑 install.sh——FDE 的工具是 Skill + 未来商业模型。
#    FORGE 是 sofagent 项目的自迭代开发工具包（管理代码变更，给开发者用），
#    不属于企业交付物。
#    MCP 自动配置：--platform workbuddy/claude/cursor 时写 mcp.json（JSON merge 不覆盖），
#    --platform codex 时写 config.toml（[mcp_servers.sofagent] 段追加幂等）——装完即连。
#
# 🔗 编排契约：FDE 部署时调用本脚本安装到底座到企业设备。
#    改动此文件前确认调用方不受影响：
#    - FDE 通过 `bash install.sh --base-only --platform "$PLATFORM"` 安装底座
#    - 删被依赖文件（如 SKILL/harness/fde-template.md）前确认无调用方引用
# v0.98: 从 941 行拆分为 4 个 lib 模块 + 纯组装入口（历史锚——此后行数随功能演进增长，勿以此行为当前行数口径）
# v1.0.7: ao 退役，移除 agency-orchestrator 安装逻辑
# v1.2.0: install.sh 吸收 FDE/fde-install.sh，成为企业设备安装器
#
# 平台无关重构：默认安装不探测/不枚举任何平台，只写 sofagent 自己的目录 ~/.sofagent/；
# 平台集成改为显式 opt-in：--platform openclaw（完整）/ workbuddy / claude / codex / hermes / cursor / gemini（v1.4.4）
# 约束层五种能力：注入 / 审计 / 回溯 / 沉淀 / 进化（FORGE 是内部开发工具，非交付引擎）。
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
VERSION="1.4.5"

# ERR trap 品牌兜底（v1.3.8 P0-1）：对齐 bootstrap.sh——此前 install.sh 全文无 trap，
# 任何未处理失败都是裸 bash 报错 exit 1；现在统一输出产品化指路信息。
trap 'echo "❌ sofagent install 失败（exit $?，行 ${LINENO:-?}）——请截图此信息到 GitHub Issues（github.com/KongFangXun/sofagent/issues）"' ERR

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

# ── 帮助（v1.3.8 P0-1 前移：--help 不依赖 lib/仓库完整性，任何场景直接可答）──
show_help() {
  cat <<EOF
sofagent install.sh v${VERSION} — 企业设备安装器（平台无关）

用法:
  bash install.sh                       默认模式：平台无关安装（只写 ~/.sofagent/）+ FDE Skill
  bash install.sh --base-only           仅装约束层（审计·回溯·daemon·dashboard，不装 Agent Skill）
  bash install.sh --platform <name>     显式平台集成（opt-in）：openclaw / workbuddy / claude / codex / hermes / cursor / gemini
  bash install.sh --with-im-bridge      可选：安装 IM 桥远程指挥（@xmanrui/dsh-im 社区插件，默认不装）
  bash install.sh --quick               完整安装（静默模式，跳过交互确认）⚠️ 非预览，会写入文件
  bash install.sh --remote              远程安装模式（git clone）
  bash install.sh --force               升级时强制覆盖 custom/ 用户层（确认+备份）
  bash install.sh --merge               升级时三路合并 custom/ 用户层
  bash install.sh --yes, -y             配合 --force 跳过交互确认（CI 场景）
  bash install.sh --help, -h            显示此帮助

平台: 默认平台无关安装（不探测、不修改任何第三方平台配置，只写 ~/.sofagent/）；
     显式 --platform 时才做平台集成：openclaw（完整）/ workbuddy / claude / codex / hermes / cursor / gemini（v1.3.9 薄挂载）
EOF
}

# ── --help / -h 前置处理（v1.3.8 P0-1：必须在仓库完整性自检与 source 之前）──
case "${1:-}" in
  --help|-h) show_help; exit 0 ;;
esac

# ── v1.3.8 P0-1 仓库完整性自检（必须在下方 source 之前执行）──
# 根因：bootstrap.sh「单文件下载」与 install.sh「依赖同目录 engine/scripts/lib/」结构性失配——
# 孤立 install.sh（如 /tmp 下载）source 立即失败且 --help/--remote 自救都在 source 之后够不着。
# 自检策略：lib 缺失时按序自救——① 复用 --remote 的 clone 逻辑拉完整仓库后 exec 重入；
# ② clone 不可用（无 git/无网络）时打印明确指路并以非零退出（fail-closed，不裸报错）。
# 注：--help/-h 已前置到本块之前处理，不依赖 lib 与仓库完整性。
ensure_repo_integrity() {
  # 必需 lib 模块（source 依赖）+ 关键仓库文件（fde-template.md 缺失时主路径必失败，
  # 一并纳入自检让 clone 自救在最早时机触发，而非走到 Step 1 之后才报错）
  local required_libs
  required_libs="platform-detect.sh file-deploy.sh daemon-register.sh post-install.sh"
  local missing=0
  local lib_name
  for lib_name in $required_libs; do
    [ -f "${LIB_DIR}/${lib_name}" ] || missing=1
  done
  [ -f "${SCRIPT_DIR}/SKILL/harness/fde-template.md" ] || missing=1
  [ "$missing" = "0" ] && return 0

  warn "检测到运行时依赖缺失（${LIB_DIR}）——当前是孤立 install.sh 场景（如 curl 单文件下载）"
  info "正在自救：git clone 完整仓库后重新进入安装..."
  if command -v git &>/dev/null; then
    local rescue_tmp
    rescue_tmp="$(mktemp -d /tmp/sofagent-rescue-XXXXXX)"
    # URL 硬编码官方仓库（与 --remote 分支一致，不接受外部输入）
    if git clone --depth 1 https://github.com/KongFangXun/sofagent.git "$rescue_tmp" 2>/dev/null; then
      ok "完整仓库已克隆到: $rescue_tmp"
      # 重入完整仓库的 install.sh（透传除 --remote 外的参数——仓库已新鲜克隆，无需二次 clone；
      # 克隆内 lib 完整，不会再触发本自检。bash 3.2 兼容：空数组先判长度再展开，避免传空串参数）
      local pass_args=()
      local a
      for a in "$@"; do [ "$a" = "--remote" ] && continue; pass_args+=("$a"); done
      if [ ${#pass_args[@]} -gt 0 ]; then
        exec bash "$rescue_tmp/install.sh" "${pass_args[@]}"
      else
        exec bash "$rescue_tmp/install.sh"
      fi
    fi
    rm -rf "$rescue_tmp" 2>/dev/null || true
    err "git clone 失败（网络/代理问题）——孤立 install.sh 无法自救"
  else
    err "git 不可用——孤立 install.sh 无法自救"
  fi
  err "请用以下任一完整安装方式重试："
  err "  1. git clone https://github.com/KongFangXun/sofagent.git && cd sofagent && bash install.sh"
  err "  2. bash install.sh --remote    （自动 clone 完整仓库再安装）"
  exit 1
}
ensure_repo_integrity "$@"

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

# ── 全套模式（默认开启，--base-only 关闭）——底座 + Agent Skill ──
BASE_ONLY=0

# ── v1.4.2: IM 桥可选安装 flag 预扫描（同 BASE_ONLY/REMOTE_MODE 模式，在 source 前捕获）──
# 为什么预扫描而不进 parse_args：parse_args 在 engine/scripts/lib/platform-detect.sh，
# 而 IM 桥是 install.sh 自己的可选分支——flag 解析留在本文件，engine/ 零改动（纪律：install.sh 之外不碰 engine/）
WITH_IM_BRIDGE=0
for _arg in "$@"; do [ "$_arg" = "--with-im-bridge" ] && WITH_IM_BRIDGE=1; done

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
    echo -e "${BOLD}${CYAN}  sofagent 企业设备安装器 · 底座 + Agent Skill${NC}"
    echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"
  else
    echo "  ╔═══════════════════════════════════╗"
    echo "  ║  sofagent 约束层 · 企业设备安装   ║"
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
info "Step 1 · 确定安装平台..."
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

# ── Step 1.6: v1.4.5 T1（P0）巡检缺省配置首装注入 ──
# 背景：分层巡检（L1/L2/L3）与 Dream Cycle 此前「零调度」——runAllLayers /
#   runDreamCycle 存在但无任何生产调用方，巡检从未真正运行。
#   cron 调度按 watch.yml 的 inspectors: / dream-cycle: 段驱动（缺省启用），
#   首装写入缺省段确保开箱即巡检；已存在的 watch.yml 不覆盖（用户语义优先）。
# 落点：internal/watch.yml（引擎内部状态根，与 checkpoint/ 同级——
#   daemon 在项目 cwd 下读 .sofagent/watch.yml，项目级配置优先于本全局缺省）。
if [ ! -f "$INTERNAL_ROOT/watch.yml" ]; then
  cat > "$INTERNAL_ROOT/watch.yml" << 'WATCHEOF'
# sofagent 定时任务缺省配置（v1.4.5 首装生成——可按需修改）
# 项目级配置（${项目根}/.sofagent/watch.yml）存在时优先于本文件

# 分层巡检调度（v1.4.5）：L1 快速健康 / L2 深度巡检 / L3 联邦分析
# enabled: false 可整体关闭；layers 下可按层覆盖频率
inspectors:
  enabled: true
  layers:
    L1: "@daily"
    L2: "@weekly"
    L3: "@monthly"

# Dream Cycle 知识蒸馏（v1.4.5）：think.md + audit history → concepts/atoms
# 产物落 data/knowledge/；enabled: false 可关闭
dream-cycle:
  enabled: true
  schedule: "@daily"
WATCHEOF
  ok "巡检缺省配置已写入 $INTERNAL_ROOT/watch.yml（inspectors + dream-cycle 默认启用）"
else
  info "已存在 internal/watch.yml——保留用户配置（巡检配置未被覆盖）"
fi

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
    # 迁移完整性优先：cp -R 全量复制（含覆盖），失败时保留源目录绝不删除（防"复制失败但删除成功"丢数据）
    if cp -R "$old_data"/. "$new_data"/ 2>/dev/null; then
      rm -rf "$old_data"
    else
      warn "迁移复制失败，源目录已保留：${old_data} → ${new_data}（请手动检查后重试）"
      err "数据迁移失败，安装中止——源目录未删除、数据安全，请检查磁盘/权限后重跑 install.sh"
      return 1
    fi
    # 同步迁移引擎内部状态（.sofagent/ → internal/）
    local old_internal="${SCRIPT_DIR}/.sofagent"
    local new_internal="$SOFAGENT_HOME/internal"
    if [ -d "$old_internal" ]; then
      if cp -R "$old_internal"/. "$new_internal"/ 2>/dev/null; then
        rm -rf "$old_internal"
      else
        warn "迁移复制失败，源目录已保留：${old_internal} → ${new_internal}（请手动检查后重试）"
        err "数据迁移失败，安装中止——源目录未删除、数据安全，请检查磁盘/权限后重跑 install.sh"
        return 1
      fi
    fi
    ok "数据已迁移到 ${SOFAGENT_HOME}"
  fi

  # 迁移旧版安装标记（v1.2.0 的 ~/.openclaw/skills/sofagent/.sofagent-data-path 指向的目录）
  local old_marker="${HOME}/.openclaw/skills/sofagent/.sofagent-data-path"
  if [ -f "$old_marker" ]; then
    local old_path
    old_path=$(tr -d '[:space:]' < "$old_marker" 2>/dev/null)
    if [ -n "$old_path" ] && [ -d "$old_path" ]; then
      # 同迁移纪律：复制失败保留源、绝不删除
      if cp -R "$old_path"/. "$new_data"/ 2>/dev/null; then
        rm -f "$old_marker"
        ok "旧版安装数据已迁移"
      else
        warn "旧版数据迁移失败，源目录已保留：${old_path}（请手动检查后重试）"
      fi
    fi
  fi
}
migrate_to_install_dir || { err "安装因迁移失败中止（数据安全，见上方提示）"; exit 1; }

# v1.3.2 P1-8: 清理仓库内 .sofagent/ 残留（运行时数据应全在 ~/.sofagent/，仓库内不保留）
if [ -d "${SCRIPT_DIR}/.sofagent" ] && [ "$SCRIPT_DIR" != "$HOME" ]; then
  warn "检测到仓库内 .sofagent/ 残留，清理中..."
  rm -rf "${SCRIPT_DIR}/.sofagent"
fi

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
  err "找不到 fde-template.md（FDE 运行规则模板）。请在 sofagent 项目根目录下运行此脚本。"
  err "  当前脚本位置: $SCRIPT_DIR"; err "  期望文件: $RULES_SRC"; exit 1
fi
# CONFIG_FILE 不预声明——Step 7 中用 local 声明（避免 SC2034 unused 警告）

# ════════════════════════════════════════
# Step 2: 检查环境（Node.js + npm）
# ════════════════════════════════════════
info "Step 2 · 检查运行环境..."
if command -v node &>/dev/null; then
  NODE_VER=$(node --version); ok "Node.js 已安装: $NODE_VER"; _log "node=$NODE_VER"
  # v1.2.6: Node 版本下限检查——Node < 18 时 err 并退出（不是 warn）
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    err "Node.js 版本过低（${NODE_VER}），sofagent 需要 Node.js >= 18"
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
info "Step 3 · 审计引擎: @sofagent/audit（约束层审计能力）"
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
    # @latest → 固定版本（供应链纪律：安装版本与仓库声明一致，不漂移到未审的 registry 最新）
    info "  执行: npm install -g @sofagent/audit@${VERSION}"
    if npm install -g "@sofagent/audit@${VERSION}" 2>&1 | tail -1; then
      ok "  @sofagent/audit 已全局安装（v${VERSION}）"
    else
      warn "  npm install -g @sofagent/audit 失败（网络/权限问题）"
      warn "  请手动安装: npm install -g @sofagent/audit@${VERSION}"
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

# Step 6.6: v1.3.8 P1-A3 审计引擎哈希基准首装生成（堵首次部署窗口）
# 此前基准哈希仅 --doctor 首次运行时记录——install.sh 首装后到用户跑 doctor 之前是空窗：
# 攻击者可植入冒牌 engine/audit/dist，hook 的 if [ -f audit-hash.txt ] 跳过校验。
# 首装即写基准（本地 dist 优先，全局安装 fallback），后续 hook 每次比对。
if command -v node >/dev/null 2>&1; then
  HASH_BASE_DIR="${SOFAGENT_HOME}/internal"
  HASH_RECORD="${HASH_BASE_DIR}/audit-hash.txt"
  HASH_SOURCE=""
  if [ -f "${SCRIPT_DIR}/engine/audit/dist/index.js" ]; then
    HASH_SOURCE="${SCRIPT_DIR}/engine/audit/dist/index.js"
  elif command -v sofagent-audit >/dev/null 2>&1; then
    # 全局安装场景：解析 sofagent-audit wrapper 指向的真实 dist
    HASH_SOURCE=$(node -e "try{const p=require('path');const idx=require.resolve('sofagent-audit');const d=p.dirname(p.dirname(idx));process.stdout.write(p.join(d,'dist','index.js'))}catch{process.stdout.write('')}" 2>/dev/null || echo "")
  fi
  if [ -n "$HASH_SOURCE" ] && [ -f "$HASH_SOURCE" ]; then
    if [ ! -f "$HASH_RECORD" ]; then
      mkdir -p "$HASH_BASE_DIR"
      if node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$HASH_SOURCE" > "$HASH_RECORD" 2>/dev/null; then
        chmod 600 "$HASH_RECORD" 2>/dev/null || true
        ok "  审计引擎哈希基准已生成（$(basename "$HASH_SOURCE")，供 hook 完整性校验）"
      else
        rm -f "$HASH_RECORD"
        warn "  审计引擎哈希基准生成失败（可运行 sofagent-audit --doctor 补生成）"
      fi
    fi
  else
    warn "  审计引擎 dist 未找到——哈希基准未生成（安装 @sofagent/audit 后运行 sofagent-audit --doctor 补生成）"
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
# v0.2.0 起 PyPI wheel 已包含 skillopt-sleep CLI（pyproject.toml [project.scripts] 声明）
# 直装即可：pip install skillopt
# 如需 Claude Code/Codex/Copilot/Devin 集成 shell 或 OpenClaw 适配（仅仓库 plugins/ 目录）：
#   git clone https://github.com/microsoft/SkillOpt.git ~/SkillOpt
#   cd ~/SkillOpt && pip install -e ".[all]"
echo "ℹ️ SkillOpt 自进化引擎（可选）：pip install skillopt（v0.2.0+ 已含 skillopt-sleep CLI）"

# ── v1.1.0: 可选包提示（这些不在自动安装范围内，仅提示）──
echo ""
echo "可选 npm 包（上述未自动安装，按需运行）："
echo "  npm install -g @sofagent/orchestrator   # 独立编排引擎"
echo "  npm install -g @sofagent/daemon          # 守护进程"
echo "  npm install -g @sofagent/core            # 基础设施（doctor/verify）"
echo "  npm install -g @sofagent/ontology        # 本体模型"

# 编排引擎为独立可选包（不随 @sofagent/audit 自动安装，需按需单独安装）
echo "  💡 编排引擎为独立可选包 @sofagent/orchestrator，需单独安装（npm install -g @sofagent/orchestrator）"

# ── v1.4.2: IM 桥远程指挥可选安装分支（--with-im-bridge flag，默认不装）──
# 装的是第三方社区插件 @xmanrui/dsh-im（非 DSH 官方、非 sofagent 产物，MIT），
# 把九种 IM 机器人 + 公网 AI Office 接入本机 DeepSeek Harness——手机扫码远程指挥。
# 设计约束（对齐 --with-memory 可选分支纪律）：
#   1. 默认不装：不传 --with-im-bridge 时本分支完全不执行，不写任何第三方目录
#   2. 失败不阻断：dsh/npm 缺失或安装失败仅 warn——IM 桥是增强件，不装不影响核心约束层
#   3. 幂等：dsh plugin add 对已装插件是安全重入
# 详细指南（命令白名单/安全边界/审计结论）：docs/guides/im-bridge.md
if [[ "${WITH_IM_BRIDGE:-0}" == "1" ]]; then
  echo ""
  info "Step 8a · IM 桥远程指挥（可选，@xmanrui/dsh-im 社区插件）..."
  if command -v dsh &>/dev/null; then
    # dsh plugin add：写 DSH 自己的 profile（~/.dsh/），不碰 sofagent 目录
    if dsh plugin --profile web add -w @xmanrui/dsh-im 2>&1 | tail -3; then
      ok "  IM 桥已安装——重启 dsh web 后进「设置 → IM机器人」扫码接入"
      echo "  渠道：微信/飞书/钉钉/企微/QQ/Slack/Telegram/Discord/WhatsApp + AI Office Connector"
    else
      warn "  dsh plugin add 失败（网络/权限）——可手动执行: dsh plugin --profile web add -w @xmanrui/dsh-im"
    fi
  else
    # dsh 未装：不代装 DSH 本体（那是 DeepSeek Harness 的安装范围，越权）——给手动指路
    warn "  未检测到 dsh（DeepSeek Harness）——IM 桥依赖 DSH 宿主，已跳过"
    warn "  先安装 DeepSeek Harness，再执行: dsh plugin --profile web add -w @xmanrui/dsh-im"
    warn "  详见: docs/guides/im-bridge.md"
  fi
fi

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
#!/usr/bin/env bash
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
  web)
    # v1.4.0 交付二：Web Dashboard（HTML 版，装完即用——读本机真实数据）
    if [ -f "$SOFAGENT_HOME/bin/serve-dashboard.mjs" ]; then
      exec node "$SOFAGENT_HOME/bin/serve-dashboard.mjs" "$@"
    else
      echo "Web Dashboard 未安装（serve-dashboard.mjs 缺失）——请重新运行 bash install.sh"
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
    echo "  sofagent web        Open Web Dashboard in browser (v1.4.0)"
    echo "  sofagent data       Open data directory in Finder"
    echo "  sofagent help       Show this help"
    ;;
esac
CLIEOF
  chmod +x "$bin_dir/sofagent"

  # Dashboard 入口软链（v1.2.2 真实实现 tools/dashboard/sofagent-dashboard.sh，零前端依赖 bash+jq）
  # wrapper dashboard 分支检查 -x "$SOFAGENT_HOME/bin/sofagent-dashboard"，故软链目标不带 .sh 后缀
  local dashboard_src="${SCRIPT_DIR}/tools/dashboard/sofagent-dashboard.sh"
  local dashboard_link="$bin_dir/sofagent-dashboard"
  if [ -f "$dashboard_src" ]; then
    # 同守卫纪律：软链成功才报 ok（失败走 wrapper 占位分支兜底并提示）
    if ln -sf "$dashboard_src" "$dashboard_link" 2>/dev/null && [ -L "$dashboard_link" ]; then
      chmod +x "$dashboard_link" 2>/dev/null || true
      ok "  Dashboard 入口已注册：sofagent-dashboard → $bin_dir/sofagent-dashboard"
    else
      warn "  Dashboard 软链注册失败（${dashboard_link}），wrapper 占位分支兜底；可手动执行：ln -sf ${dashboard_src} ${dashboard_link}"
    fi
  else
    warn "  Dashboard 实现脚本缺失（${dashboard_src}），跳过软链；wrapper 占位分支兜底"
  fi

  # v1.4.0 交付二：Web Dashboard 安装（v1.4.4 升级：目录同步取代两文件白名单）
  # 装完即用：sofagent web 起服务开浏览器，读 $SOFAGENT_HOME/data/ 真实数据
  # 同步规则：页面文件（*.html/*.css/*.js）整体跟随——未来新增页面文件不再改白名单；
  #           docs/assets/ → web/assets/——安装态静态引用必命中（logo 断链根因的结构性修复）
  local web_dir="$SOFAGENT_HOME/web"
  mkdir -p "$web_dir"
  local dash_src_dir="${SCRIPT_DIR}/tools/dashboard"
  if [ -d "$dash_src_dir" ] && [ -f "${dash_src_dir}/dashboard.html" ]; then
    local synced=0 f
    for f in "$dash_src_dir"/*.html "$dash_src_dir"/*.css "$dash_src_dir"/*.js; do
      [ -f "$f" ] || continue
      if cp "$f" "$web_dir/" 2>/dev/null; then
        synced=$((synced + 1))
      fi
    done
    cp "${dash_src_dir}/serve-dashboard.mjs" "$bin_dir/serve-dashboard.mjs" 2>/dev/null
    chmod +x "$bin_dir/serve-dashboard.mjs" 2>/dev/null || true
    if [ -d "${SCRIPT_DIR}/docs/assets" ]; then
      mkdir -p "$web_dir/assets"
      cp "${SCRIPT_DIR}"/docs/assets/* "$web_dir/assets/" 2>/dev/null || true
    fi
    ok "  Web Dashboard 已安装（${synced} 个页面文件 + assets/ 静态资源，sofagent web 启动）"
  else
    warn "  dashboard.html 缺失（${dash_src_dir}/dashboard.html），跳过 Web Dashboard 安装"
  fi

  # symlink 到 PATH（优先 /usr/local/bin，fallback ~/.local/bin）
  local target="/usr/local/bin/sofagent"
  local registered=0
  if [ -w "/usr/local/bin" ]; then
    if ln -sf "$bin_dir/sofagent" "$target" 2>/dev/null; then
      registered=1
    fi
  elif sudo -n true 2>/dev/null; then
    # 进入此分支 = /usr/local/bin 不可写且 sudo NOPASSWD 可用——ln 必须带 sudo 前缀
    if sudo ln -sf "$bin_dir/sofagent" "$target" 2>/dev/null; then
      registered=1
    fi
  fi
  if [ "$registered" -eq 1 ]; then
    ok "  CLI 命令注册完成：sofagent → $target"
  else
    target="$HOME/.local/bin/sofagent"
    mkdir -p "$HOME/.local/bin"
    # 同守卫纪律：注册成功才报 ok，失败给手动命令（防"报成功实际未注册"）
    if ln -sf "$bin_dir/sofagent" "$target" 2>/dev/null; then
      # 提示用户 ~/.local/bin 需要在 PATH 里（BSD 兼容：用 case 而非 grep -q）
      case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *)
          warn "  请将 ~/.local/bin 加入 PATH："
          warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
          ;;
      esac
      ok "  CLI 命令注册完成：sofagent → $target"
    else
      warn "  注册到 ~/.local/bin 失败，可手动执行：ln -sf ${bin_dir}/sofagent ~/.local/bin/sofagent"
    fi
  fi
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
        if [ -L "$psd" ]; then
          ok "  Skill 统一路径已建立：${SOFAGENT_HOME}/skill/ → ${psd}（显式平台集成）"
        else
          # symlink 被既有普通目录占用时降级为复制（防副本静默过期——收编后须以本源为准确认）
          cp -R "$SOFAGENT_HOME/skill"/. "$psd"/ 2>/dev/null || true
          warn "  Symlink 被普通目录占用，已降级为复制同步：${psd}"
        fi
        ;;
      # v1.3.9（八）：跨平台适配器扩展——Cursor / Gemini CLI 薄挂载
      # （Skill 走平台技能目录 symlink；规则文件 sofagent.mdc / GEMINI.md 复制到平台目录）
      cursor)
        local cur_rules="${HOME}/.cursor/rules"
        local cur_skills="${HOME}/.cursor/skills/sofagent"
        mkdir -p "$cur_rules" 2>/dev/null || true
        ln -sfn "$SOFAGENT_HOME/skill" "$cur_skills" 2>/dev/null || true
        if [ ! -L "$cur_skills" ]; then
          # symlink 被既有普通目录占用时降级为复制（防副本静默过期）
          cp -R "$SOFAGENT_HOME/skill"/. "$cur_skills"/ 2>/dev/null || true
          warn "  Symlink 被普通目录占用，已降级为复制同步：${cur_skills}"
        fi
        if [ -f "${SCRIPT_DIR}/.cursor/rules/sofagent.mdc" ]; then
          cp "${SCRIPT_DIR}/.cursor/rules/sofagent.mdc" "${cur_rules}/sofagent.mdc"
        fi
        # v1.4.3 F-02 修复：Cursor hook 配置必须是合法 hooks.json（Cursor 官方 schema
        # {version:1, hooks:{preToolUse:[{command,matcher}]}}），旧实现直接 cp .sh 脚本
        # 为 hooks.json 是字节级错误（Cursor 解析失败 = hook 静默不生效）。
        # 脚本本体安装到 ~/.sofagent/hooks/（稳定路径，独立于安装源仓库存在），
        # hooks.json 的 command 用绝对路径引用。
        if [ -f "${SCRIPT_DIR}/tools/hooks/sofagent-precommit.sh" ]; then
          local sofa_hooks_dir="$SOFAGENT_HOME/hooks"
          mkdir -p "$sofa_hooks_dir" 2>/dev/null || true
          cp "${SCRIPT_DIR}/tools/hooks/sofagent-precommit.sh" "$sofa_hooks_dir/sofagent-precommit.sh"
          chmod +x "$sofa_hooks_dir/sofagent-precommit.sh" 2>/dev/null || true
          cat > "${cur_rules}/../hooks.json" << HOOKJSONEOF
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "bash '${sofa_hooks_dir}/sofagent-precommit.sh'",
        "matcher": "Shell",
        "timeout": 60
      }
    ]
  }
}
HOOKJSONEOF
          ok "  Cursor hook 配置：~/.cursor/hooks.json（preToolUse·Shell → ${sofa_hooks_dir}/sofagent-precommit.sh）"
        fi
        ok "  Cursor 薄挂载：${cur_rules}/sofagent.mdc + Skill symlink ${cur_skills}"
        ;;
      # v1.4.0: Claude Code 薄挂载 + hook（与 Cursor 同构）
      claude)
        local claude_rules="${HOME}/.claude"
        mkdir -p "$claude_rules" 2>/dev/null || true
        ln -sfn "$SOFAGENT_HOME/skill" "${claude_rules}/skills/sofagent" 2>/dev/null || true
        if [ ! -L "${claude_rules}/skills/sofagent" ] && [ -d "${claude_rules}/skills/sofagent" ]; then
          # symlink 被既有普通目录占用时降级为复制（防副本静默过期）
          cp -R "$SOFAGENT_HOME/skill"/. "${claude_rules}/skills/sofagent"/ 2>/dev/null || true
          warn "  Symlink 被普通目录占用，已降级为复制同步：${claude_rules}/skills/sofagent"
        fi
        if [ -f "${SCRIPT_DIR}/.claude/settings.json" ]; then
          cp "${SCRIPT_DIR}/.claude/settings.json" "${claude_rules}/settings.json"
        fi
        ok "  Claude Code 薄挂载：~/.claude/settings.json（commit 审计拦截）+ Skill symlink"
        ;;
      gemini)
        local gem_skills="${HOME}/.gemini/skills/sofagent"
        ln -sfn "$SOFAGENT_HOME/skill" "$gem_skills" 2>/dev/null || true
        if [ ! -L "$gem_skills" ] && [ -d "$gem_skills" ]; then
          # symlink 被既有普通目录占用时降级为复制（防副本静默过期）
          cp -R "$SOFAGENT_HOME/skill"/. "$gem_skills"/ 2>/dev/null || true
          warn "  Symlink 被普通目录占用，已降级为复制同步：${gem_skills}"
        fi
        if [ -f "${SCRIPT_DIR}/GEMINI.md" ]; then
          cp "${SCRIPT_DIR}/GEMINI.md" "${HOME}/.gemini/GEMINI.md"
        fi
        ok "  Gemini CLI 薄挂载：${HOME}/.gemini/GEMINI.md + Skill symlink ${gem_skills}"
        ;;
      # v1.4.0：Codex 薄挂载——AGENTS.md 是 Codex 四层加载链挂载点（L1 SKILL.md → L2 fde.md）
      codex)
        local codex_dir="${HOME}/.codex"
        mkdir -p "$codex_dir" 2>/dev/null || true
        if [ -f "${SCRIPT_DIR}/AGENTS.md" ]; then
          cp "${SCRIPT_DIR}/AGENTS.md" "${codex_dir}/AGENTS.md"
        fi
        ok "  Codex 薄挂载：~/.codex/AGENTS.md（四层加载链挂载点）+ fde.md（FDE 步骤写入）"
        ;;
      # v1.4.0：Hermes 薄挂载（fde.md 已由 FDE 步骤写入 ~/.hermes/fde.md）
      hermes)
        local hermes_dir="${HOME}/.hermes"
        mkdir -p "${hermes_dir}/skills" 2>/dev/null || true
        ln -sfn "$SOFAGENT_HOME/skill" "${hermes_dir}/skills/sofagent" 2>/dev/null || true
        if [ -L "${hermes_dir}/skills/sofagent" ]; then
          ok "  Hermes 薄挂载：Skill symlink（fde.md 已由 FDE 步骤写入 ~/.hermes/fde.md）"
        else
          # symlink 注册失败时降级为复制（防 ok 谎报——与 openclaw/claude 分支同构）
          cp -R "$SOFAGENT_HOME/skill"/. "${hermes_dir}/skills/sofagent"/ 2>/dev/null || true
          warn "  Hermes Symlink 注册失败，已降级为复制同步：${hermes_dir}/skills/sofagent"
        fi
        ;;
      *)
        ok "  Skill 已安装到统一路径：$SOFAGENT_HOME/skill/（平台无关安装，未修改任何平台目录）"
        ;;
    esac
  fi
}

# ════════════════════════════════════════
# MCP 自动配置（v1.4.5）——装完即连，不用手动在各平台添加 MCP server
# ════════════════════════════════════════
# 写 JSON 格式 MCP 配置（workbuddy / claude / cursor）——merge 不覆盖用户已有 server
write_mcp_json() {
  local cfg="$1" node_bin="$2" server_js="$3"
  mkdir -p "$(dirname "$cfg")" 2>/dev/null || true
  MCP_CFG="$cfg" MCP_NODE="$node_bin" MCP_SERVER="$server_js" "$node_bin" -e '
    const fs = require("fs");
    const cfg = process.env.MCP_CFG;
    let obj = {};
    if (fs.existsSync(cfg)) { try { obj = JSON.parse(fs.readFileSync(cfg, "utf8")); } catch { obj = {}; } }
    obj.mcpServers = obj.mcpServers || {};
    obj.mcpServers.sofagent = { command: process.env.MCP_NODE, args: [process.env.MCP_SERVER], disabled: false };
    fs.writeFileSync(cfg, JSON.stringify(obj, null, 2) + "\n");
  '
  ok "  MCP 已配置：${cfg}（sofagent → ${server_js}）"
}

# 写 TOML 格式 MCP 配置（codex）——追加 [mcp_servers.sofagent] 段，幂等
write_mcp_toml() {
  local cfg="$1" node_bin="$2" server_js="$3"
  mkdir -p "$(dirname "$cfg")" 2>/dev/null || true
  if grep -q '\[mcp_servers\.sofagent\]' "$cfg" 2>/dev/null; then
    ok "  MCP 已配置（存在）：$cfg"
    return
  fi
  {
    echo ""
    echo "[mcp_servers.sofagent]"
    echo "command = \"$node_bin\""
    echo "args = [\"$server_js\"]"
  } >> "$cfg"
  ok "  MCP 已配置：${cfg}（[mcp_servers.sofagent] → ${server_js}）"
}

install_mcp_config() {
  local mcp_server_js="${SCRIPT_DIR}/engine/mcp/dist/mcp-server.js"
  if [ ! -f "$mcp_server_js" ]; then
    warn "  mcp-server.js 缺失（${mcp_server_js}）——跳过 MCP 自动配置（需先 npm run build）"
    return
  fi
  local node_bin
  node_bin="$(command -v node 2>/dev/null || echo node)"

  case "$PLATFORM" in
    workbuddy) write_mcp_json "$HOME/.workbuddy/mcp.json" "$node_bin" "$mcp_server_js" ;;
    codex)     write_mcp_toml "$HOME/.codex/config.toml" "$node_bin" "$mcp_server_js" ;;
    claude)    write_mcp_json "$HOME/.claude/mcp.json" "$node_bin" "$mcp_server_js" ;;
    cursor)    write_mcp_json "$HOME/.cursor/mcp.json" "$node_bin" "$mcp_server_js" ;;
    *)         return ;;
  esac
}

install_cli
install_skill_unified
install_mcp_config

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
      [ -n "$old" ] && rm -rf "$old"
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
    warn "upgrade_skill: SKILL 源目录不存在: ${SKILL_SRC}，跳过"
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
    # v1.3.9（八）：Cursor / Gemini CLI——fde.md 走平台技能目录（与 Skill symlink 同位）
    cursor) FDE_MD_TARGET="$HOME/.cursor/skills/sofagent/fde.md" ;;
    gemini) FDE_MD_TARGET="$HOME/.gemini/skills/sofagent/fde.md" ;;
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
    # v1.3.8: 注入文件收敛到 SKILL/rules/ 子目录，同步到 handler 读取的 sofagentSkillDir/rules
    SKILL_SRC="${SCRIPT_DIR}/SKILL"
    SKILL_DIR="$(dirname "$FDE_MD_TARGET")"
    if [ -f "$SKILL_SRC/SKILL.md" ]; then
      cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/sofagent-fde/SKILL.md" 2>/dev/null || cp "$SKILL_SRC/SKILL.md" "$SKILL_DIR/SKILL.md"
      echo -e "${GREEN}✅ FDE Skill 已安装（@sofagent-fde 可用）${NC}"
      # v1.2.7: 补充分层文件（handler.ts L1 渐进式加载依赖）
      # v1.3.8: 源与目标均收敛到 rules/ 子目录——目标 = SKILL_DIR/rules（handler 读 sofagentSkillDir/rules）
      RULES_SRC="$SKILL_SRC/rules"
      RULES_DST="$SKILL_DIR/rules"
      if [ -d "$RULES_SRC" ]; then
        mkdir -p "$RULES_DST"
        for layer_file in core-rules.md role-audit.md role-fde.md role-orchestrate.md; do
          if [ -f "$RULES_SRC/$layer_file" ]; then
            cp "$RULES_SRC/$layer_file" "$RULES_DST/$layer_file"
          fi
        done
        echo -e "  ${CYAN}分层文件已同步（rules/: core-rules.md + role-*.md）${NC}"
      fi
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
  # v1.3.5 #19: 假绿修复——此前 `| tail -3 || true` 双保险吞掉 verify 退出码：
  #   管道后 $? 是 tail 的退出码（恒 0），|| true 再兜一层，verify 失败仍打成功标语。
  #   现在把 verify 输出落临时文件（tail 只负责截屏显示），退出码单独捕获；
  #   verify 失败 → 成功标语不输出，改为修复指引，install 以非零退出。
  # 平台无关：未显式指定平台时不传 --platform（避免触发 verify.sh 自身的平台探测日志）
  VERIFY_LOG="$(mktemp /tmp/sofagent-install-verify.XXXXXX)"
  VERIFY_RC=0
  # `cmd || VERIFY_RC=$?` 防 set -e 在 verify 失败时直接中断（否则下方裁决块无机会输出）
  if [ -n "$PLATFORM" ]; then
    bash "${SCRIPT_DIR}/engine/scripts/verify.sh" --quick --platform "$PLATFORM" > "$VERIFY_LOG" 2>&1 || VERIFY_RC=$?
  else
    bash "${SCRIPT_DIR}/engine/scripts/verify.sh" --quick --quiet > "$VERIFY_LOG" 2>&1 || VERIFY_RC=$?
  fi
  # 显示末尾摘要（结果行 + 总结），完整日志留在临时文件
  tail -5 "$VERIFY_LOG"
  echo ""

  # ── 设置 data 目录权限 ──
  if [ -d "$HOME/.sofagent/data" ]; then
    chmod 700 "$HOME/.sofagent/data" 2>/dev/null || true
  fi

  # ── v1.3.5 #19: verify 结果裁决——成功标语只在校验通过时输出（诚实收尾） ──
  if [ "$VERIFY_RC" -ne 0 ]; then
    echo -e "${RED}⚠️ 验证有失败项——安装未完全成功，成功标语不出现。${NC}"
    echo -e "  完整清单：cat $VERIFY_LOG"
    echo -e "  或运行：bash ${SCRIPT_DIR}/engine/scripts/verify.sh"
    exit 1
  fi
  rm -f "$VERIFY_LOG"

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
  # ── v1.4.3 第九章：完成提示分层（三条产品线——命令逐条真实，无断头路）──
  echo -e "  ${BOLD}装好即用（核心约束层）：${NC}"
  echo -e "  · ${BOLD}sofagent web${NC} 起 Dashboard（工作明细/图谱/审计分析/训练任务区块）"
  echo -e "  · ${BOLD}sofagent-audit <范围>${NC} 审计一次变更（如 sofagent-audit HEAD~1..HEAD）"
  echo -e "  · ${BOLD}sofagent-audit --stats${NC} 看近 30 天治理 KPI（触发率/阻断率——v1.4.3）"
  echo ""
  echo -e "  ${BOLD}可选·后训模块（需要 GPU 环境）：${NC}"
  echo -e "  · 先体检：${BOLD}bash tools/train/train-env-init.sh${NC} 一键装训练环境（含反作弊双防线默认配置）"
  echo -e "  · 再提任务：MCP train_doctor（体检）→ train_submit（提交）→ train_status（监控）→ train_diagnose（失败诊断）"
  echo -e "  · 前置要求与入口详见 HANDBOOK「新功能入口导览」表"
  echo ""
  echo -e "  ${BOLD}可选·IM 桥（IM 群远程指挥）：${NC}"
  echo -e "  · 配置见 ${BOLD}docs/guides/im-bridge.md${NC}（钉钉/飞书/企微三平台）"
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
