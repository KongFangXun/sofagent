#!/bin/bash
# ============================================================
# sofagent install.sh · 多平台一键安装脚本
# ============================================================
# 将 sofagent 约束层部署到目标平台，让 Agent 获得治理能力。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 平台支持：
#   --platform openclaw  → 完整部署（宪法 + Hook + 脚本 + 断路器）
#   --platform workbuddy → 检查 .sofagent/ 数据目录 + 运行 verify.sh（SKILL.md 入口流程自动管理）
#   --platform claude    → 部署宪法 + 输出种子指令
#   --platform codex     → 部署宪法 + 输出种子指令
#   --platform hermes    → 部署宪法 + 输出种子指令
#   未指定 → 自动探测
#
# 外部依赖：
#   agency-orchestrator（仅 OpenClaw—会尝试全局安装，已安装则跳过）
# ============================================================

set -euo pipefail
VERSION="0.83"

# ── 颜色输出 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[sofagent]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# ── 确定脚本所在目录（支持符号链接）──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 安装日志 ──
INSTALL_LOG=""  # 等 TARGET 确定后再设置

_log() { echo "[$(date '+%H:%M:%S')] $1" >> "${INSTALL_LOG:-/dev/null}"; }

# ── 快速模式（v0.73：初始化在参数解析之前，set -u 兼容）──
QUICK_MODE="${QUICK_MODE:-0}"
REMOTE_MODE="${REMOTE_MODE:-0}"

# ── 欢迎 ──
if [ "$QUICK_MODE" = "0" ]; then
echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║   sofagent Harness · installer   ║"
echo "  ╚═══════════════════════════════════╝"
echo ""
fi

# ── 远程安装模式（curl pipe bash 场景）──
if [ "${REMOTE_MODE}" = "1" ]; then
  info "远程安装模式——克隆仓库..."
  REMOTE_TMP="$(mktemp -d /tmp/sofagent-remote-XXXXXX)"
  if command -v git &>/dev/null; then
    git clone https://github.com/KongFangXun/sofagent.git "$REMOTE_TMP" 2>/dev/null || {
      err "git clone 失败，请检查网络或手动 git clone"
      exit 1
    }
    ok "仓库已克隆到: $REMOTE_TMP"
    cd "$REMOTE_TMP"
    # 重新调用 install.sh，去掉 --remote，透传其他参数
    REMAINING_ARGS=""
    for arg in "${ORIGINAL_ARGS[@]}"; do
      [ "$arg" = "--remote" ] && continue
      REMAINING_ARGS="$REMAINING_ARGS $arg"
    done
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

# ── 参数解析 ──
PLATFORM=""
QUICK_MODE=0  # v0.73: --quick 模式跳过交互确认
REMOTE_MODE=0
ORIGINAL_ARGS=("$@")  # 保存原始参数（--remote 模式下透传用）
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)     PLATFORM="$2"; shift 2 ;;
    --platform=*)   PLATFORM="${1#*=}"; shift ;;
    --project-dir)  PROJECT_DIR="$2"; shift 2 ;;
    --project-dir=*) PROJECT_DIR="${1#*=}"; shift ;;
    --no-ao)         NO_AO=1; shift ;;
    --no-config-inject) NO_CONFIG_INJECT=1; shift ;;
    --quick)         QUICK_MODE=1; shift ;;
    --ci)            QUICK_MODE=1; shift ;;  # --ci = --quick 别名，CI 环境用
    --remote)        REMOTE_MODE=1; shift ;;
    -h|--help)
      echo "用法: install.sh [--platform openclaw|workbuddy|claude|codex|hermes] [--project-dir DIR]"
      echo ""
      echo "平台说明："
      echo "  openclaw  完整部署（宪法 + Hook + 脚本 + 断路器）→ ~/.openclaw/"
      echo "  workbuddy 检查 .sofagent/ 数据目录 + 运行 verify.sh"
      echo "  claude    部署宪法 → ~/.claude/ + 输出种子指令（需手动粘贴到 CLAUDE.md）"
      echo "  codex     部署宪法 → ~/.codex/ + 输出种子指令（需手动粘贴到 AGENTS.md）"
      echo "  hermes    部署宪法 → ~/.hermes/ + 输出种子指令（需手动粘贴到 SOUL.md）"
      echo "  --project-dir DIR   指定项目工作目录（.sofagent/ 数据目录会创建在这里，默认当前目录）"
      echo "  --no-ao             跳过 agency-orchestrator 全局安装（企业环境用）"
      echo "  --no-config-inject  跳过自动注入 OpenClaw config.json（企业环境用）"
      echo "  --quick             快速模式——跳过交互确认和验证等待，直接完整安装"
      echo "  --remote            远程安装模式——自动 git clone 仓库后安装（配合 curl pipe bash 使用）"
      exit 0
      ;;
    *) shift ;;
  esac
done

