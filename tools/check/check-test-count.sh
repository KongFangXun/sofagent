#!/usr/bin/env bash
# ============================================================
# check-test-count.sh · 文档声称测试数 vs 实际测试数一致性校验
# ============================================================
# P1-3 根治：文档硬编码测试数必然漂移（每次新增/删除测试用例
# 都得手动改 CHANGELOG/ROADMAP/LIMITATIONS/evidence.md）。
# 本脚本自动校验——跑 test-count.sh 拿 SSOT 真值，再 grep
# 各文档当前版本声称的数字，不匹配就 exit 1。
#
# 用法:
#   ./tools/check/check-test-count.sh           # 人读输出（**只读**：默认路径绝不写仓内文件）
#   ./tools/check/check-test-count.sh --quiet   # 只输出 OK/FAIL
#   ./tools/check/check-test-count.sh --fix     # 显式落盘：先打印 file:line 与 旧→新，再替换，再自动复验
#
# 退出码:
#   0 = 文档声称数全部与实际一致（或 --fix 落盘后复验全绿）
#   1 = 有文档漂移（会列出具体文件+行号+声称值 vs 实际值）
#   2 = 参数误用（--fix 与 --quiet/--scenarios-only 互斥）或 --fix 环境缺 node
#
# 漂移输出升级（「人工找落点」→「可直接执行的修复命令」）：
#   ① 每条漂移除「file（行 N）：声称 X，实际 Y」外，另打印一条落点行
#        ↳ 修复落点：<file>:<line>（X → Y）
#      末尾汇总「可自动替换 N 处 / 需人工 M 处」清单，并给出**可直接粘贴执行**
#      的 `node -e …` 修复命令 + 等价的 `--fix` 形式。
#   ② 替换引擎用 **node 不 bare sed**：BSD sed 在本机 LANG=C.UTF-8 下遇多字节
#      输入有「整段输出为空」的历史坑（见 tools/check/test-count.sh 内同族注记），
#      且仓内 sync-test-count.sh / check-literals.sh 的替换一律走 node——单一实现。
#
# 🔴 anchor 铁律（修复 correctness 的根）：每条 anchor 必须与「检测该值时用的提取
#   正则」同源，且**数字为捕获组 1**；替换只改该行**首处**匹配 ⇒ 被替换的那处
#   == 被检查的那处（杜绝「报 A 行、改 B 处」）。锚不得含反斜杠转义与单引号，
#   因为清单要序列化成 JSON 再内联进可粘贴命令。
# ============================================================

set -uo pipefail

# ── 覆盖度行范式（v1.4.9 G-2②）——必须在 cd 之前取自身目录 ──
_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

cd "$(dirname "$0")/../.." || exit 1

QUIET=false
SCENARIOS_ONLY=false
FIX_MODE=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --scenarios-only) SCENARIOS_ONLY=true ;;
    --fix) FIX_MODE=true ;;
    --help|-h)
      echo "check-test-count.sh — 文档声称测试数 vs 实际一致性校验"
      echo "  --quiet           只输出 OK / FAIL"
      echo "  --scenarios-only  只跑 acceptance 场景数守卫（纯文本对账秒级，不跑 npm test）"
      echo "  --fix             先把每处落点的 file:line 与 旧→新 打印出来，再回填文档，最后重跑自校验"
      echo "  --help            显示帮助"
      exit 0 ;;
    *) echo "未知参数：${arg}（支持 --quiet / --scenarios-only / --fix / --help）" >&2; exit 2 ;;
  esac
done

# ── 参数互斥 + 显式未知参数拒绝（fail-loud：不静默忽略）──
# --quiet 的契约是「只输出 OK/FAIL」（CI / pre-push 依赖该机器可读契约），与
# 「先打印计划再落盘」的 --fix 语义不可兼容 → 拒绝，而不是让其中一方静默失效。
if [ "$FIX_MODE" = true ] && [ "$QUIET" = true ]; then
  echo "✗ --fix 与 --quiet 互斥：quiet 的契约是「只输出 OK/FAIL」，无法同时打印修复计划并落盘" >&2
  exit 2
fi
if [ "$FIX_MODE" = true ] && [ "$SCENARIOS_ONLY" = true ]; then
  echo "✗ --fix 与 --scenarios-only 互斥：场景守卫只做文本对账，没有可回填的数值漂移" >&2
  exit 2
fi

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
# SKIPS（v1.4.9 G-2②）：显式跳过项计数——「未找到声称即跳过」正是本批要消灭的静默形态。
# 本脚本五类 skip：① 占位 devlog（**head-10 状态区**含「尚未实现」）
# ② 已发布 devlog（历史冻结，发版快照不回头改；v1.4.9 G-3 补记账——此前该分支不计 SKIPS）
# ③ ROADMAP/evidence 引用的同版本开发日志快照取不到 ④ CHANGELOG 行开发日志快照提取失败
# ⑤ CHANGELOG 索引行缺 workspace 口径标注。
# K>0 不阻断（跳过合法性由发版 SOP「SKIP 数逐条裁决」裁定），但必须打印。
SKIPS=0

# 覆盖度行输出助手（v1.4.9 G-2②）：**--quiet 模式不输出**——该模式的契约是「只输出 OK/FAIL」
# （CI/pre-push 依赖），追加任何行都会破坏机器可读契约。quiet 模式另由调用方负责裁决。
emit_coverage_verbose() {
  [ "${QUIET}" = true ] && return 0
  local _cov_md
  # covered 口径：仓内 tracked `.md` 文件数**上界**（本脚本按「文档 × 声称项」校验，
  # 无单一文件清单；上界非精确值，显式标注勿当精确计数引用）
  _cov_md=$(git ls-files '*.md' 2>/dev/null | wc -l | tr -d ' ')
  _cov_md=${_cov_md:-0}
  emit_coverage_line "check-test-count" "$(( ${1:-0} ))" "${_cov_md}" "${SKIPS}"
}

# ════════════════════════════════════════════════════════════════
# 修复落点登记 + 可执行修复命令（「人工找落点」→「一条命令」）
# ════════════════════════════════════════════════════════════════
# 病（本批要消灭的机制债）：门禁报了「LIMITATIONS.md（行 478）：声称 5094，实际 5098」，
#   人拿到「file（行 N）」还得逐文件去找、手改，且各文件模式不同（`5094 测试` /
#   `5094 tests` / `5094 个测试`）。5 处落点 = 5 次人工定位，每次加测试重来一遍。
#
# 分工（硬契约）：
#   · 默认路径 = **只登记 + 只打印**，绝不写仓内文件。门禁默认只读是契约
#     （pre-push / CI 直接消费），写职责必须由显式 `--fix` 承担。
#   · `--fix` = 显式落盘：先打印 file:line 与 旧→新 → 再替换 → 最后重跑自校验
#     （与 check-literals.sh 的 --fix 同范式：不留半修态）。
#
# anchor 铁律见头部注释：数字必须是 anchor 的**捕获组 1**，且只替换行内**首处**匹配；
#   全部 anchor 与检测用正则同源（逐条在调用点就近注明）⇒ 报的那处 == 改的那处。
# 数据安全：清单字段仅由本脚本自产（固定文件清单 / 纯数字 / 无反斜杠反引号的 anchor），
#   故可安全序列化成 JSON 并内联进可粘贴命令；下方仍留单引号兜底（见汇总段）。
FIX_FILE=""
FIX_SITES=0
MANUAL_SITES=0
FIX_JSON=""
trap 'rm -f "${FIX_FILE:-}"' EXIT

# record_fix <file> <line> <old> <new> <anchor>
record_fix() {
  local _rf_file="$1" _rf_line="$2" _rf_old="$3" _rf_new="$4" _rf_anchor="$5"
  local _rf_rec
  _rf_rec=$(printf '%s\t%s\t%s\t%s\t%s' "$_rf_file" "$_rf_line" "$_rf_old" "$_rf_new" "$_rf_anchor")
  # 去重：LIMITATIONS.md 的总量声称行被「首段校验」与「多行循环」各查一次，
  # 不去重会在落点清单与 --fix 计划里重复出现（同一事实印两遍，读起来像两处漂移）。
  if [ -n "$FIX_FILE" ] && grep -qF -- "$_rf_rec" "$FIX_FILE" 2>/dev/null; then
    return 0
  fi
  if [ -z "$FIX_FILE" ]; then
    FIX_FILE=$(mktemp "${TMPDIR:-/tmp}/check-test-count-fix.XXXXXX") || FIX_FILE=""
    if [ -z "$FIX_FILE" ]; then
      echo -e "  ${RED}✗ 无法创建修复清单临时文件（TMPDIR=${TMPDIR:-/tmp}）——本处落点无法生成修复命令（不静默降级）${NC}"
      return 0
    fi
  fi
  printf '%s\n' "$_rf_rec" >> "$FIX_FILE"
  FIX_SITES=$((FIX_SITES + 1))
  if [ "$QUIET" = false ]; then
    echo -e "    ${YELLOW}↳ 修复落点：${_rf_file}:${_rf_line}（${_rf_old} → ${_rf_new}）${NC}"
  fi
}

# record_manual <file> <line> <reason>
# 结构性漂移（措辞/格式失配、提取为空、快照源缺失）**没有**「旧→新」可替换——
# 强行给个 sed 只会改错地方。故显式登记为「需人工」，并计入汇总，避免被静默吞掉。
record_manual() {
  local _rm_file="$1" _rm_line="$2" _rm_reason="$3"
  MANUAL_SITES=$((MANUAL_SITES + 1))
  if [ "$QUIET" = false ]; then
    echo -e "    ${YELLOW}↳ 落点：${_rm_file}:${_rm_line}（${_rm_reason}，无自动替换）${NC}"
  fi
}

# 替换引擎（默认路径与 --fix 共用同一份实现，避免两条修复路径各自漂移）。
# 写法约束（硬）：**只用双引号**——它要被内联进 `node -e '…'` 的单引号里。
# 替换位置用 lastIndexOf：anchor 的捕获组 1 就是目标数字，而锚内其余部分
# （如「测试 4279→」前缀）可能含数字 ⇒ 取**最后一次**出现才是目标处。
FIXER_JS='const fs=require("fs");const E=JSON.parse(process.argv[1]);let a=0,f=0;for(const[file,line,oldV,newV,anchor]of E){let s;try{s=fs.readFileSync(file,"utf8").split("\n");}catch(e){console.log("  X 读取失败: "+file);f++;continue;}const i=line-1;if(i<0||i>=s.length){console.log("  X 行号越界: "+file+":"+line);f++;continue;}let re;try{re=new RegExp(anchor);}catch(e){console.log("  X anchor 非法: "+file+":"+line);f++;continue;}const before=s[i];const after=before.replace(re,(m,g1)=>{const at=m.lastIndexOf(g1);return at<0?m:m.slice(0,at)+newV+m.slice(at+g1.length);});if(after===before){console.log("  = 无需改动(已一致): "+file+":"+line);continue;}s[i]=after;fs.writeFileSync(file,s.join("\n"));a++;console.log("  OK "+file+":"+line+"  "+oldV+" -> "+newV);}console.log("  --fix 结果：已改 "+a+" 处，失败 "+f+" 处");process.exit(f>0?1:0);'

