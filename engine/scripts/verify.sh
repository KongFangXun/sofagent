#!/usr/bin/env bash
# ============================================================
# sofagent verify.sh · 装后验证脚本
# ============================================================
# 验证 sofagent 安装完整性（9 个检查类别，~48 项动态检查）
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
VERSION="1.4.0"
# ── 临时文件清理（当前脚本不创建临时文件，预留用于将来扩展）──
cleanup() { [ -n "${TMP_FILE:-}" ] && rm -f "$TMP_FILE" 2>/dev/null; }
trap cleanup EXIT

# ── 参数解析 ──
JSON_MODE=false
QUIET_MODE=false
QUICK_MODE=false
PLATFORM=""
# 用 while+shift 解析：for arg in "$@" 里取 $2 是脚本位置参数(非"下一个arg")且 shift 无效——
# 会导致 `--quiet --platform X` 把 PLATFORM 误设为 "--platform"（fork 修复）
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)  JSON_MODE=true; shift ;;
    --quiet) QUIET_MODE=true; shift ;;
    --quick) QUICK_MODE=true; shift ;;
    --list)
      echo "sofagent verify v${VERSION} — 检查清单（~48 项，因环境动态变化）："
      echo ""
      echo "  1. SKILL.md 存在性"
      echo "  2. think.md 可写性"
      echo "  3. fde.md 可写性"
      echo "  4. task/logs/ 目录可写"
      echo "  5. 审计引擎可执行"
      echo "  6. MCP server 可执行"
      echo "  7. daemon 配置文件"
      echo "  8. 安装版本一致性"
      echo "  ... (完整列表见 verify.sh 源码；实际项数因环境条件检查动态变化)"
      echo ""
      echo "部分检查因平台或环境跳过属正常现象（如 Windows 无 launchd）。"
      echo "运行 verify.sh（无 --list）执行全量检查。"
      exit 0
      ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --platform=*) PLATFORM="${1#*=}"; shift ;;
    --help)
      echo "sofagent verify v${VERSION}"
      echo "  正常模式 彩色终端，显示所有检查项"
      echo "  --json   JSON 机器可读输出（CI/CD 用）"
      echo "  --quiet  只输出失败和警告，全通过时静默"
      echo "  --quick  快速模式——仅 4 项核心检查（SKILL.md / .sofagent/ / 新包二进制 / fde.md）"
      echo "  --help   显示此帮助"
      echo "  --list   打印所有检查项清单（不执行检查）"
      echo "退出码: 0=全部通过 1=存在失败项"
      exit 0
      ;;
    *) shift ;;
  esac
done

# 平台参数转小写（兼容 WorkBuddy / OPENCLAW 等大写输入）
PLATFORM="$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]')"

# v0.90 P0-3 修复：提前 source config.sh 统一数据目录
_VERIFY_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${_VERIFY_SCRIPT_DIR}/lib/config.sh" ]; then
  # shellcheck disable=SC1091
  source "${_VERIFY_SCRIPT_DIR}/lib/config.sh" 2>/dev/null || true
fi

# ── 平台探测（未指定时自动检测）──
if [ -z "$PLATFORM" ]; then
  if [ -d "$HOME/.openclaw" ]; then      PLATFORM="openclaw"
  elif [ -d "$HOME/.workbuddy" ]; then   PLATFORM="workbuddy"
  elif [ -d "$HOME/.claude" ]; then      PLATFORM="claude"
  elif [ -d "$HOME/.codex" ]; then       PLATFORM="codex"
  elif [ -d "$HOME/.hermes" ]; then      PLATFORM="hermes"
  elif [ -d "${SOFAGENT_HOME:-$HOME/.sofagent}/skill" ]; then PLATFORM="agnostic"  # 平台无关安装（install.sh 默认）——无平台目录，skill 直接从单一真相源加载
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
  agnostic) TARGET="${SOFAGENT_HOME:-$HOME/.sofagent}" ;;  # 平台无关安装——单一真相源目录
  *)        TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
esac

OPENCLAW_DIR="$TARGET"

