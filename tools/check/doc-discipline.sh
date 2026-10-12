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
#   Face 5 可读性棘轮（v1.5.4 文档治理批）——核心文档的墙式段落 / 墙式单元格计数
#      与 tools/check/doc-ratchet.json **逐文件 ≤ 比较**。口径：wall=围栏外 >300 字符行；
#      cell=围栏外表格内 >200 字符格（计数器 tools/check/lib/readability-count.mjs 单一实现）。
#      治的是「内容只进不出」：任何提交让核心文档变得更挤即红；清理后改小台账让 diff
#      记录「债减少」。文件清零后从台账移除。
#      另有**覆盖面断言**（v1.5.4 补）：台账只对在册文件做 ≤ 比较，「没登记」曾是棘轮的
#      天然放水口——现要求「全仓非冻结 .md 中 wall/cell > 0 者必须已在册」，新增文档
#      带债务却未登记即红，堵住「靠不登记规避门禁」。
#
# Face 7 抬头块闸（v1.5.4）：H1 到首个 H2 之间的正文 ≤600 字，治「开头堆说明翻不到正文」。
# Face 8 落盘后自检（2026-10-10）：串接 doc-postcheck.mjs --changed，把此前「靠人记得跑」的
#   五项即时快检收进门禁（U+FFFD / 墙式行格 / 字数棘轮 / 抬头块 / 标题粘连）。
# Face 9 净增量召回（2026-10-10）：新增来源块的关键词在活跃文档召回并打印（信息位，不自动红）。
#   治「任务书自述净增量零命中而实测已有同源段落」——自述不是证据，命中必须被看见。
# Face 6b 基线上调登记闸（2026-10-10）：字数基线上调必须在 _meta.note 记入文件名与理由。
#
# ⚠️ 范围诚实披露（排除面 ≠ 无覆盖，但必须可见）：
#   · Face 1-3（内部代号 / 私有路径 / 来源块）判定面 = 根级 *.md + docs/**/*.md。
#   · Face 5（棘轮 + 覆盖面）判定面 = 全仓 tracked .md 减去历史冻结区与 vendored 上游
#     （docs/changelog · docs/archive · docs/evidence · playbook/vendor）。
#   · 故 FORGE/ · SKILL/ · engine/ · playbook/ · FDE/ · tools/ 的**内部代号与私有路径**
#     不在 Face 1-3 判定面内（这些目录的正文多为机器提示词与内部工具文档，纳入会
#     大面积假红；其可读性由 Face 5 覆盖面兜底）。changelog 的写作纪律维持人工 SOP。
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
echo "[Face 5] 核心文档可读性棘轮（墙式段落 / 墙式单元格 ≤ doc-ratchet.json 基线）"
RATCHET="tools/check/doc-ratchet.json"
COUNTER="tools/check/lib/readability-count.mjs"
if [ ! -f "$RATCHET" ] || [ ! -f "$COUNTER" ]; then
  echo "  ❌ 棘轮台账或计数器缺失（${RATCHET} / ${COUNTER}）——无基线可依，拒绝假绿"
  HITS=$((HITS + 1))
