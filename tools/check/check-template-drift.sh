#!/bin/bash
# check-template-drift.sh — 模板漂移总闸（A2 同族 · v1.4.5 T12）
# ============================================================
# 职责：发版/安装链上的「模板三面」存在三处独立落点，任何一面落后
# 就构成漂移（v1.4.4 复盘发现 pluginMeta 硬编码落后 4 版的同族风险）：
#
#   断言一：HOOK 部署文件 vs HOOK_TEMPLATE
#     engine/audit/hooks/commit-msg 是 --init 实际部署的 hook 源文件，
#     其头部版本号必须与 SSOT（package.json）一致。HOOK_TEMPLATE 经
#     ${VERSION} 插值，源头即 SSOT——部署文件硬编码，是漂移高发点。
#
#   断言二：openclaw.plugin.json 家族 vs package.json（同包双 manifest）
#     四插件的 ClawHub manifest（openclaw.plugin.json）version 必须与
#     同目录 package.json 一致——两份 manifest 独立 bump 必漏改。
#
#   断言三：core dist 模板 vs src SSOT（编译产物时效性）
#     engine/core/dist 里编译进模板的 VERSION 插值结果必须与当前 SSOT
#     一致——dist 落后 = 发出去的包带旧模板（npm 包消费者看到的
#     hook 版本号旧 4 版这种事故的源头）。
#
# 用法：
#   bash tools/check/check-template-drift.sh
#   bash tools/check/check-template-drift.sh --quiet   # 只输出 OK/FAIL
#
# 退出码：0=三断言全过 / 1=有漂移 / 2=脚本自身错误（SSOT 丢失等）
#
# 设计纪律（对齐 check-guards.sh / check-unwired-exports.sh 家族）：
#   - macOS bash 3.2 兼容；BSD grep 兼容（无 \b \s）
#   - SSOT 文件丢失 → exit 2（检查器失明拒绝假绿）
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

QUIET=false
for _arg in "$@"; do
  case "$_arg" in
    --quiet) QUIET=true ;;
    --help|-h)
      echo "check-template-drift.sh — 模板漂移总闸（三断言）"
      echo "  (无参数)  hook 部署版本 / 插件双 manifest / core dist 编译时效"
      echo "  --quiet   只输出 OK/FAIL 摘要行"
      exit 0
      ;;
  esac
done

DRIFT=0
OK_COUNT=0

# ── SSOT ──
SSOT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || true)
if [ -z "$SSOT_VERSION" ]; then
  echo -e "${RED}✗ SSOT 丢失：package.json version 解析失败——门禁失明，拒绝继续${NC}"
  exit 2
fi

[ "$QUIET" = false ] && echo -e "${BOLD}── 模板漂移总闸（T12 · 三断言 vs SSOT v${SSOT_VERSION}）──${NC}"

# ═══ 断言一：HOOK 部署文件头部版本 ═══
HOOK_FILE="engine/audit/hooks/commit-msg"
if [ ! -f "$HOOK_FILE" ]; then
  echo -e "  ${RED}✗${NC} hook 部署文件丢失：${HOOK_FILE}——检查器失明"
  exit 2
