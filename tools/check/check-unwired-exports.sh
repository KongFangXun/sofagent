#!/bin/bash
# check-unwired-exports.sh — 零接线导出门禁（A2 · v1.4.5 T11）
# ============================================================
# 职责：/* @public */ 导出的符号若无生产调用点（只在定义文件与测试中出现），
# 就是「零接线导出」——API 面声称有能力、运行时实际无人调用。此类漂移在
# v1.4.4 复盘中暴露（runInspectors / runAllLayers / runDreamCycle /
# registerBuiltinSlashCommands 四符号零生产调用），本门禁防复发。
#
# v1.4.5 二次修订（daemon 批完工后撤豁免）：四符号已接线/间接接线，
# 默认豁免清空。新增「间接消费」判定口径，规则如下：
#
# 判定口径（生产消费点）：
#   【直接接线】命中处满足以下全部条件：
#     - 不在：符号定义/导出文件本身（SYMBOLS 表中的 file 字段）
#     - 不在：*test* / *fixture* / dist/ / node_modules/
#     - 且非注释行（行首 // 或 * 或 /*）
#     任一命中的行 = 直接生产调用。
#   【间接接线】SYMBOLS 条目声明 via=<delegate[,delegate...]>，且每个
#     delegate 同时满足：
#     (a) 符号定义文件内出现该 delegate 名（证明委托关系存在于代码——
#         聚合函数体内调用了 delegate，而非仅在清单里声称）；
#     (b) delegate 自身存在生产调用点（标准排除规则，且排除符号定义
#         文件——该文件内的引用是委托本身，不算外部消费）。
#     语义：聚合入口（如 runInspectors）未被点名调用，但其全部能力
#     经 delegate（各 inspector 函数）被生产调度（cron → 分层巡检）——
#     能力已接线，入口函数保留为兼容 API。任一 delegate 不满足即整符号
#     判零接线（防「声明 5 个 delegate 只验证 1 个」的糊弄）。
#
# 豁免机制：--known-pending <符号,符号,...>
#   已知待接线符号可显式豁免（豁免清单必须写明 reason——见脚本尾部登记表）。
#   豁免是债务登记，不是免死金牌：每次豁免在发版 changelog 里必须可追溯。
#   v1.4.5 起默认豁免为空——四符号接线完成后已全部移除（daemon 批交付）。
#
# 用法：
#   bash tools/check/check-unwired-exports.sh
#   bash tools/check/check-unwired-exports.sh --known-pending someSymbol
#
# 退出码：0=全部有接线或已豁免 / 1=存在零接线导出 / 2=脚本自身错误
#
# 设计纪律（对齐 check-guards.sh 家族风格）：
#   - macOS bash 3.2 兼容（无 mapfile/declare -A/关联数组）
#   - BSD grep 兼容（不用 \b \s；词边界用 grep -w）
#   - 检查器故障宁可报错不假绿（文件丢失 → exit 2）
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ── 受控符号表（symbol:定义文件[:via=delegate[,delegate...]]）──
# 新增 @public 导出若无接线计划，登记于此——表本身就是接线债务清单。
# via= 声明间接消费（聚合入口经 delegate 生产调度）：规则见文件头「间接接线」段。
#   runInspectors: 函数体调用的各 inspector（analyzeAuditHistory 等）被
#     inspector-layers.ts LAYER_INSPECTORS 生产消费（cron.ts:313 按层调度）——
#     入口保留为兼容 API（v1.3.x 起公开），能力已接线。
#   runAllLayers: 内部调 runLayeredInspection（L1→L2→L3 遍历），后者被
#     cron.ts:313 生产调度——同样是兼容入口的间接接线形态。
#   compactIfNeeded（v1.4.9 P1-1 登记）：定义在 compactor.ts，此前**零生产调用点**
#     （全仓只出现在 load-chain-compact.test.ts）。本版接线进
#     engine/inject/src/index.ts 的 buildConstrainedSystemPrompt（env 门控、
#     缺省关闭）⇒ 已为真接线，**不许走 --known-pending 豁免**。
SYMBOLS="runInspectors:engine/daemon/src/inspectors/index.ts:via=analyzeAuditHistory,checkConflict,checkDoctorHealth,checkKnowledgeFreshness,checkKnowledgeHealth,checkSkillStaleness,runAuditTrailInspector
runAllLayers:engine/daemon/src/inspector-layers.ts:via=runLayeredInspection
runDreamCycle:engine/daemon/src/dream-cycle/state-machine.ts
registerBuiltinSlashCommands:engine/core/src/slash-commands/index.ts
gateDataPush:engine/train/src/data-push.ts
createSshTrainChannel:engine/daemon/src/cloud-exec.ts
chainDualChannelEvent:engine/daemon/src/cloud-events.ts
compactIfNeeded:engine/inject/src/load-chain/compactor.ts"

