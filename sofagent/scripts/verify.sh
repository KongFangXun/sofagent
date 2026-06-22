#!/bin/bash
# ============================================================
# sofagent verify.sh · 装后验证脚本
# ============================================================
# 验证 sofagent 安装完整性（9 个检查类别，24+ 项）
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 用法：
#   verify.sh           彩色终端输出
#   verify.sh --json     JSON 机器可读输出（CI/CD）
#   verify.sh --quiet   只显示失败和警告项
#   verify.sh --quick   快速模式——仅 4 项核心检查，5 秒出结果
#   verify.sh --help    显示此帮助
# ============================================================

# set -u: 未定义变量引用视为错误（无 -e，因为验证脚本需收集所有失败项后再 exit 1）
# set -o pipefail: 管道中任一命令失败都计为失败
set -uo pipefail
VERSION="0.83"
# ── 临时文件清理（当前脚本不创建临时文件，预留用于将来扩展）──
cleanup() { [ -n "${TMP_FILE:-}" ] && rm -f "$TMP_FILE" 2>/dev/null; }
trap cleanup EXIT

# ── 参数解析 ──
JSON_MODE=false
QUIET_MODE=false
QUICK_MODE=false
PLATFORM=""
for arg in "$@"; do
  case "$arg" in
    --json)  JSON_MODE=true ;;
    --quiet) QUIET_MODE=true ;;
    --quick) QUICK_MODE=true ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --platform=*) PLATFORM="${arg#*=}" ;;
    --help)
      echo "sofagent verify v${VERSION}"
      echo "  正常模式 彩色终端，显示所有检查项"
      echo "  --json   JSON 机器可读输出（CI/CD 用）"
      echo "  --quiet  只输出失败和警告，全通过时静默"
      echo "  --quick  快速模式——仅 4 项核心检查（SKILL.md / .sofagent/ / ao compose / rules.md）"
      echo "  --help   显示此帮助"
      echo "退出码: 0=全部通过 1=存在失败项"
      exit 0
      ;;
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
  else                                   PLATFORM="openclaw"
  fi
fi

# ── 按平台确定目标路径 ──
case "$PLATFORM" in
  openclaw) TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
  workbuddy) TARGET="" ;;  # 工作区数据目录，不做系统级检查
  claude)   TARGET="$HOME/.claude" ;;
  codex)    TARGET="$HOME/.codex" ;;
  hermes)   TARGET="$HOME/.hermes" ;;
  *)        TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
esac

OPENCLAW_DIR="$TARGET"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

pass=0; fail=0; warn_count=0

# ── 输出函数 ──
if [ "$JSON_MODE" = true ]; then
  _json_items=""
  _json_comma() { if [ -n "$_json_items" ]; then _json_items+=","; fi; }
  check_pass() { if [ -n "$_json_items" ]; then _json_items+=","; fi; _json_items+="{\"status\":\"pass\",\"item\":\"$1\"}"; ((pass++)) || true; }
  check_fail() { if [ -n "$_json_items" ]; then _json_items+=","; fi; _json_items+="{\"status\":\"fail\",\"item\":\"$1\"}"; ((fail++)) || true; }
  check_warn() { if [ -n "$_json_items" ]; then _json_items+=","; fi; _json_items+="{\"status\":\"warn\",\"item\":\"$1\"}"; ((warn_count++)) || true; }
  _banner() { :; }
  _section() { :; }
  _hr()   { :; }
elif [ "$QUIET_MODE" = true ]; then
  check_pass() { ((pass++)) || true; }
  check_fail() { echo -e "  ${RED}✗${NC} $1"; ((fail++)) || true; }
  check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((warn_count++)) || true; }
  _banner() { :; }
  _section() { :; }
  _hr()   { :; }
else
  check_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((pass++)) || true; }
  check_fail() { echo -e "  ${RED}✗${NC} $1"; ((fail++)) || true; }
  check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((warn_count++)) || true; }
  _banner() {
    echo ""; echo "  ╔═══════════════════════════════════╗"
    echo "  ║   sofagent · verify              ║"
    echo "  ╚═══════════════════════════════════╝"; echo ""
  }
  _section() { echo "── $1 ──"; }
  _hr()   { echo ""; }
fi

# ── 路径（已由平台探测设置）──
# OPENCLAW_DIR 已在上方按平台赋值

if [ "$JSON_MODE" = false ]; then
  _banner
  if [ "$QUIET_MODE" = false ]; then
    echo "  平台: $PLATFORM | 目标: ${TARGET:-工作区}"
  fi
  _hr
fi

