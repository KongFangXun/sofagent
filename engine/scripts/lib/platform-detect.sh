#!/bin/bash
# platform-detect.sh · 平台探测 + 环境检测 + 参数解析 + 数据目录
# 导出：detect_env / parse_args / auto_detect_platform / resolve_data_dir
# shellcheck disable=SC2034  # 本文件被 source 到 install.sh，变量跨文件使用

detect_env() {
  local n="unknown"
  if [ -n "${WSL_DISTRO_NAME:-}" ]; then n="WSL (${WSL_DISTRO_NAME:-unknown})"  # 仅认 WSL_DISTRO_NAME——WSLENV 不可靠
  elif [ -n "${MSYSTEM:-}" ]; then n="MSYS2/Git Bash ($MSYSTEM)"
  elif [ -n "${CYGWIN:-}" ]; then n="Cygwin"
  elif [[ "$OSTYPE" == "darwin"* ]]; then n="macOS"
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then n="Linux"
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then n="Windows (native bash)"; fi
  echo "$n"
}
parse_args() {
  PLATFORM=""; QUICK_MODE=0; NO_DAEMON=0; LITE_MODE=0; WITH_MEMORY=0  # REMOTE_MODE/ORIGINAL_ARGS 已提前初始化
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --platform)      PLATFORM="$2"; shift 2 ;;
      --platform=*)    PLATFORM="${1#*=}"; shift ;;
      --project-dir)   PROJECT_DIR="$2"; shift 2 ;;
      --project-dir=*) PROJECT_DIR="${1#*=}"; shift ;;
      --no-config-inject) NO_CONFIG_INJECT=1; shift ;;
      --quick)          QUICK_MODE=1; shift ;;
      --ci)             QUICK_MODE=1; shift ;;                    # --ci = --quick 别名
      --no-daemon)      NO_DAEMON=1; shift ;;
      --skip-daemon)    NO_DAEMON=1; shift ;;                     # 别名
      --lite)           LITE_MODE=1; QUICK_MODE=1; NO_DAEMON=1; NO_CONFIG_INJECT=1; shift ;;
      --remote)         REMOTE_MODE=1; shift ;;
      --with-memory)    WITH_MEMORY=1; shift ;;
      -h|--help)
        cat << 'HELP'
用法: install.sh [--platform openclaw|workbuddy|claude|codex|hermes] [--project-dir DIR]

平台说明：
  openclaw  完整部署（宪法 + Hook + 脚本 + 断路器）→ ~/.openclaw/
  workbuddy 检查 .sofagent/ 数据目录 + 运行 verify.sh
  claude    部署宪法 → ~/.claude/ + 输出种子指令（需手动粘贴到 CLAUDE.md）
  codex     部署宪法 → ~/.codex/ + 输出种子指令（需手动粘贴到 AGENTS.md）
  hermes    部署宪法 → ~/.hermes/ + 输出种子指令（需手动粘贴到 SOUL.md）
  --project-dir DIR   指定项目工作目录（.sofagent/ 数据目录会创建在这里，默认当前目录）
  --no-config-inject  跳过自动注入 OpenClaw config.json（企业环境用）
  --quick             快速模式——跳过交互确认和验证等待，直接完整安装
  --lite              精简模式——仅部署核心约束文件，跳过 daemon/配置注入（= --quick + --no-daemon + --no-config-inject）
  --remote            远程安装模式——自动 git clone 仓库后安装（配合 curl pipe bash 使用）
HELP
        exit 0 ;;
      *) shift ;;
    esac
  done
  PLATFORM="$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]')"  # 转小写
}
auto_detect_platform() {
  [ -n "$PLATFORM" ] && return 0
  if   [ -d "$HOME/.openclaw" ];  then PLATFORM="openclaw"
  elif [ -d "$HOME/.workbuddy" ]; then PLATFORM="workbuddy"
  elif [ -d "$HOME/.claude" ];    then PLATFORM="claude"
  elif [ -d "$HOME/.codex" ];     then PLATFORM="codex"
  elif [ -d "$HOME/.hermes" ];    then PLATFORM="hermes"
  else  PLATFORM="openclaw"; fi   # 默认
}
resolve_data_dir() {
  if [ -n "${PROJECT_DIR:-}" ]; then
    PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || { err "--project-dir 目录不存在或无法访问: $PROJECT_DIR"; exit 1; }
    ok "数据目录: ${PROJECT_DIR}/.sofagent/"
  else
    PROJECT_DIR="$PWD"
    warn "未指定 --project-dir，.sofagent/ 数据目录将创建在当前目录: ${PROJECT_DIR}"
    warn "  如果这不是你的项目工作目录，请用 --project-dir 指定："
    warn "  bash install.sh --project-dir ~/my-project"
  fi
  SOFAGENT_DATA="${SOFAGENT_DATA:-${PROJECT_DIR}/.sofagent}"
  # v0.90 P0-3 修复：写入数据目录标记文件，供 audit/verify/orchestrate 定位
  case "$PLATFORM" in
    openclaw|workbuddy)
      _SKILL_DIR="${TARGET:-${HOME}/.${PLATFORM}/skills/sofagent}"
      mkdir -p "$_SKILL_DIR" 2>/dev/null || true
      echo "$SOFAGENT_DATA" > "$_SKILL_DIR/.sofagent-data-path" 2>/dev/null || true ;;
  esac
  # 按平台确定目标路径
  case "$PLATFORM" in
    openclaw) TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
    workbuddy)
      ok "WorkBuddy 平台——部署 Skill 文件并验证数据目录。"; TARGET="$HOME/.workbuddy"
      if [ -d "$SOFAGENT_DATA" ]; then
        ok "  · .sofagent/ 数据目录存在"
        if [ -x "${SCRIPT_DIR}/verify.sh" ]; then
          if bash "${SCRIPT_DIR}/verify.sh" --platform workbuddy --quiet 2>/dev/null; then
            ok "  · 数据目录验证通过"
          else
            warn "  · 部分数据文件缺失，下次对话自动触发 B1 重建"
          fi
        fi
      else warn "  · .sofagent/ 不存在——下次加载 sofagent Skill 时自动创建"; fi ;;
    claude) TARGET="$HOME/.claude" ;;
    codex)  TARGET="$HOME/.codex" ;;
    hermes) TARGET="$HOME/.hermes" ;;
    *)      TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
  esac
  ok "平台: $PLATFORM → 目标: $TARGET"
}
