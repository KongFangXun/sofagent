#!/usr/bin/env bash
# ============================================================
# check-literals.sh · 手填字面量对账（通用机制 · 数据驱动门禁）
# ============================================================
# 解决一类反复发作的病：**同一个事实被手抄成两份**——一份是真相源（代码/脚本
# 实算可得），一份是手抄件（文档里手填的字面量），抄完没有对账，于是静默漂移。
#
# 已实锤的三例（本机制要消灭的病）：
#   1. bootstrap.sh 手填 7 个安装脚本 sha256，回填后又改了源文件 → 主安装路径
#      fail-closed（v1.4.5 P0）
#   2. dev prompt 头部写「changelog 125 行」，日志继续涨 → 快照标记漂移
#   3. 审计信任锚 ~/.sofagent/internal/audit-hash.txt（同类手抄件，未登记）
#
# 设计取向：**一处通用机制，而非每种漂移写一个专用检查**。
# 新增一个字面量只需在 literals.json 登记一行，不写新代码。
#
# 用法:
#   bash tools/check/check-literals.sh                  # 默认（跳过 slow 条目）
#   bash tools/check/check-literals.sh --slow           # 连慢条目一起跑（如测试数）
#   bash tools/check/check-literals.sh --fix            # 自动把真值回填进文档
#   bash tools/check/check-literals.sh --registry <p>   # 用备用注册表（测试/临时用）
#   bash tools/check/check-literals.sh --only <id>      # 只跑某一条
#   bash tools/check/check-literals.sh --quiet          # 只输出最后一行汇总
#
# 退出码:
#   0 = 全部一致（或仅 warn 级不一致 / 仅跳过）
#   1 = 存在 error 级不一致（--fix 后会自动重跑自检，仍红则 exit 1）
#
# 检查流程（每条登记项）:
#   1. file 不存在          → ⏭ 跳过（计 skipped）——如 ~/Desktop/... 在别的机器上没有
#   2. slow=true 且未 --slow → ⏭ 跳过（计 skipped）
#   3. extract 在 file 中无匹配 → ⏭ 跳过（计 skipped）并提示「提取正则失效，请更新注册表」
#      ↑ 刻意不计错误：文档改写了措辞 ≠ 数字漂移，避免把「正则过期」伪装成「数字错了」
#        造成假红。跳过数会进汇总，K 异常增长即有信号。
#   4. derive 返回空/非数字  → ⚠️ 计 warn（真相源取不到，宁可疑不假绿）
#   5. 字面量 == 真值        → ✅
#   6. 字面量 != 真值        → ❌/⚠️（按 level），给出「改哪个文件、改成什么」的修复指引
#
# 注册表字段（tools/check/literals.json）:
#   id      唯一标识
#   file    被检查文档（相对仓库根，或 ~/ 开头）
#   extract JS 正则，**恰好一个捕获组**，捕获组即手填字面量；取文件中第一处匹配
#   derive  shell 命令（仓库根执行），stdout 单行即真值
#   level   error（不一致 exit 1）/ warn（仅提示）
#   slow    true = 真值计算耗时，默认跳过
#   note    一句话说明这个数字是什么
#
# 与既有脚本的关系（不重复造轮子）:
#   - check-version.sh §20b 已覆盖 bootstrap 的 7 个 sha256、§13b 已覆盖 WIKI/README
#     的「N 条规则」、§26 已覆盖十文档的工具数口径 —— 这些**不重复登记**。
#   - check-docs.sh §7 三方对账 已覆盖 audit/README × rules/index.ts × 主 README 的
#     规则数 —— 本表只补它没管的「quick 默认 17 条」。
#   - check-test-count.sh 只扫仓库内文档，扫不到桌面上的 dev prompt —— 本表的
#     测试数条目是它唯一的补位。
#
# ⚠️ 假阳性纪律：宁缺毋滥。登记一条就要保证它长期稳定为真；
#    不稳定的字面量（如「同步于某日」类快照）登记为 error 会变成噪音源，
#    应降级 warn 或干脆不登记。
# ============================================================

set -o pipefail

cd "$(dirname "$0")/../.." || exit 1

FIX=false
SLOW=false
QUIET=false
REGISTRY="tools/check/literals.json"
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix) FIX=true; shift ;;
    --slow) SLOW=true; shift ;;
    --quiet) QUIET=true; shift ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    -h|--help)
      echo "用法: bash tools/check/check-literals.sh [--fix] [--slow] [--quiet] [--registry <p>] [--only <id>]"
      exit 0 ;;
    *) echo "未知参数: $1 （--fix / --slow / --quiet / --registry / --only）"; exit 1 ;;
  esac
done

# ── 前置：node（提取与回填都靠它，缺失时不得静默假绿）──
NODE="${NODE:-node}"
if ! command -v "$NODE" &>/dev/null; then
  echo "❌ 找不到 node 可执行文件（NODE=${NODE}）——无法解析注册表与提取字面量"
  exit 1
fi

if [ ! -f "$REGISTRY" ]; then
  echo "❌ 注册表不存在: $REGISTRY"
  exit 1
fi

