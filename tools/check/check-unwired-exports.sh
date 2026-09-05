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
SYMBOLS="runInspectors:engine/daemon/src/inspectors/index.ts:via=analyzeAuditHistory,checkConflict,checkDoctorHealth,checkKnowledgeFreshness,checkKnowledgeHealth,checkSkillStaleness,runAuditTrailInspector
runAllLayers:engine/daemon/src/inspector-layers.ts:via=runLayeredInspection
runDreamCycle:engine/daemon/src/dream-cycle/state-machine.ts
registerBuiltinSlashCommands:engine/core/src/slash-commands/index.ts"

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

echo -e "${BOLD}── 零接线导出门禁（A2 · @public 符号生产调用点断言）──${NC}"
echo ""

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

  # 生产调用点：全仓 .ts 扫描，排除定义文件/测试/dist/注释行
  # 注释形态：行首 //、*（JSDoc）、/*（块注释开头）——注意 JSDoc 的
  # 「/** runDreamCycle 返回结果 */」这类文档注释不是调用点
  # 非调用形态排除（v1.4.5 二次修订——机械可验证规则，防 API 面声明误判为消费）：
  #   (1) export 花括号列表内的符号（单行「export { ..., sym, ... }」）——再导出
  #       是 API 面声明不是调用（关键场景：定义包自己的 index.ts 再导出）
  #   (2) 多行 export 块的裸符号续行（行内除缩进/符号名/尾逗号外无他物）——
  #       同 (1)，跨行形态（v1.4.5 实测 daemon/index.ts:82 「  runInspectors,」
  #       即此形态，曾误判为生产调用）
  #   (3) 类型形状声明行（「sym: (…)=>…」/「sym: typeof …」）——接口字段/
  #       运行时窄化目标声明，值调用（mod.sym(…)）才是消费
  # BSD grep 兼容：不用 \b（GNU 词边界）——多行续行用「行内容白名单」表达：
  #   整行去掉空白与尾逗号后恰等于符号名，才算「裸符号续行」。
  callers=$(grep -rnw "$sym" engine/ --include='*.ts' 2>/dev/null \
    | grep -v "/dist/" \
    | grep -v "node_modules" \
    | grep -v "\.test\.ts" \
    | grep -v "__tests__" \
    | grep -v "fixtures" \
    | grep -v ":[0-9]*:[[:space:]]*//" \
    | grep -v ":[0-9]*:[[:space:]]*\*" \
    | grep -v ":[0-9]*:[[:space:]]*/\*" \
    | grep -v "$def_file" \
    | grep -v ":[[:space:]]*export[[:space:]]*{[^}]*${sym}[^}]*}" \
    | grep -v ":[[:space:]]*${sym}[[:space:]]*,[[:space:]]*$" \
    | grep -v ":[[:space:]]*${sym}[[:space:]]*$" \
    | grep -v ":[[:space:]]*${sym}[[:space:]]*:[[:space:]]*(" \
    | grep -v ":[[:space:]]*${sym}[[:space:]]*:[[:space:]]*typeof" \
    | head -5 || true)

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
      # 判定 (b)：delegate 自身有生产调用点（标准排除 + 排除符号定义文件——
      # 该文件内的引用是委托本身，不算外部消费）
      d_callers=$(grep -rnw "$delegate" engine/ --include='*.ts' 2>/dev/null \
        | grep -v "/dist/" \
        | grep -v "node_modules" \
        | grep -v "\.test\.ts" \
        | grep -v "__tests__" \
        | grep -v "fixtures" \
        | grep -v ":[0-9]*:[[:space:]]*//" \
        | grep -v ":[0-9]*:[[:space:]]*\*" \
        | grep -v ":[0-9]*:[[:space:]]*/\*" \
        | grep -v "$def_file" \
        | head -3 || true)
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
echo -e "  有接线: ${PASS_COUNT} / 豁免: ${WAIVED_COUNT} / 零接线: ${FAIL_COUNT}"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "${RED}${BOLD}✗ 存在 ${FAIL_COUNT} 个零接线导出——接线后再发版，或显式 --known-pending 登记债务${NC}"
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
