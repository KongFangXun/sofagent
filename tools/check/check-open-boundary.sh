#!/usr/bin/env bash
# ============================================================
# check-open-boundary.sh · 开源/商业边界守卫（对标 wemux
#   scripts/open-core/public-boundary.mjs，2026-09-08 吸收）
#
# 门禁目的：商业产品名（私域产品名家族 / AIR）不得进入开源仓。
#   产品名按 **family** 匹配而非字面量：`Grap`/`Graph` + 可选空格 + `Hub`、`Flow` + 可选空格 + `Hub`，
#   且大小写不敏感。理由是实测教训——pattern 只写字面量时，一字之差即整条守卫失明：
#   曾有一处 `GraphHub`（比 pattern 的 `GrapHub` 多一个 `h`）落在活文档里，
#   守卫照常打印「零命中」放行。**判据：守的是"名字"这个 product，不是某个拼写。**
#   check-docs.sh §2c 只扫 45 个活文档白名单；本脚本补两个盲区：
#   ① 全仓 git tracked 文件（1480+ 个，含全部 .ts/.mjs/.sh 源码）
#   ② --staged 模式：只查暂存区新增/修改文件（PR 级拦截，同 wemux）
#
# AIR 分面断言：文档面（docs/ 活文档 + README* + 根 CHANGELOG + SKILL/ +
#   FDE/ + playbook/）全词匹配 FAIL——中文文档语境中独立词 AIR 只可能是
#   私有代号泄漏；源码层（三字母英文常量名）误报不可控，维持人工自查。
# CHANGELOG 豁免：历史事实档案（v1.4.4 记录了断言本身的落地），
#   与 check-docs §2c 豁免口径一致。
#
# 三态语义（对齐 check-storefront.sh）：PASS / FAIL / SKIP-可见。
#
# 用法：
#   bash tools/check/check-open-boundary.sh          # 全仓 tracked 扫描
#   bash tools/check/check-open-boundary.sh --staged # 只查暂存区变更文件
# EXIT 0 = 通过；EXIT 1 = 有泄漏；EXIT 2 = 脚本自身错误（守卫失明不得放行）
# ============================================================

cd "$(dirname "$0")/../.." || exit 2

# BSD 兼容：pattern 用 ERE；字面管道符在引号内无歧义
# family 覆盖四种拼写（GrapHub / GraphHub / Graph Hub / Grap Hub）+ 大小写变体。
# ⚠️ 残留风险（已披露）：`Graph Hub`（带空格变体）理论上可被「…Graph Hub…」这类
#    跨词相邻误命中（如某文档写 "Workflow Graph Hub"）。实测全仓 0 命中，
#    故当前无假阳性；若日后出现，按「先核实是否真泄漏、再决定收窄」处理，
#    不因噎废食退回字面量匹配（那是本次要修的缺陷本身）。
PATTERN='Grap[h]?[ ]?Hub|Flow[ ]?Hub'

# 豁免清单（历史事实档案 + 守卫自身——断言 pattern 里的字面量不是泄漏）。
# 实际豁免走两处 case 分支（staged/全仓），此处仅文档化口径：
#   ^\.git/ ^docs/changelog/ ^tools/check/check-docs\.sh$ ^tools/check/check-open-boundary\.sh$

