#!/usr/bin/env node
// ============================================================
// check-forms.mjs · 「形态归属」标注一致性守卫（changelog ↔ ROADMAP）
// ============================================================
// 用法: node tools/check/check-forms.mjs
//
// 功能: 断言六个未开发版本的开发日志里，每个需要标注的章都带
//       「形态归属」标注行；标注的形态词落在封闭枚举内、可拔级别必填、
//       主干章不与 L3/L4 自相矛盾；再把 ROADMAP「规划版本」表声明的
//       形态计数与 changelog 实测口径逐版对账（声明值 vs 实测值）。
//
// 为什么值得装一条守卫:
//   ROADMAP「形态归属判据」写了「形态改动同批改标注，不留悬空」——但此前
//   零机器校验，一致性只能靠人工复核（一轮人工复核在 38 章里查出 13 章
//   标注有问题，全靠肉眼）。本守卫把「人工记得」升级为「机器拦得住」。
//
// 检查范围（扫描面 = 显式硬编码清单，绝不扫目录）:
//   · docs/changelog/v1.5/v1.5.0.md / v1.5.1 / v1.5.2 – v1.5.9（10 文件）
//     ——v1.5.2–v1.5.9 为地基期拆版并入的产物（原 v1.5.2–v1.5.5 四版先按颗粒度细化
//       拆为十六版 v1.5.2–v1.5.17，再按主题撤并为八版 v1.5.2–v1.5.9）
//   · docs/changelog/v1.6/ – v1.9/ 各一版（4 文件）
//     ——判定底座施工期四阶段四版，全部在规划态即带「形态归属」标注，
//       纳入扫描面使标注与 ROADMAP 声明的对账同受守卫（此前只扫已拆版与 v2.0.0，
//       施工期细版的标注不参与对账 ⇒ 标注写错无人拦）
//   · docs/changelog/v2.0/v2.0.0.md（1 文件）
//   · docs/ROADMAP.md（A7 对账的第二侧）
//   明确不扫 docs/changelog/v1.4/ 及更早——已发版历史档案，不回填标注。
//   路径写死在代码常量里（不扫目录）：「目录改名/移动」只会当场判失明，
//   不会静默少扫而输出假绿。
//
// 断言（编号即断言名）:
//   A1 失明自检      实测 < 12 文件 或 需标注章 < 60 ⇒ exit 2，拒绝假绿
//   A2 每章必有标注  章体须有「形态归属」行；排除「定位」「与后续版本的依赖」
//                    与「章体为纯指针存根」的章（无交付面，见 isPointerStub）。
//                    豁免判据**只看章体**、不看标题里标记的位置——按标题形态豁免会让
//                    真章被当成指针章悄悄退出判定面（实测：真章 38→37 章、covered 44→43）
//   A3 形态词封闭    主干 / 通道 / 插件 / 外部 / 非功能，或字面串 **部署形态**
//                    （第三轴；不占形态位）
//   A4 可拔级别必填  结构级全角竖线后须紧跟 L1 关档 / L2 收窄 / L3 拆件 / L4 卸包 /
//                    **不可拔** / —。结构级 = **括号深度 0** 处的竖线（括注里的
//                    竖线不算数，避免散文里的「｜ L1 关档」被当成真级别）。
//                    括号只数全角圆括号——半角括号是散文标点，不参与深度
//                    （否则一处落单半角右括号就把整仓判失明）。
//                    深度 0 处 0 个竖线 ⇒ 违规（缺级别）；>1 个或括号不平衡 ⇒ exit 2
//   A5 自相矛盾拦截  本章主形态为「主干」、或成分含「主干」，就不得配 L3 拆件 / L4
//                    卸包（主干按架构定义不可拆不可裁）。判据**只用 A3/A4 已解析出的
//                    结构字段**（主形态 / 成分），不做整行子串扫描、也不做 token 扫描
//                    ——括注散文里顺口提一句「主干」、或括注里出现字面主干 token，都不
//                    表示本章是主干章，扫它们只会新增假红（详见 A5 处注释）
//   A6 成分标注合法  「+ [X] 成分」的 X 须为合法形态词，且 X ≠ 本章主形态
//                    （不许「主干 + 主干成分」这类无信息写法）
//   A7 ROADMAP 对账  ① 计数：声明的主干/通道/插件/非功能/部署形态 N 章 · 通道成分 N ·
//                    外部成分 N vs changelog 实测（逐版、逐模式）。声明数字**按子句头部取**
//                    （子句边界 = 括号深度 0 处的全角 ；/。/，，只有紧贴子句开头的命中
//                    才算声明）：行内说明历史口径（「另有一处旧文写主干 2 章」）是合法
//                    写作、不算第二处声明（实测 R4 假红）；**跨子句数字不同**才是真二义
//                    ⇒ 红（R4′）；**同子句中部**再出现「label 数字 章」结构 ⇒ 红（⑩
//                    修法，fail-closed：多个声明须用 ＋ 或 ； 分隔为独立子句）
//                    ② pin：由 EXPECTED_LABELS 逐版钉住「哪些声明必须有」——删掉一句
//                    声明（判定面静默缩小）或加一句未登记的声明（判定面静默变化）都判红；
//                    另由 EXPECTED_COUNTS 逐版钉住**声明值本身**（修 C）——删章 + 同批
//                    改小声明数字的老通道自此被拦（声明值与 pin 不符 ⇒ 红）
//                    ③ 反向覆盖：changelog 实测出现的形态/成分必须 ⊆ 该版声明标签集
//                    （该版没声明的东西不许悄悄长出来）
//                    ④ 版本行唯一：版本行必须恰好 1 条（与首列是否加粗无关——加粗是
//                    排版风格，不是判据；只认加粗行会让非加粗的重复行完全隐形）
//   A8 指针目标可解析「→ 已前移 / → 已后移」是 A2 的豁免牌，豁免牌必须能兑现：
//                    「已前移 <ver>」要求对应开发日志存在（带「第<cn>章」还要求该章存在）；
//                    「已后移 <ver>」要求 ROADMAP 有该版本行或开发日志存在；指针自指本版、
//                    缺目标版本号、目标不存在都判红——否则豁免变成「把真章标成指针 + 补
//                    一章合成章」的洗白通道。
//                    判定面 = **任何含标记的标题**（宽），与 A2 的豁免面（章体存根）**解耦**。
//                    为什么必须解耦：两面共用一个谓词时，「标记写在末尾括注内 / 括注外」
//                    会决定它是否被校验——同一个不存在的版本号，写括注内判红、写括注外
//                    完全免检（实测 P-d 型假目标）。宽判定面的代价是多校验几处真章标题，
//                    换来的是「假目标没法靠换位置免检」。
//                    目标版本号与章号都**按槽位**取（版本号紧跟方向词之后、章号紧跟版本号
//                    之后），尾注其余部分是自由散文不参与解析——否则散文里的版本号会把判据
//                    带偏。槽位形态 = v<主>.<次>(.<修订>)*：**两段号也占槽**——若要求三段才
//                    占槽，「槽位写 v1.6 + 散文放真版本 v1.5.4」会去兑现散文那个 ⇒ 假绿；
//                    占槽后 v1.6 按可兑性判 ⇒ 红。槽位不是版本号形态时，**只认「章号占槽」
//                    的回退形态**（「→ 已前移 第五章 见 v1.4.4」⇒ 目标＝尾注里那个三段号）；
//                    其余写法（「→ 已后移 顺延至 v1.5.4」）不拿散版本号当目标 ⇒ 红。
//                    尾注其余部分的版本号：只打**无法兑现的引用**（既无开发日志、也无
//                    ROADMAP 版本行）——尾注里引用真实存在的版本号作对照是合法写作，
//                    一律放行（「尾注只许唯一版本号」的计数口径已评估否决，见已知边界 ④）。
//                    章号比较按数字归一（「第8章」≡「## 八、」）
//
// 已知边界（明确不设防的，写在这里以免被当成暗坑）:
//   ① docs/changelog/v1.4/ 及更早不扫——已发版历史档案，不回填「形态归属」标注
//      （见上方 OPT_OUT_NOTE）。
//   ② **已修（修 C）**：原口径「整章删除 + 同批改小 ROADMAP 计数 ⇒ 绿（不设防，靠人工
//      看显眼 diff）」。现由 EXPECTED_COUNTS 计数 pin 关闭：声明值本身被钉住，删章 +
//      改小声明 ⇒ pin 与声明不符 ⇒ 红（报文提示同批更新 pin 表）。代价：正常加章须改
//      changelog + ROADMAP + pin 三处（已拍板接受）。残余：pin 表自身被同批改小＝三处
//      同改，与一切金表同限——那是显式改表，属人工评审面。
//   ③ 章级普查无 pin（章标题金表）：本守卫不维护「应该有哪些章」的金表（章标题会随
//      正当排期增删，维护金表＝每次正常改动都要跟着改表，收益不抵成本）。「删掉一章
//      且该版计数声明同步改对」的组合场景已由 ② 的计数 pin 拦截（声明数字变了对不上
//      pin ⇒ 红）；单看章集合的增删本守卫不表态——那是 ②③ 修后**唯一**剩下的章级豁免面，
//      属显式内容改动，人工评审可见。
//   ④ 「尾注只许唯一目标版本号」（计数口径）**已评估并否决**——它同时是假红与无效覆盖：
//      假红：尾注引用一个真实存在的版本号作对照是合法写作（实测「→ 已前移 v1.4.5
//      第八章，另有 v1.5.0 的对照」被计数口径判红）；
//      无效覆盖：目标歧义的真实来源是「版本号不在槽位上」，而不是「尾注里有几个版本号」
//      ——槽位锚定（见 A8）落地后，计数口径没有独立覆盖；且把隐藏目标写成非三段形态
//      （实测「→ 已后移 v1.5.1 之后的 1.6 批次」）即可绕开计数。
//      现口径：槽位版本号＝声明目标；尾注其余部分**只打无法兑现的引用**（既无开发日志、
//      也无 ROADMAP 版本行），真实存在的版本号一律放行。
//   ⑤ 半角括号不参与结构深度 ⇒ 若某行真用半角括号做结构分组（如「(形态)｜L1 关档」），
//      深度会算成 0 而少一层遮蔽。实测 38 条标注行：全角 38/38 平衡、含半角 0 行、
//      无任一行依赖半角嵌套 ⇒ 当前零暴露；未来出现该写法须连同口径一起改。
//   ⑥ 「把真章标成指针」已由**章体存根判据**覆盖（原位次口径「按标题末尾括注豁免」是假
//      豁免：真章被当成指针章豁免 ⇒ 悄悄退出 A5/A4/A7 判定面，实测 38→37 章、
//      covered 44→43；且标记挪到括注外即完全免检）。现口径：A2 只豁免**章体为纯指针
//      存根**的章、A8 对**任何含标记的标题**都校验目标。残余：存根可被伪造（写一章空壳
//      + 真章改指针）——那必须**新增一整章**才补得回本版计数（显眼 diff，人工评审可见），
//      与 ②③ 同量级。与 ② 的差别：② 需**同批改 ROADMAP 计数**才绿（ROADMAP diff 是
//      tell）；⑥ 的残余**连 ROADMAP 都不用动**（空壳章自补计数）——唯一 tell 是
//      changelog 整章改写的显眼 diff，属人工评审级。内容语义超出语法守卫能力，机器
//      不可判空壳章的真伪，唯一防线是人工评审看显眼 diff。
//   ⑦ 「章号占槽 ⇒ 回退尾注三段号」是**有意的放宽**：让合法写法「→ 已前移 第五章
//      见 v1.4.4」（章号占槽、目标版本号写在尾注后段）可兑现，否则判「缺目标版本号」
//      ＝假红。放宽面被**结构**锁死：只有「章号占槽 + 尾注含三段号」这一种形态走回退，
//      且目标＝尾注里唯一那个三段号；其余非版本号槽位（如「→ 已后移 顺延至 v1.5.4」）
//      一律判红——**回退的键是「章号占槽」，不是「槽位不是版本号」**，后者会把散版本号
//      放行成目标（实测 R6 假绿）。
//   ⑧ **输出契约**（外部复核脚本依赖）：A8 绿行必须含稳定前缀
//      「A8 指针目标可解析：<N> 处」（N＝判定面指针数，干净树恒为 6）。同一行的后半句
//      措辞可变（曾为「指针章」、现为「含标记标题」），复核脚本请锚定前缀或只取 N，
//      不要整行匹配——否则一次措辞升级会让复核者误判「判定面消失」。
//   ⑨ 成分声明面曾存在**两套谓词**（A6 用无界空白正则、A7 实测面用 parseAnnotation 的
//      前 4 / 后 6 字符固定窗口），空白长度落在窗口外即分歧，**方向 fail-open**：
//      一处未对账的成分声明可被放行——恰是 A7 的 pin / 双向闭合要防的「判定面静默变化」。
//      触发**需单边声明**：DECL 形态（成分词可省）或后缀形态（「内含成分」）单侧触发
//      + 该侧空白拉出窗口；
//      **双边写法「+ [X] 成分」免疫**（两侧触发互为冗余——实测 R5e：双边写法下即便
//      单侧空白拉出窗口，另一侧仍命中 ⇒ A7 实测数不失真）。实测杠杆：token 与「成分」
//      之间 10 空格、「+」与 token 之间 12 空格 ⇒ exit 0（未对账声明被放行）；同款留
//      1 空格 ⇒ exit 1（实测 D10 / D12 vs D1 / DP1）；QA 权威验收器三载体在 5 / 5 / 4
//      空格处翻转（判定参数＝窗口宽 6−1 / 4−0，见 qa-accept-AUTHORITY.py）。**R5 已修**
//      （成分提取收敛为 extractComponentDeclarations 单源，A6 与 A7 实测面共用，翻转点
//      消失）。**R3 亦已修（清尾批修 A）**：提取器加**结构约束**——DECL 须粗体整体包裹
//      且深度 0、SUFFIX 须括注内且「成分=」，散文提及（「本章不含 `[通道]` 成分」
//      「A + `[插件]`」）不再进成分集合（实测 R3a/R3b 转绿，基线 7 处声明仍全提取）。
//      本族（成分提取双谓词分歧 + 散文误判）至此清零，无立项残余。
//   ⑩ **已修（清尾批修 B）**：原口径「子句中部的第二处数字被当散文静默忽略（fail-open，
//      半角逗号 / 顿号接第二处计数可隐形）」。现改 **fail-closed**：头部取数后，同一
//      子句内再出现「<label> <数字> 章」结构 ⇒ exit 1，报文「声明子句内多处计数——
//      多个声明须用 ＋ 或 ； 分隔为独立子句」。这是契约要求（声明语法本规定 ＋ 连接），
//      不是惩罚散文——散文提及不带「数字＋章」结构（实测 OBS3/OBS4 顿号 / 半角逗号载体
//      由 exit 0 转 exit 1；基线 20 子句头部命中全绿不动）。
//
// 退出码:
//   0 = 全绿
//   1 = 有违规
//   2 = 检查器失明（A1 命中，或扫描面不可读，或 A4 结构二义/括号不平衡）
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// ── 扫描面（显式清单：版本 → 开发日志）────────────────────────
// 🔴 扫描窗口 = **未发版**版本（与下方 OPT_OUT_NOTE 同口径）：版本一旦发版即移出本清单——
//    已发版版本的形态标注属历史档案，回填/对账均无意义（v1.5.0 发版后按此口径移出）。
const VERSION_SOURCES = [
  { version: 'v1.5.3', file: 'docs/changelog/v1.5/v1.5.3.md' },
  { version: 'v1.5.4', file: 'docs/changelog/v1.5/v1.5.4.md' },
  { version: 'v1.5.5', file: 'docs/changelog/v1.5/v1.5.5.md' },
  { version: 'v1.5.6', file: 'docs/changelog/v1.5/v1.5.6.md' },
  { version: 'v1.5.7', file: 'docs/changelog/v1.5/v1.5.7.md' },
  { version: 'v1.5.8', file: 'docs/changelog/v1.5/v1.5.8.md' },
  { version: 'v1.5.9', file: 'docs/changelog/v1.5/v1.5.9.md' },
  { version: 'v1.6.0', file: 'docs/changelog/v1.6/v1.6.0.md' },
  { version: 'v1.7.0', file: 'docs/changelog/v1.7/v1.7.0.md' },
  { version: 'v1.8.0', file: 'docs/changelog/v1.8/v1.8.0.md' },
  { version: 'v1.9.0', file: 'docs/changelog/v1.9/v1.9.0.md' },
  { version: 'v2.0.0', file: 'docs/changelog/v2.0/v2.0.0.md' },
];
const SCAN_FILES = VERSION_SOURCES.map((v) => v.file);
const ROADMAP_FILE = 'docs/ROADMAP.md';
const OPT_OUT_NOTE = 'docs/changelog/v1.4/ 及更早（已发版历史档案，不回填标注）';

