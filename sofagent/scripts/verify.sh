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
#   verify.sh --help    显示此帮助
# ============================================================

set -uo pipefail
VERSION="1.0.0"
# ── 临时文件清理（当前脚本不创建临时文件，预留用于将来扩展）──
cleanup() { [ -n "${TMP_FILE:-}" ] && rm -f "$TMP_FILE" 2>/dev/null; }
trap cleanup EXIT

# ── 参数解析 ──
JSON_MODE=false
QUIET_MODE=false
PLATFORM=""
for arg in "$@"; do
  case "$arg" in
    --json)  JSON_MODE=true ;;
    --quiet) QUIET_MODE=true ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --platform=*) PLATFORM="${arg#*=}" ;;
    --help)
      echo "sofagent verify v${VERSION}"
      echo "  正常模式 彩色终端，显示所有检查项"
      echo "  --json   JSON 机器可读输出（CI/CD 用）"
      echo "  --quiet  只输出失败和警告，全通过时静默"
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
  path="${OPENCLAW_DIR}/${f}"
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
for layer_file in "${PWD}/.sofagent/think.md" "${OPENCLAW_DIR}/rules.md"; do
  if [ -f "$layer_file" ]; then
    check_pass "$(basename "$layer_file") 存在（$(wc -m < "$layer_file" | tr -d ' ') 字符）"
  else
    check_warn "$(basename "$layer_file") 不存在（首次运行后由 B1 创建 / 需手动配置）"
  fi
done

_hr
_section "外部依赖"

if command -v ao &>/dev/null; then
  AO_VER=$(ao --version 2>/dev/null || echo "unknown")
  check_pass "agency-orchestrator (ao) 可用 — v${AO_VER}"
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
  modified_sec=$(($(date +%s) - $(stat -f %m ".sofagent/think.md" 2>/dev/null || echo 0)))
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
  input=$(echo "$input" | sed -E 's/sk-(ant(-api)?-)?[a-zA-Z0-9_-]{20,}/sk-***REDACTED***/g')
  input=$(echo "$input" | sed -E 's/Bearer +[a-zA-Z0-9._~+\/-]+=*/Bearer ***REDACTED***/g')
  input=$(echo "$input" | sed -E 's/(password|token|secret|api_key|key)[=:]\s*[^ ]+/\1=***REDACTED***/g')
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
  # 检查关键参数
  if bash "$CLEANUP_SCRIPT" --help 2>/dev/null | grep -q "dry-run"; then
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
  # 检查关键参数
  if bash "$AUDIT_SCRIPT_VERIFY" --help 2>/dev/null | grep -q "operation"; then
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
RULES_FILE=""
for candidate in "${PWD}/sofagent/constitution/rules.md" "$HOME/.openclaw/rules.md" "$HOME/.workbuddy/rules.md"; do
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