# ── SDK-face 白名单（--since 版本 diff 驱动模式的降级通道）──
# 语义：SDK 面先行、管线接线排期——白名单条目必须带 reason 与目标版本，
# 格式：符号:reason:目标版本（冒号分隔；reason 内禁用冒号）。
# 这是债务登记不是免死金牌。**两种失败态**（v1.5.1 J3 补实现，见下方「白名单自审」段）：
#   ① **到期**：目标版本 ≤ 当前 SSOT（package.json.version）仍未接线 ⇒ 自动转红
#   ② **孤儿键**：符号名在当前 engine 源码零命中（已更名/删除）⇒ 转红
#      （孤儿键即使实现了版本比对也匹配不上，必须单独判——防「静默豁免不存在的符号」）
# ⚠️ 历史条目 canaryRouteRequest（`weight-canary-routeRequest` → TASK-32 更名后）的处置沿革：
#   ① 两条失败态曾同时成立（目标 v1.5.0 = 当前 SSOT 的到期态；条目名是旧名导致引擎零命中 = 孤儿键）。
#      **修法是接线或更名收编**，**不是**把目标版本改成下一版（那是「放宽阈值让它变绿」）。
#   ② 孤儿键已修：条目名改为真实符号 `canaryRouteRequest`（定义在 engine/train/src/weight-canary.ts）——
#      条目名若不指向真实符号，白名单就是在静默豁免一个不存在的符号，且版本比对永远匹配不上。
#   ③ 到期态曾按「预期债务可见化」保留为红，不续期、不删条目、不改目标版本（删掉后债务在门禁里不可见）。
#   ④ 真清偿落地：权重灰度 AB 从 SDK 面接进生产上行管线——`canaryRouteRequest` 现有生产调用点
#      engine/mcp/src/tools/device-data-push.ts（`resolveUpstreamCanaryRoute`，经 MCP 工具
#      `device_data_push` 在 engine/mcp/src/tool-registry.ts 调用）与
#      engine/mcp/src/tools/router-session-push.ts（同语义管线，session 上行复用）。
#      ⇒ 债务已清，条目**摘除**。摘除不同于续期/改目标版本，是本机制唯一认可的清偿动作。
# 机制保留为空串：后续 SDK 先行债务按 `符号:reason:目标版本` 继续登记即可（登记即声明「尚无生产调用点」）。
SDK_FACE_WAIVER=""

# ── --since <prev-tag>：版本 diff 驱动模式 ──
# 用 git diff <prev-tag>..HEAD 提取 engine/**/src/*.ts 新增的 @public 导出
# 符号清单，对每个新增符号跑与 SYMBOLS 表同样的接线判定（直接/间接/零接线）。
# 三种提取形态全覆盖：
#   ① 桶文件再导出块：`/* @public */ export { sym1, sym2 } from './x'`
#      （多行块——awk 状态机：@public 行进入采集，到 `}` 结束）
#   ② 声明处直接导出：`/* @public */ export function foo` / `export const bar`
#   ③ 单行 export 列表：`export { a, b }`
# 同名消歧（防 routeRequest 双包假阳性）：import 消费按「来源包 + 符号名」
# 双键匹配——从 from '@sofagent/xxx' 反查该包桶文件再定位符号，不做裸符号 grep。
SINCE_TAG=""
for _arg in "$@"; do
  case "$_arg" in
    --since) shift_next_since=1 ;;
    --since=*) SINCE_TAG="${_arg#--since=}" ;;
    *)
      if [ "${shift_next_since:-0}" = "1" ]; then
        SINCE_TAG="$_arg"
        shift_next_since=0
      fi
      ;;
  esac
