#!/usr/bin/env bash
# ============================================================
# check-release-closeout.sh · 发版收口门禁（v1.5.5 批 13）
# ============================================================
# 存在理由（实测驱动）：v1.5.4 发版收口不完整——bootstrap 钉值跨 tag 错位（安装链 fail-closed）、
#   README 版本行滞后于 registry、main 分支 pr-check 红着收场、Release workflow 因平台错误形态
#   被判失败。全部是「发版动作做完了，门面没跟上」，且每一处都**各有一道门禁能看见**，
#   但没有一条「收口语义」的硬判据把「main 全绿 + 门面与真值一致」串成可执行动作。
#
# 五项断言（**复用既有零件，只补收口语义的编排与缺失断言**）：
#   ① 安装链三件套同源自洽 + 版本面归零 → 调 tools/check/check-version.sh --strict
#      （§20/§20b/§20c 是唯一实现，本脚本**不另写第二份**——防双实现漂移）
#   ② README 双语版本行 vs registry 真值 → 调 tools/check/check-npm-claims.mjs
#   ③ 架构图注状态 vs 章节状态 → 不得把「已发版」版本标成「规划中」（本脚本新增断言）
#   ④ main 最近一次提交的三条 workflow 结论均为成功（本脚本新增断言）
#   ⑤ Release workflow 重复发布幂等豁免分支在位（本脚本新增断言）
#
# 退出码：0 = 五项全过；1 = 有断言未过。
#
# 🔴 失效模式（新增门禁必须回答何时假绿）：
#   第 ④ 项在无 gh 凭据 / 离线时**无法查询**——此时打印明确告警并按**非通过**处理，
#   不得静默跳过（SKIP 会让「收口未验证」伪装成「收口通过」，正是本门禁要防的那类假绿）。
# ============================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
CLOSE_SKIPS=0
_say_pass() { echo -e "  \033[32m✓\033[0m $1"; PASS=$((PASS + 1)); }
_say_fail() { echo -e "  \033[31m✗\033[0m $1"; FAIL=$((FAIL + 1)); }

echo "═══════════════════════════════════════════════════════════"
echo "  sofagent · 发版收口门禁（closeout）"
echo "═══════════════════════════════════════════════════════════"

# ── ① 安装链三件套同源 + 版本面（复用 check-version.sh --strict）──
echo "=== ① 安装链钉值同源 + 版本面归零（check-version.sh --strict） ==="
if bash tools/check/check-version.sh --strict >/tmp/closeout-cv.log 2>&1; then
  _say_pass "check-version.sh --strict 通过（含 §20 全量 tag 集合 / §20b 同源 / §20c install.sh VERSION）"
else
  _say_fail "check-version.sh --strict 未过 —— 收口不放行"
  grep -E "✗|⚠" /tmp/closeout-cv.log | head -8 | sed 's/^/      /'
fi

# ── ② README 双语版本行 vs registry 真值（复用 check-npm-claims.mjs）──
echo "=== ② 版本行 vs registry 真值（check-npm-claims.mjs） ==="
if node tools/check/check-npm-claims.mjs >/tmp/closeout-npm.log 2>&1; then
  _say_pass "npm 实测声称与 registry 一致（含双语文档声称）"
else
  rc=$?
  if [ "$rc" -eq 2 ]; then
    _say_fail "registry 不可达 / 豁免台账已落地 —— 收口须在可联网环境补跑（不静默跳过）"
  else
    _say_fail "npm 声称与 registry 真值不一致"
  fi
  grep -E "❌" /tmp/closeout-npm.log | head -6 | sed 's/^/      /'
fi

# ── ③ 架构图注状态 vs 章节状态（本脚本新增）──
echo "=== ③ 版本状态一致性：不得把已发版版本标成「规划中」 ==="
_c3_bad=0
# 从 CHANGELOG 取「已发版」的版本集合
_released=$(grep -oE '^\- \*\*v[0-9]+\.[0-9]+\.[0-9]+\*\* — .*已发版' CHANGELOG.md | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -u || true)
if [ -z "$_released" ]; then
  _say_fail "无法从 CHANGELOG 解析已发版版本集合（解析面失明，拒绝假绿）"
else
  for _v in $_released; do
    # CN：「规划中（vX.Y.Z）」；EN：「planned for vX.Y.Z」
    if grep -qE "规划中（${_v}）|规划中\(${_v}\)|planned for ${_v}" README.md README.en.md 2>/dev/null; then
      echo "      ✗ README 把已发版版本 ${_v} 标为「规划中」（架构图注/正文状态漂移）"
      _c3_bad=$((_c3_bad + 1))
    fi
  done
  if [ "$_c3_bad" -eq 0 ]; then
    _say_pass "双语 README 无「已发版版本被标规划中」的状态漂移（比对 $(echo "$_released" | wc -l | tr -d ' ') 个已发版版本）"
  else
    _say_fail "${_c3_bad} 处版本状态漂移"
  fi