// A1 基线：路径写错时若直接输出「通过」就是假绿 ⇒ 先拒绝判定
// 数值口径（删除 16 件后实测）：扫描面 15 文件 / 78 章。MIN_FILES 取 12 是主理人指示值
// （余量 3）；MIN_CHAPTERS 取 60（余量 18）。两者都是**下界**，只防「路径漂移导致的假绿」。
const MIN_FILES = 12;
const MIN_CHAPTERS = 60; // 实测基线 15 文件 / 78 章（判定底座施工期四阶段四版纳入扫描面后；边界与治理缺口回灌五版 +5 章）

// A2 排除面（无交付面 ⇒ 不要求标注）：固定标题两个；**指针存根章由 isPointerStub
// （章体判据）另行豁免**——这里刻意不按标题形态豁免，理由见 isPointerStub 处注释。
// Release Notes / Install 段是面向用户的发布说明复述面（阶段六定稿项），非交付章——
// 硬打形态标注会污染 A7 形态计数对账（非功能 pin），故入排除面（标题带版本号后缀，用前缀匹配）。
const SKIP_TITLE_PREFIXES = ['Release Notes', '⚡ Install'];
const SKIP_TITLES = new Set(['定位', '与后续版本的依赖']);
const isSkippedTitle = (title) => SKIP_TITLES.has(title) || SKIP_TITLE_PREFIXES.some((p) => title.startsWith(p));
// A8 判定面（**宽**）：标题里出现标记 ⇒ 必须校验其目标。
// 与 A2 的豁免面**解耦**是硬要求：两面共用一个谓词时，「标记写在末尾括注内 / 括注外」
// 会决定它是否被校验——同一个不存在的版本号写括注内判红、写括注外完全免检（实测 P-d）。
// 宽到什么程度：出现即校验（宁可多校验几处真章标题，也不留一个可换位置免检的口子）。
const POINTER_MARKERS = ['→ 已前移', '→ 已后移'];
const hasPointerMarker = (title) => POINTER_MARKERS.some((m) => title.includes(m));

// A8 指针目标解析（豁免牌必须能兑现）
// 标记定位（判定面由 hasPointerMarker 把关，这里只负责找出标记位置以切出尾注）
const POINTER_RE = /→\s*已(前移|后移)/;
// 尾注里的三段版本号（用于扫「无法兑现的引用」与缺口报文的提示）
const ANY_VERSION_RE = /v\d+\.\d+\.\d+/g;
// 版本号槽位：「→ 已前移 / 已后移」之后**紧跟**的位置（允许空白与粗体标记）。
// 槽位形态 = v<主>.<次>(.<修订>)* ——**两段号（v1.6）也占槽**，占槽即按可兑性判。
// 为什么不能要求三段才占槽：三段严格时「→ 已后移 v1.6（参照 v1.5.4 的边界）」的槽位判空
// ⇒ 回退去兑现散文里的 v1.5.4（真实版本）⇒ 假绿（实测 R6a）；放宽后 v1.6 占槽、不可兑现 ⇒ 红。
const POINTER_VERSION_SLOT_RE = /^\s*\**\s*(v\d+(?:\.\d+)+)/;
// 回退面（`→ 已前移 第五章 见 v1.4.4`）：尾注里第一个三段号。**回退的键是「章号占槽」，
// 不是「槽位不是版本号」**——这条区别是防假绿的关节点：
//   · 键＝「槽位不是版本号」⇒ 「→ 已后移 顺延至 v1.5.4」（槽位既非版本号也非章号）会被
//     回退放行，而它恰恰是「把隐藏目标写在散文里」的写法 ⇒ 假绿（实测 R6）。
//   · 键＝「章号占槽」⇒ 只有「章号 + 尾注唯一三段号」这一种结构被认（目标被锁死），
//     其余非版本号槽位一律判红（fail-closed）。
const POINTER_TRAILING_VERSION_RE = /v\d+\.\d+\.\d+/;
// 章号槽位：版本号之后**紧跟**的位置（同样只认槽位，不认散文里出现的章号）
const POINTER_CHAPTER_SLOT_RE = /^\s*第\s*([一二三四五六七八九十百零〇\d]+)\s*章/;
const CHANGELOG_DIR_RE = /^v(\d+)\.(\d+)\.\d+$/;

// A8 章号数字归一：中文数字 ↔ 阿拉伯数字。
// 为什么需要：指针写「第8章」而目标文件写「## 八、」是语义等价写法，字面串比较会
// 判「目标章不存在」（假红）。归一后两侧折成数字再比。本仓章号只用 一..十三，
// 实现覆盖 一..九十九；归一只用于**比较**，不做字符串拼装。
const CN_NUMERALS = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

// A3 形态词枚举（标注行里的字面量形态：反引号包住的方括号形态词）
const FORM_WORDS = ['主干', '通道', '插件', '外部', '非功能'];
const formToken = (w) => '`' + '[' + w + ']' + '`';
const FORM_TOKENS = FORM_WORDS.map(formToken);
const DEPLOY_MARKER = '**部署形态**';
const DEPLOY_LABEL = '部署形态';

// A4 可拔级别（｜ 之后必须紧跟其一）
const LEVELS = ['L1 关档', 'L2 收窄', 'L3 拆件', 'L4 卸包', '**不可拔**', '—'];
const FULLWIDTH_BAR = '｜';

