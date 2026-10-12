#!/usr/bin/env bash
# ============================================================
# check-retirement-due.sh · 声明体系「到期消费者」守卫（v1.5.9 门禁-4 · 并 BUG-39/BUG-40）
# ============================================================
# 职责：把「到期条件人人登记、无人消费」机械化——读取声明体系的**到期触发条件**，
#   与当前版本对账，把「已届满未退役」的兼容层机械报出（**只报出，不执行退役**）。
#
# 数据源（三处，均读字段而非硬编码名单）：
#   ① engine/capabilities.json 的 shims[].trigger —— 12 个旧命令 shim 的退役台账
#   ② tools/check/*-exempt.json —— 豁免台账里若登记「到期条件」（字段/值含 到期/届满/expire/expiry/due）
#   ③ docs/ROADMAP.md「探索方向」段的「触发条件」——登记面（非版本绑定，仅报数）
#
# 判据（minor 口径 = 本仓版本序列的**下一格**：本仓把每次 1.5.z 迭代计数为一个「minor」——
#   见 docs/changelog/v2.0/v2.0.0.md「12 个 sofagent-* shim …… v1.5.6 之后已过多个 minor」）：
#   ⚠️ 适用边界：本口径把「版本序列下一格」等同 minor——**跨大版时语义失真**
#   （v1.9.0 的「下一格」算得 v1.9.1，而真实下一个 minor 是 v2.0.0）。大版跃迁前后
#   须人工复核本守卫结论，勿据其单独裁决退役时机。
#   trigger 含「届满（… 一个 minor）」者，登记版本 +1（序列下一格）= 到期版本；
#   当前版本 ＞ 到期版本 ⇒ 报出「已届满未退役」（计入 DUE，exit 1）。
#   台账一致性（负向探针面）：每条 shim 的 source 文件须在位——条目与实物逐一对应。
#
# 退出码：0 = 无届满未退役 / 1 = 存在届满未退役（或 shim 台账与实物不一致）/ 2 = 失明（数据源缺失/塌缩）
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || { echo "FATAL: cannot cd to repo root: ${ROOT}" >&2; exit 2; }

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; NC=$'\033[0m'

CAPS="engine/capabilities.json"
ROADMAP="docs/ROADMAP.md"

echo "=== check-retirement-due：声明体系到期消费者（v1.5.9 门禁-4）==="

# ── 当前版本（SSOT = 根 package.json）──
CUR="$(grep -m1 '"version"' package.json 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ -z "${CUR}" ]; then
  echo "${RED}❌ 失明：无法从 package.json 读取当前版本——到期对账无基准${NC}"
  exit 2
fi
echo "  当前版本（SSOT）：v${CUR}"

# 版本比较：$1 ＞ $2 ⇒ 真（纯 bash，不依赖 sort -V——本仓测试面含 macOS 默认 bash 3.2 / BSD 工具链）
ver_gt() {
  local IFS=.
  # shellcheck disable=SC2206
  local a=($1) b=($2)
  [ "${a[0]}" -ne "${b[0]}" ] && { [ "${a[0]}" -gt "${b[0]}" ]; return; }
  [ "${a[1]}" -ne "${b[1]}" ] && { [ "${a[1]}" -gt "${b[1]}" ]; return; }
  [ "${a[2]}" -gt "${b[2]}" ]
}

# 本仓 minor 口径：版本序列下一格（last-segment +1）
bump_next() {
  local a b c
  IFS=. read -r a b c <<< "$1"
  printf '%s.%s.%s' "$a" "$b" "$((c + 1))"
}

# ── 数据源①：capabilities.json 的 shims[] ──
if [ ! -f "${CAPS}" ]; then
  echo "${RED}❌ 失明：${CAPS} 不存在——shim 退役台账无数据源${NC}"
  exit 2
fi
SHIM_TSV="$(node -e '
const fs = require("fs");
let d;
try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("parse-error: " + e.message); process.exit(2); }
const s = Array.isArray(d.shims) ? d.shims : [];
if (s.length === 0) {
  const r = Array.isArray(d.shimsRetired) ? d.shimsRetired : [];
  if (r.length > 0) { process.stdout.write("__ALL_RETIRED__\t" + r.length + "\n"); process.exit(0); }
  console.error("empty-shims"); process.exit(3);
}
for (const x of s) {
  const f = [x.id, x.cli, x.source, String(x.trigger || "").replace(/\t/g, " ")]
    .map((v) => (v == null ? "" : v));
  process.stdout.write(f.join("\t") + "\n");
}
' "${CAPS}")" || SHIM_RC=$?
SHIM_RC=${SHIM_RC:-0}