# ════════════════════════════════════════
# --quick 模式：仅 4 项核心检查，结束后直接输出总结
# ════════════════════════════════════════
if [ "$QUICK_MODE" = true ]; then
  [ "$JSON_MODE" = false ] && [ "$QUIET_MODE" = false ] && echo "  ⚡ 快速模式 — 4 项核心检查"
  [ "$JSON_MODE" = false ] && _hr

  # 1. SKILL.md 存在且含 4 底线 + 10 铁律关键词
  SKILL_QUICK="${OPENCLAW_DIR:-$HOME/.openclaw}/skills/sofagent/SKILL.md"
  if [ -f "$SKILL_QUICK" ] && grep -q "4.*底线\|10.*铁律" "$SKILL_QUICK" 2>/dev/null; then
    check_pass "SKILL.md 存在且含宪法（4底线+10铁律）"
  else
    check_fail "SKILL.md 缺失或宪法关键词不全"
  fi

  # 2. .sofagent/ 数据目录存在
  if [ -d "${PWD}/.sofagent" ]; then
    check_pass ".sofagent/ 数据目录存在"
  else
    check_warn ".sofagent/ 数据目录不存在（首次使用会自动创建）"
  fi

  # 3. ao compose 可用（或标注降级）
  if command -v ao &>/dev/null; then
    AO_VER=$(ao --version 2>/dev/null || echo "unknown")
    check_pass "ao compose 可用 — v${AO_VER}"
  else
    check_warn "ao compose 不可用——编排引擎降级为默认编排"
  fi

  # 4. rules.md 可读
  RULES_QUICK=""
  for c in \
    "${OPENCLAW_DIR:-$HOME/.openclaw}/skills/sofagent/rules.md" \
    "${HOME}/.workbuddy/skills/sofagent/rules.md" \
    "${HOME}/.openclaw/rules.md"; do
    [ -f "$c" ] && { RULES_QUICK="$c"; break; }
  done
  if [ -n "$RULES_QUICK" ] && [ -r "$RULES_QUICK" ]; then
    check_pass "rules.md 可读 — ${RULES_QUICK}"
  else
    check_warn "rules.md 未找到或不可读（未配置自定义规则）"
  fi

  # 输出总结并退出
  total=$((pass + fail + warn_count))
  if [ "$JSON_MODE" = true ]; then
    cat << JSONEOF
{
  "summary": {
    "pass": ${pass},
    "warn": ${warn_count},
    "fail": ${fail},
    "total": ${total}
  },
  "checks": [${_json_items}]
}
JSONEOF
  else
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${fail} 失败${NC}（共 ${total} 项）"
    echo ""
    if [ "$fail" -eq 0 ]; then
      echo "  ✅ quick 模式通过！运行 verify.sh（无 --quick）获取完整检查。"
    else
      echo "  ❌ 发现 ${fail} 项失败。请先运行 install.sh 修复。"
      exit 1
    fi
  fi
  exit 0
fi