// A5 主干不得配的可拔级别
const TRUNK_FORBIDDEN_LEVELS = new Set(['L3 拆件', 'L4 卸包']);

// 标注行前缀（changelog 用引用块写法）
const ROADMAP_MARKER = '**形态归属**：';
const ANNOTATION_PREFIX = '> ' + ROADMAP_MARKER;

// A6 成分声明——**结构形态**（R3 修法：纯「token + 邻近词」匹配会把散文提及当真声明，
// 括注散文「本章不含 `[通道]` 成分」被旧 SUFFIX 吃、「A + `[插件]`」被旧 DECL 吃 ⇒
// A7 反向覆盖假红（实测 R3a/R3b）。结构约束判据来自基线 7 处合法声明的全量普查：
// 7/7 满足以下两形态、R3a/R3b 载体均不满足）：
//   · DECL 形态：**粗体整体包裹**（`**+` 起、`成分**` 止）且**括号深度 0**——基线 6 处
//     DECL 全部此形态（**+ `[通道]` 成分**（…））；
//   · SUFFIX 形态：**括注内（深度 ≥1）且「成分」后紧跟 `=`**——基线 1 处（v2.0.0
//     「内含 `[通道]` 成分=离线审计日志回传」）全此形态。
// 两形态互斥不重叠：DECL 的后缀命中落在深度 0，不满足 SUFFIX 的 ≥1，由 DECL 认领。
// 「成分词可省」的旧 DECL 口径删除——基线普查无一处带「可省成分词」写法，保留它
// = 保留散文「A + `[插件]`」的进入口。
const COMPONENT_DECL_STRUCT_RE = /\*\*\+\s*`\[([^\]\n]*)\]`\s*成分\*\*/g;
const COMPONENT_SUFFIX_STRUCT_RE = /`\[([^\]\n]*)\]`\s*成分\s*=/g;

/**
 * 计算行内某位置的**全角括号深度**（粗体标记不参与深度——与 A4 结构口径一致）。
 * @param {string} line 标注行原文
 * @param {number} pos 目标位置
 * @returns {number} 括号深度
 */
function parenDepthAt(line, pos) {
  let depth = 0;
  for (let i = 0; i < pos; i += 1) {
    const ch = line[i];
    if (ch === '（') depth += 1;
    else if (ch === '）') depth = Math.max(0, depth - 1);
  }
  return depth;
}

// R5 修法：A6 与 A7 实测面（parseAnnotation）**共用这一个成分提取器**。
//
// 为什么必须单源：此前 A6 与 A7 实测面是两套谓词（A6 无界空白正则 vs parseAnnotation
// 的「token 前 4 / 后 6 字符」固定窗口），空白长度落在窗口外即分歧，且分歧方向是
// fail-open（一处未对账的成分声明被放行，实测 D10/D12：10/12 空格 ⇒ exit 0 假绿；
// 1 空格 ⇒ exit 1）。「红绿开关是空白个数、不是有没有第二处声明」即此故（QA 权威
// 验收器三载体在 5/5/4 空格处翻转）。这恰是 A2/A8「不同面要独立谓词」原则的反面：
// **同一个面必须收敛为一套谓词**。注意与 A2/A8 的方向相反，别混抄。
//
// 去重键 = **反引号 token 的绝对位置**（m.index + m[0].indexOf('`[')）：两种形态会命中
// 同一处成分——DECL 形态的 m.index 落在「**」上、SUFFIX 落在反引号上，按 m.index 去重
// 必不相等 ⇒ 双计数。
//
// @param {string} line 标注行原文
// @returns {{word: string, pos: number}[]} 成分声明列表（word=形态词，pos=token 绝对位置）
function extractComponentDeclarations(line) {
  const found = [];
  const seen = new Set();
  for (const re of [COMPONENT_DECL_STRUCT_RE, COMPONENT_SUFFIX_STRUCT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const pos = m.index + m[0].indexOf('`[');
      if (seen.has(pos)) continue;
      // 结构约束：DECL 须深度 0（声明链上）；SUFFIX 须深度 ≥1（括注内「成分=」释义）
      const depth = parenDepthAt(line, pos);
      const isDecl = re === COMPONENT_DECL_STRUCT_RE;
      if (isDecl ? depth !== 0 : depth < 1) continue;
      seen.add(pos);
      found.push({ word: m[1], pos });
    }
  }
  found.sort((a, b) => a.pos - b.pos);
  return found;
}

// A7 ROADMAP 声明侧的计数模式（命中几个断言几个）。
//
// ── 判据写死（两处，勿含糊）──────────────────────────────────
// ① **只保留真能命中的模式**：本表曾有一条「只判存在性」的 /外部\]`\s*成分/ —— 它要求
//    反引号方括号形态，而 ROADMAP 实际写的是「外部成分 1」（无方括号）⇒ **永不命中的
//    死断言**（零覆盖却看起来有覆盖，比没有更坏）。现已删除该表，改为计数模式
//    /外部成分 (\d+)/；v2.0.0 的两处通道成分与「部署形态」归属同理改为可机检形态。
// ② **「哪些声明必须有」不许隐式**：本表只回答「怎么解析」，不回答「该不该有」——
//    单靠它，删掉某句声明 ⇒ 该模式从对账面消失 ⇒ 判定面静默缩小，A7 由红转绿。
//    所以必须有 EXPECTED_LABELS 逐版 pin 住（理由见其上方注释）。
// `unit` 只影响报文措辞（章级模式带「章」，成分模式不带）——「主干 4 章」与「通道成分 2」
// 两种声明的量纲不同，混用「章」会让一致性报告读起来失真。
const DECLARED_COUNT_PATTERNS = [
  { label: '主干', pattern: /主干 (\d+) 章/g, actualKey: '主干', unit: ' 章' },
  { label: '通道', pattern: /通道 (\d+) 章/g, actualKey: '通道', unit: ' 章' },
  { label: '插件', pattern: /插件 (\d+) 章/g, actualKey: '插件', unit: ' 章' },
  { label: '非功能', pattern: /非功能 (\d+) 章/g, actualKey: '非功能', unit: ' 章' },
  { label: '通道成分', pattern: /通道成分 (\d+)/g, actualKey: '通道成分', unit: '' },
  { label: '外部成分', pattern: /外部成分 (\d+)/g, actualKey: '外部成分', unit: '' },
  { label: '部署形态', pattern: /部署形态 (\d+) 章/g, actualKey: '部署形态', unit: ' 章' },
];

// A7 逐版「必须出现」的声明模式白名单（pinned）。
// 为什么必须 pin：对账语义是「声明 vs 实测」，一旦某句声明被删，该模式就从对账面
// 消失——判定面静默缩小、A7 由红转绿（实测复现：删掉 v1.5.11 的「外部成分 1」后
// 模式数 20→19、exit 仍为 0）。pin 住标签集，删声明即红。
// 版本天然不适用某模式（如 v1.5.0 无通道章）就不登记，不要求它写「通道 0 章」。
//
// 双向闭合（两个方向都要 exit 1，缺一不可）：
//   · 期望有、实测无 ⇒ 删声明 / 写法改成不可解析（判定面静默缩小）
//   · 实测有、期望无 ⇒ 悄悄加一句不可对账的声明（判定面静默变化）
// 只 pin **标签集**、不 pin 计数：计数正确性已由「声明 N vs changelog 实测 N」覆盖，
// 再抄一份数字等于同一事实存三处。
// 登记纪律：新增版本（VERSION_SOURCES）或新增某版声明，必须同批更新本表——
// 漏登记会被下面两条断言当场抓出，不会静默放行。
const EXPECTED_LABELS = {
  'v1.5.0': ['主干', '插件', '非功能', '通道成分'],
  'v1.5.3': ['主干', '非功能', '通道成分'],
  'v1.5.4': ['主干', '通道', '非功能'],
  'v1.5.5': ['主干', '非功能'],
  'v1.5.6': ['主干', '非功能', '通道成分'],
  'v1.5.7': ['主干', '非功能', '外部成分'],
  'v1.5.8': ['主干', '通道成分'],
  'v1.5.9': ['主干', '非功能', '插件'],
  'v1.6.0': ['主干', '非功能', '通道成分'],
  'v1.7.0': ['主干'],
  'v1.8.0': ['主干'],
  'v1.9.0': ['主干', '非功能'],
  'v2.0.0': ['主干', '非功能'],
};

// A7 修 C（②③）：**标签→计数** pin（EXPECTED_LABELS 的升级面，两者并用）。
// 为什么必须 pin 计数：标签 pin 只管「哪些声明必须有」，管不住「删一章 + 同批把声明
// 数字改小」——声明 N 与实测 N 双双变小、彼此仍相等 ⇒ 对账绿，判定面静默缩小
// （实测：删某版一章主干 + ROADMAP 同步改小声明计数 ⇒ 旧口径 exit 0）。
// pin 住声明值本身后：声明值与 pin 不符 ⇒ 红（报文提示同批更新 pin 表）。
// 正常加章 ⇒ 改 changelog + ROADMAP + pin 三处——多一步正是关闭缺口的代价（已拍板）。
// 初值 = 74e7a26a 时的基线实测值（六版本 20 模式逐个写死，与上方通过清单一一对应）。
// 登记纪律同 EXPECTED_LABELS：新增版本 / 新增声明 / 计数变化都必须同批更新本表。
// v2.0.0 pin 值 2026-09-22 更新：定位重写为决策模型宣告版（原「主干 1 / 通道成分 2 /
// 部署形态 1」随数据主权两章迁出作废）。同日二次拍板（版本边界纪律）：v2.0.1 撤版，
// 网络出口治理面与 AI 节点归位 v1.5.9（V2.0 前能力不放 V2.0 后版本迭代；v1.5.9 主干 4→6、
// 新增通道成分 1）。同日三次拍板（归位再分配，用户授权主理人裁定）：两章按主题亲和
// 自 v1.5.9 迁出——网络出口治理面→v1.5.2（主干 4→5、新增通道成分 1）、AI 节点治理
// 接入→v1.5.4（主干 3→4）；v1.5.9 回归进化模块四主题（主干 6→4、通道成分清零）。
// 2026-09-22 四次拍板（万物皆可 FDEing 文档重构链 C→B→A，用户确认渐进注入）：v1.5.1
// 新增非功能 1（断言承载面普查 R1）；v1.5.2 新增非功能 1（README 三层叙事注入 R2）；
// v1.5.3 非功能 1→2（+ARCHITECTURE 三域重构 R3）；v1.5.4 新增非功能 1（PHILOSOPHY
// 叙事章 R4）；v1.5.5 新增非功能 1（README 理念主线全量重写 R5）；v1.5.6 非功能 1→2
// （+运维安全文档注入 R6）；v1.5.7 非功能 1→2（+VALIDATION/WIKI 注入 R7）；v1.5.9
// 新增非功能 1（FDE Handbook 升格 R8）。
// 2026-09-22 五次拍板（探索方向清仓，用户拍板「逐项裁定、排进 V2.0 前」+ 兼容层退役
// 清单「加」）：11 项迁入具体版本章——v1.5.2 主干 5→6 + 通道成分 1→2（mandate 补环）；
// v1.5.3 主干 3→4（判决类记录成对完整）+ 非功能 2→3（AuditScope 重构）；
// v1.5.4 主干 4→5（授权面与凭证面对账）；v1.5.7 主干 4→5（决策日志作审计输入源）+
// 非功能 2→4（国标对位 + ACS YAML 评估）；v1.5.8 主干 4→5（RL 训练治理）；
// v1.5.9 主干 4→5（透明仓与敌手自测合流）；v2.0.0 非功能 3→4（兼容层退役清单）。
// 2026-09-22 六次拍板（已交付能力面退役，用户问「已开发好的内容在 V2.0.0 有没有要
// 退役的」）：v2.0.0 非功能 4→5（已交付能力面的归属与退役清单）。
// 标签集无新增，故 EXPECTED_LABELS 本次不动。
const EXPECTED_COUNTS = {
  'v1.5.0': { 主干: 5, 插件: 1, 非功能: 3, 通道成分: 1 },
  'v1.5.3': { 主干: 4, 非功能: 4, 通道成分: 1 }, // 非功能 3→4：阶段三补发布门禁总表章（ROADMAP 同批声明，落桶登记随章）
  'v1.5.4': { 主干: 5, 通道: 1, 非功能: 1 },
  'v1.5.5': { 主干: 2, 非功能: 1 },
  'v1.5.6': { 主干: 1, 非功能: 2, 通道成分: 1 },
  'v1.5.7': { 主干: 5, 非功能: 4, 外部成分: 1 },
  'v1.5.8': { 主干: 5, 通道成分: 1 },
  'v1.5.9': { 主干: 5, 非功能: 1 },
  'v1.6.0': { 主干: 8, 非功能: 1, 通道成分: 1 },
  'v1.7.0': { 主干: 6 },
  'v1.8.0': { 主干: 6 },
  'v1.9.0': { 主干: 8, 非功能: 1 },
  'v2.0.0': { 主干: 2, 非功能: 5 },
};

