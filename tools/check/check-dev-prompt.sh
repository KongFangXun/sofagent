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
#
# 智能标记：
#   📋 同行含「新建」→ 待新建，不计错误
#   🔄 运行时目录（data/ .sofagent/）→ 跳过
#   ⚠️ 路径缺前缀（engine/ FORGE/ 等）→ 警告
#   ❌ 引用不存在且非新建 → 错误
# ============================================================

set -o pipefail

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
  exit 1
fi

# 提取引用到临时文件（Node.js 做提取比 sed/grep 健壮）
TMPFILE=$(mktemp /tmp/check-dev-prompt.XXXXXX)
trap 'rm -f "$TMPFILE"' EXIT

# 🔴 v1.2.6 修复：NODE 未设置时 "$NODE" 展开为空 → node 步骤静默失败 →
# TMPFILE 为空 → 三项检查全跳过 = 虚假绿色（零 ❌ 但实际什么都没查）。
NODE="${NODE:-node}"
if ! command -v "$NODE" &>/dev/null; then
  echo "❌ 找不到 node 可执行文件（NODE=${NODE}）——无法校验引用"
  exit 1
fi

"$NODE" -e '
var fs = require("fs");
var c = fs.readFileSync(process.argv[1], "utf8");
var lines = c.split("\n");

// 文件级上下文：如果某个路径在文件中任何一行与"新建"同时出现，标 planned
function isPlannedGlobally(path) {
  // v1.3.9 补：结构上下文——全文声明「分目录/物理分子/目标结构」时，tools/ 下不存在的路径视为待新建
  // （tools/ 物理分子目录交付前，目标路径如 tools/check/check-version.sh 尚不存在，但属本版规划产物）
  if (path.indexOf("tools/") === 0) {
    for (var i = 0; i < lines.length; i++) {
      if (/分目录|物理分子|目标结构/.test(lines[i])) return true;
    }
  }
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(path) >= 0 && /新建|新文件|\*\*新建\*\*/.test(lines[i])) return true;
  }
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
  [...line.matchAll(/`([^`]*\.(?:ts|sh|mjs|json|yml))`/g)].forEach(function(m) {
    var p = m[1];
    // v1.3.9 补：剥离命令前缀——`bash tools/check-version.sh` 提取出纯路径（原实现把 bash/node 并进路径误报 ❌）
    p = p.replace(/^(?:bash|node|npx|sudo|npm) /, "");
    if (p.includes("/") && !p.includes("$") && !p.includes("{") &&
        !p.includes("*") && !p.includes("(") && !p.startsWith("~") && !p.match(/vX\.Y/)) {
      var k = "P|" + p;
      if (!seen[k]) {
        seen[k] = 1;
        var planned = isPlannedGlobally(p);
        console.log("P|" + p + "|" + (planned ? "planned" : c));
      }
    }
  });
});

// 函数名
seen = {};
lines.forEach(function(line) {
  var c = lineCtx(line);
  [...line.matchAll(/`([a-zA-Z_][a-zA-Z0-9_]*)\(\)`/g)].forEach(function(m) {
    var f = m[1];
    var k = "F|" + f;
    if (!seen[k]) {
      seen[k] = 1;
      var planned = isPlannedGlobally(f);
      console.log("F|" + f + "|" + (planned ? "planned" : c));
    }
  });
});

// 目录
seen = {};
lines.forEach(function(line) {
  var c = lineCtx(line);
  [...line.matchAll(/`([^`]*\/)`/g)].forEach(function(m) {
    var d = m[1];
    if (d.includes("/") && !d.includes("$") && !d.includes("{") &&
        !d.includes("*") && !d.includes("(") && !d.startsWith("~") && !d.match(/vX\.Y/)) {
      var k = "D|" + d;
      if (!seen[k]) {
        seen[k] = 1;
        var planned = isPlannedGlobally(d);
        console.log("D|" + d + "|" + (planned ? "planned" : c));
      }
    }
  });
});
' "$FILE" > "$TMPFILE" 2>/dev/null

ERRORS=0
WARNINGS=0
PLANNED=0

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

is_runtime() {
  case "$1" in
    data/audit/*|data/dashboard/*|data/forge-runs/*|data/reports/*|dashboard/*|data/*|.sofagent/*|knowledge/*|dream-sandbox/*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

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
    continue
  fi

  if [ -e "$clean" ]; then
    printf '  ✅ %s\n' "$ref"
  else
    pfx=$(check_prefix "$clean")
    if [ -n "$pfx" ] && [ "$c" = "relative" ]; then
      # v1.3.9 补：相对路径描述（行含「相对/同目录」语境）——同目录内相对引用，非漏前缀，跳过
      printf '  ℹ️  %s (相对路径描述，跳过)\n' "$ref"
    elif [ -n "$pfx" ]; then
      printf '  ⚠️  %s -> %s%s (缺前缀 %s)\n' "$ref" "$pfx" "$clean" "$pfx"
      WARNINGS=$((WARNINGS + 1))
    elif [ "$c" = "planned" ]; then
      printf '  📋 %s (待新建)\n' "$ref"
      PLANNED=$((PLANNED + 1))
    else
      printf '  ❌ %s -> 文件不存在\n' "$ref"
      ERRORS=$((ERRORS + 1))
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
      iface=$(grep -rl --include="*.ts" -E "${func}\s*\(\s*\)\s*:" engine/ 2>/dev/null | head -1 || true)
      if [ -n "$iface" ]; then
        printf '  ✅ %s() (interface method)\n' "$func"
        continue
      fi
      ;;
  esac

  hits=$(grep -rl --include="*.ts" --include="*.sh" --include="*.mjs" \
    -E "(function ${func}\b)|(const ${func}\s*=)|(${func}\s*\(\s*\)\s*\{)|(${func}\s*\(\s*\)\s*:.*\{)" \
    engine/ tools/ FORGE/src/ 2>/dev/null | head -1 || true)

  if [ -n "$hits" ]; then
    printf '  ✅ %s()\n' "$func"
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
    continue
  fi

  if [ -d "$clean" ]; then
    printf '  ✅ %s\n' "$ref"
  else
    pfx=$(check_prefix "$clean")
    if [ -n "$pfx" ] && [ -d "${pfx}${clean}" ]; then
      printf '  ⚠️  %s -> %s%s (缺前缀 %s)\n' "$ref" "$pfx" "$clean" "$pfx"
      WARNINGS=$((WARNINGS + 1))
    elif [ "$c" = "planned" ]; then
      printf '  📋 %s (待新建)\n' "$ref"
      PLANNED=$((PLANNED + 1))
    else
      printf '  ❌ %s -> 目录不存在\n' "$ref"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done < "$TMPFILE"

echo ""

# ─── 汇总 ───
echo "=== 汇总 ==="
echo "  ❌ 错误: $ERRORS"
echo "  ⚠️  警告: $WARNINGS"
echo "  📋 待新建: $PLANNED"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ 发现 $ERRORS 个不匹配引用——开发 prompt 跟代码库不对齐"
  exit 1
else
  echo ""
  echo "✅ 所有已有代码引用与代码库一致"
  exit 0
fi
