#!/bin/bash
# check-cjk-var.sh — shell 变量定界守卫
# 检测 tools/ 下所有 .sh（含子目录）中 $VAR 后紧跟非 ASCII 字符的模式。
#
# 根因：bash 在 UTF-8 locale 下把 ${TEST_RC}， 解析成变量名 "TEST_RC，"
# （全角逗号 U+FF0C 被拼进变量名），set -u 下报 unbound variable 崩溃。
# v1.3.6 实案：pre-push-check.sh:189 潜伏一个月（07-19 b58c6aba 引入），
# 仅在「测试失败分支」触发，日常全绿掩盖了它。08-18 修复（3ec97569）。
# v1.3.9 实案：check-docs.sh:622（${pmf}：——全角冒号 U+FF1A 同族），引入于
# v1.3.9 目录重组后的新增检查（ba74ae10），同样只在「对账不等分支」触发。
# 2026-08-29 修复守卫自身失明：v1.3.9 目录重组把 check 脚本移入 tools/check/
# 等子目录，本守卫 glob 仍扫 tools/*.sh 顶层——19 个子目录脚本全部漏扫，
# 622 行违规因此未被拦截。改为 find 递归 + SELF 路径同步 + \s 改 POSIX 类。
#
# 规则：变量后接非 ASCII 字符必须写成 ${VAR} 显式定界。
# 用法：bash tools/check/check-cjk-var.sh  →  输出违规清单，exit 0=全绿 / 1=有违规

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

# 判据：$VAR 后紧跟【非 ASCII 字符】即违规，一律改写为 ${VAR} 显式定界。
# 为什么不列一张「全角标点表」：实测 bash 在 UTF-8 locale 下会把紧跟变量名的
#   **任何**非 ASCII 字符拼进变量名——全角标点、全角字母数字、CJK 汉字、假名、
#   谚文、emoji、组合音标、不换行空格、制表符线、★✓ 等符号，无一例外（跨平面
#   抽检 18 个，仅希伯来字母因书写方向未被本探针复现）。逐个枚举永远补不全，
#   真正的边界是「ASCII / 非 ASCII」，不是「标点 / 非标点」。
# 危害形态：变量静默展开为空（无 set -u 时不报错，只在输出里丢值）；且常藏在
#   「仅失败分支触发」的输出行里，日常全绿时掩盖，一旦触发恰好在最该显示数字的
#   地方丢数字。该 bug 在 US-ASCII locale 与 zsh 下都不复现，随手一测极易被
#   误判成误报——判定时必须先确认 locale 与 shell 是 UTF-8 + bash。
# 修法：$VAR → ${VAR}。已定界的 ${VAR}、引号闭合后的 "$VAR"、后接空格的 $VAR
#   均不误报。
# 已知误报面：单引号内的 '${VAR}中' 不参与展开，本守卫仍会报——本守卫宁可误报
#   （人工复核）也不漏报（潜伏地雷代价更高）。
# 注意：用 perl 而非 grep -P（BSD grep 无 -P）；且必须 -Mutf8 -CSD，否则字符类
#   按**字节**匹配——覆盖面取决于各字符首字节是否碰巧撞进集合，是随机且不可
#   预测的漏检（曾出现「（」只因与「）」共享前两字节才被命中的假覆盖）。
PATTERN='\$[A-Za-z_][A-Za-z_0-9]*[^\x00-\x7F]'
SELF="tools/check/check-cjk-var.sh"
# 兼容 ./ 前缀路径（find 流输出 ./xxx 形态；sed 已归一，此处双形态防御防回退）

VIOLATIONS=0
FILES=0

