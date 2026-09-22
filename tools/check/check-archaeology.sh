#!/bin/bash
# ============================================================
# check-archaeology.sh · 规则文档「禁考古」守卫
# ============================================================
# 门禁目的：规则文档的正文只写**规则**，不写**出身**。
#   规则是长期有效的判据；出身（哪版加的、哪天定的、第几跑发现的、谁拍板的）
#   是一次性叙事——它属于 changelog 归档，不属于规则本体。混进规则正文的代价：
#     ① 读者（第一读者是模型）要在「哪个版本」和「该怎么做」之间做无谓的取舍，
#        长文件里中段规则最易被跳过（lost-in-the-middle）；
#     ② 出身一旦过期就成了假信息——「（某版实锤）」在后来的版本里已无解释力，
#        却仍占据判据行的注意力预算；
#     ③ 规则被染上历史后，改规则的判据从「对不对」变成「当初谁定的」。
#
# 判据（四类；四类判的都是「出身」，不是「事实」）：
#   类1 版本号 vX.Y.Z   —— 规则正文里的版本号 = 「哪版引入」（例外见豁免 E2/E3）
#   类2 日期            —— YYYY-MM-DD / YYYY年M月D日 = 「哪天定的」
#   类3 跑批编号        —— run-N / 第N轮 / Round N = 「第几跑发现的」
#      （`Round N` 是审查/修复轮次，与 `run-N` 同属「第几跑」语义——原口径只列前两者，
#       实测扫描面漏网 1 处（regression-checklist 的「Round 1 修复批」），已同批清理并纳入判据；
#       刻意**不**收 `round-N` 小写形态：仓内无此形态，收进来只会扩大假红面）
#   类4 出身标签        —— 「（…新增）」「（…实锤）」「已机制化」这类把规则染上历史的措辞
#
# 豁免（缺一即大量假红，每条都实测过）：
#   E1 路径豁免（台账 tools/check/archaeology-exempt.json）：第三方 vendored 原文
#      （禁改上游）+ 历史档案整目录（changelog 版本档案 / archive / CHANGELOG——
#      那是出身该待的地方；规则文档才是本守卫的扫描面）
#   E2 能力/阶段版本门槛：**后缀形** `vX.Y.Z+`（如 `v1.0.1+`）、`vX.Y.Z 起` / `以后` / `及以上`；
#      **前置比较形** `低于 vX.Y.Z` / `达到 vX.Y.Z`——两者都是**判据**不是出身
#      （「自某版起具备该能力」「本版低于某门槛则走另一条路」都是规则的一部分）。
#      两种形态都容忍 Markdown 反引号穿插（`` 本版低于 `v2.0.0` ``）：反引号只是代码标记，
#      不改变门槛语义。⚠️ 判据边界（逐条实测，见汇报）：
#        ① 「起」形态与「前置比较形」是原始口径（只列 `+`）之外的**语义扩写**——口径边界已上报；
#        ② 门槛标记**必须存在**，裸 `vX.Y.Z` 仍判出身（标记写成可选即放水口）；
#        ③ `vX.Y.Z 后` / `vX.Y.Z 前` **不**豁免（多处出现在出身叙述里：「某版后补的」）。
#      ⚠️ 相对原始口径（只列 vX.Y.Z+ 形态）本行是语义扩写——扩写理由：规则正文里的版本号可作比较操作数（阶段门槛）而非出身；形态集封闭于此行，vX.Y.Z 后/前 刻意不豁免。
#   E3 文件头版本标识：前 5 行的 H1 里的版本号（文件身份标识，非正文叙事）
#   E4 引用块整行豁免（`>` 开头）——**已取消，见下方「🔴 E4 取消」段**
#   E5 机器注释行（`<!--`）：给模型检索用的锚，不是正文
#   E6 机器字面量（**逐处**豁免，不整行豁免）：行内版本号若属机器字面量则摘除，
#      同一行里的真出身**仍会被判**。判据（任一成立）：
#        (iii) `git describe --tags` 的 fallback tag 形态（`|| echo vX.Y.Z`）
#        (i)   位于 ASCII 引号 `"…"` 内的版本号
#        (ii)  位于 `$(…)` 命令替换内 / 位于 ASCII 单引号 `'…'` 内**且该行是命令或
#              断言行**（grep / echo / test / [ / git describe / awk / sed / node -e / |）
#      🔴 反例（**必须不豁免**）：反引号 `` `vX.Y.Z` `` 内的版本号。反引号在 Markdown 里
#      是行内代码标记，散文大量使用（`` 见 `v1.5.0` 的裁定 ``）——若把反引号也当引号，
#      会把散文整体放水（实测假红转假绿的主要入口）。故引号跨度正则显式排除反引号。
#      🔴 单引号为何附加「命令行」条件：ASCII 撇号在英文散文里作所有格（`Don't`），
#      无条件下配对会把两个撇号之间的版本号误豁免——这是静默放水，不是降噪。
#
#   E7 产品文档台账形态（仅 docs/** 与 FDE/** 适用，releasing 家族严格度不降）：
#      产品文档（HANDBOOK/DEVELOPMENT/PHILOSOPHY/API/WIKI/VALIDATION/guides 等）大量使用
#      版本号/日期作**台账内容**而非出身叙事，四类判据原样套用会整面假红。逐形态实测豁免：
#        (a) 头部版本状态行（前 N 行的 `> vX.Y.Z · 日期 · ✅ 已发版` / `> 版本：vX.Y.Z`）——
#            文档身份行（同 E3「文件头版本标识」语义，docs 家族惯例是 blockquote 形态）
#        (b) frontmatter 机器元数据（created_at / updated_at / date 等键值行）
#        (c) 能力沿革——「vX.Y.Z 交付/新增/拆独立包/增至 N/合并批」是产品能力地图，
#            不是「哪版引入」的规则出身
#        (d) 第三方生态版本与外链（`@deepseek-ai/dsh-mcp-client@0.1.0-rc.6`、
#            `[…](https://…tag/v0.22.0)` 等）——外部世界的版本号，与本仓出身无关
#        (e) 来源/实测/核验快照——「2026-08-25 实测」「来源：arXiv 2608.31100（2026-08）」
#            是证据的时间戳（开源透明度），不是内部决策时间
#        (f) 测试/验收记录行（testing.md 的 `| 日期 | PASS |` 表）
#      ⚠️ E7 不豁免（真考古，仍判）：拍板/收编/定型/明确/核正/核实等**决策时间**——
#      「哪天内部定了什么」是出身叙事，删标签留内容（处置纪律同 E4 取消段）。
#
# 🔴 E4 取消（引用块整行豁免）——**载体不是豁免理由**：
#   实测 E4 的免责面是 **670 行**，其中含版本号的 35 行 / 含日期的 3 行；
#   扣掉 E2 门槛形态后**仍是真出身的 28+ 行**，分布在 12 个文件。
#   最刺眼的一处：`06-doc-finalize` 里同一个字符串「（v1.4.7 定谳）」——
#     表格行形态按判据**已清理**，引用块形态却因 E4 **原样活着**：
#     同一文件、同一串、只差载体 ⇒ 这正是本仓定为缺陷的「同文件内两套口径」。
#   ⚠️ E4（引用块整行豁免）已取消——实测 670 行免责面里藏 28+ 行真出身（含与表格行同一串的「（v1.4.7 定谳）」）⇒ 载体不是豁免理由：`>` 里同样只写「问题 + 解决」，不带出身。
#   处置纪律：**删标签、留内容**（「🔴 阶段十不可跨（v1.4.9 实锤）：…」→ 去掉「（v1.4.9 实锤）」，
#   规则句一字不动）——保持叙事完整、行数中性；**不为转绿就地删规则内容**。
#   ⛔ 后来人不得因「引用块里版本号多」而把 E4 加回来（那等于给后来人一条明路）。
#
# 扫描面（规则文档 + 产品文档全量）：
#   docs/**（含 changelog/releasing SOP 家族、HANDBOOK/DEVELOPMENT/PHILOSOPHY 等全部产品文档）
#   FDE/**（GUIDE 与 templates）+ SKILL/**  playbook/**
#   台账/档案类路径豁免见 E1；产品文档的版本沿革/证据日期形态豁免见 E7（releasing 家族不适用 E7，严格度不降）
#
# 🔴 刻意**不豁免代码块**（原始口径未列，且实测不该列）：
#   ① 实测 docs/changelog/releasing/06-doc-finalize.md 的围栏**不闭合**（11 个围栏
#      标记为奇数）——按围栏配对做豁免会因状态错位而**静默**跳过一大段真实正文
#      （失明且失声，本仓最忌的失效形态）；
#   ② 代码块里的 `#` 注释是要读的散文（实测含真出身：`# 🔴 某版修正：…`）；
#   ③ 命令模板里的版本号多为占位符 `vX.Y.Z`（不匹配数字正则），命中极少。
#   ⚠️ 围栏不闭合那处已由 `52c84dd2` 修复（11→12，配对全部正确），但**本结论不变**：
#      理由②（代码块里的注释是散文）与「按围栏做豁免会失明」的机制风险与围栏是否闭合无关。
#      机器字面量走 **E6 逐处豁免**（按引号/命令形态判定），不走「整块豁免」——后者粒度太粗。
#
# 用法：
#   bash tools/check/check-archaeology.sh               # 预扫（打印命中清单）
#   bash tools/check/check-archaeology.sh --selftest    # 正/反例自检夹具（必红 + 必绿）
#   bash tools/check/check-archaeology.sh --list-exempt # 附列被豁免放行的行
#
# 退出码：0=零命中（除豁免）/ 1=有命中 / 2=脚本自身错误（失明，宁可失声不假绿）
#
# 设计纪律（照 check-cjk-var.sh / check-guards.sh 家族）：
#   - macOS bash 3.2 兼容：无 declare -A / mapfile；grep 与 sed 不写 \s \b 类扩展正则
#   - set -u 纪律：全部计数器在头部初始化（禁止在循环里首次赋值——那是 unbound 炸弹）
#   - 反模式纪律：不用 `|| echo 0` 静默兜底（check-guards ③）；不用 `echo "$VAR" | grep -q`
#     （check-guards ⑤ SIGPIPE 毒方）
#   - 失明必须失声：检测引擎自检样本不命中 → 按错误退出（exit 2），不输出「零命中」假绿
#   - 🔴 正则**一律写在 perl 源码里**（-Mutf8 生效），不经 shell 传参：shell 传进来的是
#     字节串，而行是按 :utf8 解码的字符流——含 CJK 的 alternation（`起` / `年月日` /
#     `已机制化`）会因字节 vs 字符不匹配而**静默永不命中**（实测踩过：自检夹具 B 因此
#     误报 1 处、夹具 A 类4 全空）。ASCII 部分不受影响，故这类失明只在含 CJK 的判据上
#     发生——正是最不容易被人工发现的那类。
#   - 覆盖度行：[check:coverage] 由 lib/coverage-line.sh 统一打印（口径见调用点注释）
# ============================================================