// ── 输出样式（与 check-anchors.mjs 同款 ASCII 颜色 + ═ 横幅）────
const colors = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const RULE = '═'.repeat(60);

/**
 * 转义正则元字符（版本号含点号）。
 * @param {string} s 原文
 * @returns {string} 转义后的字面量正则源码
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 截断长行，避免报告刷屏。
 * @param {string} s 原文
 * @param {number} n 上限字数
 * @returns {string} 截断后的文本
 */
function clip(s, n = 90) {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

/**
 * 扫描标注行的**结构**：括号深度为 0 的全角竖线位置 + 括号是否平衡。
 *
 * 为什么不能直接用 indexOf('｜')：标注里出现竖线的场合不止「形态 ｜ 可拔级别」
 * 这一处结构语法，括注内部完全可能引用一句「｜ L1 关档 的说明」。用第一根竖线
 * 当结构竖线会双向出错：
 *   · 假绿：`[主干]（判定·多数表决 + 分歧路由；见 ｜ L1 关档 的说明）`——括注里的
 *     字面竖线被当成结构竖线，于是「没有级别」的标注也能过。
 *   · 假红：`[主干]（判定·多数表决 ｜ 分歧路由 HITL）｜ L1 关档`——级别明明齐全，
 *     却被当成「竖线后无可拔级别」，逼人改写合法文案。
 * 所以按**括号深度**区分：只有深度 0 的竖线才是结构竖线。
 *
 * 括号**只数全角圆括号**（），半角括号不参与深度：
 *   · 方括号在本仓是形态 token 的定界符（见 FORM_WORDS 的 token 写法），混进来会把
 *     token 内部当成括号层级，反而制造噪声；
 *   · 半角括号在本仓是**散文标点**，不是结构分组——「列项 1) 另见附录」「(a)(b) 两类
 *     口径」这类写法与「形态 ｜ 可拔级别」的结构无关。把它们计入深度，一处落单半角
 *     右括号（深度净 −1）就会让整仓进 exit 2 并误报「检查器失明」——故障其实是文档
 *     散文里的一个半角字符（假红最强形态）。
 *     只治「落单」而不误伤「成对」的唯一干净口径是：**半角括号一律不参与深度**。
 *     实测 38 条标注行：全角括号 38/38 平衡、含半角括号 0 行、无任一行依赖半角嵌套。
 *
 * 不平衡或深度 0 处多根竖线 ⇒ 结构二义，调用方须按 exit 2 处理（不猜）。
 * @param {string} line 标注行原文
 * @returns {{bars: number[], balanced: boolean}} bars 为深度 0 竖线的下标
 */
function scanStructure(line) {
  const bars = [];
  let depth = 0;
  let balanced = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '（') {
      depth += 1;
    } else if (ch === '）') {
      depth -= 1;
      if (depth < 0) balanced = false;
    } else if (ch === FULLWIDTH_BAR && depth === 0) {
      bars.push(i);
    }
  }
  if (depth !== 0) balanced = false;
  return { bars, balanced };
}

/**
 * 解析一条标注行，抽出主形态 / 成分 / 可拔级别。
 *
 * 主形态口径：第一个出现的形态词。例外——第三轴标记 **部署形态** 出现在
 * 首个形态词之前时，本章主形态归「部署形态」类（不计入主干）。
 *
 * 成分口径：主形态之后的形态词，且被「+」前缀标记或被「成分」后缀标记——判定走
 * extractComponentDeclarations（与 A6 同一提取器，R5 单源）。
 * @param {string} line 标注行原文
 * @returns {{mainForm: string|null, components: string[], level: string|null, struct: {bars: number[], balanced: boolean}, hasBar: boolean}}
 */
function parseAnnotation(line) {
  const occurrences = [];
  FORM_TOKENS.forEach((token, k) => {
    let idx = line.indexOf(token);
    while (idx >= 0) {
      occurrences.push({ word: FORM_WORDS[k], index: idx });
      idx = line.indexOf(token, idx + token.length);
    }
  });
  occurrences.sort((a, b) => a.index - b.index);

  const deployIndex = line.indexOf(DEPLOY_MARKER);
  const firstWordIndex = occurrences.length > 0 ? occurrences[0].index : -1;
  const deployWins = deployIndex >= 0 && (firstWordIndex < 0 || deployIndex < firstWordIndex);
  const mainForm = deployWins
    ? DEPLOY_LABEL
    : occurrences.length > 0
      ? occurrences[0].word
      : null;

  const rest = deployWins ? occurrences : occurrences.slice(1);
  // R5：成分判定改走与 A6 同一个提取器（extractComponentDeclarations）——同一行写入
  // 不论空白多少，A6 与 A7 实测面看到同一个成分集合（原「前 4 / 后 6 固定窗口」已删，
  // 空白翻转移转点即消失）。主形态 token 不算成分：按 token 绝对位置排除首个（主形态）位。
  const firstTokenPos = occurrences.length > 0 ? occurrences[0].index : -1;
  const componentSet = new Set(
    extractComponentDeclarations(line)
      .filter((c) => !(deployWins ? false : c.pos === firstTokenPos))
      .map((c) => c.word),
  );
  const components = rest.map((o) => o.word).filter((w) => componentSet.has(w));

  const struct = scanStructure(line);
  const hasBar = struct.bars.length > 0;
  // 级别口径：深度 0 处那根结构竖线之后的文本（允许尾部「（…）」括注）须以
  // 合法级别 token 开头。级别 token 可能很长（如 **不可拔**（关掉它整套可拔
  // 声明失去依据））⇒ 不做长度假设截断，只判前缀。
  let level = null;
  if (struct.bars.length === 1) {
    const tail = line.slice(struct.bars[0] + 1).trim();
    level = LEVELS.find((m) => tail.startsWith(m)) || null;
  }

  return { mainForm, components, level, struct, hasBar };
}

/**
 * 章体是否为「纯指针存根」：章体内 非空 / 非分隔线 / 非「前移·后移说明块」/ 非注释
 * 的行数为 0 ⇒ 存根 ⇒ 本章无交付面（A2 豁免其标注要求）。
 *
 * 为什么判**章体**、不判标题形态：标题只是文本，谁都能在括注里加一句「→ 已后移 v1.5.4
 * 的对照」——按标题形态豁免会把**真章**当成指针章豁免掉，于是它悄悄退出 A5/A4/A7 的
 * 判定面（实测：38→37 章、covered 44→43）；反过来把标记挪到括注外又完全免检。
 * 存根判据回答的才是实质问题：这一章到底有没有交付内容。
 * 口径细节：说明块按**块**判（连续「>」行成块，块内任一行含 前移/后移 即为指针说明块）
 * ——多行块只要求其中一行提到方向词，免得把正常的换行写法判成「有交付内容」（假红）。
 * @param {string[]} bodyLines 章体行（标题行之后、下一标题之前）
 * @returns {boolean} 是否纯指针存根
 */
function isPointerStub(bodyLines) {
  let inComment = false;
  for (let i = 0; i < bodyLines.length; i += 1) {
    const t = bodyLines[i].trim();
    if (inComment) {
      if (t.includes('-->')) inComment = false;
      continue;
    }
    if (t === '') continue; // 空行
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) continue; // 分隔线
    if (t.startsWith('<!--')) {
      if (!t.includes('-->')) inComment = true;
      continue;
    }
    if (!t.startsWith('>')) return false; // 正文段落 / 列表 / 表格 ⇒ 有交付内容
    const start = i;
    while (i < bodyLines.length && bodyLines[i].trim().startsWith('>')) i += 1;
    const block = bodyLines.slice(start, i).join('\n');
    // 引用块里没有方向词 ⇒ 它是内容块（如交付说明），不是指针说明块
    if (!block.includes('前移') && !block.includes('后移')) return false;
    i -= 1;
  }
  return true;
}

/**
 * 收集一个 changelog 文件里所有「需要标注的章」及其标注行。
 * 章体上界 = 下一个二级标题（或文件尾）——防止下一章的标注被本章「借走」。
 *
 * 两个面刻意**解耦**（理由见文件头 A2 / A8 说明）：
 *   · A2 豁免面（不进 chapters ⇒ 不要求标注）：章体为纯指针存根（isPointerStub）。
 *   · A8 判定面（进 pointers ⇒ 校验目标）：任何含「→ 已前移 / → 已后移」标记的标题。
 * 两面可以同时命中：真章标题里引用一句标记 ⇒ 既要求标注（它有交付面），其目标也要能兑现。
 * @param {string} relFile 仓库相对路径
 * @returns {{exists: boolean, chapters: object[], headings: number, pointers: {title: string, line: number}[]}}
 */
