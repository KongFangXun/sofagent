#!/bin/bash
# check-guard-fail-loud.sh — 防线失明自检门禁（故障注入实测）
# Guard fail-loud self-check: prove detection guards fail LOUDLY when their
# detection engine breaks, instead of silently reporting "0 violations".
#
# 问题：守卫依赖外部检测引擎（perl）做判定。引擎故障时（无 perl / 运行时崩 /
#   空响应），若守卫把空输出直接当「零违规」，就会产出「✓ 全绿」假绿——
#   防线失明却不吭声，比没有防线更坏：它给人虚假安全感。
# 防御：故障注入实测——PATH 前置假 perl 再跑目标守卫，断言退出码非 0。
#   引擎故障下仍 exit 0 = 守卫失明不自知（「0 处违规但根本没在看」）→ 本门禁报红。
#
# 两种假引擎形态都必须测（缺一不可）：
#   crash  崩溃型（exit 3）——引擎不存在 / 运行时崩，最容易想到的故障形态
#   silent 空响应型（exit 0 无输出）——更阴险：命令"成功"但什么都没检测到，
#          恰是「守卫瞎了却报通过」的实案形态
#
# 覆盖目标（判定路径依赖 perl 的守卫——先读各守卫源码后圈定，不猜）：
#   tools/check/check-cjk-var.sh — 核心判定用 perl；自带 PERL_ALIVE 自检样本 +
#                                  GUARDS_VIOL 退出判定，本门禁验证它真会响
#   tools/check/check-guards.sh  — ① 段 BSD 正则判定用 perl；② 段调度
#                                  check-cjk-var（fail-loud 须经调度传导整链非 0）
# 不纳入（读了源码、有理由）：check-review-system.sh（perl 仅主题词聚类提取，
#   空结果已有 warn 防御且非阻断判定）；check-action-pins.sh / check-storefront.sh
#   （无判定级 perl 调用）。
#
# 用法：bash tools/check/check-guard-fail-loud.sh
# 退出码：0 = 全部守卫在引擎故障下正确报红 / 1 = 存在失明不自知的守卫或本门禁自检失败
#
# 设计纪律：
#   - 本脚本自身 fail-loud：目标守卫缺失 / 真引擎不健康 / 注入未生效 /
#     故障下守卫意外 PASS → 一律非 0，禁止静默绿
#   - macOS bash 3.2 兼容（无 mapfile / declare -A）
#   - 本脚本也是 check-cjk-var.sh 的扫描对象——全角标点样本一律用 %s 拼接，
#     保证自身源码合规（$VAR 后跟 %s 半角不触发对方 PATTERN）

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

TARGETS="tools/check/check-cjk-var.sh tools/check/check-guards.sh"
FAILURES=0
CHECKED=0

echo "=== check-guard-fail-loud · 防线失明自检（故障注入）==="

# ── 一、前置探测：目标守卫在位 + 真实引擎健康 ──────────────────
# 目标守卫清单与实际文件对账——清单漂移（守卫改名/移动）必须当场报错，
# 否则本门禁 silently 扫了个不存在的文件，自己成了装饰品。
for _t in ${TARGETS}; do
  if [ ! -f "${_t}" ]; then
    echo "✗ 目标守卫不存在：${_t} —— 门禁清单与实际文件漂移，先修清单"
    exit 1
  fi
done

# 真引擎健康探针（与 check-cjk-var.sh 的 PERL_ALIVE 同款判据）：
# 自检样本必含一处「$VAR 后跟全角逗号」的违规形态，健康引擎必输出 HIT。
# 真引擎自身不可用 → 本门禁无法工作 → fail-loud（不静默跳过）。
# 样本用 %s 拼接全角逗号，保证本行源码自身不触发对方的定界守卫。
_HEALTH=$(printf 'X$fail_loud_probe_var%s' '，' | perl -ne 'print "HIT" if /\$[A-Za-z_][A-Za-z_0-9]*[^\x00-\x7F]/' 2>/dev/null || true)
if [ "${_HEALTH}" != "HIT" ]; then
  echo "✗ 真实 perl 引擎不可用或健康探针未命中——本门禁自身无法工作，fail-loud"
  exit 1