# 平台参数转小写（兼容 WorkBuddy / OPENCLAW 等大写输入）
PLATFORM="$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]')"

# ── 平台探测（未指定时自动检测）──
if [ -z "$PLATFORM" ]; then
  if [ -d "$HOME/.openclaw" ]; then      PLATFORM="openclaw"
  elif [ -d "$HOME/.workbuddy" ]; then   PLATFORM="workbuddy"
  elif [ -d "$HOME/.claude" ]; then      PLATFORM="claude"
  elif [ -d "$HOME/.codex" ]; then       PLATFORM="codex"
  elif [ -d "$HOME/.hermes" ]; then      PLATFORM="hermes"
  else                                   PLATFORM="openclaw"  # 默认
  fi
fi

# ── 确定数据目录位置 ──
if [ -n "${PROJECT_DIR:-}" ]; then
  # 用户指定了 --project-dir
  PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || {
    err "--project-dir 目录不存在或无法访问: $PROJECT_DIR"
    exit 1
  }
  ok "数据目录: ${PROJECT_DIR}/.sofagent/"
else
  PROJECT_DIR="$PWD"
  warn "未指定 --project-dir，.sofagent/ 数据目录将创建在当前目录: ${PROJECT_DIR}"
  warn "  如果这不是你的项目工作目录，请用 --project-dir 指定："
  warn "  bash sofagent/scripts/install.sh --project-dir ~/my-project"
fi

# ── 统一初始化数据目录路径（所有平台共用，避免 set -u 下未定义）──
SOFAGENT_DATA="${PROJECT_DIR}/.sofagent"

# ── 按平台确定目标路径 ──
case "$PLATFORM" in
  openclaw) TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
  workbuddy)
    ok "WorkBuddy 平台——部署 Skill 文件并验证数据目录。"
    TARGET="$HOME/.workbuddy"
    # 检查 .sofagent/ 数据目录
    if [ -d "$SOFAGENT_DATA" ]; then
      ok "  · .sofagent/ 数据目录存在"
      if [ -x "${SCRIPT_DIR}/verify.sh" ]; then
        bash "${SCRIPT_DIR}/verify.sh" --platform workbuddy --quiet 2>/dev/null && \
          ok "  · 数据目录验证通过" || warn "  · 部分数据文件缺失，下次对话自动触发 B1 重建"
      fi
    else
      warn "  · .sofagent/ 不存在——下次加载 sofagent Skill 时自动创建"
    fi
    ;;  # 继续走下方统一的 Step 1-7 部署流程
  claude)   TARGET="$HOME/.claude" ;;
  codex)    TARGET="$HOME/.codex" ;;
  hermes)   TARGET="$HOME/.hermes" ;;
  *)        TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
esac

ok "平台: $PLATFORM → 目标: $TARGET"

# 初始化安装日志
mkdir -p "$TARGET"
INSTALL_LOG="${TARGET}/.sofagent-install.log"
echo "" >> "$INSTALL_LOG"
echo "=== sofagent install $(date -u +'%Y-%m-%dT%H:%M:%SZ') ===" >> "$INSTALL_LOG"
_log "TARGET=$TARGET"
_log "SCRIPT_DIR=$SCRIPT_DIR"

RULES_SRC="${SCRIPT_DIR}/../rules.md"

# 检查源文件
if [ ! -f "$RULES_SRC" ]; then
  err "找不到 rules.md。请在 sofagent 项目根目录下运行此脚本。"
  err "  当前脚本位置: $SCRIPT_DIR"
  err "  期望文件: $RULES_SRC"
  exit 1
fi

# OpenClaw 配置文件（Step 7 会精确判断，这里先设默认值避免 unbound variable）
CONFIG_FILE=""

# ════════════════════════════════════════
# Step 2: 检查环境
# ════════════════════════════════════════
info "Step 2/7 · 检查运行环境..."

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  ok "Node.js 已安装: $NODE_VER"
  _log "node=$NODE_VER"
else
  warn "Node.js 未安装。agency-orchestrator 需要 Node.js >= 18"
  warn "请先安装 Node.js: https://nodejs.org/"
fi

# npm
if command -v npm &>/dev/null; then
  NPM_VER=$(npm --version)
  ok "npm 已安装: v$NPM_VER"
  # 检测是否为 nvm/volta 等免 sudo 安装
  NPM_ROOT=$(npm root -g 2>/dev/null || echo "")
  if [ -n "$NPM_ROOT" ] && [ ! -w "$NPM_ROOT" ]; then
    warn "npm 全局目录不可写 ($NPM_ROOT)"
    warn "  npm install -g 可能需要 sudo。考虑以下方案："
    warn "  方案 1: 使用 nvm 或更改 npm prefix（免 sudo）"
    warn "    https://docs.npmjs.com/resolving-eacces-permissions-errors"
    warn "  方案 2: 本次用 sudo npm install -g（不推荐）"
    warn "  方案 3: 加 --no-ao 跳过编排引擎（不影响底线约束）"
  fi