fi

# ── ④ main 最近一次提交的三条 workflow 结论（本脚本新增）──
echo "=== ④ main 最近一次提交的 workflow 结论 ==="
REPO_SLUG="${SOFAGENT_REPO_SLUG:-KongFangXun/sofagent}"
if ! command -v gh >/dev/null 2>&1; then
  _say_fail "gh 不可用 —— 无法验证 main 的三条 workflow（按非通过处理，不静默跳过）"
else
  _runs_json=$(gh run list --repo "$REPO_SLUG" --branch main --limit 30 --json name,conclusion,headSha 2>/dev/null || true)
  if [ -z "$_runs_json" ]; then
    _say_fail "gh 查询失败（离线 / 未登录）—— 按非通过处理，须在可联网环境补跑"
  else
    _head=$(git rev-parse HEAD 2>/dev/null || echo "")
    _res=$(printf '%s' "$_runs_json" | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        const runs=JSON.parse(s); const head=process.argv[1];
        const want=['pr-check','verify','sofagent-audit'];
        const mine=runs.filter(r=>!head||r.headSha===head);
        const out=[];
        for(const w of want){const r=mine.find(x=>x.name===w);
          out.push(w+':'+(r?r.conclusion:'absent'));}
        process.stdout.write(out.join(' '));
      });" "$_head" 2>/dev/null || echo "parse-error")
    echo "      最近提交 ${_head:0:8} 的结论：${_res}"
    case "$_res" in
      "pr-check:success verify:success sofagent-audit:success")
        _say_pass "三条 workflow 均为 success（pr-check / verify / sofagent-audit）" ;;
      "parse-error"|"")
        _say_fail "workflow 结论解析失败（按非通过处理）" ;;
      "pr-check:absent verify:absent sofagent-audit:absent")
        # 🔴 三态区分（v1.5.5 落地时的实测修正）：HEAD 无对应 run 只有一种成因——
        #   该提交**尚未推送**。这在 pre-push 语境下是**常态**（本脚本正是推送前检查项之一），
        #   而本项的语义是「推送后的收口复核」。若在此判红，本门禁在推送前永远红、失去意义；
        #   若静默跳过，又会把「收口未验证」伪装成「收口通过」（本门禁存在的理由）。
        #   故：**显式降级跳过（⏭️，可见、不假绿）**，并打印 main 最新一轮的结论作参照信号。
        _latest=$(gh run list --repo "$REPO_SLUG" --branch main --limit 12 --json name,conclusion \
                  --jq '[.[] | select(.name=="pr-check" or .name=="verify" or .name=="sofagent-audit")] | .[0:3] | map(.name+":"+.conclusion) | join(" ")' 2>/dev/null || echo "")
        echo "      ⏭️  HEAD 未推送（无对应 workflow run）——本项属「推送后复核」，此处降级跳过"
        echo "          main 最新一轮参照：${_latest:-（查询失败）}"
        CLOSE_SKIPS=$((CLOSE_SKIPS + 1))
        ;;
      *)
        _say_fail "存在非 success 结论 —— 收口不放行" ;;
    esac
  fi
fi

# ── ⑤ Release workflow 幂等豁免分支在位（本脚本新增）──
echo "=== ⑤ Release 重复发布幂等豁免分支 ==="
# 🔴 grep -c 在「零命中」时**既打印 0 又返回退出码 1**——写成 `|| echo 0` 会得到 "0\n0"
#   让 `-ge` 比较失真（本仓 check-guards 的「grep -c 双零地雷」规则即为此设，已实测拦下本行初版）。
#   正确形态：`|| true` 忽略退出码，保留 grep 自己打印的那个 0。
CLOSE_PUBLISH_HITS=$(grep -c 'registry 二次确认' .github/workflows/release.yml 2>/dev/null) || true
if grep -q 'is not in this registry' .github/workflows/release.yml 2>/dev/null \
   && [ "${CLOSE_PUBLISH_HITS:-0}" -ge 2 ]; then
  _say_pass "release.yml 两处 publish 均带 E404 形态豁免 + registry 二次确认"
else
  _say_fail "release.yml 缺 E404 形态豁免分支（重复发布会被判红）"
fi

echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  \033[32m✓ 发版收口门禁全过（${PASS} 项通过${CLOSE_SKIPS:+, ${CLOSE_SKIPS} 项降级跳过}）\033[0m"
  [ "${CLOSE_SKIPS:-0}" -gt 0 ] && echo "    ⏭️  降级跳过项须在推送后复核（发版 SOP「SKIP 数逐条裁决」同口径）"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
fi
echo -e "  \033[31m✗ 发版收口门禁未过：${FAIL} 项失败 / ${PASS} 项通过\033[0m"
echo "═══════════════════════════════════════════════════════════"
exit 1