done

# ── 已知待接线豁免（--known-pending 覆盖此默认值）──
# v1.4.5 daemon 批完工后撤空——四符号已接线（runDreamCycle→cron.ts:346 直调；
# registerBuiltinSlashCommands→slash-commands-wiring.ts:80 直调）或间接接线
# （runInspectors/runAllLayers 经 via= 声明，见上表注释）。历史上四符号曾
# 整体豁免（v1.4.4 复盘登记的接线债务），接线完成后移除——豁免不是免死金牌。
KNOWN_PENDING_DEFAULT=""
KNOWN_PENDING="$KNOWN_PENDING_DEFAULT"

for _arg in "$@"; do
  case "$_arg" in
    --known-pending) shift_next=1 ;;
    *)
      if [ "${shift_next:-0}" = "1" ]; then
        KNOWN_PENDING="$_arg"
        shift_next=0
      fi
      ;;
  esac
done
# 支持等号形式 --known-pending=X
for _arg in "$@"; do
  case "$_arg" in
    --known-pending=*) KNOWN_PENDING="${_arg#--known-pending=}" ;;
    --help|-h)
      echo "check-unwired-exports.sh — 零接线导出门禁"
      echo "  (无参数)                扫描符号表全部符号的生产调用点"
      echo "  --known-pending <list>  显式豁免清单（逗号分隔符号名）"
      echo "  --known-pending=<list>  同上（等号形式）"
      exit 0
      ;;
  esac
done

FAIL_COUNT=0
PASS_COUNT=0
WAIVED_COUNT=0
# 白名单自审失败数（v1.5.1 J3）——与 FAIL_COUNT 分开计数，避免污染「零接线」计数契约
WAIVER_FAIL=0

echo -e "${BOLD}── 零接线导出门禁（A2 · @public 符号生产调用点断言）──${NC}"
echo ""

# ============================================================
# 生产调用点判定——**共用实现**（v1.5.1 J2）
# ============================================================
# 旧实现把同一套排除规则在「SYMBOLS 表模式」与「--since 模式」里**各写一遍**，于是各自
# 演化：--since 那份漏了「符号自己的**定义行**」排除 ⇒ 一个**只有定义、零调用**的符号，
# 其定义行被算作生产调用点 ⇒ 输出 `✓ 生产调用 <定义文件>:<行>` ⇒ --since 模式整类假绿
# （本仓「同一职责两套实现」的又一实例，与 K2 同族）。
# 现抽为单一实现，两种模式共用一份——不再各写一套。
# 排除规则（生产消费点）：
#   ① dist/  ② node_modules  ③ *.test.ts / *.test.mjs  ④ __tests__  ⑤ fixtures
#   ⑥ 注释行（行首 // / * / /*）  ⑦ 再导出块 `export { …, sym, … }`
#   ⑧ 裸符号续行（行内仅缩进 + 符号名 + 尾逗号）  ⑨ 类型形状声明（`sym: (…)` / `sym: typeof`）
#   ⑩ **符号定义行**（`export function sym(` / `export async function sym(` / `export const
#      sym =` / `export class sym`）——v1.5.1 J2 新增，两种模式共用（对 SYMBOLS 表模式是
#      no-op：定义行本就在其 def_file 内、已被文件级排除，故行为不变）
# 扫描面（v1.5.1 J2 修正）：`engine/` **＋ `tools/`**。
#   原实现只扫 engine/ ⇒ 真实消费方在 `tools/dashboard/serve-dashboard.mjs`（Dashboard 治理
#   tab 直调 computeGovernanceKpis / formatGovernanceWeekly / buildDatasetLineageReport）
#   时被判「零接线」——与 J4「tools/ 是覆盖盲区」同族。**真有调用方的符号必须仍判 ✓
#   （防误伤）**，故扫描面补 tools/（.*.mjs* 一并纳入）。此改动只会**增加**调用点证据
#   （不会把已绿的判红），方向与「放宽阈值让它变绿」相反。
# 可选第 3 参：定义文件路径——额外排除该文件内全部命中（SYMBOLS 表模式的既有语义；
#   在 head 截断**之前**过滤，保证与旧实现的返回集合一致）
# 用法: prod_callers <符号> [<取前 N 条，默认 5>] [<定义文件>]
prod_callers() {
  local _sym="$1" _limit="${2:-5}" _def="${3:-}"
  local _out
  _out=$(grep -rnw "$_sym" engine/ tools/ --include='*.ts' --include='*.mjs' 2>/dev/null \
    | grep -v "/dist/" \
    | grep -v "node_modules" \
    | grep -v "\.test\.ts" \
    | grep -v "\.test\.mjs" \
    | grep -v "__tests__" \
    | grep -v "fixtures" \
    | grep -v ":[0-9]*:[[:space:]]*//" \
    | grep -v ":[0-9]*:[[:space:]]*\*" \
    | grep -v ":[0-9]*:[[:space:]]*/\*" \
    | grep -v ":[[:space:]]*export[[:space:]]*{[^}]*${_sym}[^}]*}" \
    | grep -v ":[[:space:]]*${_sym}[[:space:]]*,[[:space:]]*$" \
    | grep -v ":[[:space:]]*${_sym}[[:space:]]*$" \
    | grep -v ":[[:space:]]*${_sym}[[:space:]]*:[[:space:]]*(" \
    | grep -v ":[[:space:]]*${_sym}[[:space:]]*:[[:space:]]*typeof" \
    | grep -vE ":[0-9]+:[[:space:]]*(export[[:space:]]+)?(async[[:space:]]+)?(function|const|class)[[:space:]]+${_sym}([^A-Za-z0-9_]|$)" \
    || true)
  if [ -n "${_def}" ]; then
    _out=$(printf '%s\n' "${_out}" | grep -v "${_def}" || true)
  fi
  printf '%s\n' "${_out}" | grep -v '^$' | head -"${_limit}" || true
}