# ── 模式分派 ──
if [ "$1" = "--staged" ]; then
  # staged 模式：只查暂存区新增/修改（PR 级拦截）
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "SKIP：非 git 仓库环境（--staged 需要 git）"
    exit 0
  fi
  STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
  if [ -z "$STAGED" ]; then
    echo "✅ staged 模式：暂存区无变更文件"
    exit 0
  fi
  HITS=""
  TOTAL=0
  SCANNED=0
  for f in $STAGED; do
    case "$f" in
      .git/*|docs/changelog/*|tools/check/check-docs.sh|tools/check/check-open-boundary.sh) continue ;;
    esac
    [ -f "$f" ] || continue
    TOTAL=$((TOTAL + 1))
    HIT=$(grep -niE "$PATTERN" "$f" 2>/dev/null || true)
    if [ -n "$HIT" ]; then
      HITS="$HITS
$f: $HIT"
    fi
    SCANNED=$((SCANNED + 1))
  done
  if [ -n "$HITS" ]; then
    echo "❌ 暂存区泄漏（${SCANNED} 个变更文件中命中）："
    printf "%s\n" "$HITS" | grep "." | head -20
    exit 1
  fi
  echo "✅ staged 模式：${SCANNED} 个变更文件零命中"
  exit 0
fi

# ── AIR 文档面断言（任务书 TASK-15 收编：文档面全词匹配，命中即红）──
# 面定义：docs/ 活文档（除 changelog/archive 历史档案）+ README* + 根 CHANGELOG
#        + SKILL/ + FDE/ + playbook/（含本文件自身的豁免仅限 GrapHub/FlowHub
#        主 pattern；AIR 文档面 pattern 字面量在 check-docs.sh / 本文件头注释，
#        均不在本断言扫描面内——check-docs.sh 2c 的 AIR 在 §2c 注释里，而该
#        文件整体豁免主 pattern；AIR 断言自身面不含 tools/，无自命中）
AIR_DOC_HITS=$(git ls-files -- 'docs/*.md' 'README*.md' 'CHANGELOG.md' 'SKILL/*.md' 'SKILL/rules/*.md' 'FDE/*.md' 'playbook/*.md' 2>/dev/null | grep -vE '^docs/(changelog|archive)/' | xargs grep -nwE "AIR" 2>/dev/null || true)
if [ -n "$AIR_DOC_HITS" ]; then
  echo "❌ AIR 文档面泄漏（私有商业代号不得进入开源文档）:"
  printf "%s\n" "$AIR_DOC_HITS" | head -10
  exit 1
fi

# ── 全仓模式（默认）──
if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "SKIP：git 不可用——全仓模式需要 git ls-files"
  exit 0
fi

TRACKED=$(git ls-files 2>/dev/null)
if [ -z "$TRACKED" ]; then
  echo "SKIP：无 tracked 文件（空仓或异常）"
  exit 0
fi

HITS=""
SCANNED=0
TOTAL_TRACKED=$(printf "%s\n" "$TRACKED" | grep -c "." || true)
TOTAL_TRACKED=${TOTAL_TRACKED:-0}

while IFS= read -r f; do
  case "$f" in
    .git/*|docs/changelog/*|tools/check/check-docs.sh|tools/check/check-open-boundary.sh) continue ;;
  esac
  # 二进制快速跳过：git 的 = 后缀标记或 file 探测
  if file "$f" 2>/dev/null | grep -qE "binary|Binary"; then
    continue
  fi
  [ -f "$f" ] || continue
  HIT=$(grep -niE "$PATTERN" "$f" 2>/dev/null || true)
  if [ -n "$HIT" ]; then
    HITS="$HITS
$f: $HIT"
  fi
  SCANNED=$((SCANNED + 1))
done <<EOF
$TRACKED
EOF

# ── F-38：公开面绝对家目录路径断言 ──
# 维护者机器路径（/Users/<name>/ 或 /home/<name>/）不得进公开仓——信息面
# （暴露本机布局/用户名）+ 专业形象双重成本。豁免面与产品名断言一致
# （冻结区 changelog/archive 的历史记述不回改）。
HOME_PATH_HITS=""
HOME_PATH_TOTAL=0
for f in $TRACKED; do
  case "$f" in
    .git/*|docs/changelog/*|docs/archive/*|tools/check/check-open-boundary.sh) continue ;;
    # F-38 测试面豁免：脱敏/路径解析类测试用占位家目录路径（/Users/johndoe/、
    # /home/alice/）做 fixture 属正当用法——断言抓的是「维护者机器路径外溢」，
    # 不是「任何家目录形状的字符串」。
    */__tests__/*|*.test.ts|*.spec.ts|*.test.mjs|*.test.js) continue ;;
  esac
  [ -f "$f" ] || continue
  HOME_PATH_TOTAL=$((HOME_PATH_TOTAL + 1))
  # 占位用户名白名单（与 A2 规则「占位符豁免」同款思路）：断言抓的是**真实**机器
  # 路径外溢；`/Users/xxx/`、`/home/user/` 这类形状说明/测试 fixture 属正当用法。
  # ⚠️ 已知权衡（显式登记）：白名单里的通用词（dev/test/name/me 等）若恰是真实
  # 用户名则漏检——判断是「通用词做占位」远多于「真名恰为通用词」，故取此权衡；
  # 若日后确证某白名单词出现真实外溢，从本表移除该词即可（豁免表可审可改）。
  HIT=$(grep -nE "(^|[^[:alnum:]_])/(Users|home)/[A-Za-z0-9._-]+/" "$f" 2>/dev/null \
    | grep -vE "/(Users|home)/(user|users|xxx|yyy|johndoe|jane|alice|bob|admin|example|youruser|your-user|username|me|someone|foo|bar|test|tester|dev|developer|name|someoneelse|runner)/" \
    || true)
  if [ -n "$HIT" ]; then
    HOME_PATH_HITS="$HOME_PATH_HITS
$f: $HIT"
  fi
done
if [ -n "$HOME_PATH_HITS" ]; then
  echo "❌ 公开面家目录路径外溢（F-38）：tracked 文件含本机绝对家目录路径"
  printf "%s\n" "$HOME_PATH_HITS" | grep "." | head -10
  echo "   修法：替换为 ~/ 或仓相对路径（语义不变，去机器指纹）"
  exit 1
fi
echo "✅ 公开面家目录路径断言：${HOME_PATH_TOTAL} 个文件扫描，绝对家目录路径零命中（冻结区豁免）"
echo ""

if [ -n "$HITS" ]; then
  echo "❌ 开源边界违规：tracked 文件存在商业产品名（私域产品名家族）"
  printf "%s\n" "$HITS" | grep "." | head -20
  exit 1
fi

echo "✅ 开源边界守卫：${SCANNED}/${TOTAL_TRACKED} 个 tracked 文件扫描，产品名家族（Grap/Graph+Hub · Flow+Hub）零命中"
echo "   （AIR 文档面断言在线；CHANGELOG 历史档案豁免）"
exit 0