# 清单 → JSON 数组（由 node 承担转义：文件路径与 anchor 都走同一层，不手写转义）
build_fix_json() {
  FIX_JSON=""
  [ -n "$FIX_FILE" ] || return 0
  [ -s "$FIX_FILE" ] || return 0
  FIX_JSON=$(node -e '
const fs=require("fs");
const rows=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(l=>l.length>0);
const out=rows.map(l=>{const p=l.split("\t");return [p[0],Number(p[1]),p[2],p[3],p[4]];});
process.stdout.write(JSON.stringify(out));
' "$FIX_FILE" 2>/dev/null)
  if [ -z "$FIX_JSON" ]; then
    echo -e "  ${RED}✗ 修复清单转 JSON 失败（node 不可用或清单损坏）——本次不提供可粘贴命令${NC}"
  fi
}

# ── acceptance-test.sh 场景数守卫（F-01/F-02 · v1.4.3 函数化重构）──
# SSOT = acceptance-test.sh 头部「NNN 个场景」声明。三处文档
# （DEVELOPMENT.md / LIMITATIONS.md / changelog v1.2.3.md）必须与之一致。
# v1.3.5 #5 元教训（四份审查独立命中「守卫之死」）：凡是「未找到 X 则跳过」的守卫，
#   跳过本身必须算 FAIL——否则守卫的存在感为零（守卫空转比没有守卫更危险）。
#   本脚本此前 head -10 读不到第 11 行的 SSOT 声明（v1.3.1 加 LANG export 挤行所致），
#   WARN 每次出现但从未有人在意，场景守卫长期失效。现改为：
#   ① head -10 → head -20（声明行挪动几行不再失明）
#   ② 头部声明缺失 → 直接 FAIL（exit 1），不再 WARN 跳过
# v1.4.3 阶段十二：整段抽为 run_scenario_guard 函数——主路径与 --scenarios-only
#   轻量模式（commit 时秒级拦截场景数漂移，背景：v1.4.3 S361 后 DEVELOPMENT/
#   LIMITATIONS 两处漂移均到 pre-push 才暴露）共用同一实现，单一 SSOT 口径。
#   守卫不依赖 npm test（SSOT 从 acceptance-test.sh 头部 grep 提取），
#   故函数定义置于 npm test 之前——轻量模式在此早退，秒级完成。
#   计数经全局 SCEN_PASS/SCEN_FAIL 返回，由调用方累入 PASS/FAIL。
run_scenario_guard() {
  SCEN_PASS=0
  SCEN_FAIL=0
  ACCEPTANCE_ACTUAL=$(head -20 playbook/acceptance-test.sh 2>/dev/null | grep -oE '[0-9]+ 个场景' | head -1 | grep -oE '[0-9]+' || echo "")
  if [ -z "$ACCEPTANCE_ACTUAL" ]; then
    echo -e "  ${RED}✗ acceptance-test.sh 头部（前 20 行）未找到「NNN 个场景」声明——场景守卫 FAIL（不再静默跳过）${NC}"
    echo -e "    守卫空转比没有守卫更危险：请在脚本头部补 SSOT 声明「# 场景数：NNN 个场景」"
    SCEN_FAIL=$((SCEN_FAIL + 1))
    return
  fi
  if [ "$QUIET" = false ]; then
    echo -e "  场景数 SSOT：acceptance-test.sh 头部声明 ${ACCEPTANCE_ACTUAL} 个场景"
  fi

  # ── 回数控件（v1.2.4 修复）：实测文件真实 scenario 调用数 vs SSOT 声明 ──
  # 这是守卫的核心，此前完全缺失——只比对"头部↔文档"，从不回数文件里的真实调用，
  # 导致 v1.2.3/v1.2.4 用带 bug 的裸 grep（把 echo 探针 "scenario 48/49" 误当声明）
  # 数出脏数 100/105 仍一路骗绿。精确口径：'scenario N "'（数字后紧跟空格+引号），
  # 真实场景调用恒为此格式；echo 探针为 'scenario 48"'（引号紧贴数字、前有空格），天然可区分。
  # v1.2.5: 正则扩展支持字母后缀（34b/34c/167a/167b），[0-9]+ → [0-9]+[a-z]?
  SCENARIO_REAL=$(grep -oE 'scenario [0-9]+[a-z]? "' playbook/acceptance-test.sh 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SCENARIO_REAL" = "$ACCEPTANCE_ACTUAL" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ acceptance-test.sh 实测 ${SCENARIO_REAL} 个真实场景调用，与 SSOT 声明一致${NC}"
    fi
    SCEN_PASS=$((SCEN_PASS + 1))
  else
    echo -e "  ${RED}✗ acceptance-test.sh 实测 ${SCENARIO_REAL} 个真实场景调用，SSOT 声明 ${ACCEPTANCE_ACTUAL} —— 头部数字与文件实际不符${NC}"
    echo -e "    计数命令：grep -oE 'scenario [0-9]+[a-z]? \"' playbook/acceptance-test.sh | wc -l"
    echo -e "    提示：勿用裸 grep 'scenario [0-9]+'（会把 echo 探针文本误算进去）"
    SCEN_FAIL=$((SCEN_FAIL + 1))
  fi

  # 逐个校验三处文档的场景数声称值
  check_scenario_doc() {
    local label="$1" file="$2" lineno="$3" claimed="$4"
    if [ "$claimed" = "$ACCEPTANCE_ACTUAL" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ${label}（行 ${lineno}）：${claimed} 场景${NC}"
      fi
      SCEN_PASS=$((SCEN_PASS + 1))
    else
      echo -e "  ${RED}✗ ${label}（行 ${lineno}）：声称 ${claimed} 场景，SSOT 声明 ${ACCEPTANCE_ACTUAL}${NC}"
      echo -e "    文件：${file}"
      SCEN_FAIL=$((SCEN_FAIL + 1))
    fi
  }

  # ① DEVELOPMENT.md — "acceptance-test.sh（NNN 场景）"
  # v1.5.1 F4：原实现 `grep -n … | head -1` **只取首个匹配行**——同文档其余
  #   「NNN 场景」声称**完全不受检**，多值并存时首个命中即放行（整类假绿）。
  #   改为**逐行全检**：每处声称各出一个判定。缺失声称 ⇒ FAIL（守卫不空转）。
  DEV_MATCHES=$(grep -nE 'acceptance-test\.sh.*[0-9]+ 场景' docs/DEVELOPMENT.md 2>/dev/null)
  if [ -z "$DEV_MATCHES" ]; then
    echo -e "  ${RED}✗ docs/DEVELOPMENT.md 未找到「acceptance-test.sh … NNN 场景」声称——措辞漂移或段被删（守卫不空转，判 FAIL）${NC}"
    SCEN_FAIL=$((SCEN_FAIL + 1))
  else
    while IFS= read -r _dev_ln; do
      [ -n "$_dev_ln" ] || continue
      check_scenario_doc "DEVELOPMENT.md" "docs/DEVELOPMENT.md" \
        "$(echo "$_dev_ln" | cut -d: -f1)" \
        "$(echo "$_dev_ln" | grep -oE '[0-9]+ 场景' | head -1 | grep -oE '[0-9]+')"
    done <<< "$DEV_MATCHES"
  fi

  # ② LIMITATIONS.md — "acceptance-test.sh NNN 场景"（当前版本口径）
  # 注意（行内取值）：该行同时含「OpenClaw 验收 63 场景」，行内 `head -1` 只取 acceptance
  #   紧邻数字，否则 grep -oE 会连带捕获 63 造成误报——**此处 head -1 是行内取值，保留**。
  # v1.5.1 F4：但**行的选取**不得 `head -1`——改为逐行全检；且缺失声称 ⇒ FAIL
  #   （原实现是 `if [ -n … ]` 无 else ⇒ 找不到就静默跳过，属守卫空转）。
  LIM_SCN_MATCHES=$(grep -nE 'acceptance-test\.sh [0-9]+ 场景' docs/LIMITATIONS.md 2>/dev/null)
  if [ -z "$LIM_SCN_MATCHES" ]; then
    echo -e "  ${RED}✗ docs/LIMITATIONS.md 未找到「acceptance-test.sh NNN 场景」声称——措辞漂移或段被删（守卫不空转，判 FAIL）${NC}"
    SCEN_FAIL=$((SCEN_FAIL + 1))
  else
    while IFS= read -r _lim_ln; do
      [ -n "$_lim_ln" ] || continue
      check_scenario_doc "docs/LIMITATIONS.md" "docs/LIMITATIONS.md" \
        "$(echo "$_lim_ln" | cut -d: -f1)" \
        "$(echo "$_lim_ln" | grep -oE 'acceptance-test\.sh [0-9]+ 场景' | head -1 | grep -oE '[0-9]+')"
    done <<< "$LIM_SCN_MATCHES"
  fi

  # ③ changelog v1.2.3.md — 历史冻结文档，场景数不随当前 SSOT 变化（v1.2.3 发版时 SSOT=100）
  #    仅校验文档内部自洽（分母=分子），不与当前 SSOT 比对
  CHG_SCN_LINE=$(grep -nE '[0-9]+/[0-9]+ 场景 PASS' docs/changelog/v1.2/v1.2.3.md 2>/dev/null | head -1)
  if [ -n "$CHG_SCN_LINE" ]; then
    CHG_CLAIMED="$(echo "$CHG_SCN_LINE" | grep -oE '[0-9]+/[0-9]+ 场景' | head -1 | grep -oE '^[0-9]+')"
    CHG_DENOM="$(echo "$CHG_SCN_LINE" | grep -oE '[0-9]+/[0-9]+ 场景' | head -1 | grep -oE '/[0-9]+' | tr -d '/')"
    CHG_LINENO=$(echo "$CHG_SCN_LINE" | cut -d: -f1)
    if [ "$CHG_CLAIMED" = "$CHG_DENOM" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ changelog v1.2.3.md（行 ${CHG_LINENO}）：历史冻结 ${CHG_CLAIMED}/${CHG_DENOM}（内部自洽，不与当前 SSOT 比对）${NC}"
      fi
      SCEN_PASS=$((SCEN_PASS + 1))
    else
      echo -e "  ${RED}✗ changelog v1.2.3.md（行 ${CHG_LINENO}）：${CHG_CLAIMED}/${CHG_DENOM} 分母分子不自洽${NC}"
      SCEN_FAIL=$((SCEN_FAIL + 1))
    fi
  fi
  # ④ changelog v1.2.6.md — 历史冻结文档（v1.2.7 起 v1.2.6 不再是当前版本）
  # v1.2.7: 改为历史冻结校验（场景数不随当前 SSOT 变化，v1.2.6 发版时 SSOT=132）
  CHG126_SCN_LINE=$(grep -nE '[0-9]+ 场景' docs/changelog/v1.2/v1.2.6.md 2>/dev/null | head -1)
  if [ -n "$CHG126_SCN_LINE" ]; then
    CHG126_CLAIMED=$(echo "$CHG126_SCN_LINE" | grep -oE '[0-9]+ 场景' | grep -oE '[0-9]+' | head -1)
    CHG126_LINENO=$(echo "$CHG126_SCN_LINE" | cut -d: -f1)
    echo -e "  ${GREEN}✓ changelog v1.2.6.md（行 ${CHG126_LINENO}）：历史冻结 ${CHG126_CLAIMED} 场景（v1.2.6 发版时 SSOT，不与当前比对）${NC}"
  fi

  # ⑤ ROADMAP.md「场景数 SSOT 口径」段的「当前值 NNN」（v1.4.9 G-4 补：该声称此前**零守卫**）
  #    实测它已静默漂移：ROADMAP 段写「当前值 338」而 SSOT（acceptance 头部声明）= 339
  #    （批三 P1-10 加了回归锁 S412 后没人回填）——数字声称在文档里却没有任何断言，正是 G-4 的缺口形态。
  #    判据：与 SSOT 严格相等；提取为空 ⇒ FAIL（守卫不空转）。
  ROADMAP_SCN_LINE=$(grep -nE '当前值 [0-9]+（最大场景号' docs/ROADMAP.md 2>/dev/null | head -1)
  if [ -z "$ROADMAP_SCN_LINE" ]; then
    echo -e "  ${RED}✗ docs/ROADMAP.md 未找到「当前值 NNN（最大场景号 …）」声称——措辞漂移或段被删（守卫不空转，判 FAIL）${NC}"
    SCEN_FAIL=$((SCEN_FAIL + 1))
  else
    check_scenario_doc "docs/ROADMAP.md（场景数 SSOT 口径段）" "docs/ROADMAP.md" \
      "$(echo "$ROADMAP_SCN_LINE" | cut -d: -f1)" \
      "$(echo "$ROADMAP_SCN_LINE" | grep -oE '当前值 [0-9]+' | grep -oE '[0-9]+' | head -1)"
  fi
}

# ── 轻量模式入口（--scenarios-only · v1.4.3 阶段十二优化）：跳过 npm test，只跑场景守卫 ──
# 用途：改 acceptance 场景数后的秒级自检/commit 前拦截——漂移不再等到 pre-push 才暴露。
if [ "$SCENARIOS_ONLY" = true ]; then
  run_scenario_guard
  # 覆盖度行同样受 --quiet 契约约束（该模式只输出 OK/FAIL）
  if [ "$SCEN_FAIL" -gt 0 ]; then
    echo -e "${RED}场景数守卫：${SCEN_FAIL} 项 FAIL${NC}"
    [ "$QUIET" = false ] && emit_coverage_line "check-test-count" "$((SCEN_PASS + SCEN_FAIL))" "-" "${SKIPS}"
    exit 1
  fi
  echo -e "${GREEN}场景数守卫：全过（SSOT 对账一致）${NC}"
  [ "$QUIET" = false ] && emit_coverage_line "check-test-count" "$((SCEN_PASS + SCEN_FAIL))" "-" "${SKIPS}"
  exit 0
fi

# ── 跑 test-count.sh 拿 SSOT 真值 ──
if [ "$QUIET" = false ]; then
  echo -e "\n${BOLD}── 文档测试数一致性校验 ──${NC}"
  echo "  跑 test-count.sh 获取实际测试数..."
fi

# v1.2.3 修复：test-count.sh 非 quiet 模式的「总计」行带 ANSI BOLD 码（总计: \033[1m1207 tests），
# 在 CI 非 TTY 环境下 grep '总计: [0-9]+' 恒失败。优先信任 test-count.sh 末尾的机器可读行
# TOTAL_TESTS=NNN（该行不受 ANSI/quiet 守卫影响，恒输出），再回退到 quiet 模式与「总计」行。
# v1.3.3 #10: 提前初始化 TC_RC + 显式 || TC_RC=$? 兜底，避免 set -u 下失败路径崩溃。
TC_RC=0
TC_OUT=$(bash tools/check/test-count.sh 2>/dev/null) || TC_RC=$?
# v1.3.2 P0-R8 (P1-15): 修复门禁假绿——test-count.sh 的退出码此前被 $() 吞掉。
# 若任一包测试失败，test-count.sh 退出 1 但其输出仍含 TOTAL_TESTS=NNN（总数不变），
# 旧脚本只看 TOTAL_TESTS 与文档比对 → 文档匹配就返回 OK/EXIT=0，测试实际失败仍被放行。
# 修复：test-count.sh 自身失败（RC≠0）时直接 FAIL/exit 1，门禁真实反映测试状态。
if [ "$TC_RC" -ne 0 ]; then
  if [ "$QUIET" = false ]; then
    echo -e "  ${RED}✗ test-count.sh 失败（RC=${TC_RC}）——有包测试失败或脚本错误，门禁红${NC}"
    echo -e "  ${YELLOW}修法：跑 bash tools/check/test-count.sh 看哪个包失败，修复测试后再跑本脚本${NC}"
  else
    echo "FAIL"
  fi
  emit_coverage_verbose "$((PASS + FAIL))"
  exit 1
fi
# 主路径：机器可读行 TOTAL_TESTS=NNN（strip ANSI 后 grep，最鲁棒）
TOTAL_TESTS=$(echo "$TC_OUT" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+' || echo "0")
# 回退 1：quiet 模式（同样有机器可读行）
if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  TOTAL_TESTS=$(bash tools/check/test-count.sh --quiet 2>/dev/null | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -oE 'TOTAL_TESTS=[0-9]+' | grep -oE '[0-9]+' || echo "0")
fi
# 回退 2：非 quiet 的「总计: NNN tests」人读行（strip ANSI 后再匹配）
if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  TOTAL_TESTS=$(echo "$TC_OUT" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -oE '总计: [0-9]+ tests' | grep -oE '[0-9]+' || echo "0")
fi

if [ -z "$TOTAL_TESTS" ] || [ "$TOTAL_TESTS" = "0" ]; then
  echo -e "  ${RED}✗ 无法获取实际测试数（test-count.sh 失败）${NC}"
  emit_coverage_verbose "$((PASS + FAIL))"
  exit 1
fi

# P0-13: 实际包数（有 test script 的 workspace 包，SSOT 口径 "12 包"）——机器可读行 PKGS=NNN
PKG_COUNT=$(echo "$TC_OUT" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -oE 'PKGS=[0-9]+' | grep -oE '[0-9]+' | head -1 || echo "0")
[ -z "$PKG_COUNT" ] && PKG_COUNT=0

# B13: 模块包数（README 声称「13 模块包」对账用）
# v1.4.0：只数发布到 npm 的 13 个 @sofagent/* 引擎模块包——engine/dsh-plugins/ 下
#   7 个插件包（v1.4.9 P2 合并批 10→7；v1.5.2 章九起已摘 `private` 并上 npm，但**仍不计入
#   「模块包」口径**——插件另有 DSH_PLUGIN_COUNT 口径，两条口径不混算）、
#   engine/dsh-plugins/plugin-kit（v1.5.2 章九二轮起为 workspace 成员 + npm 发布物
#   @sofagent/dsh-plugin-kit，但属 DSH 插件族**适配层基座包**非模块包，同样不计入；
#   见下方 :401 插件计数段的同源说明）、
#   engine/umbrella 是 npm 裸名总包（走 [README] 另一个口径：
#   「14 个模块包发布至 npm @sofagent scope」= 13 模块 + umbrella）、
#   engine/hooks/sofagent-load-chain 是构建序列末位的工具包（见 docs/WIKI.md §六 口径表），
#   以上均不计入。
# 兜底用 || true 而非 || echo "0"：grep -c 零匹配已自行输出单行 0，|| echo 0 追加第二行成双零
# v1.4.8 第 7 批（train 拆包）：本清单同步 +train（第 13 个模块包），并**去掉 hooks/**——
#   原清单 12 模块 + hooks/ 恰好也是 13，数值未变但语义不对（把 load-chain 当模块包数）。
#   现值 = 12 模块 + train = 13，与 README「13 模块包」/ WIKI「13 个 @sofagent/* 模块包」对齐。
WORKSPACE_COUNT=$(grep -cE '^[[:space:]]*"engine/(inject|ontology|eval|core|think|audit|orchestrator|train|daemon|ab-test|evolve|mcp|rules)"' package.json || true)
[ -z "$WORKSPACE_COUNT" ] && WORKSPACE_COUNT=0

# 任务八方案A（2026-08-29）：README 包数口径升级为双口径「13 模块包 + 14 插件（10 DSH + 4 OpenClaw）」。
# 插件数 SSOT = 结构性判据（插件命名前缀），**非目录计数**——
# engine/dsh-plugins/ 下还存放基座包 plugin-kit 与非插件资产，数目录会把非插件多计进来。
# 本判据与 tools/check/check-storefront.sh:44 的 `for d in engine/dsh-plugins/cordis-plugin-sofagent*`
# 同源同口径（一个口径两处消费，避免各数各的）；模块包 SSOT 仍为 WORKSPACE_COUNT。
# ⚠️ glob 一律写 `cordis-plugin-sofagent*`（**不带尾横线**）：聚合插件包名是裸名
#   cordis-plugin-sofagent，带尾横线的写法定会把第 10 个插件漏数（曾实锤）。
# v1.4.8 第 7 批：DSH 插件 9→10（聚合插件入列），插件合计 13→14。
# v1.4.9 P2 合并批：DSH 插件 10→7（ontology/commons 并入 fde、gate 并入 audit），
#   插件合计 14→11——README/README.en.md 的「11 插件 / 11 plugins」同批更新。
DSH_PLUGIN_COUNT=0
for d in engine/dsh-plugins/cordis-plugin-sofagent*; do
  [ -d "$d" ] && DSH_PLUGIN_COUNT=$((DSH_PLUGIN_COUNT + 1))
done
DSH_PLUGIN_COUNT=${DSH_PLUGIN_COUNT:-0}
OPENCLAW_PLUGIN_COUNT=0
for d in engine/openclaw-plugins/sofagent-*; do
  [ -d "$d" ] && OPENCLAW_PLUGIN_COUNT=$((OPENCLAW_PLUGIN_COUNT + 1))
done
OPENCLAW_PLUGIN_COUNT=${OPENCLAW_PLUGIN_COUNT:-0}
PLUGIN_TOTAL=$(( DSH_PLUGIN_COUNT + OPENCLAW_PLUGIN_COUNT ))

# audit 包单独数（从 test-count.sh 全量输出的逐包明细行提取，格式「✓ audit: 498 passed (498 tests)」）。
# v1.2.3 修复：不再单独跑 engine/audit && npm test —— 该路径的 vitest 输出同样带 ANSI 码，
# 在 CI 非 TTY 下 grep '^\s*Tests\s+' 恒失败。复用 TC_OUT 的明细行，strip ANSI 后提取。
AUDIT_TESTS=$(echo "$TC_OUT" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep -E 'audit:.*passed' | grep -oE '\([0-9]+ tests\)' | grep -oE '[0-9]+' | head -1 || echo "0")
[ -z "$AUDIT_TESTS" ] && AUDIT_TESTS=0

if [ "$QUIET" = false ]; then
  echo -e "  实际值：workspace ${TOTAL_TESTS} / audit ${AUDIT_TESTS}"
fi

# ── 校验各文档声称的当前版本测试数 ──

# 当前版本开发日志 — CHANGELOG.md 已改为纯目录索引（不再含测试数声明），
# 测试数声明在开发日志的「开发完成快照」行。F-09 (v1.3.0 bugfix)：
# 校验目标改为 docs/changelog/vX.Y/vX.Y.Z.md（从 engine/audit/package.json 提取版本号自动拼路径）。
# 格式："开发完成快照：... NNN 单元（单元测试数，与 SSOT 一致）" 或 "NNN tests across NN packages"。
# grep 未命中 → FAIL（与 WIKI/README 校验段一致，禁止静默跳过）。
CUR_VERSION=$(node -p "require('./engine/audit/package.json').version" 2>/dev/null || echo "1.2.9")
CUR_MAJOR_MINOR=$(echo "$CUR_VERSION" | cut -d. -f1-2)
DEVLOG_FILE="docs/changelog/v${CUR_MAJOR_MINOR}/v${CUR_VERSION}.md"
# devlog 分类判据的**扫描窗口**（显式口径，两处判据共用——不允许 10 散落两处）：
# 只读文件头 N 行（状态区）。devlog 的状态行、交付快照行都在头部；正文叙事里出现的
# 「尚未实现」/「✅ 已发版」是在描述**别的**东西，不该具备分类判据的效力。
# 窗口取 10 的实测依据（批 2c 扫全部 10 份 v1.4.x devlog）：
#   已发版 9 份的「✅ (已开发|已交付|已发版)」在 head-10 内**全部命中**（head10=1），
#   收窄后分类零变化；而 v1.4.7 该 pattern 全文命中 **8** 次、head-10 仅 1 次
#   ⇒ 正文误伤冻结判据不是假想。
# ⚠️ 不要改锚「状态：」标签替代窗口：v1.4.1 / v1.4.5 / v1.4.6 的 head-10 内**没有**
#   「状态：」行，锚标签会把它们打出冻结分类，制造**新**错分类。窗口是唯一正确口径。
DEVLOG_STATUS_WINDOW=10
if [ -f "$DEVLOG_FILE" ]; then
  # v1.3.2 修复：未发版的占位 changelog（含「尚未实现」）跳过校验，不算 FAIL
  # v1.4.9 G-3 修复：占位判据从「**全文** grep」收窄到「**文件头状态区**」——
  #   窗口口径见上方 DEVLOG_STATUS_WINDOW 处的说明。本分支的具体误命中源：
  #   已发版的 v1.4.8.md 该串唯一出现在**正文** :671「…（`sofagent-update` 尚未实现）」，
  #   旧全文判据据此把它判成「占位文件」并跳过校验；且本 if 排在下方
  #   「已发布版本（历史冻结）」elif **之前** ⇒ 冻结分支永不可达（死代码），
  #   v1.4.8 的测试数快照校验从未真跑——是**门禁空转**，不是「合法的跳过」。
  #   实现注记：不用 `head -N "$F" | grep -q`——本脚本 `set -uo pipefail`，而 `grep -q`
  #   命中即退出会关闭读端，head 若仍在写即收 SIGPIPE（141），pipefail 把整条管道判负
  #   ⇒ 真占位文件反而漏判（竞态）。here-string 先让 head 跑完再喂给 grep，无竞态。
  if grep -q '尚未实现' <<< "$(head -"${DEVLOG_STATUS_WINDOW}" "$DEVLOG_FILE" 2>/dev/null)"; then
    SKIPS=$((SKIPS + 1))
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ ${DEVLOG_FILE}：占位文件（尚未实现），跳过测试数校验${NC}"
    fi
  # v1.3.6 修复：已发布版本的历史 devlog（含「✅ 已开发」状态行）冻结——
  # v1.3.9 bugfix：状态行可能带 markdown 加粗（✅ **已开发**），grep 放宽为 ✅[ *]*已开发 容错——
  # v1.4.0：v1.3.9 状态行措辞为「✅ **已交付。**」——冻结条件放宽为 已开发|已交付
  # 已发版：v1.4.4 状态行措辞为「✅ **已发版（vX.Y.Z · 日期）。**」——冻结条件纳入 已发版
  # 其测试数是发版时快照，不随后续版本新增测试漂移（v1.3.5 发布后 v1.3.6 bugfix
  # 新增 6 测试致 2286→2292，历史 devlog 被误报 FAIL——已发布文档不回头改）。
  # v1.4.9 批2c 修复：冻结判据同样收窄到**同一个扫描窗口**（head-10，见 DEVLOG_STATUS_WINDOW）——
  #   同族洞的隔壁：全文扫描时，正文叙事里的「✅ 已发版」会把 devlog 误判成「历史冻结」
  #   而静默跳过（v1.4.7 实测该 pattern 全文命中 8 次、head-10 仅 1 次）。
  #   实测收窄零风险：v1.4.0-v1.4.8 九份已发版 devlog 的该 pattern 在 head-10 内均命中 1 次
  #   ⇒ 冻结分类**一份都没变**（v1.4.8 由「误判占位」变「正确冻结」，正是 G-3 要的效果）。
  # ⚠️ 不用锚「状态：」标签替代窗口：v1.4.1 / v1.4.5 / v1.4.6 的 head-10 里没有「状态：」行，
  #   锚标签会把这三份打出冻结分类 —— 窗口是唯一不制造新错分类的口径。
  elif grep -qE '✅[ *]*(已开发|已交付|已发版)' <<< "$(head -"${DEVLOG_STATUS_WINDOW}" "$DEVLOG_FILE" 2>/dev/null)"; then
    # v1.4.9 G-3：冻结分支**也是一次显式跳过**（测试数比对确实没跑），必须计入 SKIPS——
    #   依据 tools/check/lib/coverage-line.sh 契约第 4 条「每个 skip 分支加 SKIPS++」
    #   与「**不得有跳过却填 0**」。此前只有占位分支记账，冻结分支静默跳过：
    #   占位判据收窄后 v1.4.8 恰好从「占位（错理由）」迁到「冻结（对理由）」，
    #   若不同步补账，覆盖度行的 skipped 会从 2 掉到 1，把「修好一处语义」
    #   伪装成「少了一处跳过」——那才是粉饰。
    SKIPS=$((SKIPS + 1))
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ ${DEVLOG_FILE}：已发布版本（历史冻结），测试数不与当前 SSOT 比对${NC}"
    fi
  else
  # 优先「开发完成快照」行的单元数（1650 单元），回退 "NNN tests across"
  DEVLOG_LINE=$(grep -nE '开发完成快照.*[0-9]+ 单元|[0-9]+ tests across' "$DEVLOG_FILE" | head -1)
  if [ -n "$DEVLOG_LINE" ]; then
    DEVLOG_CLAIMED=$(echo "$DEVLOG_LINE" | grep -oE '[0-9]+ 单元' | head -1 | grep -oE '[0-9]+')
    if [ -z "$DEVLOG_CLAIMED" ]; then
      DEVLOG_CLAIMED=$(echo "$DEVLOG_LINE" | grep -oE '[0-9]+ tests across' | head -1 | grep -oE '[0-9]+')
    fi
    DEVLOG_LINENO=$(echo "$DEVLOG_LINE" | cut -d: -f1)
    # 修复锚（与上方两处提取同源）：「N 单元」优先，回退「N tests across」。
    # 注意用 here-string 而非 `echo "$X" | grep -q`——后者在 pipefail 下会因
    # grep -q 提前退出让 echo 收 SIGPIPE（141）而假红（本仓 check-guards ⑤ 段毒方）。
    if grep -qE '[0-9]+ 单元' <<< "$DEVLOG_LINE"; then
      DEVLOG_ANCHOR='([0-9]+) 单元'
    else
      DEVLOG_ANCHOR='([0-9]+) tests across'
    fi
    if [ "$QUIET" = false ]; then
      echo -e "  校验 ${DEVLOG_FILE}（行 ${DEVLOG_LINENO}）..."
    fi
    if [ "$DEVLOG_CLAIMED" = "$TOTAL_TESTS" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ${DEVLOG_FILE}：${DEVLOG_CLAIMED}${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ ${DEVLOG_FILE}（行 ${DEVLOG_LINENO}）：声称 ${DEVLOG_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
      record_fix "$DEVLOG_FILE" "$DEVLOG_LINENO" "$DEVLOG_CLAIMED" "$TOTAL_TESTS" "$DEVLOG_ANCHOR"
      ((FAIL++)) || true
    fi
  else
    echo -e "  ${RED}✗ ${DEVLOG_FILE} 未找到「开发完成快照」测试数声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
    echo -e "    提示：CHANGELOG 已改为纯索引，测试数声明在开发日志中。请在本脚本校验目标处补正则。"
    record_manual "$DEVLOG_FILE" "-" "未找到「开发完成快照」测试数声明"
    ((FAIL++)) || true
  fi
  fi  # v1.3.2 修复：闭合「尚未实现」占位跳过的 if-else
else
  echo -e "  ${RED}✗ 当前版本开发日志 ${DEVLOG_FILE} 不存在（无法校验 → FAIL，禁止静默跳过）${NC}"
  record_manual "$DEVLOG_FILE" "-" "开发日志文件不存在"
  ((FAIL++)) || true
fi

# ── ROADMAP.md 最新版「开发完成」行的测试数快照（v1.4.9 G-6 改锚）──
# 【原锚已死·取证】原锚串 '质量验证：[0-9]+ tests'（注释写「最新版本段」），实测
#   `grep -cE` = 0 ⇒ 该 if 恒假 ⇒ **整块恒不执行**（守卫空转第二形态：看着有校验、
#   实际零校验，输出照旧 ✓）。**不是「暂时失配」**，时间线（git 取证，非推断）：
#     · 2026-07-21 871d9b8d（P1-3 门禁自动校验测试数）引入本锚——当时 ROADMAP.md 在
#       **仓库根**且形态在位（`质量验证：937 tests across 12 packages 全绿`）⇒ 锚是活的；
#     · 2026-07-24 80fed5c9（v1.2.0 阶段八文档收尾）改写该段，`质量验证：NNN tests`
#       形态**从 ROADMAP 消失**（0 处）⇒ 本锚**自该日起恒不执行**；
#     · 2026-08-03 ccf58d12（ROADMAP.md 迁 docs/）路径改对，但形态早已不在；
#     · 至 2026-09-14 仍为 0 处 ⇒ **死锚存活 52 天，跨 v1.2.0→v1.4.9**，无人发现。
#   复核：`git log --oneline -S'质量验证：' -- docs/ROADMAP.md` 零命中（该形态从未出现在
#   现路径的历史里），`-S'质量验证：[0-9]+ tests' --all` 仅 5 个历史文档命中（archive/changelog）。
# 【改锚判据】ROADMAP 现以「… · 测试 NNNN→MMMM（NN 包 workspace 口径）· …」声称最新版
#   测试数（由本段锚定位，见下方 ROADMAP_LINE）。它是**发版时点快照**（语义同 CHANGELOG 索引行），
#   **不是当值** ⇒ 不得与当前 TOTAL_TESTS 比对（v1.4.8 快照 4429 ≠ 当前 4468，那样改会
#   必红、属**制造假红**）；应与**同版本开发日志**的 `NNN tests across NN packages` 快照
#   比对（范式与下方 CHANGELOG 段的 DEVLOG_SNAPSHOT 一致，一个判据两处消费）。
#   提取为空 ⇒ FAIL；同版本开发日志快照不可用 ⇒ 可见 ⏏️ SKIP（不是静默）。
# 【锚宽化】锚串不得把**状态词**当结构的一部分：`开发完成` 只在「开发完成待发版」态成立，
#   发版后措辞改「已发版」即失配 ⇒ 守卫从「校验通过」掉成「锚未命中 FAIL」，而文档没有错。
#   状态词是**发版流程变量**（开发完成 / 待发版 / 已发版），结构是「粗体版本号 + 粗体收尾 +
#   破折号正文」——故锚定状态词枚举，不锚定其中某一个。
ROADMAP_LINE=$(grep -nE '^> \*\*v[0-9]+\.[0-9]+\.[0-9]+ (开发完成|待发版|已发版)' docs/ROADMAP.md 2>/dev/null | head -1)
if [ -z "$ROADMAP_LINE" ]; then
  echo -e "  ${RED}✗ docs/ROADMAP.md 未找到「> **vX.Y.Z 开发完成」最新版段（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "docs/ROADMAP.md" "-" "未找到最新版快照段（措辞漂移/段落被删）"
  ((FAIL++)) || true
else
  ROADMAP_LINENO=$(echo "$ROADMAP_LINE" | cut -d: -f1)
  # head -1 + `[^→]*`：兼容「测试 4279→4429」与「测试 4279（12 包 workspace 口径）→4429（13 包…）」
  # 两种写法，且不会把行内后续的 `acceptance 328→337` 一起吞进来。
  ROADMAP_TESTPAIR=$(echo "$ROADMAP_LINE" | grep -oE '测试 [0-9]+[^→]*→[0-9]+' | head -1)
  ROADMAP_VER=$(echo "$ROADMAP_LINE" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  ROADMAP_SNAP=$(echo "$ROADMAP_TESTPAIR" | grep -oE '→[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")
  if [ -z "$ROADMAP_VER" ] || [ -z "$ROADMAP_SNAP" ]; then
    echo -e "  ${RED}✗ ROADMAP.md（行 ${ROADMAP_LINENO}）：最新版测试数声称提取为空——ver=[${ROADMAP_VER:-空}] snap=[${ROADMAP_SNAP:-空}]（正则失配 / 声称被改写 → FAIL，禁止静默跳过）${NC}"
    record_manual "docs/ROADMAP.md" "$ROADMAP_LINENO" "最新版测试数声称提取为空（正则失配/声称被改写）"
    ((FAIL++)) || true
  else
    if [ "$QUIET" = false ]; then
      echo -e "  校验 ROADMAP.md（行 ${ROADMAP_LINENO}）..."
    fi
    # ⚠️ ROADMAP_VER 提取时带 `v` 前缀（'v1\.4\.8'），拼路径必须去掉——否则得到
    #    `docs/changelog/vv1.4/vv1.4.8.md`（双 v）⇒ 文件恒不存在 ⇒ 新断言退化为
    #    恒 SKIP 的**空转守卫**（实测踩过：首版就是这个 bug，输出 `vv1.4` 才暴露）。
    ROADMAP_VER_BARE=${ROADMAP_VER#v}
    ROADMAP_MM=$(echo "$ROADMAP_VER_BARE" | cut -d. -f1-2)
    ROADMAP_DEVLOG="docs/changelog/v${ROADMAP_MM}/v${ROADMAP_VER_BARE}.md"
    ROADMAP_DEVLOG_SNAP=""
    if [ -f "$ROADMAP_DEVLOG" ]; then
      ROADMAP_DEVLOG_SNAP=$(grep -oE '[0-9]+ tests across [0-9]+ packages' "$ROADMAP_DEVLOG" 2>/dev/null | head -1 | grep -oE '^[0-9]+' || echo "")
    fi
    if [ -z "$ROADMAP_DEVLOG_SNAP" ]; then
      SKIPS=$((SKIPS + 1))
      if [ "$QUIET" = false ]; then
        echo -e "  ${YELLOW}⏏️ ROADMAP.md（行 ${ROADMAP_LINENO}）：${ROADMAP_VER} 开发日志快照不可用（${ROADMAP_DEVLOG} 缺失或无「NNN tests across NN packages」行）——本次跳过，非失败${NC}"
      fi
    elif [ "$ROADMAP_SNAP" = "$ROADMAP_DEVLOG_SNAP" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ROADMAP.md（行 ${ROADMAP_LINENO}）：${ROADMAP_VER} 测试数快照 ${ROADMAP_SNAP} = 同版本开发日志快照${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ ROADMAP.md（行 ${ROADMAP_LINENO}）：${ROADMAP_VER} 测试数声称 ${ROADMAP_SNAP}，同版本开发日志快照 ${ROADMAP_DEVLOG_SNAP}（${ROADMAP_DEVLOG}）${NC}"
      # 修复锚与上方 ROADMAP_TESTPAIR 提取同源：定位「测试 …→N」的**箭头后**数字
      # （lastIndexOf 保证命中的是箭头后那个，即使前值与后值数字相同）。
      record_fix "docs/ROADMAP.md" "$ROADMAP_LINENO" "$ROADMAP_SNAP" "$ROADMAP_DEVLOG_SNAP" '测试[^→]*→([0-9]+)'
      ((FAIL++)) || true
    fi
  fi
fi

# LIMITATIONS.md — "审计核心 NNN 个、全 workspace NNN 个" 格式
LIMITATIONS_LINE=$(grep -nE '审计核心 [0-9]+ 个、全 workspace [0-9]+ 个' docs/LIMITATIONS.md | head -1)
if [ -n "$LIMITATIONS_LINE" ]; then
  # head -1：同一行若出现多个「审计核心 N」/「全 workspace N」（如在句尾追加历史沿革
  # 「…总数 3507→3541」），grep -o 会返回多行拼成 "3541\n3507"，比对必然失败且报错难读。
  # 取首个匹配——它就是该行开头的当前声称值。
  LIMITATIONS_AUDIT=$(echo "$LIMITATIONS_LINE" | grep -oE '审计核心 [0-9]+' | head -1 | grep -oE '[0-9]+')
  LIMITATIONS_TOTAL=$(echo "$LIMITATIONS_LINE" | grep -oE '全 workspace [0-9]+' | head -1 | grep -oE '[0-9]+')
  LIMITATIONS_LINENO=$(echo "$LIMITATIONS_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）..."
  fi
  local_fail=0
  if [ "$LIMITATIONS_AUDIT" != "$AUDIT_TESTS" ]; then
    echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）：audit 声称 ${LIMITATIONS_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
    # 锚与上方 `审计核心 [0-9]+` 提取同源（数字为捕获组 1）
    record_fix "docs/LIMITATIONS.md" "$LIMITATIONS_LINENO" "$LIMITATIONS_AUDIT" "$AUDIT_TESTS" '审计核心 ([0-9]+)'
    local_fail=1
  fi
  if [ "$LIMITATIONS_TOTAL" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIMITATIONS_LINENO}）：workspace 声称 ${LIMITATIONS_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
    # 锚与上方 `全 workspace [0-9]+` 提取同源（数字为捕获组 1）
    record_fix "docs/LIMITATIONS.md" "$LIMITATIONS_LINENO" "$LIMITATIONS_TOTAL" "$TOTAL_TESTS" '全 workspace ([0-9]+)'
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ LIMITATIONS.md：audit ${LIMITATIONS_AUDIT} / workspace ${LIMITATIONS_TOTAL}${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
fi

# ── evidence.md 的「本页时点值」测试数快照（v1.4.9 G-6 改锚）──
# 【原锚已死·取证】原双锚 ① 'v1\.1\.[0-9]+ 为 [0-9]+（audit 包）' ② '全 workspace.*v1\.1\.[0-9]+ 为 [0-9]+'
#   实测均为 0 命中 ⇒ `[ -n "$EVIDENCE_AUDIT" ] && [ -n "$EVIDENCE_TOTAL" ]` 恒假
#   ⇒ **整块恒不执行**（守卫空转第二形态：看着有校验、实际零校验，输出照旧 ✓）。
#   时间线（git 取证，非推断）：
#     · 2026-07-21 871d9b8d 引入本块；同日 d8f45674 该形态在 evidence.md 现身（0→1）⇒ 锚曾活；
#     · 2026-07-27 35909f2e（v1.2.1 bugfix 返工批次）改写该段，形态**消失**（1→0）
#       ⇒ 本锚自该日起恒不执行，至 2026-09-14 已存活 **49 天**（跨 v1.2.1→v1.4.9）。
# 【为何不复活原意图】原意图 = 「evidence.md 最新快照 == 当前 SSOT」。该意图**已被页面定位
#   变更取代**：经 v1.4.9 P2-10 裁定，本页显式声明为「**历史锚点页、不追当值**」，其历史沿革行
#   （`v1.2.4：audit 包 507、全 workspace 1320 测试`）是**冻结历史值**——与当前 SSOT 比对必红，
#   复活即制造假红（违反「守卫不空转」的姊妹纪律：也不得让守卫必红）。
# 【改锚判据】改锚到页内**唯一的活声称**：「本页时点值（vX.Y.Z 发版快照）：全 workspace NNNN 测试」，
#   判据 = NNNN **必须等于所标版本开发日志的 `NNN tests across NN packages` 快照**
#   （**自洽性**断言，不是「追当值」——与「历史锚点页」定位不冲突，同上方 ROADMAP/CHANGELOG 范式）。
#   ⚠️ 该行同时含多处「全 workspace NNNN 测试」（沿革账 4279/1320/1207/984/957）
#   ⇒ **必须 head -1**，否则 `grep -oE` 返回多行拼成 "4279\n1320\n1207"、比对必失败。
#   （实测复现：这正是死锚掩盖掉的**第二重缺陷**——锚一旦复活会立刻炸；属 G-13 同形态。）
#   audit 半边不再断言：页内已无「当前形态」的 audit 时点值（沿革账的 audit 数是冻结历史值）。
#   提取为空 ⇒ FAIL；所标版本开发日志快照不可用 ⇒ 可见 ⏏️ SKIP（不是静默）。
EVIDENCE_LINE=$(grep -nE '本页时点值（v[0-9]+\.[0-9]+\.[0-9]+ 发版快照）：全 workspace [0-9]+ 测试' docs/evidence/evidence.md 2>/dev/null | head -1)
if [ -z "$EVIDENCE_LINE" ]; then
  echo -e "  ${RED}✗ docs/evidence/evidence.md 未找到「本页时点值（vX.Y.Z 发版快照）：全 workspace NNNN 测试」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "docs/evidence/evidence.md" "-" "未找到「本页时点值」快照声明（措辞漂移/段落被删）"
  ((FAIL++)) || true
else
  EVIDENCE_LINENO=$(echo "$EVIDENCE_LINE" | cut -d: -f1)
  EVIDENCE_VER=$(echo "$EVIDENCE_LINE" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  # head -1 必加（见上）：该行沿革账含多个「全 workspace NNNN 测试」
  EVIDENCE_SNAP=$(echo "$EVIDENCE_LINE" | grep -oE '全 workspace [0-9]+ 测试' | head -1 | grep -oE '[0-9]+' || echo "")
  if [ -z "$EVIDENCE_VER" ] || [ -z "$EVIDENCE_SNAP" ]; then
    echo -e "  ${RED}✗ evidence.md（行 ${EVIDENCE_LINENO}）：时点值声称提取为空——ver=[${EVIDENCE_VER:-空}] snap=[${EVIDENCE_SNAP:-空}]（正则失配 / 声称被改写 → FAIL，禁止静默跳过）${NC}"
    record_manual "docs/evidence/evidence.md" "$EVIDENCE_LINENO" "时点值声称提取为空（正则失配/声称被改写）"
    ((FAIL++)) || true
  else
    if [ "$QUIET" = false ]; then
      echo -e "  校验 docs/evidence/evidence.md（行 ${EVIDENCE_LINENO}）..."
    fi
    # ⚠️ 同 ROADMAP 段：EVIDENCE_VER 带 `v` 前缀，拼路径必须去掉（否则 `vv1.4` 空转）
    EVIDENCE_VER_BARE=${EVIDENCE_VER#v}
    EVIDENCE_MM=$(echo "$EVIDENCE_VER_BARE" | cut -d. -f1-2)
    EVIDENCE_DEVLOG="docs/changelog/v${EVIDENCE_MM}/v${EVIDENCE_VER_BARE}.md"
    EVIDENCE_DEVLOG_SNAP=""
    if [ -f "$EVIDENCE_DEVLOG" ]; then
      EVIDENCE_DEVLOG_SNAP=$(grep -oE '[0-9]+ tests across [0-9]+ packages' "$EVIDENCE_DEVLOG" 2>/dev/null | head -1 | grep -oE '^[0-9]+' || echo "")
    fi
    if [ -z "$EVIDENCE_DEVLOG_SNAP" ]; then
      SKIPS=$((SKIPS + 1))
      if [ "$QUIET" = false ]; then
        echo -e "  ${YELLOW}⏏️ evidence.md（行 ${EVIDENCE_LINENO}）：${EVIDENCE_VER} 开发日志快照不可用（${EVIDENCE_DEVLOG} 缺失或无「NNN tests across NN packages」行）——本次跳过，非失败${NC}"
      fi
    elif [ "$EVIDENCE_SNAP" = "$EVIDENCE_DEVLOG_SNAP" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ evidence.md（行 ${EVIDENCE_LINENO}）：${EVIDENCE_VER} 时点值快照 ${EVIDENCE_SNAP} = 同版本开发日志快照${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ evidence.md（行 ${EVIDENCE_LINENO}）：${EVIDENCE_VER} 时点值声称 ${EVIDENCE_SNAP}，同版本开发日志快照 ${EVIDENCE_DEVLOG_SNAP}（${EVIDENCE_DEVLOG}）${NC}"
      # 锚与上方 `全 workspace [0-9]+ 测试` 提取同源（数字为捕获组 1；带「 测试」
      # 后缀是为了不误命中同行沿革账里别的「全 workspace N」）
      record_fix "docs/evidence/evidence.md" "$EVIDENCE_LINENO" "$EVIDENCE_SNAP" "$EVIDENCE_DEVLOG_SNAP" '全 workspace ([0-9]+) 测试'
      ((FAIL++)) || true
    fi
  fi
fi

# WIKI.md — "NNN 测试 / NN 包全绿" 格式
# P0-13: grep 未命中 → FAIL（不再静默跳过——正则失配说明检查正则有 bug 或文档缺失声明）
WIKI_LINE=$(grep -nE '[0-9]+ 测试 / [0-9]+ 包' docs/WIKI.md 2>/dev/null | head -1)
if [ -n "$WIKI_LINE" ]; then
  # v1.4.9 G-13：补 `head -1`（同 README 形态——多命中拼接会让比对必失败且报错难读）
  WIKI_CLAIMED=$(echo "$WIKI_LINE" | grep -oE '[0-9]+ 测试' | head -1 | grep -oE '[0-9]+')
  WIKI_PKGS=$(echo "$WIKI_LINE" | grep -oE '[0-9]+ 包' | head -1 | grep -oE '[0-9]+')
  WIKI_LINENO=$(echo "$WIKI_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 docs/WIKI.md（行 ${WIKI_LINENO}）..."
  fi
  local_fail=0
  if [ "$WIKI_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ WIKI.md（行 ${WIKI_LINENO}）：声称 ${WIKI_CLAIMED}，实际 ${TOTAL_TESTS}${NC}"
    # 锚与上方 `[0-9]+ 测试` 提取同源（数字为捕获组 1）
    record_fix "docs/WIKI.md" "$WIKI_LINENO" "$WIKI_CLAIMED" "$TOTAL_TESTS" '([0-9]+) 测试'
    local_fail=1
  fi
  # v1.4.9 G-13：原 `[ -n "$WIKI_PKGS" ] &&` 形态 = 提取为空即静默跳过（免费绿灯）⇒ 改双分支都判红
  if [ -z "$WIKI_PKGS" ]; then
    echo -e "  ${RED}✗ WIKI.md（行 ${WIKI_LINENO}）：包数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "docs/WIKI.md" "$WIKI_LINENO" "包数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$WIKI_PKGS" != "$PKG_COUNT" ]; then
    echo -e "  ${RED}✗ WIKI.md（行 ${WIKI_LINENO}）：声称 ${WIKI_PKGS} 包，实际 ${PKG_COUNT} 包${NC}"
    # 锚与上方 `[0-9]+ 包` 提取同源（数字为捕获组 1）
    record_fix "docs/WIKI.md" "$WIKI_LINENO" "$WIKI_PKGS" "$PKG_COUNT" '([0-9]+) 包'
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ WIKI.md：${WIKI_CLAIMED} 测试 / ${WIKI_PKGS} 包${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ docs/WIKI.md 未找到「N 测试 / N 包全绿」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "docs/WIKI.md" "-" "未找到「N 测试 / N 包」声称行（措辞漂移/段落被删）"
  ((FAIL++)) || true
fi

# README.md — "NNN 测试 / NN 模块包 + NN 插件（N DSH + N OpenClaw）" 格式
# （P0-13: grep 未命中 → FAIL；B13: 包数拆双口径——引擎数对 WORKSPACE_COUNT、插件数对 PLUGIN_TOTAL；
#  任务八方案A 2026-08-29：旧格式「N 测试 / N 包（N 个含测试）」升级为引擎+插件双口径，
#  完整呈现交付物面——模块包 workspace 13 / 发布实体 26 两个数字可区分，消除「交付物只有 13 包」误读）
# 锚定机制说明（TASK-5 排查结论）：下方正则只匹配「N 测试 / N 模块包 + N 插件」三段式格式，
#   全 README 实测仅「工程可信度」段（当前权威值）满足；沿革段（「测试 4429 → 4805」箭头形态）
#   不匹配。head -1 因此恰好锁定当前值——但该锁定依赖工程可信度段独有格式，格式改动后
#   会静默换锚。多值扫描断言（README_MULTIVALUE_*）兜底：文件内测试数声称 ≥2 个不同值
#   且无口径标记词时 FAIL，标记词与 check-readme-parity.sh ④b 同源
#   （发版时点|当前|as of|current）——一处措辞两处引用，改动须同步两脚本。
README_PKG_LINE=$(grep -nE '[0-9]+ 测试 / [0-9]+ 模块包 \+ [0-9]+ 插件' README.md 2>/dev/null | head -1)
if [ -n "$README_PKG_LINE" ]; then
  # v1.4.9 G-13：五个提取点全部补 `head -1`。
  #   原实现无 head -1——同一行出现第二个「N 测试」/「N 模块包」/「N 插件」/「N DSH」/
  #   「N OpenClaw」时，`grep -oE` 会把多处匹配拼成多行（实案：P2-11 摘内部口径后
  #   README 行同时含“13 模块包”与“13 模块包 workspace”，README_PKGS 得 "13\n13"，
  #   比对必失败且报错难读）。本文件 :443 的兄弟点早已修好并写了坑位注释（同一失败形态、
  #   一处修了一处没修）——此处补齐为同一形态。取首个匹配 = 该行开头的当前声称值。
  README_CLAIMED=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 测试' | head -1 | grep -oE '[0-9]+')
  README_PKGS=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 模块包' | head -1 | grep -oE '[0-9]+')
  README_PLUGIN_TOTAL=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ 插件' | head -1 | grep -oE '[0-9]+')
  README_PLUGIN_DSH=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ DSH' | head -1 | grep -oE '[0-9]+')
  README_PLUGIN_OC=$(echo "$README_PKG_LINE" | grep -oE '[0-9]+ OpenClaw' | head -1 | grep -oE '[0-9]+')
  README_LINENO=$(echo "$README_PKG_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 README.md（行 ${README_LINENO}）..."
  fi
  local_fail=0
  if [ "$README_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_CLAIMED} 测试，实际 ${TOTAL_TESTS}${NC}"
    # 锚与上方 `[0-9]+ 测试` 提取同源（数字为捕获组 1）
    record_fix "README.md" "$README_LINENO" "$README_CLAIMED" "$TOTAL_TESTS" '([0-9]+) 测试'
    local_fail=1
  fi
  # v1.4.9 G-13：原 `[ -n "$X" ] && [ "$X" != "$Y" ]` 形态下，**提取为空即静默跳过 = 免费绿灯**
  #   （守卫空转第二形态）。改为「提取为空 ⇒ FAIL」+「不一致 ⇒ FAIL」双分支，二者都判红。
  if [ -z "$README_PKGS" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：模块包数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.md" "$README_LINENO" "模块包数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_PKGS" != "$WORKSPACE_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PKGS} 模块包（workspace 模块总数），实际 ${WORKSPACE_COUNT} 包${NC}"
    # 锚与上方 `[0-9]+ 模块包` 提取同源（数字为捕获组 1）
    record_fix "README.md" "$README_LINENO" "$README_PKGS" "$WORKSPACE_COUNT" '([0-9]+) 模块包'
    local_fail=1
  fi
  if [ -z "$README_PLUGIN_TOTAL" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：插件合计数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.md" "$README_LINENO" "插件合计数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_PLUGIN_TOTAL" != "$PLUGIN_TOTAL" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PLUGIN_TOTAL} 插件（DSH+OpenClaw 合计），实际 ${PLUGIN_TOTAL} 插件${NC}"
    # 锚与上方 `[0-9]+ 插件` 提取同源（数字为捕获组 1）
    record_fix "README.md" "$README_LINENO" "$README_PLUGIN_TOTAL" "$PLUGIN_TOTAL" '([0-9]+) 插件'
    local_fail=1
  fi
  if [ -z "$README_PLUGIN_DSH" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：DSH 插件数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.md" "$README_LINENO" "DSH 插件数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_PLUGIN_DSH" != "$DSH_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PLUGIN_DSH} DSH 插件，实际 ${DSH_PLUGIN_COUNT}${NC}"
    # 锚与上方 `[0-9]+ DSH` 提取同源（数字为捕获组 1）
    record_fix "README.md" "$README_LINENO" "$README_PLUGIN_DSH" "$DSH_PLUGIN_COUNT" '([0-9]+) DSH'
    local_fail=1
  fi
  if [ -z "$README_PLUGIN_OC" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：OpenClaw 插件数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.md" "$README_LINENO" "OpenClaw 插件数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_PLUGIN_OC" != "$OPENCLAW_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.md（行 ${README_LINENO}）：声称 ${README_PLUGIN_OC} OpenClaw 插件，实际 ${OPENCLAW_PLUGIN_COUNT}${NC}"
    # 锚与上方 `[0-9]+ OpenClaw` 提取同源（数字为捕获组 1）
    record_fix "README.md" "$README_LINENO" "$README_PLUGIN_OC" "$OPENCLAW_PLUGIN_COUNT" '([0-9]+) OpenClaw'
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ README.md：${README_CLAIMED} 测试 / ${README_PKGS} 模块包 + ${README_PLUGIN_TOTAL} 插件（${README_PLUGIN_DSH} DSH + ${README_PLUGIN_OC} OpenClaw）${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ README.md 未找到「N 测试 / N 模块包 + N 插件」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "README.md" "-" "未找到「工程可信度」声称行（措辞漂移/段落被删）"
  ((FAIL++)) || true
fi

# README.en.md — "NNN tests / NN module packages + NN plugins (N DSH + N OpenClaw)" 格式
# （P1 B2b: 英文版曾二次漂移 2283，根因是门禁只校验中文 README。补齐英文校验，grep 未命中 → FAIL，
#  与中文版 P0-13 语义一致；任务八方案A 2026-08-29：随中文版同步升级为引擎+插件双口径）
README_EN_LINE=$(grep -nE '[0-9]+ tests? / [0-9]+ module packages \+ [0-9]+ plugins' README.en.md 2>/dev/null | head -1)
if [ -n "$README_EN_LINE" ]; then
  # v1.4.9 G-13：同 README 中文版——五个提取点补 `head -1`（多命中拼接 ⇒ "14\n14" 式假红）
  README_EN_CLAIMED=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ tests?' | head -1 | grep -oE '[0-9]+')
  README_EN_PKGS=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ module packages' | head -1 | grep -oE '[0-9]+')
  README_EN_PLUGIN_TOTAL=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ plugins' | head -1 | grep -oE '[0-9]+')
  README_EN_PLUGIN_DSH=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ DSH' | head -1 | grep -oE '[0-9]+')
  README_EN_PLUGIN_OC=$(echo "$README_EN_LINE" | grep -oE '[0-9]+ OpenClaw' | head -1 | grep -oE '[0-9]+')
  README_EN_LINENO=$(echo "$README_EN_LINE" | cut -d: -f1)
  if [ "$QUIET" = false ]; then
    echo -e "  校验 README.en.md（行 ${README_EN_LINENO}）..."
  fi
  local_fail=0
  if [ "$README_EN_CLAIMED" != "$TOTAL_TESTS" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_CLAIMED} tests，实际 ${TOTAL_TESTS}${NC}"
    # 锚与上方 `[0-9]+ tests?` 提取同源（数字为捕获组 1）
    record_fix "README.en.md" "$README_EN_LINENO" "$README_EN_CLAIMED" "$TOTAL_TESTS" '([0-9]+) tests?'
    local_fail=1
  fi
  if [ -z "$README_EN_PKGS" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：module packages 提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.en.md" "$README_EN_LINENO" "module packages 提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_EN_PKGS" != "$WORKSPACE_COUNT" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PKGS} module packages（workspace 模块总数），实际 ${WORKSPACE_COUNT} 包${NC}"
    # 锚与上方 `[0-9]+ module packages` 提取同源（数字为捕获组 1）
    record_fix "README.en.md" "$README_EN_LINENO" "$README_EN_PKGS" "$WORKSPACE_COUNT" '([0-9]+) module packages'
    local_fail=1
  fi
  if [ -z "$README_EN_PLUGIN_TOTAL" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：plugins 合计数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.en.md" "$README_EN_LINENO" "plugins 合计数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_EN_PLUGIN_TOTAL" != "$PLUGIN_TOTAL" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PLUGIN_TOTAL} plugins（DSH+OpenClaw 合计），实际 ${PLUGIN_TOTAL} 插件${NC}"
    # 锚与上方 `[0-9]+ plugins` 提取同源（数字为捕获组 1）
    record_fix "README.en.md" "$README_EN_LINENO" "$README_EN_PLUGIN_TOTAL" "$PLUGIN_TOTAL" '([0-9]+) plugins'
    local_fail=1
  fi
  if [ -z "$README_EN_PLUGIN_DSH" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：DSH plugins 数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.en.md" "$README_EN_LINENO" "DSH plugins 数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_EN_PLUGIN_DSH" != "$DSH_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PLUGIN_DSH} DSH plugins，实际 ${DSH_PLUGIN_COUNT}${NC}"
    # 锚与上方 `[0-9]+ DSH` 提取同源（数字为捕获组 1）
    record_fix "README.en.md" "$README_EN_LINENO" "$README_EN_PLUGIN_DSH" "$DSH_PLUGIN_COUNT" '([0-9]+) DSH'
    local_fail=1
  fi
  if [ -z "$README_EN_PLUGIN_OC" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：OpenClaw plugins 数提取为空（正则失配 / 声称被改写）——守卫不空转，判 FAIL${NC}"
    record_manual "README.en.md" "$README_EN_LINENO" "OpenClaw plugins 数提取为空（正则失配/声称被改写）"
    local_fail=1
  elif [ "$README_EN_PLUGIN_OC" != "$OPENCLAW_PLUGIN_COUNT" ]; then
    echo -e "  ${RED}✗ README.en.md（行 ${README_EN_LINENO}）：声称 ${README_EN_PLUGIN_OC} OpenClaw plugins，实际 ${OPENCLAW_PLUGIN_COUNT}${NC}"
    # 锚与上方 `[0-9]+ OpenClaw` 提取同源（数字为捕获组 1）
    record_fix "README.en.md" "$README_EN_LINENO" "$README_EN_PLUGIN_OC" "$OPENCLAW_PLUGIN_COUNT" '([0-9]+) OpenClaw'
    local_fail=1
  fi
  if [ "$local_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ README.en.md：${README_EN_CLAIMED} tests / ${README_EN_PKGS} module packages + ${README_EN_PLUGIN_TOTAL} plugins (${README_EN_PLUGIN_DSH} DSH + ${README_EN_PLUGIN_OC} OpenClaw)${NC}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ README.en.md 未找到「N tests / N module packages + N plugins」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "README.en.md" "-" "未找到「Engineering credibility」声称行（措辞漂移/段落被删）"
  ((FAIL++)) || true
fi

# ── README 双语测试数多值扫描（TASK-5：防「文档升到 4810、门禁还在对旧值」的静默漂移）──
# 与 check-readme-parity.sh ④b 同源：标记词「发版时点|当前|as of|current」一处定义
# 两处引用，改动须同步两脚本。文件内「(测试|tests) N」或「N (测试|tests)」命中
# ≥2 个不同 4 位值且任一命中行无标记词 → FAIL（防沿革值与当前值无解释并存）。
README_MULTIVALUE_MARKERS='发版时点|当前|as of|current'
README_MULTIVALUE_BAD=0
for _mv_file in README.md README.en.md; do
  [ -f "$_mv_file" ] || continue
  _mv_hits=$(grep -nE '(测试|tests)[^0-9]{0,24}[0-9]{4}|[0-9]{4}[^0-9]{0,24}(测试|tests)' "$_mv_file" 2>/dev/null)
  [ -z "$_mv_hits" ] && continue
  _mv_uniq=$(echo "$_mv_hits" | grep -oE '[0-9]{4}' | sort -u | wc -l | tr -d ' ')
  [ "$_mv_uniq" -lt 2 ] && continue
  while IFS= read -r _mv_line; do
    _mv_lineno="${_mv_line%%:*}"
    _mv_content="${_mv_line#*:}"
    if ! grep -qE "$README_MULTIVALUE_MARKERS" <<< "$_mv_content"; then
      echo -e "  ${RED}✗ ${_mv_file}:${_mv_lineno}：测试数命中行无口径标记（需 ${README_MULTIVALUE_MARKERS} 之一）——多值漂移无解释${NC}"
      record_manual "$_mv_file" "$_mv_lineno" "多值声称行缺口径标记（该行自身无数字漂移，故无自动替换）"
      README_MULTIVALUE_BAD=$((README_MULTIVALUE_BAD + 1))
    fi
  done <<< "$_mv_hits"
done
if [ "$README_MULTIVALUE_BAD" -gt 0 ]; then
  echo -e "  ${RED}✗ README 测试数多值扫描：${README_MULTIVALUE_BAD} 处无口径标记${NC}"
  ((FAIL++)) || true
elif [ "$QUIET" = false ]; then
  echo -e "  ${GREEN}✓ README 测试数多值扫描：多值处均有口径标记（与 check-readme-parity ④b 同源）${NC}"
  ((PASS++)) || true
fi

# ── README 带数字自指扫描（防「头部已滚动、正文仍写『上述 <旧值>』」的第二处硬编码点）──
# 判据：README 不得出现「上述/上方/<N> above」式的**带数字自指**。自指只按名（如「工程可信度行」）、
#   不按值——这样全文件只有**一处**权威数字（工程可信度行），而该处已被上方逐处校验覆盖；
#   带数字自指即**第二处硬编码点**，头部滚动时不在任何校验的锚定面上 ⇒ 静默漂移。
# 实测教训：README 头部已升 5101，正文仍写「上述 5084」，两值并存且无口径标记可解释——
#   多值扫描（上方）锚的是「N 测试」相邻形态，而「上述 5084，随修复批滚动」两者都在窗口外，
#   故扫描静默放行。本条补该盲区：自指带数字即红，与数值是否恰好相等无关（相等也是第二处硬编码点）。
README_SELFREF_PATTERN='上述[^0-9]{0,6}[0-9]{3,}|上方[^0-9]{0,6}[0-9]{3,}|above[^0-9]{0,6}[0-9]{3,}|[0-9]{3,}[^0-9]{0,6}above'
README_SELFREF_BAD=0
for _sr_file in README.md README.en.md; do
  [ -f "$_sr_file" ] || continue
  _sr_hits=$(grep -nE "$README_SELFREF_PATTERN" "$_sr_file" 2>/dev/null || true)
  [ -z "$_sr_hits" ] && continue
  while IFS= read -r _sr_line; do
    _sr_lineno="${_sr_line%%:*}"
    echo -e "  ${RED}✗ ${_sr_file}:${_sr_lineno}：带数字自指（自指应只按名不按值）——第二处硬编码测试数是漂移盲区${NC}"
    record_manual "$_sr_file" "$_sr_lineno" "带数字自指：改为按名引用（如「上方工程可信度行的实测值」），使全文件只留一处权威数字"
    README_SELFREF_BAD=$((README_SELFREF_BAD + 1))
  done <<< "$_sr_hits"
done
if [ "$README_SELFREF_BAD" -gt 0 ]; then
  echo -e "  ${RED}✗ README 带数字自指扫描：${README_SELFREF_BAD} 处（权威数字应只留头部一处）${NC}"
  ((FAIL++)) || true
elif [ "$QUIET" = false ]; then
  echo -e "  ${GREEN}✓ README 带数字自指扫描：零命中（权威数字仅头部一处）${NC}"
  ((PASS++)) || true
fi

# ARCHITECTURE.md — "audit ✅ 已实现（NNN 测试）" 逐包校验
# 获取各包实际测试数
for pkg in audit core orchestrator daemon; do
  PKG_LINE=$(grep -nE "\| ${pkg} \|.*已实现（[0-9]+ 测试）" docs/ARCHITECTURE.md 2>/dev/null | head -1)
  if [ -n "$PKG_LINE" ]; then
    # v1.4.9 G-13：补 `head -1`（同形态硬化——ARCHITECTURE 行含「已实现（N 测试）」之外
    #   还可能有其他「N 测试」字样，多命中会把值拼成多行）
    PKG_CLAIMED=$(echo "$PKG_LINE" | grep -oE '已实现（[0-9]+ 测试' | head -1 | grep -oE '[0-9]+')
    PKG_LINENO=$(echo "$PKG_LINE" | cut -d: -f1)
    PKG_ACTUAL=$(echo "$TC_OUT" | grep "${pkg}:.*passed" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
    if [ -z "$PKG_ACTUAL" ]; then
      PKG_ACTUAL=0
    fi
    if [ "$QUIET" = false ]; then
      echo -e "  校验 ARCHITECTURE.md ${pkg}（行 ${PKG_LINENO}）..."
    fi
    if [ "$PKG_CLAIMED" = "$PKG_ACTUAL" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ ARCHITECTURE.md ${pkg}：${PKG_CLAIMED}${NC}"
      fi
      ((PASS++)) || true
    else
      echo -e "  ${RED}✗ ARCHITECTURE.md（行 ${PKG_LINENO}）：${pkg} 声称 ${PKG_CLAIMED}，实际 ${PKG_ACTUAL}${NC}"
      # 锚与上方 `已实现（[0-9]+ 测试` 提取同源（数字为捕获组 1，并带「 测试」后缀
      # 以免命中同行的其他数字）
      record_fix "docs/ARCHITECTURE.md" "$PKG_LINENO" "$PKG_CLAIMED" "$PKG_ACTUAL" '已实现（([0-9]+) 测试'
      ((FAIL++)) || true
    fi
  fi
done

# ── B11 (v1.4.5 T13)：docs/DEVELOPMENT.md orchestrator 测试数对账 ──
# 背景：DEVELOPMENT.md 激活链段声称「orchestrator 包（NNNN 测试）」却从未被任何门禁
# 校验——文档写 1642 时实际已 1703（漂移 61 无人发现）。本段把该声称纳入对账：
#   - 格式：「orchestrator 包（NNNN 测试，实测见 `tools/check/test-count.sh`）」
#   - 实际值：从 test-count.sh 全量输出（TC_OUT）的逐包明细行提取（与 audit 同源），
#     避免单独再跑一遍 orchestrator 测试（30s+）。
#   - grep 未命中 → FAIL（与 README 校验段一致，禁止静默跳过——声称行被改写也要显式暴露）。
DEV_ORCH_LINE=$(grep -nE 'orchestrator 包（[0-9]+ 测试' docs/DEVELOPMENT.md 2>/dev/null | head -1)
if [ -n "$DEV_ORCH_LINE" ]; then
  # v1.4.9 G-13：补 `head -1`（同形态硬化）
  DEV_ORCH_CLAIMED=$(echo "$DEV_ORCH_LINE" | grep -oE '包（[0-9]+ 测试' | head -1 | grep -oE '[0-9]+')
  DEV_ORCH_LINENO=$(echo "$DEV_ORCH_LINE" | cut -d: -f1)
  DEV_ORCH_ACTUAL=$(echo "$TC_OUT" | LC_ALL=C sed $'s/\033\[[0-9;]*m//g' | grep "orchestrator:.*passed" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
  [ -z "$DEV_ORCH_ACTUAL" ] && DEV_ORCH_ACTUAL=0
  if [ "$QUIET" = false ]; then
    echo -e "  校验 DEVELOPMENT.md orchestrator（行 ${DEV_ORCH_LINENO}）..."
  fi
  if [ "$DEV_ORCH_CLAIMED" = "$DEV_ORCH_ACTUAL" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ DEVELOPMENT.md orchestrator：${DEV_ORCH_CLAIMED}${NC}"
    fi
    ((PASS++)) || true
  else
    echo -e "  ${RED}✗ DEVELOPMENT.md（行 ${DEV_ORCH_LINENO}）：orchestrator 声称 ${DEV_ORCH_CLAIMED}，实际 ${DEV_ORCH_ACTUAL}——请更新文档或确认测试增量${NC}"
    # 锚与上方 `包（[0-9]+ 测试` 提取同源（数字为捕获组 1）
    record_fix "docs/DEVELOPMENT.md" "$DEV_ORCH_LINENO" "$DEV_ORCH_CLAIMED" "$DEV_ORCH_ACTUAL" '包（([0-9]+) 测试'
    ((FAIL++)) || true
  fi
else
  echo -e "  ${RED}✗ docs/DEVELOPMENT.md 未找到「orchestrator 包（N 测试」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "docs/DEVELOPMENT.md" "-" "未找到「orchestrator 包（N 测试」声称行（措辞漂移/段落被删）"
  ((FAIL++)) || true
fi


# LIMITATIONS.md — 多行检查（"审计核心 NNN 个、全 workspace NNN 个" 可能出现多次）
LIMITATIONS_ALL=$(grep -nE '审计核心 [0-9]+ 个、全 workspace [0-9]+ 个' docs/LIMITATIONS.md 2>/dev/null)
if [ -n "$LIMITATIONS_ALL" ]; then
  while IFS= read -r line_info; do
    [ -z "$line_info" ] && continue
    LIM_LINENO=$(echo "$line_info" | cut -d: -f1)
    # v1.4.9 G-13：补 `head -1`——LIMITATIONS 的「测试覆盖范围」行同时含
    #   「当前审计核心 N 个、全 workspace N 个」与沿革账的多个「全 workspace N」，
    #   无 head -1 时 LIM_TOTAL 会得 "4468\n3507\n3541" 式拼接值（比对必失败且难读）。
    LIM_AUDIT=$(echo "$line_info" | grep -oE '审计核心 [0-9]+' | head -1 | grep -oE '[0-9]+')
    LIM_TOTAL=$(echo "$line_info" | grep -oE '全 workspace [0-9]+' | head -1 | grep -oE '[0-9]+')
    LIM_FAIL=0
    if [ "$LIM_AUDIT" != "$AUDIT_TESTS" ]; then
      echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIM_LINENO}）：audit 声称 ${LIM_AUDIT}，实际 ${AUDIT_TESTS}${NC}"
      # 锚与上方 `审计核心 [0-9]+` 提取同源（数字为捕获组 1）
      record_fix "docs/LIMITATIONS.md" "$LIM_LINENO" "$LIM_AUDIT" "$AUDIT_TESTS" '审计核心 ([0-9]+)'
      LIM_FAIL=1
    fi
    if [ "$LIM_TOTAL" != "$TOTAL_TESTS" ]; then
      echo -e "  ${RED}✗ LIMITATIONS.md（行 ${LIM_LINENO}）：workspace 声称 ${LIM_TOTAL}，实际 ${TOTAL_TESTS}${NC}"
      # 锚与上方 `全 workspace [0-9]+` 提取同源（数字为捕获组 1）
      record_fix "docs/LIMITATIONS.md" "$LIM_LINENO" "$LIM_TOTAL" "$TOTAL_TESTS" '全 workspace ([0-9]+)'
      LIM_FAIL=1
    fi
    if [ "$LIM_FAIL" = "0" ]; then
      if [ "$QUIET" = false ]; then
        echo -e "  ${GREEN}✓ LIMITATIONS.md（行 ${LIM_LINENO}）：audit ${LIM_AUDIT} / workspace ${LIM_TOTAL}${NC}"
      fi
      ((PASS++)) || true
    else
      ((FAIL++)) || true
    fi
  done <<< "$LIMITATIONS_ALL"
else
  # v1.4.8 假绿扫描（形态 B）：上游 docs/LIMITATIONS.md 的「审计核心 NNNN 个、全 workspace NNNN 个」
  # 是测试数的权威声明之一（同 README「工程可信度」行）——**本应总有值**。grep 未命中即静默跳过
  # 会让校验整块消失而输出照旧 ✓ = 假绿。与上方 DEV_ORCH_LINE 同范式：未命中即 FAIL。
  echo -e "  ${RED}✗ docs/LIMITATIONS.md 未找到「审计核心 NNNN 个、全 workspace NNNN 个」声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "docs/LIMITATIONS.md" "-" "未找到「审计核心 N 个、全 workspace N 个」声称行（措辞漂移/段落被删）"
  ((FAIL++)) || true
fi

# ── CHANGELOG 索引行测试数校验（v1.4.1 F-06：补盲区；锚定三防升级）──
# 背景：F-01 的 2978 三处错数字从这个盲区漏出去——开发日志有「历史冻结」豁免，
# CHANGELOG 索引行却无人校验。本段对最新版本索引行做校验：
#   ① 锚定版本核对：锚定到的行必须以当前发版/开发中版本号（CUR_VERSION）开头——
#      多批构成（括号内非单一 +N）不匹配锚定正则时，旧逻辑 head -1 会静默回退
#      锚定到旧版本行，最新版算术完全绕过校验。现改为：锚定行版本 ≠ CUR_VERSION 即 FAIL。
#   ② 算术自洽：单批「+N」直接校验；多批构成取括号内全部「+N」求和与 delta 对账；
#      括号内无任何「+N」时 fail-loud 报「无法解析构成」；含「若干」未量化字样 WARN 提示。
#   ③ 口径对齐：识别「workspace 口径 NNNN/12 包」标注——workspace 值必须等于
#      test-count.sh 实测 TOTAL_TESTS；全量值必须等于 workspace + DSH 插件 27 +
#      OpenClaw 插件 17（双口径换算式写死防漂移）
# 双口径防误判：ROADMAP/CHANGELOG 的「全量 NNNN」与「workspace 口径 NNNN」是两个
# 合法并存口径（报告二误判教训的机制化）——按各自口径比对各自真值，不得把全量判为漂移。
CHANGELOG_LINE=$(grep -nE '测试 [0-9]+→\*\*[0-9]+\*\*（' CHANGELOG.md 2>/dev/null | head -1)
if [ -z "$CHANGELOG_LINE" ]; then
  echo -e "  ${RED}✗ CHANGELOG.md 未找到「测试 NNNN→**MMM**（…」索引行声明（grep 未命中 → FAIL，禁止静默跳过）${NC}"
  record_manual "CHANGELOG.md" "-" "未找到最新版索引行（措辞漂移/条目被删）"
  ((FAIL++)) || true
else
  CL_LINENO=$(echo "$CHANGELOG_LINE" | cut -d: -f1)
  # 防一：锚定行版本核对——锚到旧版本行 = 最新版绕过校验，直接 FAIL（先于数字解析）
  CL_LINE_VER=$(echo "$CHANGELOG_LINE" | grep -oE '\*\*v[0-9]+\.[0-9]+\.[0-9]+\*\*' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
  # 待发版态兼容：CHANGELOG 已收录下一版「⏳ 待发版」条目而 package.json 尚未 bump——
  # 此为发版流程固有次序（条目先行、版本号发版时统一 bump），非格式漂移。
  # 判定：锚定行含「待发版」且版本号为 CUR_VERSION 的后继一版（patch 后继 / minor 后继
  # patch 归零 / major 后继 minor+patch 归零——与 check-version §24 四态同族；只建模
  # patch+1 会把 1.4.9→1.5.0 的 minor 窗口误判 FAIL）→ 放行（数字照常校验）。
  CL_PENDING_OK=false
  if [[ "$CHANGELOG_LINE" == *待发版* ]]; then
    CUR_PATCH=$(echo "$CUR_VERSION" | cut -d. -f3)
    PENDING_VER="${CUR_VERSION%.*}.$((CUR_PATCH + 1))"
    if [ "$CL_LINE_VER" = "$PENDING_VER" ]; then
      CL_PENDING_OK=true
    fi
    # minor 后继（patch 归零）：1.4.9 → 1.5.0 / major 后继（minor+patch 归零）：1.4.9 → 2.0.0
    IFS='.' read -r _cma _cmi _cp <<< "${CUR_VERSION}"
    _pending_minor="${_cma}.$((_cmi + 1)).0"
    _pending_major="$((_cma + 1)).0.0"
    if [ "$CL_LINE_VER" = "$_pending_minor" ] || [ "$CL_LINE_VER" = "$_pending_major" ]; then
      CL_PENDING_OK=true
    fi
    if [ "$CL_PENDING_OK" = true ] && [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ CHANGELOG 锚定 v${CL_LINE_VER}（待发版态，package.json=${CUR_VERSION}）——放行，数字照常校验${NC}"
    fi
  fi
  if [ "$CL_LINE_VER" != "$CUR_VERSION" ] && [ "$CL_PENDING_OK" = false ]; then
    echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：锚定到 v${CL_LINE_VER:-未知} 行，但当前版本是 ${CUR_VERSION}——最新版索引行未命中锚定正则（多批构成格式漂移？），旧版行不得替代校验${NC}"
    record_manual "CHANGELOG.md" "$CL_LINENO" "锚定版本 v${CL_LINE_VER:-未知} 与当前 ${CUR_VERSION} 不符（须先修锚定正则或条目版本）"
    ((FAIL++)) || true
  else
  # 锚定「测试 N→**M**（」头段取前值/当前值；增量改为括号内全部「+N」求和——
  # 兼容单批（+270）与多批构成（+138 +34 +41 … 多批 +N 空格分隔）
  CL_HEAD=$(echo "$CHANGELOG_LINE" | grep -oE '测试 [0-9]+→\*\*[0-9]+\*\*' | head -1)
  CL_PREV=$(echo "$CL_HEAD" | grep -oE '[0-9]+' | sed -n '1p')
  CL_CUR=$(echo "$CL_HEAD" | grep -oE '[0-9]+' | sed -n '2p')
  CL_PAREN=$(echo "$CHANGELOG_LINE" | sed 's/^.*测试 [0-9]*→\*\*[0-9]*\*\*（//' | sed 's/）.*//' )
  # 括号内全部「+N」token 求和（grep -o 逐个取出后累加）
  CL_DELTA_SUM=0
  CL_DELTA_COUNT=0
  for tok in $(echo "$CL_PAREN" | grep -oE '\+[0-9]+'); do
    CL_DELTA_SUM=$((CL_DELTA_SUM + ${tok#+}))
    CL_DELTA_COUNT=$((CL_DELTA_COUNT + 1))
  done
  cl_fail=0
  # 防二：解析 fail-loud——头段数字缺失或括号内零个「+N」= 构成无法解析，不静默放行
  if [ -z "$CL_PREV" ] || [ -z "$CL_CUR" ] || [ "$CL_DELTA_COUNT" -eq 0 ]; then
    echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：构成无法解析——prev=${CL_PREV:-空} cur=${CL_CUR:-空}，括号内「+N」token 0 个（正则失配或格式漂移，禁止静默回退）${NC}"
    record_manual "CHANGELOG.md" "$CL_LINENO" "测试数构成无法解析（正则失配/格式漂移）"
    cl_fail=1
  fi
  # 防三：未量化字样 WARN（不阻塞，但让人看见）——「若干」等字样说明该批没数
  if [[ "$CL_PAREN" == *若干* ]]; then
    echo -e "  ${YELLOW}⚠ CHANGELOG.md（行 ${CL_LINENO}）：构成含「若干」未量化批次——算术校验覆盖不到该批，建议补具体数字${NC}"
  fi
  # ① 算术自洽：前值 + 各批增量之和 = 当前值（解析异常时短路，防空值参与算术产生新噪声）
  if [ "$cl_fail" = "0" ]; then
    CL_SUM=$((CL_PREV + CL_DELTA_SUM))
    if [ "$CL_SUM" -ne "$CL_CUR" ]; then
      echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：算术不自洽——${CL_PREV}+Σ(括号内 ${CL_DELTA_COUNT} 批)=${CL_PREV}+${CL_DELTA_SUM}=${CL_SUM} ≠ ${CL_CUR}${NC}"
      # 算术不自洽**不给自动替换**：改「当前值」（${CL_CUR}→${CL_SUM}）与改「增量」
      # 都能让等式成立，脚本无法判定哪个是原始意图——猜错就是把错数写进台账。
      # 但仍显式给出「旧→新（候选）」与落点，避免退回「人工全凭感觉找」。
      record_manual "CHANGELOG.md" "$CL_LINENO" "算术不自洽（若改当前值：${CL_CUR} → ${CL_SUM}；若改增量：需人工判定）"
      cl_fail=1
    fi
  fi
  # ② 双口径对齐（历史快照语义）：CHANGELOG 最新版本行是发版时点快照（同开发日志
  #    「历史冻结」），不与当前 TOTAL_TESTS 比对（发版后新增测试属正常漂移）。
  #    只校验「workspace 口径 NNNN」标注与同版本开发日志快照一致——开发日志才是
  #    该版本测试数的 SSOT。
  #    v1.4.8 修正：删除原「再叠 27(DSH)+17(OpenClaw) 得全量口径」的换算式——它与
  #    CHANGELOG 实际写法不符（索引行的数字本身即 workspace 口径，实测 4429 = 开发日志
  #    快照 4429）；保留会让校验一旦被标注激活就必红（4429 ≠ 4429+44）。
  # v1.4.9 G-13：补 `head -1`（同形态硬化——无论首个「workspace 口径 N」出现在哪，都取行内首处）
  # v1.5.2 A-2：正则扩双形态——既有「workspace 口径 NNNN」与 B-15 口径精确化的
  #   「workspace（模块包）口径 NNNN」（门禁格式契约随台账措辞联动，防再漂移致校验静默跳过）。
  CL_WS_MARK=$(echo "$CHANGELOG_LINE" | grep -oE 'workspace(（模块包）)? ?口径 ?[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")
  if [ -n "$CL_WS_MARK" ]; then
    # 找同版本开发日志的 workspace 快照（「NNNN tests across NN packages」或「workspace NNNN」）
    # v1.4.8：包数不再写死 12——train 拆包后为 13，用 [0-9]+ 动态匹配（写死会在包数变化后静默穿透）
    # 注意只取第一个数字（该模式含两个数字——测试数与包数，head -1 取测试数）
    # v1.4.1 适配：DEVLOG_FILE 按 package.json 版本指向（版本未 bump 时指向上版已发日志），
    # 而 CHANGELOG 最新行已是开发中版本——优先在「下一版开发日志」找快照：若 CHANGELOG 行
    # 版本号 ≠ CUR_VERSION，则优先探测 docs/changelog/vX.Y/v<行版本>.md（存在即用），否则回退 DEVLOG_FILE。
    CL_VER=$(echo "$CHANGELOG_LINE" | grep -oE '\*\*v[0-9]+\.[0-9]+\.[0-9]+\*\*' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
    CL_DEVLOG="${DEVLOG_FILE}"
    if [ -n "$CL_VER" ] && [ "$CL_VER" != "$CUR_VERSION" ]; then
      CL_MAJOR_MINOR=$(echo "$CL_VER" | cut -d. -f1-2)
      CL_CAND="docs/changelog/v${CL_MAJOR_MINOR}/v${CL_VER}.md"
      [ -f "$CL_CAND" ] && CL_DEVLOG="$CL_CAND"
    fi
    DEVLOG_SNAPSHOT=$(grep -oE '[0-9]+ tests across [0-9]+ packages' "${CL_DEVLOG}" 2>/dev/null | head -1 | grep -oE '^[0-9]+' || echo "")
    if [ -n "$DEVLOG_SNAPSHOT" ]; then
      if [ "$CL_WS_MARK" != "$DEVLOG_SNAPSHOT" ]; then
        echo -e "  ${RED}✗ CHANGELOG.md（行 ${CL_LINENO}）：workspace 口径声称 ${CL_WS_MARK}，开发日志快照 ${DEVLOG_SNAPSHOT}（${CL_DEVLOG}）${NC}"
        # 锚与上方 `workspace(（模块包）)? ?口径 ?[0-9]+` 提取同源：数字为捕获组 1，
        # 前缀改非捕获组（(?:…)）以便锚内只有「数字」一个捕获组。
        record_fix "CHANGELOG.md" "$CL_LINENO" "$CL_WS_MARK" "$DEVLOG_SNAPSHOT" 'workspace(?:（模块包）)? ?口径 ?([0-9]+)'
        cl_fail=1
      fi
    else
      # v1.4.9 G-13 同族：原实现无 else ⇒ 开发日志快照提取失败时**静默跳过**（本分支已进入
      #   「CHANGELOG 行带 workspace 口径标注」的前提，理应能取到同版本开发日志快照）。
      #   不判红（开发中版本的日志可能尚未写快照行），但必须让「未校验」可见。
      SKIPS=$((SKIPS + 1))
      if [ "$QUIET" = false ]; then
        echo -e "  ${YELLOW}⏏️ CHANGELOG.md（行 ${CL_LINENO}）：带 workspace 口径 ${CL_WS_MARK} 标注，但 ${CL_DEVLOG} 无「NNN tests across NN packages」快照行——本次跳过，非失败${NC}"
      fi
    fi
  else
    # v1.4.8 修正：原实现「无标注即整块静默跳过」属**守卫空转**（看着有校验、实际不校验，
    # 输出仍显示 ✓）。现改为**显式声明本次跳过**——不判红（部分版本行确无该标注），
    # 但让「未校验」这件事可见、可被审计发现。
    SKIPS=$((SKIPS + 1))
    if [ "$QUIET" = false ]; then
      echo -e "  ${YELLOW}⚠ CHANGELOG.md 索引行未带「workspace 口径 NNNN」标注——双口径对齐校验本次跳过（非失败）${NC}"
    fi
  fi
  if [ "$cl_fail" = "0" ]; then
    if [ "$QUIET" = false ]; then
      echo -e "  ${GREEN}✓ CHANGELOG.md 索引行（行 ${CL_LINENO}）：${CL_PREV}+Σ(括号内 ${CL_DELTA_COUNT} 批)=${CL_PREV}+${CL_DELTA_SUM}=${CL_CUR} 算术自洽${CL_WS_MARK:+，workspace 口径 ${CL_WS_MARK} 对齐}"
    fi
    ((PASS++)) || true
  else
    ((FAIL++)) || true
  fi
  fi  # 锚定行版本核对（CL_LINE_VER）分支闭合
fi

# ── 结果汇总 ──
if [ "$QUIET" = false ]; then
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════${NC}"
fi

if [ "$FAIL" -gt 0 ]; then
  if [ "$QUIET" = true ]; then
    echo "FAIL"
  else
    echo -e "  ${RED}✗ ${FAIL} 处文档测试数漂移${NC}"
    echo -e "  ${YELLOW}修法：跑 bash tools/check/test-count.sh 拿实际数，按下方落点逐处改；或让文档引用 tools/check/test-count.sh 动态值，不硬编码${NC}"
    echo ""
    echo -e "  ${BOLD}── 修复落点：可自动替换 ${FIX_SITES} 处 / 需人工 ${MANUAL_SITES} 处 ──${NC}"
    if [ -n "$FIX_FILE" ] && [ -s "$FIX_FILE" ]; then
      while IFS=$'\t' read -r _fx_file _fx_line _fx_old _fx_new _fx_anchor; do
        [ -n "$_fx_file" ] || continue
        echo -e "    ${_fx_file}:${_fx_line}  ${_fx_old} → ${_fx_new}"
      done < "$FIX_FILE"
    else
      echo -e "    （无可自动替换落点——全部为结构/措辞失配，见上方 ↳ 行）"
    fi
    build_fix_json
    echo ""
    echo -e "  ${BOLD}── 修复命令（任选其一；均已按上方落点与锚生成）──${NC}"
    if [ -n "$FIX_JSON" ]; then
      echo -e "    ${YELLOW}① node 单行（可直接粘贴，不依赖本脚本其它参数；逐处 file:line 与 旧→新 已内联）${NC}"
      # 单引号兜底：清单字段全由本脚本自产（路径/纯数字/无反引号 anchor），
      # 理论不含单引号；一旦含（如仓库路径带 '）内联会静默改错，故降级为只给 ②。
      case "${PWD}${FIXER_JS}${FIX_JSON}" in
        *"'"*)
          echo -e "      ${RED}（检测到单引号，内联转义不可靠——已省略 ①，请用 ②）${NC}"
          ;;
        *)
          printf "      cd '%s' && node -e '%s' '%s'\n" "${PWD}" "${FIXER_JS}" "${FIX_JSON}"
          ;;
      esac
    else
      echo -e "    ${RED}（无法生成 node 单行：node 不可用或清单损坏——请用 ② 或按落点手工改）${NC}"
    fi
    echo -e "    ${GREEN}② bash tools/check/check-test-count.sh --fix${NC}"
    echo -e "      ${YELLOW}（= 先打印落点与 旧→新 → 再替换 → 最后重跑自校验；默认路径始终只读，写盘只发生在 --fix）${NC}"
  fi
  emit_coverage_verbose "$((PASS + FAIL))"

  # ══════════════════════════════════════════════════════════════
  # --fix 落盘：只在此显式模式下写仓内文件（默认路径绝不走到这里）
  # ══════════════════════════════════════════════════════════════
  if [ "$FIX_MODE" = true ]; then
    echo ""
    if ! command -v node >/dev/null 2>&1; then
      echo -e "  ${RED}✗ --fix 需要 node 承担替换，但 PATH 中找不到 node——拒绝降级（不装作修好了）${NC}"
      exit 2
    fi
    if [ -z "$FIX_FILE" ] || [ ! -s "$FIX_FILE" ]; then
      echo -e "  ${RED}✗ --fix：本次 ${FAIL} 处漂移全部是结构/措辞失配，没有「可自动替换」落点——须人工按上方 ↳ 行处理${NC}"
      exit 1
    fi
    echo -e "${BOLD}── --fix 计划（${FIX_SITES} 处，即将落盘）──${NC}"
    while IFS=$'\t' read -r _fx_file _fx_line _fx_old _fx_new _fx_anchor; do
      [ -n "$_fx_file" ] || continue
      echo -e "    ${_fx_file}:${_fx_line}  ${_fx_old} → ${_fx_new}"
    done < "$FIX_FILE"
    echo -e "${BOLD}── 执行替换 ──${NC}"
    if ! node -e "$FIXER_JS" "$FIX_JSON"; then
      echo -e "  ${RED}✗ --fix：存在回填失败的落点——不声明完成，请按上方失败明细人工处理${NC}"
      exit 1
    fi
    echo ""
    echo -e "${BOLD}── 复验（重跑自校验，非 quiet 以便看见最终状态）──${NC}"
    # 复验走默认只读路径（不带 --fix），因此不可能自我递归
    if bash "${_SELF_DIR}/check-test-count.sh"; then
      echo ""
      echo -e "  ${GREEN}✅ --fix 完成：复验全绿，漂移已收口${NC}"
      exit 0
    fi
    echo ""
    echo -e "  ${RED}❌ --fix 后复验仍红——自动替换未能收口全部漂移，剩余项须人工处理${NC}"
    exit 1
  fi
  exit 1
else
  if [ "$QUIET" = true ]; then
    echo "OK"
  else
    echo -e "  ${GREEN}✓ 文档测试数全部一致（${PASS} 处校验通过）${NC}"
    if [ "$FIX_MODE" = true ]; then
      echo -e "  ${GREEN}✓ --fix：本次无漂移，未写任何文件${NC}"
    fi
  fi
  emit_coverage_verbose "$((PASS + FAIL))"
  exit 0
fi
