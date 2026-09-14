#!/usr/bin/env bash
# ============================================================
# check-dev-prompt.sh · 开发日志/Dev Prompt 代码引用一致性校验
# ============================================================
# 扫描开发日志或 dev prompt 中的代码引用（文件路径、函数名），
# 与实际代码库做 diff——不存在或不匹配就报错。
#
# 价值：dev prompt 由 AI 生成，经常引用不存在的路径或虚构函数。
#       本脚本在"生成 prompt → 审查 → 修复"循环中替代手工 grep。
#
# 用法:
#   ./tools/check-dev-prompt.sh <file.md>
#   ./tools/check-dev-prompt.sh ~/Desktop/vX.Y-dev-prompt.md
#   ./tools/check-dev-prompt.sh docs/changelog/v1.2/v1.2.3.md
#
# 退出码:
#   0 = 全部已有引用一致（待新建的不算错误）
#   1 = 发现不匹配的已有引用
#
# 检查项:
#   1. 文件路径引用（反引号包裹的 .ts/.sh/.mjs/.json 路径）
#   2. 函数名引用（反引号包裹的 functionName()）
#   3. 目录引用（反引号包裹的 path/ 路径）
#   4. 快照标记对账（`<file>.md`（N 行）——声明行数 vs 实际 wc -l）
#
# 智能标记：
#   📋 该引用的前置动词或后置注记是「新建」→ 待新建，不计错误
#   🔄 运行时目录（data/ .sofagent/）／非纯路径（URL、内嵌命令）→ 跳过
#   ⚠️ 路径缺前缀（engine/ FORGE/ 等，含跨多级简写）→ 警告
#   ❌ 路径错位（引用处的路径不存在、同名文件在别处）／文件不存在 → 错误
#
# 判定纪律（历史假绿/假红已根治，勿回退）：
#   ① 「待新建」按**单个引用**归属，不按整行——同一行的动词标记只管辖其后、
#      下一个动词标记之前的引用段。整行归因会让「新建 A；修改 B」里的 B
#      被一并放行（B 的错误路径换行即报 ❌，结论随行内他物而变）。
#   ② 路径列举式（`A`（改造）/ `B`（新建））的注记**后置**且以「/」分隔——
#      注记只属它前面那个引用，用 ownAnnotation() 按下标归属。既不能整行归因，
#      也不能把「/」当项边界削前缀（削了就丢动词，把兜底放宽回整行 = 假绿）。
#   ③ 前缀拼接解析不到时，按路径后缀/文件名反查真实位置——模块迁移后的
#      旧路径（如 orchestrator/src/train/x.ts 实为 engine/train/src/x.ts）
#      必须报「路径错位」并点明去处，不得落「待新建」静默放行。
#   ④ 提取器带合成探针自检，模式被改坏即 RC=3 退出；**不要**改回按
#      「源文件含反引号 vs 提取结果为空」判失灵——合法文档本就无可提取引用。
# ============================================================

set -o pipefail

# 覆盖度行范式（v1.4.9 G-2②）——须在 cd 之前 source（cd 后相对路径失效）
_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${_SELF_DIR}/lib/coverage-line.sh" ]; then
  . "${_SELF_DIR}/lib/coverage-line.sh"
else
  # 库缺失时降级为同伴实现——门禁不因范式库缺失而中断
  emit_coverage_line() {
    printf '[check:coverage] script=%s asserts=%s covered=%s skipped=%s\n' \
      "${1:-unknown}" "${2:-0}" "${3:--}" "${4:-0}"
  }
fi

cd "$(dirname "$0")/../.." || exit 1

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "用法: ./tools/check-dev-prompt.sh <file.md>"
  echo "  检查开发日志或 dev prompt 中的代码引用是否与实际代码库一致"
  exit 1
fi

FILE="${FILE/#\~/$HOME}"

if [ ! -f "$FILE" ]; then
  echo "❌ 文件不存在: $FILE"
  emit_coverage_line "check-dev-prompt" "0" "0" "0"
  exit 1