fi
HOOK_VER=$(grep -oE 'sofagent commit-msg hook v[0-9]+\.[0-9]+\.[0-9]+' "$HOOK_FILE" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
if [ -z "$HOOK_VER" ]; then
  echo -e "  ${RED}✗${NC} 断言一：${HOOK_FILE} 头部无版本签名（格式漂移）"
  DRIFT=$((DRIFT + 1))
elif [ "$HOOK_VER" != "$SSOT_VERSION" ]; then
  echo -e "  ${RED}✗${NC} 断言一：hook 部署文件 v${HOOK_VER} ≠ SSOT v${SSOT_VERSION}——bump 时漏改 ${HOOK_FILE}"
  DRIFT=$((DRIFT + 1))
else
  [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言一：hook 部署文件 v${HOOK_VER} = SSOT"
  OK_COUNT=$((OK_COUNT + 1))
fi

# ═══ 断言二：openclaw.plugin.json 家族 vs 同包 package.json ═══
PLUGIN_DIR="engine/openclaw-plugins"
if [ ! -d "$PLUGIN_DIR" ]; then
  echo -e "  ${YELLOW}⚠${NC} 断言二：${PLUGIN_DIR} 不存在，跳过"
else
  A2_FAIL=0
  A2_TOTAL=0
  for plugin_json in "$PLUGIN_DIR"/*/package.json; do
    [ -f "$plugin_json" ] || continue
    plugin_dir=$(dirname "$plugin_json")
    manifest="$plugin_dir/openclaw.plugin.json"
    # 无 ClawHub manifest 的插件不在此断言面（有 package.json 即有 version）
    [ -f "$manifest" ] || continue
    A2_TOTAL=$((A2_TOTAL + 1))
    PKG_VER=$(node -p "require('./${plugin_json}').version" 2>/dev/null || true)
    MANIFEST_VER=$(node -p "require('./${manifest}').version" 2>/dev/null || true)
    if [ -z "$PKG_VER" ] || [ -z "$MANIFEST_VER" ]; then
      echo -e "  ${RED}✗${NC} 断言二：${plugin_json##*engine/} 双 manifest 解析失败（JSON 非法？）"
      A2_FAIL=$((A2_FAIL + 1))
    elif [ "$PKG_VER" != "$MANIFEST_VER" ]; then
      echo -e "  ${RED}✗${NC} 断言二：$(basename "$plugin_dir") package.json v${PKG_VER} ≠ openclaw.plugin.json v${MANIFEST_VER}——双 manifest 漂移"
      A2_FAIL=$((A2_FAIL + 1))
    else
      [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言二：$(basename "$plugin_dir") 双 manifest 一致（v${PKG_VER}）"
    fi
  done
  if [ "$A2_FAIL" -eq 0 ] && [ "$A2_TOTAL" -gt 0 ]; then
    OK_COUNT=$((OK_COUNT + 1))
  elif [ "$A2_TOTAL" -gt 0 ]; then
    DRIFT=$((DRIFT + A2_FAIL))
  fi
fi

# ═══ 断言三：core dist 模板编译时效 ═══
CORE_DIST="engine/core/dist/config-template.js"
if [ ! -f "$CORE_DIST" ]; then
  echo -e "  ${YELLOW}⚠${NC} 断言三：${CORE_DIST} 不存在（未构建？），跳过——构建后本断言生效"
else
  DIST_HOOK_VER=$(node -e "
    const m = require('./${CORE_DIST}');
    const v = (m.HOOK_TEMPLATE || '').match(/hook v([0-9]+\.[0-9]+\.[0-9]+)/);
    console.log(v ? v[1] : '');
  " 2>/dev/null || true)
  if [ -z "$DIST_HOOK_VER" ]; then
    echo -e "  ${RED}✗${NC} 断言三：dist HOOK_TEMPLATE 解析失败（模板结构变更？）"
    DRIFT=$((DRIFT + 1))
  elif [ "$DIST_HOOK_VER" != "$SSOT_VERSION" ]; then
    echo -e "  ${RED}✗${NC} 断言三：core dist 模板编译时版本 v${DIST_HOOK_VER} ≠ SSOT v${SSOT_VERSION}——dist 落后，重跑 npm run build（engine/core）"
    DRIFT=$((DRIFT + 1))
  else
    [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言三：core dist 模板编译时效一致（v${DIST_HOOK_VER}）"
    OK_COUNT=$((OK_COUNT + 1))
  fi
fi

if [ "$DRIFT" -gt 0 ]; then
  echo -e "${RED}${BOLD}FAIL：模板漂移 ${DRIFT} 处${NC}"
  exit 1
fi
echo -e "${GREEN}${BOLD}OK：模板三断言全过（${OK_COUNT}/3）${NC}"
exit 0
