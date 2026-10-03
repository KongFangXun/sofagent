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
#   ./tools/check-dev-prompt.sh <file.md> [--strict]
#   ./tools/check-dev-prompt.sh ~/Desktop/vX.Y-dev-prompt.md
#   ./tools/check-dev-prompt.sh docs/changelog/v1.2/v1.2.3.md
#   ./tools/check-dev-prompt.sh --strict docs/changelog/v1.2/v1.2.3.md   # 历史档案也严格判
#
# 退出码:
#   0 = 全部已有引用一致（待新建/已退场/历史漂移不算错误）
#   1 = 发现不匹配的已有引用；或提取器自检失败（node 侧 RC=3，脚本统一转 1，拒绝放行）
#
# 检查项:
#   1. 文件路径引用（反引号包裹的 .ts/.sh/.mjs/.json 路径）
#   2. 函数名引用（反引号包裹的 functionName()）
#   3. 目录引用（反引号包裹的 path/ 路径）
#   4. 快照标记对账（`<file>.md`（N 行）——声明行数 vs 实际 wc -l）
#   5. 任务书零分支（`方案 A/B` / `二选一` / `视情况而定` / `由你决定` …）——
#      交给执行方的任务书**不得留选择**：出题方须在出题阶段比完并**选定一条**，只写
#      「选定方案 + 一句话理由 + 执行步骤」；未选项不进任务书。
#      口径：**只管落盘物**——非 prompt 类文件（报告/讨论稿/开发日志）由内核 SKIP 并打印原因
#      （沟通阶段允许多方案 + 推荐，落盘阶段只留一条）。
#      判据 / 豁免（否定语境 + 行哈希台账）/ 失效模式分析见 tools/check/lib/prompt-fork-lint.mjs 头注释。
#   6. 符号归属（`<file>.<ext>` 的 `<symbol>`——O-3 / 红线 9 机械面 · 2026-09-28 落）——
#      文档写「某文件的某符号」时，断言该符号**确定义于该文件**。为什么必须有：
#      原 v1.5.4 dev prompt 曾写「`engine/audit/src/egress-audit.ts` 的 `decideEgress`」，
#      而 `decideEgress` 真实归属 `engine/rules/src/egress-policy.ts`——**路径存在性检查查不出
#      这类错**（audit 包 + 该文件都在，符号也存在，只是不在那个文件里）⇒ 施工方照抄即卡。
#      判据：文件存在 ∧ 符号在该文件有**定义**（function/const/let/var/class/type/interface/enum
#      或 export 面）⇒ ✅；文件存在 ∧ 该文件无此定义 ∧ 该符号**在别处有定义** ⇒ ❌ 归属错（点明真实定义处）；
#      其余（文件不存在 / 全仓无定义 / 命中纠错叙述行）⇒ 跳过并打印原因。
#      失效模式分析：① **误报**——文档引用纠错/引述旧错（如「原 prompt 写 `a.ts` 的 `b`，实为…」）
#        会被判归属错 ⇒ 豁免：行内含 纠错/引述语境词（原 prompt/勘误/真实归属/不在…包/实测/错误）即跳过；
#      ② **漏报**——符号为 re-export / 同名多定义时可能判 ✅ 或跳过 ⇒ 宁可漏报不误报（与既有纪律一致）；
#      ③ **提取失灵**——A_RE 被改坏 ⇒ 提取器自检位 16 报 RC=3 拒绝放行。
#
# 标记：
#   ✅ 一致
#   ⚠️  路径缺前缀（engine/ FORGE/ 等，含跨多级简写）→ 警告，不计错误
#   📋 待新建／待归档／迁移改名目标（该引用本就应当尚不存在）→ 不计错误
#   🗑  已退场（文档声明该路径/函数已移除，本就应当不存在）→ 不计错误
#   ⚠️  ℹ️  🔄 缺前缀／相对路径描述／运行时产物或非纯路径 → 跳过或警告
#   ❌ 真不一致（路径错位／文件不存在／函数未找到定义／快照行数漂移）
#   🕘 历史漂移——冻结的历史开发日志里同一类不一致。只列出、单列计数，
#      不构成失败（历史档案是发布时点快照，模块迁移后必然漂移）；--strict 强制按 ❌ 判
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
#   ⑤ 表格行的判定域 = 以动作词**开头**的单元格（动作列）+ 引用所在单元格，禁整行 grep 动词——
#      整行会让说明列的散文动词外溢：「| `a.ts` | 修改 | 移除旧分支 |」会被判成退场（假绿）。
#      行内无动作列时判定域收窄到**引用自己那一格**，不回落到整行（回落即恢复整行归因）。
#   ⑥ 函数「定义」模式必须覆盖**带参数**签名——旧实现四个分支三个要求空参数列表
#      `foo()`，且用 `[[:<:]]`（GNU 扩展，本机 BSD grep 不支持，分支恒不命中）
#      ⇒ 任何带参 TS 函数都报「未找到定义」（假红，全量复核占 84/283）。
#   ⑦ 门禁只扫源码：`--exclude-dir=dist`——函数从 src 删掉但残留在陈旧 dist/
#      里会让「未找到定义」变假绿。
#   ⑧ 「本就应当尚不存在」有三类，全部只影响「不存在」时的归类，不许动「存在即 ✅」：
#      · 📋 待新建（新建族动词，按项归属）
#      · 📋 待归档（归位族动词：归档/移至/归并至——目标是按需创建的目录）
#      · 📋 迁移改名目标（引用紧跟在 → / -> / ⇒ / => / 改为 之后）
#      归位与箭头只放行**目标**：箭头左侧的旧路径、动词之前的原路径照样按存在性判错。
#   ⑨ 报「同源」是断言，须有据：同名项另有 N 处时只报「另有 X，是否同源需人工确认」，
#      不得写成「实际位于 X」——实锤目录清单里恰好同名的无关目录（docs/archive 之于
#      FORGE/lessons/archive/）被断言成迁移去处。
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