else
  # 台账在册文件逐个 ≤ 比较
  TRACK_FILES=$(node -e "const r=require('./$RATCHET');console.log(Object.keys(r).filter(k=>k!=='_meta').join('\n'))")
  R5_FAIL=0
  if [ -n "$TRACK_FILES" ]; then
    # shellcheck disable=SC2086
    ACTUAL_JSON=$(node "$COUNTER" $TRACK_FILES 2>/dev/null)
    if [ -z "$ACTUAL_JSON" ]; then
      echo "  ❌ 计数器输出为空——失明防护（文件被删/改名须同步台账）"
      HITS=$((HITS + 1))
    else
      BAD=$(node -e "
        const base=require('./$RATCHET'); const act=JSON.parse(process.argv[1]);
        for(const [f,b] of Object.entries(base)){
          if(f==='_meta')continue;
          const a=act[f];
          if(!a){ console.log(f+'：台账在册但文件不可读——改名/删除须同步台账'); continue; }
          if(a.wall>b.wall) console.log(f+'：wall '+a.wall+' > 基线 '+b.wall);
          if(a.cell>b.cell) console.log(f+'：cell '+a.cell+' > 基线 '+b.cell);
        }" "$ACTUAL_JSON" || true)
      if [ -n "$BAD" ]; then
        printf '%s\n' "$BAD" | sed 's|^|    |'
        R5_FAIL=$(printf '%s\n' "$BAD" | grep -c .)
        HITS=$((HITS + R5_FAIL))
        echo "  ❌ ${R5_FAIL} 处超基线——内容只许变清爽不许变挤；若确已清理，把 doc-ratchet.json 改小让 diff 记录「债减少」"
      else
        echo "  ✓ 全部 ≤ 基线（$(printf '%s\n' "$TRACK_FILES" | grep -c .) 个核心文档；清理后请改小台账）"
      fi
    fi
  fi

  # ── Face 5 覆盖面断言（v1.5.4 文档治理批补）────────────────────────
  # 台账只对**在册**文件做 ≤ 比较——「没登记」＝「不受管」，是棘轮的天然放水口。
  # 本断言把它堵上：全仓非冻结 .md 中，凡 wall/cell > 0 的文件必须已在册；
  # 新增文档带债务却未登记 ⇒ 红（提示先清理，再登记基线）。
  CANDS=$(git ls-files '*.md' 2>/dev/null \
    | grep -vE '^docs/(changelog|archive|evidence)/' \
    | grep -vE '^playbook/vendor/' || true)
  if [ -z "$CANDS" ]; then
    echo "  ❌ 覆盖面自检：候选文档集为空——git ls-files 失效，拒绝假绿"
    HITS=$((HITS + 1))
  else
    # shellcheck disable=SC2086
    CANDS_JSON=$(node "$COUNTER" $CANDS 2>/dev/null || echo '{}')
    UNREG=$(node -e "
      const base=require('./$RATCHET'); const act=JSON.parse(process.argv[1]);
      const known=new Set(Object.keys(base).filter(k=>k!=='_meta'));
      for(const [f,a] of Object.entries(act)){
        if((a.wall>0||a.cell>0) && !known.has(f)) console.log(f+'  (wall '+a.wall+' / cell '+a.cell+')');
      }" "$CANDS_JSON" 2>/dev/null || true)
    if [ -n "$UNREG" ]; then
      printf '%s\n' "$UNREG" | sed 's|^|    |'
      UNREG_N=$(printf '%s\n' "$UNREG" | grep -c .)
      HITS=$((HITS + UNREG_N))
      echo "  ❌ 覆盖面 ${UNREG_N} 处：文件有墙式债务却未登记台账——先清理，或测基线后登记（登记 = 认下这笔债）"
    else
      echo "  ✓ 覆盖面：候选 $(printf '%s\n' "$CANDS" | grep -c .) 个非冻结文档，有债务者全部在册"
    fi
  fi
fi

# ── Face 6 字数棘轮（2026-09-29 口径换算批：由「物理行数」换成「字符数」）──────
# 口径 = Unicode 码点数（见 tools/check/doc-char-ratchet.json 的 _meta.counter）。
# 换口径的判据：折行（墙式→多行）让**行数 ×6** 而**字符数只 +1.7%**——行数会把
#   「排版优化」记成「膨胀事故」（本仓 LIMIT_A 注释实录 20+ 次折行撞预算后上调上限）。
# 与 Face 5（可读性棘轮：wall/cell）正交——Face 5 管「每行有多挤」，Face 6 管「总共多少字」。
# 纪律：只许降不许升；净增需求必须先「同文档移出等量字」（与 06 三道闸闸一对价同源）。
CHAR_RATCHET="tools/check/doc-char-ratchet.json"
echo "[Face 6] 核心文档字数棘轮（字符数 ≤ doc-char-ratchet.json 基线）"
if [ ! -f "$CHAR_RATCHET" ]; then
  echo "  ❌ 台账缺失：${CHAR_RATCHET}——字数棘轮无基线可依，拒绝假绿"
  HITS=$((HITS + 1))
else
  OVER=$(node -e '
    const fs=require("fs");
    const base=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const out=[];
    for(const [f,lim] of Object.entries(base)){
      if(f==="_meta") continue;
      if(!fs.existsSync(f)){ out.push(f+"  (文件不存在——台账条目陈旧)"); continue; }
      const n=[...fs.readFileSync(f,"utf8")].length;
      if(n>lim) out.push(f+"  "+n+" > 基线 "+lim+"（+"+(n-lim)+" 字）");
    }
    if(out.length) console.log(out.join("\n"));
  ' "$CHAR_RATCHET" 2>/dev/null || true)
  if [ -n "$OVER" ]; then
    printf '%s\n' "$OVER" | sed 's|^|    |'
    OVER_N=$(printf '%s\n' "$OVER" | grep -c .)
    HITS=$((HITS + OVER_N))
    echo "  ❌ ${OVER_N} 处超基线——内容只许降不许升；净增须先同文档移出等量字（06 · 三道闸闸一），再动基线"
  else
    REG_N=$(node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(Object.keys(o).filter(k=>k!=="_meta").length)' "$CHAR_RATCHET" 2>/dev/null || echo '?')
    echo "  ✓ 全部 ≤ 基线（${REG_N} 份核心文档；精简后请改小台账让 diff 记录）"
  fi

  # ── Face 6b 基线上调登记闸（2026-10-10 升级：抬上限必须有据）────────────
  # 「只许降不许升」的例外是正当新增，而正当性必须写在 _meta.note 里
  # （2026-10-08 KB 候选落盘先例即如此登记：文件名 + 增量 + 理由）。
  # 判据：某文件基线值较 HEAD 版本上升 ⇒ 该文件路径必须出现在 _meta.note 中。
  # 堵的是「悄悄抬上限」——与 check-docs LIMIT_A 注释里「批注自身记载过该缺口
  # 却以抬上限代替归层修正」同源的累积病。
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    RAISED=$(node -e '
      const {execFileSync}=require("child_process"); const fs=require("fs");
      const p=process.argv[1];
      let old={};
      try{ old=JSON.parse(execFileSync("git",["show","HEAD:"+p],{encoding:"utf8"})); }catch(e){ process.exit(0); }
      const cur=JSON.parse(fs.readFileSync(p,"utf8"));
      const note=String((cur._meta&&cur._meta.note)||"");
      const out=[];
      for(const [f,v] of Object.entries(cur)){
        if(f==="_meta") continue;
        const o=old[f];
        if(typeof o!=="number" || typeof v!=="number") continue;
        if(v>o && !note.includes(f)) out.push(f+"  基线 "+o+" → "+v+"（+"+(v-o)+"）但 _meta.note 未提及该文件");
      }
      if(out.length) console.log(out.join("\n"));
    ' "$CHAR_RATCHET" 2>/dev/null || true)
    if [ -n "$RAISED" ]; then
      printf '%s\n' "$RAISED" | sed 's|^|    |'
      HITS=$((HITS + $(printf '%s\n' "$RAISED" | grep -c .)))
      echo "  ❌ 基线上调未登记——把文件名与理由写进 _meta.note（抬上限必须有据，同 Face 3b 存量债口径）"
    fi
  fi
fi

# ── Face 7 抬头块闸（2026-09-29 抬头块限流批）─────────────────────────
# 抬头块 = H1 到首个 '## ' 之间的正文；字数只计文本字符，剔装饰行与 YAML front matter
# 装饰行口径（v1.5.9 补齐）：HTML 装饰 = **一个或多个标签、标签外无正文**（原实现只认单标签行，
#   导致 `<p …><img …/></p>` 这类多标签徽章行被计入抬头块——与 _meta.opening_rule「剔除 HTML 标签行」漂移，已对齐）
# （口径与处置见 doc-char-ratchet.json 的 _meta.opening_rule）。
# 治的是「文档开头堆一大段说明/为什么，读者翻不到正文」。
OPENING_CAP=600
echo "[Face 7] 抬头块闸（首个 H2 之前的正文字数 ≤ ${OPENING_CAP} 字）"
if [ ! -f "$CHAR_RATCHET" ]; then
  echo "  ❌ 台账缺失：${CHAR_RATCHET}——抬头块闸无判定面，拒绝假绿"
  HITS=$((HITS + 1))
else
  OVERO=$(node -e '
    const fs=require("fs");
    const base=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const cap=parseInt(process.argv[2],10);
    const deco=/^((\s*<[^>]+>\s*)+|!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|<!--.*-->|-{3,})$/;
    const opening=(t)=>{
      const L=t.split("\n");
      let start=0;
      if(L[0]&&L[0].trim()==="---"){let j=1;while(j<L.length&&L[j].trim()!=="---")j++;start=j+1;}
      let i=start;
      for(;i<L.length;i++) if(/^## /.test(L[i])) break;
      return [...L.slice(start,i).filter(l=>l.trim()!==""&&!deco.test(l.trim())).join("\n")].length;
    };
    const out=[];
    for(const f of Object.keys(base)){
      if(f==="_meta") continue;
      if(!fs.existsSync(f)) continue;
      const n=opening(fs.readFileSync(f,"utf8"));
      if(n>cap) out.push(f+"  抬头块 "+n+" > "+cap+" 字（超 "+(n-cap)+"）");
    }
    if(out.length) console.log(out.join("\n"));
  ' "$CHAR_RATCHET" "$OPENING_CAP" 2>/dev/null || true)
  if [ -n "$OVERO" ]; then
    printf '%s\n' "$OVERO" | sed 's|^|    |'
    OVERO_N=$(printf '%s\n' "$OVERO" | grep -c .)
    HITS=$((HITS + OVERO_N))
    echo "  ❌ ${OVERO_N} 处抬头块超限——下沉正文 / 精简 / 淘汰，三选一"
  else
    echo "  ✓ 全部 ≤ ${OPENING_CAP} 字"
  fi
fi

# ── Face 8 落盘后自检（2026-10-10 升级：把「靠人记得跑」收进门禁）────────
# doc-postcheck.mjs 五项（U+FFFD / 墙式行格 / 字数棘轮 / 抬头块 / 标题粘连）与
# Face 5-7 判据同源，但它是**单文件即时快检**。此前它只在 tools/README 里被描述为
# 「文档落盘后即时快检」，无任何自动链路调用——落盘者要凭记忆才跑得到。
# 本 Face 用 doc-postcheck 自带的 --changed 面（git diff HEAD + staged 的 .md）
# 兜住「刚改的那几份」，让落盘当下就自检，不必等 pre-push。
POSTCHECK="tools/check/doc-postcheck.mjs"
echo "[Face 8] 落盘后自检（doc-postcheck.mjs · 本次变更 .md 五项）"
if [ ! -f "$POSTCHECK" ]; then
  echo "  ❌ 自检器缺失：${POSTCHECK}——无判定面，拒绝假绿"
  HITS=$((HITS + 1))
else
  PC_OUT=$(node "$POSTCHECK" --changed 2>&1); PC_RC=$?
  if printf '%s\n' "$PC_OUT" | grep -q "无待检文件"; then
    echo "  ℹ️ 本次无 .md 变更，跳过"
  elif [ "$PC_RC" -ne 0 ]; then
    printf '%s\n' "$PC_OUT" | sed 's|^|    |'
    HITS=$((HITS + 1))
    echo "  ❌ 落盘后自检未过——见上（口径与 Face 5-7 同源，此处是即时快检）"
  else
    printf '%s\n' "$PC_OUT" | sed 's|^|    |'
  fi
fi

# ── Face 9 新增来源块的净增量召回（信息位 · 防「自述零命中」式假绿）────────
# 背景（2026-10-10 实锤）：落盘任务书自述「净增量 grep 零命中」，实测
# docs/LIMITATIONS.md:128 已有同源判据段落——**「自述」不是证据**。
# 本 Face 机械复算：取本次新增的 `> 📖 来源：` 行，抽出作品名（《》）与加粗判据词，
# 在**活跃文档**（排除历史冻结区）召回并打印命中，交人工确认。
# 判据：命中 ≠ 违规（同一命题的局限侧与评估层侧可能是正当两面），但**必须被看见**——
#       故为信息位不自动红；与 Face 3b 同源的「可见即可审」口径。
# ⚠️ 先初始化：Face 10-12 复用这三个变量，而 Face 9 只在「有新增行」分支里给
#   MD_FILES/CHANGED_MD 赋值——`set -u` 下引用未定义变量会让整个门禁崩掉。
NEW_LINES=""
MD_FILES=""
CHANGED_MD=""
echo "[Face 9] 新增来源块的净增量召回（信息位 · 命中须人工确认）"
# ⚠️ 关键词取自**本次新增的全部正文行**（不只 📖 行）——判据金句与作品名多数落在
#   来源行的上一段，只扫来源行会抽空 ⇒ 召回未真正执行（守卫自证：抽到 0 个关键词
#   且有新增行时，必须报「失明」而不是报「零命中」，见下 SHOWN/SELFCHECK）。
# ⚠️ 用 `git diff HEAD`（= 工作树 + 暂存区 vs HEAD）：落盘当下改动多半**还没 stage**，
#   只看 --cached 或 HEAD~1..HEAD 都会对「刚写完还没 add」的段落失明。
NEW_LINES=$(git diff HEAD --unified=3 -- '*.md' 2>/dev/null | grep -E '^\+[^+]' || true)
if [ -z "$NEW_LINES" ]; then
  NEW_LINES=$(git diff HEAD~1 HEAD --unified=3 -- '*.md' 2>/dev/null | grep -E '^\+[^+]' || true)
fi
if [ -z "$NEW_LINES" ]; then
  echo "  ℹ️ 本次无 .md 新增行，跳过"
else
  NL_N=$(printf '%s\n' "$NEW_LINES" | grep -c .)
  # 关键词口径（防告警疲劳：噪音型守卫等于失明——实测首版抽出 the/to/a/on/「+」/「→」
  # 等 51 条命中，绝大多数无意义）：只取《作品名》与 **加粗判据短语**；纯 ASCII 仅保留
  # 多词短语（≥8 字符且含空格/连字符），过滤掉停用词与单字；中文一律保留。
  KWS=$(printf '%s\n' "$NEW_LINES" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const set=new Set();
      for(const m of s.matchAll(/《([^》]{2,})》/g)) set.add(m[1]);
      for(const m of s.matchAll(/\*\*([^*]{3,30})\*\*/g)) set.add(m[1]);
      const keep=[...set].filter(k=>/[\u4e00-\u9fff]/.test(k) ? true : (k.length>=8 && /[\s-]/.test(k)));
      console.log(keep.join("\n"));
    });')
  KW_N=$(printf '%s\n' "$KWS" | grep -c . || true)
  SHOWN=0
  # 「无对象」与「失明」必须分开判：本面抽取器的对象就是《作品名》与 **加粗短语**——
  #   ① 新增行里这两类标记**一个都没有**（只改表格索引行 / 代码块）⇒ 本面无召回对象，SKIP；
  #   ② 标记存在却抽出 0 个关键词（正则被改坏 / 阈值写错）⇒ 真失明，必须红。
  # 不分开的后果：只改一行索引也被判「失明」而挡住落盘——噪音型守卫等于失明（同日实测：
  # 改两行 tools/README 表格即触发，属误报）。
  MARK_N=$(printf '%s\n' "$NEW_LINES" | grep -cE '《[^》]+》|\*\*[^*]+\*\*' || true)
  if [ "$KW_N" -eq 0 ] && [ "$MARK_N" -eq 0 ]; then
    echo "  ℹ️ 本次新增 ${NL_N} 行无任何来源语汇（无《》与加粗短语）——本面无召回对象，跳过"
  elif [ "$KW_N" -eq 0 ]; then
    echo "  ❌ 失明防护：新增有 ${MARK_N} 行含《》/加粗标记却抽出 0 个关键词——抽取器失效，拒绝假绿"
    HITS=$((HITS + 1))
  else
    # 扫描面 = tracked .md 减去历史冻结区（**不用 grep -r .**——那会扫进
    # node_modules 下 762 个 .md，实测把本 Face 拖到 3 分钟以上，门禁不可接受）；
    # 再减去**本次变更文件自身**——命中自己不构成「已存在同源内容」的证据。
    MD_FILES=$(git ls-files '*.md' 2>/dev/null | grep -vE '^(docs/changelog/|docs/archive/|docs/evidence/)' || true)
    CHANGED_MD=$(git diff HEAD --name-only -- '*.md' 2>/dev/null | sort -u)
    [ -z "$CHANGED_MD" ] && CHANGED_MD=$(git diff HEAD~1 HEAD --name-only -- '*.md' 2>/dev/null | sort -u)
    if [ -n "$CHANGED_MD" ]; then
      EXCL_RE=$(printf '%s\n' "$CHANGED_MD" | paste -sd'|' -)
      MD_FILES=$(printf '%s\n' "$MD_FILES" | grep -vE "^(${EXCL_RE})$" || true)
    fi
    # ⚠️ 必须按行读：多词短语（如「Damaging the task environment to trigger a reset」）
    #   用 `for kw in $KWS` 会被 IFS 按空白拆成 the/task/to/a 等单字——噪音即由此而来。
    while IFS= read -r kw; do
      [ -z "$kw" ] && continue
      HITS_F=$(printf '%s\n' "$MD_FILES" | xargs grep -l -- "$kw" 2>/dev/null || true)
      [ -z "$HITS_F" ] && continue
      N=$(printf '%s\n' "$HITS_F" | grep -c .)
      printf '    · 「%s」→ 其他活跃文档 %s 处命中：%s\n' "$kw" "$N" "$(printf '%s\n' "$HITS_F" | head -4 | tr '\n' ' ')"
      SHOWN=$((SHOWN + 1))
    done <<< "$KWS"
    if [ "$SHOWN" -eq 0 ]; then
      echo "  ✓ ${NL_N} 新增行 / ${KW_N} 个关键词，活跃文档零命中（净增量成立）"
    else
      echo "  ⚠️ ${KW_N} 个关键词中 ${SHOWN} 个有命中（信息位）：确认是「同命题另一侧」（保留并互链）还是「同事实第二份副本」（须合并）"
    fi
  fi
fi

# ── Face 10 排版四面（增量口径 · 2026-10-11 新增）────────────────────────
# 全部**只在本次新增行上判定**——存量不拦（裸围栏存量 90/476、占位符存量 32 处，
# 全量判定会让门禁当场全红，而变绿只能靠改历史，那是门禁的死路）。
# ① 裸围栏：``` 无语言标注（渲染无高亮）　② 标题层级跳跃：H2 直跳 H4
# ③ 图片引用存在性：![](相对路径) 的文件不在仓内　④ 占位符残留：TODO/TBD/FIXME/待补/XXX
echo "[Face 10] 排版四面（裸围栏 / 标题跳跃 / 图片断链 / 占位符 · 只看新增行）"
if [ -z "$NEW_LINES" ]; then
  echo "  ℹ️ 本次无 .md 新增行，跳过"
else
  P10=0
  # 裸围栏：只数「**开栏**且无语言标注」的新增行——**闭栏不计**。
  #   为什么不能按行计数：闭栏（```）天然无语言，任何新增代码块都必带一个闭栏 ⇒
  #   按行计数会把「新增一个**已标语言**的块」也判红（假阳性；实测：把开栏改成
  #   ```bash 后仍报 1 处）。故按**文件内围栏奇偶位**判开/闭（奇=开、偶=闭），
  #   再与「本次新增行号」取交。变更文件清单在本面独立重算（不复用 Face 9 的
  #   `CHANGED_MD`——后者只在 Face 9 走关键词分支时才赋值，Face 9 跳过时为空串）。
  BARE=0
  _P10_FILES=$(git diff HEAD --name-only -- '*.md' 2>/dev/null | sort -u)
  [ -z "$_P10_FILES" ] && _P10_FILES=$(git diff HEAD~1 HEAD --name-only -- '*.md' 2>/dev/null | sort -u)
  for _f in $_P10_FILES; do
    [ -f "$_f" ] || continue
    _added=$(git diff HEAD --unified=0 -- "$_f" 2>/dev/null | awk '
      /^@@/ && match($0, /\+[0-9]+/) {
        s = substr($0, RSTART+1, RLENGTH-1) + 0
        rest = substr($0, RSTART+RLENGTH)
        c = 1
        if (match(rest, /^,[0-9]+/)) c = substr(rest, 2, RLENGTH-1) + 0
        for (i = 0; i < c; i++) print s + i
      }')
    [ -z "$_added" ] && continue
    # ⚠️ `awk -v` 的赋值不能含换行（会报 "newline in string" 而整段失效）——
    #   故把行号列表压成空格分隔再传，awk 侧按空格 split。
    _added_flat=$(printf '%s' "$_added" | tr '\n' ' ')
    _n=$(awk -v added="$_added_flat" '
      BEGIN { n = split(added, A, " "); for (i = 1; i <= n; i++) if (A[i] != "") isadd[A[i]] = 1; fence = 0; c = 0 }
      /^[[:space:]]*```/ {
        fence++
        if (fence % 2 == 1 && $0 ~ /^[[:space:]]*```[[:space:]]*$/ && (FNR in isadd)) c++
      }
      END { print c + 0 }' "$_f")
    BARE=$((BARE + _n))
  done
  if [ "${BARE:-0}" -gt 0 ]; then
    echo "    ❌ 裸围栏 ${BARE} 处（\`\`\` 无语言标注）——补语言或用 \`text\`"
    P10=$((P10 + 1))
  fi
  # 标题跳跃：取本次变更 .md 的**全部**标题序列（层级需看上下文，不能只看新增行）
  # 标题跳跃为**信息位**：层级序列是全文属性，无法只在新增行上判定；全量判定
  # 会让存量跳跃当场把门禁打红，而变绿只能靠改历史——故只报告不计违规。
  JUMP=$(for f in $CHANGED_MD; do
    [ -f "$f" ] || continue
    awk '/^#{1,6} /{ match($0,/^#+/); n=RLENGTH; if(p && n>p+1) printf "%s:%d  H%d→H%d\n", FILENAME, NR, p, n; p=n }' "$f"
  done 2>/dev/null || true)
  if [ -n "$JUMP" ]; then
    printf '%s\n' "$JUMP" | sed 's|^|    ⚠️ 标题跳跃（信息位）：|' | head -5
  fi
  IMG_MISS=$(printf '%s\n' "$NEW_LINES" | grep -oE '!\[[^]]*\]\([^)h][^)]*\)' | sed -E 's/.*\((.*)\)/\1/' | while read -r p; do
    [ -z "$p" ] && continue
    [ -e "$p" ] || echo "$p"
  done 2>/dev/null || true)
  if [ -n "$IMG_MISS" ]; then
    printf '%s\n' "$IMG_MISS" | sed 's|^|    ❌ 图片断链：|' | head -5
    P10=$((P10 + 1))
  fi
  TODO=$(printf '%s\n' "$NEW_LINES" | grep -nE 'TODO|TBD|FIXME|待补|待填|XXX' | head -5 || true)
  if [ -n "$TODO" ]; then
    printf '%s\n' "$TODO" | sed 's|^|    ❌ 占位符：|'
    P10=$((P10 + 1))
  fi
  if [ "$P10" -eq 0 ]; then
    echo "  ✓ 新增行排版四面干净"
  else
    HITS=$((HITS + P10))
  fi
fi

# ── Face 11 数字与来源绑定（信息位 · 2026-10-11 新增）────────────────────
# 治「无源数字」：本次新增段落里出现 ≥2 个量化读数（%/倍/x/万/毫秒），但该段落
# 上下 3 行内没有 `📖 来源` 行——数字就悬空了（今日实锤：93%/84% 曾被安错来源）。
# 信息位不阻断：同段落复述既有来源的数字是正当的，但**必须被看见**。
echo "[Face 11] 量化数字的来源绑定（信息位）"
if [ -z "$NEW_LINES" ]; then
  echo "  ℹ️ 本次无 .md 新增行，跳过"
else
  UNSOURCED=$(node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const lines=s.split("\n").map(l=>l.replace(/^\+/,""));
      const num=/(?:\d+(?:\.\d+)?)\s*(?:%|倍|x|×|万|亿|ms|毫秒|秒|s\b)/i;
      const out=[];
      lines.forEach((l,i)=>{
        if(!num.test(l)) return;
        const hits=(l.match(new RegExp(num.source,"gi"))||[]).length;
        if(hits<2) return;
        const near=lines.slice(Math.max(0,i-3),i+4).join("\n");
        if(/📖|📐|来源：/.test(near)) return;
        out.push("「"+l.trim().slice(0,48)+"…」"+hits+" 个读数，上下 3 行无来源行");
      });
      console.log(out.slice(0,6).join("\n"));
    });' <<< "$NEW_LINES" 2>/dev/null || true)
  if [ -z "$UNSOURCED" ]; then
    echo "  ✓ 新增行中的量化读数均邻近来源行"
  else
    printf '%s\n' "$UNSOURCED" | sed 's|^|    ⚠️ |'
  fi
fi

# ── Face 12 跨文件字面重复（信息位 · 2026-10-11 新增）────────────────────
# 「内容冗余」里**可机械**的那一半：本次新增的长句（中文连续 ≥25 字）若已整段
# 出现在其他活跃文档 —— 那就是事实的第二份副本（同命题另一侧除外，故信息位）。
# 不可机械的那一半（同事实不同措辞）见 Face 9 的关键词召回，两者互为补充。
echo "[Face 12] 跨文件字面重复（信息位）"
if [ -z "$NEW_LINES" ] || [ -z "$MD_FILES" ]; then
  echo "  ℹ️ 无新增行或无可比文件，跳过"
else
  DUP=$(node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const lines=s.split("\n").map(l=>l.replace(/^\+/,""));
      const seen=new Set(); const out=[];
      for(const l of lines){
        for(const m of l.matchAll(/[\u4e00-\u9fff，。、；：（）「」]{25,}/g)){
          const frag=m[0];
          if(seen.has(frag)) continue; seen.add(frag);
          out.push(frag);
        }
      }
      console.log(out.slice(0,12).join("\n"));
    });' <<< "$NEW_LINES" 2>/dev/null || true)
  if [ -z "$DUP" ]; then
    echo "  ✓ 新增行无 ≥25 字连续中文片段（无可比对指纹）"
  else
    DUPN=0
    while IFS= read -r frag; do
      [ -z "$frag" ] && continue
      F_HIT=$(printf '%s\n' "$MD_FILES" | xargs grep -l -- "$frag" 2>/dev/null || true)
      [ -z "$F_HIT" ] && continue
      printf '    ⚠️ 已存在于 %s：%s…\n' "$(printf '%s\n' "$F_HIT" | head -2 | tr '\n' ' ')" "$(printf '%s' "$frag" | cut -c1-30)"
      DUPN=$((DUPN + 1))
    done <<< "$DUP"
    [ "$DUPN" -eq 0 ] && echo "  ✓ 长句指纹在其他活跃文档零命中（无字面重复）"
  fi
fi

# ── Face 13 文档形态机械面（增量 · 阻断级 · 2026-10-11 新增）────────────
# 把 doc-score 里**可机械**的 12 项文档形态判据（结构 5 / 排版 4 / 可读 2 / 残句 1）
# 串进日常链路——它们此前只在**发版全量评分**里跑一次（6.5 分钟，日常根本不会跑，
# 等于排版缺陷只在发版前夜才被发现）。
# 判据 = 变更文档的工作区版本 **对照 HEAD 版本**的命中数差：新增即阻断，存量只提示。
#   为什么不是「只看新增行」：这 12 项全是**整文件属性**（>200 行有无目录 / H3 碎片率 /
#   括号配对…），无法从新增行单独判定；用同文件 HEAD 版本做基线才能真正做到存量不拦。
# ⚠️ 严禁反向调用 doc-score 的**全量**模式：它会回头跑本脚本 → 无限递归。
echo "[Face 13] 文档形态机械面（增量 · 对照 HEAD · 存量不拦）"
DS_OUT=$(node tools/check/doc-score.mjs --changed 2>&1); DS_RC=$?
if [ "$DS_RC" -ne 0 ]; then
  printf '%s\n' "$DS_OUT" | sed 's/^/  /'
  echo "  ❌ Face 13 未通过：变更文档引入新的形态缺陷（结构/排版/可读/残句 12 项机械判据）"
  HITS=$((HITS + 1))
else
  printf '%s\n' "$DS_OUT" | grep -E "变更文档|✓ 变更|✓ 无变更|阻断" | sed 's/^/  /'
fi

# ── Face 14 命令漂移（阻断级 · 2026-10-11 新增）─────────────────────────
# 治「文档写的命令产品里没有」：代码块内的 `sofagent <token>` 不在真值集即红——用户照抄必失败。
# 真值集**动态提取**（不落台账＝无双事实源）：umbrella 域表 + 保留字 + 各包 package.json bin
# + 各 engine/*/cli 的 `case '…':` 标签。命令改名 → 真值集自动跟着变，文档没跟着改才红。
# 为什么**只扫代码块**：实测全文档扫误报 ≈90%（英文散文 `sofagent is / helps / turns` 被当命令）；
# 收窄到围栏内后 119 条提及只剩 5 条疑似，且 5 条全是**可机械排除的形态**（每条排除规则都对应一条
# 实测样本）：`#` 注释行 / `@` mention 前缀 / mermaid 节点（含 `<br/>`）/ YAML `- name:` 行。
# ⚠️ 本面当前**零命中**：守卫的价值在**未来**（命令改名而文档未跟改），存量 0 ≠ 不该有这面。
echo "[Face 14] 命令漂移（代码块内 sofagent <命令> 是否在真值集）"
CD_OUT=$(node -e '
const fs=require("fs");const{execFileSync}=require("child_process");
const g=(a)=>execFileSync("git",a,{encoding:"utf8"}).split("\n").filter(Boolean);
const known=new Set();
const u=fs.readFileSync("engine/umbrella/bin/sofagent.js","utf8");
// v1.5.9 修：原 /^ {2}(\\w+): \\{ pkg:/ 只匹配**裸标识符**，而 umbrella 域表键是**带引号**的
//   （`'ab-test': { pkg:`）⇒ 连字符域从未被此规则收进真值集，一直**靠旧 bin 的 `sofagent-`
//   前缀剥离**兜着；shim 退役后旧 bin 消失 ⇒ 这些域掉出真值集、文档照抄反被判红。修正为允许引号与连字符。
for(const m of u.matchAll(/^\s*\x27?([a-z][a-z0-9-]*)\x27?\s*:\s*\{ pkg:/gm))known.add(m[1]);
const rr=u.match(/const RESERVED = new Set\(\[([^\]]*)\]/);
if(rr)for(const m of rr[1].matchAll(/'"'"'([^'"'"']+)'"'"'/g))known.add(m[1]);
for(const f of g(["ls-files","*package.json"]).filter(x=>!/node_modules/.test(x))){
  try{const j=JSON.parse(fs.readFileSync(f,"utf8"));const b=j.bin;
    const ns=typeof b==="string"?[j.name]:(b?Object.keys(b):[]);
    for(const n of ns){known.add(n);const d=n.replace(/^sofagent-/,"");if(d!==n)known.add(d);}}catch(e){}
}
for(const f of g(["ls-files"]).filter(x=>/^engine\/[^/]+\/(src\/cli(\/index)?\.ts|bin\/sofagent\.js)$/.test(x)))
  for(const m of fs.readFileSync(f,"utf8").matchAll(/case\s+'"'"'([a-z][a-z0-9-]*)'"'"'\s*:/g))known.add(m[1]);
// 失明自检：真值集抽空（源码形态变了/文件被移走）必须报失明，不得拿空集跑出「零命中＝零违规」
if(known.size<20){console.log("❌ 命令真值集仅 "+known.size+" 条——提取失败（拒绝假绿）");process.exit(2);}
const files=g(["ls-files","*.md"]).filter(x=>!/^(docs\/(changelog|archive|evidence)\/|playbook\/vendor\/)/.test(x));
const bad=[];let scanned=0;
for(const f of files){
  const L=fs.readFileSync(f,"utf8").split("\n");let inF=false;
  L.forEach((l,i)=>{
    if(/^\s*(?:>\s*)*(```|~~~)/.test(l)){inF=!inF;return;}
    if(!inF)return;
    const t=l.trim();
    if(t.startsWith("#")||l.includes("<br/>")||/^\s*-\s*name:/.test(l))return;
    for(const m of l.matchAll(/\bsofagent(?:-[a-z][a-z0-9-]*)?[ \t]+([a-z][a-z0-9-]*)/g)){
      scanned++;
      const tok=m[1];
      if(tok==="sofagent"||known.has(tok))continue;
      if(l[m.index-1]==="@")continue;
      bad.push(`${f}:${i+1} 「${tok}」不在命令真值集`);
    }
  });
}
console.log(`  真值集 ${known.size} 条 · 扫 ${files.length} 份文档的代码块 · 命令提及 ${scanned} 处`);
if(bad.length){console.log(bad.join("\n"));process.exit(1);}
console.log("OK");
' 2>&1); CD_RC=$?
if [ "$CD_RC" -ne 0 ]; then
  printf '%s\n' "$CD_OUT" | sed 's/^/  /'
  echo "  ❌ Face 14 未通过：代码块内出现不在真值集的命令（文档照抄即失败）"
  HITS=$((HITS + 1))
else
  printf '%s\n' "$CD_OUT" | sed 's/^/  /'
fi

echo ""
if [ "$HITS" -gt 0 ]; then
  echo "发现 ${HITS} 处违规"
  exit 1
fi
echo "全部通过（0 处违规：内部代号 / 本机私有路径 / 来源块溯源 / 可读性棘轮 / 字数棘轮 / 抬头块 / 落盘自检 / 净增量召回 / 排版四面 / 数字来源 / 字面重复 / 文档形态 / 命令漂移 十三面）"
exit 0