# find 递归收集全仓 .sh（历史上本守卫只扫 tools/，同理失明过两次：v1.3.9 目录
# 重组把脚本移入子目录、顶层 glob 漏扫 19 个；此后仍有 playbook/ 与仓根脚本在面外）。
# 本次扩面的直接动因是一枚真实事故：playbook/acceptance-test.sh 的两处 $VAR 后紧跟
# 全角字符，都藏在「仅失败分支输出」的行里，日常全绿掩盖；一旦该断言真失败，
# set -u 下变量名被拼成 "f<0xE3>" → unbound variable → **整个验收脚本当场崩掉**，
# 且崩的是「本该报 FAIL」的那一行——失败表现得比失败本身更糟。
# 扫描面（v1.5.2 A-9 重构）：git ls-files 圈定「会被 bash 执行的文件」——
# 判据 = 首行 shebang 匹配 bash|sh|zsh **或** 可执行位（-x）。扩展名不再是
# 「会被 bash 执行」的充分条件：engine/audit/hooks/{pre-commit,post-commit,
# commit-msg}（无扩展名、每次 commit 真正执行）与 *.command 文件此前全在
# 视野外（第四轮 P1-5：`find -name "*.sh"` 对它们零命中）。
# 排除面不变：node_modules / dist / .git / 本脚本自检豁免。
ALL_SH=$(
  {
    git ls-files
    find . -name "*.sh" -type f \
      -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "./.git/*"
  } | LC_ALL=C sort -u | sed 's|^\./||' | grep -vE '(^|/)(node_modules|dist|\.git)/' | while IFS= read -r _f; do
      # 存在性（git ls-files 在文件被删未提交时仍列出）
      [ -f "$_f" ] || continue
      # 判据一：首行 shebang ^#! 含 bash|sh|zsh
      if head -n 1 "$_f" 2>/dev/null | grep -qE '^#!.*((ba)?sh|zsh)'; then
        printf '%s\n' "$_f"
        continue
      fi
      # 判据二：可执行位（hook 无扩展名、.command 双击执行——bash 语义执行面）
      if [ -x "$_f" ]; then
        printf '%s\n' "$_f"
        continue
      fi
      # 既无 shell shebang 又不可执行（含 .sh 扩展名但不执行的纯文本）——不在执行面
    done
)
GUARDS_VIOL=0
for f in $ALL_SH; do
  # 自检豁免：本脚本展示规则的文案行（含 \$VAR 字面量教学）不违规
  case "$f" in "$SELF"|./"$SELF") continue ;; esac
  FILES=$((FILES + 1))
  # 跳过纯注释行（行首 # 后的 $VAr 讲解不违规）
  # v1.4.6 修报号错位：此前先 `grep -v` 剔注释再交给 perl，perl 的 $. 取的是
  #   **过滤后流**里的行号而非文件行号——check-storefront.sh 一处违规被报成
  #   「49:」而实际在第 77 行，排查时按 49 行看到的是完全无关的代码，已实际
  #   造成一次误判。改为 perl 直接读原文件、在正则里排注释行，$. 即真实行号。
  MATCHES=$(perl -Mutf8 -CSD -ne "print \"\$.: \$_\" if /$PATTERN/ && !/^\\s*#/" "$f" 2>/dev/null)
  if [ -n "$MATCHES" ]; then
    echo "✗ $f"
    echo "$MATCHES" | sed 's/^/    /'
    VIOLATIONS=$((VIOLATIONS + $(echo "$MATCHES" | wc -l | tr -d ' ')))
  fi
done
# 失明防御对账：perl 引擎自身故障（无 perl / locale 崩）会静默输出空——空输出≠零违规。
# 自检样本必含一处违规模式（$no_such_var 后跟全角逗号），引擎健康时 perl 必输出 HIT。
PERL_ALIVE=$(printf 'X$no_such_var，' | perl -ne "print \"HIT\" if /$PATTERN/" 2>/dev/null || true)
if [ "$PERL_ALIVE" != "HIT" ]; then
  echo "✗ perl 检测引擎自身故障（自检样本未命中）——空结果不可信，按违规处理"
  GUARDS_VIOL=1
fi

echo ""
# 失明必须失声：引擎自身故障与真违规同样阻断——否则「零违规」可能只是「引擎瞎了」，
# 防线失明时却假装还在岗，比没有这条防线更危险。
# 输出口径：扫描文件数一律写成「N 个文件扫描」，三条退出路径同一措辞——消费方
#   （check-guards ④ 扫描范围对账）按这一条 token 提取。同一事实两套措辞曾使提取在
#   违规分支落空，于是真因被误报为「守卫失明（glob 未跟随目录重组）」，归因完全错。
if [ "$VIOLATIONS" -gt 0 ] || [ "$GUARDS_VIOL" -ne 0 ]; then
  if [ "$VIOLATIONS" -gt 0 ]; then
    echo "✗ ${VIOLATIONS} 处非 ASCII 字符紧跟 \${VAR}（${FILES} 个文件扫描）——改为 \${VAR} 定界后重跑"
  else
    echo "✗ 0 处违规但守卫自身失明（${FILES} 个文件扫描）——上述引擎故障必须先修复，本次按违规处理"
  fi
  exit 1
else
  echo "✓ ${FILES} 个文件扫描，无非 ASCII 字符紧跟 \$VAR 的定界违规"
  exit 0
fi
