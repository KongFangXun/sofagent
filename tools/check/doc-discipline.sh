#!/usr/bin/env bash
# ============================================================
# doc-discipline.sh · 对外文档写作纪律门禁（v1.4.9 P2-27）
# ------------------------------------------------------------
# 依据：CONTRIBUTING.md 已成的写作纪律（「changelog 是对外公开文档，不写人名、
#   内部私有路径、内部工单/审查代号」——三条 bullet 给出可判定形态）。
#   本门禁把其中**正则可判定**的两面收进 CI，从「人工记得」升级为「机器拦得住」。
#
# 🔴 扫描面（对外主文档）：根级 *.md + docs/**/*.md，减去下面两类豁免：
#   · 装置面 CONTRIBUTING.md —— 纪律定义必须**引用被禁模式本身**，否则本守卫无法
#     定义它要禁的东西（同 tools/check/check-legacy-knowledge-path.mjs 的装置面口径）。
#   · 历史冻结区 docs/changelog/**、docs/archive/**、docs/evidence/** —— 历史事实，
#     改之 = 篡改（同 P1-14 旧路径断言的历史冻结区口径）。
#
# ⚠️ 范围诚实披露：CONTRIBUTING:137 的本义是**changelog** 的写作纪律，而 changelog
#   全量含历史工单代号（v1.4.9 及更早各版开发日志皆然），纳入判定面会立即全红、
#   且只能靠篡改历史才变绿。故本门禁**不把 changelog 纳入判定面**，该条维持人工 SOP
#   （CONTRIBUTING 已明示）。本门禁判定的是「对外主文档」这一扩大的、可自动化的面。
#
# Face 1 内部工单 / 审查代号：F-xx / P0-xx / P1-xx / P2-xx / P3-xx / D-n / G-n
#   （形态取自 CONTRIBUTING:140 的示例 `F-XX` / `P0-XX` / `FLAG-X`）
# Face 2 本机私有路径：/Users/<name>/ · /home/<name>/ · ~/Desktop/ · ~/Documents/
#   ⚠️ 刻意**不**把 ~/.sofagent/ 之类「产品家目录」计入——它是文档需要写的配置路径，
#      不是维护者私有路径。只拦「别人机器上才存在」的绝对用户路径。
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

HITS=0
echo "── doc-discipline │ 对外主文档写作纪律（CONTRIBUTING.md:137-140）──"
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
echo "[Face 3] 历史冻结区与装置面（可见，不阻塞）"
FREEZE=$(git ls-files '*.md' 2>/dev/null | grep -E '^(docs/(changelog|archive|evidence)/|CONTRIBUTING\.md$)' || true)
FREEZE_N=$(printf '%s\n' "$FREEZE" | grep -c '\.md$' || true)
echo "  ℹ️ 豁免文件 ${FREEZE_N:-0} 个（changelog / archive / evidence / CONTRIBUTING 装置面）——历史事实与模式定义，不做判定"
echo "  ℹ️ changelog 的写作纪律维持人工 SOP（纳入判定面会全红且只能靠篡改历史变绿）"

echo ""
if [ "$HITS" -gt 0 ]; then
  echo "发现 ${HITS} 处违规"
  exit 1
fi
echo "全部通过（0 处违规）"
exit 0
