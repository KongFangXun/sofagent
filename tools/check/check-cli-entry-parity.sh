#!/usr/bin/env bash
# ============================================================
# check-cli-entry-parity.sh · 入口等价性门禁（v1.8.0 fresh-eyes F12/P0）
# ============================================================
# 守护对象：install.sh 产出的多个同名 sofagent 入口能力集等价。
#
# 背景（fresh-eyes 第 3 轮 P0 实锤）：install.sh 曾在 npm-prefix 与
# $SOFAGENT_HOME/bin 各写一份同名 sofagent——npm-prefix 份自造「audit-first
# 参数改写」（shift 去域词直传本地 dist），而 dist 引擎无 audit 子命令 ⇒ 裸
# `sofagent audit` exit 2、非 audit 域（version/web/help）全部「未知子命令」；
# $SOFAGENT_HOME 份是能跑的 umbrella 实现。PATH 靠前者为准时安装态头号命令族
# 全灭，且无任何门禁比对等价性。v1.8.0 收敛为 thin shim 后以本门禁防再发。
#
# 判定（两态）：
#   动态态（本机安装态可得）：对 argv 组 [version] [--help] [help]，npm-prefix
#     shim 与 $SOFAGENT_HOME 入口 rc 两两相等即绿。
#     ⚠️ argv 组不含 audit：安装态 bin/sofagent 对业务域（audit 等）经 *） 分支
#     转发 sofagent-router——router 不在位时报「未检测到 sofagent 域路由」exit 2
#     属已声明的安装态边界，混入断言会在最小安装机器上假红。audit 域等价性由
#     安装态验证（router 在位的机器实跑）覆盖，不在本门禁面。
#   静态态（安装态不可得，如 CI 无 install）：断言 install.sh 内 shim heredoc
#     ① exec 指向单入口（exec bash "$_entry" 形态）；② 无参数改写逻辑
#     （不得出现 shift 去 audit 域词形态）。防 shim 退回自造实现。
#
# 退出码：0 = 等价（或静态断言通过）；1 = 不等价 / 静态断言失败；2 = 失明
#   （找不到判定对象——install.sh 无 shim 段且无安装态，无从判等价即拒假绿）。
#
# 用法：bash tools/check/check-cli-entry-parity.sh
# ============================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_SH="$REPO_ROOT/install.sh"

fail_count=0

# ── 定位两入口 ──────────────────────────────────────────────
# npm-prefix shim：install.sh 安装时写入 npm 全局 bin（探测 npm prefix -g）；
# 本地安装态单入口：${SOFAGENT_HOME:-$HOME/.sofagent}/bin/sofagent（与安装态
# bin 脚本同款取法——engine/scripts/lib/platform-detect.sh resolve_data_dir()）。
SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
HOME_ENTRY="$SOFAGENT_HOME/bin/sofagent"

NPM_PREFIX_BIN=""
if command -v npm >/dev/null 2>&1; then
  _prefix="$(npm prefix -g 2>/dev/null)"
  [ -n "$_prefix" ] && NPM_PREFIX_BIN="$_prefix/bin"
fi
NPM_ENTRY=""
[ -n "$NPM_PREFIX_BIN" ] && [ -f "$NPM_PREFIX_BIN/sofagent" ] && NPM_ENTRY="$NPM_PREFIX_BIN/sofagent"

echo "── 入口等价性门禁（check-cli-entry-parity.sh）──"
echo "  单入口（安装态）: ${HOME_ENTRY}$([ -f "$HOME_ENTRY" ] && echo ' [存在]' || echo ' [缺失]')"
echo "  npm-prefix shim: ${NPM_ENTRY:-未探测到}$([ -n "$NPM_ENTRY" ] && echo ' [存在]' || echo '')"

# ── 静态断言（始终执行——shim 源头守卫）──────────────────────
static_fail=0
if [ ! -f "$INSTALL_SH" ]; then
  echo "  ✗ 失明：install.sh 不存在于 $INSTALL_SH"
  exit 2
fi

# 断言 1：shim heredoc 段 exec 指向单入口（thin shim 形态）
# heredoc 内 \$ 转义形态（unquoted WRAPPER_EOF）：exec bash "\$_entry" "\$@"
if grep -q 'exec bash "\\\$_entry" "\\\$@"' "$INSTALL_SH"; then
  echo "  ✓ [静态] shim exec 指向单入口（thin shim 形态在位）"
else
  echo "  ✗ [静态] install.sh shim 段未见 exec 指向单入口——shim 可能退回自造实现"
  static_fail=1
fi

# 断言 2：无参数改写逻辑（不得出现 shift 去 audit 域词的残留形态）
# 匹配 install.sh heredoc 内的参数改写行（转义形态：\$1 = audit → shift）
if grep -q 'if \[ "\$1" = "audit" \]; then shift; fi' "$INSTALL_SH"; then
  echo "  ✗ [静态] install.sh 仍含 audit-first 参数改写逻辑（shift 去域词）——F12 修复回退"
  static_fail=1
else
  echo "  ✓ [静态] 无 audit-first 参数改写逻辑（F12 修复在位）"
fi

[ "$static_fail" -ne 0 ] && fail_count=$((fail_count + 1))

# ── 动态断言（安装态双入口可得时执行）───────────────────────
if [ -f "$HOME_ENTRY" ] && [ -n "$NPM_ENTRY" ] && [ "$NPM_ENTRY" != "$HOME_ENTRY" ]; then
  echo "  动态比对（同 argv 同 rc）："
  for argv in "version" "--help" "help"; do
    # shellcheck disable=SC2086
    "$NPM_ENTRY" $argv >/dev/null 2>&1
    rc_shim=$?
    # shellcheck disable=SC2086
    "$HOME_ENTRY" $argv >/dev/null 2>&1
    rc_home=$?
    if [ "$rc_shim" -eq "$rc_home" ]; then
      echo "  ✓ [动态] argv=[$argv] rc 一致（shim=${rc_shim} 单入口=${rc_home}）"
    else
      echo "  ✗ [动态] argv=[$argv] rc 不一致（shim=${rc_shim} 单入口=${rc_home}）——入口能力集漂移"
      fail_count=$((fail_count + 1))
    fi
  done
else
  # 双入口不可同时可得：静态断言已兜底，动态态降级为可见信息（不假绿——静态度仍在判）
  echo "  ⓘ [动态] 双入口不可同时探测（npm-prefix shim 或安装态单入口缺失）——仅静态断言面生效"
fi

# ── 汇总 ────────────────────────────────────────────────────
if [ "$fail_count" -eq 0 ]; then
  echo "  ✓ 入口等价性门禁通过"
  exit 0
elif [ -f "$HOME_ENTRY" ] || [ -n "$NPM_ENTRY" ]; then
  echo "  ✗ 入口等价性门禁失败（$fail_count 项）"
  exit 1
else
  # 两入口全缺且静态度已红 → 判定对象存在（install.sh 在）但断言失败，exit 1
  # 两入口全缺且静态度绿 → 无从动态判，静态度兜底通过，exit 0（上面已处理）
  echo "  ✗ 入口等价性门禁失败（$fail_count 项）"
  exit 1
fi
