#!/usr/bin/env bash
# ============================================================
# check-daemon-freshness.sh · daemon 运行态新鲜度守卫
# v1.8.0（F4 二次复发后固化为机械守卫——2026-10-28）
#
# 背景（两次实锤）：
#   2026-10-27：daemon（10-22 启动）跑 worktree 旧 dist，批 12 快照修复
#   未被加载——日志累计 15005 次 Cannot create 失败。
#   2026-10-28：daemon（10-27 19:07 启动）跑 cbbaa4052 dist，主仓当晚
#   前进 7 笔（含 daemon 侧 cron/scheduler 修复）——修复再次未落运行态。
#
# 教训：修复落运行态有三层（模板→实例 / 代码→dist / dist→常驻进程），
#   第三层没有机械守卫，靠人记必然复发。本脚本补第三层。
#
# 判定（三查，任一红即 FAIL）：
#   ① worktree 滞后：daemon 运行的 worktree HEAD ≠ 主仓 HEAD（落后即红）
#   ② dist 陈旧：worktree 内 daemon/evolve dist mtime < 对应 src 最新 commit
#   ③ 进程陈旧：daemon 进程启动时间 < dist mtime（进程在 dist 重建前启动）
#
# 退出码：0=新鲜 / 1=有滞后（附处置命令）/ 2=检查器自身错误
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/../.." 2>/dev/null || true
MAIN_ROOT="$(pwd)"

# ── daemon 实际运行的代码根（从进程命令行提取）──
DAEMON_PID="$(launchctl list 2>/dev/null | grep sofagent-daemon | awk '{print $1}')"
if [ -z "$DAEMON_PID" ] || [ "$DAEMON_PID" = "-" ]; then
  echo "ℹ️ daemon 未运行（launchd 无 sofagent-daemon 条目）——本守卫只判运行态滞后，跳过"
  exit 0
fi
PROC_CMD="$(ps -o command= -p "$DAEMON_PID" 2>/dev/null | head -1)"
if [ -z "$PROC_CMD" ]; then
  echo "❌ launchd 有条目但进程 $DAEMON_PID 不存在——状态异常，人工排查"
  exit 1
fi

# 进程命令行形态：node <abs>/engine/daemon/dist/cli.js start
PROC_START_TS="$(ps -o lstart= -p "$DAEMON_PID" 2>/dev/null)"
PROC_START_EPOCH="$(stat -f %m /proc/$DAEMON_PID 2>/dev/null || ps -o etimes= -p "$DAEMON_PID" 2>/dev/null | awk -v now="$(date +%s)" '{print now-$1}')"

# 从 cli.js 路径反推运行根
RUN_ROOT="$(echo "$PROC_CMD" | grep -oE '/[^ ]*/engine/daemon/dist/cli\.js' | sed 's|/engine/daemon/dist/cli.js||')"
if [ -z "$RUN_ROOT" ]; then
  echo "⚠️ 无法从进程命令行解析运行根：$PROC_CMD"
  echo "   （非标准部署形态——plist 直指仓内 dist。人工确认新鲜度）"
  exit 0
fi

FAILS=0
echo "── ① worktree 滞后 ──"
RUN_HEAD="$(git -C "$RUN_ROOT" rev-parse HEAD 2>/dev/null)"
MAIN_HEAD="$(git -C "$MAIN_ROOT" rev-parse HEAD 2>/dev/null)"
if [ -z "$RUN_HEAD" ] || [ -z "$MAIN_HEAD" ]; then
  echo "  ⚠️ git 读失败（运行根或主仓非 git？）——跳过本查"
elif [ "$RUN_HEAD" = "$MAIN_HEAD" ]; then
  echo "  ✓ 运行根与主仓同 HEAD（$(echo "$MAIN_HEAD" | cut -c1-8)）"
else
  BEHIND="$(git -C "$MAIN_ROOT" rev-list --count "$RUN_HEAD".."$MAIN_HEAD" 2>/dev/null || echo '?')"
  echo "  ❌ daemon 运行根滞后主仓 ${BEHIND} 笔（$(echo "$RUN_HEAD" | cut -c1-8) → $(echo "$MAIN_HEAD" | cut -c1-8)）"
  FAILS=$((FAILS + 1))
fi

echo "── ② dist 新鲜度（daemon 关键 src mtime vs dist mtime）──"
for pkg in daemon evolve; do
  SRC_NEWEST="$(find "$RUN_ROOT/engine/$pkg/src" -name '*.ts' -newer "$RUN_ROOT/engine/$pkg/dist" -print -quit 2>/dev/null || true)"
  if [ -n "$SRC_NEWEST" ]; then
    echo "  ❌ engine/${pkg}：src 有比 dist 新的文件（如 $(basename "$SRC_NEWEST")）——dist 陈旧"
    FAILS=$((FAILS + 1))
  else
    echo "  ✓ engine/${pkg}：dist 不旧于任何 src"
  fi
done

echo "── ③ 进程启动 vs dist ──"
DIST_MTIME_EPOCH="$(stat -f %m "$RUN_ROOT/engine/daemon/dist/cli.js" 2>/dev/null || echo 0)"
if [ "${PROC_START_EPOCH:-0}" -lt "$DIST_MTIME_EPOCH" ] 2>/dev/null; then
  echo "  ❌ daemon 进程启动早于 dist 构建（进程=$PROC_START_TS / dist=$(date -r "$DIST_MTIME_EPOCH" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)）"
  FAILS=$((FAILS + 1))
else
  echo "  ✓ 进程启动晚于 dist 构建（运行的是当前 dist）"
fi

echo "──────────────────────────────"
if [ "$FAILS" -gt 0 ]; then
  echo "❌ daemon 运行态滞后（${FAILS} 项）——修复落运行态第三层未闭合。处置："
  echo "   git -C $RUN_ROOT merge --ff-only \$(git -C $MAIN_ROOT rev-parse --abbrev-ref HEAD) \\"
  echo "     && npm --prefix $RUN_ROOT/engine/daemon run build \\"
  echo "     && npm --prefix $RUN_ROOT/engine/evolve run build \\"
  echo "     && launchctl kickstart -k gui/\$(id -u)/local.sofagent-daemon"
  exit 1
fi
echo "✅ daemon 运行态新鲜（worktree 同步 · dist 新 · 进程新）"
exit 0