# ============================================================
# SDK-face 白名单自审（v1.5.1 J3）：到期判定 + 孤儿键判定
# ============================================================
# 为什么必须独立自审：白名单原实现**只**在 --since 循环内、且**仅当该符号出现在本次新增
# 导出集合里**时才被读到 ⇒「目标版本已到期」这件事**永远不会被判定**（脚本此前从不读取
# 任何版本：`grep -n "version"` 零命中）。注释承诺的「到期自动转红」是**空的**——
# 债务登记被当成了免死金牌。故在此对**每一条**白名单独立判定两种失败态：
#   ① 到期：目标版本 ≤ 当前 SSOT（package.json.version）仍在此 ⇒ 转红
#   ② 孤儿键：符号名在当前 engine 源码**零命中**（已更名/删除）⇒ 转红
#      （即使实现了版本比对，孤儿键也匹配不上——两种失败态必须分开判）
# ⚠️ 不得为让当前态变绿把目标版本改成 v1.5.1——那是「放宽阈值让它变绿」（必读第 9 条）。
_unwired_ssot=$(node -p "require('./package.json').version" 2>/dev/null || true)
if [ -z "${_unwired_ssot}" ]; then
  echo -e "  ${RED}✗${NC} 读不到 package.json 版本（SSOT）——白名单到期判定无法进行，拒绝静默放行"
  exit 2