else
  warn "npm 未安装"
fi

# ════════════════════════════════════════
# Step 3: 安装外部依赖（仅 OpenClaw，ao compose 编排用）
# ════════════════════════════════════════
if [ "$PLATFORM" = "openclaw" ] && [ "${NO_AO:-0}" != "1" ]; then
info "Step 3/7 · 安装外部依赖（agency-orchestrator）..."

if command -v ao &>/dev/null; then
  AO_VER=$(ao --version 2>/dev/null || echo "unknown")
  ok "agency-orchestrator 已安装: $AO_VER"
else
  if command -v npm &>/dev/null; then
    info "正在安装 agency-orchestrator..."
    set +e
    npm install -g agency-orchestrator@0.7.5 2>&1 | tail -1 || \
      npm install -g agency-orchestrator@0.7.5 --registry=https://registry.npmmirror.com 2>&1 | tail -1
    AO_EXIT_CODE=$?
    set -e
    if [ $AO_EXIT_CODE -ne 0 ] && ! command -v ao &>/dev/null; then
      warn "npm install 失败——编排引擎（ao compose）将不可用"
      warn "  降级方案：手动拆任务 → bash scripts/task-record.sh 逐条记录 → 手动闭环"
      warn "  （地基约束层——底线+铁律不受影响）"
    fi
    if command -v ao &>/dev/null; then
      ok "agency-orchestrator 安装成功"
      _log "ao installed successfully"
    else
      warn "ao 命令未在 PATH 中找到，可能需要重新打开终端"
      warn "编排引擎（任务自动拆解/并行执行）将不可用。地基约束层不受影响。"
      warn "降级方案：手动拆任务 → bash scripts/task-record.sh 逐条记录 → 手动闭环"
    fi
  else
    warn "跳过 agency-orchestrator 安装（npm 不可用）"
    warn "编排引擎将不可用。地基约束层（宪法/反思/规则）正常加载。"
    warn "详见 Handbook §十三 常见问题"
  fi
fi

# ── AO API Key 检查 ──
if command -v ao &>/dev/null; then
  KEY_FOUND=""
  [ -n "${DEEPSEEK_API_KEY:-}" ] && KEY_FOUND="DeepSeek"
  [ -n "${ANTHROPIC_API_KEY:-}" ] && KEY_FOUND="Claude"
  [ -n "${OPENAI_API_KEY:-}" ] && KEY_FOUND="OpenAI"
  if [ -n "$KEY_FOUND" ]; then
    ok "AO API Key has been configured ($KEY_FOUND)"
  else
    warn "AO 已安装但未配置模型的 API Key——编排功能将不可用"
    warn "  ⚠️ AO 没有自己的 API Key——你需要用自己模型的 API Key："
    warn "    如果你用 DeepSeek → export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx"
    warn "    如果你用 Claude   → export ANTHROPIC_API_KEY=sk-ant-xxxxxxxx"
    warn "    如果你用 OpenAI  → export OPENAI_API_KEY=sk-proj-xxxxxxxx"
    warn "  写入 ~/.zshrc 永久生效。没有 Key？去对应模型官网申请"
  fi
fi

fi  # end OpenClaw-only Step 3 (ao + API Key)

# --no-ao 降级方案
if [ "$PLATFORM" = "openclaw" ] && [ "${NO_AO:-0}" = "1" ]; then
  warn "--no-ao 已启用：跳过 agency-orchestrator 安装"
  warn "编排引擎不可用。地基约束层不受影响。"
  warn "降级方案：手动拆任务 → bash scripts/task-record.sh 逐条记录 → 手动闭环"
fi

# ════════════════════════════════════════
# Step 4: 创建目录 + 复制宪法文件
# ════════════════════════════════════════
info "Step 4/7 · 部署宪法文件 → $TARGET"

mkdir -p "$TARGET"

# OpenClaw: rules.md 统一部署到 skills/sofagent/（~/.openclaw/rules.md 留给用户自定义）
# 其他平台: rules.md 部署到 $TARGET/rules.md
if [ "$PLATFORM" = "openclaw" ]; then
  RULES_DST_DIR="${TARGET}/skills/sofagent"
  mkdir -p "$RULES_DST_DIR"
  RULES_DST="${RULES_DST_DIR}/rules.md"
  if [ -f "$RULES_SRC" ]; then
    if [ -f "$RULES_DST" ] && cmp -s "$RULES_SRC" "$RULES_DST" 2>/dev/null; then
      ok "rules.md — 已存在且内容相同，跳过（${RULES_DST_DIR}）"
    else
      [ -f "$RULES_DST" ] && cp "$RULES_DST" "${RULES_DST}.bak"
      cp "$RULES_SRC" "$RULES_DST"
      ok "rules.md — 已安装到 ${RULES_DST_DIR}"
    fi
  else
    err "rules.md — 源文件不存在: $RULES_SRC"
  fi
  # v0.73: 旧路径自动迁移——检测 constitution/rules.md → 迁移到新路径，删除旧目录
  OLD_RULES="${TARGET}/skills/sofagent/constitution/rules.md"
  if [ -f "$OLD_RULES" ]; then
    warn "检测到旧路径 constitution/rules.md，自动迁移到新路径 rules.md..."
    cp "$OLD_RULES" "$RULES_DST" 2>/dev/null && ok "已迁移到 ${RULES_DST}" || warn "迁移失败，请手动复制"
    rm -f "$OLD_RULES"
    rmdir "$(dirname "$OLD_RULES")" 2>/dev/null || true
    ok "旧 constitution/ 目录已清理"
  fi
  warn "~/.openclaw/rules.md 保留为用户自定义文件，不会被覆盖"