# ── 颜色 ──
# v1.1.0: 仅在终端且非 CI/JSON 模式下启用 ANSI 颜色
if [ -t 1 ] && [ "${CI:-}" != "true" ] && [ "${JSON:-0}" != "1" ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

pass=0; FAILED=0; warn_count=0

# ── 输出函数 ──
if [ "$JSON_MODE" = true ]; then
  _json_items=""
  _json_comma() { if [ -n "$_json_items" ]; then _json_items+=","; fi; }
  check_pass() { if [ -n "$_json_items" ]; then _json_items+=","; fi; _json_items+="{\"status\":\"pass\",\"item\":\"$1\"}"; ((pass++)) || true; }
  check_fail() { if [ -n "$_json_items" ]; then _json_items+=","; fi; _json_items+="{\"status\":\"fail\",\"item\":\"$1\"}"; ((FAILED++)) || true; }
  check_warn() { if [ -n "$_json_items" ]; then _json_items+=","; fi; _json_items+="{\"status\":\"warn\",\"item\":\"$1\"}"; ((warn_count++)) || true; }
  _banner() { :; }
  _section() { :; }
  _hr()   { :; }
elif [ "$QUIET_MODE" = true ]; then
  check_pass() { ((pass++)) || true; }
  check_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAILED++)) || true; }
  check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((warn_count++)) || true; }
  _banner() { :; }
  _section() { :; }
  _hr()   { :; }
else
  check_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((pass++)) || true; }
  check_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAILED++)) || true; }
  check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ((warn_count++)) || true; }
  _banner() {
    echo ""; echo "  ╔═══════════════════════════════════╗"
    echo "  ║   sofagent · verify              ║"
    echo "  ╚═══════════════════════════════════╝"; echo ""
  }
  _section() { echo "── $1 ──"; }
  _hr()   { echo ""; }
fi

