#!/bin/bash
# ============================================================
# sofagent uninstall.sh · 卸载脚本
# ============================================================
# 删除 sofagent 约束文件，但保留 .sofagent/ 用户数据。
# 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成。
#
# 用法：./uninstall.sh [--platform openclaw|workbuddy|claude|codex|hermes]
#       ./uninstall.sh --force   跳过确认，直接删除
#       ./uninstall.sh --help    显示帮助
# ============================================================

set -euo pipefail
VERSION="0.83"

# ── 确定脚本目录 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
      echo "  保留: .sofagent/ 数据目录（task-record / orchestrator）"
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

    # 清理宪法文件（v0.73：rules.md 扁平化）
    for f in rules.md; do
      path="$HOME/.workbuddy/$f"
      if [ "$LIST_ONLY" = true ]; then
        if [ -f "$path" ]; then info "  $path"; fi
      else
        if [ -f "$path" ]; then rm -f "$path" && ok "已删除: $HOME/.workbuddy/$f"; fi
      fi
      # 兼容旧 skills/sofagent/ 路径
      skill_path="$HOME/.workbuddy/skills/sofagent/$f"
      if [ -f "$skill_path" ]; then
        if [ "$LIST_ONLY" = true ]; then info "  $skill_path"; else rm -f "$skill_path" && ok "已删除: skills/sofagent/$f"; fi
      fi
      # 兼容旧 constitution/ 路径
      old_path="$HOME/.workbuddy/skills/sofagent/constitution/$f"
      if [ -f "$old_path" ]; then
        if [ "$LIST_ONLY" = true ]; then info "  $old_path（v0.72 前残留）"; else rm -f "$old_path" && rmdir "$(dirname "$old_path")" 2>/dev/null || true; ok "已删除旧版残留: constitution/$f"; fi
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

# ── 审计：卸载开始 ──
bash "${SCRIPT_DIR}/audit.sh" --operation "uninstall" --target "开始" --result "v${VERSION}, ${PLATFORM}" 2>/dev/null || true

if [ "$FORCE" != true ]; then
  read -r -p "  确认删除？[y/N] " confirm
  case "$confirm" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "  已取消。"; exit 0 ;;
  esac
fi

removed=0

# ── 删除 / 列出宪法文件（v0.73：rules.md 扁平化到 skills/sofagent/rules.md）──
for f in rules.md; do
  # 新路径
  path="${OPENCLAW_DIR}/skills/sofagent/${f}"
  if [ -f "$path" ]; then
    if [ "$LIST_ONLY" = true ]; then
      info "  $path"
    else
      rm -f "$path" "${path}.bak"
      ok "已删除: skills/sofagent/$f"
    fi
    ((removed++)) || true
  fi
  # 兼容旧 constitution/ 路径
  old_path="${OPENCLAW_DIR}/skills/sofagent/constitution/${f}"
  if [ -f "$old_path" ]; then
    if [ "$LIST_ONLY" = true ]; then
      info "  $old_path（v0.72 前残留）"
    else
      rm -f "$old_path" "${old_path}.bak"
      rmdir "$(dirname "$old_path")" 2>/dev/null || true
      ok "已删除旧版残留: constitution/$f"
    fi
    ((removed++)) || true
  fi
  # 旧根路径
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

# ── 删除 / 列出加载链 Hook（2026.6.x 内部 hook 目录）──
HOOK_DIR="${OPENCLAW_DIR}/hooks/sofagent-load-chain"
if [ -d "$HOOK_DIR" ]; then
  if [ "$LIST_ONLY" = true ]; then
    info "  $HOOK_DIR/（HOOK.md + handler.ts）"
  else
    rm -rf "$HOOK_DIR"
    rmdir "${OPENCLAW_DIR}/hooks" 2>/dev/null || true
    ok "已删除: hooks/sofagent-load-chain/"
  fi
  ((removed++)) || true
fi

# ── 注销 openclaw.json 中的 hook 注册 ──
OC_CONFIG="${OPENCLAW_DIR}/openclaw.json"
if [ -f "$OC_CONFIG" ] && command -v jq &>/dev/null; then
  if jq -e '.hooks.internal.entries."sofagent-load-chain"' "$OC_CONFIG" >/dev/null 2>&1; then
    if [ "$LIST_ONLY" = true ]; then
      info "  $OC_CONFIG (hooks.internal.entries.sofagent-load-chain)"
    else
      jq 'del(.hooks.internal.entries."sofagent-load-chain")' "$OC_CONFIG" > "${OC_CONFIG}.tmp" 2>/dev/null
      mv "${OC_CONFIG}.tmp" "$OC_CONFIG" 2>/dev/null && ok "已注销 openclaw.json 中的 sofagent-load-chain hook"
    fi
    ((removed++)) || true
  fi
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

# ── daemon 清理 ──
DAEMON_UNINSTALL="${SCRIPT_DIR}/daemon-uninstall.sh"
if [ -f "$DAEMON_UNINSTALL" ] && [ -x "$DAEMON_UNINSTALL" ]; then
  echo ""
  echo "  清理 daemon..."
  bash "$DAEMON_UNINSTALL" 2>/dev/null || true
fi

# ── 清理安装日志 ──
INSTALL_LOG="${OPENCLAW_DIR}/.sofagent-install.log"
rm -f "$INSTALL_LOG"

# ── 审计：卸载完成 ──
bash "${SCRIPT_DIR}/audit.sh" --operation "uninstall" --target "完成" --result "成功" 2>/dev/null || true

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
