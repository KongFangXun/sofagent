#!/usr/bin/env bash
# platform-detect.sh · 环境检测 + 参数解析 + 数据目录（平台无关重构后不再探测平台）
# 导出：detect_env / parse_args / auto_detect_platform / resolve_data_dir
# 平台无关原则：默认安装只写 ~/.sofagent/，不探测/不枚举/不修改任何第三方平台目录；
#              平台集成改为显式 opt-in（用户明确传 --platform <name> 才启用）。
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
  PLATFORM=""; QUICK_MODE=0; NO_DAEMON=0; LITE_MODE=0; WITH_MEMORY=0  # REMOTE_MODE/ORIGINAL_ARGS/BASE_ONLY 已提前初始化
  FORCE_MODE=0; MERGE_MODE=0; YES_MODE=0  # v1.2.1: custom/ 升级三策略 flags
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
      --base-only)      BASE_ONLY=1; shift ;;
      --with-memory)    WITH_MEMORY=1; shift ;;
      --force)          FORCE_MODE=1; shift ;;                    # v1.2.1: custom/ 强制覆盖策略
      --merge)          MERGE_MODE=1; shift ;;                    # v1.2.1: custom/ 三路合并策略
      --yes|-y)         YES_MODE=1; shift ;;                      # v1.2.1: --force 跳过交互确认（CI 场景）
      -h|--help)
        cat << 'HELP'
用法: install.sh [--platform openclaw|workbuddy|claude|codex|hermes] [--project-dir DIR]
                 [--base-only]

模式说明：
  默认模式         平台无关安装（只写 ~/.sofagent/）+ FDE Skill（企业部署能力）
  --base-only      仅安装约束底座 + 四引擎（不装 FDE Skill）

平台说明（默认不探测、不枚举任何平台——平台集成为显式 opt-in）：
  （不传）    通用安装：只写 sofagent 自己的目录 ~/.sofagent/，不碰任何第三方平台目录
  openclaw  显式平台集成：部署宪法 + Hook + 脚本 + 断路器 → ~/.openclaw/（将修改 OpenClaw 配置）
  workbuddy 检查 .sofagent/ 数据目录 + 运行 verify.sh
  claude    部署宪法 → ~/.claude/ + 输出种子指令（需手动粘贴到 CLAUDE.md）
  codex     部署宪法 → ~/.codex/ + 输出种子指令（需手动粘贴到 AGENTS.md）
  hermes    部署宪法 → ~/.hermes/ + 输出种子指令（需手动粘贴到 SOUL.md）
  --project-dir DIR   指定项目工作目录（.sofagent/ 数据目录会创建在这里，默认当前目录）
  --no-config-inject  跳过自动注入 OpenClaw config.json（企业环境用）
  --quick             快速模式——跳过交互确认和验证等待，直接完整安装
  --lite              精简模式——仅部署核心约束文件，跳过 daemon/配置注入（= --quick + --no-daemon + --no-config-inject）
  --base-only         仅装底座（约束层+审计+编排），跳过 FDE Skill 部署
  --remote            远程安装模式——自动 git clone 仓库后安装（配合 curl pipe bash 使用）
  --force             升级时强制覆盖 custom/ 用户层（交互确认 + 自动备份，恢复官方默认）
  --merge             升级时三路合并 custom/ 用户层（冲突生成 .merge-conflict，不覆盖原文件）
  --yes, -y           配合 --force 跳过交互确认（CI 场景）
HELP
        exit 0 ;;
      *) shift ;;
    esac
  done
  PLATFORM="$(echo "$PLATFORM" | tr '[:upper:]' '[:lower:]')"  # 转小写
}
auto_detect_platform() {
  # 平台无关重构：不再做任何自动探测（不枚举 ~/.openclaw / ~/.workbuddy / ... 目录）。
  # 函数名保留只为兼容 install.sh 既有调用点；未显式传 --platform 时 PLATFORM 保持为空，
  # 走通用安装路径（只写 sofagent 自己的目录 ~/.sofagent/）。
  PLATFORM="${PLATFORM:-}"
}
resolve_data_dir() {
  # v1.2.1 安装路径分离：数据根目录 = SOFAGENT_HOME/data
  # SOFAGENT_HOME 默认 ~/.sofagent，可被环境变量或 --project-dir 覆盖
  TARGET=""  # 初始化——set -u 下避免后续引用未定义变量（平台无关重构）
  if [ -n "${PROJECT_DIR:-}" ]; then
    PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || { err "--project-dir 目录不存在或无法访问: $PROJECT_DIR"; exit 1; }
    # --project-dir 时，SOFAGENT_HOME 设为该目录（开发/定制场景）
    SOFAGENT_HOME="${SOFAGENT_HOME:-$PROJECT_DIR}"
    ok "安装目录: ${SOFAGENT_HOME}"
  else
    SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
    ok "安装目录: ${SOFAGENT_HOME}"
  fi
  SOFAGENT_DATA="${SOFAGENT_DATA:-${SOFAGENT_HOME}/data}"
  # 向后兼容：写入数据目录标记文件（config.sh 和 verify 的 fallback）——仅显式指定平台时
  case "$PLATFORM" in
    openclaw|workbuddy)
      _SKILL_DIR="${TARGET:-${HOME}/.${PLATFORM}/skills/sofagent}"
      mkdir -p "$_SKILL_DIR" 2>/dev/null || true
      echo "$SOFAGENT_DATA" > "$_SKILL_DIR/.sofagent-data-path" 2>/dev/null || true ;;
  esac
  # 目标路径：默认 TARGET = SOFAGENT_HOME（~/.sofagent/，平台无关安装，不碰第三方目录）；
  # 仅当用户显式 --platform <name> 时才指向对应平台目录
  case "$PLATFORM" in
    openclaw) TARGET="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}" ;;
    workbuddy)
      ok "WorkBuddy 平台——部署 Skill 文件并验证数据目录。"; TARGET="$HOME/.workbuddy"
      if [ -d "$SOFAGENT_DATA" ]; then
        ok "  · data/ 数据目录存在"
        if [ -x "${SCRIPT_DIR}/verify.sh" ]; then
          if bash "${SCRIPT_DIR}/verify.sh" --platform workbuddy --quiet 2>/dev/null; then
            ok "  · 数据目录验证通过"
          else
            warn "  · 部分数据文件缺失，下次对话自动触发 B1 重建"
          fi
        fi
      else warn "  · data/ 不存在——安装时自动创建"; fi ;;
    claude) TARGET="$HOME/.claude" ;;
    codex)  TARGET="$HOME/.codex" ;;
    hermes) TARGET="$HOME/.hermes" ;;
    # v1.3.9（八）：跨平台适配器扩展——Cursor / Gemini CLI（薄挂载，SKILL/ 单一真相源）
    cursor) TARGET="$HOME/.cursor" ;;
    gemini) TARGET="$HOME/.gemini" ;;
    *)      TARGET="$SOFAGENT_HOME" ;;  # 通用安装路径——只写自己的目录
  esac
  if [ -n "$PLATFORM" ]; then
    ok "平台: ${PLATFORM}（显式指定）→ 目标: ${TARGET}"
  else
    ok "平台无关安装（未指定平台）→ 目标: ${TARGET}（只写 sofagent 自己的目录）"
  fi
}