# 参数：<file.md> [--strict]。允许标志位与路径任意顺序。
# --strict：历史档案也按严格口径判定（默认历史档案归「🕘 历史漂移」、不构成失败）。
STRICT=0
SECTION_RECONCILE=0
SR_MODE=""
FILE=""
PROMPT_FILE=""
for _a in "$@"; do
  case "$_a" in
    --strict) STRICT=1 ;;
    --section-reconcile) SECTION_RECONCILE=1 ;;
    --partial) SR_MODE="partial" ;;
    *) if [ -z "$FILE" ]; then FILE="$_a"; elif [ -z "$PROMPT_FILE" ]; then PROMPT_FILE="$_a"; fi ;;
  esac
done

if [ -z "$FILE" ]; then
  echo "用法: ./tools/check-dev-prompt.sh <file.md> [--strict]"
  echo "  检查开发日志或 dev prompt 中的代码引用是否与实际代码库一致"
  echo "  --strict  历史档案（版本低于当前根包版本）也按严格口径判定"
  echo "  --section-reconcile <devlog.md> <prompt.md> [--partial]  章节对照表机器断言（归一化对账：章名取规范主名做键 + 元章/非任务节显式豁免 + 同键章任务分解 ≥ devlog 验收；--partial = 补做 prompt 范围内对账，devlog 未覆盖章降为提示）"
  exit 1
fi

FILE="${FILE/#\~/$HOME}"

if [ ! -f "$FILE" ]; then
  echo "❌ 文件不存在: $FILE"
  emit_coverage_line "check-dev-prompt" "0" "0" "0"
  exit 1
fi