else
  # 非 OpenClaw 平台：宪法文件部署到 $TARGET 根
  for f in rules.md; do
    src="${SCRIPT_DIR}/../${f}"
    dst="${TARGET}/${f}"
    if [ -f "$src" ]; then
      if [ -f "$dst" ]; then
        if cmp -s "$src" "$dst" 2>/dev/null; then
          ok "$f — 已存在且内容相同，跳过"
        else
          warn "$f — 已有内容不同，已备份为 ${f}.bak → 覆盖更新"
          cp "$dst" "${dst}.bak"
          cp "$src" "$dst"
        fi
      else
        cp "$src" "$dst"
        ok "$f — 已安装"
      fi
    else
      err "$f — 源文件不存在: $src"
    fi
  done
fi

# ════════════════════════════════════════
# Step 5: 复制 Skill + 数据文件
# ════════════════════════════════════════
info "Step 5/7 · 部署 Skill 文件 → $TARGET/skills/sofagent"

SKILL_DST="${TARGET}/skills/sofagent"
mkdir -p "$SKILL_DST"

copied=0

# 核心 Skill 文件（从 sofagent/ 根目录复制）
for f in SKILL.md engine.md entry-gate.md task-aware.md task-closure.md loop-check.md; do
  src="${SCRIPT_DIR}/../${f}"
  dst="${SKILL_DST}/${f}"
  if [ -f "$src" ]; then
    if [ -f "$dst" ] && cmp -s "$src" "$dst" 2>/dev/null; then
      continue
    fi
    cp "$src" "$dst"
    ((copied++)) || true
  else
    warn "找不到 ${f}，跳过（源: $src）"
  fi
done

