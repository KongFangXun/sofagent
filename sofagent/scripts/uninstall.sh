#!/bin/bash
# ============================================================
# sofagent uninstall.sh · 卸载脚本
# ============================================================
# 删除 sofagent 约束文件，但保留 .sofagent/ 用户数据。
# 由 DeepSeek V4 Pro 辅助生成。
#
# 用法：./uninstall.sh [--platform openclaw|workbuddy|claude|codex|hermes]
#       ./uninstall.sh --force   跳过确认，直接删除
#       ./uninstall.sh --help    显示帮助
# ============================================================

set -euo pipefail
VERSION="1.0.0"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[uninstall]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

FORCE=false
LIST_ONLY=false
PLATFORM=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --list)  LIST_ONLY=true ;;
    --platform) PLATFORM="$2"; shift ;;
    --platform=*) PLATFORM="${arg#*=}" ;;
    --help)
      echo "sofagent uninstall [--platform openclaw|workbuddy|claude|codex|hermes]"
      echo "  正常模式 交互确认后删除约束文件"
      echo "  --force  跳过确认，直接删除"
      echo "  --list   仅列出会被删除的文件，不执行"
      echo "  --platform 指定目标平台（未指定时自动探测）"
      echo "  保留: .sofagent/ 数据目录（task-log / orchestrator）"
      exit 0 ;;
  esac
done

# 平台参数转小写（兼容 WorkBuddy / OPENCLAW 等大写输入）
PLATFORM="$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]')"

# ── 平台探测 ──
if [ -z "$PLATFORM" ]; then
  if [ -d "$HOME/.openclaw" ]; then      PLATFORM="openclaw"
  elif [ -d "$HOME/.workbuddy" ]; then   PLATFORM="workbuddy"
  elif [ -d "$HOME/.claude" ]; then      PLATFORM="claude"
  elif [ -d "$HOME/.codex" ]; then       PLATFORM="codex"
  elif [ -d "$HOME/.hermes" ]; then      PLATFORM="hermes"
  else                                   PLATFORM="openclaw"
  fi
fi