# WorkBuddy 平台：做专属检查后直接结束
if [ "$PLATFORM" = "workbuddy" ]; then
  check_pass "WorkBuddy 平台——宪法/Hook/断路器由 SKILL.md 入口流程管理"

  # WorkBuddy 专属检查（v0.62：宪法内联在 SKILL.md，检查 SKILL.md 而非 sofagent.md）
  if [ -f "$HOME/.workbuddy/skills/sofagent/SKILL.md" ] && [ -s "$HOME/.workbuddy/skills/sofagent/SKILL.md" ]; then
    if grep -q "4 底线\|10 铁律" "$HOME/.workbuddy/skills/sofagent/SKILL.md" 2>/dev/null; then
      check_pass "SKILL.md 已部署且含宪法（4底线+10铁律内联）"
    else
      check_warn "SKILL.md 已部署但宪法内容缺失"
    fi
  else
    check_warn "SKILL.md 未部署到 ~/.workbuddy/skills/sofagent/"
  fi

  if [ -f "$HOME/.workbuddy/rules.md" ] && [ -s "$HOME/.workbuddy/rules.md" ]; then
    chars=$(wc -m < "$HOME/.workbuddy/rules.md" | tr -d ' ')
    check_pass "rules.md 已部署（${chars} 字符）"
  else
    check_warn "rules.md 未部署到 ~/.workbuddy/"
  fi

  if [ -d "$HOME/.workbuddy/skills/sofagent" ]; then
    count=$(ls -1 "$HOME/.workbuddy/skills/sofagent"/*.md 2>/dev/null | wc -l | tr -d ' ')
    check_pass "Skills 目录已部署（${count} 个 .md 文件）"
  else
    check_warn "Skills 目录不存在"
  fi

  # 数据目录检查
  if [ -d "${PWD}/.sofagent" ]; then
    check_pass ".sofagent/ 数据目录存在"
  else
    check_warn ".sofagent/ 数据目录不存在（首次使用会自动创建）"
  fi

  # 输出总结并退出
  total=$((pass + fail + warn_count))
  if [ "$JSON_MODE" = true ]; then
    cat << JSONEOF
{
  "summary": {
    "pass": ${pass},
    "warn": ${warn_count},
    "fail": ${fail},
    "total": ${total}
  },
  "checks": [${_json_items}]
}
JSONEOF
  else
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${fail} 失败${NC}（共 ${total} 项）"
    echo ""
    if [ "$fail" -eq 0 ]; then
      echo "  ✅ sofagent WorkBuddy 部署验证通过！"
      echo ""
      echo "  下一步:"
      echo "    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）"
      echo "    2. 试用 /goal 命令开始第一个任务"
    else
      echo "  ❌ 发现 ${fail} 项失败。请先运行 install.sh 修复。"
      exit 1
    fi
  fi
  exit 0
fi

_section "宪法文件（v0.62：宪法内联在 SKILL.md，此处只检查 rules.md）"

for f in rules.md; do
  # v0.73: rules.md 部署到 skills/sofagent/rules.md（扁平化）
  path="${OPENCLAW_DIR}/skills/sofagent/${f}"
  if [ ! -f "$path" ]; then
    path="${OPENCLAW_DIR}/${f}"  # 兼容旧版安装路径
  fi
  if [ -f "$path" ] && [ -s "$path" ]; then
    chars=$(wc -m < "$path" | tr -d ' ')
    lines=$(wc -l < "$path" | tr -d ' ')
    check_pass "$f ($chars 字符, $lines 行)"
    # 权限检查：宪法文件不应 world-writable
    perms=$(stat -f '%Lp' "$path" 2>/dev/null | tr -d '\n' || stat -c '%a' "$path" 2>/dev/null || echo "???")
    if [ "${perms: -1}" = "7" ] || [ "${perms: -1}" = "6" ] || [ "${perms: -1}" = "3" ] || [ "${perms: -1}" = "2" ]; then
      check_warn "$f 权限过于宽松 (${perms})，建议 chmod 644"
    fi
    # 500 字原则（Handbook §二）
    if [ "$chars" -gt 1200 ]; then
      check_warn "$f 超过 1200 字符（${chars}），宪法层因含 10 条铁律 + 4 条底线，阈值放宽至 1200"
    fi
  else
    check_fail "$f — 缺失或为空"
  fi
done

_hr
_section "Skill 文件"

SKILLS_DIR="${OPENCLAW_DIR}/skills"
if [ -d "$SKILLS_DIR" ]; then
  skill_count=$(ls -1 "$SKILLS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
  check_pass "Skills 目录存在: ${skill_count} 个 .md 文件"
else
  check_fail "Skills 目录不存在: $SKILLS_DIR"
fi

_hr
_section "配套脚本"

SCRIPTS_DIR="${OPENCLAW_DIR}/scripts"
if [ -d "$SCRIPTS_DIR" ]; then
  script_count=$(ls -1 "$SCRIPTS_DIR"/*.sh 2>/dev/null | wc -l | tr -d ' ')
  check_pass "scripts/ 目录存在: ${script_count} 个 .sh 文件"
  for s in task-record.sh task-orchestrate.sh; do
    if [ -f "${SCRIPTS_DIR}/${s}" ] && [ -x "${SCRIPTS_DIR}/${s}" ]; then
      check_pass "  ${s} 已部署且可执行"
    else
      check_warn "  ${s} 缺失或不可执行"
    fi
  done
else
  check_warn "scripts/ 目录不存在，部分功能可能不可用"
fi

_hr
_section "加载链 Hook（2026.6.x 内部 hook）"

# Hook 检查仅对 OpenClaw 平台生效——其他平台（WorkBuddy/Claude/Codex/Hermes）
# 靠 skill 系统加载或种子指令，不部署内部 hook，检查了只会误报。
if [ "$PLATFORM" != "openclaw" ]; then
  check_pass "${PLATFORM} 平台无需内部 hook（靠 skill 系统 / 种子指令加载）"
else
  # 新架构：声明式内部 hook。检查目录文件 + openclaw.json 注册，不再直接执行（handler.ts 由 agent:bootstrap 事件触发，非 bash 可跑）
  HOOK_DIR="${OPENCLAW_DIR}/hooks/sofagent-load-chain"
  HOOK_FILES_OK=0
  [ -f "${HOOK_DIR}/HOOK.md" ]   && HOOK_FILES_OK=$((HOOK_FILES_OK+1))
  [ -f "${HOOK_DIR}/handler.ts" ] && HOOK_FILES_OK=$((HOOK_FILES_OK+1))

  if [ "$HOOK_FILES_OK" = "2" ]; then
    check_pass "hook 目录就绪: hooks/sofagent-load-chain/（HOOK.md + handler.ts）"
  else
    check_fail "hook 文件缺失（期望 HOOK.md + handler.ts，实际 ${HOOK_FILES_OK}/2）"
  fi

  # 检查 openclaw.json 注册
  OC_CONFIG="${OPENCLAW_DIR}/openclaw.json"
  if [ -f "$OC_CONFIG" ]; then
    if grep -q '"sofagent-load-chain"' "$OC_CONFIG" 2>/dev/null; then
      check_pass "openclaw.json 已注册 sofagent-load-chain hook"
    else
      check_warn "openclaw.json 未注册 sofagent-load-chain（加载链第 2、3 层不会自动注入）"
    fi
  else
    check_warn "openclaw.json 不存在（hook 注册无从检查）"
  fi

  # 检查注入源文件是否可解析（think.md / rules.md）
  # v0.73: rules.md 权威路径 skills/sofagent/rules.md（扁平化）
  # ~/.openclaw/rules.md 是用户自定义文件，不再作为 sofagent 部署路径检查
  RULES_AUTHORITY="${OPENCLAW_DIR}/skills/sofagent/rules.md"
  if [ -f "$RULES_AUTHORITY" ]; then
    check_pass "rules.md 权威路径就绪（$(wc -m < "$RULES_AUTHORITY" | tr -d ' ') 字符）"
  else
    check_warn "rules.md 未部署到权威路径（${RULES_AUTHORITY}）"
    # 兼容检查：老版本（v0.70 前）部署到 ~/.openclaw/rules.md
    LEGACY_RULES="${OPENCLAW_DIR}/rules.md"
    if [ -f "$LEGACY_RULES" ]; then
      check_warn "  发现遗留路径（${LEGACY_RULES}）——建议运行 install.sh 升级到 v0.73 扁平化路径"
    fi
    # v0.71-0.72 残留：constitution/rules.md → warning
    LEGACY_CONST="${OPENCLAW_DIR}/skills/sofagent/constitution/rules.md"
    if [ -f "$LEGACY_CONST" ]; then
      check_warn "  发现 v0.72 前安装残留（${LEGACY_CONST}）——建议运行 install.sh 升级，旧路径将自动迁移"
    fi
  fi
  # think.md 检查
  THINK_FILE="${PWD}/.sofagent/think.md"
  if [ -f "$THINK_FILE" ]; then
    check_pass "think.md 存在（$(wc -m < "$THINK_FILE" | tr -d ' ') 字符）"
  else
    check_warn "think.md 不存在（首次运行后由 B1 创建）"
  fi

  # ── handler.ts 回归验证（v0.72）──
  # 扫描 OpenClaw 启动日志，确认 sofagent-load-chain hook 被 agent:bootstrap 触发，
  # 第 2/3 层出现在注入列表中。如果 OpenClaw 未安装则跳过。
  # 兼容 .log 和 .jsonl 两种日志格式（OpenClaw 2026.6.x 使用 .jsonl）。
  OPENCLAW_LOG_DIR="${OPENCLAW_DIR}/logs"
  if [ -d "$OPENCLAW_LOG_DIR" ]; then
    RECENT_LOGS=$(find "$OPENCLAW_LOG_DIR" \( -name "*.log" -o -name "*.jsonl" \) -mtime -30 2>/dev/null | head -5 || true)
    if [ -n "$RECENT_LOGS" ]; then
      HOOK_TRIGGERED=0
      LAYER2_FOUND=0
      LAYER3_FOUND=0
      for log_file in $RECENT_LOGS; do
        [ -f "$log_file" ] || continue
        LOG_CONTENT=$(cat "$log_file" 2>/dev/null || true)
        if echo "$LOG_CONTENT" | grep -q "sofagent-load-chain"; then
          HOOK_TRIGGERED=1
        fi
        if echo "$LOG_CONTENT" | grep -q "think\\.md"; then
          LAYER2_FOUND=1
        fi
        if echo "$LOG_CONTENT" | grep -q "rules\\.md"; then
          LAYER3_FOUND=1
        fi
        [ "$HOOK_TRIGGERED" = "1" ] && [ "$LAYER2_FOUND" = "1" ] && [ "$LAYER3_FOUND" = "1" ] && break
      done
      if [ "$HOOK_TRIGGERED" = "1" ]; then
        check_pass "handler.ts 回归：sofagent-load-chain hook 已被触发"
        if [ "$LAYER2_FOUND" = "1" ] && [ "$LAYER3_FOUND" = "1" ]; then
          check_pass "handler.ts 回归：第 2/3 层出现在注入列表中"
        else
          MISSING_LAYERS=""
          [ "$LAYER2_FOUND" = "0" ] && MISSING_LAYERS="第2层(think.md)"
          [ "$LAYER3_FOUND" = "0" ] && MISSING_LAYERS="${MISSING_LAYERS:+$MISSING_LAYERS, }第3层(rules.md)"
          check_warn "handler.ts 回归：${MISSING_LAYERS}未在注入列表中出现"
          check_warn "handler.ts 回归：日志格式可能已变化（grep 字符串匹配依赖固定格式），如使用非标准 OpenClaw 版本请手动确认加载链是否生效"
        fi
      else
        check_warn "handler.ts 回归：sofagent-load-chain hook 在最近日志中未检测到触发"
      fi
    else
      check_warn "handler.ts 回归：最近 30 天无 OpenClaw 日志，跳过"
    fi
  else
    check_pass "handler.ts 回归：OpenClaw 日志目录不存在，跳过（非 OpenClaw 平台或未启动过）"
  fi
fi

_hr
_section "外部依赖"

if command -v ao &>/dev/null; then
  AO_VER=$(ao --version 2>/dev/null || echo "unknown")
  check_pass "agency-orchestrator (ao) 可用 — v${AO_VER}"
  # ao compose 健康检查：确认 ao compose 可正常调用（失败时 warn，不阻断）
  AO_COMPOSE_OUT=$(ao compose --version 2>/dev/null || true)
  if [ -n "$AO_COMPOSE_OUT" ]; then
    check_pass "ao compose 健康检查通过"
  else
    check_warn "ao compose --version 失败——编排引擎可能不可用（约束层不受影响）"
  fi
  # ao 版本下限检查（install.sh pin agency-orchestrator@0.7.5）
  # 解析版本号，低于 0.7.5 时 warn（不 fail，--no-ao 降级可用）
  _ao_clean="${AO_VER##v}"
  _ao_major="${_ao_clean%%.*}"
  _ao_minor_patch="${_ao_clean#*.}"
  _ao_minor="${_ao_minor_patch%%.*}"
  if [ "${_ao_major:-0}" -eq 0 ] && [ "${_ao_minor:-0}" -lt 7 ]; then
    check_warn "ao 版本低于 0.7.5（当前 ${AO_VER}），建议升级：npm install -g agency-orchestrator@0.7.5"
  elif [ "${_ao_major:-0}" -eq 0 ] && [ "${_ao_minor:-0}" -eq 7 ]; then
    _ao_patch="${_ao_minor_patch#*.}"
    if [ "${_ao_patch:-0}" -lt 5 ]; then
      check_warn "ao 版本低于 0.7.5（当前 ${AO_VER}），建议升级：npm install -g agency-orchestrator@0.7.5"
    fi
  fi
  # 烟雾测试：ao 能否列出角色（用表格行数），
  # 若输出格式变化导致计数异常，降级为检查非空输出
  ROLE_COUNT=$(ao roles 2>/dev/null | grep -c '|' | tr -d '\n' || echo "0")
  if [ "${ROLE_COUNT:-0}" -gt 10 ]; then
    check_pass "ao 角色库正常 (${ROLE_COUNT}+ 角色)"
  elif [ -n "$(ao roles 2>/dev/null)" ]; then
    check_pass "ao 角色库可用（输出格式可能已变化，无法精确计数）"
  else
    check_warn "ao 角色库异常或未初始化，运行 ao init 初始化"
  fi
else
  check_warn "ao 命令不可用 — 编排功能将不可用"
fi

if command -v node &>/dev/null; then
  check_pass "Node.js $(node --version)"
else
  check_fail "Node.js 不可用"
fi

_hr
_section "平台兼容性"

# OpenClaw（注意：WorkBuddy 内嵌了 OpenClaw，不是独立安装）
if command -v openclaw &>/dev/null; then
  OC_PATH=$(command -v openclaw)
  OC_VER=$(openclaw --version 2>/dev/null || echo "?")
  if echo "$OC_PATH" | grep -q ".workbuddy"; then
    check_pass "OpenClaw v${OC_VER}（WorkBuddy 内嵌）"
  else
    check_pass "OpenClaw 已安装: v${OC_VER}"
  fi
else
  check_warn "OpenClaw 未检测到 — 加载链 Hook 需手动注册"
fi

# WorkBuddy（底层 OpenClaw，检测特有标记）
if [ -d "${HOME}/.workbuddy" ] || [ -n "${WORKBUDDY_DIR:-}" ]; then
  check_pass "WorkBuddy 环境已检测"
else
  check_warn "WorkBuddy 未检测 — 如不使用请忽略"
fi

# Claude Code（仅 CLI 可靠，CLAUDE.md 可能来自 Skill/桌面版/其他工具）
if command -v claude &>/dev/null; then
  CC_VER=$(claude --version 2>/dev/null || echo "?")
  check_pass "Claude Code CLI 已安装: v${CC_VER}"
elif command -v claude-code &>/dev/null; then
  check_pass "Claude Code 已安装"
else
  check_warn "Claude Code 未检测 — 如不使用请忽略"
fi

# Codex
if command -v codex &>/dev/null; then
  check_pass "Codex CLI 已安装"
else
  check_warn "Codex 未检测 — 如不使用请忽略"
fi

# Hermes
if command -v hermes &>/dev/null; then
  check_pass "Hermes CLI 已安装"
else
  check_warn "Hermes 未检测 — 如不使用请忽略"
fi

_hr
_section "数据目录"

SOFAGENT_DATA="${PWD}/.sofagent"
if [ -d "$SOFAGENT_DATA" ]; then
  check_pass ".sofagent/ 数据目录存在"
  # 检查子目录
  for sub in task/logs orchestrator; do
    if [ -d "${SOFAGENT_DATA}/${sub}" ]; then
      check_pass "  .sofagent/${sub}/ 就绪"
    else
      check_warn "  .sofagent/${sub}/ 缺失"
    fi
  done
else
  check_warn ".sofagent/ 数据目录不存在（首次使用会自动创建）"
fi

_hr
_section "断路器配置"

CONFIG_FILE="${OPENCLAW_DIR}/config.json"
if [ -n "${OPENCLAW_CONFIG_PATH:-}" ]; then
  CONFIG_FILE="$OPENCLAW_CONFIG_PATH"
fi

if command -v jq &>/dev/null; then
  check_pass "jq 可用"

  if [ -f "$CONFIG_FILE" ]; then
    if jq -e '.tools.loopDetection.enabled' "$CONFIG_FILE" >/dev/null 2>&1; then
      check_pass "loopDetection 已启用"
      # 检查检测器
      for d in genericRepeat pingPong knownPollNoProgress; do
        if jq -e ".tools.loopDetection.detectors.${d}" "$CONFIG_FILE" >/dev/null 2>&1; then
          check_pass "  检测器 ${d}: 已激活"
        else
          check_warn "  检测器 ${d}: 未启用"
        fi
      done
      # 阈值检查
      threshold=$(jq -r '.tools.loopDetection.globalCircuitBreakerThreshold' "$CONFIG_FILE" 2>/dev/null || echo "?")
      check_pass "  全局熔断阈值: ${threshold} 步"
    else
      check_fail "loopDetection 未配置或未启用"
    fi
  else
    check_warn "config.json 不存在，请运行 install.sh"
  fi
else
  check_warn "jq 不可用，跳过 loopDetection 检查"
  if [ -f "$CONFIG_FILE" ] && grep -q 'loopDetection' "$CONFIG_FILE" 2>/dev/null; then
    check_pass "loopDetection 配置存在（grep 检测）"
  else
    check_warn "无法确认 loopDetection 状态（安装 jq 以获得完整验证）"
  fi
fi

_hr

# ════════════════════════════════════════
# 9. 约束实效验证（不只是文件存在）
# ════════════════════════════════════════
if [ "$PLATFORM" != "workbuddy" ]; then
  [ "$JSON_MODE" = false ] && echo -e "${BOLD}${YELLOW}约束验证${NC}"
fi

# 9.1 加载链内容完整性——检查 SKILL.md 是否含宪法关键词（v0.62：宪法内联）
[ "$JSON_MODE" = false ] && echo -n "  约束注入验证: "
SKILL_FILE="${OPENCLAW_DIR:-$HOME/.openclaw}/skills/sofagent/SKILL.md"
if [ -f "$SKILL_FILE" ]; then
  if grep -q "4.*底线\|10.*铁律" "$SKILL_FILE" 2>/dev/null; then
    check_pass "契约层关键词完整（4底线+10铁律内联在 SKILL.md）"
  else
    check_fail "SKILL.md 内容异常——宪法关键词缺失"
  fi
else
  check_warn "SKILL.md 不存在，无法验证宪法内容"
fi

# 9.2 闸门通过率——数据层是否在运转
[ "$JSON_MODE" = false ] && echo -n "  闸门通过率: "
if [ -d ".sofagent/task/logs" ]; then
  recent_count=$(find ".sofagent/task/logs" -name "*.md" -mtime -7 2>/dev/null | wc -l | tr -d ' ')
  if [ "$recent_count" -gt 0 ]; then
    check_pass "最近7天有 ${recent_count} 条任务记录"
  else
    check_warn "最近7天无任务记录——数据层可能空转"
  fi
else
  check_warn "task/logs/ 目录不存在——尚未运行过任务"
fi

# 9.3 反思更新频率
[ "$JSON_MODE" = false ] && echo -n "  反思更新频率: "
if [ -f ".sofagent/think.md" ]; then
  # GNU stat (-c %Y) 优先，BSD/macOS (-f %m) 回退；原 BSD-only 写法在 Linux 上恒返回 0 → 永远报"超旧"
  modified_sec=$(($(date +%s) - $(stat -c %Y ".sofagent/think.md" 2>/dev/null || stat -f %m ".sofagent/think.md" 2>/dev/null || echo 0)))
  modified_days=$((modified_sec / 86400))
  if [ "$modified_days" -le 3 ]; then
    check_pass "think.md ${modified_days} 天前更新（活跃）"
  elif [ "$modified_days" -le 14 ]; then
    check_warn "think.md ${modified_days} 天前更新（较不活跃）"
  else
    check_warn "think.md ${modified_days} 天前更新——闭环可能未正常运转"
  fi
else
  check_warn "think.md 不存在——尚未触发过闭环反思"
fi

_hr

# ════════════════════════════════════════
# 10. 企业合规验证（v0.7x）
# ════════════════════════════════════════
if [ "$JSON_MODE" = false ]; then
  echo -e "${BOLD}${YELLOW}企业合规${NC}"
fi

# ── 确定脚本目录 ──
VERIFY_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 10.1 脱敏函数验证
if [ -f "${VERIFY_SCRIPT_DIR}/lib/config.sh" ]; then
  check_pass "config.sh 共享配置加载器存在"
else
  check_warn "config.sh 不存在"
fi

# 模拟脱敏（不依赖 config.sh，直接测试 sed 链）
_test_sanitize() {
  local input="$1"
  # 1. OpenAI / Anthropic API Key
  input=$(echo "$input" | sed -E 's/sk-(ant(-api)?-)?[a-zA-Z0-9_-]{20,}/sk-***REDACTED***/g')
  # 2. Bearer token
  input=$(echo "$input" | sed -E 's/Bearer +[a-zA-Z0-9._~+\/-]+=*/Bearer ***REDACTED***/g')
  # 3. JWT token（eyJ 开头的 base64url 三段式）
  input=$(echo "$input" | sed -E 's/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/***JWT-REDACTED***/g')
  # 4. AWS Access Key（AKIA 开头，20 字符）
  input=$(echo "$input" | sed -E 's/AKIA[0-9A-Z]{16}/***AWS-KEY-REDACTED***/g')
  # 5. 凭证赋值（^|非字母数字 保证不误伤 monkey=key 之类）
  input=$(echo "$input" | sed -E 's/(^|[^a-zA-Z0-9_])(password|token|secret|api_key|key)[=:][^ ]+/\1\2=***REDACTED***/g')
  # 6. 私钥块
  input=$(echo "$input" | sed -E '/-----BEGIN .*PRIVATE KEY-----/,/-----END .*PRIVATE KEY-----/{
    s/-----BEGIN .*PRIVATE KEY-----/***PRIVATE-KEY-BLOCK-REDACTED***/
    /-----BEGIN/d
    /-----END/d
  }')
  # 7. 中国大陆手机号（1[3-9] 开头 + 9 位数字，共 11 位）
  input=$(echo "$input" | sed -E 's/1[3-9][0-9]{9}/[PHONE-REDACTED]/g')
  echo "$input"
}

