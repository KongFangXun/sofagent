#!/usr/bin/env bash
# ============================================================
# doc-discipline.sh · 对外文档写作纪律门禁（v1.4.9 P2-27）
# ------------------------------------------------------------
# 依据：CONTRIBUTING.md 已成的写作纪律两份——
#   ①「changelog 是对外公开文档，不写人名、内部私有路径、内部工单/审查代号」（三条 bullet）
#   ②「来源块溯源规范」（来源块只写作品名 + 链接 + 原文发布日）
#   本门禁把其中**正则可判定**的面收进 CI，从「人工记得」升级为「机器拦得住」。
#
# 自测（红不了的门禁是装饰品）：注入违规应看到命中并 exit 1——
#   printf '\n> 📖 来源：某某（内部复盘，2026-01-01）\n' >> README.md && \
#     bash tools/check/doc-discipline.sh; echo "rc=$?"; git checkout -- README.md
#
# 🔴 扫描面（对外主文档）：根级 *.md + docs/**/*.md，减去下面两类豁免：
#   · 装置面 CONTRIBUTING.md —— 纪律定义必须**引用被禁模式本身**，否则本守卫无法
#     定义它要禁的东西（同 tools/check/check-legacy-knowledge-path.mjs 的装置面口径）。
#   · 历史冻结区 docs/changelog/**、docs/archive/**、docs/evidence/** —— 历史事实，
#     改之 = 篡改（同 P1-14 旧路径断言的历史冻结区口径）。
#
# ⚠️ 范围诚实披露：CONTRIBUTING「changelog 写作规范」的本义是**changelog** 的写作纪律，而 changelog
#   全量含历史工单代号（v1.4.9 及更早各版开发日志皆然），纳入判定面会立即全红、
#   且只能靠篡改历史才变绿。故本门禁**不把 changelog 纳入判定面**，该条维持人工 SOP
#   （CONTRIBUTING 已明示）。本门禁判定的是「对外主文档」这一扩大的、可自动化的面。
#
# Face 1 内部工单 / 审查代号：F-xx / P0-xx / P1-xx / P2-xx / P3-xx / D-n / G-n
#   （形态取自 CONTRIBUTING「changelog 写作规范」的示例 `F-XX` / `P0-XX` / `FLAG-X`）
# Face 2 本机私有路径：/Users/<name>/ · /home/<name>/ · ~/Desktop/ · ~/Documents/
#   ⚠️ 刻意**不**把 ~/.sofagent/ 之类「产品家目录」计入——它是文档需要写的配置路径，
#      不是维护者私有路径。只拦「别人机器上才存在」的绝对用户路径。
# Face 3 来源块溯源纪律（`> 📖/📐 来源：` 行，纪律本体见 CONTRIBUTING.md「来源块溯源规范」）：
#   3a 阻断级——来源块内出现内部流程 / 内部产物名（内部会议纪要、内部复盘…）。
#      内部件没有公开出处，写进溯源块就是对读者的虚假溯源；该类零假阳性，命中即红。
#   3b 存量台账——缺链接 / 缺原文发布日，逐文件计数与 tools/check/source-block-exempt.txt
#      **集合相等**（同 knowledge-legacy-path-exempt.json 家族）。新增即红；清理后
#      未同步台账同样红——清存量是可见动作，必须让 diff 记录「债减少」。
#
# 退出码契约（对齐本仓 check-* 家族）：
#   0 = 绿 / 1 = 有命中（违规）/ 2 = 检查器失明（扫描面为空 ⇒ 拒绝把「读不到」当「零违规」）
# ============================================================
set -uo pipefail

cd "$(dirname "$0")/../.." 2>/dev/null || true
ROOT="$(pwd)"

FILES=$(git ls-files '*.md' 2>/dev/null \
  | grep -E '^[^/]+\.md$|^docs/.*\.md$' \
  | grep -vE '^docs/(changelog|archive|evidence)/' \
  | grep -vE '^CONTRIBUTING\.md$' || true)
FILE_COUNT=$(printf '%s\n' "$FILES" | grep -c '\.md$' || true)
FILE_COUNT=${FILE_COUNT:-0}

# ── 失明防护：扫描面为空 = 拒绝假绿（G-1 纪律）──
if [ "$FILE_COUNT" -lt 5 ]; then
  echo "❌ [doc-discipline] 扫描面异常：只匹配到 ${FILE_COUNT} 个文档（应 ≥5）——git ls-files 失效或目录结构已变，拒绝把「读不到」当成「零违规」"
  exit 2
fi

PAT_ISSUE='\b(F|P0|P1|P2|P3|D|G)-[0-9a-zA-Z]+'
# ⚠️ Face 2 必须**锚定路径起点**（前一个字符不能是路径/词字符）——否则 `/home/` 会命中
#    `/tmp/sofagent-qs/home/data/…` 这类**非家目录**路径（实测假阳性 3 处，本守卫
#    第一版即踩到）。真家目录形如 `/Users/<name>/…` 或 `/home/<name>/…` 且从词边界起。
PAT_PRIVATE='(^|[^A-Za-z0-9_./-])(/(Users|home)/[A-Za-z0-9_.-]+/|~/Desktop/|~/Documents/)'

# ── Face 3 常量（来源块溯源纪律）──
SRC_BLOCK_PAT='^>[[:space:]]*(📖|📐)'
PAT_INTERNAL='温故知新|二次蒸馏|本地蒸馏|增量蒸馏|内部会议纪要|内部会议记录|内部复盘|内部评审'
LEDGER="tools/check/source-block-exempt.txt"