# ── 从注册表读出字段（\x1f 分隔，规避 JSON 里的引号/反斜杠转义地狱）──
SEP=$'\x1f'
ROWS_TMP=$(mktemp /tmp/check-literals.rows.XXXXXX)
trap 'rm -f "$ROWS_TMP"' EXIT

"$NODE" -e '
const fs = require("fs");
const SEP = "\x1f";
let j;
try {
  j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch (e) {
  process.stderr.write("❌ 注册表 JSON 解析失败: " + e.message + "\n");
  process.exit(1);
}
const checks = Array.isArray(j && j.checks) ? j.checks : [];
if (checks.length === 0) {
  process.stderr.write("❌ 注册表 checks 为空——没有任何登记项\n");
  process.exit(1);
}
for (const c of checks) {
  const id = c.id || "";
  if (!id) { process.stderr.write("❌ 存在缺 id 的登记项\n"); process.exit(1); }
  const out = [
    id,
    c.file || "",
    c.extract || "",
    c.derive || "",
    c.level || "error",
    String(c.slow === true),
    c.note || "",
  ];
  if (out.some((v) => v.indexOf(SEP) >= 0)) {
    process.stderr.write("❌ 登记项 " + id + " 的字段含分隔符，无法安全传递\n");
    process.exit(1);
  }
  process.stdout.write(out.join(SEP) + "\n");
}
' "$REGISTRY" > "$ROWS_TMP" 2>/tmp/check-literals.nodeerr || {
  cat /tmp/check-literals.nodeerr >&2
  rm -f /tmp/check-literals.nodeerr
  exit 1
}
if [ -s /tmp/check-literals.nodeerr ]; then cat /tmp/check-literals.nodeerr >&2; fi
rm -f /tmp/check-literals.nodeerr

if [ ! -s "$ROWS_TMP" ]; then
  echo "❌ 注册表解析结果为空"
  exit 1
fi

# ── 提取：把 file 里第一处匹配 extract 的捕获组 1 打到 stdout ──
extract_literal() {
  "$NODE" -e '
const fs = require("fs");
const file = process.argv[1];
const pattern = process.argv[2];
let re;
try { re = new RegExp(pattern); } catch (e) {
  process.stderr.write("❌ extract 正则非法: " + e.message + "\n");
  process.exit(2);
}
if (re.source.indexOf("(") < 0) {
  process.stderr.write("❌ extract 必须含一个捕获组\n");
  process.exit(2);
}
let content;
try { content = fs.readFileSync(file, "utf8"); } catch (e) { process.exit(2); }
const m = content.match(re);
if (!m || m[1] === undefined) process.exit(3);
process.stdout.write(String(m[1]));
' "$1" "$2" 2>/dev/null
}

# ── 回填：把 file 中所有匹配的捕获组 1 换成新值（全局替换，防多处声明只改一处）──
fix_literal() {
  "$NODE" -e '
const fs = require("fs");
const file = process.argv[1];
const pattern = process.argv[2];
const newVal = process.argv[3];
let re;
try { re = new RegExp(pattern, "g"); } catch (e) {
  process.stderr.write("❌ extract 正则非法: " + e.message + "\n");
  process.exit(2);
}
const content = fs.readFileSync(file, "utf8");
let n = 0;
const out = content.replace(re, (m, g1) => {
  if (g1 === undefined) return m;
  n++;
  // 只替换匹配文本内第一次出现的捕获组内容，保留其余原文（如「**83**」的星号）
  const at = m.indexOf(g1);
  return m.slice(0, at) + newVal + m.slice(at + g1.length);
});
if (n === 0) process.exit(3);
fs.writeFileSync(file, out, "utf8");
process.stdout.write(String(n));
' "$1" "$2" "$3" 2>/dev/null
}

OK_COUNT=0
BAD_ERROR=0
BAD_WARN=0
SKIP_COUNT=0
FIXED_COUNT=0
declare -a BAD_IDS=()

if [ "$QUIET" = false ]; then
  echo "═══ check-literals · 手填字面量对账 ═══"
  echo "注册表: $REGISTRY"
  [ "$FIX" = true ] && echo "模式: --fix（不一致项自动回填真值）"
  [ "$SLOW" = true ] && echo "模式: --slow（含慢速条目）"
  echo ""
fi