# 数据模板（从 sofagent/data/ 复制）
mkdir -p "${SKILL_DST}/data"
for f in "$SCRIPT_DIR"/../data/*.md; do
  [ -f "$f" ] || continue
  filename=$(basename "$f")
  dst="${SKILL_DST}/data/${filename}"
  if [ -f "$dst" ] && cmp -s "$f" "$dst" 2>/dev/null; then
    continue
  fi
  cp "$f" "$dst"
  ((copied++)) || true
done

# rules.md — 同时部署到 Skill 目录，使 SKILL.md 的相对路径可解析
RULES_DST="${SKILL_DST}/rules.md"
if [ -f "$RULES_SRC" ]; then
  if [ -f "$RULES_DST" ] && cmp -s "$RULES_SRC" "$RULES_DST" 2>/dev/null; then
    :  # 内容相同，跳过
  else
    cp "$RULES_SRC" "$RULES_DST"
    ((copied++)) || true
  fi
fi

if [ "$copied" -gt 0 ]; then
  ok "$copied 个 Skill/数据文件已部署到 $SKILL_DST"
else
  ok "Skill 文件全部就绪（无变更）"
fi

# ════════════════════════════════════════
# Step 5b: 部署配套脚本 + 数据目录（所有平台公共步骤）
# ════════════════════════════════════════
# P0-2/P0-3 修复：配套脚本部署和 .sofagent/ 数据目录创建不再限于 OpenClaw，
# 对所有平台（WorkBuddy / Claude / Codex / Hermes）均执行。

info "Step 5b/7 · 部署配套脚本 + 数据目录 → $TARGET"

# 部署配套脚本（task-record + task-orchestrate + cleanup + audit + compress-memory）
SCRIPTS_DST="${TARGET}/scripts"
mkdir -p "$SCRIPTS_DST"

for script in task-record.sh task-orchestrate.sh cleanup.sh audit.sh compress-memory.sh; do
  src="${SCRIPT_DIR}/${script}"
  dst="${SCRIPTS_DST}/${script}"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    chmod +x "$dst"
    ok "配套脚本已部署: $dst"
  else
    warn "找不到 ${script}，跳过"
  fi
done

# 部署共享配置加载器（lib/config.sh）
LIB_SRC="${SCRIPT_DIR}/lib/config.sh"
LIB_DST="${SCRIPTS_DST}/lib/config.sh"
if [ -f "$LIB_SRC" ]; then
  mkdir -p "$(dirname "$LIB_DST")"
  cp "$LIB_SRC" "$LIB_DST"
  ok "配置加载器已部署: $LIB_DST"
else
  warn "找不到 lib/config.sh，跳过"
fi

# 创建 .sofagent/ 数据目录（SOFAGENT_DATA 已在平台分支前统一初始化）
if [ ! -d "$SOFAGENT_DATA" ]; then
  mkdir -p "$SOFAGENT_DATA/task/logs" "$SOFAGENT_DATA/orchestrator/workflows"
  chmod 700 "$SOFAGENT_DATA" 2>/dev/null || true  # 权限加固：仅当前用户可访问
  ok "数据目录已创建: $SOFAGENT_DATA"
else
  ok "数据目录已存在: $SOFAGENT_DATA"
fi

# ════════════════════════════════════════
# Step 6: 部署加载链 Hook（仅 OpenClaw）
# ════════════════════════════════════════
if [ "$PLATFORM" = "openclaw" ]; then
info "Step 6/7 · 部署加载链 Hook（OpenClaw 2026.6.x 内部 hook 架构）..."

# OpenClaw 2026.6.x 改用声明式内部 hook：把 HOOK.md + handler.ts 放到
# ~/.openclaw/hooks/sofagent-load-chain/，并在 openclaw.json 的
# hooks.internal.entries.sofagent-load-chain 注册 enabled:true，即自动生效。
# 旧版 load-chain.sh（config.json.before_prompt_build shell hook）已废弃，不再部署。

HOOK_SRC_DIR="${SCRIPT_DIR}/../hooks/sofagent-load-chain"
HOOK_DST_DIR="${TARGET}/hooks/sofagent-load-chain"

if [ -d "$HOOK_SRC_DIR" ] && [ -f "${HOOK_SRC_DIR}/HOOK.md" ] && [ -f "${HOOK_SRC_DIR}/handler.ts" ]; then
  mkdir -p "$HOOK_DST_DIR"
  cp "${HOOK_SRC_DIR}/HOOK.md"   "${HOOK_DST_DIR}/HOOK.md"
  cp "${HOOK_SRC_DIR}/handler.ts" "${HOOK_DST_DIR}/handler.ts"
  ok "加载链内部 Hook 已部署: ${HOOK_DST_DIR}（HOOK.md + handler.ts）"

  # ── 在 openclaw.json 注册 hooks.internal.entries.sofagent-load-chain ──
  # 优先 OPENCLAW_CONFIG_PATH，其次 $TARGET/openclaw.json（2026.6.x 默认配置文件）
  HOOK_CONFIG=""
  for cfg in "${OPENCLAW_CONFIG_PATH:-}" "${TARGET}/openclaw.json"; do
    [ -n "$cfg" ] && [ -f "$cfg" ] && { HOOK_CONFIG="$cfg"; break; }
  done
  [ -z "$HOOK_CONFIG" ] && HOOK_CONFIG="${TARGET}/openclaw.json"

  # 检查是否已注册
  ALREADY_REGISTERED=0
  if [ -f "$HOOK_CONFIG" ] && grep -q '"sofagent-load-chain"' "$HOOK_CONFIG" 2>/dev/null; then
    ALREADY_REGISTERED=1
  fi

  if [ "$ALREADY_REGISTERED" = "1" ]; then
    ok "Hook 已注册: $HOOK_CONFIG"
  else
    info "正在注册 Hook → $HOOK_CONFIG"

    # P0-1 修复：确保配置文件存在且有有效 JSON，防止全新配置目录生成空 .tmp 后 mv 覆盖
    [ -f "$HOOK_CONFIG" ] || echo '{}' > "$HOOK_CONFIG"
    [ -s "$HOOK_CONFIG" ] || echo '{}' > "$HOOK_CONFIG"
    [ -f "$HOOK_CONFIG" ] && cp "$HOOK_CONFIG" "${HOOK_CONFIG}.bak" 2>/dev/null || true

    REGISTER_OK=0
    if command -v jq &>/dev/null; then
      # jq 合并 hooks.internal.entries.sofagent-load-chain = {enabled:true}
      # P0-1 修复：jq 输出后检查 .tmp 非空再 mv，避免空文件覆盖配置
      jq '.hooks.internal.enabled = ((.hooks.internal.enabled // false) or true) | .hooks.internal.entries = ((.hooks.internal.entries // {}) + {"sofagent-load-chain": {"enabled": true}})' \
        "$HOOK_CONFIG" > "${HOOK_CONFIG}.tmp" 2>/dev/null && \
      [ -s "${HOOK_CONFIG}.tmp" ] && mv "${HOOK_CONFIG}.tmp" "$HOOK_CONFIG" && REGISTER_OK=1 || \
      warn "jq 注册失败（配置已备份为 ${HOOK_CONFIG}.bak）"
    elif command -v node &>/dev/null; then
      CONFIG_PATH="$HOOK_CONFIG" node - << 'HOOK_INJECT'
const fs = require('fs');
const path = process.env.CONFIG_PATH;
let raw = '{}';
try { raw = fs.readFileSync(path, 'utf-8'); } catch(e) {}
let cfg = {};
try {
  const cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  cfg = JSON.parse(cleaned || '{}');
} catch(e) { cfg = {}; }
cfg.hooks = cfg.hooks || {};
cfg.hooks.internal = cfg.hooks.internal || {};
cfg.hooks.internal.enabled = true;
cfg.hooks.internal.entries = cfg.hooks.internal.entries || {};
cfg.hooks.internal.entries['sofagent-load-chain'] = { enabled: true };
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
HOOK_INJECT
      [ $? -eq 0 ] && REGISTER_OK=1 || warn "Node 注册失败（配置已备份为 ${HOOK_CONFIG}.bak）"
    else
      warn "jq 和 Node.js 均不可用——Hook 需要手动注册"
    fi

    if [ "$REGISTER_OK" = "1" ]; then
      ok "Hook 已自动注册（hooks.internal.entries.sofagent-load-chain）"
    else
      warn "请手动在 $HOOK_CONFIG 添加："
      warn '  {"hooks":{"internal":{"enabled":true,"entries":{"sofagent-load-chain":{"enabled":true}}}}}'
    fi
  fi
else
  warn "找不到 hook 源文件（$HOOK_SRC_DIR/HOOK.md 或 handler.ts），跳过部署"
  warn "  仓库结构异常？请从 https://github.com/KongFangXun/sofagent 重新拉取"
fi

fi  # end OpenClaw-only Step 6

# ════════════════════════════════════════
# Step 7: 注入 loopDetection 断路器配置（仅 OpenClaw）
# ════════════════════════════════════════
if [ "$PLATFORM" = "openclaw" ] && [ "${NO_CONFIG_INJECT:-0}" != "1" ]; then
info "Step 7/7 · 注入断路器配置..."

# 确定配置文件路径（优先 OPENCLAW_CONFIG_PATH，其次 $TARGET/config.json）
if [ -n "${OPENCLAW_CONFIG_PATH:-}" ]; then
  CONFIG_FILE="$OPENCLAW_CONFIG_PATH"
else
  CONFIG_FILE="${TARGET}/config.json"
fi

LOOPDETECT_BLOCK='{
  "tools": {
    "loopDetection": {
      "enabled": true,
      "historySize": 30,
      "warningThreshold": 10,
      "criticalThreshold": 20,
      "globalCircuitBreakerThreshold": 30,
      "detectors": {
        "genericRepeat": true,
        "knownPollNoProgress": true,
        "pingPong": true
      }
    }
  }
}'

# ── 函数：用 jq 合并 loopDetection ──
_inject_loopdetect() {
  local config="$1"

  # 检查 jq 是否可用
  if ! command -v jq &>/dev/null; then
    warn "jq 未安装，尝试用 Node.js 注入..."
    if command -v node &>/dev/null; then
      # 备份
      if [ -f "$config" ]; then cp "$config" "${config}.bak"; fi
      # 用 heredoc 传脚本，零转义问题
      CONFIG_PATH="$config" NODE_INJECT_BLOCK="$LOOPDETECT_BLOCK" node - << 'NODE_INJECT'
const fs = require('fs');
const path = process.env.CONFIG_PATH;
const loopBlock = JSON.parse(process.env.NODE_INJECT_BLOCK);
let raw = '{}';
try { raw = fs.readFileSync(path, 'utf-8'); } catch(e) {}
let cfg = {};
try {
  const cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/.*$/gm, '')            // line comments
    .replace(/,(\s*[}\]])/g, '$1');      // trailing commas
  cfg = JSON.parse(cleaned || '{}');
} catch(e) { cfg = {}; }
cfg.tools = Object.assign(cfg.tools || {}, loopBlock.tools);
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
NODE_INJECT
      if [ $? -eq 0 ]; then return 0; else return 1; fi
    else
      return 1
    fi
  fi

  # 备份原文件
  if [ -f "$config" ]; then
    cp "$config" "${config}.bak"
    # 合并：已有配置为基础，loopDetection 叠加
    jq '. * '"$LOOPDETECT_BLOCK"'' "$config" > "${config}.tmp" 2>/dev/null || {
      warn "配置文件格式异常，已备份为 ${config}.bak"
      # 格式损坏 → 用 loopDetection 配置单独覆盖
      echo "$LOOPDETECT_BLOCK" | jq '.' > "${config}.tmp" 2>/dev/null || return 1
    }
  else
    # 新建文件
    echo "$LOOPDETECT_BLOCK" | jq '.' > "${config}.tmp" 2>/dev/null || return 1
  fi

  mv "${config}.tmp" "$config"
  return 0
}

# ── 主逻辑 ──
if [ -f "$CONFIG_FILE" ] && grep -q 'loopDetection' "$CONFIG_FILE" 2>/dev/null; then
  ok "loopDetection 配置已存在，跳过"
  _log "loopdetect: already configured"
else
  if _inject_loopdetect "$CONFIG_FILE"; then
    ok "loopDetection 安全配置已生效"
    _log "loopdetect: injected into $CONFIG_FILE"
  else
    warn "loopDetection 注入失败"
    warn "请手动将以下配置写入 $CONFIG_FILE："
    warn "  https://docs.openclaw.ai/zh-CN/gateway/config-tools"
  fi
fi

fi  # end OpenClaw-only Step 7

# ════════════════════════════════════════
# 手动平台：输出 + 自动写入种子指令
# ════════════════════════════════════════
if [ "$PLATFORM" = "claude" ] || [ "$PLATFORM" = "codex" ] || [ "$PLATFORM" = "hermes" ]; then

  # P1-5: 按平台确定种子指令目标文件和内容
  SEED_FILE=""
  SEED_PLATFORM_LABEL=""
  case "$PLATFORM" in
    claude)
      SEED_FILE="$HOME/.claude/CLAUDE.md"
      SEED_PLATFORM_LABEL="~/.claude/rules.md"
      ;;
    codex)
      SEED_FILE="$HOME/.codex/AGENTS.md"
      SEED_PLATFORM_LABEL="~/.codex/rules.md"
      ;;
    hermes)
      SEED_FILE="$HOME/.hermes/SOUL.md"
      SEED_PLATFORM_LABEL="~/.hermes/rules.md"
      ;;
  esac

  SEED_CONTENT="每次对话开始时，读取以下文件并执行 sofagent 入口流程：
1. rules.md：${SEED_PLATFORM_LABEL}（宪法已在 SKILL.md 内联）
2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思
如果数据文件（.sofagent/）不存在，先创建空模板。"

  # P1-5: 自动写入种子指令（查重：已含 sofagent 则跳过）
  if [ -f "$SEED_FILE" ] && grep -q 'sofagent' "$SEED_FILE" 2>/dev/null; then
    ok "种子指令已存在于 ${SEED_FILE}，跳过写入"
  else
    mkdir -p "$(dirname "$SEED_FILE")"
    echo "" >> "$SEED_FILE"
    echo "$SEED_CONTENT" >> "$SEED_FILE"
    ok "种子指令已自动写入 $SEED_FILE"
  fi

  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║  📋 种子指令已自动写入配置文件            ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""

  echo "  目标文件：$SEED_FILE"
  echo ""
  echo "  ── 写入内容 ──"
  echo ""
  echo "  每次对话开始时，读取以下文件并执行 sofagent 入口流程："
  echo "  1. rules.md：${SEED_PLATFORM_LABEL}（宪法已在 SKILL.md 内联）"
  echo "  2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思"
  echo "  如果数据文件（.sofagent/）不存在，先创建空模板。"
  echo ""
  echo "  💡 在下一轮对话中回复「sofagent」验证是否加载成功。"
  echo ""
fi

# ════════════════════════════════════════
# 安装完成 · 使用说明（按平台）
# ════════════════════════════════════════
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  sofagent · 安装完成！                  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

case "$PLATFORM" in
  openclaw)
    echo "  已部署文件："
    echo "    宪法文件:      $TARGET/skills/sofagent/rules.md（宪法内联在 SKILL.md）"
    echo "    Skill 文件:     $TARGET/skills/sofagent/（6 核心 + 4 数据模板）"
    echo "    加载链 Hook:    $TARGET/hooks/sofagent-load-chain/（HOOK.md + handler.ts）"
    echo "    配套脚本:       $TARGET/scripts/{task-record,task-orchestrate,cleanup,audit,compress-memory}.sh"
    echo "    断路器:         ${CONFIG_FILE:-未配置}（tools.loopDetection）"
    echo "    数据目录:       $SOFAGENT_DATA"
    echo ""
    echo "  ┌──────────────────────────────────────────┐"
    echo "  │  OpenClaw: 完整就绪                       │"
    echo "  │  三层加载链自动注入 + Hook 强制加载        │"
    echo "  │  + 编排引擎 + 脚本 + 断路器，全部可用      │"
    echo "  └──────────────────────────────────────────┘"
    ;;
  claude|codex|hermes)
    echo "  已部署文件："
    echo "    宪法文件:      $TARGET/rules.md（宪法内联在 SKILL.md）"
    echo "    数据目录:       $SOFAGENT_DATA"
    echo ""
    echo "  ⚠️  ${PLATFORM} 是手动平台——请复制上方种子指令到配置文件。"
    echo ""
    echo "  ┌──────────────────────────────────────────┐"
    echo "  │  ${PLATFORM}: 仅基础约束生效              │"
    echo "  │  SKILL.md 底线+铁律有效；Hook/编排不可用   │"
    echo "  └──────────────────────────────────────────┘"
    ;;
  workbuddy)
    echo "  已部署文件："
    echo "    Skill 文件:     $TARGET/skills/sofagent/（6 核心 + 4 数据模板）"
    echo "    数据目录:       $SOFAGENT_DATA"
    echo ""
    echo "  ┌──────────────────────────────────────────┐"
    echo "  │  WorkBuddy: 仅基础约束生效                │"
    echo "  │  Skill 系统加载底线+铁律；脚本沙箱受限     │"
    echo "  └──────────────────────────────────────────┘"
    ;;
esac
echo ""

# API Key 提醒（OpenClaw 才有 AO）
if [ "$PLATFORM" = "openclaw" ]; then

# --no-config-inject 警告
if [ "${NO_CONFIG_INJECT:-0}" = "1" ]; then
  echo "  ⚠️  --no-config-inject 已启用：未注入断路器配置，需手动配置 tools.loopDetection"
fi
if command -v ao &>/dev/null && [ -z "${DEEPSEEK_API_KEY:-}${ANTHROPIC_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  echo "  🔑 配置 AO API Key（这是你已有的 LLM Key，三选一）："
  echo "     export DEEPSEEK_API_KEY=你的DeepSeek密钥"
  echo "     export ANTHROPIC_API_KEY=你的Claude密钥"
  echo "     export OPENAI_API_KEY=你的OpenAI密钥"
  echo "     写入 ~/.zshrc 永久生效"
  echo ""
fi

# 加载链状态提示（仅 OpenClaw）
if [ -f "${HOOK_CONFIG:-}" ] && grep -q '"sofagent-load-chain"' "$HOOK_CONFIG" 2>/dev/null; then
  echo "  ✅ Hook 已自动注册（openclaw.json）→ 每次启动自动注入约束"
else
  echo "  ⚠️  Hook 未注册 → 约束层不会自动加载"
  echo "     在 ${HOOK_CONFIG} 的 hooks.internal.entries 添加："
  echo '     {"sofagent-load-chain":{"enabled":true}}'
fi
echo "  💡 运行 verify.sh 验证安装是否完整。"
fi  # end OpenClaw-only status

# ── Step 6b: daemon 可选安装 ──
OS_TYPE="$(uname -s)"
DAEMON_INSTALL_SCRIPT="${SCRIPT_DIR}/daemon-install.sh"
if [ "${REMOTE_MODE:-0}" = "1" ]; then
  DAEMON_INSTALL_SCRIPT="${REMOTE_TMP}/sofagent/scripts/daemon-install.sh"
fi

if [ -f "$DAEMON_INSTALL_SCRIPT" ] && [ -x "$DAEMON_INSTALL_SCRIPT" ]; then
  case "$OS_TYPE" in
    Darwin|Linux)
      # --quick / CI 环境：跳过 daemon 安装（不交互）
      if [ "$QUICK_MODE" = "1" ]; then
        echo ""
        echo "  ⏭️  --quick 模式：跳过 daemon 安装"
        echo "  （以后可以手动运行: bash sofagent/scripts/daemon-install.sh）"
      else
        echo ""
        echo "  ┌──────────────────────────────────────────┐"
        echo "  │  Step 6b: daemon 后台进程（可选）          │"
        echo "  └──────────────────────────────────────────┘"
        echo ""
        echo "  daemon 是一个轻量后台进程，监控 think.md / rules.md 变化。"
        echo "  macOS (launchd) / Linux (systemd) 支持，Windows 自动跳过。"
        echo ""
        echo "  是否安装 daemon？[y/N] "
        read -r INSTALL_DAEMON
        if [ "${INSTALL_DAEMON:-n}" = "y" ] || [ "${INSTALL_DAEMON:-n}" = "Y" ]; then
          bash "$DAEMON_INSTALL_SCRIPT"
        else
          echo "  已跳过 daemon 安装（以后可以手动运行: bash sofagent/scripts/daemon-install.sh）"
        fi
      fi
      ;;
    *)
      echo ""
      echo "  daemon 不支持此系统 ($OS_TYPE)，自动跳过。"
      echo "  Windows 用户：宪法层约束正常生效，daemon 后台监控跳过。"
      ;;
  esac
else
  echo ""
  echo "  daemon-install.sh 未找到，跳过 daemon 安装。"
fi

echo ""

# ── 审计：安装完成 ──
bash "${SCRIPT_DIR}/audit.sh" --operation "install" --target "完成" --result "成功" 2>/dev/null || true

# 写入安装日志摘要
_log "install complete: constitution=1(rules) skills=6 hook=1 loopdetect=1"
_log "install log saved to $INSTALL_LOG"