fi

# 提取引用到临时文件（Node.js 做提取比 sed/grep 健壮）
TMPFILE=$(mktemp /tmp/check-dev-prompt.XXXXXX)
ERRFILE=$(mktemp /tmp/check-dev-prompt-err.XXXXXX)
IDXFILE=$(mktemp /tmp/check-dev-prompt-idx.XXXXXX)
trap 'rm -f "$TMPFILE" "$ERRFILE" "$IDXFILE"' EXIT

# 🔴 v1.2.6 修复：NODE 未设置时 "$NODE" 展开为空 → node 步骤静默失败 →
# TMPFILE 为空 → 三项检查全跳过 = 虚假绿色（零 ❌ 但实际什么都没查）。
NODE="${NODE:-node}"
if ! command -v "$NODE" &>/dev/null; then
  echo "❌ 找不到 node 可执行文件（NODE=${NODE}）——无法校验引用"
  emit_coverage_line "check-dev-prompt" "0" "0" "0"
  exit 1
fi

"$NODE" -e '
var fs = require("fs");
var c = fs.readFileSync(process.argv[1], "utf8");
var lines = c.split("\n");

// ─── 提取模式（单一出处）+ 提取器自检 ───
// 🔴 自检的意义：历史上「提取恒空 → 三项检查全跳过 → 恒绿」出现过两次
//    （NODE 展开为空、提取器静默失败）。这里给每条模式打一个合成探针，
//    模式被改坏就以 RC=3 退出，而不是静默输出空结果。
//    刻意**不用**「源文件反引号数 vs 提取结果」这类数据形状判据——合法文档
//    （只含 `npm test`、`~/Desktop/` 之类）本就没有可提取引用，那样会误报。
var F_RE = /`([^`]*\.(?:ts|sh|mjs|json|yml))`/g; // 文件路径
var N_RE = /`([a-zA-Z_][a-zA-Z0-9_]*)\(\)`/g;    // 函数名
var D_RE = /`([^`]*\/)`/g;                       // 目录
var L_RE = /`([^`]+)`\s*[（(]\s*(\d+)\s*行/g;    // 快照标记（路径 + 声明行数）

// 正向探针：模式必须命中；负向探针：模式**不得**命中。
// 两组都要——只打正向探针只能发现模式彻底失效，发现不了被放宽
// （如目录模式丢掉结尾的「/」要求，任何反引号串都会被当成目录）。
function probeHit(re, s) {
  return [...s.matchAll(re)].length > 0;
}
var P_POS = 0, P_NEG = 0;
if (probeHit(F_RE, "`engine/x/a.ts`")) P_POS |= 1;
if (probeHit(N_RE, "`foo()`")) P_POS |= 2;
if (probeHit(D_RE, "`engine/x/`")) P_POS |= 4;
if (probeHit(L_RE, "`a.md`（12 行）")) P_POS |= 8;

if (!probeHit(F_RE, "`a.md`")) P_NEG |= 1;            // 扩展名白名单被放宽
if (!probeHit(D_RE, "`engine/x/a.ts`")) P_NEG |= 2;   // 目录必须以 / 收尾
if (!probeHit(N_RE, "`foo`")) P_NEG |= 4;             // 函数名必须带 ()
if (!probeHit(L_RE, "`a.md`")) P_NEG |= 8;            // 快照必须带「N 行」

if (P_POS !== 15 || P_NEG !== 15) {
  process.stderr.write("提取器自检失败：正向=" + P_POS + "/15 负向=" + P_NEG + "/15\n");
  process.exit(3);
}

// 全文级结构上下文（保持原语义）：全文声明「分目录/物理分子/目标结构」时，
// tools/ 下尚不存在的路径属本版规划产物
var hasSplitCtx = false;
for (var si = 0; si < lines.length; si++) {
  if (/分目录|物理分子|目标结构/.test(lines[si])) { hasSplitCtx = true; break; }
}

// 🔴 待新建判定：动词只管辖「本项」，禁止整行归因（历史假绿实锤）。
//   ① 表格行 = 单条记录，动词常写在路径**之后**的「改动」列 → 按整行判（保持原语义）
//   ② 散文行 = 先取引用所属「项」的前缀动词：
//        · 前缀含改动族 → 不是待新建
//          （这一步专杀「新建 A；修改 B」里 B 被 A 的「新建」放行——同一路径换行即报 ❌）
//        · 前缀含新建族 → 待新建
//        · 前缀无动词（如「…；单测 `x`、`y`」这类同义项组）→ 回落整行，保持既有行为
//   项边界 = 、；|。：，——项内动词不外溢到邻项。
//   ③ 路径列举式（`A`（改造）/ `B`（接协议）/ `C`（新建））：注记写在路径**之后**，
//      分隔符是「/」而不是 ② 的那组标点。此时**不能**把「/」也当项边界——它会连带
//      削掉前缀里的动词（连「新建 `A` / `B`」这类前景动词一起丢），把兜底放宽回整行。
//      正确做法是按下标归属：`path`（…）里的注记只属它前面那个引用，见 ownAnnotation()。
var ITEM_SEP = /[、；;|。：:，,]/;

function itemPrefix(line, refIndex) {
  for (var i = refIndex - 1; i >= 0; i--) {
    if (ITEM_SEP.test(line.charAt(i))) return line.slice(i + 1, refIndex);
  }
  return line.slice(0, refIndex);
}

// 路径后置注记：`path`（…新建…）——只归属它**前面**那个引用。
// 提取正则的 m.index 指向起始反引号，引用内容在其后一位，故用 indexOf 定内容起点。
function ownAnnotation(line, refIndex, ref) {
  var at = line.indexOf(ref, refIndex);
  if (at < 0) return "";
  var m = line.slice(at + ref.length).match(/^`?\s*[（(]([^）)]*)[）)]/);
  return m ? m[1] : "";
}

