#!/bin/bash
# ============================================================
# sofagent install.sh · 多平台一键安装脚本
# ============================================================
# 将 sofagent 约束层部署到目标平台，让 Agent 获得治理能力。
# 由 DeepSeek V4 Pro 辅助生成。
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
VERSION="1.0.0"

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

# ── 欢迎 ──
echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║   sofagent Harness · installer   ║"
echo "  ╚═══════════════════════════════════╝"
echo ""

# ════════════════════════════════════════
# Step 1: 确定平台和目标路径
# ════════════════════════════════════════
info "Step 1/7 · 确定安装平台..."

# ── 参数解析 ──
PLATFORM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)     PLATFORM="$2"; shift 2 ;;
    --platform=*)   PLATFORM="${1#*=}"; shift ;;
    --no-ao)         NO_AO=1; shift ;;
    --no-config-inject) NO_CONFIG_INJECT=1; shift ;;
    -h|--help)
      echo "用法: install.sh [--platform openclaw|workbuddy|claude|codex|hermes]"
      echo ""
      echo "平台说明："
      echo "  openclaw  完整部署（宪法 + Hook + 脚本 + 断路器）→ ~/.openclaw/"
      echo "  workbuddy 检查 .sofagent/ 数据目录 + 运行 verify.sh"
      echo "  claude    部署宪法 → ~/.claude/ + 输出种子指令（需手动粘贴到 CLAUDE.md）"
      echo "  codex     部署宪法 → ~/.codex/ + 输出种子指令（需手动粘贴到 AGENTS.md）"
      echo "  hermes    部署宪法 → ~/.hermes/ + 输出种子指令（需手动粘贴到 SOUL.md）"
      echo "  --no-ao             跳过 agency-orchestrator 全局安装（企业环境用）"
      echo "  --no-config-inject  跳过自动注入 OpenClaw config.json（企业环境用）"
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

# ── 按平台确定目标路径 ──
case "$PLATFORM" in
  openclaw) TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
  workbuddy)
    ok "WorkBuddy 平台——部署 Skill 文件并验证数据目录。"
    TARGET="$HOME/.workbuddy"
    # 检查 .sofagent/ 数据目录
    SOFAGENT_DATA="${PWD}/.sofagent"
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

CONSTITUTION_SRC="${SCRIPT_DIR}/../constitution"

# 检查源文件
if [ ! -d "$CONSTITUTION_SRC" ]; then
  err "找不到 constitution/ 目录。请在 sofagent 项目根目录下运行此脚本。"
  err "  当前脚本位置: $SCRIPT_DIR"
  err "  期望目录: $CONSTITUTION_SRC"
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
    warn "  npm install -g 可能需要 sudo。考虑使用 nvm 或更改 npm prefix："
    warn "  https://docs.npmjs.com/resolving-eacces-permissions-errors"
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
    npm install -g agency-orchestrator 2>&1 | tail -1 || \
      npm install -g agency-orchestrator --registry=https://registry.npmmirror.com 2>&1 | tail -1
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

# 宪法文件
for f in sofagent.md rules.md; do
  src="${CONSTITUTION_SRC}/${f}"
  dst="${TARGET}/${f}"
  if [ -f "$src" ]; then
    if [ -f "$dst" ]; then
      # 已有文件，对比是否相同
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

# ════════════════════════════════════════
# Step 5: 复制 Skill + 数据文件
# ════════════════════════════════════════
info "Step 5/7 · 部署 Skill 文件 → $TARGET/skills/sofagent"

SKILL_DST="${TARGET}/skills/sofagent"
mkdir -p "$SKILL_DST"

copied=0

# 核心 Skill 文件（从 sofagent/ 根目录复制）
for f in SKILL.md engine.md entry-gate.md task-aware.md task-closure.md loop-agent.md; do
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

if [ "$copied" -gt 0 ]; then
  ok "$copied 个 Skill/数据文件已部署到 $SKILL_DST"
else
  ok "Skill 文件全部就绪（无变更）"
fi