function collectChapters(relFile) {
  const abs = path.join(ROOT, relFile);
  if (!fs.existsSync(abs)) return { exists: false, chapters: [], headings: 0, pointers: [] };

  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const headings = [];
  lines.forEach((line, i) => {
    if (/^## /.test(line)) headings.push({ index: i, title: line.replace(/^##\s+/, '').trim() });
  });

  const chapters = [];
  const pointers = [];
  headings.forEach((h, k) => {
    if (isSkippedTitle(h.title)) return;
    const bodyEnd = k + 1 < headings.length ? headings[k + 1].index : lines.length;
    const bodyLines = lines.slice(h.index + 1, bodyEnd);

    // A8 判定面（宽）：含标记的标题一律进 A8，与它是不是「存根章」无关
    if (hasPointerMarker(h.title)) {
      pointers.push({ title: h.title, line: h.index + 1 });
    }

    // A2 豁免面：章体是纯指针存根 ⇒ 无交付面，不要求标注
    if (isPointerStub(bodyLines)) return;

    let annotation = null;
    let annotationLine = 0;
    for (let i = h.index + 1; i < bodyEnd; i++) {
      if (lines[i].trimStart().startsWith(ANNOTATION_PREFIX)) {
        annotation = lines[i];
        annotationLine = i + 1;
        break;
      }
    }

    chapters.push({
      file: relFile,
      headingLine: h.index + 1,
      title: h.title,
      annotation,
      annotationLine,
      parsed: annotation ? parseAnnotation(annotation) : null,
    });
  });

  return { exists: true, chapters, headings: headings.length, pointers };
}

/**
 * 由版本号推开发日志路径（v1.4.4 → docs/changelog/v1.4/v1.4.4.md）。
 * @param {string} ver 版本号
 * @returns {string|null} 仓库相对路径；版本号形态非法时返回 null
 */
function changelogPathOf(ver) {
  const m = CHANGELOG_DIR_RE.exec(ver);
  return m ? `docs/changelog/v${m[1]}.${m[2]}/${ver}.md` : null;
}

/**
 * ROADMAP 里是否存在该版本行。
 *
 * 首列的**加粗与否不参与判定**——加粗是排版风格，不是判据（与 A7 的版本行口径同一原则：
 * 只认加粗行会让非加粗的重复行完全隐形）。本函数是「ROADMAP 有没有这个版本」的**唯一**
 * 口径，A8 的两处兑现路径与尾注引用检查都走它，免得同一事实在文件里存在两种写法。
 * @param {string} ver 版本号
 * @param {string} roadmapText ROADMAP 全文
 * @returns {boolean} 是否存在该版本行
 */
function roadmapHasVersionRow(ver, roadmapText) {
  return new RegExp(
    '^\\|\\s*(?:\\*\\*)?\\s*' + escapeRe(ver) + '\\s*(?:\\*\\*)?\\s*\\|',
    'm',
  ).test(roadmapText);
}

/**
 * 一个版本号是否「可兑现」：有开发日志文件 或 ROADMAP 有该版本行。
 *
 * 用途：指针尾注里的**引用**是否指向真实存在的东西——不存在 ⇒ 引用无法兑现 ⇒ 判红。
 * 真实存在的版本号一律放行（引用真实版本作对照 / 写沿革是合法写作，不是缺陷）。
 * @param {string} ver 版本号
 * @param {string} roadmapText ROADMAP 全文
 * @returns {boolean} 是否可兑现
 */
function versionRedeemable(ver, roadmapText) {
  const f = changelogPathOf(ver);
  if (f !== null && fs.existsSync(path.join(ROOT, f))) return true;
  return roadmapHasVersionRow(ver, roadmapText);
}

/**
 * 把章号折成数字（中文数字与阿拉伯数字都认）。
 *
 * 为什么需要：指针写「第8章」而目标文件写「## 八、」是语义等价写法，字面串比较会判
 * 「目标章不存在」（假红）。归一后两侧折成数字再比。
 * 归一不了（「廿」「1-2」这类）⇒ 返回 null，调用方退回字面比较——**fail-closed**：
 * 归一不了不等于目标存在。
 * @param {string} s 章号原文
 * @returns {number|null} 数字；无法归一时为 null
 */
function numeralToNumber(s) {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (t === '十') return 10;
  if (t.includes('十')) {
    const [hi, lo] = t.split('十');
    const tens = hi === '' ? 1 : CN_NUMERALS[hi];
    const ones = lo === '' ? 0 : CN_NUMERALS[lo];
    if (tens === undefined || ones === undefined || tens > 9 || ones > 9) return null;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of t) {
    const d = CN_NUMERALS[ch];
    if (d === undefined || d >= 10) return null;
    n = n * 10 + d;
  }
  return t.length > 0 ? n : null;
}

/**
 * 读文件并判断是否存在形如「## <cn>、」的章（cn 为指针里写的章号）。
 *
 * 章号按**数字**比较（中文数字与阿拉伯数字等价）：指针里的「第8章」与目标文件里的
 * 「## 八、」是同一章。无法归一才退回字面比较。
 * @param {string} relFile 仓库相对路径
 * @param {string} cn 章号（中文数字或阿拉伯数字）
 * @returns {boolean} 该章是否存在
 */
function chapterExists(relFile, cn) {
  const abs = path.join(ROOT, relFile);
  if (!fs.existsSync(abs)) return false;
  const text = fs.readFileSync(abs, 'utf8');
  const want = numeralToNumber(cn);
  if (want === null) {
    // 归一不了 ⇒ 退回字面比较（字面不存在即判不存在，不因为归一失败而放行）
    return new RegExp('^## ' + escapeRe(cn) + '、', 'm').test(text);
  }
  const re = /^##\s*([^、\n]+)、/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (numeralToNumber(m[1]) === want) return true;
  }
  return false;
}

/**
 * 校验一处「→ 已前移 / → 已后移」指针章的目标是否真实存在。
 *
 * 为什么必须校验：A2 对指针章的豁免是「无交付面」的信任状。若只做标题子串匹配，
 * 「把真章标题改成 `（→ 已后移 v1.5.99）`（该版本在仓库里根本不存在）+ 同文件补一个
 * 同形态合成章补偿计数」就能整章洗白，且 ROADMAP 可以逐字节不动——豁免牌成了
 * 洗白通道。豁免牌必须能兑现：指向的东西要真的在。
 *
 * 解析口径（槽位锚定，不取散文字串）：① 目标版本号须**占槽**（紧跟方向词之后），槽位形态
 * v<主>.<次>(.<修订>)*——两段号（v1.6）也占槽，占槽即按可兑性判；槽位不是版本号形态时，
 * **只认「章号占槽」的回退形态**（「→ 已前移 第五章 见 v1.4.4」，目标＝尾注里那个三段号），
 * 其余写法不拿散版本号当目标 ⇒ 判红（fail-closed）；
 * ② 尾注其余部分的版本号**只打无法兑现的引用**——既无开发日志、也无 ROADMAP 版本行才判红，
 * 引用真实存在的版本号（对照 / 沿革说明）一律放行，判定对象是槽位上那个版本号；
 * ③ 章号须紧跟目标版本号之后（回退形态下紧跟方向词之后）。章号比较按数字归一（「第8章」≡「## 八、」）。
 * @param {string} title 章标题
 * @param {number} line 标题行号
 * @param {string} relFile 所在文件（用于报文与自指判定）
 * @param {string} selfVersion 本文件版本号
 * @param {string} roadmapText ROADMAP 全文（「已后移」的另一条兑现路径）
 * @returns {string|null} 违规明细；目标可兑现时返回 null
 */
function pointerTargetDetail(title, line, relFile, selfVersion, roadmapText) {
  const where = `${relFile}:${line}`;
  const pm = POINTER_RE.exec(title);
  const dir = pm[1];
  const tail = title.slice(pm.index + pm[0].length);

  // ① 目标版本号：先看槽位（**两段号也占槽**）；槽位不是版本号形态时，**只认「章号占槽」这一种
  //    回退形态**（「→ 已前移 第五章 见 v1.4.4」）——它把目标锁在尾注里唯一那个三段号上；
  //    其余写法（如「→ 已后移 顺延至 v1.5.4」）不拿尾注里的散版本号当目标 ⇒ 判红（fail-closed）。
  let ver = null;
  let afterVer = '';
  const vm = POINTER_VERSION_SLOT_RE.exec(tail);
  if (vm) {
    ver = vm[1];
    // ③ 章号只认槽位（目标版本号之后紧跟的位置）——散文里出现的章号不算目标
    afterVer = tail.slice(vm[0].length).replace(/^\**\s*/, '');
  } else {
    const cmHead = POINTER_CHAPTER_SLOT_RE.exec(tail);
    const fb = POINTER_TRAILING_VERSION_RE.exec(tail);
    if (!cmHead || !fb) {
      return `${where} 指针「→ 已${dir}」缺目标版本号：槽位须紧跟 v<主>.<次>(.<修订>)?，或写成「第<cn>章 + 尾注内唯一 v<主>.<次>.<修订>」（如「→ 已前移 第五章 见 v1.4.4」）——尾注里的散版本号不算目标：${clip(title)}`;
    }
    // 回退形态：章号占槽、版本号写在尾注后段；章号仍按槽位口径取——紧跟方向词之后
    ver = fb[0];
    afterVer = tail;
  }

  // ② 尾注其余部分的版本号：只打**无法兑现的引用**——既无开发日志、也无 ROADMAP 版本行
  //    的版本号说明「这里引用了一个不存在的东西」，判红；引用真实存在的版本号（对照 /
  //    沿革说明）是合法写作，一律放行。判定对象永远是槽位上那个版本号（ver）。
  //    （为什么不做「尾注只许唯一版本号」的计数口径：见头部已知边界 ④——已评估否决。）
  const strays = (tail.match(ANY_VERSION_RE) || []).filter(
    (v) => v !== ver && !versionRedeemable(v, roadmapText),
  );
  if (strays.length > 0) {
    return `${where} 指针尾注里的 ${strays.join(' / ')} 无法兑现（既无开发日志、也无 ${ROADMAP_FILE} 版本行）；判定对象是槽位上那个版本号（${ver}）——对照/参照类引用请移入章正文，或改指向真实存在的版本：${clip(title)}`;
  }

  if (ver === selfVersion) {
    return `${where} 指针自指本版（→ 已${dir} ${ver}）——前移/后移的目标不能是本版`;
  }

  const targetFile = changelogPathOf(ver);
  const targetExists = targetFile !== null && fs.existsSync(path.join(ROOT, targetFile));
  // 两段号（v1.6）没有开发日志路径 ⇒ 兑现只能走 ROADMAP 版本行；报文里如实说明，不留空壳路径
  const noLogPath = `${ver} 非 v<主>.<次>.<修订> 形态，无开发日志可查`;
  const cm = POINTER_CHAPTER_SLOT_RE.exec(afterVer);

  if (dir === '前移') {
    if (!targetExists) {
      return `${where} 指针目标不存在：→ 已前移 ${ver}——${targetFile === null ? noLogPath : `${targetFile} 在仓库里不存在`}`;
    }
    if (cm && !chapterExists(targetFile, cm[1])) {
      return `${where} 指针目标章不存在：→ 已前移 ${ver} ${cm[1]}章，但 ${targetFile} 内无「## ${cm[1]}、」章（章号已按中文/阿拉伯数字归一比较）`;
    }
    return null;
  }

  // 「已后移」：目标在后（可能还没写出开发日志）⇒ 两条兑现路径任一即可
  // 口径与 versionRedeemable / A7 版本行一致（加粗是排版风格，不参与判定）
  const inRoadmap = roadmapHasVersionRow(ver, roadmapText);
  if (!targetExists && !inRoadmap) {
    return `${where} 指针目标不存在：→ 已后移 ${ver}——${ROADMAP_FILE} 无「| ${ver} |」版本行（加粗与否都认），且 ${targetFile === null ? noLogPath : `${targetFile} 不存在`}`;
  }
  // 带章号时，若目标开发日志已存在则同样校验该章（对称于「已前移」；目标文件
  // 尚未写出时无处可查，放行）
  if (cm && targetExists && !chapterExists(targetFile, cm[1])) {
    return `${where} 指针目标章不存在：→ 已后移 ${ver} ${cm[1]}章，但 ${targetFile} 内无「## ${cm[1]}、」章（章号已按中文/阿拉伯数字归一比较）`;
  }
  return null;
}