SANITY_SK=$(_test_sanitize "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456")
if echo "$SANITY_SK" | grep -q "REDACTED"; then
  check_pass "脱敏: API Key 打码正常 (sk- → sk-***REDACTED***)"
else
  check_fail "脱敏: API Key 未打码"
fi

SANITY_PWD=$(_test_sanitize "password=mysecret123")
if echo "$SANITY_PWD" | grep -q "REDACTED" && ! echo "$SANITY_PWD" | grep -q "mysecret123"; then
  check_pass "脱敏: 凭证打码正常 (password= → password=***REDACTED***)"
else
  check_fail "脱敏: 凭证未打码"
fi

# 手机号脱敏测试（v0.71 P0 修复）
SANITY_PHONE=$(_test_sanitize "用户电话 13812345678 请回拨")
if echo "$SANITY_PHONE" | grep -q "PHONE-REDACTED" && ! echo "$SANITY_PHONE" | grep -q "13812345678"; then
  check_pass "脱敏: 手机号打码正常 (1[3-9]xxxxxxxxx → [PHONE-REDACTED])"
else
  check_fail "脱敏: 手机号未打码"
fi

# 手机号误伤测试——11 位订单号不应被打码
SANITY_NO_FALSE_POSITIVE=$(_test_sanitize "订单号 28012345678 已生成")
if ! echo "$SANITY_NO_FALSE_POSITIVE" | grep -q "PHONE-REDACTED"; then
  check_pass "脱敏: 11 位订单号（非 1[3-9] 开头）未被误伤"