# ════════════════════════════════════════
# Step 6: 部署加载链 Hook（仅 OpenClaw）
# ════════════════════════════════════════
if [ "$PLATFORM" = "openclaw" ]; then
info "Step 6/7 · 部署加载链 Hook（OpenClaw）..."

# 部署 load-chain.sh
mkdir -p "${TARGET}/hooks"
LOADCHAIN_SRC="${SCRIPT_DIR}/load-chain.sh"
LOADCHAIN_DST="${TARGET}/hooks/load-chain.sh"

if [ -f "$LOADCHAIN_SRC" ]; then
  cp "$LOADCHAIN_SRC" "$LOADCHAIN_DST"
  chmod +x "$LOADCHAIN_DST"
  ok "加载链 Hook 已部署: $LOADCHAIN_DST"

  # ── 自动注册 Hook ──
  # 确定配置路径（优先 OPENCLAW_CONFIG_PATH，其次 TARGET/config.json，再试 WorkBuddy）
  HOOK_CONFIG=""
  for cfg in "${OPENCLAW_CONFIG_PATH:-}" "${TARGET}/config.json" "$HOME/.workbuddy/config.json"; do
    [ -n "$cfg" ] && [ -f "$cfg" ] && { HOOK_CONFIG="$cfg"; break; }
  done
  [ -z "$HOOK_CONFIG" ] && HOOK_CONFIG="${TARGET}/config.json"

  # 检查是否已注册
  if [ -f "$HOOK_CONFIG" ] && grep -q "$LOADCHAIN_DST" "$HOOK_CONFIG" 2>/dev/null; then
    ok "Hook 已注册: $HOOK_CONFIG"
  else
    info "正在注册 Hook → $HOOK_CONFIG"
    cp "$HOOK_CONFIG" "${HOOK_CONFIG}.bak" 2>/dev/null || true

    if command -v jq &>/dev/null; then
      # jq 合并 hooks.before_prompt_build
      jq \
        --arg cmd "$LOADCHAIN_DST" \
        '.hooks.before_prompt_build = ((.hooks.before_prompt_build // []) + [{type: "shell", command: $cmd}])' \
        "$HOOK_CONFIG" > "${HOOK_CONFIG}.tmp" 2>/dev/null && \
      mv "${HOOK_CONFIG}.tmp" "$HOOK_CONFIG" && \
      ok "Hook 已自动注册" || \
      warn "Hook 自动注册失败，请手动添加（配置已备份为 ${HOOK_CONFIG}.bak）"
    elif command -v node &>/dev/null; then
      CONFIG_PATH="$HOOK_CONFIG" LOADCHAIN_CMD="$LOADCHAIN_DST" node - << 'HOOK_INJECT'
const fs = require('fs');
const path = process.env.CONFIG_PATH;
const cmd = process.env.LOADCHAIN_CMD;
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
cfg.hooks.before_prompt_build = cfg.hooks.before_prompt_build || [];
cfg.hooks.before_prompt_build.push({type: 'shell', command: cmd});
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
HOOK_INJECT
      if [ $? -eq 0 ]; then
        ok "Hook 已自动注册（Node.js）"
      else
        warn "Hook 自动注册失败，请手动添加（配置已备份为 ${HOOK_CONFIG}.bak）"
      fi
    else
      warn "jq 和 Node.js 均不可用——Hook 需要手动注册"
      warn "  将以下内容添加到 $HOOK_CONFIG 的 hooks.before_prompt_build："
      warn "  {\"type\": \"shell\", \"command\": \"$LOADCHAIN_DST\"}"
    fi
  fi
else
  warn "找不到 load-chain.sh，跳过。加载链需要手动部署: $LOADCHAIN_SRC"
fi

# 部署配套脚本（task-log + task-orchestrate）
SCRIPTS_DST="${TARGET}/scripts"
mkdir -p "$SCRIPTS_DST"

for script in task-record.sh task-orchestrate.sh; do
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

# 创建 .sofagent/ 数据目录
SOFAGENT_DATA="${PWD}/.sofagent"
if [ ! -d "$SOFAGENT_DATA" ]; then
  mkdir -p "$SOFAGENT_DATA/task/logs" "$SOFAGENT_DATA/orchestrator/workflows"
  chmod 700 "$SOFAGENT_DATA" 2>/dev/null || true  # 权限加固：仅当前用户可访问
  ok "数据目录已创建: $SOFAGENT_DATA"
