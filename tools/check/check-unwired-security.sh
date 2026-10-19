#!/bin/bash
# check-unwired-security.sh — 未通电安全防线零生产调用点门禁（v1.6.1 BUG-23）
# ============================================================
# 职责：安全文档（SECURITY.md）声称的防线能力中，存在「已实现但零生产
# 调用方」的**未通电防线**——API 面声称有防线、运行时实际从未执行。
# 实例（v1.6.1 审查实测）：
#   · registerPeer（federation/peers.ts）：peer 注册面零调用方 ⇒ 联邦查询
#     恒退化为纯本地（withOfflineFallback 恒走 peers.length===0 分支）；
#   · rotateKey / shouldRotate / getDecryptionKeys（crypto/key-rotation.ts）：
#     24h 密钥轮换能力零调用方 ⇒ 轮换当前不会自动发生。
# 此类「防线纸面存在、运行时未通电」若不在 SECURITY.md 显式披露，读者会
# 把「能力已实现」误读为「防线在岗」——比不写更糟。
#
# 判定（对登记表逐函数）：
#   ① 零生产调用：engine/**/src 生产面（排除 dist / 测试 / 桶式再导出 /
#      注释行 / 定义行本身）零调用点 —— 记 UNWIRED
#   ② 标注核对：UNWIRED 函数必须能在 SECURITY.md 检索到对应锚点子串
#      （登记表 anchor 字段）——已标注 ⇒ 绿（债务已披露）；未标注 ⇒ 红
#   ③ 陈旧登记：登记表锚点在 SECURITY.md 零命中（标注被删/改写）⇒ 红
#      （防「披露被静默撤下」）
#   ④ 已通电未摘除：函数已获生产调用方 ⇒ 红（登记表该条应摘除——
#      同 check-unwired-exports「清偿即摘除」纪律，登记不是免死金牌）
#
# 豁免台账：登记表内嵌本脚本（UNWIRED_SECURITY 表，函数:锚点 两字段）。
#   锚点 = SECURITY.md 中「未接线/待接线」标注内可稳定检索的子串
#   （含函数名，防标注改写后锚点漂移——锚点不含函数名时④无法自证）。
#
# 退出码：0 = 全绿（零调用者已标注 / 无陈旧登记）/ 1 = 有违规 / 2 = 失明
#
# 设计纪律（对齐 check-guards.sh 家族风格）：
#   - macOS bash 3.2 兼容（无 mapfile/declare -A/关联数组）
#   - BSD grep 兼容（词边界用 grep -w，不用 \b \s）
#   - 检查器故障宁可报错不假绿（登记表空 / SECURITY.md 缺失 → exit 2）
# ============================================================

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ── 登记表：函数名:SECURITY.md 标注锚点（冒号分隔；锚点内禁用冒号）──
# 新增「已实现未通电」的安全能力时登记于此——表本身即披露债务清单。
# 首批（v1.6.1 BUG-23 审查实测四函数）：
#   registerPeer   联邦 peer 注册面（daemon/federation/peers.ts）
#   rotateKey      24h 密钥轮换（core/crypto/key-rotation.ts）
#   shouldRotate   轮换时机判定（同上）
#   getDecryptionKeys 过渡窗口解密钥集（同上）
UNWIRED_SECURITY="registerPeer:peer 注册面未接线
rotateKey:能力已实现待接线
shouldRotate:能力已实现待接线
getDecryptionKeys:能力已实现待接线"

# ── 失明自检 ──
if [ ! -f SECURITY.md ]; then
  echo -e "${RED}✗ SECURITY.md 缺失——标注核对无法进行，拒绝假绿${NC}"
  exit 2
fi
REG_COUNT=$(printf '%s\n' "$UNWIRED_SECURITY" | grep -c . || true)
if [ "$REG_COUNT" -lt 1 ]; then
  echo -e "${RED}✗ 登记表为空——门禁失明（无判定对象即无守卫），拒绝假绿${NC}"
  exit 2
fi

echo -e "${BOLD}── 未通电安全防线门禁（零生产调用点 × SECURITY.md 披露核对）──${NC}"
echo ""

# ============================================================
# 生产调用点判定（口径对齐 check-unwired-exports.sh 的共用实现）：
#   扫描面 = engine/ + tools/，排除：
#   ① dist/  ② node_modules  ③ *.test.*  ④ __tests__  ⑤ fixtures
#   ⑥ 注释行（// / * / /*）  ⑦ 桶式再导出行（export { … sym … }）
#   ⑧ 裸符号续行（行内仅缩进+符号+尾逗号）  ⑨ 类型形状声明（sym: ( / typeof）
#   ⑩ 符号定义行（export function sym / export const sym / export class sym）
#   ⑪ export declare 行（.d.ts 形态——仅声明非调用）
# 用法: prod_callers <符号> —— 输出非空即存在生产调用点
# ============================================================
prod_callers() {
  local _sym="$1"
  grep -rnw "$_sym" engine/ tools/ --include='*.ts' --include='*.mjs' 2>/dev/null \
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
    | grep -vE ":[0-9]+:.*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+${_sym}([^A-Za-z0-9_]|$)" \
    || true
}

FAIL=0

while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  fn="${entry%%:*}"
  anchor="${entry#*:}"
  if [ -z "$fn" ] || [ -z "$anchor" ] || [ "$anchor" = "$entry" ]; then
    echo -e "  ${RED}✗${NC} 登记表格式错误：${entry}（格式 函数名:锚点，锚点内禁用冒号）"
    FAIL=$((FAIL + 1))
    continue
  fi

  # ③ 陈旧登记：锚点在 SECURITY.md 零命中 ⇒ 披露被删/改写
  if ! grep -qF "$anchor" SECURITY.md; then
    echo -e "  ${RED}✗${NC} ${fn}：锚点「${anchor}」在 SECURITY.md 零命中——披露标注被删/改写，需更新登记表锚点"
    FAIL=$((FAIL + 1))
    continue
  fi

  callers="$(prod_callers "$fn")"
  if [ -n "$callers" ]; then
    # ④ 已通电未摘除
    first="$(printf '%s\n' "$callers" | head -1)"
    echo -e "  ${RED}✗${NC} ${fn}：已有生产调用点（${first%%:*}）——债务已清偿，应从登记表摘除（不续锚、不改锚，摘除是唯一认可动作）"
    FAIL=$((FAIL + 1))
  else
    echo -e "  ${GREEN}✓${NC} ${fn}：零生产调用（未通电），SECURITY.md 已披露（锚点「${anchor}」在册）"
  fi
done <<< "$UNWIRED_SECURITY"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ${REG_COUNT} 项登记 / 0 处违规${NC}"
  echo "[check:coverage] script=check-unwired-security asserts=${REG_COUNT} covered=${REG_COUNT} skipped=0"
  exit 0
fi
echo -e "${RED}  ${REG_COUNT} 项登记 / 违规已列出（见上）${NC}"
echo "[check:coverage] script=check-unwired-security asserts=${REG_COUNT} covered=${REG_COUNT} skipped=0"
exit 1
