#!/bin/bash
# check-template-drift.sh — 模板漂移总闸（A2 同族 · v1.4.5 T12）
# ============================================================
# 职责：发版/安装链上的「模板四面」存在四处独立落点，任何一面落后
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
#   断言三：engine/audit/hooks/ 三文件版本标记 vs SSOT（hook 唯一源的时效性）
#     engine/core/dist 里编译进模板的 VERSION 插值结果必须与当前 SSOT
#     一致——dist 落后 = 发出去的包带旧模板（npm 包消费者看到的
#     hook 版本号旧 4 版这种事故的源头）。
#
#   断言四：load-chain 双份 handler.ts 同步（部署模板 vs 编译源）
#     包根 handler.ts 是部署到 ~/.openclaw/hooks/ 的模板，src/handler.ts
#     是编译源；tsconfig include 仅 src/**，包根那份不被编译——改 src
#     忘根副本即静默部署旧版（v1.4.5 审查 P1 实证：16 个 check 零覆盖）。
#
# 用法：
#   bash tools/check/check-template-drift.sh
#   bash tools/check/check-template-drift.sh --quiet   # 只输出 OK/FAIL
#
# 退出码：0=四断言全过 / 1=有漂移 / 2=脚本自身错误（SSOT 丢失等）
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

[ "$QUIET" = false ] && echo -e "${BOLD}── 模板漂移总闸（T12 · 六断言 vs SSOT v${SSOT_VERSION}）──${NC}"