else
  ok "数据目录已存在: $SOFAGENT_DATA"
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
# 手动平台：输出种子指令
# ════════════════════════════════════════
if [ "$PLATFORM" = "claude" ] || [ "$PLATFORM" = "codex" ] || [ "$PLATFORM" = "hermes" ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║  📋 请手动粘贴以下种子指令到配置文件      ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""

  case "$PLATFORM" in
    claude)
      echo "  目标文件：项目根目录或 ~/.claude/CLAUDE.md"
      echo ""
      echo "  ── 复制以下内容 ──"
      echo ""
      echo "  每次对话开始时，读取以下文件并执行 sofagent 入口流程："
      echo "  1. 宪法文件：~/.claude/sofagent.md ~/.claude/rules.md"
      echo "  2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思"
      echo "  如果数据文件（.sofagent/）不存在，先创建空模板。"
      ;;
    codex)
      echo "  目标文件：项目根目录 AGENTS.md"
      echo ""
      echo "  ── 复制以下内容 ──"
      echo ""
      echo "  每次对话开始时，读取以下文件并执行 sofagent 入口流程："
      echo "  1. 宪法文件：~/.codex/sofagent.md ~/.codex/rules.md"
      echo "  2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思"
      echo "  如果数据文件（.sofagent/）不存在，先创建空模板。"
      ;;
    hermes)
      echo "  目标文件：~/.hermes/SOUL.md（在现有内容末尾追加）"
      echo ""
      echo "  ── 复制以下内容 ──"
      echo ""
      echo "  每次对话开始时，读取以下文件并执行 sofagent 入口流程："
      echo "  1. 宪法文件：~/.hermes/sofagent.md ~/.hermes/rules.md"
      echo "  2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思"
      echo "  如果数据文件（.sofagent/）不存在，先创建空模板。"
      ;;
  esac
  echo ""
  echo "  💡 粘贴后在下一轮对话中回复「sofagent」验证是否加载成功。"
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
    echo "    宪法文件:      $TARGET/{sofagent,rules}.md"
    echo "    Skill 文件:     $TARGET/skills/sofagent/（6 核心 + 4 数据模板）"
    echo "    加载链 Hook:    $TARGET/hooks/load-chain.sh"
    echo "    配套脚本:       $TARGET/scripts/{task-record,task-orchestrate}.sh"
    echo "    断路器:         ${CONFIG_FILE:-未配置}（tools.loopDetection）"
    echo "    数据目录:       $SOFAGENT_DATA"
    ;;
  claude|codex|hermes)
    echo "  已部署文件："
    echo "    宪法文件:      $TARGET/{sofagent,rules}.md"
    echo "    数据目录:       $SOFAGENT_DATA"
    echo ""
    echo "  ⚠️  ${PLATFORM} 是手动平台——请复制上方种子指令到配置文件。"
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
  echo "  🔑 配置 AO API Key（这是你已有的 LLM Key，不是新的）："
  echo "     export DEEPSEEK_API_KEY=你的DeepSeek密钥"
  echo "     写入 ~/.zshrc 永久生效"
  echo ""
fi

# 加载链状态提示（仅 OpenClaw）
if [ -f "${HOOK_CONFIG:-}" ] && grep -q "$LOADCHAIN_DST" "$HOOK_CONFIG" 2>/dev/null; then
  echo "  ✅ Hook 已自动注册 → 每次启动自动注入约束"
else
  echo "  ⚠️  Hook 未注册 → 约束层不会自动加载"
  echo "     将以下行加入 ${HOOK_CONFIG} 的 hooks.before_prompt_build："
  echo "     {\"type\": \"shell\", \"command\": \"$LOADCHAIN_DST\"}"
fi
echo "  💡 运行 verify.sh 验证安装是否完整。"
fi  # end OpenClaw-only status

echo ""

# 写入安装日志摘要
_log "install complete: constitution=2 skills=6 hook=1 loopdetect=1"
_log "install log saved to $INSTALL_LOG"