else
  check_warn "脱敏: 11 位订单号被误伤（可能误打码）"
fi

# 词边界防误伤测试——monkey=foo 不应被打码
SANITY_KEYWORD=$(_test_sanitize "monkey=foo 这是任务名")
if ! echo "$SANITY_KEYWORD" | grep -q "REDACTED"; then
  check_pass "脱敏: 词边界保护（monkey=foo 不被误伤）"
else
  check_warn "脱敏: 词边界失效（monkey=foo 被误伤）"
fi

SANITY_PASS=$(_test_sanitize "普通文本无敏感信息")
if [ "$SANITY_PASS" = "普通文本无敏感信息" ]; then
  check_pass "脱敏: 无敏感信息文本原样通过"
else
  check_warn "脱敏: 无敏感信息文本被修改"
fi

# 10.2 cleanup.sh 存在性检查
CLEANUP_SCRIPT="${VERIFY_SCRIPT_DIR}/cleanup.sh"
if [ -f "$CLEANUP_SCRIPT" ] && [ -x "$CLEANUP_SCRIPT" ]; then
  check_pass "cleanup.sh 存在且可执行"
  # 检查关键参数（注意：grep -q 在 pipefail 下会因 SIGPIPE 误报，用临时变量避免）
  CLEANUP_HELP=$(bash "$CLEANUP_SCRIPT" --help 2>/dev/null || true)
  if echo "$CLEANUP_HELP" | grep -q "dry-run"; then
    check_pass "cleanup.sh --dry-run 参数可用"
  else
    check_warn "cleanup.sh --dry-run 参数不可用"
  fi
