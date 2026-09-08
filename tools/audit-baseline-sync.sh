#!/usr/bin/env bash
# ============================================================
# audit-baseline-sync.sh · 审计引擎信任锚同步（「谁重建谁刷新」的绑定实现）
# ============================================================
# 同步三个信任锚文件到 ~/.sofagent/internal/：
#   1. audit-hash.txt            —— dist/index.js 的 SHA-256（兼容锚，格式不变）
#   2. audit-src-fingerprint.txt —— engine/audit/src 的源码指纹（第二个信号）
#   3. audit-dist-hash.txt       —— dist/**/*.js 的多入口聚合哈希（主锚，hook 拦截判定用）
#
# 为什么加第 3 个：dist 有多个可执行入口（index.js 与 cli-quick.js 都是 bin，
# agent-shield.js / cli/agent-shield.js 各自独立），而 index.js 的 import 图覆盖不到
# 那三个。只锚 index.js 时「只改 cli-quick.ts 并重建」观测不到，hook 会误报
# 「dist 未重建」；只覆写 cli-quick.js 这类劫持同样发现不了。聚合后两个方向都闭合。
# audit-hash.txt 之所以保留：@sofagent/core 的 runDoctor 按「整文件 == 一个 index.js
# 哈希」读它，改成聚合会让它恒判不匹配，故不动其语义，只继续维护。
#
# 为什么需要第二个信号：
#   dist 哈希变化有两种成因——「改了源码并重建」（合法、高频）与「不动源码、
#   直接替换 dist」（恶意、隐蔽）。只比对 dist 无法区分，只能一律拦截，
#   结果是每次 rebuild 后全仓 commit 被阻塞。追加源码指纹后，hook 可判定：
#     src 变 + dist 变 → 合法重建，放行
#     src 不变 + dist 变 → 真劫持，fail-closed
#   详见 tools/audit-src-fingerprint.mjs 头部注释。
#
# 为什么分开两个文件而不是改 audit-hash.txt 格式：
#   现有读取方（@sofagent/core 的 runDoctor）按「整文件内容 == 一个哈希」读取，
#   改成多行会让它误判为不匹配。拆文件可完全向后兼容，无需改动 core。
#
# 用法:
#   bash tools/audit-baseline-sync.sh            同步信任锚（默认）
#   bash tools/audit-baseline-sync.sh --check    只比对不写入，漂移则 exit 1
#   bash tools/audit-baseline-sync.sh --quiet    同步但不打印详情（供 postbuild 调用）
#
# 退出码:
#   0 = 已同步 / 一致；1 = 环境不满足或（--check 时）存在漂移
# ============================================================

set -o pipefail

CHECK_ONLY=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --quiet) QUIET=1 ;;
  esac
done

REPO_ROOT=""
if command -v git &>/dev/null && git rev-parse --show-toplevel &>/dev/null; then
  REPO_ROOT="$(git rev-parse --show-toplevel)"
fi
[ -z "$REPO_ROOT" ] && REPO_ROOT="$(pwd)"

SOFAGENT_HOME="${SOFAGENT_HOME:-$HOME/.sofagent}"
INTERNAL_DIR="$SOFAGENT_HOME/internal"
DIST="$REPO_ROOT/engine/audit/dist/index.js"
HASH_RECORD="$INTERNAL_DIR/audit-hash.txt"
DIST_AGG_RECORD="$INTERNAL_DIR/audit-dist-hash.txt"
SRC_RECORD="$INTERNAL_DIR/audit-src-fingerprint.txt"
FP_SCRIPT="$REPO_ROOT/tools/audit-src-fingerprint.mjs"
DIST_AGG_SCRIPT="$REPO_ROOT/tools/audit-dist-hash.mjs"

if [ ! -f "$DIST" ]; then
  echo "❌ dist 不存在: $DIST"
  echo "   请先构建：npm run build --workspace=engine/audit"
  exit 1
fi

if [ ! -f "$FP_SCRIPT" ]; then
  echo "❌ 源码指纹脚本不存在: $FP_SCRIPT"
  exit 1
fi

if [ ! -f "$DIST_AGG_SCRIPT" ]; then
  echo "❌ dist 聚合哈希脚本不存在: $DIST_AGG_SCRIPT"
  exit 1
fi

DIST_HASH=$(shasum -a 256 "$DIST" 2>/dev/null | cut -d' ' -f1)
DIST_AGG=$(node "$DIST_AGG_SCRIPT" "$REPO_ROOT" 2>/dev/null)
SRC_FP=$(node "$FP_SCRIPT" "$REPO_ROOT" 2>/dev/null)

if [ -z "$DIST_HASH" ]; then
  echo "❌ dist 哈希计算失败: $DIST"
  exit 1
fi
if [ -z "$SRC_FP" ]; then
  echo "❌ 源码指纹计算失败（不在 monorepo 内？）: $REPO_ROOT"
  exit 1
fi
if [ -z "$DIST_AGG" ]; then
  echo "❌ dist 聚合哈希计算失败（dist 不存在或为空？）: $REPO_ROOT/engine/audit/dist"
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  RECORDED_DIST=$(cat "$HASH_RECORD" 2>/dev/null | tr -d '[:space:]')
  RECORDED_AGG=$(cat "$DIST_AGG_RECORD" 2>/dev/null | tr -d '[:space:]')
  RECORDED_SRC=$(cat "$SRC_RECORD" 2>/dev/null | tr -d '[:space:]')
  DRIFT=0
  if [ "$RECORDED_DIST" != "$DIST_HASH" ]; then
    echo "⚠️  dist/index.js 哈希漂移：记录 ${RECORDED_DIST:0:12}… 当前 ${DIST_HASH:0:12}…"
    DRIFT=1
  fi
  if [ "$RECORDED_AGG" != "$DIST_AGG" ]; then
    echo "⚠️  dist 聚合哈希漂移：记录 ${RECORDED_AGG:0:12}… 当前 ${DIST_AGG:0:12}…"
    DRIFT=1
  fi
  if [ "$RECORDED_SRC" != "$SRC_FP" ]; then
    echo "⚠️  源码指纹漂移：记录 ${RECORDED_SRC:0:12}… 当前 ${SRC_FP:0:12}…"
    DRIFT=1
  fi
  if [ "$DRIFT" -eq 0 ]; then
    [ "$QUIET" -eq 0 ] && echo "✅ 信任锚与当前构建一致"
    exit 0
  fi
  echo "   修复：bash tools/audit-baseline-sync.sh"
  exit 1
fi

mkdir -p "$INTERNAL_DIR"
printf '%s\n' "$DIST_HASH" > "$HASH_RECORD" || { echo "❌ 写入失败: $HASH_RECORD"; exit 1; }
printf '%s\n' "$DIST_AGG" > "$DIST_AGG_RECORD" || { echo "❌ 写入失败: $DIST_AGG_RECORD"; exit 1; }
printf '%s\n' "$SRC_FP" > "$SRC_RECORD" || { echo "❌ 写入失败: $SRC_RECORD"; exit 1; }
chmod 600 "$HASH_RECORD" "$DIST_AGG_RECORD" "$SRC_RECORD" 2>/dev/null || true

if [ "$QUIET" -eq 0 ]; then
  echo "✅ 审计信任锚已同步"
  echo "   dist 聚合 = ${DIST_AGG:0:12}…  ($DIST_AGG_RECORD)"
  echo "   dist/index.js = ${DIST_HASH:0:12}…  (${HASH_RECORD}，兼容锚)"
  echo "   src        = ${SRC_FP:0:12}…  ($SRC_RECORD)"
fi
exit 0
