#!/usr/bin/env bash
# ============================================================
# check-storefront.sh · 仓外门面对账（v1.4.4 P-6 · C-3 + D-11-1 合并落地）
#
# 门禁目的：仓内数字有 check-docs/check-test-count 守护，仓外门面
#   （GitHub description / homepage / topics 数量）此前零守卫——
#   「66 tools」漂移三版无人拦的根因（v1.4.4 审查第四份 P1 实证）。
#   一条对外声称 = 一条可执行断言（含仓外元数据）。
#
# 对账面（四断言）：
#   ① description 工具数 = tool-registry.ts 实数（name: 'xxx' 去重计数）
#   ② description 插件数 = dsh-plugins + openclaw-plugins 目录实数
#   ③ homepage = https（非 http），且 package.json version 与发版时点对齐提示
#   ④ npm 裸名总包 sofagent 对账（v1.4.6）：registry 裸名版本 ≤ SSOT 主线版本
#      ——相等 = 已发最新 ✅ / 小于 = 未发布（发版中间态 ⏳ 放行，阶段九 publish 后自然消解）
#      / 大于 = 漂移 ❌（registry 比仓内新 = 仓内 bump 遗漏）
#      附带：总包 dependencies.@sofagent/audit 版本对账（未发布形态同 ⏳ 放行）
#
# 降级语义：gh / npm 不可达（离线/无凭证）→ SKIP 并显著提示，
#   不静默假绿（门禁三态：PASS / FAIL / SKIP-可见）。
#   CI 中 gh 凭证缺失时本节自动 SKIP——发布流程在本地跑（有 gh 登录态）。
#
# 用法：bash tools/check/check-storefront.sh
#   EXIT 0 = 全部对账通过；EXIT 1 = 有 FAIL；SKIP 不影响退出码但打印醒目提示
# ============================================================

_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

cd "$(dirname "$0")/../.." || exit 1

FAILS=0
SKIPS=0
# 覆盖度计数器（v1.4.9 G-2② · 口径见 tools/check/lib/coverage-line.sh）
#   ASSERTS = 结果行数（✓ + ❌，逐 echo 插桩）· SKIPS 由各跳过分支就地累加（本脚本既有形态）
ASSERTS=0

echo "🔍 仓外门面对账（GitHub 元数据 × 仓库实数）"
echo "════════════════════════════════════════════════════════════"