// 注记里「新建」的两种合法写法：标记在注记**开头**（`（新建——用途…）`）
// 或**末尾**（`（schema 注册表新建）`）。
// 🔴 禁止整串包含式匹配：注记中间的「新建」多是叙述而非标记
//    （实锤：「（前者待新建，后者路径错位）」会让一条真错路径被放行成待新建）。
function annoSaysNew(anno) {
  if (/(?:待新建|新建|新文件)[\s。；;，,、）)]*$/.test(anno)) return true;
  if (/^(?:待新建|新建|新文件)[\s—－\-：:（(，,、；;]/.test(anno)) return true;
  return false;
}

function isPlannedRef(ref, line, refIndex) {
  if (ref.indexOf("tools/") === 0 && hasSplitCtx) return true;
  // 表格行 = 单条记录（一行一个动词），动词可在路径之后 → 按整行判
  if (/^[ \t]*\|/.test(line)) return /新建|新文件|新增/.test(line);
  // 自有后置注记是最局部证据，且必须排在「改动族否决」之前——
  // 否则前一项的注记（如「（协议执行器改造）」）会沿着路径列举式的外层分隔符
  // 外溢，把后面所有项一并否决 = 假红（v1.5.3「涉及文件（预估）」实锤）。
  if (annoSaysNew(ownAnnotation(line, refIndex, ref))) return true;
  var pre = itemPrefix(line, refIndex);
  // 改动族优先否决——这是杀掉「新建 A；修改 B」假绿的关键一步
  if (/修改|扩展|升级|更新|改动|重构|改造|重写/.test(pre)) return false;
  // 项前缀里「新增」也算新建（项内只有一个动词，精度足够）
  if (/新建|新文件|待新建|新增/.test(pre)) return true;
  // 项内无动词（同义项组，如「…；单测 `x`、`y`」）→ 回落整行；
  // 回落只用无歧义的「新建/新文件」——「新增」在同句常与「修改」并列，回落会重新放宽假绿
  return /新建|新文件/.test(line);
}