else
  check_fail "cleanup.sh 缺失或不可执行"
fi

# 10.3 audit.sh 存在性检查
AUDIT_SCRIPT_VERIFY="${VERIFY_SCRIPT_DIR}/audit.sh"
if [ -f "$AUDIT_SCRIPT_VERIFY" ] && [ -x "$AUDIT_SCRIPT_VERIFY" ]; then
  check_pass "audit.sh 存在且可执行"
  # 检查关键参数（同上，避免 pipefail + grep -q 的 SIGPIPE 误报）
  AUDIT_HELP=$(bash "$AUDIT_SCRIPT_VERIFY" --help 2>/dev/null || true)
  if echo "$AUDIT_HELP" | grep -q "operation"; then
    check_pass "audit.sh --operation 参数可用"
  else
    check_warn "audit.sh --operation 参数不可用"
  fi
else
  check_fail "audit.sh 缺失或不可执行"
fi

# 10.4 默认关闭确认
if [ -f "${VERIFY_SCRIPT_DIR}/lib/config.sh" ]; then
  source "${VERIFY_SCRIPT_DIR}/lib/config.sh" 2>/dev/null || true
fi
if [ "${SOFA_SANITIZE:-}" != "true" ] && [ "${SOFA_AUDIT_ENABLED:-}" != "true" ] && [ "${SOFA_CLEANUP_ON_RECORD:-}" != "true" ]; then
  check_pass "默认关闭: 合规功能全部关闭（向后兼容）"