set -uo pipefail

_SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${_SELF_DIR}/lib/coverage-line.sh"

cd "$(dirname "$0")/../.." || exit 2

SELF="tools/check/check-archaeology.sh"
EXEMPT_JSON="tools/check/archaeology-exempt.json"
SCAN_FILES_FIXED=""
SCAN_DIRS="docs FDE SKILL playbook"
HEAD_LINES=5
MAX_SHOWN=200
HITS_TSV="/tmp/check-archaeology-hits.tsv"
LIST_TMP="/tmp/check-archaeology-list.txt"

MODE="prescan"
LIST_EXEMPT="false"
for _arg in "$@"; do
  case "$_arg" in
    --selftest) MODE="selftest" ;;
    --list-exempt) LIST_EXEMPT="true" ;;
    --help|-h)
      echo "check-archaeology.sh · 规则文档禁考古守卫"
      echo "  (无参数)      预扫：打印命中清单（文件:行号:类别:原文）"
      echo "  --selftest    正/反例自检夹具：注入真违规必红 + 能力门槛/机器字面量必绿"
      echo "  --list-exempt 附列被豁免放行的行（含 E6 机器字面量 / E1 台账锚串细节）"
      exit 0 ;;
    *) echo "未知参数：${_arg}（支持 --selftest / --list-exempt）" >&2; exit 2 ;;
  esac
done

# ── 计数器：set -u 下全部在头部初始化 ──
HITS=0
HITS_V=0
HITS_D=0
HITS_R=0
HITS_T=0
EXEMPT_BQ=0
EXEMPT_HC=0
EXEMPT_HEAD=0
EXEMPT_THRESH=0
EXEMPT_MACHINE=0
EXEMPT_ANCHOR=0
ANCHORS_DECLARED=0
FILES_ALL=0
FILES_EXEMPT_PATH=0
FILES_SCANNED=0
FILES_HIT=0
ENGINE_ALIVE=""
ASSERTS=0
COVERED="-"
SKIPS=0