fi
# v1.5.1 J3 修复：版本号语义比较**必须先归一化前缀**。
#   原实现直接 `awk -F.` ⇒ `v1.6.0` 的 $1 是字符串 "v1"（数值上下文取 0）⇒ 得 6000，
#   而 SSOT 侧（package.json 不带 v）`1.5.0` 得 1005000 ⇒ `1005000 -ge 6000` 为真
#   ⇒「目标版本仍在将来」被误判成「已到期」；反方向（SSOT 带 v / 目标不带）则会**假绿**。
#   即：前缀不统一时版本比较整体失效，两个方向一红一绿都是错的。
# 不可解析 ⇒ 输出 ERR，由调用方 fail-loud（**不得**把 ERR 当 0 参与比较）。
_unwired_vnum() {
  local _v
  _v=$(printf '%s' "$1" | sed -E 's/^[vV]//; s/[-+].*$//')
  printf '%s' "${_v}" | awk -F. '
    { if ($1 !~ /^[0-9]+$/) { print "ERR"; exit }
      m = ($2 == "") ? 0 : $2
      p = ($3 == "") ? 0 : $3
      if (m !~ /^[0-9]+$/ || p !~ /^[0-9]+$/) { print "ERR"; exit }
      printf "%d", ($1 * 1000000) + (m * 1000) + p }'
}
while IFS= read -r sw_entry; do
  [ -z "${sw_entry}" ] && continue
  sw_sym="${sw_entry%%:*}"
  _sw_rest="${sw_entry#*:}"
  _sw_reason="${_sw_rest%%:*}"
  _sw_target="${_sw_rest#*:}"
  if [ "${_sw_target}" = "${_sw_rest}" ] || [ -z "${_sw_target}" ]; then
    echo -e "  ${RED}✗${NC} SDK-face 白名单条目缺第三段目标版本：${sw_entry}（格式 符号:reason:目标版本）"
    WAIVER_FAIL=$((WAIVER_FAIL + 1))
    continue
  fi
  _swv_ssot=$(_unwired_vnum "${_unwired_ssot}")
  _swv_target=$(_unwired_vnum "${_sw_target}")
  if [ "${_swv_ssot}" = "ERR" ] || [ "${_swv_target}" = "ERR" ]; then
    echo -e "  ${RED}✗${NC} SDK-face 白名单版本不可解析：SSOT「${_unwired_ssot}」/ 目标「${_sw_target}」——到期判定无法进行，拒绝静默放行"
    WAIVER_FAIL=$((WAIVER_FAIL + 1))
  elif [ "${_swv_ssot}" -ge "${_swv_target}" ]; then
    # 到期态再分两支报（v1.5.1 清偿收口）：原实现无论是否已接线一律报「仍未接线」——
    # 而本支的判据**只**比对版本，从不判定接线 ⇒ 一句未被验证的事实断言。
    # 后果实证：权重灰度 AB 接线落地后本支仍报「仍未接线」，维护者会据此误判「债务未清」，
    # 而不是「条目该摘了」。现复用本脚本自身的 prod_callers（与 --since 段同一实现，
    # 不做第二套），把「已接线 ⇒ 摘条目」与「真未接线 ⇒ 真债务」分开报。
    # 两支**都**计入 WAIVER_FAIL——到期本身即红，接线不自动放行，仍要求显式摘除条目。
    _sw_pc=$(prod_callers "${sw_sym}" 1 || true)
    if [ -n "${_sw_pc}" ]; then
      echo -e "  ${RED}✗${NC} SDK-face 白名单**到期未摘除**：${sw_sym}——目标版本 ${_sw_target} 已到达（当前 SSOT ${_unwired_ssot}），且该符号**已有生产调用点**（${_sw_pc%%:*}）⇒ 债务已清偿，应把条目从 SDK_FACE_WAIVER 摘除"
      echo -e "        处置：摘除条目不续期、不改目标版本（两者都是放宽阈值让红变绿）"
    else
      echo -e "  ${RED}✗${NC} SDK-face 白名单**到期**：${sw_sym}——目标版本 ${_sw_target} 已到达（当前 SSOT ${_unwired_ssot}）仍未接线，债务到期转红"
    fi
    WAIVER_FAIL=$((WAIVER_FAIL + 1))
  fi
  _sw_hits=$(grep -rlw "$sw_sym" engine/ --include='*.ts' 2>/dev/null | head -1 || true)
  if [ -z "${_sw_hits}" ]; then
    echo -e "  ${RED}✗${NC} SDK-face 白名单**孤儿键**：${sw_sym}——该符号在当前 engine 源码零命中（已更名/删除），白名单在静默豁免一个不存在的符号"
    WAIVER_FAIL=$((WAIVER_FAIL + 1))
  fi
done <<< "$SDK_FACE_WAIVER"
echo ""