# ── 仓内实数提取（与 check-docs §15 同源口径）──
TOOL_COUNT=$(node -e "
const fs = require('fs');
const regSrc = fs.readFileSync('engine/mcp/src/tool-registry.ts', 'utf8');
const regCount = new Set([...regSrc.matchAll(/name:\s*'([a-z_]+)',/g)].map(m => m[1])).size;
console.log(regCount);
" 2>/dev/null || echo "")

DSH_COUNT=0
for d in engine/dsh-plugins/cordis-plugin-sofagent*; do
  [ -d "$d" ] && DSH_COUNT=$((DSH_COUNT + 1))
done
OC_COUNT=0
for d in engine/openclaw-plugins/sofagent-*; do
  [ -d "$d" ] && OC_COUNT=$((OC_COUNT + 1))
done
PLUGIN_TOTAL=$((DSH_COUNT + OC_COUNT))

if [ -z "$TOOL_COUNT" ] || [ "$TOOL_COUNT" = "0" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ tool-registry.ts 解析失败（TOOL_COUNT 空）——脚本口径可能过期"
  FAILS=$((FAILS + 1))
fi
echo "  仓内实数：MCP tools = ${TOOL_COUNT} · 插件 = ${PLUGIN_TOTAL}（DSH ${DSH_COUNT} + OpenClaw ${OC_COUNT}）"
echo ""

# ── 断言 ④：npm 裸名总包 sofagent 对账（独立于 gh——离线时 npm 侧同样 SKIP，互不吞没）──
# SSOT = engine/audit/package.json（与 bump-version.sh 同源）；比较用 node（BSD sort 无 -V）
SSOT_VER=$(node -e "console.log(require('./engine/audit/package.json').version)" 2>/dev/null)
BARE_VER=$(npm view sofagent version --prefer-online 2>/dev/null)
if [ -z "$SSOT_VER" ]; then
  echo "  ⏭️  [npm 裸名] SSOT 版本读取失败——仓内异常，跳过本断言"
  SKIPS=$((SKIPS + 1))
elif [ -z "$BARE_VER" ]; then
  echo "  ⏭️  [npm 裸名] registry 不可达（离线/限流）——npm 渠道本轮未对账，发布前补跑"
  SKIPS=$((SKIPS + 1))
else
  CMP=$(node -e "
    const [a,b] = process.argv.slice(1).map(v => v.split('.').map(Number));
    for (let i = 0; i < 3; i++) { if ((a[i]||0) !== (b[i]||0)) { console.log((a[i]||0) > (b[i]||0) ? 'gt' : 'lt'); process.exit(); } }
    console.log('eq');
  " "$BARE_VER" "$SSOT_VER")
  if [ "$CMP" = "eq" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ [npm 裸名] sofagent@$BARE_VER = SSOT ${SSOT_VER}（总包已发最新）"
  elif [ "$CMP" = "lt" ]; then
    echo "  ⏳ [npm 裸名] sofagent@$BARE_VER < SSOT ${SSOT_VER}——总包待阶段九 publish（发版中间态，放行）"
    SKIPS=$((SKIPS + 1))
  else
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [npm 裸名] sofagent@$BARE_VER > SSOT ${SSOT_VER}——registry 比仓内新（bump 遗漏/回滚未对齐），发版前必须修正"
    FAILS=$((FAILS + 1))
  fi
  # 附带：总包依赖面对账（audit 版本声明与 SSOT 一致；未发布形态/占位包无此字段 → 放行）
  BARE_DEP=$(npm view sofagent dependencies --json --prefer-online 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)['@sofagent/audit']||'')}catch{console.log('')}})")
  # v1.4.8：依赖面仅在「registry 版本 == SSOT」时严格对账。registry 落后于 SSOT 说明
  # 本版尚在发布中（或未发布）——此时 registry 上的依赖声明属于**上一版**，拿它比 SSOT 会
  # 在发版窗口内恒红（v1.4.8 实锤：主断言已按 lt ⏳ 放行，本附带断言却仍报 ❌ 造成假红）。
  if [ "$BARE_VER" = "$SSOT_VER" ] && [ -n "$BARE_DEP" ] && [ "$BARE_DEP" != "$SSOT_VER" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [npm 裸名] 总包 dependencies.@sofagent/audit=$BARE_DEP ≠ SSOT ${SSOT_VER}——聚合依赖版本漂移"
    FAILS=$((FAILS + 1))
  elif [ "$BARE_VER" != "$SSOT_VER" ] && [ -n "$BARE_DEP" ]; then
    echo "  ⏳ [npm 裸名] 总包依赖面待随本版发布（registry ${BARE_VER} < SSOT ${SSOT_VER}，其依赖声明属上一版）"
    SKIPS=$((SKIPS + 1))
  fi
fi
echo ""

# ── 断言 ⑤：umbrella README 的 MCP tool 数对账（仓内文件，但属对外门面）──
# 背景：umbrella 的 package.json files 含 README.md → 该数字直接出现在 npm 页面；
# 曾长期停在历史值（v1.4.6 的 84）无人拦——check-docs 不扫包 README，本脚本原只锚 GitHub description。
# 🔴 守卫不得空转：提取为空必须 FAIL（否则文件被删/格式变形后本断言静默跳过，等于没有）。
UMB_README="engine/umbrella/README.md"
if [ ! -f "$UMB_README" ]; then
  echo "  ⏭️  [umbrella README] 文件不存在——跳过本断言"
  SKIPS=$((SKIPS + 1))
else
  UMB_TOOLS=$(grep -oE '[0-9]+ tools' "$UMB_README" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "")
  if [ -z "$UMB_TOOLS" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [umbrella README] 未找到「N tools」声称——格式漂移或被改写，无法对账（该文件进 npm 发行面）"
    FAILS=$((FAILS + 1))
  elif [ "$UMB_TOOLS" != "$TOOL_COUNT" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [umbrella README] tool 数 ${UMB_TOOLS} ≠ 实数 ${TOOL_COUNT}——npm 页面将显示错误工具数"
    FAILS=$((FAILS + 1))
  else
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ [umbrella README] tool 数 ${UMB_TOOLS} = 实数 ${TOOL_COUNT}"
  fi
fi
echo ""

# ── 断言 ⑥：umbrella package.json description 数字对账（v1.4.9 G-1 补漏声称族）──
# 背景：`engine/umbrella/package.json` 的 description 是 npm 页面 / `npm search` 的输出面，
#   与 GitHub description 是**同一产品的两个门面**——v1.4.6 时点写死 (84 tools, 13 plugins)
#   后两版未同步（v1.4.7 增 11 tools / v1.4.8 插件 13→14），实测 GitHub 面 95/14、
#   umbrella 面 84/13：同一产品两个数（第 3 份审查报告坐实，P1-11）。
#   断言 ①/② 只对账 GitHub description，该字段游离在外 = 漏网声称族（G-1 同源根因）。
# 🔴 守卫不得空转：提取为空必须 FAIL（对齐断言 ⑤ 纪律），不得静默跳过。
UMB_PKG="engine/umbrella/package.json"
if [ ! -f "$UMB_PKG" ]; then
  echo "  ⏭️  [umbrella pkg description] 文件不存在——跳过本断言"
  SKIPS=$((SKIPS + 1))
else
  UMB_DESC=$(node -e "try{console.log(require('./${UMB_PKG}').description||'')}catch{console.log('')}" 2>/dev/null || echo "")
  UMB_DESC_TOOLS=$(echo "$UMB_DESC" | grep -oE '\(([0-9]+) tools' | grep -oE '[0-9]+' || echo "")
  UMB_DESC_PLUGINS=$(echo "$UMB_DESC" | grep -oE '([0-9]+) plugins' | grep -oE '[0-9]+' || echo "")
  if [ -z "$UMB_DESC_TOOLS" ] || [ -z "$UMB_DESC_PLUGINS" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [umbrella pkg description] 未找到「(N tools, M plugins)」声称——description 格式漂移或被改写（该字段进 npm 页面）"
    echo "      当前：${UMB_DESC}"
    FAILS=$((FAILS + 1))
  elif [ "$UMB_DESC_TOOLS" != "$TOOL_COUNT" ] || [ "$UMB_DESC_PLUGINS" != "$PLUGIN_TOTAL" ]; then
    ASSERTS=$((ASSERTS + 1)); echo "  ❌ [umbrella pkg description] 数字漂移：声称 ${UMB_DESC_TOOLS} tools / ${UMB_DESC_PLUGINS} plugins ≠ 实数 ${TOOL_COUNT}/${PLUGIN_TOTAL}"
    echo "      当前：${UMB_DESC}"
    echo "      修法：改 engine/umbrella/package.json description（数字以 tool-registry.ts + 插件目录实数为准）"
    FAILS=$((FAILS + 1))
  else
    ASSERTS=$((ASSERTS + 1)); echo "  ✓ [umbrella pkg description] ${UMB_DESC_TOOLS} tools / ${UMB_DESC_PLUGINS} plugins = 实数 ${TOOL_COUNT}/${PLUGIN_TOTAL}"
  fi
fi
echo ""

# ── gh 可达性探测（三态门禁的 SKIP 分支）──
GH_DESC=$(gh api repos/KongFangXun/sofagent --jq .description 2>/dev/null)
GH_HOME=$(gh api repos/KongFangXun/sofagent --jq .homepage 2>/dev/null)
GH_TOPIC_COUNT=$(gh api repos/KongFangXun/sofagent --jq '.topics | length' 2>/dev/null)
# 🔴 失效凭证守卫：token 失效时 gh api 把 JSON 错误体打到 **stdout**（非 stderr），
# 2>/dev/null 拦不住——三变量各自捕获到 112 字节的「Bad credentials」文本，均非空
# → 走不进下方 SKIP 分支 → 错误体被当 description 解析 = 假红两连
# （「未找到 (N tools) 声称」）。判据：任一变量含 "Bad credentials"/"message" JSON
# 错误特征 = 凭证失效，与离线同走 SKIP。
if [[ "$GH_DESC$GH_HOME$GH_TOPIC_COUNT" == *"Bad credentials"* ]] || [[ "$GH_DESC$GH_HOME$GH_TOPIC_COUNT" == *'"message"'* ]]; then
  GH_DESC=""; GH_HOME=""; GH_TOPIC_COUNT=""
fi

if [ -z "$GH_DESC" ] && [ -z "$GH_HOME" ] && [ -z "$GH_TOPIC_COUNT" ]; then
  echo "  ⏭️  SKIP：gh 不可达（离线 / 未登录）——仓外门面本轮未对账，发布流程须在本地补跑"
  SKIPS=$((SKIPS + 1))
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  SKIP=${SKIPS} FAIL=0（SKIP 不阻断，发布前必须补跑）"
  emit_coverage_line "check-storefront" "$ASSERTS" "$COVERED" "$SKIPS"
  exit 0
fi

# ── 断言 ①：description 工具数 ──
# 匹配「(N tools」形态——括号内可以是「(79 tools)」单声称，也可「(80 tools, 13 plugins)」复合声称
DESC_TOOLS=$(echo "$GH_DESC" | grep -oE '\(([0-9]+) tools' | grep -oE '[0-9]+' || echo "")
if [ -z "$DESC_TOOLS" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [description] 未找到「(N tools)」声称——description 格式漂移或被改写"
  echo "      当前：${GH_DESC}"
  FAILS=$((FAILS + 1))
elif [ "$DESC_TOOLS" != "$TOOL_COUNT" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [description] 工具数漂移：声称 ${DESC_TOOLS} ≠ 实数 ${TOOL_COUNT}"
  echo "      当前：${GH_DESC}"
  echo "      修法：gh repo edit --description 更新（数字以 tool-registry.ts 实数为准）"
  FAILS=$((FAILS + 1))
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [description] 工具数 ${DESC_TOOLS} = 实数 ${TOOL_COUNT}"
fi

# ── 断言 ②：description 插件数 ──
DESC_PLUGINS=$(echo "$GH_DESC" | grep -oE '([0-9]+) plugins' | grep -oE '[0-9]+' || echo "")
if [ -z "$DESC_PLUGINS" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [description] 未找到「N plugins」声称——description 格式漂移或被改写"
  FAILS=$((FAILS + 1))
elif [ "$DESC_PLUGINS" != "$PLUGIN_TOTAL" ]; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [description] 插件数漂移：声称 ${DESC_PLUGINS} ≠ 实数 ${PLUGIN_TOTAL}（DSH ${DSH_COUNT} + OC ${OC_COUNT}）"
  echo "      修法：gh repo edit --description 更新"
  FAILS=$((FAILS + 1))
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [description] 插件数 ${DESC_PLUGINS} = 实数 ${PLUGIN_TOTAL}"
fi

# ── 断言 ③：homepage https ──
if grep -q '^http://' <<< "$GH_HOME"; then
  ASSERTS=$((ASSERTS + 1)); echo "  ❌ [homepage] 使用 http 非 https：${GH_HOME}"
  echo "      修法：gh repo edit --homepage（https 版）"
  FAILS=$((FAILS + 1))
elif [ -z "$GH_HOME" ]; then
  echo "  ⏭️  [homepage] 未设置——非阻断（有值时纳入 https 断言）"
  SKIPS=$((SKIPS + 1))
else
  ASSERTS=$((ASSERTS + 1)); echo "  ✓ [homepage] ${GH_HOME}"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$FAILS" -gt 0 ]; then
  echo "  FAIL=${FAILS} SKIP=${SKIPS}——仓外门面与仓内实数不一致，发版前必须修正"
else
  echo "  FAIL=0 SKIP=${SKIPS}——仓外门面对账通过"
fi
# ── 覆盖度行（v1.4.9 G-2②）──
# covered 口径：本脚本实际读取的仓内门面文件数（umbrella README + umbrella package.json
#   + engine/audit/package.json；仓外 GitHub/npm 元数据不计入文件数）——仅计仓内侧。
COVERED=3
[ -f "engine/umbrella/README.md" ] || COVERED=$((COVERED - 1))
[ -f "engine/umbrella/package.json" ] || COVERED=$((COVERED - 1))
[ -f "engine/audit/package.json" ] || COVERED=$((COVERED - 1))
emit_coverage_line "check-storefront" "$ASSERTS" "$COVERED" "$SKIPS"
if [ "$FAILS" -gt 0 ]; then
  exit 1
else
  exit 0
fi