// 非纯路径引用：URL（http:// 被目录正则误抓成"目录"）与含空白的内嵌命令/代码片段
function isNonPath(ref) {
  if (/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//.test(ref)) return true;
  if (ref.indexOf(" ") >= 0) return true;
  return false;
}

function lineCtx(line) {
  if (/修改|升级|更新|改动/.test(line)) return "modify";
  // v1.3.9 补：相对路径描述——行内含「相对/同目录/import ./」等语境词时，
  // 引用是描述「同目录内相对引用」（如 tools 分目录后 gen/ 内部 import ./gen-draft-lib.mjs），
  // 不是漏写前缀——bash 侧对 relative 上下文跳过「缺前缀」警告
  if (/相对|同目录|import \.\/|\.\.\//.test(line)) return "relative";
  return "plain";
}

var seen = {};

// 文件路径
lines.forEach(function(line) {
  var c = lineCtx(line);
  [...line.matchAll(F_RE)].forEach(function(m) {
    var p = m[1];
    // v1.3.9 补：剥离命令前缀——`bash tools/check-version.sh` 提取出纯路径（原实现把 bash/node 并进路径误报 ❌）
    p = p.replace(/^(?:bash|node|npx|sudo|npm) /, "");
    if (isNonPath(p)) {
      var ks = "S|" + p;
      if (!seen[ks]) { seen[ks] = 1; console.log("S|" + p); }
      return;
    }
    if (p.includes("/") && !p.includes("$") && !p.includes("{") &&
        !p.includes("*") && !p.includes("(") && !p.startsWith("~") && !p.match(/vX\.Y/)) {
      var k = "P|" + p;
      if (!seen[k]) {
        seen[k] = 1;
        var planned = isPlannedRef(p, line, m.index);
        console.log("P|" + p + "|" + (planned ? "planned" : c));
      }
    }
  });
});

// 函数名
seen = {};
lines.forEach(function(line) {
  var c = lineCtx(line);
  [...line.matchAll(N_RE)].forEach(function(m) {
    var f = m[1];
    var k = "F|" + f;
    if (!seen[k]) {
      seen[k] = 1;
      var planned = isPlannedRef(f, line, m.index);
      console.log("F|" + f + "|" + (planned ? "planned" : c));
    }
  });
});

// 目录
seen = {};
lines.forEach(function(line) {
  var c = lineCtx(line);
  [...line.matchAll(D_RE)].forEach(function(m) {
    var d = m[1];
    if (isNonPath(d)) {
      var ks = "S|" + d;
      if (!seen[ks]) { seen[ks] = 1; console.log("S|" + d); }
      return;
    }
    if (d.includes("/") && !d.includes("$") && !d.includes("{") &&
        !d.includes("*") && !d.includes("(") && !d.startsWith("~") && !d.match(/vX\.Y/)) {
      var k = "D|" + d;
      if (!seen[k]) {
        seen[k] = 1;
        var planned = isPlannedRef(d, line, m.index);
        console.log("D|" + d + "|" + (planned ? "planned" : c));
      }
    }
  });
});

// 快照标记：`<file>.md`（N 行）——dev prompt 头部常声明「派生自 changelog 的哪一版快照」，
// 该行数是手填字面量，changelog 一改就漂，且原三项检查只管代码路径不管行数 = 零门禁。
// 此处提取「路径 + 声明行数」，交 bash 侧与实际 wc -l 对账。
seen = {};
lines.forEach(function(line) {
  [...line.matchAll(L_RE)].forEach(function(m) {
    var p = m[1], n = m[2];
    if (!/\.md$/.test(p)) return;
    var k = "L|" + p;
    if (!seen[k]) {
      seen[k] = 1;
      console.log("L|" + p + "|" + n);
    }
  });
});
' "$FILE" > "$TMPFILE" 2> "$ERRFILE"
NODE_RC=$?

if [ "$NODE_RC" -ne 0 ]; then
  echo "❌ 引用提取器异常退出（RC=${NODE_RC}）——校验未完成，拒绝放行"
  sed -n '1,10p' "$ERRFILE"
  emit_coverage_line "check-dev-prompt" "0" "0" "0"
  exit 1
fi

# 提取结果为空已在提取器内自检（模式被改坏即 RC=3 退出）——此处不再按
# 「源文件含反引号」判空：合法文档（只含 `npm test`、`~/Desktop/` 等）本就
# 没有可提取引用，按反引号判空会把它误报成「提取失灵」。
# 真空提取的可见性由覆盖度行的 asserts=0 承担。

ERRORS=0
WARNINGS=0
PLANNED=0
OKS=0
SKIPPED=0

echo "=== check-dev-prompt: $(basename "$FILE") ==="
echo ""

# ─── 辅助函数 ───
check_prefix() {
  local clean="$1"
  for prefix in "engine/" "FORGE/" "tools/" "SKILL/" "FDE/" "docs/"; do
    if [ -e "${prefix}${clean}" ]; then
      echo "${prefix}"
      return 0
    fi
  done
  echo ""
  return 1
}

# 代码库路径索引（文件 + 目录），供后缀/同名反查用——一次扫描，避免逐引用 find
find engine tools FORGE SKILL FDE docs playbook \
  -not -path "*/node_modules/*" -not -path "*/dist/*" \
  \( -type f -o -type d \) 2>/dev/null | sort > "$IDXFILE"

# 按【路径后缀】反查：真实路径以 /<引用> 结尾 ⇒ 引用是跨多级简写（非错位）
suffix_hits() {
  local clean="${1%/}" pat
  pat="/$clean"
  awk -v s="$pat" -v n="${#pat}" \
    'length($0) > n && substr($0, length($0)-n+1) == s { print; c++; if (c >= 3) exit }' "$IDXFILE"
}

# 按【文件名】反查：真实路径末段与引用末段同名 ⇒ 路径写错位置（模块迁移/错位）
basename_hits() {
  local clean="${1%/}" base pat
  base="${clean##*/}"
  pat="/$base"
  awk -v s="$pat" -v n="${#pat}" \
    'length($0) > n && substr($0, length($0)-n+1) == s { print; c++; if (c >= 3) exit }' "$IDXFILE"
}

is_runtime() {
  case "$1" in
    data/audit/*|data/dashboard/*|data/forge-runs/*|data/reports/*|dashboard/*|data/*|.sofagent/*|knowledge/*|dream-sandbox/*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# ─── 0. 非纯路径引用（跳过）───
# G-2② 纪律：静默跳过必须显式化，否则「跳过」与「没查」不可区分
echo "--- 0. 非纯路径引用（URL / 内嵌命令，跳过）---"
while IFS='|' read -r tag ref || [ -n "$tag" ]; do
  [ "$tag" != "S" ] && continue
  [ -z "${ref:-}" ] && continue
  printf '  🔄 %s\n' "$ref"
  SKIPPED=$((SKIPPED + 1))
done < "$TMPFILE"
[ "$SKIPPED" -eq 0 ] && echo "  （无）"
echo ""

# ─── 1. 文件路径 ───
echo "--- 1. 文件路径引用 ---"

while IFS='|' read -r tag ref c || [ -n "$tag" ]; do
  c="${c:-plain}"
  [ "$tag" != "P" ] && continue
  [ -z "${ref:-}" ] && continue
  clean="${ref#./}"

  case "$clean" in
    node_modules/*|dist/*|docs/changelog/*) continue ;;
  esac

  # v1.3.9 补：is_runtime 接线——data/dashboard/、dream-sandbox/ 等运行时/产物路径标 🔄 跳过
  # （原实现定义了 is_runtime 但主循环未调用，导致 worklog.json 等运行时产物误报 ❌）
  if is_runtime "$clean"; then
    printf '  🔄 %s (运行时)\n' "$ref"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ -e "$clean" ]; then
    printf '  ✅ %s\n' "$ref"
    OKS=$((OKS + 1))
  else
    pfx=$(check_prefix "$clean")
    if [ -n "$pfx" ] && [ "$c" = "relative" ]; then
      # v1.3.9 补：相对路径描述（行含「相对/同目录」语境）——同目录内相对引用，非漏前缀，跳过
      printf '  ℹ️  %s (相对路径描述，跳过)\n' "$ref"
      SKIPPED=$((SKIPPED + 1))
    elif [ -n "$pfx" ]; then
      printf '  ⚠️  %s -> %s%s (缺前缀 %s)\n' "$ref" "$pfx" "$clean" "$pfx"
      WARNINGS=$((WARNINGS + 1))
    elif [ "$c" = "planned" ]; then
      printf '  📋 %s (待新建)\n' "$ref"
      PLANNED=$((PLANNED + 1))
    else
      sfx=$(suffix_hits "$clean")
      if [ -n "$sfx" ]; then
        # 引用是某真实路径的尾段（跨多级简写）——与前缀警告同类，非路径写错
        printf '  ⚠️  %s -> 缺前缀（实际位于 %s）\n' "$ref" "$(echo "$sfx" | tr '\n' ' ')"
        WARNINGS=$((WARNINGS + 1))
      else
        base=$(basename_hits "$clean")
        if [ -n "$base" ]; then
          # 🔴 模块迁移/错位：该处不存在但同名文件在别处——必须报错并点明去处，
          # 不得落「待新建」静默放行（历史实锤：train 拆包后旧路径 orchestrator/src/train/*）
          printf '  ❌ %s -> 路径错位（该处不存在，同名文件实际位于：%s）\n' "$ref" "$(echo "$base" | tr '\n' ' ')"
        else
          printf '  ❌ %s -> 文件不存在\n' "$ref"
        fi
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
done < "$TMPFILE"

echo ""

# ─── 2. 函数名 ───
echo "--- 2. 函数名引用 ---"

while IFS='|' read -r tag func c || [ -n "$tag" ]; do
  c="${c:-plain}"
  [ "$tag" != "F" ] && continue
  [ -z "${func:-}" ] && continue

  # 通用方法名（接口方法）：只检查是否在 interface 定义中出现
  case "$func" in
    create|cleanup|diff|init|run|start|stop|close|open)
      iface=$(grep -rl --include="*.ts" -E "${func}[[:space:]]*\([[:space:]]*\)[[:space:]]*:" engine/ 2>/dev/null | head -1 || true)
      if [ -n "$iface" ]; then
        printf '  ✅ %s() (interface method)\n' "$func"
        OKS=$((OKS + 1))
        continue
      fi
      ;;
  esac

  hits=$(grep -rl --include="*.ts" --include="*.sh" --include="*.mjs" \
    -E "(function ${func}[[:<:]])|(const ${func}[[:space:]]*=)|(${func}[[:space:]]*\([[:space:]]*\)[[:space:]]*\{)|(${func}[[:space:]]*\([[:space:]]*\)[[:space:]]*:.*\{)" \
    engine/ tools/ FORGE/src/ 2>/dev/null | head -1 || true)

  if [ -n "$hits" ]; then
    printf '  ✅ %s()\n' "$func"
    OKS=$((OKS + 1))
  elif [ "$c" = "planned" ]; then
    printf '  📋 %s() (待新建)\n' "$func"
    PLANNED=$((PLANNED + 1))
  else
    printf '  ❌ %s() -> 未找到定义\n' "$func"
    ERRORS=$((ERRORS + 1))
  fi
done < "$TMPFILE"

echo ""

# ─── 3. 目录 ───
echo "--- 3. 目录引用 ---"

while IFS='|' read -r tag ref c || [ -n "$tag" ]; do
  c="${c:-plain}"
  [ "$tag" != "D" ] && continue
  [ -z "${ref:-}" ] && continue
  clean="${ref#./}"

  case "$clean" in
    node_modules/*|dist/*|docs/changelog/*) continue ;;
  esac

  if is_runtime "$clean"; then
    printf '  🔄 %s (运行时目录，跳过)\n' "$ref"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ -d "$clean" ]; then
    printf '  ✅ %s\n' "$ref"
    OKS=$((OKS + 1))
  else
    pfx=$(check_prefix "$clean")
    if [ -n "$pfx" ] && [ -d "${pfx}${clean}" ]; then
      printf '  ⚠️  %s -> %s%s (缺前缀 %s)\n' "$ref" "$pfx" "$clean" "$pfx"
      WARNINGS=$((WARNINGS + 1))
    elif [ "$c" = "planned" ]; then
      printf '  📋 %s (待新建)\n' "$ref"
      PLANNED=$((PLANNED + 1))
    else
      sfx=$(suffix_hits "$clean")
      if [ -n "$sfx" ]; then
        printf '  ⚠️  %s -> 缺前缀（实际位于 %s）\n' "$ref" "$(echo "$sfx" | tr '\n' ' ')"
        WARNINGS=$((WARNINGS + 1))
      else
        base=$(basename_hits "$clean")
        if [ -n "$base" ]; then
          printf '  ❌ %s -> 路径错位（该处不存在，同名目录实际位于：%s）\n' "$ref" "$(echo "$base" | tr '\n' ' ')"
        else
          printf '  ❌ %s -> 目录不存在\n' "$ref"
        fi
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
done < "$TMPFILE"

echo ""

# ─── 4. 快照标记对账（行数） ───
echo "--- 4. 快照标记对账（行数）---"

SNAPSHOTS=0

while IFS='|' read -r tag ref n || [ -n "$tag" ]; do
  [ "$tag" != "L" ] && continue
  [ -z "${ref:-}" ] && continue
  clean="${ref#./}"
  cand="${clean/#\~/$HOME}"

  SNAPSHOTS=$((SNAPSHOTS + 1))

  if [ ! -f "$cand" ]; then
    printf '  ❌ %s -> 快照文件不存在（声明 %s 行）\n' "$ref" "$n"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  actual=$(wc -l < "$cand")
  actual="${actual// /}"

  if [ "$actual" = "$n" ]; then
    printf '  ✅ %s（%s 行 · 一致）\n' "$ref" "$n"
  else
    diff=$((actual - n))
    printf '  ❌ %s -> 声明 %s 行，实际 %s 行（差 %s）——改完日志记得同步这个快照标记\n' \
      "$ref" "$n" "$actual" "$diff"
    ERRORS=$((ERRORS + 1))
  fi
done < "$TMPFILE"

if [ "$SNAPSHOTS" -eq 0 ]; then
  echo "  （无快照标记，跳过）"
fi

echo ""

# ─── 汇总 ───
echo "=== 汇总 ==="
echo "  ✅ 一致: $OKS"
echo "  ❌ 错误: $ERRORS"
echo "  ⚠️  警告: $WARNINGS"
echo "  📋 待新建: $PLANNED"
echo "  🔄 跳过: $SKIPPED"

# 覆盖度口径（本脚本，G-2② 要求注明）：
#   asserts = 做出判定的引用数（✅一致 + ❌错误 + ⚠️缺前缀 + 📋待新建）
#   covered = 被读取的源文件数——本脚本单文件入口，恒为 1
#   skipped = 显式跳过的引用数（非纯路径 URL/内嵌命令 + 运行时目录 + 相对路径描述）
ASSERTS=$((OKS + ERRORS + WARNINGS + PLANNED))
emit_coverage_line "check-dev-prompt" "$ASSERTS" "1" "$SKIPPED"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ 发现 $ERRORS 个不匹配引用——开发 prompt 跟代码库不对齐"
  exit 1
else
  echo ""
  echo "✅ 所有已有代码引用与代码库一致"
  exit 0
fi