if printf '%s' "${SHIM_TSV}" | grep -q '^__ALL_RETIRED__'; then
  _n="$(printf '%s' "${SHIM_TSV}" | head -1 | cut -f2)"
  echo "  ${GREEN}✅ 旧命令 shim 已全退役${NC}（shimsRetired 登记 ${_n} 条）——兼容期届满后按 v2.0.0 章六「兼容层退役清单」显式退役"
  echo "── shim 台账：在册 0 条 · 退役记录 ${_n} 条（空台账不再是「失明」——退役记录可证，防空转守卫保留）"
  exit 0
fi
if [ "${SHIM_RC}" -eq 2 ]; then
  echo "${RED}❌ 失明：${CAPS} 解析失败——台账不可读，拒绝假绿${NC}"
  exit 2
elif [ "${SHIM_RC}" -eq 3 ]; then
  echo "${RED}❌ 失明：${CAPS} 的 shims 为空——台账缺席，拒绝假绿${NC}"
  exit 2
fi

TOTAL=0; DUE=0; MISS=0
REG=""; PREV_IS_MINOR=""
while IFS=$'\t' read -r _id _cli _src _trig; do
  [ -n "${_id}" ] || continue
  TOTAL=$((TOTAL + 1))
  _is_minor=""
  if printf '%s' "${_trig}" | grep -q '同上'; then
    # 「（同上）」形态：沿用上一条的登记版本与「一个 minor」语义
    _ver="${REG}"; _is_minor="${PREV_IS_MINOR}"
  else
    _ver=$(printf '%s' "${_trig}" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | tr -d 'v')
    [ -n "${_ver}" ] && REG="${_ver}"
    if printf '%s' "${_trig}" | grep -qE 'minor'; then _is_minor="yes"; fi
    PREV_IS_MINOR="${_is_minor}"
  fi
  # 台账一致性：source 文件须在位（bin 入口与条目逐一对应——条目写实、实物在仓）
  if [ -n "${_src}" ] && [ ! -f "${_src}" ]; then
    echo "  ${RED}❌ shim ${_id}（${_cli}）：source ${_src} 不在位——台账与实物不对应${NC}"
    MISS=$((MISS + 1))
  fi
  if [ -z "${_ver}" ]; then
    echo "  ${YELLOW}⚠️ shim ${_id}（${_cli}）：trigger 无登记版本，无法计到期${NC}"
    continue
  fi
  if [ -n "${_is_minor}" ]; then
    _due=$(bump_next "${_ver}")
    if ver_gt "${CUR}" "${_due}"; then
      echo "  ${RED}❌ 已届满未退役：shim ${_id}（${_cli}）登记 v${_ver} +1 minor = 到期 v${_due} ＜ 当前 v${CUR}${NC}"
      DUE=$((DUE + 1))
    else
      echo "  ${GREEN}✓ shim ${_id}（${_cli}）未到期（到期 v${_due} ≥ 当前 v${CUR}）${NC}"
    fi
  else
    echo "  ${YELLOW}⏭️ shim ${_id}（${_cli}）trigger 非「届满…minor」形态，不计到期：${_trig}${NC}"
  fi
done <<< "${SHIM_TSV}"

echo "  ── shim 台账：登记 ${TOTAL} 条，已届满未退役 ${DUE} 条，source 缺失 ${MISS} 条"

# ── 数据源②：tools/check/*-exempt.json 的到期条件（当前为零——登记面预留，读字段非硬编码）──
EXEMPT_DUE=0; EXEMPT_SCAN=0
for _f in tools/check/*-exempt.json; do
  [ -f "${_f}" ] || continue
  EXEMPT_SCAN=$((EXEMPT_SCAN + 1))
  _n=$(grep -cE '到期|届满|expire|expiry|"due"' "${_f}" 2>/dev/null || true)
  EXEMPT_DUE=$((EXEMPT_DUE + ${_n:-0}))
done
echo "  ── exempt 台账：扫描 ${EXEMPT_SCAN} 份，登记到期条件 ${EXEMPT_DUE} 条"

# ── 数据源③：ROADMAP 探索方向「触发条件」（登记面，非版本绑定——仅报数，不判到期）──
if [ -f "${ROADMAP}" ]; then
  RM_TRIG=$(grep -cE '触发条件' "${ROADMAP}" 2>/dev/null || true)
  echo "  ── ROADMAP 探索方向：登记「触发条件」${RM_TRIG:-0} 处（非版本绑定，仅登记可见）"
else
  echo "  ${YELLOW}⚠️ ${ROADMAP} 不存在——探索方向触发条件面缺席${NC}"
fi

# ── 结论 ──
if [ "${DUE}" -gt 0 ] || [ "${MISS}" -gt 0 ]; then
  echo ""
  echo "${RED}✗ 声明体系：${DUE} 条「已届满未退役」 / ${MISS} 条台账与实物不一致（source 缺失）——退役动作排期见 ROADMAP${NC}"
  exit 1
fi
echo ""
echo "${GREEN}✓ 声明体系无届满未退役项（shim ${TOTAL} 条均在兼容期内）${NC}"
exit 0