case "$PLATFORM" in
  openclaw) TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
  workbuddy)
    SOFAGENT_DATA="${PWD}/.sofagent"
    echo "WorkBuddy 平台——准备清理 sofagent 部署文件"
    echo ""
    removed=0

    # 清理宪法文件（v0.62：宪法内联在 SKILL.md，只清理 rules.md）
    for f in rules.md; do
      path="$HOME/.workbuddy/$f"
      if [ "$LIST_ONLY" = true ]; then
        if [ -f "$path" ]; then info "  $path"; fi
      else
        if [ -f "$path" ]; then rm -f "$path" && ok "已删除: $HOME/.workbuddy/$f"; fi
      fi
      ((removed++)) || true
    done

    # 清理旧版遗留的 sofagent.md（v0.62 前部署的宪法文件）
    legacy="$HOME/.workbuddy/sofagent.md"
    if [ -f "$legacy" ]; then
      if [ "$LIST_ONLY" = true ]; then
        info "  $legacy（旧版遗留）"
      else
        rm -f "$legacy" && ok "已删除旧版遗留: $legacy"
      fi
      ((removed++)) || true
    fi

    # 清理 Skill 目录
    skill_dir="$HOME/.workbuddy/skills/sofagent"
    if [ -d "$skill_dir" ]; then
      skill_count=$(ls -1 "$skill_dir"/*.md 2>/dev/null | wc -l | tr -d ' ')
      if [ "$LIST_ONLY" = true ]; then
        info "  $skill_dir/（${skill_count} 个文件）"
      else
        rm -rf "$skill_dir"
        ok "已删除 skills/sofagent/ 目录（${skill_count} 个文件）"
      fi
      ((removed++)) || true
    fi

    if [ "$LIST_ONLY" = true ]; then
      echo ""
      echo "  共 ${removed} 项会被删除。"
      echo "  工作区数据 .sofagent/ 保留（需手动 rm -rf 清除）。"
      exit 0
    fi

    echo ""
    echo "───────────────────────────────────────"
    echo ""
    echo "  sofagent WorkBuddy 部署文件已清理。"
    if [ -d "$SOFAGENT_DATA" ]; then
      echo "  工作区数据保留在: ${SOFAGENT_DATA}（如需清除请手动 rm -rf）"
    fi
    echo ""
    exit 0
    ;;
  claude)   TARGET="$HOME/.claude" ;;
  codex)    TARGET="$HOME/.codex" ;;
  hermes)   TARGET="$HOME/.hermes" ;;
  *)        TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
esac

OPENCLAW_DIR="$TARGET"  # 保持变量名兼容
SOFAGENT_DATA="${PWD}/.sofagent"

echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║   sofagent · uninstall           ║"
echo "  ╚═══════════════════════════════════╝"
echo ""
echo "  平台: $PLATFORM"
echo "  将从以下位置删除 sofagent 文件："
echo "    $TARGET"
echo ""
echo "  保留用户数据："
echo "    $SOFAGENT_DATA"
echo ""

if [ "$FORCE" != true ]; then
  read -r -p "  确认删除？[y/N] " confirm
  case "$confirm" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "  已取消。"; exit 0 ;;
  esac
fi

removed=0

# ── 删除 / 列出宪法文件（v0.62：宪法内联在 SKILL.md，只清理 rules.md）──
for f in rules.md; do
  path="${OPENCLAW_DIR}/${f}"
  if [ -f "$path" ]; then
    if [ "$LIST_ONLY" = true ]; then
      info "  $path"
    else
      rm -f "$path" "${path}.bak"
      ok "已删除: $f"
    fi
    ((removed++)) || true
  fi
done

# ── 清理旧版遗留的 sofagent.md（v0.62 前部署的宪法文件）──
legacy="${OPENCLAW_DIR}/sofagent.md"
if [ -f "$legacy" ]; then
  if [ "$LIST_ONLY" = true ]; then
    info "  $legacy（旧版遗留）"
  else
    rm -f "$legacy" "${legacy}.bak"
    ok "已删除旧版遗留: sofagent.md"
  fi
  ((removed++)) || true
fi

# ── 删除 / 列出 Skill 文件 ──
SKILLS_DIR="${OPENCLAW_DIR}/skills/sofagent"
if [ -d "$SKILLS_DIR" ]; then
  skill_count=$(ls -1 "$SKILLS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LIST_ONLY" = true ]; then
    info "  $SKILLS_DIR/（${skill_count} 个文件）"
  else
    rm -rf "$SKILLS_DIR"
    ok "已删除 skills/ 目录（${skill_count} 个文件）"
  fi
  ((removed++)) || true
fi

# ── 删除 / 列出加载链 Hook ──
HOOK_PATH="${OPENCLAW_DIR}/hooks/load-chain.sh"
if [ -f "$HOOK_PATH" ]; then
  if [ "$LIST_ONLY" = true ]; then
    info "  $HOOK_PATH"
  else
    rm -f "$HOOK_PATH"
    rmdir "${OPENCLAW_DIR}/hooks" 2>/dev/null || true
    ok "已删除: hooks/load-chain.sh"
  fi
  ((removed++)) || true
fi

# ── 删除 / 列出配套脚本 ──
SCRIPTS_DIR="${OPENCLAW_DIR}/scripts"
if [ -d "$SCRIPTS_DIR" ]; then
  script_count=$(ls -1 "$SCRIPTS_DIR"/*.sh 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LIST_ONLY" = true ]; then
    info "  $SCRIPTS_DIR/（${script_count} 个文件）"
  else
    rm -rf "$SCRIPTS_DIR"
    ok "已删除 scripts/ 目录（${script_count} 个文件）"
  fi
  ((removed++)) || true
fi

# ── 移除 loopDetection 配置 ──
CONFIG_FILE="${OPENCLAW_DIR}/config.json"
if [ -f "$CONFIG_FILE" ] && command -v jq &>/dev/null; then
  if jq -e '.tools.loopDetection' "$CONFIG_FILE" >/dev/null 2>&1; then
    if [ "$LIST_ONLY" = true ]; then
      info "  $CONFIG_FILE (tools.loopDetection)"
    else
      jq 'del(.tools.loopDetection)' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" 2>/dev/null
      mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE" 2>/dev/null && ok "已移除 loopDetection 配置"
    fi
    ((removed++)) || true
  fi
fi

# ── --list 模式到此退出 ──
if [ "$LIST_ONLY" = true ]; then
  echo ""
  echo "  共 ${removed} 项会被删除。数据目录 .sofagent/ 保留。"
  exit 0
fi

# ── 清理安装日志 ──
INSTALL_LOG="${OPENCLAW_DIR}/.sofagent-install.log"
rm -f "$INSTALL_LOG"

echo ""
echo "───────────────────────────────────────"
echo ""
echo "  sofagent 约束文件已删除。"

if [ -d "$SOFAGENT_DATA" ]; then
  echo "  用户数据保留在: $SOFAGENT_DATA"
else
  echo "  （无用户数据需要保留）"
fi

echo ""
echo "  如需重新安装，运行: bash sofagent/scripts/install.sh --platform $PLATFORM"
echo ""
