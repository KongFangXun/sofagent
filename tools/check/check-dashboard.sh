#!/usr/bin/env bash
# ============================================================
# check-dashboard.sh · dashboard.html 结构性缺陷门禁
# ============================================================
# 门禁目的：dashboard.html 是 2900+ 行单文件（CSS+HTML+JS 混合），历史上
#   出过一类「写时无感、看时才发现」的结构性缺陷：
#     ① 双 class 属性——浏览器只认第一个，第二个静默失效
#        （实锤：`class="ellipsis" class="title12"` 导致标题加粗从未生效）
#     ② 未定义 CSS 变量——var(--ok) 落到 fallback，fallback 色不在色板
#        （实锤：治理页 approved/rejected 用 var(--ok,#16a34a)）
#     ③ 重复类定义——同名类两处定义且定义体不一致时，后者覆盖前者，
#        语义取决于 CSS 顺序而非书写意图
#     ④ 引用未定义 keyframes——animation 引用的动画帧不存在，动效静默失效
#     ⑤ onclick 引用未定义函数——点击无反应，控制台报错用户无感
#     ⑥ div 不配平——DOM 嵌套错位（后续 section 嵌进前一个）
#     ⑦ U+FFFD 乱码——编码损坏字符入库
#   共性：全部是「静默失效」形态——页面能开、不报错、功能/样式悄悄丢。
#   本脚本把这类缺陷变成发版前机械拦截。
#
# 🔴 设计原则（对齐 check-readme-parity）：
#   - 只断言**可机械判定**的结构面，不判设计美感/交互体验（那是
#     docs/guides/frontend-design-standard.md + 人工审查的职责）
#   - 假阳性纪律：宁缺毋滥——模式收窄到实锤形态，误报即收窄
#
# 与既有守卫的关系（不重复造轮子）：
#   - regression-checklist #128 d：只锁「版本单源 + 无 scrollTop」，本脚本全量
#   - check-version：锁 .logo-version 角标值，不锁结构
#   - 本脚本不查版本号、不查颜色规范（颜色规范靠设计文档人工审）
#
# 用法：bash tools/check/check-dashboard.sh
# 退出码：0 = 七项全过 / 1 = 有缺陷 / 2 = 脚本自身错误
# ============================================================

set -uo pipefail

_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

REPO_ROOT="$(cd "${_SELF_DIR}/../.." && pwd)"
HTML="${REPO_ROOT}/tools/dashboard/dashboard.html"

FAILS=0
ASSERTS=0
SKIPS=0

if [ ! -f "$HTML" ]; then
  echo "❌ ${HTML} 不存在——脚本自身错误（路径失效）"
  exit 2
fi

