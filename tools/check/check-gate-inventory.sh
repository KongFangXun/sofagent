#!/usr/bin/env bash
# ============================================================
# check-gate-inventory.sh · 门禁清单覆盖对账守卫
# (gate inventory ↔ invocation-surface coverage gate)
# ============================================================
# 职责：对账「`tools/check/` 下真实存在的守卫」与「流水线上真实的调用面」，
#   抓出**孤儿守卫**——脚本写好了、进了 tools/README.md 的登记表，却没有任何
#   可执行调用点。孤儿守卫的红态无人知晓，等于不存在。
#
# 病根实录（v1.5.1 阶段三收口）：
#   `tools/check/check-forms.mjs` 在 e06037b3 引入 A2 违规（新增 changelog 章未挂
#   「形态归属」行）后一直是红的，但阶段三的通用门禁清单里没有它、pre-commit 钩子
#   没有它、releasing 各阶段门禁清单没有它、pre-push 也没有它——它只出现在
#   `tools/README.md` 的**登记表**里。**登记 ≠ 调用**：写进登记表会让人以为它在跑，
#   实际零调用点。本守卫把「登记」与「接线」的差别机械化。
#
# ------------------------------------------------------------------
# 调用面口径（四项显式声明——口径不声明，结论不可比）
#   ① 匹配模式：**裸文件名**（fixed string，非正则），外层再按面分流（见 ③）
#   ② 注释处理：**脚本面整行剔除注释行**——行首（允许前置空白）为 `#` / `//` /
#      `*` / `/*` 的行整体丢弃。理由：实测假阴性来源就是**注释里提到守卫名**
#      （本守卫首版即被自己的注释骗过，把 check-forms 判成"有调用点"）。
#      **行尾内联注释不剔**——`${x#y}` / URL / 正则字面量会被误伤，代价大于收益。
#   ③ 切块边界：
#      · 脚本面（机器执行，认裸名）= `tools/release` `tools/hooks` `tools/check`
#        `tools/forge` `playbook` `.github` `FORGE` 下的 `.sh/.mjs/.js/.ts/.yml/.yaml`
#        + `engine/*/vitest.config.ts` + 各级 `package.json` + 仓库根 `package.json`
#      · 文档面（人工 SOP 指令，**只认带 `tools/check/` 路径的引用**）=
#        `playbook/*.md` + `docs/changelog/releasing/*.md`
#        理由：SOP 写的是完整命令 `bash tools/check/check-version.sh`；而**登记表**
#        写裸名或 `check/xxx`（`tools/README.md` 即裸名形态）——要求路径化引用即可
#        把"描述"与"调用"分开。登记表本身（`tools/README.md`）与历史记述
#        （`docs/changelog/v*`）**不在任何面内**：它们描述守卫，不调用守卫。
#   ④ 大小写口径：区分大小写（守卫名含大小写变体，不折叠）
#
# 盲区与防复发（假红双向纪律——守卫自身可错，故须自我对账）：
#   语料装载曾写作 `cat "$TMPD/s/"*`，而摊平后的 `.github/…` 以点开头，bash glob
#   **不匹配点开头文件** ⇒ 整个 `.github` 面静默漏载。后果是**假红**：三个已由
#   `.github/workflows/pr-check.yml` 真实接线的守卫（readme-parity / shell-injection /
#   wiring-guard）被报成「孤儿零调用点」。危险处在于——漏载不会让任何已有判据变红，
#   失明自检也看不见（它数的是 surface 清单，不是进语料的件数）。
#   两处处置：① 摊平加非点前缀 `S_` + 语料改用 find 装载；② 增**装载完整性对账**
#   （清单件数 ≡ 进语料件数），把「漏载某个面」这一**类**故障变成 exit 2 而非静默假红。
#   配套原则：语料装载/口径判定任一处改动，必须同时给「守卫的守卫」——否则守卫自己
#   的 bug 会以「抓到了问题」的形态流出，比不装守卫更坏（假红消耗信任、掩盖真缺口）。
#
# 判定（C1 / C2 FAIL；扫描面塌缩走失明 exit 2）：
#   C1 孤儿守卫：守卫零调用点且未进豁免清单 ⇒ FAIL（列出文件名 + 两条处置路径）
#   C2 陈旧豁免：豁免清单条目指向不存在的守卫或缺理由 ⇒ FAIL（防豁免表腐化）
#   失明：守卫数 < 30 或调用面文件数 < 5 ⇒ exit 2 拒绝假绿
#
# 豁免清单：`playbook/.gate-inventory-exempt`，每行 `文件名:理由`
#   （与既有 `playbook/.coverage-exempt` 同构）。仅用于「按设计不在开源仓自动调用」
#   的守卫。豁免必须写得出理由——写不出理由的，就该接线。
#
# 退出码：0 = 全绿 / 1 = 有违规 / 2 = 失明（扫描面塌缩，拒绝假绿）
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