# ── 检测核心：detect_core <文件清单路径> → stdout 出 TSV（KEY<TAB>file<TAB>line<TAB>text）──
# 清单按文件传入（不经 shell 参数分词），避免路径含空格时静默漏扫。
# perl 源码内嵌全部判据正则（含 CJK），见头部「正则一律写在 perl 源码里」。
detect_core() {
  _dc_list="$1"
  perl -Mutf8 -CSD -e '
    my ($listfile, $head_lines, $max_shown) = @ARGV;
    my $RE_VERSION   = qr/v[0-9]+\.[0-9]+\.[0-9]+/;
    # E2 门槛形态（判据非出身）：① 后缀形 `vX.Y.Z+` / `vX.Y.Z 起`；② 前置比较形 `低于 vX.Y.Z` /
    #    `达到 vX.Y.Z`——版本号是比较操作数（决定本版该走哪条路），不是「哪版引入」的出身。
    #    两种形态都允许 Markdown 反引号穿插（如 `` 本版低于 `v2.0.0` ``）——反引号只是代码标记，
    #    不改变门槛语义（实测：09-publish 的施工期/贝塔门槛就写作反引号形态）。
    #    ⚠️ 门槛标记**必须存在**：不要把标记写成可选（`(?:...)?`），那会让裸版本号也被放行——放水口。
    my $RE_THRESHOLD = qr{(?:低于|达到)[ \t]*`?v[0-9]+\.[0-9]+\.[0-9]+`?|`?v[0-9]+\.[0-9]+\.[0-9]+`?(?:\+|`?[ \t]*(?:起|以后|及以上))};
    my $RE_DATE      = qr/[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日/;
    my $RE_RUN       = qr/run-[0-9]+|第[0-9]+轮|Round[ \t]+[0-9]+/;
    my $RE_TAG_REF   = qr/[（(][^）)]{0,60}?(?:v[0-9]+\.[0-9]+\.[0-9]+|run-[0-9]+|第[0-9]+轮|[A-Z]{1,3}-[0-9]+|[0-9]{4}-[0-9]{2}-[0-9]{2})[^）)]{0,25}?(?:新增|实录|已机制化|定谳|拍板|固化|实锤|吸收|教训|实证)[）)]/;
    my $RE_TAG_STANDALONE = qr/[（(【](?:已机制化|实录|固化)[）)】]/;
    # E6 机器字面量判据（逐处摘除，见头部 E6 段）
    # ⚠️ 本 perl 程序嵌在 shell 的**单引号**串里 ⇒ 程序内**任何** ASCII 单引号（含 perl
    #    注释里的）都会提前终结该串、报 bash 语法错误（实测踩过两次）。故单引号一律用
    #    \x27 表达（perl 正则里与字面单引号等价，语义不变）。
    my $RE_E6_FALLBACK = qr{(\|\|[ \t]*echo[ \t]+)v[0-9]+\.[0-9]+\.[0-9]+};
    my $RE_E6_DQUOTE   = qr{(")([^"\x27`\n]*?)v[0-9]+\.[0-9]+\.[0-9]+([^"\x27`\n]*?)(")};
    my $RE_E6_SQUOTE   = qr{(\x27)([^"\x27`\n]*?)v[0-9]+\.[0-9]+\.[0-9]+([^"\x27`\n]*?)(\x27)};
    my $RE_E6_SUBST    = qr{(\$\([^)\n]*?)v[0-9]+\.[0-9]+\.[0-9]+([^)\n]*?\))};
    # 命令/断言行：单引号内版本号只有落在这类行上才豁免（防英文撇号所有格误配对）
    my $RE_E6_CMDLINE  = qr{^[ \t]*(?:grep|echo|test|\[|git[ \t]+describe|awk|sed|node[ \t]+-e)[ \t]|\|[ \t]*$|\|[ \t]*(?:grep|echo|awk|sed|node|head|tail|sort)};
    my $prune = sub {
      my $t = shift;
      return $t if length($t) <= $max_shown;
      return substr($t, 0, $max_shown) . "…";
    };
    # E6：把机器字面量里的版本号摘成 vX.Y.Z（占位符不再匹配数字正则），返回 [新文本, 摘除数]
    my $strip_e6 = sub {
      my ($t) = @_;
      my $n = 0;
      # (iii) git describe --tags fallback tag：`|| echo vX.Y.Z`
      while ($t =~ s{$RE_E6_FALLBACK}{$1 . "vX.Y.Z"}e) { $n++; }
      # (i) ASCII 双引号内（跨度显式排除反引号——反引号是 Markdown 代码标记，不得豁免）
      while ($t =~ s{$RE_E6_DQUOTE}{$1 . $2 . "vX.Y.Z" . $3 . $4}e) { $n++; }
      # (ii-a) 命令替换 $(…) 内（含未加引号形态）
      while ($t =~ s{$RE_E6_SUBST}{$1 . "vX.Y.Z" . $2}e) { $n++; }
      # (ii-b) ASCII 单引号内 + 该行是命令/断言行（单独判定，避免散文撇号误配对）
      if ($t =~ $RE_E6_CMDLINE) {
        while ($t =~ s{$RE_E6_SQUOTE}{$1 . $2 . "vX.Y.Z" . $3 . $4}e) { $n++; }
      }
      return ($t, $n);
    };
    open(my $lf, "<:utf8", $listfile) or die "cannot read list: $listfile\n";
    my @files = <$lf>;
    close($lf);
    chomp @files;
    for my $file (@files) {
      next if $file eq "";
      open(my $fh, "<:utf8", $file) or die "cannot read: $file\n";
      my $ln = 0;
      while (my $line = <$fh>) {
        $ln++;
        chomp $line;
        # E5 机器注释豁免（E4 引用块整行豁免已取消——不再有 `>` 分支）
        # E5 扩展：frontmatter 机器元数据行（created_at / updated_at / date 等键）——
        #   机器生成的时间戳字段，非正文叙事（FDE/GUIDE.md 的 YAML 头等实测形态）
        if ($line =~ /^\s*<!--/ || $line =~ /^\s*(?:created_at|updated_at|published|date|lastmod)\s*:/) { print "EXEMPT_HC\t$file\t$ln\t" . $prune->($line) . "\n"; next; }
        # E3 文件头版本标识（前 N 行的 H1）；E3 扩展：头部版本状态行（blockquote 形态
        #   `> v1.5.0 · 2026-09-19（UTC）· ✅ 已发版` / `> 版本：v1.5.0`）——docs 家族
        #   惯例的文档身份行，语义同 H1 版本标识（API.md `> 版本：v1.5.0（✅ 已发版）· …` 实测）
        my $is_head = ($ln <= $head_lines && ($line =~ /^# / || $line =~ /^>[ \t]*(?:版本[：:][ \t]*)?v[0-9]/)) ? 1 : 0;
        my $work = $line;
        # E2 能力版本门槛：门槛形态先摘掉，剩下的版本号才算出身
        my $th = () = $work =~ /$RE_THRESHOLD/g;
        if ($th) {
          $work =~ s/$RE_THRESHOLD//g;
          print "EXEMPT_TH\t$file\t$ln\t" . $prune->($line) . "\n";
        }
        if ($is_head) {
          my $vh = () = $work =~ /$RE_VERSION/g;
          if ($vh) {
            $work =~ s/$RE_VERSION//g;
            print "EXEMPT_HEAD\t$file\t$ln\t" . $prune->($line) . "\n";
          }
        }
        # E6 机器字面量：逐处摘除（摘除后同一行残留的真出身仍会被下面四类判到）
        my ($work_e6, $n_e6) = $strip_e6->($work);
        if ($n_e6) {
          $work = $work_e6;
          print "EXEMPT_MACHINE\t$file\t$ln\t" . $prune->($line) . "\n";
        }
        # E7 产品文档台账形态（仅 docs/** 与 FDE/** 适用；releasing/SKILL/playbook 严格度不降）：
        #   反向判据——产品文档里版本号/日期绝大多数是台账内容（能力沿革表/第三方生态版本/
        #   证据时间戳/测试记录），四类正向判据整面假红（实测 docs+FDE 的 V 类 328 处中台账
        #   形态占绝大多数）。故对 docs/FDE 的 V/D/R token 逐个判定：**仅当前后 22 字窗口内
        #   无决策动词**（拍板/定谳/明确/收编/定型/核正/核实/决定/勘误/补充）才摘除——
        #   「哪天内部定了什么」才是出身叙事，决策动词邻近的 token 原样保留（仍会被四类判到）。
        #   ⚠️ E7 不动类4（出身标签）：括号出身形态（如「（v1.4.7 定谳）」）在产品文档与
        #   规则文档里同判——本仓公开文档清理的正是这类（实测清理后 docs+FDE 类4 零残留）。
        my $n_e7 = 0;
        # E7 适用面：docs/ 与 FDE/ 产品文档，但**排除 docs/changelog/releasing**（SOP 家族
        #   是规则文档，严格度不降——台账锚豁免仍走 E1-anchor，不经 E7 摘除）
        if ($file =~ m{^(?:docs/|FDE/)} && $file !~ m{^docs/changelog/releasing}) {
          my $RE_E7_TOKEN = qr/v[0-9]+\.[0-9]+\.[0-9]+|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日/;
          my $RE_E7_DECISION = qr/(?:拍板|定谳|明确|收编|定型|核正|核实|决定|勘误|补充)/;
          while ($work =~ m{$RE_E7_TOKEN}g) {
            my $pos = pos($work);
            my $start = $pos - length($&);
            my $ctx_pre  = substr($work, ($start >= 22 ? $start - 22 : 0), ($start >= 22 ? 22 : $start));
            my $ctx_post = substr($work, $pos, 22);
            # 决策动词与 token 之间允许间隔标点/空格（` 2026-08-16 明确）`、`· 2026-09-06 定型）`——
            # 窗口内任意位置出现即视为决策考古（实测形态：日期与动词间至少隔一个空格或 `·`）
            if ($ctx_pre =~ /$RE_E7_DECISION/ || $ctx_post =~ /$RE_E7_DECISION/) {
              # 决策动词在前/后窗口内 → 真考古，保留待判
            } else {
              substr($work, $start, length($&)) = "X.Y.Z";
              $n_e7++;
              pos($work) = $start; # 重置 pos 继续扫描后续 token
            }
          }
          if ($n_e7) {
            print "EXEMPT_E7\t$file\t$ln\t" . $prune->($line) . "\n";
          }
        }
        my $out = $prune->($line);
        my $n = () = $work =~ /$RE_VERSION/g;
        print "V\t$file\t$ln\t$out\n" if $n;
        $n = () = $work =~ /$RE_DATE/g;
        print "D\t$file\t$ln\t$out\n" if $n;
        $n = () = $work =~ /$RE_RUN/g;
        print "R\t$file\t$ln\t$out\n" if $n;
        $n = () = $work =~ /$RE_TAG_REF/g;
        print "T\t$file\t$ln\t$out\n" if $n;
        $n = () = $work =~ /$RE_TAG_STANDALONE/g;
        print "T\t$file\t$ln\t$out\n" if $n;
      }
      close($fh);
    }
  ' "$_dc_list" "$HEAD_LINES" "$MAX_SHOWN"
}

# 计数助手：数某一类命中行数（grep -c 零匹配返回码为 1，故用 || true + ${VAR:-0}；
# 绝不用 `|| echo 0`——那会输出双零使后续整数比较静默失效）
count_key() {
  _ck_file="$1"
  _ck_key="$2"
  _ck_n=$(grep -cE "^${_ck_key}	" "$_ck_file" || true)
  printf '%s' "${_ck_n:-0}"
}

# 打印某类命中（文件:行号 + 原文；原文截断已在 perl 侧按字符完成）
print_class() {
  _pc_label="$1"
  _pc_key="$2"
  _pc_n=$(count_key "$_RAW_FILE" "$_pc_key")
  if [ "$_pc_n" -eq 0 ]; then
    echo "  ✓ ${_pc_label}：零命中"
    return
  fi
  echo "  ✗ ${_pc_label}：${_pc_n} 处"
  awk -F'\t' -v k="$_pc_key" '$1 == k { printf "      %s:%s: %s\n", $2, $3, $4 }' "$_RAW_FILE"
}

# ── 引擎存活探针（失明防御）：正则能命中已知违规样本才算活着 ──
engine_probe() {
  printf '%s\n' '示例 v1.4.8 新增' | perl -Mutf8 -CSD -ne 'print "HIT" if /v[0-9]+\.[0-9]+\.[0-9]+/' 2>/dev/null
}

echo "🔍 规则文档禁考古预扫（扫描面：docs/ + FDE/ + SKILL/ + playbook/）"
echo "════════════════════════════════════════════════════════════"

# ── 前置：node（读豁免台账）与 perl（检测引擎）——缺失即失声，不得静默假绿 ──
NODE="${NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "❌ 找不到 node（NODE=${NODE}）——无法读豁免台账，按脚本错误退出" >&2
  exit 2
fi
if ! command -v perl >/dev/null 2>&1; then
  echo "❌ 找不到 perl——检测引擎缺失，按脚本错误退出" >&2
  exit 2
fi
ENGINE_ALIVE="$(engine_probe || true)"
if [ "$ENGINE_ALIVE" != "HIT" ]; then
  echo "❌ 检测引擎自检样本未命中（应命中 v1.4.8）——引擎失明，空结果不可信，按脚本错误退出" >&2
  exit 2
fi

# ── 自检夹具模式：注入真违规必红 + 合法形态必绿 ──
if [ "$MODE" = "selftest" ]; then
  _FIX_DIR="$(mktemp -d)"
  trap 'rm -rf "${_FIX_DIR}" "${_FIX_E7DIR:-}"' EXIT
  _FIX_BAD="${_FIX_DIR}/bad.md"
  _FIX_GOOD="${_FIX_DIR}/good.md"
  _FIX_E6NEG="${_FIX_DIR}/e6neg.md"
  _FIX_BQ="${_FIX_DIR}/bq.md"
  # 夹具 A：四类判据各自的真违规；类2 刻意两种日期形态各一（ASCII 与 年月日），
  # 防「年形态」静默永不命中却没被任何断言看见。
  {
    echo '# 违规样本（正文里的出身）'
    echo ''
    echo 'v1.4.8 新增了这条判据，2026-09-11 定稿。'
    echo '第二处：run-07 第3轮发现，见（v1.4.6 拍板固化）记录。'
    echo '第三处：本机制（已机制化）。'
    echo '第四处：2026年9月11日 复核时补记。'
    echo '第五处：Round 2 修复批收口时补记。'
  } > "$_FIX_BAD"
  # 夹具 B：全部豁免形态各一（门槛 后缀形/前置比较形、文件头标识、机器注释、E6 机器字面量）
  #   ⚠️ 引用块样本**不在此**——E4 取消后引用块里的出身必须被判中，样本已移入夹具 D
  {
    echo '# good.md · 合法样本 · v1.5.0'
    echo ''
    echo '门槛形态（判据，非出身）：Loop Check 轮次上限见（v1.0.1+）；自 v1.3.9 起 bump 延后到阶段六。'
    echo '门槛形态·前置比较（判据，非出身）：本版低于 `v2.0.0` → 全程加 `--tag alpha`；达到 `v2.0.0` → 默认 tag。'
    echo ''
    echo '<!-- 机器锚 v1.5.0 -->'
    echo ''
    echo 'grep -q "已于 v1.5.0 移除" engine/orchestrator/src/cli.ts'
  } > "$_FIX_GOOD"
  # 夹具 C：E6 反例——**必须仍然命中**（放水方向的回归夹具，比正例更关键）
  #   ① 反引号内（Markdown 行内代码标记）：散文大量使用，豁免它会把散文整体放水
  #   ② ASCII 撇号所有格之间的版本号：无条件下配对会误豁免（英文散文常见）
  {
    echo '# e6neg.md · E6 反例（必须命中）'
    echo ''
    echo '见 `v1.5.0` 的裁定。'
    echo "Writer's note: 该判据 v1.4.8 定稿，reader's 无需记忆。"
  } > "$_FIX_E6NEG"
  # 夹具 D：E4 取消后的**正例**——引用块里的出身必须被判中。
  #   为何必需：取消 E4 却留着依赖 E4 放行的旧夹具 = 断言在保护一个已不存在的行为。
  {
    echo '# bq.md · 引用块里的出身（必须命中）'
    echo ''
    echo '> 为什么有这条：v1.4.8 那次踩过坑，一句话讲完。'
  } > "$_FIX_BQ"
  # 夹具 E：E7 产品文档台账形态——正例（docs/ 前缀模拟：能力沿革/第三方版本/测试记录 必绿）
  #   与反例（决策考古 必红）。E7 按 $file 前缀判定，故在仓库 docs/ 下造相对路径夹具，跑完即删。
  _FIX_E7DIR="docs/.e7selftest"
  mkdir -p "$_FIX_E7DIR"
  _FIX_E7GOOD="${_FIX_E7DIR}/e7good.md"
  _FIX_E7BAD="${_FIX_E7DIR}/e7bad.md"
  {
    echo '# e7good.md · 产品文档台账形态（必绿）'
    echo ''
    echo '| v1.3.7 | SubAgent 沙箱隔离交付，新增独立 FS |'
    echo '工具数 v1.4.5 增至 83，v1.4.7 增 11 个至 95。'
    echo '依赖 @deepseek-ai/cordis@4.0.1 stable 接入。'
    echo '| 2026-06-18 | 郝交付 | PASS | v0.55 安装验证 |'
    echo 'DeepSeek 2026-08-13 开源 DeepSeek Harness。'
  } > "$_FIX_E7GOOD"
  {
    echo '# e7bad.md · 决策考古（必红）'
    echo ''
    echo '> 这张图的三处关键精化（2026-08-16 明确）：'
    echo '### 功能编制（约束层内的功能模块 · 2026-09-06 定型）'
    echo '> 接入门禁状态（2026-09-05 核正）：包名长期 404。'
  } > "$_FIX_E7BAD"

  printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$_FIX_BAD" "$_FIX_GOOD" "$_FIX_E6NEG" "$_FIX_BQ" "$_FIX_E7GOOD" "$_FIX_E7BAD" > "$LIST_TMP"
  _RAW_FILE="$HITS_TSV"
  detect_core "$LIST_TMP" > "$_RAW_FILE" || {
    echo "❌ 检测核心在自检夹具上报错——拒绝假绿" >&2
    exit 2
  }
  _ST_BAD_V=$(awk -F'\t' -v f="$_FIX_BAD" '$1 == "V" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_BAD_D=$(awk -F'\t' -v f="$_FIX_BAD" '$1 == "D" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_BAD_R=$(awk -F'\t' -v f="$_FIX_BAD" '$1 == "R" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_BAD_T=$(awk -F'\t' -v f="$_FIX_BAD" '$1 == "T" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_GOOD_HITS=$(awk -F'\t' -v f="$_FIX_GOOD" '$1 ~ /^(V|D|R|T)$/ && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_E2_POS=$(awk -F'\t' -v f="$_FIX_GOOD" '$1 == "EXEMPT_TH" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_E6_POS=$(awk -F'\t' -v f="$_FIX_GOOD" '$1 == "EXEMPT_MACHINE" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_E6_NEG_V=$(awk -F'\t' -v f="$_FIX_E6NEG" '$1 == "V" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_BQ_V=$(awk -F'\t' -v f="$_FIX_BQ" '$1 == "V" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_E7_GOOD_HITS=$(awk -F'\t' -v f="$_FIX_E7GOOD" '$1 ~ /^(V|D|R|T)$/ && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_E7_BAD_D=$(awk -F'\t' -v f="$_FIX_E7BAD" '$1 == "D" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_E7_GOOD_EX=$(awk -F'\t' -v f="$_FIX_E7GOOD" '$1 == "EXEMPT_E7" && $2 == f' "$_RAW_FILE" | grep -c . || true)
  _ST_BAD_V=${_ST_BAD_V:-0}
  _ST_BAD_D=${_ST_BAD_D:-0}
  _ST_BAD_R=${_ST_BAD_R:-0}
  _ST_BAD_T=${_ST_BAD_T:-0}
  _ST_GOOD_HITS=${_ST_GOOD_HITS:-0}
  _ST_E2_POS=${_ST_E2_POS:-0}
  _ST_E6_POS=${_ST_E6_POS:-0}
  _ST_E6_NEG_V=${_ST_E6_NEG_V:-0}
  _ST_BQ_V=${_ST_BQ_V:-0}
  _ST_E7_GOOD_HITS=${_ST_E7_GOOD_HITS:-0}
  _ST_E7_BAD_D=${_ST_E7_BAD_D:-0}
  _ST_E7_GOOD_EX=${_ST_E7_GOOD_EX:-0}
  _ST_FAILS=0
  ASSERTS=13

  echo "夹具 A（真违规样本 6 行）——期望四类全中："
  for _pair in "类1 版本号:${_ST_BAD_V}" "类2 日期:${_ST_BAD_D}" "类3 跑批编号:${_ST_BAD_R}" "类4 出身标签:${_ST_BAD_T}"; do
    _name="${_pair%%:*}"
    _got="${_pair##*:}"
    if [ "$_got" -ge 1 ]; then
      echo "  ✓ ${_name} 命中 ${_got} 处"
    else
      echo "  ❌ ${_name} 命中 0 处——该类判据已失效（空网）"
      _ST_FAILS=$((_ST_FAILS + 1))
    fi
  done
  if [ "$_ST_BAD_R" -ge 2 ]; then
    echo "  ✓ 类3 三形态全中（run-N / 第N轮 / Round N，共 ${_ST_BAD_R} 行）"
  else
    echo "  ❌ 类3 只命中 ${_ST_BAD_R} 行（应 ≥2：run-N·第N轮 与 Round N 各一）——有形态静默失明"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  echo "夹具 B（合法样本：门槛 / 文件头标识 / 机器注释 / E6 机器字面量）——期望零命中："
  if [ "$_ST_GOOD_HITS" -eq 0 ]; then
    echo "  ✓ 四类零命中（豁免规则生效）"
  else
    echo "  ❌ 合法样本被误判 ${_ST_GOOD_HITS} 处——豁免规则回归："
    awk -F'\t' -v f="$_FIX_GOOD" '$2 == f { printf "      [%s] %s:%s: %s\n", $1, $2, $3, $4 }' "$_RAW_FILE"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  if [ "$_ST_E2_POS" -ge 1 ]; then
    echo "  ✓ E2 正例（门槛形态：后缀形 + 前置比较形，含反引号穿插）已豁免（${_ST_E2_POS} 行）"
  else
    echo "  ❌ E2 正例未被豁免——版本门槛被当出身判，规则正文会持续假红"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  echo "夹具 C（E6 反例：反引号内 / 撇号所有格之间的版本号）——期望**仍然命中**："
  if [ "$_ST_E6_NEG_V" -ge 2 ]; then
    echo "  ✓ 两处反例仍被判类1 命中（${_ST_E6_NEG_V} 处）——E6 未放水"
  else
    echo "  ❌ E6 反例只命中 ${_ST_E6_NEG_V} 处（应 ≥2）——引号配对已放水，散文会被静默豁免："
    awk -F'\t' -v f="$_FIX_E6NEG" '$2 == f { printf "      [%s] %s:%s: %s\n", $1, $2, $3, $4 }' "$_RAW_FILE"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  if [ "$_ST_E6_POS" -ge 1 ]; then
    echo "  ✓ E6 正例（命令内引号版本号）已按机器字面量豁免（${_ST_E6_POS} 处）"
  else
    echo "  ❌ E6 正例未被豁免——机器字面量会持续假红，E6 判据失效"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  echo "夹具 D（E4 取消后的正例：引用块里的出身）——期望**仍然命中**："
  if [ "$_ST_BQ_V" -ge 1 ]; then
    echo "  ✓ 引用块里的出身仍被判类1 命中（${_ST_BQ_V} 处）——「载体免责」口子已堵"
  else
    echo "  ❌ 引用块里的出身未被判中——E4 口子被误加回，引用块成了出身的藏身处： "
    awk -F'\t' -v f="$_FIX_BQ" '$2 == f { printf "      [%s] %s:%s: %s\n", $1, $2, $3, $4 }' "$_RAW_FILE"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  echo "夹具 E（E7 产品文档台账形态：docs/ 前缀）——台账必绿、决策考古必红："
  if [ "$_ST_E7_GOOD_HITS" -eq 0 ] && [ "$_ST_E7_GOOD_EX" -ge 1 ]; then
    echo "  ✓ 台账形态（沿革表/第三方版本/测试记录/开源快照）零命中，E7 已豁免（${_ST_E7_GOOD_EX} 行）"
  else
    echo "  ❌ 台账形态被误判 ${_ST_E7_GOOD_HITS} 处——E7 豁免失效，产品文档会整面假红："
    awk -F'\t' -v f="$_FIX_E7GOOD" '$1 ~ /^(V|D|R|T)$/ && $2 == f { printf "      [%s] %s:%s: %s\n", $1, $2, $3, $4 }' "$_RAW_FILE"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  if [ "$_ST_E7_BAD_D" -ge 1 ]; then
    echo "  ✓ 决策考古（明确/定型/核正）仍被判类2 命中（${_ST_E7_BAD_D} 处）——E7 不放水"
  else
    echo "  ❌ 决策考古未被判中——E7 窗口过宽，决策时间被静默豁免："
    awk -F'\t' -v f="$_FIX_E7BAD" '$1 ~ /^(V|D|R|T)$/ && $2 == f { printf "      [%s] %s:%s: %s\n", $1, $2, $3, $4 }' "$_RAW_FILE"
    _ST_FAILS=$((_ST_FAILS + 1))
  fi
  echo ""
  if [ "$_ST_FAILS" -eq 0 ]; then
    echo "✅ 自检通过：注入真违规必红、合法形态必绿、E6/E7 反例与 E4 取消均不放水（夹具 A 四类全中 / B 零命中 / C 两处仍红 / D 引用块出身仍红 / E 台账绿·决策红）"
    emit_coverage_line "check-archaeology(--selftest)" "$ASSERTS" "8" "0"
    exit 0
  fi
  echo "❌ 自检失败：${_ST_FAILS} 项——守卫失效，禁止据此判规则文档合规" >&2
  emit_coverage_line "check-archaeology(--selftest)" "$ASSERTS" "3" "0"
  exit 1
fi

# ── 豁免台账（E1 路径豁免）──
# 解析失败必须报错退出：静默当成「无豁免」会造大量假红；静默当成「全豁免」会造假绿。
_EXEMPT_PATHS="$(node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const p of (j.exemptPaths || [])) console.log(p.pattern);
' "$EXEMPT_JSON" 2>/tmp/check-archaeology-nodeerr.txt)" || {
  echo "❌ 豁免台账解析失败：${EXEMPT_JSON}" >&2
  [ -s /tmp/check-archaeology-nodeerr.txt ] && cat /tmp/check-archaeology-nodeerr.txt >&2
  exit 2
}
rm -f /tmp/check-archaeology-nodeerr.txt

# ── 豁免台账（E1-anchor 锚串豁免 · 裁定 1 形态：{file, anchor, reason}）──
# 为何不用「文件+行号」：行号随任何编辑漂移，漂移即**静默**失效或**静默**误放行
# （失明且失声）。锚串漂移可被检出，故台账锚定为「文件 + 行内锚串」。
# 两条硬校验（任一不成立即 exit 2，宁可失声不假绿）：
#   ① 锚串在文件内必须**唯一**（否则一条豁免顺带放行多行）；
#   ② 锚串解析出的行必须**当前就是命中行**（否则说明被豁免的内容已变——锚失效必须出声）。
_ANCHOR_TSV="/tmp/check-archaeology-anchors.tsv"
: > "$_ANCHOR_TSV"
ANCHORS_RAW="$(node -e '
  const fs = require("fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const out = [];
  let bad = 0;
  for (const a of (j.exemptAnchors || [])) {
    let text;
    try { text = fs.readFileSync(a.file, "utf8"); }
    catch (e) { console.error(`锚所在文件不可读：${a.file}`); bad++; continue; }
    const lines = text.split("\n");
    const idx = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(a.anchor)) idx.push(i + 1);
    if (idx.length !== 1) {
      console.error(`锚不唯一：${a.file} 内「${a.anchor}」命中 ${idx.length} 处（要求恰好 1）`);
      bad++;
      continue;
    }
    out.push([a.file, idx[0], (a.reason || "").replace(/\t/g, " ")].join("\t"));
  }
  if (bad > 0) process.exit(3);
  process.stdout.write(out.length ? out.join("\n") + "\n" : "");
' "$EXEMPT_JSON" 2>/tmp/check-archaeology-anchorerr.txt)" || {
  echo "❌ 豁免台账 exemptAnchors 校验失败（锚不唯一 / 文件不可读 / JSON 解析错误）：${EXEMPT_JSON}" >&2
  [ -s /tmp/check-archaeology-anchorerr.txt ] && cat /tmp/check-archaeology-anchorerr.txt >&2
  exit 2
}
rm -f /tmp/check-archaeology-anchorerr.txt
if [ -n "$ANCHORS_RAW" ]; then
  printf '%s\n' "$ANCHORS_RAW" > "$_ANCHOR_TSV"
fi
ANCHORS_DECLARED=$(grep -c . "$_ANCHOR_TSV" || true)
ANCHORS_DECLARED=${ANCHORS_DECLARED:-0}

path_is_exempt() {
  _pe_chk="$1"
  while IFS= read -r _pe_pat; do
    [ -z "$_pe_pat" ] && continue
    # 台账里的 pattern 就是要当 glob 用（如 `playbook/vendor/*`，* 跨斜杠）；加引号会退化成
    # 字面匹配 → 豁免静默失效（假红）。故此处**必须**保持未加引号的 case 模式（SC2254 豁免）。
    # shellcheck disable=SC2254
    case "$_pe_chk" in
      $_pe_pat) return 0 ;;
    esac
  done <<EOF
${_EXEMPT_PATHS}
EOF
  return 1
}

# ── 扫描面收集 + 范围对账（失明防御：声称 vs 实际）──
_ALL_FILES="$( { [ -n "$SCAN_FILES_FIXED" ] && echo "$SCAN_FILES_FIXED"; find $SCAN_DIRS -name "*.md" -type f 2>/dev/null || true; } | LC_ALL=C sort -u )"
: > "$LIST_TMP"
while IFS= read -r _af; do
  [ -z "$_af" ] && continue
  FILES_ALL=$((FILES_ALL + 1))
  if path_is_exempt "$_af"; then
    FILES_EXEMPT_PATH=$((FILES_EXEMPT_PATH + 1))
    continue
  fi
  FILES_SCANNED=$((FILES_SCANNED + 1))
  printf '%s\n' "$_af" >> "$LIST_TMP"
done <<EOF
${_ALL_FILES}
EOF

_EXPECT=$((FILES_ALL - FILES_EXEMPT_PATH))
if [ "$FILES_SCANNED" -ne "$_EXPECT" ]; then
  echo "❌ 扫描范围对账失败：实际扫描 ${FILES_SCANNED} ≠ 收集 ${FILES_ALL} − 路径豁免 ${FILES_EXEMPT_PATH}（= ${_EXPECT}）" >&2
  exit 2
fi
if [ "$FILES_SCANNED" -eq 0 ]; then
  echo "❌ 扫描面为空（收集 ${FILES_ALL} / 豁免 ${FILES_EXEMPT_PATH}）——目录重组或 glob 失效，拒绝假绿" >&2
  exit 2
fi
echo "  扫描面：find 收集 ${FILES_ALL} 个 .md · 路径豁免 ${FILES_EXEMPT_PATH} 个 · 实际扫描 ${FILES_SCANNED} 个"
echo "  引擎：perl 存活自检 $([ "$ENGINE_ALIVE" = "HIT" ] && echo "✓ 命中样本" || echo "✗ 失明")"
echo ""

# ── 预扫 ──
_RAW_FILE="$HITS_TSV"
detect_core "$LIST_TMP" > "$_RAW_FILE" 2>/tmp/check-archaeology-detecterr.txt || {
  echo "❌ 检测核心报错（exit 非 0）——拒绝假绿" >&2
  [ -s /tmp/check-archaeology-detecterr.txt ] && cat /tmp/check-archaeology-detecterr.txt >&2
  exit 2
}
rm -f /tmp/check-archaeology-detecterr.txt

# ── E1-anchor 豁免应用：把台账锚定的命中行移出命中面（豁免必须可见 ⇒ 另记 EXEMPT_ANCHOR）──
if [ "$ANCHORS_DECLARED" -gt 0 ]; then
  awk -F'\t' -v OFS='\t' '
    NR == FNR { if ($1 != "") key[$1, $2] = 1; next }
    { if ($1 ~ /^(V|D|R|T)$/ && (($2, $3) in key)) print "EXEMPT_ANCHOR", $2, $3, $4; else print }
  ' "$_ANCHOR_TSV" "$_RAW_FILE" > "${_RAW_FILE}.anchored" || {
    echo "❌ E1-anchor 豁免应用失败（awk 非 0）——拒绝假绿" >&2
    exit 2
  }
  mv "${_RAW_FILE}.anchored" "$_RAW_FILE"
fi

HITS_V=$(count_key "$_RAW_FILE" "V")
HITS_D=$(count_key "$_RAW_FILE" "D")
HITS_R=$(count_key "$_RAW_FILE" "R")
HITS_T=$(count_key "$_RAW_FILE" "T")
EXEMPT_HC=$(count_key "$_RAW_FILE" "EXEMPT_HC")
EXEMPT_HEAD=$(count_key "$_RAW_FILE" "EXEMPT_HEAD")
EXEMPT_THRESH=$(count_key "$_RAW_FILE" "EXEMPT_TH")
EXEMPT_MACHINE=$(count_key "$_RAW_FILE" "EXEMPT_MACHINE")
EXEMPT_E7=$(count_key "$_RAW_FILE" "EXEMPT_E7")
EXEMPT_ANCHOR=$(count_key "$_RAW_FILE" "EXEMPT_ANCHOR")

# ── 锚失效检测（裁定 1）：声明的每条锚都必须仍匹配到命中行，否则被豁免的内容已变 ──
_ANCHOR_MATCHED=$(awk -F'\t' '$1 == "EXEMPT_ANCHOR" { print $2 ":" $3 }' "$_RAW_FILE" | LC_ALL=C sort -u | grep -c . || true)
_ANCHOR_MATCHED=${_ANCHOR_MATCHED:-0}
if [ "$_ANCHOR_MATCHED" -ne "$ANCHORS_DECLARED" ]; then
  echo "❌ 豁免锚失效：台账声明 ${ANCHORS_DECLARED} 条，实际只匹配到 ${_ANCHOR_MATCHED} 条命中行" >&2
  echo "   被豁免的内容已变（或已成干净行）——锚必须重新核对。锚失效必须出声，不得静默放行。" >&2
  exit 2
fi

print_class "类1 版本号（vX.Y.Z 出现在规则正文）" "V"
print_class "类2 日期（YYYY-MM-DD / YYYY年M月D日）" "D"
print_class "类3 跑批编号（run-N / 第N轮 / Round N）" "R"
print_class "类4 出身标签（括号出身 / 独立标签）" "T"

HITS=$((HITS_V + HITS_D + HITS_R + HITS_T))
FILES_HIT=$(awk -F'\t' '$1 ~ /^(V|D|R|T)$/ { print $2 }' "$_RAW_FILE" | LC_ALL=C sort -u | grep -c . || true)
FILES_HIT=${FILES_HIT:-0}

echo ""
if [ "$LIST_EXEMPT" = "true" ]; then
  echo "──── 豁免放行明细（--list-exempt）────"
  awk -F'\t' '$1 ~ /^EXEMPT_/ { printf "  [%s] %s:%s: %s\n", $1, $2, $3, $4 }' "$_RAW_FILE"
  echo ""
fi

echo "──── 豁免放行计数（跳过必须可见）────"
echo "  E4 引用块叙事       —— 已取消（引用块里的出身同样判，见头部「🔴 E4 取消」段）"
echo "  E5 机器注释         ${EXEMPT_HC} 行"
echo "  E3 文件头版本标识   ${EXEMPT_HEAD} 行"
echo "  E2 能力版本门槛     ${EXEMPT_THRESH} 行"
echo "  E6 机器字面量       ${EXEMPT_MACHINE} 行"
echo "  E7 产品文档台账形态 ${EXEMPT_E7} 行"
echo "  E1 台账锚串豁免     ${EXEMPT_ANCHOR} 行（声明 ${ANCHORS_DECLARED} 条，逐条见 --list-exempt）"
echo "                      ⓘ 行数 ≥ 条数是正常的：同一行可同时命中多类（如日期 + 版本号）"
echo ""
echo "════════════════════════════════════════════════════════════"
# 覆盖度行口径（v1.4.9 G-2②）：
#   asserts = 命中数 + 干净文件数（每个文件至少产出一条判定：有命中按命中数计，
#             零命中按 1 条「该文件干净」计）
#   covered = 实际扫描文件数（find 收集 − 路径豁免）
#   skipped = 按豁免放行的命中行数（E1/E2/E3/E5/E6/E7 之和；E4 已取消）——跳过是看不见的，故必须打印
_CLEAN=$((FILES_SCANNED - FILES_HIT))
ASSERTS=$((HITS + _CLEAN))
COVERED="${FILES_SCANNED}"
SKIPS=$((EXEMPT_HC + EXEMPT_HEAD + EXEMPT_THRESH + EXEMPT_MACHINE + EXEMPT_E7 + EXEMPT_ANCHOR))

if [ "$HITS" -gt 0 ]; then
  echo "  命中合计 ${HITS} 处（类1 ${HITS_V} / 类2 ${HITS_D} / 类3 ${HITS_R} / 类4 ${HITS_T}），分布在 ${FILES_HIT} 个文件"
  echo "  🔴 命中行需逐条裁定「合法豁免 / 真实待清」——不要为转绿就地删规则内容"
  emit_coverage_line "check-archaeology" "$ASSERTS" "$COVERED" "$SKIPS"
  exit 1
fi
echo "  ✅ 零命中（除豁免）——${FILES_SCANNED} 个规则文档正文无出身考古"
emit_coverage_line "check-archaeology" "$ASSERTS" "$COVERED" "$SKIPS"
exit 0