# ── ① 双 class 属性（含中间隔其他属性的形态——相邻模式会漏）──
# 手法：逐标签提取，单标签内 class= 出现 >1 次即 FAIL。
# 用 awk 而非 grep：标签可跨属性含 >，awk 按标签边界切分更稳。
ASSERTS=$((ASSERTS + 1))
DOUBLE_CLASS=$(awk '
{
  # 按 "<" 切出标签段（粗粒度——JS 字符串拼接里的 <xxx 也会被扫到，
  # 这是刻意的：拼接产物同样进 DOM，同样会双 class 失效）
  n = split($0, segs, /</)
  for (i = 2; i <= n; i++) {
    seg = segs[i]
    # 标签段到第一个 ">" 或行尾为止
    sub(/>.*/, "", seg)
    cnt = gsub(/class=/, "class=", seg)
    if (cnt > 1) print NR ": <" seg
  }
}' "$HTML")
if [ -n "$DOUBLE_CLASS" ]; then
  echo "  ❌ [①双class] 以下标签含多个 class 属性（后者静默失效）："
  echo "$DOUBLE_CLASS" | sed 's/^/     /'
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [①双class] 无双 class 属性标签"
fi

# ── ② 未定义 CSS 变量 ──
# 定义面：`:root{--x:...}` 与任意规则体内的 `--x:` 自定义属性；
# 使用面：var(--x) 引用。使用集 − 定义集 = 未定义。
# 已知例外：var(--x, fallback) 带 fallback 的引用是刻意的降级设计，
# 仍要求变量已定义（本仓 CSS 变量全部集中在 :root，无运行时注入面）。
ASSERTS=$((ASSERTS + 1))
UNDEF_VARS=$(perl -0777 -ne '
  my %defined;
  while (/(--[a-zA-Z0-9-]+)\s*:/g) { $defined{$1} = 1; }
  my %used;
  while (/var\((--[a-zA-Z0-9-]+)/g) { $used{$1} = 1; }
  for my $v (sort keys %used) {
    print "$v\n" unless $defined{$v};
  }
' "$HTML")
if [ -n "$UNDEF_VARS" ]; then
  echo "  ❌ [②未定义变量] var() 引用了未定义的 CSS 变量（将落 fallback/初始值）："
  echo "$UNDEF_VARS" | sed 's/^/     /'
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [②未定义变量] var() 引用全部有定义"
fi

# ── ③ 重复类定义（同名选择器两处定义且定义体不一致 = 覆盖隐患）──
# 只报「定义体不一致」的重复——完全相同的重复属整洁问题不阻断
#（收编时留一门：报告相同重复但不计入 FAILS，见输出提示）。
ASSERTS=$((ASSERTS + 1))
DUP_DIFF=$(perl -0777 -ne '
  my %defs;
  while (/^\.([a-zA-Z0-9_-]+)\{([^}]*)\}/mg) {
    push @{$defs{$1}}, $2;
  }
  for my $c (sort keys %defs) {
    my %uniq;
    $uniq{$_} = 1 for @{$defs{$c}};
    print "$c\n" if scalar(keys %uniq) > 1;
  }
' "$HTML")
if [ -n "$DUP_DIFF" ]; then
  echo "  ❌ [③重复类定义] 以下类多处定义且定义体不一致（覆盖顺序敏感）："
  echo "$DUP_DIFF" | sed 's/^/     /'
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [③重复类定义] 无定义体不一致的重复类"
fi

# ── ④ animation 引用未定义 keyframes（两遍法：先收集全部定义再比对使用）──
ASSERTS=$((ASSERTS + 1))
MISSING_KF=$(perl -0777 -ne '
  my %kf;
  while (/@keyframes\s+([a-zA-Z0-9-]+)/g) { $kf{$1} = 1; }
  my %used;
  while (/animation:\s*([a-zA-Z0-9-]+)/g) { $used{$1} = 1; }
  for my $n (sort keys %used) {
    print "$n\n" unless $kf{$n};
  }
' "$HTML")
if [ -n "$MISSING_KF" ]; then
  echo "  ❌ [④缺keyframes] animation 引用了未定义的 @keyframes："
  echo "$MISSING_KF" | sed 's/^/     /'
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [④缺keyframes] animation 引用全部有定义"
fi

# ── ⑤ onclick 引用未定义函数 ──
# 定义面：function name( / const name = （含箭头函数赋值）；
# JS 字符串拼接里的 onclick 同样计入（拼接产物进 DOM）。
ASSERTS=$((ASSERTS + 1))
MISSING_FN=$(perl -0777 -ne '
  my %fns;
  while (/\bfunction\s+([a-zA-Z0-9_]+)\s*\(/g) { $fns{$1} = 1; }
  while (/\b(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\()/g) { $fns{$1} = 1; }
  while (/\b([a-zA-Z0-9_]+)\s*:\s*function/g) { $fns{$1} = 1; }
  my %handlers;
  while (/onclick=\\"?([a-zA-Z0-9_]+)\(/g) { $handlers{$1} = 1; }
  while (/onclick="([a-zA-Z0-9_]+)\(/g) { $handlers{$1} = 1; }
  for my $h (sort keys %handlers) {
    print "$h\n" unless $fns{$h};
  }
' "$HTML")
if [ -n "$MISSING_FN" ]; then
  echo "  ❌ [⑤onclick未定义] onclick 引用了未定义的 JS 函数（点击无反应）："
  echo "$MISSING_FN" | sed 's/^/     /'
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [⑤onclick未定义] onclick 引用全部有定义"
fi

# ── ⑥ div 配平 ──
ASSERTS=$((ASSERTS + 1))
DIV_OPEN=$(grep -o '<div\b' "$HTML" | wc -l | tr -d ' ')
DIV_CLOSE=$(grep -o '</div>' "$HTML" | wc -l | tr -d ' ')
if [ "$DIV_OPEN" != "$DIV_CLOSE" ]; then
  echo "  ❌ [⑥div配平] <div> ${DIV_OPEN} 个 vs </div> ${DIV_CLOSE} 个——嵌套错位"
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [⑥div配平] <div>/</div> 各 ${DIV_OPEN} 个配平"
fi

# ── ⑦ U+FFFD 乱码 ──
# ⚠️ 必须 -CSD 开 UTF-8 层：默认字节流模式下 \x{FFFD} 匹配不到 UTF-8 三字节
#    序列 EF BF BD（实测注入后静默通过——fail-silent 教训）
ASSERTS=$((ASSERTS + 1))
FFFD_COUNT=$(perl -CSD -ne '$c += () = /\x{FFFD}/g; END { print $c+0 }' "$HTML" 2>/dev/null)
[ -z "$FFFD_COUNT" ] && FFFD_COUNT=0
if [ "$FFFD_COUNT" != "0" ]; then
  echo "  ❌ [⑦乱码] 检出 ${FFFD_COUNT} 个 U+FFFD 替换字符（编码损坏）"
  FAILS=$((FAILS + 1))
else
  echo "  ✓ [⑦乱码] 无 U+FFFD 替换字符"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$FAILS" -gt 0 ]; then
  echo "  FAIL=${FAILS}——dashboard.html 存在结构性缺陷（全部为静默失效形态）"
  echo "  🔴 修复请改 dashboard.html 本体，禁止为转绿而放宽本脚本断言"
else
  echo "  FAIL=0——七项结构检查通过"
fi
# ── 覆盖度行（v1.4.9 G-2② 范式）──
# covered 口径：单文件全量扫描，covered=1
emit_coverage_line "check-dashboard" "$ASSERTS" "1" "$SKIPS"
if [ "$FAILS" -gt 0 ]; then
  exit 1
else
  exit 0
fi