# ── 失明防护（Face 3b 前置）：台账缺失 = 无基线可依，拒绝假绿 ──
if [ ! -f "$LEDGER" ]; then
  echo "❌ [doc-discipline] 来源块台账缺失：${LEDGER}——Face 3b 无基线可依，拒绝把「读不到」当成「零债」"
  exit 2
fi

HITS=0
echo "── doc-discipline │ 对外主文档写作纪律（CONTRIBUTING「changelog / 来源块溯源」规范）──"
echo "  扫描面：${FILE_COUNT} 个文档（根级 *.md + docs/**/*.md；已排除 changelog/archive/evidence 与装置面 CONTRIBUTING.md）"
echo ""

echo "[Face 1] 内部工单 / 审查代号"
F1=$(printf '%s\n' "$FILES" | while IFS= read -r f; do
  [ -n "$f" ] && grep -nE "$PAT_ISSUE" "$f" 2>/dev/null | sed "s|^|    ${f}:|"
done)
if [ -n "$F1" ]; then
  printf '%s\n' "$F1"; HITS=$((HITS + $(printf '%s\n' "$F1" | grep -c .)))
  echo "  ❌ 命中 $(printf '%s\n' "$F1" | grep -c .) 处——改用描述性文字（如「v1.4.3 审查批修复」替「F-15」）"
else
  echo "  ✓ 零命中"
fi

echo ""
echo "[Face 2] 本机私有路径"
F2=$(printf '%s\n' "$FILES" | while IFS= read -r f; do
  [ -n "$f" ] && grep -nE "$PAT_PRIVATE" "$f" 2>/dev/null | sed "s|^|    ${f}:|"
done)
if [ -n "$F2" ]; then
  printf '%s\n' "$F2"; HITS=$((HITS + $(printf '%s\n' "$F2" | grep -c .)))
  echo "  ❌ 命中 $(printf '%s\n' "$F2" | grep -c .) 处——改为相对路径或泛化占位（如 \`<repo>\`）"
else
  echo "  ✓ 零命中"
fi

echo ""
echo "[Face 3a] 来源块溯源纪律（阻断）：来源块内内部流程 / 内部产物名"
F3A=$(printf '%s\n' "$FILES" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  grep -nE "$SRC_BLOCK_PAT" "$f" 2>/dev/null | grep -E '来源' | grep -E "$PAT_INTERNAL" | sed "s|^|    ${f}:|"
done)
if [ -n "$F3A" ]; then
  printf '%s\n' "$F3A"; HITS=$((HITS + $(printf '%s\n' "$F3A" | grep -c .)))
  echo "  ❌ 命中 $(printf '%s\n' "$F3A" | grep -c .) 处——来源块只写公开出处；内部件改走正文叙述，不进溯源块"
else
  echo "  ✓ 零命中"
fi

echo ""
echo "[Face 3b] 来源块存量债（集合相等：缺链接 / 缺原文发布日）"
ACTUAL=$(printf '%s\n' "$FILES" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  BLK=$(grep -E "$SRC_BLOCK_PAT" "$f" 2>/dev/null | grep -E '来源' || true)
  [ -n "$BLK" ] || continue
  NL=$(printf '%s\n' "$BLK" | grep -vE '\]\(http|https?://' | grep -c '' || true)
  ND=$(printf '%s\n' "$BLK" | grep -vE '20[0-9][0-9][-/年]' | grep -c '' || true)
  [ "${NL:-0}" -gt 0 ] && printf '缺链接\t%s\t%s\n' "$f" "$NL"
  [ "${ND:-0}" -gt 0 ] && printf '缺日期\t%s\t%s\n' "$f" "$ND"
done | sort)
LEDGER_BODY=$(grep -vE '^[[:space:]]*(#|$)' "$LEDGER" | sort)
if [ "$ACTUAL" = "$LEDGER_BODY" ]; then
  echo "  ✓ 实测 == 台账（$(printf '%s\n' "$ACTUAL" | grep -c '^缺链接') 个文件缺链接 / $(printf '%s\n' "$ACTUAL" | grep -c '^缺日期') 个文件缺日期）"
else
  echo "  ❌ 实测与台账不一致——来源块存量债已漂移"
  echo "     实测："
  printf '%s\n' "$ACTUAL" | sed 's|^|       |'
  echo "     台账（${LEDGER}）："
  printf '%s\n' "$LEDGER_BODY" | sed 's|^|       |'
  echo "     ⚠️ 清理后把台账改小（让 diff 记录「债减少」）；实测超出台账 = 新增债，须先补来源块"
  HITS=$((HITS + 1))
fi

echo ""
echo "[Face 4] 历史冻结区与装置面（可见，不阻塞）"
FREEZE=$(git ls-files '*.md' 2>/dev/null | grep -E '^(docs/(changelog|archive|evidence)/|CONTRIBUTING\.md$)' || true)
FREEZE_N=$(printf '%s\n' "$FREEZE" | grep -c '\.md$' || true)
echo "  ℹ️ 豁免文件 ${FREEZE_N:-0} 个（changelog / archive / evidence / CONTRIBUTING 装置面）——历史事实与模式定义，不做判定"
echo "  ℹ️ changelog 的写作纪律维持人工 SOP（纳入判定面会全红且只能靠篡改历史变绿）"

echo ""
if [ "$HITS" -gt 0 ]; then
  echo "发现 ${HITS} 处违规"
  exit 1
fi
echo "全部通过（0 处违规：内部代号 / 本机私有路径 / 来源块溯源 三面）"
exit 0