/**
 * 统计一组章的主形态分布与成分分布。
 * @param {object[]} chapters collectChapters 产出的章列表
 * @returns {{mainCounts: Map<string, number>, componentCounts: Map<string, number>}}
 */
function tally(chapters) {
  const mainCounts = new Map();
  const componentCounts = new Map();
  for (const ch of chapters) {
    if (!ch.parsed) continue;
    if (ch.parsed.mainForm) {
      mainCounts.set(ch.parsed.mainForm, (mainCounts.get(ch.parsed.mainForm) || 0) + 1);
    }
    for (const c of ch.parsed.components) {
      componentCounts.set(c, (componentCounts.get(c) || 0) + 1);
    }
  }
  return { mainCounts, componentCounts };
}

/**
 * 取出某版本实测值（按 A7 口径）。
 * 口径：主形态为「主干」且带通道成分的章，计入「主干 N 章」，
 *       同时把成分计入「通道成分」计数——两个维度各自独立计数。
 * @param {string} actualKey 口径键（主干/通道/插件/非功能/通道成分/外部成分）
 * @param {{mainCounts: Map<string, number>, componentCounts: Map<string, number>}} tallied
 * @returns {number} 实测数
 */
function actualValue(actualKey, tallied) {
  if (actualKey === '通道成分') return tallied.componentCounts.get('通道') || 0;
  if (actualKey === '外部成分') return tallied.componentCounts.get('外部') || 0;
  return tallied.mainCounts.get(actualKey) || 0;
}

/**
 * 从 ROADMAP 里取出某版本「规划版本」表格行中声明段（形态归属：之后的文本）。
 * 同时回报该版本行的**全部**出现位置——版本行重复（两处互相矛盾的声明并存）时
 * 取首行会静默掩盖冲突，故调用方须据此判违规。
 *
 * 版本行首列的**加粗可省**：唯一性判据必须与书写风格无关——只认加粗行时，一条非加粗的
 * 重复版本行会完全隐形（不进 rows ⇒ 既不参与对账、也不触发重复判红），两处互相矛盾的
 * 声明就能并存。加粗只是既有排版风格，不是判据的一部分。
 * 实测 ROADMAP 全文 0 条非加粗三段版本行 ⇒ 放宽后仍命中原来那 20 行，零误伤。
 * @param {string} roadmapText ROADMAP 全文
 * @param {string} version 版本号（如 v1.5.0）
 * @returns {{status: 'ok'|'no-row'|'no-marker', line: number, segment: string, rows: number[]}}
 */
function extractDeclaredSegment(roadmapText, version) {
  const lines = roadmapText.split('\n');
  const rowRe = new RegExp(
    '^\\|\\s*(?:\\*\\*)?\\s*' + escapeRe(version) + '\\s*(?:\\*\\*)?\\s*\\|',
  );
  const rows = [];
  lines.forEach((l, i) => {
    if (rowRe.test(l)) rows.push(i + 1);
  });
  if (rows.length === 0) return { status: 'no-row', line: 0, segment: '', rows };

  const row = lines[rows[0] - 1];
  const mi = row.indexOf(ROADMAP_MARKER);
  if (mi < 0) return { status: 'no-marker', line: rows[0], segment: '', rows };
  return { status: 'ok', line: rows[0], segment: row.slice(mi + ROADMAP_MARKER.length), rows };
}

/**
 * 把声明段切成**子句**（A7 声明计数「子句头部取数」的基础，即 D-1 修法 A）。
 *
 * 子句边界 = **全角括号深度 0** 处的声明分隔符「＋/+」（声明之间用它连接）与句读
 * 「；/。/，」（行内说明散文与声明用它分隔）——与 A4 结构竖线同口径：括注内部的分隔符
 * 不是声明边界（括注里写「（历史口径主干 9 章）」属行内说明，不是第二处声明）。
 * @param {string} segment 声明段文本
 * @returns {string[]} 子句片段（保持原文顺序）
 */