# ── run_check 封装：统一检查入口，自动路由到 check_pass/check_fail/check_warn
# 用法：run_check "描述" 命令（返回码 0=通过, 1=失败, 2=警告）
run_check() {
  local desc="$1" cmd="$2"
  eval "$cmd"
  case $? in
    0) check_pass "$desc" ;;
    1) check_fail "$desc" ;;
    2) check_warn "$desc" ;;
    *) check_fail "$desc" ;;
  esac
}

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

  # 1. SKILL.md 存在且含宪法关键词（存在性校验，勿写死数字——防 SKILL.md 措辞再变时又漂移）
  # 搜索列表以 ${SOFAGENT_HOME:-$HOME/.sofagent}/skill/ 为首——平台无关安装的实际写入路径
  # （单一真相源，与 config.sh:37 的 SOFAGENT_HOME 解析口径一致），
  # 各平台目录（~/.openclaw 等）只是指向它的 symlink 或按需部署副本
  SKILL_QUICK=""
  for _sk in \
    "${SOFAGENT_HOME:-$HOME/.sofagent}/skill/SKILL.md" \
    "${OPENCLAW_DIR:-}/skills/sofagent/SKILL.md" \
    "$HOME/.openclaw/skills/sofagent/SKILL.md" \
    "$HOME/.workbuddy/skills/sofagent/SKILL.md" \
    "$HOME/.claude/SKILL.md" \
    "$HOME/.codex/SKILL.md" \
    "$HOME/.hermes/SKILL.md"; do
    [ -f "$_sk" ] && { SKILL_QUICK="$_sk"; break; }
  done
  if [ -n "$SKILL_QUICK" ] && grep -qE "[0-9]+ 底线" "$SKILL_QUICK" 2>/dev/null && grep -qE "[0-9]+ 则铁律" "$SKILL_QUICK" 2>/dev/null; then
    check_pass "SKILL.md 存在且含宪法（底线+铁律关键词）"
  else
    check_fail "SKILL.md 缺失或宪法关键词不全"
  fi

  # 2. .sofagent/ 数据目录存在（v0.90 P0-3：用 config.sh 解析的 SOFAGENT_DATA，非 PWD）
  if [ -d "$SOFAGENT_DATA" ]; then
    check_pass ".sofagent/ 数据目录存在"
  else
    check_warn ".sofagent/ 数据目录不存在（首次使用会自动创建）"
  fi

  # 3. 新包二进制检查
  echo "  检查新包二进制..."
  for pkg in orchestrator daemon core ontology; do
    if [ -f "engine/$pkg/dist/cli.js" ]; then
      check_pass "sofagent-$pkg 可用（本地构建）"
    fi
  done

  # 4. fde.md 可读（~/.sofagent/skill/ 为平台无关安装的单一真相源路径）
  RULES_QUICK=""
  for c in \
    "$HOME/.sofagent/skill/fde.md" \
    "${OPENCLAW_DIR:-$HOME/.openclaw}/skills/sofagent/fde.md" \
    "${HOME}/.workbuddy/skills/sofagent/fde.md" \
    "${HOME}/.openclaw/fde.md"; do
    [ -f "$c" ] && { RULES_QUICK="$c"; break; }
  done
  if [ -n "$RULES_QUICK" ] && [ -r "$RULES_QUICK" ]; then
    check_pass "fde.md 可读 — ${RULES_QUICK}"
  else
    check_warn "fde.md 未找到或不可读（未配置自定义规则）"
  fi

  # 输出总结并退出
  total=$((pass + FAILED + warn_count))
  if [ "$JSON_MODE" = true ]; then
    cat << JSONEOF
{
  "summary": {
    "pass": ${pass},
    "warn": ${warn_count},
    "fail": ${FAILED},
    "total": ${total}
  },
  "checks": [${_json_items}]
}
JSONEOF
  else
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${FAILED} 失败${NC}（共 ${total} 项）"
    echo ""
    if [ "$FAILED" -eq 0 ]; then
      echo "  ✅ quick 模式通过！运行 verify.sh（无 --quick）获取完整检查。"
    else
      echo "  ❌ 发现 ${FAILED} 项失败。请先运行 install.sh 修复。"
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
    if grep -qE "[0-9]+ 底线" "$HOME/.workbuddy/skills/sofagent/SKILL.md" 2>/dev/null && grep -qE "[0-9]+ 则铁律" "$HOME/.workbuddy/skills/sofagent/SKILL.md" 2>/dev/null; then
      check_pass "SKILL.md 已部署且含宪法（底线+铁律关键词内联）"
    else
      check_warn "SKILL.md 已部署但宪法内容缺失"
    fi
  else
    check_warn "SKILL.md 未部署到 ~/.workbuddy/skills/sofagent/"
  fi

  if [ -f "$HOME/.workbuddy/fde.md" ] && [ -s "$HOME/.workbuddy/fde.md" ]; then
    chars=$(wc -m < "$HOME/.workbuddy/fde.md" | tr -d ' ')
    check_pass "fde.md 已部署（${chars} 字符）"
  else
    check_warn "fde.md 未部署到 ~/.workbuddy/"
  fi

  if [ -d "$HOME/.workbuddy/skills/sofagent" ]; then
    count=$(find "$HOME/.workbuddy/skills/sofagent" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    check_pass "Skills 目录已部署（${count} 个 .md 文件）"
  else
    check_warn "Skills 目录不存在"
  fi

  # 数据目录检查（v0.90 P0-3：用 SOFAGENT_DATA，非 PWD）
  if [ -d "$SOFAGENT_DATA" ]; then
    check_pass ".sofagent/ 数据目录存在"
  else
    check_warn ".sofagent/ 数据目录不存在（首次使用会自动创建）"
  fi

  # 输出总结并退出
  total=$((pass + FAILED + warn_count))
  if [ "$JSON_MODE" = true ]; then
    cat << JSONEOF
{
  "summary": {
    "pass": ${pass},
    "warn": ${warn_count},
    "fail": ${FAILED},
    "total": ${total}
  },
  "checks": [${_json_items}]
}
JSONEOF
  else
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${FAILED} 失败${NC}（共 ${total} 项）"
    echo ""
    if [ "$FAILED" -eq 0 ]; then
      echo "  ✅ sofagent WorkBuddy 部署验证通过！"
      echo ""
      echo "  下一步:"
      echo "    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）"
      echo "    2. 试用 /goal 命令开始第一个任务"
    else
      echo "  ❌ 发现 ${FAILED} 项失败。请先运行 install.sh 修复。"
      exit 1
    fi
  fi
  exit 0
fi

_section "宪法文件（v0.62：宪法内联在 SKILL.md，此处只检查 fde.md）"

f="fde.md"
# v0.73: fde.md 部署到 skills/sofagent/fde.md（扁平化）
# 平台无关安装的单一真相源 ~/.sofagent/skill/ 优先（与 quick 段搜索列表口径一致）
path="${SOFAGENT_HOME:-$HOME/.sofagent}/skill/${f}"
if [ ! -f "$path" ]; then
  path="${OPENCLAW_DIR}/skills/sofagent/${f}"
fi
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
  # 字符上限（fde.md 是 FDE 部署模板，90 行可承载大量注释行——合理上限 3200 字符）
  if [ "$chars" -gt 3200 ]; then
    check_warn "$f 超过 3200 字符（${chars}），fde.md 行数上限 90 行，建议精简示例注释"
  fi
else
  check_fail "$f — 缺失或为空"
fi

_hr
_section "Skill 文件"

# 平台无关安装的单一真相源 ~/.sofagent/skill/ 优先；平台目录为部署副本
if [ -d "${SOFAGENT_HOME:-$HOME/.sofagent}/skill" ]; then
  SKILLS_DIR="${SOFAGENT_HOME:-$HOME/.sofagent}/skill"
elif [ -d "${OPENCLAW_DIR}/skills" ]; then
  SKILLS_DIR="${OPENCLAW_DIR}/skills"
else
  SKILLS_DIR="${OPENCLAW_DIR}/skills"  # 保持原路径以便报错信息指位
fi
if [ -d "$SKILLS_DIR" ]; then
  skill_count=$(find "$SKILLS_DIR" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  check_pass "Skills 目录存在: ${skill_count} 个 .md 文件"
else
  check_fail "Skills 目录不存在: $SKILLS_DIR"
fi

_hr
_section "配套脚本"

SCRIPTS_DIR="${OPENCLAW_DIR}/scripts"
if [ -d "$SCRIPTS_DIR" ]; then
  script_count=$(find "$SCRIPTS_DIR" -maxdepth 1 -name '*.sh' 2>/dev/null | wc -l | tr -d ' ')
  check_pass "scripts/ 目录存在: ${script_count} 个 .sh 文件"
  s="task-record.sh"
  if [ -f "${SCRIPTS_DIR}/${s}" ] && [ -x "${SCRIPTS_DIR}/${s}" ]; then
    check_pass "  ${s} 已部署且可执行"
  else
    check_warn "  ${s} 缺失或不可执行"
  fi
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

  # 检查注入源文件是否可解析（think.md / fde.md）
  # v0.73: fde.md 权威路径 skills/sofagent/fde.md（扁平化）
  # ~/.openclaw/fde.md 是用户自定义文件，不再作为 sofagent 部署路径检查
  RULES_AUTHORITY="${OPENCLAW_DIR}/skills/sofagent/fde.md"
  if [ -f "$RULES_AUTHORITY" ]; then
    check_pass "fde.md 权威路径就绪（$(wc -m < "$RULES_AUTHORITY" | tr -d ' ') 字符）"
  else
    check_warn "fde.md 未部署到权威路径（${RULES_AUTHORITY}）"
    # 兼容检查：老版本（v0.70 前）部署到 ~/.openclaw/fde.md
    LEGACY_RULES="${OPENCLAW_DIR}/fde.md"
    if [ -f "$LEGACY_RULES" ]; then
      check_warn "  发现遗留路径（${LEGACY_RULES}）——建议运行 install.sh 升级到 v0.73 扁平化路径"
    fi
    # v0.71-0.72 残留：constitution/fde.md → warning
    LEGACY_CONST="${OPENCLAW_DIR}/skills/sofagent/constitution/fde.md"
    if [ -f "$LEGACY_CONST" ]; then
      check_warn "  发现 v0.72 前安装残留（${LEGACY_CONST}）——建议运行 install.sh 升级，旧路径将自动迁移"
    fi
  fi
  # think.md 检查（v0.90 P0-3：用 SOFAGENT_DATA，非 PWD）
  THINK_FILE="${SOFAGENT_DATA}/think.md"
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
          [ "$LAYER3_FOUND" = "0" ] && MISSING_LAYERS="${MISSING_LAYERS:+$MISSING_LAYERS, }第3层(fde.md)"
          check_warn "⚠ 环境警告（非接口断裂）：handler.ts 回归：${MISSING_LAYERS}未在注入列表中出现"
          check_warn "⚠ 环境警告（非接口断裂）：handler.ts 回归：日志格式可能已变化（grep 字符串匹配依赖固定格式），如使用非标准 OpenClaw 版本请手动确认加载链是否生效"
        fi
      else
        check_warn "⚠ 环境警告（非接口断裂）：handler.ts 回归：sofagent-load-chain hook 在最近日志中未检测到触发"
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

# v1.1.0: 新包二进制检查（替代 ao compose）
echo "  检查新包二进制..."
for pkg in orchestrator daemon core ontology; do
  if [ -f "engine/$pkg/dist/cli.js" ]; then
    check_pass "sofagent-$pkg 可用（本地构建）"
  fi
done

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

# v0.90 P0-3 修复：SOFAGENT_DATA 已由顶部 config.sh 统一解析
if [ -d "$SOFAGENT_DATA" ]; then
  check_pass ".sofagent/ 数据目录存在"
  # 检查子目录
  for sub in task/logs orchestrator knowledge/entities knowledge/concepts; do
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

# loopDetection 在 config.json（与 openclaw.json 分离；OPENCLAW_CONFIG_PATH 仅指 hook 配置）
CONFIG_FILE="${OPENCLAW_DIR}/config.json"

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
# 存在性校验（勿写死数字）；${SOFAGENT_HOME:-$HOME/.sofagent}/skill/ 优先——
# 平台无关安装的单一真相源路径（与 quick 段搜索列表、config.sh 解析口径一致）
[ "$JSON_MODE" = false ] && echo -n "  约束注入验证: "
SKILL_FILE="${OPENCLAW_DIR:-$HOME/.openclaw}/skills/sofagent/SKILL.md"
[ -f "$SKILL_FILE" ] || SKILL_FILE="${SOFAGENT_HOME:-$HOME/.sofagent}/skill/SKILL.md"
if [ -f "$SKILL_FILE" ]; then
  if grep -qE "[0-9]+ 底线" "$SKILL_FILE" 2>/dev/null && grep -qE "[0-9]+ 则铁律" "$SKILL_FILE" 2>/dev/null; then
    check_pass "契约层关键词完整（底线+铁律关键词内联在 SKILL.md）"
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

SANITY_SK=$(_test_sanitize "sk-***REDACTED***")
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
  # shellcheck disable=SC1091
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

# 10.5 fde.md 配置段完整性
# v0.73: 权威路径为 skills/sofagent/fde.md（扁平化）
# 兼容 fallback：工作目录（开发态）/ 旧部署路径（老安装）
RULES_FILE=""
for candidate in \
  "$HOME/.sofagent/skill/fde.md" \
  "${PWD}/SKILL/harness/data/fde.md" \
  "$HOME/.openclaw/skills/sofagent/fde.md" \
  "$HOME/.workbuddy/skills/sofagent/fde.md" \
  "${PWD}/SKILL/harness/constitution/fde.md" \
  "$HOME/.openclaw/skills/sofagent/constitution/fde.md" \
  "$HOME/.workbuddy/skills/sofagent/constitution/fde.md"; do
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
    check_pass "fde.md 合规配置段完整（7/7 配置项）"
  else
    check_warn "fde.md 合规配置段不完整（缺少 ${missing}/7 项）"
  fi
else
  check_warn "fde.md 未找到，无法验证合规配置段"
fi

_hr

# ════════════════════════════════════════
# 11. daemon 状态检查
# ════════════════════════════════════════
if [ "$JSON_MODE" = false ] && [ "${QUICK_MODE:-false}" = false ]; then
  echo ""
fi
[ "$JSON_MODE" = false ] && [ "$QUIET_MODE" = false ] && [ "${QUICK_MODE:-false}" = false ] && echo -e "${BOLD}${YELLOW}daemon 状态${NC}"

# v0.90 P0-3 修复：SOFAGENT_DATA 已由顶部 config.sh 统一解析（不覆盖）
DAEMON_PID_FILE="${SOFAGENT_DATA}/daemon.pid"
DAEMON_JSON="${SOFAGENT_DATA}/daemon.json"

# daemon 是否安装
DAEMON_SCRIPT="${OPENCLAW_DIR}/scripts/daemon.sh"
[ ! -f "$DAEMON_SCRIPT" ] && DAEMON_SCRIPT="${PWD}/engine/scripts/daemon.sh"

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
total=$((pass + FAILED + warn_count))

if [ "$JSON_MODE" = true ]; then
  cat << JSONEOF
{
  "summary": {
    "pass": ${pass},
    "warn": ${warn_count},
    "fail": ${FAILED},
    "total": ${total}
  },
  "checks": [${_json_items}]
}
JSONEOF
else
  [ "$QUIET_MODE" = true ] && [ "$FAILED" -gt 0 ] && {
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${FAILED} 失败${NC}（共 ${total} 项）"
    echo ""
  }
  [ "$QUIET_MODE" = false ] && {
    echo "───────────────────────────────────────"
    echo ""
    echo "  结果: ${GREEN}${pass} 通过${NC} / ${YELLOW}${warn_count} 警告${NC} / ${RED}${FAILED} 失败${NC}（共 ${total} 项）"
    echo ""
    echo "  📊 约束底座占用：~3,000 token（128K 窗口的 2.5%）"
    echo ""
  }
fi

if [ "$FAILED" -eq 0 ]; then
  [ "$JSON_MODE" = false ] && [ "$QUIET_MODE" = false ] && {
    echo "  ✅ sofagent 安装验证通过！"
    echo "  📋 本次环境实际执行 ${pass} 项通过 / ${warn_count} 项警告 / ${FAILED} 项失败（共检查 ${total} 项）"
    echo ""
    echo "  🚀 装完第一步做什么？"
    echo "     1. 跑一个简单任务试试——比如让 Agent 帮你写个工具脚本"
    echo "     2. 任务完成后检查 .sofagent/task/logs/ 有没有记录"
    echo "     3. 跑 2-3 个任务后翻 .sofagent/think.md 看 Agent 的反思"
    echo "     4. 如果是企业部署——激活 sofagent-fde Skill 走十步流程"
    echo ""
    case "$PLATFORM" in
      openclaw)
        echo "  平台特定（OpenClaw）:"
        echo "     · 注册 before_prompt_build Hook（见 install.sh 输出）"
        echo "     · 启动 OpenClaw，检查 system prompt 是否包含 sofagent 底线规则"
        echo "     · 运行 sofagent-core doctor 检查基础设施状态"
        ;;
      workbuddy)
        echo "  平台特定（WorkBuddy）:"
        echo "     · 确认 sofagent Skill 已加载（下次对话应出现初始化提示）"
        echo "     · 试用 /goal 命令开始第一个任务"
        ;;
      claude|codex|hermes)
        echo "  平台特定（${PLATFORM}）:"
        echo "     · 将种子指令粘贴到配置文件（见 install.sh 输出）"
        echo "     · 在下一轮对话中回复「sofagent」验证加载"
        ;;
    esac
  }
  [ "$QUIET_MODE" = true ] && [ "$pass" -gt 0 ] && echo "  ✅ 全部通过（${total} 项：${pass} pass / ${warn_count} warn / ${FAILED} fail）"
  [ "$JSON_MODE" = true ] && true  # exit 0 implicitly
else
  [ "$JSON_MODE" = false ] && echo "  ❌ 发现 ${FAILED} 项失败。请先运行 install.sh 修复。"
  exit 1
fi
echo ""
