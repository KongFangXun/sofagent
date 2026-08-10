#!/usr/bin/env bash
# ============================================================
# tools/forge-pm2-start.sh · FORGE PM2 守护进程管理脚本
# v1.2.9 功能③：PM2 守护进程
#
# 用法:
#   ./tools/forge-pm2-start.sh start <driver> <target> [options]
#   ./tools/forge-pm2-start.sh stop <driver>
#   ./tools/forge-pm2-start.sh logs <driver>
#   ./tools/forge-pm2-start.sh status
#   ./tools/forge-pm2-start.sh restart <driver> <target> [options]
#
# 参数:
#   <driver>   fresh-eyes | release-gate | all
#   <target>   目标版本号（如 v1.2.9），start/restart 必填
#   [options]  额外参数透传给 driver（如 --max-rounds 5）
#
# 示例:
#   ./tools/forge-pm2-start.sh start fresh-eyes v1.2.9 --max-rounds 5
#   ./tools/forge-pm2-start.sh start release-gate v1.2.9 --skip-acceptance
#   ./tools/forge-pm2-start.sh stop all
#   ./tools/forge-pm2-start.sh logs fresh-eyes
#   ./tools/forge-pm2-start.sh status
#
# 退出码:
#   0 = 成功
#   1 = 失败（参数错误、PM2 未安装、driver 不存在等）
# ============================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ECOSYSTEM_FILE="FORGE/ecosystem.config.mjs"

# ─── 检查 PM2 是否安装 ───
check_pm2() {
  if ! command -v pm2 &>/dev/null; then
    echo -e "${RED}✗ PM2 未安装。请先安装：${NC}"
    echo -e "  ${CYAN}npm install -g pm2${NC}"
    exit 1
  fi
}

# ─── 用法帮助 ───
print_help() {
  cat << 'EOF'
FORGE PM2 守护进程管理

用法:
  forge-pm2-start.sh start <driver> <target> [options]
  forge-pm2-start.sh stop <driver>
  forge-pm2-start.sh logs <driver>
  forge-pm2-start.sh status
  forge-pm2-start.sh restart <driver> <target> [options]

driver:
  fresh-eyes    fresh-eyes-driver（A/B 双盲独立审查循环）
  release-gate  release-gate-driver（发版闸门验证循环）
  all           所有 driver

target:
  目标版本号（如 v1.2.9），start/restart 时必填

options:
  额外参数透传给 driver（如 --max-rounds 5、--skip-acceptance）

示例:
  forge-pm2-start.sh start fresh-eyes v1.2.9 --max-rounds 5
  forge-pm2-start.sh start release-gate v1.2.9 --skip-acceptance
  forge-pm2-start.sh stop all
  forge-pm2-start.sh logs fresh-eyes
  forge-pm2-start.sh status
EOF
}

# ─── 验证 driver 名 ───
validate_driver() {
  local drv="$1"
  case "$drv" in
    fresh-eyes|release-gate|all) return 0 ;;
    *)
      echo -e "${RED}✗ 未知 driver: ${drv}${NC}"
      echo -e "  可选: fresh-eyes | release-gate | all"
      exit 1
      ;;
  esac
}

# ─── start 命令 ───
do_start() {
  local drv="$1"
  shift
  local target="$1"
  shift || true
  local extra_args="$*"

  if [ -z "$target" ]; then
    echo -e "${RED}✗ start 需要 <target> 参数（版本号，如 v1.2.9）${NC}"
    exit 1
  fi

  validate_driver "$drv"

  local driver_args="--target ${target} ${extra_args}"

  if [ "$drv" = "all" ]; then
    echo -e "${CYAN}启动所有 FORGE driver（target=${target}）...${NC}"
    FORGE_TARGET="$target" pm2 start "$ECOSYSTEM_FILE" --only fresh-eyes -- $driver_args
    FORGE_TARGET="$target" pm2 start "$ECOSYSTEM_FILE" --only release-gate -- $driver_args
  else
    echo -e "${CYAN}启动 FORGE ${drv}（target=${target}）...${NC}"
    FORGE_TARGET="$target" pm2 start "$ECOSYSTEM_FILE" --only "$drv" -- $driver_args
  fi

  echo -e "${GREEN}✅ ${drv} 已启动${NC}"
  echo -e "  查看日志: ${CYAN}./tools/forge-pm2-start.sh logs ${drv}${NC}"
  echo -e "  查看状态: ${CYAN}./tools/forge-pm2-start.sh status${NC}"
}

# ─── stop 命令 ───
do_stop() {
  local drv="$1"
  validate_driver "$drv"

  echo -e "${CYAN}停止 FORGE ${drv}...${NC}"
  if [ "$drv" = "all" ]; then
    pm2 stop fresh-eyes release-gate 2>/dev/null || true
  else
    pm2 stop "$drv" 2>/dev/null || true
  fi
  echo -e "${GREEN}✅ ${drv} 已停止${NC}"
}

# ─── logs 命令 ───
do_logs() {
  local drv="$1"
  validate_driver "$drv"

  if [ "$drv" = "all" ]; then
    pm2 logs
  else
    pm2 logs "$drv"
  fi
}

# ─── status 命令 ───
do_status() {
  echo -e "${CYAN}FORGE PM2 进程状态：${NC}"
  pm2 status
}

# ─── restart 命令 ───
do_restart() {
  local drv="$1"
  shift
  local target="$1"
  shift || true
  local extra_args="$*"

  validate_driver "$drv"

  # 先停再启
  do_stop "$drv"
  do_start "$drv" "$target" "$extra_args"
}

# ─── 主入口 ───

check_pm2

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  start)   do_start "$@" ;;
  stop)    do_stop "$@" ;;
  logs)    do_logs "$@" ;;
  status)  do_status ;;
  restart) do_restart "$@" ;;
  help|-h|--help) print_help ;;
  "")
    echo -e "${RED}✗ 缺少命令${NC}"
    echo ""
    print_help
    exit 1
    ;;
  *)
    echo -e "${RED}✗ 未知命令: ${COMMAND}${NC}"
    echo ""
    print_help
    exit 1
    ;;
esac