RED=$'\033[31m'
GREEN=$'\033[32m'
NC=$'\033[0m'

EXEMPT_FILE="playbook/.gate-inventory-exempt"
MIN_GUARDS=30
MIN_SURFACES=5

TMPD="$(mktemp -d -t gate-inv.XXXXXX)" || exit 2
trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/s"

bad=0

# ── ① 收集守卫 ────────────────────────────────────────────
: >"$TMPD/guards"
for f in tools/check/*.sh tools/check/*.mjs; do
  [ -f "$f" ] || continue
  basename "$f" >>"$TMPD/guards"
done
guard_count="$(grep -c . "$TMPD/guards" 2>/dev/null || true)"
guard_count="${guard_count:-0}"

# ── ② 面分类与注释剔除 ────────────────────────────────────
flat() { printf '%s' "$1" | tr '/' '_'; }

# 脚本面：整行剔除注释行后原样保留
strip_script() {
  grep -vE '^[[:space:]]*(#|//|\*|/\*)' "$1" 2>/dev/null || true
}
# 文档面：只留带 tools/check/ 路径的引用行
strip_doc() {
  grep -F 'tools/check/' "$1" 2>/dev/null || true
}

: >"$TMPD/surfaces-list"
collect() { # $1=file  $2=script|doc
  local src="$1" kind="$2" out
  out="$TMPD/s/$(flat "$src")"
  if [ "$kind" = "script" ]; then
    strip_script "$src" >"$out"
  else
    strip_doc "$src" >"$out"
  fi
  if [ -s "$out" ]; then
    echo "$src" >>"$TMPD/surfaces-list"
  fi
}

for d in tools/release tools/hooks tools/check tools/forge playbook .github FORGE; do
  [ -d "$d" ] || continue
  find "$d" -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.js' -o -name '*.ts' -o -name '*.yml' -o -name '*.yaml' \) 2>/dev/null |
    grep -v '/node_modules/' |
    while IFS= read -r f; do echo "S $f"; done
done >"$TMPD/raw-s"
find engine -type f \( -name 'vitest.config.ts' -o -name 'package.json' -o -name '*.sh' \) 2>/dev/null |
  grep -v '/node_modules/' |
  while IFS= read -r f; do echo "S $f"; done >>"$TMPD/raw-s"
[ -f package.json ] && echo "S package.json" >>"$TMPD/raw-s"

for d in playbook docs/changelog/releasing; do
  [ -d "$d" ] || continue
  find "$d" -type f -name '*.md' 2>/dev/null | while IFS= read -r f; do echo "D $f"; done
done >"$TMPD/raw-d"

: >"$TMPD/all-seen"
while IFS= read -r line; do
  kind="${line%% *}"
  src="${line#* }"
  [ -n "$src" ] || continue
  grep -qxF "$src" "$TMPD/all-seen" 2>/dev/null && continue
  echo "$src" >>"$TMPD/all-seen"
  if [ "$kind" = "S" ]; then
    collect "$src" script
  else
    collect "$src" doc
  fi
done <"$TMPD/raw-s"
while IFS= read -r line; do
  kind="${line%% *}"
  src="${line#* }"
  [ -n "$src" ] || continue
  grep -qxF "$src" "$TMPD/all-seen" 2>/dev/null && continue
  echo "$src" >>"$TMPD/all-seen"
  collect "$src" doc
done <"$TMPD/raw-d"

surface_count="$(grep -c . "$TMPD/surfaces-list" 2>/dev/null || true)"
surface_count="${surface_count:-0}"

# 语料装载用 find 而非 glob——glob 漏点开头件（见 ② flat 注释），find 无此形态。
: >"$TMPD/corpus"
find "$TMPD/s" -maxdepth 1 -type f -exec cat {} + >>"$TMPD/corpus" 2>/dev/null || true

echo "════════════════════════════════════════════════════════════"
echo "  check-gate-inventory · 门禁清单覆盖对账（登记 ≠ 调用）"
echo "════════════════════════════════════════════════════════════"
echo "  守卫面：tools/check/ ${guard_count} 个脚本"
echo "  调用面：${surface_count} 个文件（脚本面认裸名且已剔注释行；文档面只认 tools/check/ 路径化引用）"

# ── ③ 失明自检 ────────────────────────────────────────────
if [ "$guard_count" -lt "$MIN_GUARDS" ]; then
  echo "${RED}✗ 失明：仅扫到 ${guard_count} 个守卫（基线 ≥${MIN_GUARDS}）——扫描面塌缩，拒绝假绿${NC}"
  exit 2
fi
if [ "$surface_count" -lt "$MIN_SURFACES" ]; then
  echo "${RED}✗ 失明：仅扫到 ${surface_count} 个调用面文件（基线 ≥${MIN_SURFACES}）——拒绝假绿${NC}"
  exit 2
fi
# 语料装载完整性——**守卫的守卫**（闭合「漏载某个面」这一整类盲区，而非单点）。
# 两条**非重言**断言，各抓一类故障：
#   ① 非空件数 ≡ surface 清单件数——抓摊平命名冲突（两源摊平同名 ⇒ 少件）与
#      「进了清单却没落件」（清单按 -s 判非空，故基线取非空件数）。
#   ② 语料行数 ≡ 非空件行数之和——**直接抓装载器漏件**（如 glob 漏点开头件）。
#      缺 ② 时，把装载改回 glob 依旧能过 ①（① 数的是磁盘上的件，不是进语料的行）。
collected_count="$(find "$TMPD/s" -maxdepth 1 -type f ! -empty 2>/dev/null | wc -l | tr -d ' ')"
collected_count="${collected_count:-0}"
collected_lines="$(find "$TMPD/s" -maxdepth 1 -type f ! -empty -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')"
collected_lines="${collected_lines:-0}"
corpus_lines="$(wc -l <"$TMPD/corpus" 2>/dev/null | tr -d ' ')"
corpus_lines="${corpus_lines:-0}"
if [ "$collected_count" -ne "$surface_count" ]; then
  echo "${RED}✗ 失明：surface 清单 ${surface_count} 件，非空语料件 ${collected_count} 件——摊平命名冲突或记账漂移，拒绝假绿${NC}"
  exit 2
fi
if [ "$collected_lines" -ne "$corpus_lines" ]; then
  echo "${RED}✗ 失明：非空语料件共 ${collected_lines} 行，语料实体 ${corpus_lines} 行——装载器漏件，拒绝假绿${NC}"
  exit 2
fi
echo "  ✓ 失明自检：${guard_count} 守卫 / ${surface_count} 调用面（基线 ≥${MIN_GUARDS} / ≥${MIN_SURFACES}）· 语料装载 ${collected_count}/${surface_count} 件 · ${corpus_lines} 行"

# ── ④ 载入豁免清单 ────────────────────────────────────────
: >"$TMPD/exempt-names"
: >"$TMPD/exempt-lines"
if [ -f "$EXEMPT_FILE" ]; then
  grep -vE '^[[:space:]]*(#|$)' "$EXEMPT_FILE" >"$TMPD/exempt-lines" 2>/dev/null || true
  cut -d: -f1 "$TMPD/exempt-lines" | grep -v '^$' | LC_ALL=C sort -u >"$TMPD/exempt-names" 2>/dev/null || true
fi

# ── ⑤ C1 孤儿守卫 ─────────────────────────────────────────
# 计数法：corpus 总命中行数 − 自身文件命中行数 > 0 ⇔ 自身之外存在调用点。
# 单次 grep 而非逐面遍历——42 守卫 × 200 面会退化成 8000+ 次进程启动。
: >"$TMPD/orphans"
while IFS= read -r b; do
  [ -n "$b" ] || continue
  total="$(grep -cF "$b" "$TMPD/corpus" 2>/dev/null || true)"
  total="${total:-0}"
  selfout="$TMPD/s/$(flat "tools/check/$b")"
  selfn=0
  [ -f "$selfout" ] && selfn="$(grep -cF "$b" "$selfout" 2>/dev/null || true)"
  selfn="${selfn:-0}"
  if [ "$((total - selfn))" -le 0 ]; then
    echo "$b" >>"$TMPD/orphans"
  fi
done <"$TMPD/guards"

: >"$TMPD/real-orphans"
while IFS= read -r b; do
  [ -n "$b" ] || continue
  grep -qxF "$b" "$TMPD/exempt-names" 2>/dev/null && continue
  echo "$b" >>"$TMPD/real-orphans"
done <"$TMPD/orphans"

orphan_count="$(grep -c . "$TMPD/real-orphans" 2>/dev/null || true)"
orphan_count="${orphan_count:-0}"

if [ "$orphan_count" -gt 0 ]; then
  echo "${RED}  ✗ C1 孤儿守卫：${orphan_count}/${guard_count} 个守卫零调用点且未豁免${NC}"
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    echo "      ❌ tools/check/$b"
  done <"$TMPD/real-orphans"
  echo "      处置二选一：① 接进调用面（tools/release/pre-push-check.sh / releasing 阶段门禁清单 / playbook 调用）"
  echo "                  ② 确有理由不在开源仓自动调用 ⇒ 写进 ${EXEMPT_FILE}（格式 文件名:理由）"
  bad=1
else
  echo "${GREEN}  ✓ C1 孤儿守卫：0 个（${guard_count} 个守卫全部有调用点或已豁免）${NC}"
fi

# ── ⑥ C2 陈旧豁免 ─────────────────────────────────────────
: >"$TMPD/stale"
while IFS= read -r ln; do
  [ -n "$ln" ] || continue
  nm="$(printf '%s' "$ln" | cut -d: -f1)"
  reason="$(printf '%s' "$ln" | cut -d: -f2-)"
  if ! grep -qxF "$nm" "$TMPD/guards" 2>/dev/null; then
    echo "${nm}（守卫不存在）" >>"$TMPD/stale"
    continue
  fi
  if [ -z "$(printf '%s' "$reason" | tr -d '[:space:]')" ]; then
    echo "${nm}（缺理由）" >>"$TMPD/stale"
  fi
done <"$TMPD/exempt-lines"

stale_count="$(grep -c . "$TMPD/stale" 2>/dev/null || true)"
stale_count="${stale_count:-0}"
exempt_count="$(grep -c . "$TMPD/exempt-names" 2>/dev/null || true)"
exempt_count="${exempt_count:-0}"

if [ "$stale_count" -gt 0 ]; then
  echo "${RED}  ✗ C2 陈旧豁免：${EXEMPT_FILE} 有失效条目${NC}"
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    echo "      ❌ $s"
  done <"$TMPD/stale"
  bad=1
else
  echo "${GREEN}  ✓ C2 陈旧豁免：0 条（豁免表 ${exempt_count} 条条目全部有效且带理由）${NC}"
fi

echo "════════════════════════════════════════════════════════════"
if [ "$bad" -eq 0 ]; then
  echo "${GREEN}  2 项判定 / 0 处违规${NC}"
  echo "[check:coverage] script=check-gate-inventory asserts=2 covered=${guard_count} skipped=${surface_count}"
  exit 0
fi
echo "${RED}  2 项判定 / 违规已列出（见上）${NC}"
echo "[check:coverage] script=check-gate-inventory asserts=2 covered=${guard_count} skipped=${surface_count}"
exit 1
