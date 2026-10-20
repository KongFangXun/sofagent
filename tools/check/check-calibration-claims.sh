#!/usr/bin/env bash
# ============================================================
# check-calibration-claims.sh · 校准判据纪律门禁（v1.7.0 §三）
# ============================================================
# 职责：把 §三「校准判据纪律」的各条断言面集中于此（SSOT 明确
#   「不另建脚本」——同一事实源、同一拦截点，拆脚本只会让纪律散成四处）：
#
#   C1 置信度登记对账：决策路径消费的置信度/阈值常量若未在
#      calibration-registry 登记 → 红
#   C2 统计量一致性：registry 登记的 statistic 与 calibration.ts 的
#      ECE 拟合统计量（STATISTIC_NAME）对账——不一致红
#   C3 校准集隔离断言调用点存在性：assertDisjoint 在仓内有真实调用点
#      （calibration.ts 自身 + 单测之外的生产消费面）
#   C4 概率有效位数：概率序列化路径无 .toFixed( 截断（HITL 与 API/MCP
#      两条通道分别断言——命中即须显式标注 // precision-note，无标注则红）
#   C5 四件套锚点：判定记录写入面（toAuditRecord 消费点）须含四版本号
#      字段的锚点结构在位（judgmentAnchor/anchorComparability 导出可查）
#   C6 数据集谱系三件套：datasets/ 下数据集 manifest 须含来源构成/
#      行数对账/污染声明三节，行数对账可由 node 一行复算
#
# 判定口径：
#   - C1 的登记面对账 = 源码侧消费点 grep（阈值常量定义处）↔ registry
#     登记的 path 集合；新消费点未登记即红（登记 ≠ 改造——uncalibrated
#     也算已登记，本门禁抓的是「完全没有登记」的裸数字）
#   - C4 允许显式标注豁免：截断行带 `precision-note` 注释（显式标注且
#     制品可查 = 纪律允许；静默截断 = 缺陷）
#   - C6 datasets/ 当前只有基线产物（baseline-zero-shot-*）——三件套
#     断言对**新增 manifest.json** 生效；README 谱系段在位即视为当前
#     存量合规（§六对照集落位时 manifest 落地即受检）
#
# 退出码：0 = 全绿 / 1 = 有违规 / 2 = 失明（扫描面塌缩，拒绝假绿）
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[3m'
NC=$'\033[0m'

bad=0

echo "════════════════════════════════════════════════════════════"
echo "  check-calibration-claims · 校准判据纪律门禁（§三断言面集中地）"
echo "════════════════════════════════════════════════════════════"

# ── 失明自检（扫描面塌缩 → exit 2 拒绝假绿）────────────────
REGISTRY_SRC="engine/core/src/calibration-registry.ts"
CALIB_SRC="engine/train/src/rlcd/calibration.ts"
[ -f "$REGISTRY_SRC" ] || { echo "${RED}✗ 失明：$REGISTRY_SRC 不存在${NC}"; exit 2; }
[ -f "$CALIB_SRC" ] || { echo "${RED}✗ 失明：$CALIB_SRC 不存在${NC}"; exit 2; }
ENGINE_DIR_COUNT=$(find engine -maxdepth 1 -type d | wc -l | tr -d ' ')
[ "$ENGINE_DIR_COUNT" -lt 5 ] && { echo "${RED}✗ 失明：engine 扫描面塌缩（${ENGINE_DIR_COUNT} 目录）${NC}"; exit 2; }

# ── C1 决策路径阈值常量登记对账 ────────────────────────────
# 源码侧：router 面的置信度/阈值常量定义（DEFAULT_*_THRESHOLD(S) /
# MinConfidence / MATCH_THRESHOLD 形态）；registry 侧：登记的 path 集。
# 新增常量未登记 → 红（uncalibrated 登记也算过——本门禁抓「裸数字」）。
echo ""
echo "── C1 决策路径置信度/阈值登记对账 ──"
: > /tmp/cc-claims-constants.$$ 
grep -rnE '(allowMinConfidence|askMinConfidence|l1MinConfidence|MATCH_THRESHOLD|DEFAULT_CONFIDENCE_THRESHOLD|DEFAULT_GRADE_THRESHOLDS|DEFAULT_CALIBRATION_POLICY)[^a-zA-Z]*[:=]' \
  engine/orchestrator/src --include='*.ts' 2>/dev/null |
  grep -v '__tests__' |
  grep -vE '^\s*//' >> /tmp/cc-claims-constants.$$
CONST_HITS=$(grep -c . /tmp/cc-claims-constants.$$ || true)
if [ "${CONST_HITS:-0}" -lt 6 ]; then
  echo "${RED}✗ 失明：常量扫描命中 ${CONST_HITS} 处（基线 ≥6）——扫描面塌缩${NC}"
  exit 2
fi

# registry 侧登记面（registerLegacyConfidenceClaims 中的 path 值）
REG_PATHS=$(grep -oE "path: 'engine/[^']+'" "$REGISTRY_SRC" | sed "s/path: '//;s/'//" | sort -u)
REG_PATH_COUNT=$(printf '%s\n' "$REG_PATHS" | grep -c . || true)
# 行号锚登记的文件集（file:line 形态——这些文件走行号级分拣）
REG_LINE_FILES=$(printf '%s\n' "$REG_PATHS" | grep -E ':[0-9]+$' | cut -d: -f1 | sort -u)

# 对账（行号级分拣）：定义行须落在同文件某条登记行号的 ±2 行邻域内。
# 文件名级 grep 会漏「已登记文件内新增常量」（复核第 1 轮漏报面），
# 且固定名 grep 的 [^a-zA-Z]*[:=] 尾界漏掉 _V2 类后缀变体——故对
# 登记文件另做泛化名深扫。文件无行号锚（常量名锚）→ 回退文件级判定；
# 文件完全未登记 → 红。「已登记行自身变更」仍靠 C2 统计量对账，
# 本处只抓「新常量未登记」。
missing=0
declare_lines() {
  # $1=file $2=lineno：行号级 → 文件级回退；违规打红返回 1
  local file="$1" lineno="$2" reg_lines rl d near
  reg_lines=$(printf '%s\n' "$REG_PATHS" | awk -F: -v f="$file" '$1==f && $2 ~ /^[0-9]+$/ {print $2}')
  if [ -n "$reg_lines" ]; then
    near=0
    for rl in $reg_lines; do
      d=$((lineno > rl ? lineno - rl : rl - lineno))
      [ "$d" -le 2 ] && { near=1; break; }
    done
    [ "$near" -eq 1 ] && return 0
    echo "${RED}  ✗ 未登记阈值常量：${file}:${lineno}（定义行不在 calibration-registry 任何登记条目 ±2 行邻域——新常量须先 registerConfidenceClaim 登记，uncalibrated 亦可，裸数字不可）${NC}"
    return 1
  fi
  printf '%s\n' "$REG_PATHS" | grep -qF "$file" && return 0
  echo "${RED}  ✗ 未登记阈值常量：${file}:${lineno}（定义文件不在 calibration-registry 登记册）${NC}"
  return 1
}

# ① 固定名扫描（既有口径）：非行号登记文件的已知常量名 + 三属性形态
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file=${line%%:*}
  printf '%s\n' "$REG_LINE_FILES" | grep -qF "$file" && continue
  lineno=$(printf '%s' "$line" | cut -d: -f2)
  # 只对账「定义行」（const/let 赋值或数值属性——引用行不算新消费点）
  if printf '%s' "$line" | grep -qE "(const|let) [A-Z_]+ *[=:]|(allowMinConfidence|askMinConfidence|l1MinConfidence): [0-9]"; then
    declare_lines "$file" "$lineno" || missing=$((missing + 1))
  fi
done < /tmp/cc-claims-constants.$$

# ② 登记文件泛化名深扫（行号级防漏）：THRESHOLD/CONFIDENCE 形态常量
#    声明（含 _V2 等后缀变体）。MULTIPLIER 系为打分乘子非阈值，排除。
for rfile in $REG_LINE_FILES; do
  [ -f "$rfile" ] || continue
  while IFS= read -r hline; do
    [ -z "$hline" ] && continue
    printf '%s' "$hline" | grep -qE '^[0-9]+: *[/*]' && continue
    printf '%s' "$hline" | grep -q 'MULTIPLIER' && continue
    declare_lines "$rfile" "${hline%%:*}" || missing=$((missing + 1))
  done < <(grep -nE "(const|let) [A-Za-z_][A-Za-z0-9_]*(THRESHOLD|Threshold|CONFIDENCE|Confidence)[A-Za-z0-9_]* *[=:]|^[[:space:]]*(allowMinConfidence|askMinConfidence|l1MinConfidence): [0-9]" "$rfile" 2>/dev/null || true)
done
rm -f /tmp/cc-claims-constants.$$
rm -f /tmp/cc-claims-constants.$$

if [ "$missing" -gt 0 ]; then
  echo "${RED}  ✗ C1 未登记阈值：${missing} 处（处置：registerConfidenceClaim 登记——uncalibrated 亦可，裸数字不可）${NC}"
  bad=1
else
  echo "${GREEN}  ✓ C1 决策路径阈值常量全部在册（登记面 ${REG_PATH_COUNT} 条 path）${NC}"
fi

# ── C2 统计量一致性对账 ────────────────────────────────────
# registry 登记的 statistic（max-prob 系）== calibration.ts ECE 拟合统计量
# （STATISTIC_NAME）。不一致红（决策路径消费归一化熵而 ECE 按 max-prob
# 算 = 消费从未被校准过的量）。
echo ""
echo "── C2 统计量一致性（registry.statistic ↔ ECE 拟合统计量）──"
FIT_STAT=$(grep -oE "export const STATISTIC_NAME = '[^']+'" "$CALIB_SRC" | grep -oE "'[^']+'" | tr -d "'")
if [ -z "$FIT_STAT" ]; then
  echo "${RED}✗ 失明：calibration.ts STATISTIC_NAME 读不到（拟合统计量锚缺失）${NC}"
  exit 2
fi
# 决策路径声明（inDecisionPath: true）的 statistic 须与拟合统计量一致。
# 块数自检：解析出的声明块数须 == registry 登记数（REG_PATH_COUNT）——
# 少解析 = 格式重构致扫描面塌缩（如 claim 块被压扁成一行）→ exit 2 失明
# 拒绝假绿（复核第 1 轮：静默退化曾让 C2 空转全绿）。
INCONSISTENT=$(node -e "
const src = require('fs').readFileSync('$REGISTRY_SRC', 'utf8');
// 提取 registerLegacyConfidenceClaims 内的声明块：逐段扫 statistic/calibStatus
const blocks = src.split(/\{\s*\n\s*id:/).slice(1);
const expected = ${REG_PATH_COUNT};
if (blocks.length !== expected) {
  console.error('  ✗ 失明：声明块解析 ' + blocks.length + ' 个 ≠ 登记数 ' + expected + '（格式重构致解析面塌缩——须修 C2 解析器）');
  process.exit(2);
}
let bad = 0;
for (const b of blocks) {
  const seg = b.slice(0, b.indexOf('},'));
  const isPath = /inDecisionPath: true/.test(seg);
  const stat = (seg.match(/statistic: '([^']+)'/) || [])[1];
  if (isPath && stat && stat !== '$FIT_STAT' && stat !== 'similarity-score') {
    console.error('  ✗ 决策路径声明统计量 ' + stat + ' ≠ ECE 拟合统计量 $FIT_STAT');
    bad++;
  }
}
process.exit(bad > 0 ? 1 : 0);
" 2>&1)
c2_rc=$?
if [ "$c2_rc" -eq 2 ]; then
  echo "${RED}${INCONSISTENT}${NC}"
  exit 2
elif [ "$c2_rc" -ne 0 ]; then
  echo "${RED}${INCONSISTENT}${NC}"
  echo "${RED}  ✗ C2 统计量不一致（消费面与拟合面不同源 = 消费从未被校准的量）${NC}"
  bad=1
else
  echo "${GREEN}  ✓ C2 统计量一致（${REG_PATH_COUNT} 声明块全解析；决策路径声明 statistic == STATISTIC_NAME == ${FIT_STAT}；similarity-score 类非概率口径单独登记）${NC}"
fi

# ── C3 校准集隔离断言调用点存在性 ──────────────────────────
echo ""
echo "── C3 校准集隔离断言调用点 ──"
ISO_CALLS=$(grep -rn "assertDisjoint\|calibrateAfterTraining" engine/train/src --include='*.ts' 2>/dev/null | grep -v '__tests__' | grep -cvE '^\s*//|export function|export interface| \* ' || true)
ISO_TEST=$(grep -rn "assertDisjoint" engine/train/src/__tests__/calibration.test.ts 2>/dev/null | grep -c . || true)
if [ "${ISO_CALLS:-0}" -lt 1 ] || [ "${ISO_TEST:-0}" -lt 1 ]; then
  echo "${RED}  ✗ C3 隔离断言无调用点（生产面 ${ISO_CALLS} / 测试面 ${ISO_TEST}——交集非空则 ECE 达阈不算数,断言须真实在跑）${NC}"
  bad=1
else
  echo "${GREEN}  ✓ C3 隔离断言在位（生产调用点 ${ISO_CALLS} 处 + 单测断言 ${ISO_TEST} 处）${NC}"
fi

# ── C4 概率有效位数（HITL 与 API/MCP 两通道分别断言）────────
echo ""
echo "── C4 概率序列化有效位数（静默截断即缺陷）──"
# 概率字段邻域的 .toFixed( 须带 precision-note 显式标注（允许显式截断,
# 拦截静默截断）。两通道:API/MCP 面（engine/mcp）与 HITL 面（hitl-handler）。
check_channel() {
  local channel="$1" label="$2"
  local hits
  hits=$(grep -rn '\.toFixed(' ${channel} 2>/dev/null |
    grep -v '__tests__' |
    grep -iE 'probab|confid|confidence|ece' || true)
  local unannotated=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! printf '%s' "$line" | grep -q 'precision-note'; then
      echo "${RED}  ✗ [${label}] 概率路径静默截断：${line%%:*}:${line#*:}" 2>/dev/null
      unannotated=$((unannotated + 1))
    fi
  done <<<"$hits"
  if [ "$unannotated" -gt 0 ]; then
    echo "${RED}  ✗ C4 [${label}] ${unannotated} 处概率截断无显式标注（处置:截断行加 precision-note 注释或去掉截断）${NC}"
    return 1
  fi
  echo "${GREEN}  ✓ C4 [${label}] 无概率路径静默截断${NC}"
  return 0
}
c4_bad=0
check_channel "engine/mcp/src" "API/MCP" || c4_bad=1
check_channel "engine/orchestrator/src/hitl-handler.ts engine/orchestrator/src/hitl" "HITL" || c4_bad=1
# 判定通道本面（probability 字段序列化——toAuditRecord 面）同查
check_channel "engine/orchestrator/src/router/decision-channel.ts" "判定通道" || c4_bad=1
[ "$c4_bad" -eq 1 ] && bad=1

# ── C5 四件套锚点结构在位 ──────────────────────────────────
echo ""
echo "── C5 判定制品四件套锚点 ──"
if grep -q "export function judgmentAnchor" "$REGISTRY_SRC" && \
   grep -q "export function anchorComparability" "$REGISTRY_SRC" && \
   grep -q "weightsV.*questionsV.*criteriaV.*thresholdV\|weightsV" "$REGISTRY_SRC"; then
  # 消费面：锚点结构须被 core 导出（判定记录写入面可挂四版本号）
  if grep -q "judgmentAnchor" engine/core/src/index.ts; then
    echo "${GREEN}  ✓ C5 四件套锚点在位（judgmentAnchor/anchorComparability 导出可查——判定记录可落四版本号）${NC}"
  else
    echo "${RED}  ✗ C5 锚点未导出（core index.ts 缺 judgmentAnchor——判定记录写入点无法挂四版本号）${NC}"
    bad=1
  fi
else
  echo "${RED}  ✗ C5 四件套锚点结构缺失（judgmentAnchor/anchorComparability 任一不在）${NC}"
  bad=1
fi

# ── C6 数据集谱系三件套 ────────────────────────────────────
echo ""
echo "── C6 datasets/ 谱系三件套（manifest 存在时生效）──"
MANIFESTS=$(find datasets -name 'manifest.json' -o -name 'manifest.jsonl' 2>/dev/null | head -20)
if [ -z "$MANIFESTS" ]; then
  # 存量态：无 manifest（v1.7.0 §六对照集尚未落位）——README 谱系段须在位
  if grep -q "可复算" datasets/README.md 2>/dev/null; then
    echo "${YELLOW}  ⚠ C6 datasets/ 无 manifest（存量态：基线产物无集——§六对照集落位时 manifest 受检；README 谱系段在位）${NC}"
  else
    echo "${RED}  ✗ C6 datasets/README.md 谱系段缺失（无 manifest 时须有谱系口径说明）${NC}"
    bad=1
  fi
else
  c6_bad=0
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    # ① 来源构成 ② 污染声明 ③ 行数对账（三方：manifest.rowReconciliation
    # .perCriterionSum == line-reconciliation.json ΣperCriterion ==
    # questions.jsonl 实际行数 == manifest.lineCount——复核第 1 轮：对账
    # 分支曾按 m.sources（不存在的形态）判空空转，须按实际结构
    # provenance.sourceComposition / provenance.rowReconciliation 适配）
    if ! node -e "
      const fs = require('fs');
      const path = require('path');
      const m = require('./$m');
      const prov = m.provenance || {};
      if (!prov.sourceComposition || !Array.isArray(prov.sourceComposition) || prov.sourceComposition.length === 0) {
        console.error('  ✗ $m 缺来源构成节（provenance.sourceComposition）'); process.exit(1);
      }
      if (!prov.contaminationStatement) {
        console.error('  ✗ $m 缺污染声明节（provenance.contaminationStatement）'); process.exit(1);
      }
      const rr = prov.rowReconciliation;
      if (!rr || typeof rr.perCriterionSum !== 'number') {
        console.error('  ✗ $m 缺行数对账节（provenance.rowReconciliation.perCriterionSum）'); process.exit(1);
      }
      const dir = path.dirname('./$m');
      // 三方对账：manifest 声明值 ↔ 对账文件复算 ↔ 数据文件实际行数
      const reconFile = path.join(dir, m.lineReconciliationFile || 'line-reconciliation.json');
      let reconSum = null;
      try {
        const recon = JSON.parse(fs.readFileSync(reconFile, 'utf8'));
        reconSum = Object.values(recon.perCriterion || {}).reduce((a, v) => a + Number(v), 0);
      } catch (e) { /* 对账文件缺席按下方 lineCount 兜底分支报错 */ }
      const dataFile = path.join(dir, 'questions.jsonl');
      let actualLines = null;
      try {
        actualLines = fs.readFileSync(dataFile, 'utf8').split('\\n').filter((l) => l.trim() !== '').length;
      } catch (e) { /* 数据文件缺席按下方对账失败报错 */ }
      if (reconSum !== null && reconSum !== rr.perCriterionSum) {
        console.error('  ✗ $m 行数对账失败：line-reconciliation ΣperCriterion=' + reconSum + ' ≠ manifest perCriterionSum=' + rr.perCriterionSum); process.exit(1);
      }
      if (actualLines !== null && m.lineCount !== undefined && actualLines !== m.lineCount) {
        console.error('  ✗ $m 行数对账失败：questions.jsonl 实际 ' + actualLines + ' 行 ≠ manifest lineCount=' + m.lineCount); process.exit(1);
      }
      if (rr.total !== undefined && rr.total !== rr.perCriterionSum) {
        console.error('  ✗ $m 行数对账失败：rowReconciliation.total=' + rr.total + ' ≠ perCriterionSum=' + rr.perCriterionSum); process.exit(1);
      }
      if (reconSum === null && actualLines === null) {
        console.error('  ✗ $m 行数对账失明（line-reconciliation.json 与 questions.jsonl 均不可读——无对账面）'); process.exit(1);
      }
    "; then c6_bad=1; fi
  done <<<"$MANIFESTS"
  [ "$c6_bad" -eq 1 ] && bad=1 || echo "${GREEN}  ✓ C6 manifest 三件套齐（来源构成/行数对账三方复算：manifest ↔ line-reconciliation ↔ questions.jsonl 实际行数/污染声明）${NC}"
fi

# ── 汇总 ──────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$bad" -eq 0 ]; then
  echo "${GREEN}  6 项判定 / 0 处违规${NC}"
  echo "[check:coverage] script=check-calibration-claims asserts=6 covered=6"
  exit 0
fi
echo "${RED}  6 项判定 / 违规已列出（见上）${NC}"
echo "[check:coverage] script=check-calibration-claims asserts=6"
exit 1