fi
_TARGET_COUNT=$(echo "${TARGETS}" | wc -w | tr -d ' ')
echo "✓ 前置探测：${_TARGET_COUNT} 类目标守卫在位，真实 perl 引擎健康（探针命中）"

# ── 二、故障注入矩阵：每守卫 × 每形态，断言非 0 退出 ────────────
# 注入手法：mktemp 临时目录放假 perl，PATH 前置（真 perl 仍在 PATH 后位，
# 目标守卫内部的一切命令查找都先撞上假的）。目标守卫的子进程（含
# check-guards 调度的 check-cjk-var）继承注入后 PATH——整链传导。
make_fake_perl_dir() {
  # $1 = 形态：crash（exit 3）/ silent（exit 0 无输出）
  _d=$(mktemp -d "${TMPDIR:-/tmp}/fail-loud.XXXXXX")
  if [ "$1" = "crash" ]; then
    printf '#!/bin/sh\nexit 3\n' > "${_d}/perl"
  else
    printf '#!/bin/sh\nexit 0\n' > "${_d}/perl"
  fi
  chmod +x "${_d}/perl"
  echo "${_d}"
}

for _t in ${TARGETS}; do
  for _mode in crash silent; do
    _fake=$(make_fake_perl_dir "${_mode}")
    # 注入自证：PATH 前置后 command -v 解析到的 perl 必须落在假目录内。
    # （假 perl 本身不输出特征——silent 形态的定义就是"成功但无输出"——
    #   所以劫持证明只能看解析路径，不能看输出。）
    # 注入未生效却继续测 = 拿真引擎测「假引擎下的行为」，结论全废。
    _resolved=$(PATH="${_fake}:${PATH}" command -v perl 2>/dev/null || true)
    case "${_resolved}" in
      "${_fake}"/*) : ;;  # 解析到假目录内——劫持生效
      *)
        echo "✗ 注入未生效（perl 解析到 ${_resolved:-（空）} 而非假目录）——中止，本次结果不可信"
        rm -rf "${_fake}"
        exit 1
        ;;
    esac
    PATH="${_fake}:${PATH}" bash "${_t}" > /dev/null 2>&1
    _rc=$?
    CHECKED=$((CHECKED + 1))
    if [ "${_rc}" -ne 0 ]; then
      echo "✓ ${_t} 引擎故障（${_mode}）下正确报红（exit=${_rc}）"
    else
      echo "✗ ${_t} 引擎故障（${_mode}）下仍 exit 0 —— 0 处违规但根本没在看，守卫失明不自知"
      FAILURES=$((FAILURES + 1))
    fi
    rm -rf "${_fake}"
  done
done

# ── 三、正常态参考（信息性输出，不作判定）──────────────────────
# 正常态目标守卫的退出码归对方自己的职责（真违规 exit 1 是对方的正确行为，
# 不是本门禁的失败项）；此处仅打印供人工对照，避免口径混淆。
for _t in ${TARGETS}; do
  bash "${_t}" > /dev/null 2>&1
  echo "ℹ 正常态参考：${_t} exit=$?（0=绿 / 1=对方职责内的真违规——均非失明）"
done

# ── 汇总 ──────────────────────────────────────────────────────
echo ""
if [ "${FAILURES}" -gt 0 ]; then
  echo "✗ ${FAILURES}/${CHECKED} 项故障注入未报红——存在失明不自知的守卫（0 处违规但没在看必须报红）"
  exit 1
else
  echo "✓ ${CHECKED} 项故障注入全部报红——守卫失明必失声（fail-loud 已验证）"
  exit 0
fi
