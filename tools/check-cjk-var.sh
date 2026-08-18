#!/bin/bash
# check-cjk-var.sh — shell 变量定界守卫
# 检测 tools/*.sh 中 $VAR 后紧跟 CJK 全角标点的模式。
#
# 根因：bash 在 UTF-8 locale 下把 $TEST_RC， 解析成变量名 "TEST_RC，"
# （全角逗号 U+FF0C 被拼进变量名），set -u 下报 unbound variable 崩溃。
# v1.3.6 实案：pre-push-check.sh:189 潜伏一个月（07-19 b58c6aba 引入），
# 仅在「测试失败分支」触发，日常全绿掩盖了它。08-18 修复（3ec97569）。
#
# 规则：变量后接 CJK 标点必须写成 ${VAR} 显式定界。
# 用法：bash tools/check-cjk-var.sh  →  输出违规清单，exit 0=全绿 / 1=有违规

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# 全角标点集：，）。（：；！？、「」『』
# 注意：用 perl 而非 grep -P（BSD grep 无 -P）；排除注释行与双引号内误报优先级低——
# 本守卫宁可误报（人工复核）也不漏报（潜伏地雷代价更高）
# 自检豁免：本脚本自身在输出规则文案时需要展示 \$VAR 字面量，属有意为之
PATTERN='\$[A-Za-z_][A-Za-z_0-9]*[，）。：；！？、]'
SELF="tools/check-cjk-var.sh"

VIOLATIONS=0
FILES=0

for f in tools/*.sh; do
  [ -f "$f" ] || continue
  # 自检豁免：本脚本展示规则的文案行（含 \$VAR 字面量教学）不违规
  [ "$f" = "$SELF" ] && continue
  FILES=$((FILES + 1))
  # 跳过纯注释行（行首 # 后的 $VAR 讲解不违规）
  MATCHES=$(grep -vE '^\s*#' "$f" | perl -ne "print \"$.: \$_\" if /$PATTERN/" 2>/dev/null)
  if [ -n "$MATCHES" ]; then
    echo "✗ $f"
    echo "$MATCHES" | sed 's/^/    /'
    VIOLATIONS=$((VIOLATIONS + $(echo "$MATCHES" | wc -l | tr -d ' ')))
  fi
done

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "✗ ${VIOLATIONS} 处 CJK 标点紧跟 \$VAR（${FILES} 个文件扫描）——改为 \${VAR} 定界后重跑"
  exit 1
else
  echo "✓ $FILES 个 shell 脚本无 CJK 标点变量定界违规"
  exit 0
fi