# ============================================================
# --since 版本 diff 驱动模式（TASK-33）
# 提取 <tag>..HEAD 新增 @public 导出全集并逐个判定接线状态。
# ============================================================
if [ -n "$SINCE_TAG" ]; then
  echo -e "${BOLD}── 版本 diff 驱动：${SINCE_TAG}..HEAD 新增 @public 导出 ──${NC}"
  if ! git rev-parse "$SINCE_TAG" >/dev/null 2>&1; then
    echo -e "  ${RED}✗${NC} --since 引用的 tag「${SINCE_TAG}」不存在——发版闸门传参错误"
    exit 2
  fi
  # 提取新增 @public 导出（awk 状态机；不用 -U0——@public 行与其符号块可能被
  # 零上下文切断；pathspec 用 engine 全量，awk 按扩展名过滤 .ts）。
  # type export 块排除——类型无运行时接线面。
  NEW_PUBLICS=$(git diff "${SINCE_TAG}..HEAD" -- engine 2>/dev/null \
    | awk '
      function flush_block(    i, s) {
        for (i = 1; i <= bn; i++) {
          s = bname[i]; gsub(/[[:space:]]/, "", s); gsub(/,$/, "", s)
          if (s != "" && s !~ /^\/\//) print s
        }
        bn = 0
      }
      /^\+\+\+ / { flush_block(); in_ts = ($0 ~ /\.ts$/); next }
      !in_ts { next }
      # 声明处直接导出：/* @public */ export function foo / export const bar
      /^\+\/\* @public \*\/ export (async )?(function|const|class) / {
        line = $0
        sub(/^\+\/\* @public \*\/ export (async )?(function|const|class) /, "", line)
        split(line, parts, /[ (:]/)
        if (parts[1] != "") { flush_block(); print parts[1] }
        next
      }
      # 桶文件块导出：/* @public */ export {（进入采集态，到 } 退出）
      # 🔴 三种块收尾形态都要认：①独立「}」②「} from './xxx';」③单行块
      #   「export { a, b } from './x';」（整行含 } ——ENTER 正则排除行内含 }
      #   的单行块，否则 collecting 悬开，后续注释/import 行被当符号采集，
      #   v1.5.0 实锤：public-api.ts 单行块悬开 → import{ 等 8 条假红）
      /^\+\/\* @public \*\/ export type \{/ { flush_block(); collecting = 0; next }
      /^\+\/\* @public \*\/ export \{/ { flush_block(); collecting = 1; next }
      collecting && /^\+\}/ { flush_block(); collecting = 0; next }
      collecting && /^\+\}[[:space:]]*from/ { flush_block(); collecting = 0; next }
      collecting && /\}/ && /from / { flush_block(); collecting = 0; next }
      collecting && /^\+/ { bname[++bn] = substr($0, 2) }
    ' | sort -u)

  if [ -z "$NEW_PUBLICS" ]; then
    echo -e "  ${GREEN}✓${NC} ${SINCE_TAG}..HEAD 无新增 @public 值导出"
  else
    NP_TOTAL=$(echo "$NEW_PUBLICS" | wc -l | tr -d ' ')
    echo -e "  新增 @public 值导出 ${NP_TOTAL} 个，逐个判定："
    NP_FAIL=0
    while IFS= read -r np_sym; do
      [ -z "$np_sym" ] && continue
      # SDK-face 白名单判定（格式 符号:reason:目标版本）
      np_waived=""
      _sw_idx=0
      while IFS= read -r sw_entry; do
        [ -z "$sw_entry" ] && continue
        sw_sym="${sw_entry%%:*}"
        if [ "$sw_sym" = "$np_sym" ]; then np_waived="$sw_entry"; break; fi
      done <<< "$SDK_FACE_WAIVER"
      # 生产调用点判定（v1.5.1 J2：与 SYMBOLS 表模式**共用同一份排除实现** prod_callers——
      # 含「符号定义行」排除，旧实现此处漏了该规则导致整类假绿；不再各写一套）
      np_callers=$(prod_callers "$np_sym" 3 || true)
      if [ -n "$np_callers" ]; then
        np_first=$(echo "$np_callers" | head -1 | cut -d: -f1-2)
        echo -e "  ${GREEN}✓${NC} ${np_sym}——生产调用 ${np_first} 等"
        PASS_COUNT=$((PASS_COUNT + 1))
      elif [ -n "$np_waived" ]; then
        echo -e "  ${YELLOW}○${NC} ${np_sym}——SDK-face 白名单（${np_waived#*:}）——SDK 先行债务登记，目标版本到期未接线自动转红"
        WAIVED_COUNT=$((WAIVED_COUNT + 1))
      else
        echo -e "  ${RED}✗${NC} ${np_sym}——零生产调用点（新增 @public 导出无人用）"
        NP_FAIL=$((NP_FAIL + 1))
        FAIL_COUNT=$((FAIL_COUNT + 1))
      fi
    done <<< "$NEW_PUBLICS"
  fi
  echo ""
fi

is_waived() {
  # 用法：is_waived <symbol>；豁免表是逗号分隔列表，逐项比对
  local sym="$1"
  local IFS=','
  for w in $KNOWN_PENDING; do
    [ "$w" = "$sym" ] && return 0
  done
  return 1
}

while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  sym="${entry%%:*}"
  rest="${entry#*:}"
  def_file="${rest%%:*}"
  # via= 间接消费声明（可选第三段）：symbol:def_file:via=a,b,c
  via_list=""
  case "$rest" in
    *:via=*) via_list="${rest#*:via=}" ;;
  esac

  # 检查器故障防御：定义文件丢失 → exit 2（不假绿）
  if [ ! -f "$def_file" ]; then
    echo -e "  ${RED}✗${NC} 符号 ${sym} 的定义文件丢失：${def_file}——门禁失明，拒绝继续"
    exit 2
  fi

  if is_waived "$sym"; then
    echo -e "  ${YELLOW}○${NC} ${sym}（${def_file}）——已豁免（known-pending，接线债务登记）"
    WAIVED_COUNT=$((WAIVED_COUNT + 1))
    continue
  fi

  # 生产调用点：全仓 .ts 扫描，排除定义文件/测试/dist/注释行/再导出块/类型形状声明/定义行
  # （v1.5.1 J2：整条管线已抽为共用实现 prod_callers，两种模式共用；本处传第 3 参
  #   def_file 以保留 SYMBOLS 表模式的既有「定义文件级排除」语义）
  # BSD grep 兼容：不用 \b（GNU 词边界）——多行续行用「行内容白名单」表达：
  #   整行去掉空白与尾逗号后恰等于符号名，才算「裸符号续行」。
  callers=$(prod_callers "$sym" 5 "$def_file" || true)

  if [ -n "$callers" ]; then
    first_caller=$(echo "$callers" | head -1 | cut -d: -f1-2)
    echo -e "  ${GREEN}✓${NC} ${sym}（${def_file}）——生产调用 ${first_caller} 等"
    PASS_COUNT=$((PASS_COUNT + 1))
    continue
  fi

  # 直接调用为零 → 若有 via= 声明，走间接接线判定（规则见文件头）
  if [ -n "$via_list" ]; then
    # 判定 (a)：符号定义文件内出现 delegate 名（证明委托关系存在于代码）
    # 用 grep -q 而非词边界 grep -w——delegate 名在定义文件内的函数体调用
    # 已是「出现」的证据，注释/函数体命中都成立（聚合入口必然点名 delegate）。
    delegates_ok=true
    delegate_verified=0
    delegate_failed=""
    local_ifs="$IFS"
    IFS=','
    for delegate in $via_list; do
      [ -z "$delegate" ] && continue
      if ! grep -qw "$delegate" "$def_file" 2>/dev/null; then
        delegates_ok=false
        delegate_failed="$delegate"
        break
      fi
      # 判定 (b)：delegate 自身有生产调用点（v1.5.1 J2：共用实现 + 排除符号定义文件——
      # 该文件内的引用是委托本身，不算外部消费）
      d_callers=$(prod_callers "$delegate" 3 "$def_file" || true)
      if [ -z "$d_callers" ]; then
        delegates_ok=false
        delegate_failed="$delegate"
        break
      fi
      delegate_verified=$((delegate_verified + 1))
    done
    IFS="$local_ifs"

    if $delegates_ok; then
      echo -e "  ${GREEN}✓${NC} ${sym}（${def_file}）——间接接线（via 委托 ${delegate_verified} 项全部生产消费）"
      PASS_COUNT=$((PASS_COUNT + 1))
      continue
    else
      echo -e "  ${RED}✗${NC} ${sym}（${def_file}）——via 声明的 delegate「${delegate_failed}」无生产消费点或未在定义文件出现——间接接线不成立"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      continue
    fi
  fi

  echo -e "  ${RED}✗${NC} ${sym}（${def_file}）——零生产调用点（@public 导出无人用）"
  echo -e "    接线或豁免：bash tools/check/check-unwired-exports.sh --known-pending <sym>"
  FAIL_COUNT=$((FAIL_COUNT + 1))
done <<< "$SYMBOLS"

echo ""
echo -e "  有接线: ${PASS_COUNT} / 豁免: ${WAIVED_COUNT} / 零接线: ${FAIL_COUNT} / SDK-face 白名单自审失败: ${WAIVER_FAIL}"

if [ "$FAIL_COUNT" -gt 0 ] || [ "$WAIVER_FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}✗ 零接线 ${FAIL_COUNT} 个 + SDK-face 白名单自审失败 ${WAIVER_FAIL} 项——接线后再发版，或显式 --known-pending 登记债务${NC}"
  exit 1
fi

# ============================================================
# S2 写入字段脱敏策略强制声明断言（v1.4.5）
# 「先脱敏再签名」从纪律变 CI 不变量的静态面：
#   ① appendHistory 主链必须调用 deepSanitizeFreeText（运行时兜底在位）
#   ② 深扫白名单必须含签名/链字段（hmacSig 等——脱敏会破坏验签语义）
#   ③ 自由文本字段的类型声明必须带 🔐 脱敏策略标注（types.ts）
# 断言①②防「兜底被顺手删」；断言③防「新自由文本字段裸声明」。
# （行为面由 audit-history.test.ts 三个 S2 行为锁测试守，此处管静态面。）
# ============================================================
S2_FAIL=0

# ① 主链深扫接线在位
if ! grep -q "deepSanitizeFreeText(baseSanitized" engine/audit/src/audit-history.ts; then
  echo -e "  ${RED}✗${NC} S2①：appendHistory 主链未调用 deepSanitizeFreeText——嵌套自由文本脱敏兜底缺失（v1.4.5 S2 回退）"
  S2_FAIL=$((S2_FAIL + 1))
fi

# ② 白名单含签名/链字段（抽两个锚：hmacSig 与 envFingerprint）
for anchor in hmacSig envFingerprint; do
  if ! grep -q "'$anchor'" engine/audit/src/audit-history.ts; then
    echo -e "  ${RED}✗${NC} S2②：深扫白名单缺「${anchor}」——脱敏会破坏验签/链语义（v1.4.5 S2 回退）"
    S2_FAIL=$((S2_FAIL + 1))
  fi
done

# ③ 自由文本字段类型声明带策略标注（context/beforeAfter 两锚；注释块可达 6 行故 -B6）
for field in context beforeAfter; do
  if ! grep -B6 "  $field?:" engine/audit/src/rules/types.ts | grep -q "🔐"; then
    echo -e "  ${RED}✗${NC} S2③：ActionGovernance.$field 类型声明缺 🔐 脱敏策略标注（rules/types.ts）——新字段须显式声明"
    S2_FAIL=$((S2_FAIL + 1))
  fi
done

# ④ eval 测试隔离在位（两轮生产污染防复发）：cli.test persistResult 三用例
#   必须显式传 overrideDataDir（不依赖 SOFAGENT_HOME 常量快照时序）；
#   persistResult 函数签名必须含 overrideDataDir 参数
if ! grep -q "persistResult(mockResult, isoDir)" engine/eval/src/__tests__/cli.test.ts; then
  echo -e "  ${RED}✗${NC} S2④：eval cli.test persistResult 未显式传 overrideDataDir——生产 history.jsonl 污染防线回退（曾两轮复发）"
  S2_FAIL=$((S2_FAIL + 1))
fi
if ! grep -q "overrideDataDir?: string" engine/eval/src/cli.ts; then
  echo -e "  ${RED}✗${NC} S2④：persistResult 缺 overrideDataDir 参数——沙箱实跑/测试隔离通道缺失"
  S2_FAIL=$((S2_FAIL + 1))
fi

if [ "$S2_FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}✗ S2 脱敏策略声明门禁 ${S2_FAIL} 项断言失败${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} S2 脱敏策略声明断言（①深扫接线 ②白名单 ③类型标注 ④eval 隔离）全过"

echo -e "${GREEN}${BOLD}✓ 零接线导出门禁通过（豁免 ${WAIVED_COUNT} 项均在登记表）${NC}"
exit 0