while IFS="$SEP" read -r id file extract derive level slow note; do
  [ -z "${id:-}" ] && continue
  [ -n "$ONLY" ] && [ "$ONLY" != "$id" ] && continue

  # ~ 展开（注册表里允许写 ~/Desktop/...）
  fpath="${file/#\~/$HOME}"

  if [ ! -f "$fpath" ]; then
    SKIP_COUNT=$((SKIP_COUNT + 1))
    [ "$QUIET" = false ] && printf '  ⏭ %s — 跳过（文件不存在: %s）\n' "$id" "$file"
    continue
  fi

  if [ "$slow" = "true" ] && [ "$SLOW" = false ]; then
    SKIP_COUNT=$((SKIP_COUNT + 1))
    [ "$QUIET" = false ] && printf '  ⏭ %s — 跳过（慢速条目，加 --slow 才跑）\n' "$id"
    continue
  fi

  claimed=$(extract_literal "$fpath" "$extract")
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$claimed" ]; then
    SKIP_COUNT=$((SKIP_COUNT + 1))
    if [ "$QUIET" = false ]; then
      printf '  ⏭ %s — 跳过（extract 正则在文件里无匹配）\n' "$id"
      printf '       → 文档措辞可能改了，或正则过期：更新 %s 里该条 extract\n' "$REGISTRY"
      printf '       → 文件: %s\n' "$file"
    fi
    continue
  fi

  actual=$(eval "$derive" 2>/dev/null | head -1 | tr -d '[:space:]')

  if [ -z "$actual" ]; then
    BAD_WARN=$((BAD_WARN + 1))
    if [ "$QUIET" = false ]; then
      printf '  ⚠️  %s — derive 返回空，真值取不到（疑是真相源丢失，宁可疑不假绿）\n' "$id"
      printf '       → derive: %s\n' "$derive"
      printf '       → note: %s\n' "$note"
    fi
    continue
  fi

  if [ "$claimed" = "$actual" ]; then
    OK_COUNT=$((OK_COUNT + 1))
    [ "$QUIET" = false ] && printf '  ✅ %s — %s（一致 · %s）\n' "$id" "$claimed" "$note"
    continue
  fi

  # ── 不一致 ──
  if [ "$FIX" = true ]; then
    n=$(fix_literal "$fpath" "$extract" "$actual")
    if [ -n "$n" ]; then
      FIXED_COUNT=$((FIXED_COUNT + 1))
      if [ "$QUIET" = false ]; then
        printf '  🔧 %s — 已回填: %s → %s（%s 处）\n' "$id" "$claimed" "$actual" "$n"
        # ⚠️ --fix 是「全局替换」：同文档里所有匹配该 extract 的位置都会被改。
        # 危害面：过渡记法（如「83→84」）若也匹配同一正则，会被一并改写成「84→84」。
        # 防护：① 登记时把 extract 收紧到只匹配目标行（如 "\\| MCP tools" 锚定表格行）；
        #       ② 替换处数 >1 时显式告警，提示人工确认没有误伤。
        if [ "$n" -gt 1 ]; then
          printf '       ⚠️  本次替换了 %s 处——请确认未误伤过渡记法/历史值；若不应全局替换，把 extract 收紧\n' "$n"
        fi
      fi
      continue
    fi
    [ "$QUIET" = false ] && printf '  ⚠️  %s — --fix 回填失败（extract 无匹配）\n' "$id"
  fi

  if [ "$level" = "error" ]; then
    BAD_ERROR=$((BAD_ERROR + 1))
    BAD_IDS+=("$id")
    [ "$QUIET" = false ] && printf '  ❌ %s — 声称 %s，实际 %s\n' "$id" "$claimed" "$actual"
  else
    BAD_WARN=$((BAD_WARN + 1))
    [ "$QUIET" = false ] && printf '  ⚠️  %s — 声称 %s，实际 %s\n' "$id" "$claimed" "$actual"
  fi

  if [ "$QUIET" = false ]; then
    printf '       → 改文件: %s\n' "$file"
    printf '       → 把「%s」改成「%s」\n' "$claimed" "$actual"
    printf '       → 或自动修: bash tools/check/check-literals.sh --fix --only %s\n' "$id"
    printf '       → 这个数字是什么: %s\n' "$note"
  fi
done < "$ROWS_TMP"

# ── --fix 后重跑自检：修完必须自己转绿，不留半修状态 ──
if [ "$FIX" = true ] && [ "$FIXED_COUNT" -gt 0 ]; then
  [ "$QUIET" = false ] && echo ""
  [ "$QUIET" = false ] && echo "── --fix 完成，重跑自检确认转绿 ──"
  VERIFY_OUT=$(bash "$0" --registry "$REGISTRY" --only "$ONLY" $([ "$SLOW" = true ] && echo --slow) 2>&1)
  VERIFY_RC=$?
  [ "$QUIET" = false ] && echo "$VERIFY_OUT"
  if [ "$VERIFY_RC" -ne 0 ]; then
    echo ""
    echo "❌ --fix 后自检仍红——回填未解决全部漂移，请人工处理"
    exit 1
  fi
fi

if [ "$QUIET" = false ]; then echo ""; fi
echo "── 汇总 ──"
echo "  ✅ 一致: $OK_COUNT"
echo "  ❌ 不一致(error): $BAD_ERROR"
echo "  ⚠️  不一致/可疑(warn): $BAD_WARN"
echo "  ⏭  跳过: $SKIP_COUNT"
[ "$FIX" = true ] && echo "  🔧 已回填: $FIXED_COUNT"

if [ "$BAD_ERROR" -gt 0 ]; then
  echo ""
  echo "❌ 手填字面量漂移 ${BAD_ERROR} 项（error 级）：${BAD_IDS[*]}"
  echo "   这些数字是手抄件，真相源已变——按上方指引改文档，或跑 --fix 自动回填"
  exit 1
fi

echo ""
echo "✅ 无 error 级字面量漂移"
exit 0