else
  if [ "${SOFA_SANITIZE:-}" = "true" ]; then
    check_warn "脱敏已启用 (log_sanitize=true)"
  fi
  if [ "${SOFA_AUDIT_ENABLED:-}" = "true" ]; then
    check_warn "审计已启用 (audit_enabled=true)"
  fi
  if [ "${SOFA_CLEANUP_ON_RECORD:-}" = "true" ]; then
    check_warn "清理触发已启用 (data_cleanup_on_record=true)"
  fi
fi

# 10.5 rules.md 配置段完整性
# v0.73: 权威路径为 skills/sofagent/rules.md（扁平化）
# 兼容 fallback：工作目录（开发态）/ 旧部署路径（老安装）
RULES_FILE=""
for candidate in \
  "${PWD}/sofagent/rules.md" \
  "$HOME/.openclaw/skills/sofagent/rules.md" \
  "$HOME/.workbuddy/skills/sofagent/rules.md" \
  "${PWD}/sofagent/constitution/rules.md" \
  "$HOME/.openclaw/skills/sofagent/constitution/rules.md" \
  "$HOME/.workbuddy/skills/sofagent/constitution/rules.md"; do
  if [ -f "$candidate" ]; then RULES_FILE="$candidate"; break; fi
done
if [ -n "$RULES_FILE" ]; then
  missing=0
  for key in log_sanitize log_sanitize_ips data_retention_days data_retention_max_entries data_cleanup_on_record data_cleanup_frequency audit_enabled; do
    if ! grep -q "${key}:" "$RULES_FILE" 2>/dev/null; then
      missing=$((missing + 1))
    fi
  done
  if [ "$missing" -eq 0 ]; then
    check_pass "rules.md 合规配置段完整（7/7 配置项）"
  else
    check_warn "rules.md 合规配置段不完整（缺少 ${missing}/7 项）"
  fi