# ─── 章节对照表机器断言（v1.5.4 承接 devlog〈待补清单〉#7；判据 v2 归一化对账）──────────────
# 用法：check-dev-prompt.sh --section-reconcile <devlog.md> <prompt.md>
#
# v1 判据（章标题字符串全等 + 全文 checkbox 计数相等）对真实任务书必红（实测 2026-09-28
#   team-lead 验收抓到）：① devlog 章名是全名（含括注/拍板日期），prompt 节名是短形或
#   「第N章 · 」前缀形——字符串相等永不成立；② devlog 元章（定位/依赖/审查修复批）与
#   prompt 非任务节（红线/开工前/纪律/附录等）互相缺席——集合差天然非空；③ 「验收条数」
#   两侧口径不同形（devlog 验收标准 vs prompt 任务分解 checkbox，后者 ⊇ 前者）。
#   ⇒ 只有合成夹具能绿的判据 = 假门禁。v2 改归一化对账（三段）：
#
# ① 章名归一化（canonical key）——取「规范主名」做键：
#     a. 先剥 prompt 侧「第N章 · 」前缀（`第[零一二三四五六七八九十百0-9]+章 · `）
#     b. 再取首个 `·` / `：` / `（` 之前的段（无分隔符则整名），去首尾空白
#     c. 键还需非空且含至少一个非标点字符（防空键互相误配）
# ② 元章/非任务节显式豁免清单（两侧各自列，逐条可审计——豁免必须可见）：
#     DEVLOG_META  ：devlog 侧不产任务的元章（对账对象不存在于 prompt）
#     PROMPT_META  ：prompt 侧非任务节（红线/开工/纪律/对照表/附录/完成判据等）
#     豁免按归一化键精确匹配；清单外仍有集合差 ⇒ 红（防清单膨胀静默放水）。
# ③ 验收条数同键比对——只在「同键章」内比：devlog 侧 `- [ ]` 计数 vs prompt 侧
#     `- [ ]` 计数；两侧口径不同形（prompt 是任务分解 ⊇ devlog 验收标准）⇒ 判据取
#     「prompt 侧 ≥ devlog 侧」（缺任务分解即红；prompt 更细不红——它该更细）。
#     devlog 侧该章为 0 条（元章/无验收章）⇒ 不比（豁免面内已排除元章；任务章 0 条
#     且 prompt 也 0 条时按通过计）。
#
# 校准证据（本判据 v2 的实测基准，见 devlog v1.5.4〈待补清单〉#7 验收）：
#   docs/changelog/v1.5/v1.5.4.md ↔ 原版 dev-prompt（八章任务 + 元章豁免）⇒ rc=0
#   反向：临时删 prompt 一章 ⇒ 必红 ⇒ 还原。
NODE="${NODE:-node}"
if [ "$SECTION_RECONCILE" = "1" ]; then
  if [ -z "$PROMPT_FILE" ] || [ ! -f "$PROMPT_FILE" ]; then
    echo "❌ --section-reconcile 需两个文件：<devlog.md> <prompt.md>（第二参缺失或不存在：${PROMPT_FILE:-未提供}）"
    emit_coverage_line "check-dev-prompt" "0" "0" "0"
    exit 1
  fi
  "$NODE" -e '
  const fs=require("fs");
  const dl=fs.readFileSync(process.argv[1],"utf8").split("\n");
  const pl=fs.readFileSync(process.argv[2],"utf8").split("\n");

  // ── ① 章名归一化：剥外层引导件 → 取首个 ·/：/（/；前的规范主名 ──
  // 顺序：外层序数「一、」→「第N章 ·/空格」→「任务 X（…）· 」→ 分隔符截断
  const canon=(h)=>{
    let s=h.trim()
      .replace(/^[零一二三四五六七八九十百0-9]+、[ \t]*/,"")                                  // 剥外层序数（devlog「五、」/ prompt「三、」同规则）
      .replace(/^任务[ \t]*[A-Za-z][ \t]*(?:[（(][^（）()]*[）)])?[ \t]*·[ \t]*/,"")            // 剥「任务 A（…）· 」引导前缀
      .replace(/^[（(][^（）()]*[）)][ \t]*·[ \t]*/,"")                                         // 剥「（任务 X）· 」类引导前缀
      .replace(/^第[零一二三四五六七八九十百0-9]+章(?:[ \t]*·[ \t]*|[ \t]+)/,"")                // 剥「第N章 · 」/「第N章 」前缀（序数剥净后才能命中「第五章」内嵌形）
      .replace(/^[零一二三四五六七八九十百0-9]+、[ \t]*/,"");                                   // 复剥一层序数（「一、第五章」双前缀形态）
    const cut=Math.min(...["·","：",":","（","("].map(c=>{const i=s.indexOf(c);return i<0?s.length:i;}));
    s=s.slice(0,cut).trim().replace(/[，,。;；、\s]+$/,"").trim();
    // 键须含至少一个字母/数字（防分隔符切出的空键互相误配）
    return /[\p{L}\p{N}]/u.test(s)?s:"";
  };
  // 重塑名别名（同义改称，显式可审计；新增须附一句「为何同义」注释）
  const ALIAS={"首项硬交付落位":"首项硬交付"};  // 补做 prompt 任务 B 节名 = devlog〈首项硬交付〉章的落位施工（同题改称）

  // ── ② 元章/非任务节显式豁免清单（按原始章标题前缀匹配 · 逐条可审计）──
  // devlog 侧元章：目标陈述/依赖声明/审查纪实——不产任务，prompt 无对应节
  const DEVLOG_META=["定位","与后续版本的依赖","审查修复批"];
  // prompt 侧非任务节：红线/开工/对照表/纪律/附录/已完成区/全局验收/收口（原版与补做两形态并列）
  const PROMPT_META=[
    "零、","零·五、","一、开工前","一、未完成面清单","一·五、",
    "十、章节对照表","十一、全局验收","十二、已完成区","十三、开发纪律","十四、发布检查清单",
    "四、任务 C","五、门禁与全局验收","六、纪律","七、完成判据","附录"
  ];
  const isMeta=(h,list)=>list.some(p=>h.startsWith(p));

  // partial 模式（补做/收尾 prompt）：prompt 只覆盖剩余工作面 ⇒ devlog「章缺于 prompt」降为
  // 可见提示（ℹ️ + skipped++），反向断言（prompt 任务节须有 devlog 同键章）与同键章条数断言不降。
  const PARTIAL=(process.argv[3]==="partial");

  // 分节收集：归一化键 → { h 原始标题, n 未勾, x 已勾 }；键撞车（两节同键）= 映射歧义 ⇒ 红
  const collect=(ls)=>{
    const m=new Map(); let cur=null;
    for(const l of ls){
      if(/^##\s/.test(l)){
        const h=l.replace(/^##\s+/,"").trim();
        let k=canon(h); if(ALIAS[k])k=ALIAS[k];
        cur={h,k,n:0,x:0};
        if(m.has(k)){cur.dup=m.get(k);}else{m.set(k,cur);}
        continue;
      }
      if(!cur)continue;
      if(/^\s*-\s*\[ \]/.test(l))cur.n++;
      else if(/^\s*-\s*\[[xX]\]/.test(l))cur.x++;
    }
    return m;
  };
  const D=collect(dl),P=collect(pl);
  let bad=0, skipped=0, asserts=0, uncovered=0;
  for(const [k,d] of D){ if(d.dup){console.log("❌ devlog 归一化键撞车（两章同键「"+k+"」，映射歧义）: "+d.h+" / "+d.dup.h);bad=1; } }
  for(const [k,p] of P){ if(p.dup){console.log("❌ prompt 归一化键撞车（两节同键「"+k+"」，映射歧义）: "+p.h+" / "+p.dup.h);bad=1; } }
  if(bad)process.exit(1);
  // devlog 任务章（豁免清单外）逐键断言：prompt 须有同键章 + 验收条数不小于
  for(const [k,d] of D){
    if(isMeta(d.h,DEVLOG_META)){skipped++;continue;}
    if(!k){asserts++;console.log("❌ devlog 章名归一化后为空键（无法对账）: "+d.h);bad=1;continue;}
    if(!P.has(k)){
      if(PARTIAL){uncovered++;console.log("ℹ️ devlog 章未入本 prompt（partial 范围外，已提示不判红）: 键「"+k+"」");skipped++;continue;}
      asserts++;console.log("❌ 任务章仅见于 devlog（prompt 缺）: 键「"+k+"」（原章名: "+d.h+"）");bad=1;continue;
    }
    asserts++;
    const p=P.get(k);
    const dt=d.n+d.x, pt=p.n+p.x;   // 两侧都按「验收项总数」计（prompt 执行中打勾不构成假红）
    if(pt<dt){console.log("❌ 章「"+k+"」prompt 任务分解条数 "+pt+" < devlog 验收条数 "+dt+"（任务分解不得少于验收标准）");bad=1;}
  }
  // prompt 任务节（豁免清单外）反向断言：devlog 须有同键章（partial 模式同样生效——prompt 不得凭空造章）
  for(const [k,p] of P){
    if(isMeta(p.h,PROMPT_META)){skipped++;continue;}
    asserts++;
    if(!k){console.log("❌ prompt 节名归一化后为空键（无法对账）: "+p.h);bad=1;continue;}
    if(!D.has(k)){console.log("❌ 任务节仅见于 prompt（devlog 缺）: 键「"+k+"」（原节名: "+p.h+"）");bad=1;}
  }
  const matched=[...D.keys()].filter(k=>{const d=D.get(k);return !isMeta(d.h,DEVLOG_META)&&P.has(k);}).length;
  if(!bad)console.log("✅ 章节对照归一化对账"+(PARTIAL?"（partial：补做范围 "+matched+" 章同键，devlog 未覆盖 "+uncovered+" 章已提示）":"：任务章双向齐（"+matched+" 章同键）")+"· 同键章任务分解条数 prompt ≥ devlog 验收条数 全过（豁免可见：devlog 元章 "+[...D.values()].filter(d=>isMeta(d.h,DEVLOG_META)).length+" / prompt 非任务节 "+[...P.values()].filter(p=>isMeta(p.h,PROMPT_META)).length+"）");
  process.stdout.write("[check:coverage] script=check-dev-prompt(--section-reconcile"+(PARTIAL?" --partial":"")+") asserts="+asserts+" covered=2 skipped="+skipped+"\n");
  process.exit(bad);
  ' "$FILE" "$PROMPT_FILE" "$SR_MODE"
  exit $?
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

# ─── 历史档案判定 ───
# 冻结的历史开发日志里，路径是**发布时点快照**——模块迁移后必然与今日代码库漂移。
# 对它报 ❌ 既无意义（没人会去改历史档案）又淹没本版信号（全量复核时 270+ 处噪声）。
# 处理：🕘 照常逐条列出但归入「历史漂移」单列计数，不构成失败；--strict 可强制严格。
# 判据 = 目标位于 docs/changelog/v<X>/ 且 X < 根 package.json 的当前版本（相等=正在发版的那版，仍严格）。
LEGACY=0
LEGACY_VER=""
case "$FILE" in
  *changelog/v*/*.md)
    _fver=$(basename "$FILE" .md)
    case "$_fver" in
      v[0-9]*.[0-9]*.[0-9]*)
        _cur=$("$NODE" -p "require('./package.json').version" 2>/dev/null || true)
        if [ -n "$_cur" ]; then
          _cmp=$(awk -v a="${_fver#v}" -v b="$_cur" 'BEGIN{
            na=split(a,A,"."); nb=split(b,B,".");
            for(i=1;i<=3;i++){ x=A[i]+0; y=B[i]+0;
              if(x<y){print -1; exit} if(x>y){print 1; exit} }
            print 0 }')
          if [ "$_cmp" = "-1" ]; then LEGACY=1; LEGACY_VER="${_fver#v}"; fi
        fi
        ;;
    esac
    ;;
esac

# 历史档案下，❌ 标记改印 🕘——逐条仍可见，但一眼能辨「这是冻结历史」而非「本版没对齐」
EMARK="❌"
if [ "$LEGACY" = "1" ] && [ "$STRICT" != "1" ]; then EMARK="🕘"; fi

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
// 符号归属（检查项 6）：`<file>.<ext>` 的 `<symbol>`——claim「symbol 定义于 file」
// 允许「的」与符号间的粗体标记（`a.ts` 的 **`foo`**）。
var A_RE = /`([^`]+\.(?:ts|sh|mjs))`[ \t]*的[ \t*]*`([A-Za-z_][A-Za-z0-9_]*)`/g;

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
if (probeHit(A_RE, "`engine/x/a.ts` 的 `foo`")) P_POS |= 16;

if (!probeHit(F_RE, "`a.md`")) P_NEG |= 1;            // 扩展名白名单被放宽
if (!probeHit(D_RE, "`engine/x/a.ts`")) P_NEG |= 2;   // 目录必须以 / 收尾
if (!probeHit(N_RE, "`foo`")) P_NEG |= 4;             // 函数名必须带 ()
if (!probeHit(L_RE, "`a.md`")) P_NEG |= 8;            // 快照必须带「N 行」
if (!probeHit(A_RE, "`foo()`")) P_NEG |= 16;          // 归属必须「`file` 的 `sym`」双反引号形态

if (P_POS !== 31 || P_NEG !== 31) {
  process.stderr.write("提取器自检失败：正向=" + P_POS + "/31 负向=" + P_NEG + "/31\n");
  process.exit(3);
}

// 全文级结构上下文（保持原语义）：全文声明「分目录/物理分子/目标结构」时，
// tools/ 下尚不存在的路径属本版规划产物
var hasSplitCtx = false;
for (var si = 0; si < lines.length; si++) {
  if (/分目录|物理分子|目标结构/.test(lines[si])) { hasSplitCtx = true; break; }
}

// 🔴 待新建判定：动词只管辖「本项」，禁止整行归因（历史假绿实锤）。
//   ① 表格行 = 单条记录，动词常写在路径**之后**的「改动」列 → 判定域 = 动作列 + 引用列
//      （rowScope()）；行内无纯动作词单元格时才回落整行
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

// 表格行的判定域：以**动作词开头**的单元格（动作列）+ 引用所在单元格。
//
// 🔴 为什么不能整行 grep 动词：表格行的说明列是散文，一句「移除旧分支」「新建索引」
//    就能把该行**别的**列上的引用判成退场／待新建 = 假绿
//    （实锤形态：`| \`a.ts\` | 修改 | 移除旧分支逻辑 |` 整行判成「已退场」）。
// 🔴 为什么动作列必须是**格首**匹配而不是整格匹配：整格匹配在「格内无纯动作词」的行上
//    退化成回落整行，说明列的动词照样外溢。实锤 v1.2.5：
//    `| \`engine/daemon/src/im-outbox.ts\`（或等效） | 成功删除 / 失败移入 failed/ / 7 天清理 |`
//    ——该文件是**要改的对象**，却被说明列的「移入」判成归位目标。
// 🔴 行内没有动作列时，判定域收窄到**引用自己那一格**，不回落到整行——回落即恢复整行归因，
//    与判定纪律①相抵。副作用：动词写在格的**中段**（如「推送失败 → 移入 \`x/\`」）不再算数，
//    该类行归错位/不存在，由人工清单兜（宁可假红可见，不要假绿静默）。
// 注：字符类刻意写 `[ \t\r*]` 而非 `[\s*]`——`playbook/regression-checklist.md` 有一道
// 扫门禁脚本「活代码残留 \s」（BSD sed 不支持）的守卫，其排除法是按行启发式（含 matchAll/.test( 的行
// 视为 JS 正则放行）。JS 的 `\s` 本身无害，但为不给那道守卫添新命中，这里用显式空白字符类。
var ACTION_CELL_RE = /^[ \t\r*]*(待?新建|新文件|新增|修改|改动|扩展|升级|更新|重构|改造|重写|移除|删除|退场|下线|废弃|退役|归档|移至|移入|归并至|归位)/;

function rowScope(line, ref, refIndex) {
  var cells = line.split("|");
  var actionIdx = -1, refIdx = -1;
  for (var i = 0; i < cells.length; i++) {
    if (actionIdx < 0 && ACTION_CELL_RE.test(cells[i])) actionIdx = i;
    if (refIdx < 0 && cells[i].indexOf(ref) >= 0) refIdx = i;
  }
  if (actionIdx < 0) return refIdx >= 0 ? cells[refIdx] : line;
  return cells[actionIdx] + "\n" + (refIdx >= 0 ? cells[refIdx] : "");
}

function isPlannedRef(ref, line, refIndex) {
  if (ref.indexOf("tools/") === 0 && hasSplitCtx) return true;
  // 表格行 = 单条记录，动词常写在路径之后的「改动」列 → 判定域收窄到动作列（见 rowScope）
  if (/^[ \t]*\|/.test(line)) return /新建|新文件|新增/.test(rowScope(line, ref, refIndex));
  // 自有后置注记是最局部证据，且必须排在「改动族否决」之前——
  // 否则前一项的注记（如「（协议执行器改造）」）会沿着路径列举式的外层分隔符
  // 外溢，把后面所有项一并否决 = 假红（「涉及文件（预估）」表实测实锤）。
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
// 🔴 另收「纯导航符」（`/`、`../`、`./`）：它们**恒**存在，判成 ✅ 一致等于往
//    asserts 里灌免费绿灯——断言数被稀释，覆盖度行就失去意义。
function isNonPath(ref) {
  if (/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//.test(ref)) return true;
  if (ref.indexOf(" ") >= 0) return true;
  if (/^[.\/]+$/.test(ref)) return true;
  return false;
}

// 🔴 退场类引用：该路径**本来就应当不存在**（移除/退场/删除/下线/废弃）。
// 实锤 v1.4.8「移除未接线的 Agent Mailbox 模块」+ `mailbox/`——模块确已删除，
// 文档完全正确，原实现却按「目录不存在」报 ❌。
// 归属规则与「待新建」一致：表格行按整行判，散文行按项前缀/自有注记判，禁整行外溢。
var RETIRE_RE = /移除|退场|删除|下线|废弃|退役/;
function isRetiredRef(line, refIndex, ref) {
  if (/^[ \t]*\|/.test(line)) return RETIRE_RE.test(rowScope(line, ref, refIndex));
  if (RETIRE_RE.test(itemPrefix(line, refIndex))) return true;
  return RETIRE_RE.test(ownAnnotation(line, refIndex, ref));
}

// 🔴 归位目标：文档指示「把 X 归档／移至 Y」——Y 是**目标位置**，本就可能尚未创建。
// 实锤 releasing/06-doc-finalize.md「归档已泛化条目至 `FORGE/lessons/archive/`」：
// FORGE/lessons/ 在、archive/ 按需创建，原实现报「❌ 路径错位（同名目录实际位于 docs/archive）」
// ——既假红，又把一个不相干目录断言成同源。归属规则与退场类一致。
// 动词方向自洽：「原 X 移至 Y」里 X 在动词**之前**，itemPrefix 扫不到它，
// 该引用仍走错位报错——只放行目标 Y，不放开真错位。
var RELOCATE_RE = /归档|移至|移入|归并至|归位|收纳/;
function isRelocateTarget(line, refIndex, ref) {
  if (/^[ \t]*\|/.test(line)) return RELOCATE_RE.test(rowScope(line, ref, refIndex));
  if (RELOCATE_RE.test(itemPrefix(line, refIndex))) return true;
  return RELOCATE_RE.test(ownAnnotation(line, refIndex, ref));
}

// 🔴 迁移/改名目标：引用紧跟在箭头（→ / -> / ⇒ / => / 改为 / 变为）之后 ⇒
// 它是**目标位置**，本就可能尚未创建。实锤 v1.5.0 §九「`engine/inject/` → `engine/inject/`」：
// inject/ 是本版改名目标，原实现报「❌ 目录不存在」= 假红。
// 方向由箭头本身保证：箭头**左侧**的旧路径不受此规则保护，仍按存在性判。
function isArrowTarget(line, refIndex) {
  var pre = line.slice(Math.max(0, refIndex - 8), refIndex);
  return /(→|->|⇒|=>|改为|变为|换成)[\s*]*$/.test(pre);
}

// 单一入口：该引用是否属「本就应当尚不存在」类（待新建 / 待归档 / 迁移改名目标）。
// 三者都只影响「不存在」时的归类，不改变「存在即 ✅」的判定顺序。
function isPendingRef(ref, line, refIndex) {
  return isPlannedRef(ref, line, refIndex)
      || isRelocateTarget(line, refIndex, ref)
      || isArrowTarget(line, refIndex);
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
        var planned = isPendingRef(p, line, m.index);
        console.log("P|" + p + "|" + (planned ? "planned" : (isRetiredRef(line, m.index, p) ? "retired" : c)));
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
      console.log("F|" + f + "|" + (planned ? "planned" : (isRetiredRef(line, m.index, f) ? "retired" : c)));
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
        var planned = isPendingRef(d, line, m.index);
        console.log("D|" + d + "|" + (planned ? "planned" : (isRetiredRef(line, m.index, d) ? "retired" : c)));
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

// 符号归属（检查项 6）：`<file>` 的 `<symbol>`
// 豁免：纠错/引述语境行（引用「旧错写法」以指出其错，不是真主张归属）——
//   行内含 原 prompt/勘误/真实归属/真实定义/不在…包/错误写法/归属错/❌ 任一即跳过。
//   （失效模式①的机械解，见文件头检查项 6 说明。）
var ATTR_EXEMPT_RE = /原 prompt|原任务书|勘误|真实归属|真实定义|不在[^\n]{0,8}包|错误写法|归属错|❌/;
seen = {};
lines.forEach(function(line) {
  if (ATTR_EXEMPT_RE.test(line)) return;
  [...line.matchAll(A_RE)].forEach(function(m) {
    var p = m[1], sym = m[2];
    var k = "A|" + p + "|" + sym;
    if (!seen[k]) {
      seen[k] = 1;
      console.log("A|" + p + "|" + sym);
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
RETIRED=0
DRIFT=0
# 检查项 5（任务书零分支）计数：违规=决定退出码；豁免/结论=覆盖度证据
FORK_VIOLATIONS=0
FORK_EXEMPT=0
FORK_CONCL=0
FORK_SKIPPED=0

# 记一次「引用不一致」：历史档案且未开 --strict → 归入 🕘 历史漂移（不构成失败）；
# 其余情形计入 ERRORS（决定退出码）。判定与打印共用 EMARK，二者不会走调。
mark_err() {
  if [ "$LEGACY" = "1" ] && [ "$STRICT" != "1" ]; then
    DRIFT=$((DRIFT + 1))
  else
    ERRORS=$((ERRORS + 1))
  fi
}

echo "=== check-dev-prompt: $(basename "$FILE") ==="
if [ "$LEGACY" = "1" ]; then
  if [ "$STRICT" = "1" ]; then
    echo "（历史档案 v${LEGACY_VER} · --strict 已开：按严格口径判，漂移计入错误）"
  else
    echo "（历史档案 v${LEGACY_VER}：发布时点冻结快照，漂移标 🕘 单列计数、不构成失败；--strict 可强制严格）"
  fi
fi
echo ""

# ─── 辅助函数 ───
# 函数「定义」模式（单一出处）——四分支覆盖：
#   ① function 声明（带不带参数都命中，含参数表折行到下一行的情况）
#   ② const/let/var 赋值 + 类成员修饰符（箭头函数 / 函数表达式 / 可选类型标注）
#   ③ 方法或 TS 签名（带 {} 或 ; 收尾，覆盖 `foo(a: string): void {`）
#   ④ 多行参数表首行（必须带定义侧关键字，避免把「await foo(」这类调用点当定义）
# 🔴 不要退回旧实现：四个分支里三个要求**空参数列表** `foo()`，且用 `[[:<:]]`
#    （GNU 扩展，本机 BSD grep 不支持，该分支恒不命中）⇒ 任何带参 TS 函数都报
#    「未找到定义」（假红实锤：全量复核 84/283 条由此产生）。
func_def_pat() {
  local f="$1"
  printf '%s' "(^|[^A-Za-z0-9_])function[[:space:]]+${f}[[:space:]]*\\(|(^|[^A-Za-z0-9_])(const|let|var|readonly|static|public|private|protected)[[:space:]]+${f}[[:space:]]*(:[^=]*)?[=(]|(^|[^A-Za-z0-9_])${f}[[:space:]]*\\([^)]*\\)[[:space:]]*(:[^=;{]*)?[;{]|(^|[^A-Za-z0-9_])(export|default|declare|async|public|private|protected|static)[[:space:]]+${f}[[:space:]]*\\([[:space:]]*\$"
}

# 函数定义搜索根——docs/ SKILL/ FDE/ 是文档面（被扫对象），不在此列
# ⚠️ 仓根 shell 脚本同样定义大量函数（`install_cli` 等在 `install.sh:884`），
#    此前不在此列 ⇒ dev prompt 里任何 `install_cli()` 形态的引用恒报「未找到定义」
#    假红（实测：函数真实存在，仅因扫描面漏了仓根）。新增仓根脚本时同批登记。
CODE_ROOTS="engine/ tools/ FORGE/src/ playbook/ bootstrap.sh install.sh"

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
  elif [ "$c" = "retired" ]; then
    # 文档声明该路径已移除/退场/下线——本就应当不存在，不是不一致
    printf '  🗑  %s (已退场，本就应当不存在)\n' "$ref"
    RETIRED=$((RETIRED + 1))
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
          printf '  %s %s -> 路径错位（该处不存在；同名文件另有：%s，是否同源需人工确认）\n' "$EMARK" "$ref" "$(echo "$base" | tr '\n' ' ')"
        else
          printf '  %s %s -> 文件不存在\n' "$EMARK" "$ref"
        fi
        mark_err
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
      iface=$(grep -rl --include="*.ts" --exclude-dir=dist --exclude-dir=node_modules \
        -E "$(func_def_pat "$func")" engine/ 2>/dev/null | head -1 || true)
      if [ -n "$iface" ]; then
        printf '  ✅ %s() (interface method)\n' "$func"
        OKS=$((OKS + 1))
        continue
      fi
      ;;
  esac

  # 🔴 --exclude-dir=dist：只认源码定义——函数从 src 删掉但残留在陈旧 dist/ 里
  #    会让「未找到定义」变假绿。
  hits=$(grep -rl --include="*.ts" --include="*.sh" --include="*.mjs" \
    --exclude-dir=dist --exclude-dir=node_modules \
    -E "$(func_def_pat "$func")" $CODE_ROOTS 2>/dev/null | head -1 || true)

  if [ -n "$hits" ]; then
    printf '  ✅ %s()\n' "$func"
    OKS=$((OKS + 1))
  elif [ "$c" = "planned" ]; then
    printf '  📋 %s() (待新建)\n' "$func"
    PLANNED=$((PLANNED + 1))
  elif [ "$c" = "retired" ]; then
    printf '  🗑  %s() (已退场，本就应当不存在)\n' "$func"
    RETIRED=$((RETIRED + 1))
  else
    printf '  %s %s() -> 未找到定义\n' "$EMARK" "$func"
    mark_err
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
  elif [ "$c" = "retired" ]; then
    # 文档声明该目录已移除/退场/下线——本就应当不存在，不是不一致
    printf '  🗑  %s (已退场，本就应当不存在)\n' "$ref"
    RETIRED=$((RETIRED + 1))
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
          printf '  %s %s -> 路径错位（该处不存在；同名目录另有：%s，是否同源需人工确认）\n' "$EMARK" "$ref" "$(echo "$base" | tr '\n' ' ')"
        else
          printf '  %s %s -> 目录不存在\n' "$EMARK" "$ref"
        fi
        mark_err
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
    printf '  %s %s -> 快照文件不存在（声明 %s 行）\n' "$EMARK" "$ref" "$n"
    mark_err
    continue
  fi

  actual=$(wc -l < "$cand")
  actual="${actual// /}"

  if [ "$actual" = "$n" ]; then
    printf '  ✅ %s（%s 行 · 一致）\n' "$ref" "$n"
  else
    diff=$((actual - n))
    printf '  %s %s -> 声明 %s 行，实际 %s 行（差 %s）——改完日志记得同步这个快照标记\n' \
      "$EMARK" "$ref" "$n" "$actual" "$diff"
    mark_err
  fi
done < "$TMPFILE"

if [ "$SNAPSHOTS" -eq 0 ]; then
  echo "  （无快照标记，跳过）"
fi

echo ""

# ─── 6. 符号归属（`<file>` 的 `<symbol>`——claim「symbol 定义于 file」· O-3）───
echo "--- 6. 符号归属（反引号内符号 ∈ 所指文件）---"
ATTR_OKS=0
ATTR_ERRS=0
ATTR_SKIP=0

# 定义形态（单一出处）：声明关键字 + 符号，或 export 面含该符号
attr_def_pat() {
  local s="$1"
  printf '%s' "(^|[^A-Za-z0-9_])(function|const|let|var|class|type|interface|enum)[[:space:]]+${s}([^A-Za-z0-9_]|\$)|export[[:space:]]*\{[^}]*[^A-Za-z0-9_]${s}[^A-Za-z0-9_]"
}

while IFS='|' read -r tag ref sym || [ -n "$tag" ]; do
  [ "$tag" != "A" ] && continue
  [ -z "${ref:-}" ] && continue
  [ -z "${sym:-}" ] && continue
  clean="${ref#./}"
  case "$clean" in node_modules/*|dist/*) continue ;; esac

  if [ ! -f "$clean" ]; then
    printf '  🔄 %s 的 %s（文件不存在——归检查项 1，跳过）\n' "$ref" "$sym"
    ATTR_SKIP=$((ATTR_SKIP + 1))
    continue
  fi

  if grep -qE "$(attr_def_pat "$sym")" "$clean" 2>/dev/null; then
    printf '  ✅ %s 的 %s\n' "$ref" "$sym"
    ATTR_OKS=$((ATTR_OKS + 1))
  else
    owner=$(grep -rlE "$(attr_def_pat "$sym")" \
      --include="*.ts" --include="*.sh" --include="*.mjs" \
      --exclude-dir=dist --exclude-dir=node_modules \
      engine/ tools/ FORGE/src/ playbook/ 2>/dev/null | head -3 | tr '\n' ' ')
    if [ -n "$owner" ]; then
      printf '  %s %s 的 %s -> 符号归属错（%s 未定义该符号；真实定义处：%s）\n' \
        "$EMARK" "$ref" "$sym" "$clean" "$owner"
      mark_err
      ATTR_ERRS=$((ATTR_ERRS + 1))
    else
      printf '  🔄 %s 的 %s（该符号全仓无定义——形态/归属需人工，跳过）\n' "$ref" "$sym"
      ATTR_SKIP=$((ATTR_SKIP + 1))
    fi
  fi
done < "$TMPFILE"

if [ "$ATTR_OKS" -eq 0 ] && [ "$ATTR_ERRS" -eq 0 ] && [ "$ATTR_SKIP" -eq 0 ]; then
  echo '  （无「`file` 的 `symbol`」归属声明，跳过）'
fi

echo ""
echo "── 任务书零分支（方案 A/B 选项）──"
# 判据与失效模式分析见 tools/check/lib/prompt-fork-lint.mjs 头注释；此处只做调用与记账。
# 口径：**只管落盘物**——basename 不含 prompt 的文件（报告/讨论稿/开发日志）由内核 SKIP 并打印
# 原因（沟通阶段允许多方案 + 推荐，落盘阶段只留选定的一条）。
FORK_LINT="${_SELF_DIR}/lib/prompt-fork-lint.mjs"
if [ ! -f "$FORK_LINT" ]; then
  echo "  ${EMARK} 零分支内核缺失（${FORK_LINT}）——拒绝假绿"
  ERRORS=$((ERRORS + 1))
elif [ -z "$NODE" ] || ! command -v "$NODE" >/dev/null 2>&1; then
  echo "  ${EMARK} 找不到 node——零分支检查无法执行，拒绝假绿"
  ERRORS=$((ERRORS + 1))
else
  FORK_OUT=$("$NODE" "$FORK_LINT" "$FILE" 2>&1); FORK_RC=$?
  if [ "$FORK_RC" -eq 3 ]; then
    echo "  ${EMARK} 零分支内核内部故障（rc=3）——拒绝放行"
    echo "$FORK_OUT" | sed 's/^/      /'
    ERRORS=$((ERRORS + 1))
  else
    while IFS=$'\t' read -r kind a b rest; do
      case "$kind" in
        VIOLATION)
          FORK_VIOLATIONS=$((FORK_VIOLATIONS + 1))
          echo "  ${EMARK} 第 ${a} 行出现分支词「${b}」：${rest}"
          ;;
        EXEMPT)
          FORK_EXEMPT=$((FORK_EXEMPT + 1))
          echo "  ℹ️  第 ${a} 行「${b}」已豁免（${rest}）"
          ;;
        SKIP)
          FORK_SKIPPED=1
          echo "  🔄 跳过：${a}"
          ;;
        SUMMARY)
          FORK_CONCL=$(printf '%s' "${a} ${b} ${rest}" | sed -n 's/.*conclusion=\([0-9]*\).*/\1/p')
          ;;
      esac
    done <<< "$FORK_OUT"
    if [ "$FORK_VIOLATIONS" -gt 0 ]; then
      ERRORS=$((ERRORS + FORK_VIOLATIONS))
      echo "  ${EMARK} 任务书留了选择：${FORK_VIOLATIONS} 处分支（执行方会反问「选哪个」——出题方须在出题阶段选定一条）"
      echo "      修法：只写「选定方案 + 一句话理由 + 执行步骤」；未选项不进任务书（留档写内部记录）"
    elif [ "$FORK_SKIPPED" -eq 0 ]; then
      echo "  ✅ 零分支：无分支词（结论标记 ${FORK_CONCL} 处 · 豁免 ${FORK_EXEMPT} 处）"
    fi
  fi
fi

# ─── 汇总 ───
echo "=== 汇总 ==="
echo "  ✅ 一致: $OKS"
echo "  ${EMARK} 错误: $ERRORS"
echo "  ⚠️  警告: $WARNINGS"
echo "  📋 待新建/待归档: $PLANNED"
echo "  🗑  已退场: $RETIRED"
if [ "$DRIFT" -gt 0 ] || [ "$LEGACY" = "1" ]; then
  echo "  🕘 历史漂移: ${DRIFT}（冻结档案，不计失败）"
fi
echo "  🔄 跳过: $SKIPPED"
echo "  🚫 分支词（零分支检查）: ${FORK_VIOLATIONS}（豁免 ${FORK_EXEMPT} · 结论标记 ${FORK_CONCL}）"
echo "  🔗 符号归属（检查项 6）: ${ATTR_OKS} 一致 / ${ATTR_ERRS} 归属错 / ${ATTR_SKIP} 跳过"

# 覆盖度口径（本脚本，G-2② 要求注明）：
#   asserts = 做出判定的引用数（✅一致 + ❌错误 + 🕘历史漂移 + ⚠️缺前缀 + 📋待新建 + 🗑已退场）
#             ——历史漂移必须计入：否则历史档案会报 asserts=0，读起来像「什么都没查」
#   covered = 被读取的源文件数——本脚本单文件入口，恒为 1
#   skipped = 显式跳过的引用数（非纯路径 URL/内嵌命令 + 运行时目录 + 相对路径描述 + 归属跳过）
#             ——符号归属的 ✅ 计入 asserts；其 ❌ 已并入 ERRORS（不重复计）
ASSERTS=$((OKS + ERRORS + DRIFT + WARNINGS + PLANNED + RETIRED + FORK_VIOLATIONS + FORK_EXEMPT + FORK_CONCL + ATTR_OKS))
emit_coverage_line "check-dev-prompt" "$ASSERTS" "1" "$((SKIPPED + ATTR_SKIP))"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "${EMARK} 发现 $ERRORS 个不匹配引用——开发 prompt 跟代码库不对齐"
  exit 1
else
  echo ""
  if [ "$DRIFT" -gt 0 ]; then
    echo "✅ 本版引用一致；另有 $DRIFT 处 🕘 历史漂移（冻结档案，不计失败）"
  else
    echo "✅ 所有已有代码引用与代码库一致"
  fi
  exit 0
fi