# ═══ 断言一：HOOK 部署文件头部版本（三层 hook 全查）═══
# v1.4.5 审查 P2-4 扩展：此前只查 commit-msg，pre-commit 头 v1.4.4 漂移漏网（长在门禁盲区）。
HOOK_FILES="pre-commit commit-msg post-commit"
A1_FAIL=0
for _hook in $HOOK_FILES; do
  HOOK_FILE="engine/audit/hooks/${_hook}"
  if [ ! -f "$HOOK_FILE" ]; then
    echo -e "  ${RED}✗${NC} 断言一：hook 部署文件丢失：${HOOK_FILE}——检查器失明"
    exit 2
  fi
  HOOK_VER=$(grep -oE "sofagent ${_hook} hook v[0-9]+\.[0-9]+\.[0-9]+" "$HOOK_FILE" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
  if [ -z "$HOOK_VER" ]; then
    echo -e "  ${RED}✗${NC} 断言一：${_hook} 头部无版本签名（格式漂移）"
    A1_FAIL=$((A1_FAIL + 1))
  elif [ "$HOOK_VER" != "$SSOT_VERSION" ]; then
    echo -e "  ${RED}✗${NC} 断言一：${_hook} 头 v${HOOK_VER} ≠ SSOT v${SSOT_VERSION}——bump 时漏改"
    A1_FAIL=$((A1_FAIL + 1))
  else
    [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言一：${_hook} 头 v${HOOK_VER} = SSOT"
  fi
done
if [ "$A1_FAIL" -eq 0 ]; then
  OK_COUNT=$((OK_COUNT + 1))
else
  DRIFT=$((DRIFT + A1_FAIL))
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

# ═══ 断言三：hook 模板版本标记 vs SSOT ═══
# v1.4.8 变更：core 的 HOOK_TEMPLATE 已**删除**（它是与 hooks/ 目录「靠人工保持一致」的第二份源，
# 实际漂移后成为 S51 假红根因；`audit --init` 现读 hooks/ 唯一源）。故本断言改为守**新契约**：
# engine/audit/hooks/ 三文件的头部版本标记必须与 SSOT 一致——hook 是随包发布的产物，
# 版本标记落后 = 用户拿到的 hook 自报旧版本（npm 包消费者看到旧版本号这类事故的源头）。
HOOKS_DIR="engine/audit/hooks"
DRIFT_HOOKS=0
for _hf in pre-commit commit-msg post-commit; do
  _hp="$HOOKS_DIR/$_hf"
  if [ ! -f "$_hp" ]; then
    echo -e "  ${RED}✗${NC} 断言三：${_hp} 缺失（hook 唯一源不完整）"
    DRIFT=$((DRIFT + 1)); DRIFT_HOOKS=1; continue
  fi
  _hv=$(grep -oE "hook v[0-9]+\.[0-9]+\.[0-9]+" "$_hp" | head -1 | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
  if [ -z "$_hv" ]; then
    echo -e "  ${RED}✗${NC} 断言三：${_hp} 头部无「hook vX.Y.Z」版本标记"
    DRIFT=$((DRIFT + 1)); DRIFT_HOOKS=1
  elif [ "$_hv" != "$SSOT_VERSION" ]; then
    echo -e "  ${RED}✗${NC} 断言三：${_hp} 版本 v${_hv} ≠ SSOT v${SSOT_VERSION}（随包发布的 hook 自报旧版本）"
    DRIFT=$((DRIFT + 1)); DRIFT_HOOKS=1
  fi
done
if [ "$DRIFT_HOOKS" = "0" ]; then
  [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言三：hooks/ 三文件版本标记与 SSOT 一致（v${SSOT_VERSION}）"
  OK_COUNT=$((OK_COUNT + 1))
fi

# ═══ 断言四：load-chain 双份 handler.ts 同步 ═══
# 包根 handler.ts 是部署到 ~/.openclaw/hooks/ 的模板，src/handler.ts 是编译源。
# tsconfig include 仅 src/**，包根那份不被编译——改 src 忘根副本即静默部署旧版。
LC_ROOT="engine/hooks/sofagent-load-chain/handler.ts"
LC_SRC="engine/hooks/sofagent-load-chain/src/handler.ts"
if [ ! -f "$LC_ROOT" ] || [ ! -f "$LC_SRC" ]; then
  echo -e "  ${RED}✗${NC} 断言四：load-chain 双份 handler 缺一（${LC_ROOT} / ${LC_SRC}）——检查器失明"
  exit 2
fi
if ! diff -q "$LC_ROOT" "$LC_SRC" >/dev/null 2>&1; then
  echo -e "  ${RED}✗${NC} 断言四：load-chain 双份 handler.ts 漂移（包根部署模板 ≠ src 编译源）——改 src 忘根副本"
  DRIFT=$((DRIFT + 1))
else
  [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言四：load-chain 双份 handler.ts 一致"
  OK_COUNT=$((OK_COUNT + 1))
fi

# ═══ 断言五（v1.4.8 第5批）：DSH 侧 cordis.patch.yml 头部版本 vs SSOT ═══
# 与断言一同族：版本落在文件头部注释（不往 DSH patch schema 塞自造字段）。
# cordis.patch.yml 是 DSH profile layer 的「同包第二份 manifest」——bump 漏改即漂移。
DSH_PLUGIN_DIR="engine/dsh-plugins"
if [ ! -d "$DSH_PLUGIN_DIR" ]; then
  echo -e "  ${RED}✗${NC} 断言五：${DSH_PLUGIN_DIR} 不存在——检查器失明"
  exit 2
fi
A5_FAIL=0
A5_TOTAL=0
for _patch in "$DSH_PLUGIN_DIR"/cordis-plugin-sofagent*/cordis.patch.yml; do
  [ -f "$_patch" ] || continue
  A5_TOTAL=$((A5_TOTAL + 1))
  _plug=$(basename "$(dirname "$_patch")")
  # BSD grep 兼容：先取含版本号的行，再抽三段式数字
  PATCH_VER=$(grep -oE 'bundle patch v[0-9]+\.[0-9]+\.[0-9]+' "$_patch" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
  if [ -z "$PATCH_VER" ]; then
    echo -e "  ${RED}✗${NC} 断言五：${_plug}/cordis.patch.yml 头部无版本签名（格式漂移）"
    A5_FAIL=$((A5_FAIL + 1))
  elif [ "$PATCH_VER" != "$SSOT_VERSION" ]; then
    echo -e "  ${RED}✗${NC} 断言五：${_plug} cordis.patch.yml v${PATCH_VER} ≠ SSOT v${SSOT_VERSION}——bump 时漏改（跑 tools/gen/gen-plugin-manifests.mjs 重新生成）"
    A5_FAIL=$((A5_FAIL + 1))
  else
    [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言五：${_plug} cordis.patch.yml v${PATCH_VER} = SSOT"
  fi
done
if [ "$A5_TOTAL" -eq 0 ]; then
  echo -e "  ${RED}✗${NC} 断言五：${DSH_PLUGIN_DIR} 下找不到任何 cordis-plugin-sofagent*/cordis.patch.yml——搜索面为空，拒绝假绿"
  exit 2
fi
if [ "$A5_FAIL" -eq 0 ]; then
  OK_COUNT=$((OK_COUNT + 1))
else
  DRIFT=$((DRIFT + A5_FAIL))
fi

# ═══ 断言六（v1.4.8 第5批）：插件清单生成式幂等 ═══
# 生成器 --check 只比对不落盘：落盘内容必须与 plugins.json 的生成结果逐字节一致
# （等价于「再生成一次，git diff 必须为空」）；顺带对账各插件 src/index.ts 的
# 字面量 seam 与清单一致——「只改 plugins.json 忘改 src」在此变成硬红。
GEN="tools/gen/gen-plugin-manifests.mjs"
if [ ! -f "$GEN" ]; then
  echo -e "  ${RED}✗${NC} 断言六：生成器缺失 ${GEN}——检查器失明"
  exit 2
fi
if GEN_OUT=$(node "$GEN" --check 2>&1); then
  [ "$QUIET" = false ] && echo -e "  ${GREEN}✓${NC} 断言六：$(printf '%s\n' "$GEN_OUT" | tail -1)"
  OK_COUNT=$((OK_COUNT + 1))
else
  echo -e "  ${RED}✗${NC} 断言六：生成式漂移——落盘内容与 plugins.json 的生成结果不一致（或 src 字面量 seam 与清单不一致）"
  printf '%s\n' "$GEN_OUT" | sed 's/^/      /'
  DRIFT=$((DRIFT + 1))
fi

if [ "$DRIFT" -gt 0 ]; then
  echo -e "${RED}${BOLD}FAIL：模板漂移 ${DRIFT} 处${NC}"
  exit 1
fi
echo -e "${GREEN}${BOLD}OK：模板六断言全过（${OK_COUNT}/6）${NC}"
exit 0