else
  check_warn "rules.md 未找到，无法验证合规配置段"
fi

_hr

# ════════════════════════════════════════
# 11. daemon 状态检查
# ════════════════════════════════════════
if [ "$JSON_MODE" = false ] && [ "${QUICK_MODE:-false}" = false ]; then
  echo ""
fi
[ "$JSON_MODE" = false ] && [ "$QUIET_MODE" = false ] && [ "${QUICK_MODE:-false}" = false ] && echo -e "${BOLD}${YELLOW}daemon 状态${NC}"

SOFAGENT_DATA="${PWD}/.sofagent"
DAEMON_PID_FILE="${SOFAGENT_DATA}/daemon.pid"
DAEMON_JSON="${SOFAGENT_DATA}/daemon.json"

# daemon 是否安装
DAEMON_SCRIPT="${OPENCLAW_DIR}/scripts/daemon.sh"
[ ! -f "$DAEMON_SCRIPT" ] && DAEMON_SCRIPT="${PWD}/sofagent/scripts/daemon.sh"

if [ -f "$DAEMON_SCRIPT" ]; then
  check_pass "daemon.sh 已安装"

  # daemon 是否运行
  if [ -f "$DAEMON_PID_FILE" ]; then
    DAEMON_PID=$(cat "$DAEMON_PID_FILE" 2>/dev/null || true)
    if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
      check_pass "daemon 运行中 (PID $DAEMON_PID)"
    else
      check_warn "daemon PID 文件存在但进程未运行（可能已崩溃）"
    fi
  else
    check_warn "daemon 未运行（可选功能，不影响约束层）——运行 daemon.sh start 启动"
  fi

  # daemon.json 可读
  if [ -f "$DAEMON_JSON" ] && [ -r "$DAEMON_JSON" ]; then
    check_pass "daemon.json 可读"
  elif [ -f "$DAEMON_PID_FILE" ]; then
    check_warn "daemon.json 不可读"
  fi
else
  check_warn "daemon.sh 未安装（可选功能）——运行 daemon-install.sh 安装"
fi

_hr

# ════════════════════════════════════════
# 总结
# ════════════════════════════════════════
total=$((pass + fail + warn_count))

if [ "$JSON_MODE" = true ]; then
  cat << JSONEOF
{
  "summary": {
    "pass": ${pass},
    "warn": ${warn_count},
    "fail": ${fail},
    "total": ${total}
  },
  "checks": [${_json_items}]
}
JSONEOF
else
  [ "$QUIET_MODE" = true ] && [ "$fail" -gt 0 ] && {
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${fail} 失败${NC}（共 ${total} 项）"
    echo ""
  }
  [ "$QUIET_MODE" = false ] && {
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${fail} 失败${NC}（共 ${total} 项）"
    echo ""
  }
fi

if [ "$fail" -eq 0 ]; then
  [ "$JSON_MODE" = false ] && [ "$QUIET_MODE" = false ] && {
    echo "  ✅ sofagent 安装验证通过！"
    echo ""
    case "$PLATFORM" in
      openclaw)
        echo "  下一步:"
        echo "    1. 注册 before_prompt_build Hook（见 install.sh 输出）"
        echo "    2. 启动 OpenClaw，检查 system prompt 是否包含 sofagent 底线规则"
        echo "    3. 运行 ao compose 测试编排是否正常"
        ;;
      workbuddy)
        echo "  下一步:"
        echo "    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）"
        echo "    2. 试用 /goal 命令开始第一个任务"
        ;;
      claude|codex|hermes)
        echo "  下一步:"
        echo "    1. 将种子指令粘贴到配置文件（见 install.sh 输出）"
        echo "    2. 在下一轮对话中回复「sofagent」验证加载"
        ;;
    esac
  }
  [ "$QUIET_MODE" = true ] && [ "$pass" -gt 0 ] && echo "  ✅ ${pass} 项全部通过"
  [ "$JSON_MODE" = true ] && true  # exit 0 implicitly
else
  [ "$JSON_MODE" = false ] && echo "  ❌ 发现 ${fail} 项失败。请先运行 install.sh 修复。"
  exit 1
fi
echo ""