function splitDeclaredClauses(segment) {
  const BOUNDARY = new Set(['＋', '+', '；', '。', '，']);
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === '（') {
      depth += 1;
    } else if (ch === '）') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && BOUNDARY.has(ch)) {
      parts.push(segment.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(segment.slice(start));
  return parts;
}

/**
 * 收集一个模式的**声明数字**：只认「落在子句头部」的命中（D-1 修法 A）。
 *
 * 为什么按子句头部：声明段 = ROADMAP 版本行「形态归属：」之后的**整行剩余**，行内说明
 * 历史口径（「另有一处旧文写主干 2 章」「（历史口径主干 9 章）」）是合法写作——早先按整段
 * 扫全部命中，散文里的旧口径数字会与自家声明数字构成「二义」假红（实测 R4）。
 * 判据：把段落按子句边界切开后，**只有紧贴子句开头的命中才算声明**（前导仅允许空白）；
 * 不在头部的命中（括注内 / 说明引导语之后）一律视为散文提及，不计入对账、不判二义。
 * 真二义仍然拦得住：「；主干 2 章为另一批（历史口径）」这种**以 label 开头的独立子句**
 * 就是一处新声明 ⇒ 数字不同即红（实测 R4′）。
 * 普查依据：真实 6 个声明段共 20 处声明命中，**20/20 都落在自家子句头部**（「+ 主干 5 章
 * （…）」形态）⇒ 本口径对真实树零改判（QA 独立复算一致）。
 *
 * ⑩ 修法（fail-closed）：同一子句**中部**再出现「<label> <数字> 章」结构不再是「静默
 * 忽略」——那是把第二处声明藏进同句的写法（半角逗号 / 顿号 / 直接连写），契约要求
 * 多个声明用「＋」或「；」连接为独立子句。散文提及不带「数字＋章」结构（「另有一处
 * 旧文写主干 2 章」的「主干 2 章」在**独立子句头部**，由头部判据认领或拒绝，与此处
 * 无关），所以报错面不吞散文。返回 { numbers, intraErrors }：前者供对账，后者供
 * 「声明子句内多处计数」违规（exit 1）。
 * @param {RegExp} pattern 带 g 标志的模式
 * @param {string} segment 声明段文本
 * @param {string} label 该模式的显示名（报错用）
 * @param {string} unit 单位后缀（报错用）
 * @returns {{numbers: number[], intraErrors: string[]}} 头部声明数字 + 子句中部结构违规
 */
function collectNumbers(pattern, segment, label = '', unit = '') {
  const numbers = [];
  const intraErrors = [];
  const clauses = splitDeclaredClauses(segment);
  // ⑩ 的「声明子句」判定是**子句级**、不是 pattern 级：顿号连接的第二处声明往往换
  // label（「主干 5 章、通道 3 章」）——「通道」pattern 在该子句无头部命中，但子句本身
  // 在声明链上（「主干 5 章」占头部）。任一计数模式在该子句头部命中 ⇒ 子句属声明链。
  const clauseIsDeclarative = clauses.map((clause) =>
    DECLARED_COUNT_PATTERNS.some(({ pattern: p }) => {
      p.lastIndex = 0;
      const m = p.exec(clause);
      return m !== null && clause.slice(0, m.index).trim() === '';
    }),
  );
  clauses.forEach((clause, ci) => {
    pattern.lastIndex = 0;
    let m;
    let headTaken = false;
    while ((m = pattern.exec(clause)) !== null) {
      const atHead = clause.slice(0, m.index).trim() === '';
      if (atHead && !headTaken) {
        // 头部判据：命中之前只允许空白（段首 / 「＋」后 / 句读后紧跟 label 的才是声明）
        numbers.push(Number(m[1]));
        headTaken = true;
      } else if (!atHead && clauseIsDeclarative[ci]) {
        // ⑩ fail-closed（收窄判据）：只报「声明子句的中部第二处计数」——藏声明的
        // 形态是声明链子句里头部声明之后再接一处计数（顿号 / 半角逗号 / 直接连写，
        // 同 label 或换 label 都是）。**纯散文子句**（「；另有一处旧文写「主干 2 章」」）
        // 不报：散文提及历史口径是合法写作（R4a 冻结用例），报它就是 D-1 要修的那类
        // 假红回潮。括注内（深度 ≥1）的命中同样不报——声明语法从不在括注内（R4b）。
        const depth = parenDepthAt(clause, m.index);
        if (depth === 0) {
          intraErrors.push(`${label} ${m[1]}${unit}`.trim() || `${m[0]}`);
        }
      }
    }
  });
  return { numbers, intraErrors };
}

/**
 * 输出 coverage 对账行（check-docs.sh 同款格式；必须是最后一行）。
 * asserts 语义：已运行并给出判定的断言数（失明判定也是判定）；前置读失败发生在断言
 * 运行之前，不计入。
 * @param {number} asserts 断言执行数
 * @param {number} covered 扫描覆盖数
 */
function emitCoverage(asserts, covered) {
  console.log(`[check:coverage] script=check-forms asserts=${asserts} covered=${covered} skipped=0`);
}

/** 断言编号清单（稳定标签，不重编号）：失明早退时用来披露「哪些断言没跑过」 */
const ASSERTION_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

/**
 * 失明早退时的披露行：列出失明点之后**未执行**的断言编号。
 *
 * 为什么必须披露：失明早退的报文只说「有几项断言跑了」，读者据此无法判断「没跑的是
 * 哪几项」——而失明恰恰意味着判定面不完整，覆盖缺口在哪必须一眼可见。编号是稳定标签，
 * 后续追加断言不会让旧编号漂移。
 * @param {number} executed 已 judge 完的断言数（失明点自身计入）
 */
function emitBlindTail(executed) {
  const pending = ASSERTION_IDS.slice(executed);
  if (pending.length > 0) {
    console.log(colors.yellow(`  ⚠️ 失明点之后的断言未执行：${pending.join(' / ')}`));
  }
}

/**
 * 打印违规明细。
 *
 * 每条明细前加 ❌ 标记（与 check-tool-health / doc-discipline 同款）——调用方
 * （pre-push 步骤 3h / CI）用 grep -E "❌|违规" 就能直接拿到明细行，而不只是
 * 「有几处违规」的汇总。断言行本身仍用 ✓ / ✗（见上方逐条输出）。
 * @param {string[]} details 违规明细
 */
function printViolations(details) {
  for (const d of details) console.log(colors.red(`      ❌ ${d}`));
}

/** 断言收集器 */
const ASSERTIONS = [];

/**
 * 登记一条断言结果。
 * @param {string} id 断言编号（A1..A7）
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {string} summary 通过时的摘要（一行）
 * @param {string[]} details 违规明细（每条即一处违规）
 */
function judge(id, name, ok, summary, details = []) {
  ASSERTIONS.push({ id, name, ok, summary, details });
}

/** 主流程 */
function main() {
  console.log(colors.bold(colors.cyan(RULE)));
  console.log(colors.bold(colors.cyan('  check-forms · 「形态归属」标注一致性守卫（changelog ↔ ROADMAP）')));
  console.log(colors.bold(colors.cyan(RULE)));
  console.log('');

  // ── 扫描面读取（显式清单 → 章节）──
  const byFile = new Map();
  const missingFiles = [];
  for (const relFile of SCAN_FILES) {
    const res = collectChapters(relFile);
    byFile.set(relFile, res);
    if (!res.exists) missingFiles.push(relFile);
  }
  const filesFound = SCAN_FILES.length - missingFiles.length;
  const allChapters = SCAN_FILES.flatMap((f) => byFile.get(f).chapters);
  const chapterTotal = allChapters.length;

  console.log(`  扫描面：${filesFound} 文件（显式清单，不扫目录）/ ${chapterTotal} 需标注章`);
  console.log(colors.cyan(`  ℹ️ 不扫 ${OPT_OUT_NOTE}`));
  if (missingFiles.length > 0) {
    for (const f of missingFiles) console.log(colors.red(`  ✗ 扫描面文件缺失：${f}`));
  }
  console.log('');

  // ── A1 失明自检（最先判：读不到就拒绝判定，绝不输出「通过」）──
  const blindOk = filesFound >= MIN_FILES && chapterTotal >= MIN_CHAPTERS;
  const a1Detail = `${filesFound} 文件（基线 ≥${MIN_FILES}，含缺失 ${missingFiles.length}）/ ${chapterTotal} 章（基线 ≥${MIN_CHAPTERS}）`;
  judge(
    'A1',
    '失明自检',
    blindOk,
    `${a1Detail}——扫描面正常`,
    blindOk ? [] : [`检查器失明：扫描面异常（${filesFound} 文件 / ${chapterTotal} 章），拒绝假绿`],
  );

  if (!blindOk) {
    console.log(colors.red(`  ✗ A1 失明自检：${a1Detail}`));
    console.log(
      colors.red(`    检查器失明：扫描面异常（${filesFound} 文件 / ${chapterTotal} 章），拒绝假绿`),
    );
    console.log(colors.yellow('    处置：核对脚本里的 SCAN_FILES 常量与仓库实际路径（路径漂移 = 假绿温床）'));
    console.log('');
    console.log(colors.bold(colors.cyan(RULE)));
    console.log(colors.red('  1 项断言 / 1 处违规（检查器失明，拒绝判定）'));
    emitBlindTail(ASSERTIONS.length);
    emitCoverage(ASSERTIONS.length, chapterTotal);
    process.exit(2);
  }
  console.log(colors.green(`  ✓ A1 失明自检：${a1Detail}`));

  // ── A2 每章必有标注 ──
  const noAnnotation = allChapters.filter((ch) => ch.annotation === null);
  const a2Details = noAnnotation.map(
    (ch) => `${ch.file}:${ch.headingLine} 「${clip(ch.title, 60)}」缺「形态归属」行`,
  );
  judge(
    'A2',
    '每章必有标注',
    a2Details.length === 0,
    `${chapterTotal - noAnnotation.length}/${chapterTotal} 章带「形态归属」行（已排除 定位 / 与后续版本的依赖 / 章体为纯指针存根的章）`,
    a2Details,
  );
  if (a2Details.length === 0) {
    console.log(colors.green(`  ✓ A2 每章必有标注：${chapterTotal}/${chapterTotal} 章带「形态归属」行`));
  } else {
    console.log(colors.red(`  ✗ A2 每章必有标注：${noAnnotation.length}/${chapterTotal} 章缺标注行`));
    printViolations(a2Details);
  }

  // ── A3 形态词封闭枚举 ──
  const judgeable = allChapters.filter((ch) => ch.annotation !== null);
  const badForm = judgeable.filter((ch) => {
    const line = ch.annotation;
    return !FORM_TOKENS.some((t) => line.includes(t)) && !line.includes(DEPLOY_MARKER);
  });
  const a3Details = badForm.map(
    (ch) => `${ch.file}:${ch.annotationLine} 标注行无合法形态词：${clip(ch.annotation.trim())}`,
  );
  judge(
    'A3',
    '形态词封闭枚举',
    a3Details.length === 0,
    `${judgeable.length} 章形态词全部合法（枚举 ${FORM_WORDS.join(' / ')} + 部署形态）`,
    a3Details,
  );
  if (a3Details.length === 0) {
    console.log(colors.green(`  ✓ A3 形态词封闭枚举：${judgeable.length} 章形态词全部合法`));
  } else {
    console.log(colors.red(`  ✗ A3 形态词封闭枚举：${badForm.length} 章越界`));
    printViolations(a3Details);
  }

  // ── A4 结构失明自检（括号不平衡 / 深度 0 处多根竖线 ⇒ 不猜，exit 2）──
  const structBlind = [];
  for (const ch of judgeable) {
    const st = ch.parsed.struct;
    if (!st.balanced) {
      structBlind.push(
        `${ch.file}:${ch.annotationLine} 标注行括号不平衡（无法确定结构竖线位置）：${clip(ch.annotation.trim())}`,
      );
    } else if (st.bars.length > 1) {
      structBlind.push(
        `${ch.file}:${ch.annotationLine} 括号深度 0 处出现 ${st.bars.length} 根全角竖线「${FULLWIDTH_BAR}」（结构二义）：${clip(ch.annotation.trim())}`,
      );
    }
  }
  if (structBlind.length > 0) {
    console.log(colors.red(`  ✗ A4 结构失明：${structBlind.length} 章标注结构二义`));
    printViolations(structBlind);
    console.log(
      colors.yellow('    处置：把括注里的竖线移出括注外，或补齐括号——结构二义时本守卫拒绝猜'),
    );
    console.log('');
    console.log(colors.bold(colors.cyan(RULE)));
    console.log(colors.red(`  ${ASSERTIONS.length + 1} 项断言 / ${structBlind.length} 处违规（检查器失明，拒绝判定）`));
    emitBlindTail(ASSERTIONS.length + 1);
    emitCoverage(ASSERTIONS.length + 1, chapterTotal);
    process.exit(2);
  }

  // ── A4 可拔级别必填（结构竖线后须紧跟合法级别）──
  const badLevel = judgeable.filter(
    (ch) => ch.parsed.struct.bars.length !== 1 || ch.parsed.level === null,
  );
  const a4Details = badLevel.map((ch) =>
    ch.parsed.struct.bars.length === 0
      ? `${ch.file}:${ch.annotationLine} 缺结构级全角竖线「${FULLWIDTH_BAR}」（形态与可拔级别须同批标注）：${clip(ch.annotation.trim())}`
      : `${ch.file}:${ch.annotationLine} 结构竖线后无可拔级别（须紧跟 L1–L4 / 不可拔 / —）：${clip(ch.annotation.trim())}`,
  );
  judge(
    'A4',
    '可拔级别必填',
    a4Details.length === 0,
    `${judgeable.length} 章可拔级别齐全（竖线后紧跟 ${LEVELS.join(' / ')}）`,
    a4Details,
  );
  if (a4Details.length === 0) {
    console.log(colors.green(`  ✓ A4 可拔级别必填：${judgeable.length} 章级别齐全`));
  } else {
    console.log(colors.red(`  ✗ A4 可拔级别必填：${badLevel.length} 章缺失`));
    printViolations(a4Details);
  }

  // ── A5 自相矛盾拦截（作用域＝本章主干内容：主形态 / 成分）──
  // 判据只用**结构字段**（mainForm === '主干' || components.includes('主干')）：形态词落在
  // 哪个语法位置，是 A3/A4 解析器已经确定的事，A5 直接消费结果，不自己再匹配一遍。
  // 为什么不能只判 mainForm：部署形态主形态 + 主干成分 配 L4 卸包这种写法下 mainForm 是
  // 「部署形态」，只判主形态会漏（守门用例 A5-G8）。
  // 为什么不做「整行 includes('主干')」子串匹配：散文里顺口一句「主干不受影响」
  // 「拦截约束留主干」不表示本章是主干章 ⇒ 子串匹配把这类合法文案判红（假红，实测：
  // 插件章配 L3 拆件 + 括注散文提到主干）。判定必须锚定语法位置，不靠散文子串。
  // 为什么也不做「整行字面主干 token 扫描」兜底：括注散文里出现的字面主干 token
  // （如「与 [主干] 的边界见附注」）同样是「提到别的形态」，不是「本章是主干章」⇒ 兜底
  // 照样新增假红；真实形态位与成分位已被结构字段覆盖，无须兜底。
  const selfContradict = judgeable.filter(
    (ch) =>
      (ch.parsed.mainForm === '主干' || ch.parsed.components.includes('主干')) &&
      ch.parsed.level !== null &&
      TRUNK_FORBIDDEN_LEVELS.has(ch.parsed.level),
  );
  const a5Details = selfContradict.map(
    (ch) =>
      `${ch.file}:${ch.annotationLine} 标注的形态或成分含「主干」却配 ${ch.parsed.level}——主干不可拆不可裁：${clip(ch.annotation.trim())}`,
  );
  judge(
    'A5',
    '自相矛盾拦截',
    a5Details.length === 0,
    `主干内容可拔级别全部合法（无 ${[...TRUNK_FORBIDDEN_LEVELS].join(' / ')}）`,
    a5Details,
  );
  if (a5Details.length === 0) {
    console.log(colors.green('  ✓ A5 自相矛盾拦截：主干内容可拔级别全部合法'));
  } else {
    console.log(colors.red(`  ✗ A5 自相矛盾拦截：${selfContradict.length} 章标注自己打自己`));
    printViolations(a5Details);
  }

  // ── A6 成分标注合法性（枚举 + 与主形态不同）──
  const badComponentDetails = [];
  let componentDeclarations = 0;
  for (const ch of judgeable) {
    // R5：与 A7 实测面共用 extractComponentDeclarations（同一面单谓词）——去重逻辑
    // （反引号 token 绝对位置）在提取器内，A6 与 parseAnnotation 永远拿到同一份成分集
    const found = extractComponentDeclarations(ch.annotation).map((c) => c.word);
    for (const word of found) {
      componentDeclarations += 1;
      if (!FORM_WORDS.includes(word)) {
        badComponentDetails.push(
          `${ch.file}:${ch.annotationLine} 成分「${word}」不是合法形态词：${clip(ch.annotation.trim())}`,
        );
      } else if (ch.parsed.mainForm === word) {
        badComponentDetails.push(
          `${ch.file}:${ch.annotationLine} 成分「${word}」与本章主形态相同（无信息写法）：${clip(ch.annotation.trim())}`,
        );
      }
    }
  }
  judge(
    'A6',
    '成分标注合法性',
    badComponentDetails.length === 0,
    `${componentDeclarations} 处成分声明全部合法（形态词枚举内 + ≠ 主形态）`,
    badComponentDetails,
  );
  if (badComponentDetails.length === 0) {
    console.log(colors.green(`  ✓ A6 成分标注合法性：${componentDeclarations} 处成分声明全部合法`));
  } else {
    console.log(colors.red(`  ✗ A6 成分标注合法性：${badComponentDetails.length} 处违规`));
    printViolations(badComponentDetails);
  }

  // ── ROADMAP 读取（A8 指针兑现 + A7 对账 共用；读不到即失明）──
  const roadmapAbs = path.join(ROOT, ROADMAP_FILE);
  if (!fs.existsSync(roadmapAbs)) {
    console.log(colors.red(`  ✗ 扫描面失明：缺 ${ROADMAP_FILE}——指针目标与对账另一侧读不到，拒绝假绿`));
    console.log('');
    console.log(colors.bold(colors.cyan(RULE)));
    // 此处无新断言执行（A7 与 A8 都以 ROADMAP 为输入、都还没跑）⇒ 如实按已判定数计
    console.log(colors.red(`  ${ASSERTIONS.length} 项断言 / 1 处违规（检查器失明，拒绝判定）`));
    emitBlindTail(ASSERTIONS.length);
    emitCoverage(ASSERTIONS.length, chapterTotal);
    process.exit(2);
  }
  const roadmapText = fs.readFileSync(roadmapAbs, 'utf8');

  // ── A8 指针章目标可解析（豁免牌必须能兑现）──
  const a8Details = [];
  let pointerCount = 0;
  for (const { version, file } of VERSION_SOURCES) {
    for (const ptr of byFile.get(file).pointers) {
      pointerCount += 1;
      const detail = pointerTargetDetail(ptr.title, ptr.line, file, version, roadmapText);
      if (detail) a8Details.push(detail);
    }
  }
  judge(
    'A8',
    '指针目标可解析',
    a8Details.length === 0,
    `${pointerCount} 处含「→ 已前移 / 已后移」标记的标题——目标全部可兑现（判定面＝任何含标记标题，与 A2 豁免面解耦）`,
    a8Details,
  );
  if (a8Details.length === 0) {
    console.log(colors.green(`  ✓ A8 指针目标可解析：${pointerCount} 处含标记标题目标全部可兑现`));
  } else {
    console.log(colors.red(`  ✗ A8 指针目标可解析：${a8Details.length} 处标记指向不存在的东西`));
    printViolations(a8Details);
    console.log(
      colors.yellow('      处置：A2 只豁免「章体为纯指针存根」的章——标题写了标记却指向虚空，就是拿豁免牌洗白'),
    );
  }

  // ── A7 ROADMAP 计数对账 ──
  const a7Details = [];
  const a7Passed = [];
  let versionsReconciled = 0;
  for (const { version, file } of VERSION_SOURCES) {
    const declared = extractDeclaredSegment(roadmapText, version);
    if (declared.status === 'no-row') {
      a7Details.push(`${version}: ${ROADMAP_FILE} 规划版本表无该版本行（对账缺一侧）`);
      continue;
    }
    if (declared.rows.length > 1) {
      // 版本行重复 ⇒ 两处声明并存且可能互相矛盾，取首行会静默掩盖冲突。
      // 先于「首行无声明段」判：重复场景下首行往往正是那条不该存在的行，
      // 若先报「首行无声明段」会把真相（两条版本行）说成「缺一侧」。
      a7Details.push(
        `${version}: ${ROADMAP_FILE} 出现 ${declared.rows.length} 条该版本行（第 ${declared.rows.join(' / ')} 行）——版本行必须唯一（与首列是否加粗无关），重复会让对账取首行而掩盖冲突声明`,
      );
      continue;
    }
    if (declared.status === 'no-marker') {
      a7Details.push(
        `${version}: ${ROADMAP_FILE}:${declared.line} 行内无「形态归属」声明段（对账缺一侧）`,
      );
      continue;
    }

    // 该版本行与声明段都在位 ⇒ 本版确实进了对账面（计入 covered，
    // 否则「把某版声明全删光」会让 covered 悄悄下降，本身也是一种沉默缩面）
    versionsReconciled += 1;

    const expectedLabels = EXPECTED_LABELS[version];
    if (!expectedLabels) {
      // fail-loud：新版本进了扫描面却没登记白名单 ⇒ 不许当「没要求」静默放行
      a7Details.push(
        `${version}: 未在 EXPECTED_LABELS 登记该版本的声明模式白名单（新增版本须同批登记）`,
      );
      continue;
    }
    const expectedCounts = EXPECTED_COUNTS[version] || {};

    const tallied = tally(byFile.get(file).chapters);
    const present = [];

    for (const { label, pattern, actualKey, unit } of DECLARED_COUNT_PATTERNS) {
      const { numbers: declaredNumbers, intraErrors } = collectNumbers(
        pattern,
        declared.segment,
        label,
        unit,
      );
      // ⑩ fail-closed：同子句中部藏第二处「label 数字 章」结构 ⇒ 报错，不当散文放过
      for (const hit of intraErrors) {
        a7Details.push(
          `${version}: 声明子句内多处计数（${hit}）——多个声明须用 ＋ 或 ； 分隔为独立子句（${ROADMAP_FILE}:${declared.line}）`,
        );
      }
      if (declaredNumbers.length === 0) continue; // 该版未声明此模式——该不该有由 pin 判
      present.push(label);

      const distinct = [...new Set(declaredNumbers)];
      const actual = actualValue(actualKey, tallied);
      if (distinct.length > 1) {
        // 跨子句数字不同 = 真二义（两个子句各自声明了一个不同的数）；同句重复已由
        // collectNumbers 的「每子句取首个」归一，不会走到这里
        a7Details.push(
          `${version}: ROADMAP 声明「${label}」二义（各子句命中 ${distinct.join(' / ')}${unit}），changelog 实测 ${actual}${unit}——行内多处不同口径须收敛为一句`,
        );
        continue;
      }
      // 修 C（②③）：pin 不止标签集，连**声明值本身**也钉住——删章 + 同批把声明数字
      // 改小（声明=实测）的老通道自此被拦：pin 表数字与声明值不符 ⇒ 红。
      const pinned = expectedCounts[label];
      if (pinned !== undefined && distinct[0] !== pinned) {
        a7Details.push(
          `${version}: ${label} 声明值 ${distinct[0]}${unit} 与 pin 表 ${pinned}${unit} 不符（${ROADMAP_FILE}:${declared.line}）——同批更新 EXPECTED_COUNTS pin 表（改声明数字是判定面变化，须显式过 pin）`,
        );
        continue;
      }
      if (distinct[0] === actual) {
        a7Passed.push(`${version} ${label} ${actual}${unit}`);
      } else {
        a7Details.push(
          `${version}: ROADMAP 声明 ${label} ${distinct[0]}${unit}，changelog 实测 ${actual}${unit}（${ROADMAP_FILE}:${declared.line}）`,
        );
      }
    }

    // ── pin 双向闭合 ──
    for (const label of expectedLabels) {
      if (!present.includes(label)) {
        a7Details.push(
          `${version}: 声明模式「${label}」缺失（ROADMAP 该句声明被删或写法不可解析）`,
        );
      }
    }
    for (const label of present) {
      if (!expectedLabels.includes(label)) {
        a7Details.push(
          `${version}: 出现未登记声明模式「${label}」——新增声明须同批登记 EXPECTED_LABELS`,
        );
      }
    }

    // ── 反向覆盖：changelog 实测出现的形态/成分 ⊆ 该版声明标签集 ──
    // 为什么需要：pin 管住的是「ROADMAP 声明面」自身，管不住「实测面悄悄长出
    // 声明面外的东西」——该版没声明「通道成分」，却在某章追加一个 `+ `[通道]` 成分`，
    // 声明面一字未改，计数对账也照样全过（对应模式未被声明 ⇒ 不参与对账）。
    // 集合语义（不按个数）：个数正确性已由计数对账负责，别让同一个数字存三份。
    const actualLabelSet = [
      ...new Set([
        ...tallied.mainCounts.keys(),
        ...[...tallied.componentCounts.keys()].map((w) => w + '成分'),
      ]),
    ].sort();
    for (const label of actualLabelSet) {
      if (!expectedLabels.includes(label)) {
        a7Details.push(
          `${version}: changelog 实测出现「${label}」，但 ${ROADMAP_FILE} 该版未声明该模式（实测面长出声明面外——补声明，或改标注）`,
        );
      }
    }
  }

  judge(
    'A7',
    'ROADMAP 计数对账',
    a7Details.length === 0,
    `${versionsReconciled} 版本声明值全部等于实测值（共 ${a7Passed.length} 条模式对上）`,
    a7Details,
  );
  if (a7Details.length === 0) {
    console.log(colors.green(`  ✓ A7 ROADMAP 计数对账：${versionsReconciled} 版本声明值与实测值一致`));
    for (const p of a7Passed) console.log(colors.cyan(`      · ${p}`));
  } else {
    console.log(colors.red(`  ✗ A7 ROADMAP 计数对账：${a7Details.length} 处声明值与实测值不一致`));
    printViolations(a7Details);
    console.log(
      colors.yellow('      处置：文档错则改文档（本守卫只读，不自动改）；口径错则改本脚本并说明——两者不许含糊'),
    );
    console.log(colors.cyan(`      （以下 ${a7Passed.length} 条模式对上：${a7Passed.join(' · ')}）`));
  }

  // ── 汇总 ──
  const failed = ASSERTIONS.filter((a) => !a.ok);
  const violationCount = failed.reduce((n, a) => n + Math.max(1, a.details.length), 0);
  const covered = chapterTotal + versionsReconciled;

  console.log('');
  console.log(colors.bold(colors.cyan(RULE)));
  if (failed.length === 0) {
    console.log(colors.green(`  ${ASSERTIONS.length} 项断言 / 0 处违规`));
    console.log(colors.cyan(`  覆盖：${chapterTotal} 章已判定 + ${versionsReconciled} 版本已对账（covered=${covered}）`));
    emitCoverage(ASSERTIONS.length, covered);
    process.exit(0);
  }
  console.log(colors.red(`  ${ASSERTIONS.length} 项断言 / ${violationCount} 处违规`));
  console.log(colors.red(`  未通过：${failed.map((a) => `${a.id} ${a.name}`).join(' · ')}`));
  console.log(colors.cyan(`  覆盖：${chapterTotal} 章已判定 + ${versionsReconciled} 版本已对账（covered=${covered}）`));
  emitCoverage(ASSERTIONS.length, covered);
  process.exit(1);
}

// 扫描面不可读 / 引擎异常 ⇒ fail-loud（绝不把「读不到」当「零违规」）
try {
  main();
} catch (err) {
  console.error(colors.red(`❌ check-forms 检查器失明（引擎故障，拒绝假绿）：${err.message}`));
  emitBlindTail(0);
  emitCoverage(0, 0);
  process.exit(2);
}
