#!/usr/bin/env bash
# ============================================================
# sofagent verify-evidence.sh · 最小可信验证器 · v0.83
# ============================================================
# 扫描 .sofagent/task/logs/ 下今日记录，检查有无客观证据
# （测试 exit code / lint 结果），有标 [已验证]，无标 [未验证]。
#
# 用法：bash sofagent/scripts/verify-evidence.sh [--daemon]
#       --daemon  静默模式，仅返回 exit code（0=已验证, 1=未验证/无日志）
# ============================================================
set -u

VERSION="0.83"
DAEMON_MODE=false
[ "${1:-}" = "--daemon" ] && DAEMON_MODE=true

TODAY=$(date +"%Y-%m-%d")
MONTH=$(date +"%Y-%m")
LOG_FILE="${PWD}/.sofagent/task/logs/${MONTH}/${TODAY}.md"

[ "$DAEMON_MODE" = false ] && echo "sofagent verify-evidence v${VERSION}"
[ "$DAEMON_MODE" = false ] && echo "扫描目标: ${LOG_FILE}"
[ "$DAEMON_MODE" = false ] && echo ""

if [ ! -f "$LOG_FILE" ]; then
  [ "$DAEMON_MODE" = false ] && echo "❌ 今日无 task/logs 记录"
  exit 1
fi

# 检查客观证据关键词
HAS_TEST=$(grep -ciE "exit.code|测试.*(pass|fail|通过|失败)|test.*(pass|fail)|✅.*pass|❌.*fail" "$LOG_FILE" 2>/dev/null || echo "0")
HAS_LINT=$(grep -ciE "lint|eslint|prettier|shellcheck" "$LOG_FILE" 2>/dev/null || echo "0")
HAS_BUILD=$(grep -ciE "build.*(success|fail)|编译.*(成功|失败)|npm run build|make" "$LOG_FILE" 2>/dev/null || echo "0")

TOTAL=$((HAS_TEST + HAS_LINT + HAS_BUILD))

if [ "$TOTAL" -gt 0 ]; then
  [ "$DAEMON_MODE" = false ] && echo "[已验证] 检测到客观证据：测试 ${HAS_TEST} 处 / lint ${HAS_LINT} 处 / build ${HAS_BUILD} 处"
  [ "$DAEMON_MODE" = false ] && echo "→ 本轮闭环评分有客观证据支撑"
  exit 0
else
  [ "$DAEMON_MODE" = false ] && echo "[未验证] 未检测到测试 / lint / build 等客观证据"
  [ "$DAEMON_MODE" = false ] && echo "→ 本轮闭环评分依赖 LLM 自评，可信度有限"
  exit 1  # daemon mode: failure = unverified
fi
