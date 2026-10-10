# fresh-eyes 审查草稿 v1.5.8（16 视角 · 单次生成）

> 来源：git diff v1.5.7..HEAD（/tmp/v158_review.diff，155 文件）+ devlog docs/changelog/v1.5/v1.5.8.md（devlog 嵌入件尾部截断，缺失部分以仓库旧版 v1.5.8.md 与 diff 内 devlog 变更段交叉对账）。
> 每条发现：视角 / 文件或位置 / 问题描述 / 优先级（P0 阻塞 / P1 应修 / P2 建议）。「待取证」= 需 driver 定点取证。

## 视角1：陌生人

- **[视角1-1]** README.md:114-117 / README.en.md（What is this 段）——「28 条审计规则」是全库注册数，但默认 quick/hook 只跑 17 条，11 条扩展（含安全相关 E5/E6/E7）须 config 显式开启才生效。陌生人从 README 第一屏会理解成「装完就有 28 条防护」，实际开箱是 17 条。宣传数字与默认体验有落差（README:204 有小字说明，但首屏大数字先行）。P2。
- **[视角1-2]** README.en.md:33-46——本版修复了一批中英混排碎句（etime→every time、echange→every change、emistake→every mistake、eAgent→every Agent），说明此前多个版本英文 README 一直带着断裂句子发布；本次修复是好事，但同类「e 前缀吃字」模式值得在全英文面再扫一遍（本 diff 内 README.en.md 仍有长句内硬换行的排版，断句处读起来仍不自然，如 "they'ren't the same set" README.en.md:404）。P2。
- **[视角1-3]** install.sh / CHANGELOG.md——v1.5.7 升级必读新增「git hook 行为变更：hook 是拷贝而非软链，升级后须逐仓库重装」（v1.5.7.md 新增行），但该警示只落在 changelog；从旧版升上来、不读 changelog 的用户，旧 hook 会静默按旧引擎入口跑（engine/audit/hooks/pre-commit 头注释描述的三层防线行为差异以引擎源为准只是 warn 一行）。对存量用户是一次「不读文档就掉防线」的升级。P1。**待取证**（install.sh:723 段只有版本落后 warn，需取证旧 hook 在新引擎下的实际行为：是降级运行还是直接失效）。

## 视角2：企业 IT

- **[视角2-1]** engine/evolve/src/domain-verifier-registry.ts:233-241（loadRegistry）——保护面「只读位」检查写的是 `if (!(st.mode & 0o222)) { // 只读位在位——正常保护态 }`：条件为真时空块、为假时也无任何动作，即**文件可写位未清零不会触发任何 fail-closed 拒载**，与函数头注释「文件可读位未清 → 保护面失守，fail-closed 拒载」的声明不符。且 Unix 下 owner 可随时 chmod 回可写再改内容重算哈希一并写回（contentHash 在同一文件内），只读位+自含哈希对「同用户进程」（正是被治理的 Agent 运行时）防护强度近似于零。保护面独立性声明（devlog 验收勾选项「登记表位于可写面之外」）与实现强度之间有明显落差。P1。**待取证**（需确认该空块是否漏写拒载分支，或校验在别处；以及 {SOFAGENT_DATA}/protected 目录是否有 OS 级 ACL/独立权限面）。
- **[视角2-2]** engine/evolve/src/promotion-policy.ts:255-267（evolutionCostGate / quotaCheckShim）及文件头注释——用 `globalThis.__sofagentQuotaCheck` 全局变量 + 运行时 `require('@sofagent/core')` 的 shim 获取 checkQuota，且文件头自述「emitAuditDecision 当前未从 @sofagent/core 导出，本模块以可注入 writer 解耦：默认 no-op」。晋级台账（decision-log 留痕）在生产接线完成前实际是**空写**：`noopDecisionWriter` 返回 null 且「writer 失败不阻断」。验收项「晋级判定落 decision-log（判据快照可追溯）」已勾选，但默认路径无留痕。P1。
- **[视角2-3]** engine/evolve/src/domain-verifier-registry.ts:261-268（initializeRegistryProtected）——注释声称「HMAC 钉哈希，见 loadRegistry 的篡改检测」，但 loadRegistry 只做 contentHash（sha256）比对，**HMAC 密钥只在 initialize 时可选传入、校验侧完全不验 HMAC**；而且「Agent 运行时面不得调用本函数」仅是注释纪律——该函数与 loadRegistry 同在 @public 导出面（evolve/src/index.ts 导出 initializeRegistryProtected），Agent 可直接调用重写登记表（重写后自算 contentHash 一并写入即可自洽）。这正中 devlog 自己引的威胁模型（「被考核者自己出题、自己判卷」）。P1。

## 视角3：竞品维护者

- **[视角3-1]** engine/evolve/src/reward-shaping.ts:44-52——`shapeRewardPenalty` 的惩罚权重注明单一来源是 @sofagent/audit 的 severityWeightOf，但 `basis` 字符串里**硬编码了一套权重读数**（"critical=1.0/warning=0.6/extended=0.4/crutch=0.3"）作为人读文案。若 audit 侧权重表调整，这段文案会静默变成错误声明——单一来源原则被自己的提示字符串破坏（无测试锁死文案与实值一致）。P2。
- **[视角3-2]** engine/orchestrator/src/instinct/examiner.ts:186-193（DO_NOT_CAPTURE_PATTERNS）——四类「不捕获」正则是中英混合宽松模式（如 `/^(不要用|别用|never use...)/` 只锚定句首），`transient-retryable` 仅匹配 ECONNRESET/ETIMEDOUT 两类网络错误码。竞品视角看，这是把「教训过滤」这个语义问题降维成了正则匹配，误杀/漏杀面都大（英文句子中部出现 "avoid using X tool" 不会命中 tool-negative-claim）。作为硬门上线，误放行的毒数据比漏杀更值得担心。P2（当前仅拒收面，入池还有考核门兜底）。
- **[视角3-3]** docs/THANKS.md:57-61——本版新增 5 条 arXiv 引用（Winner's Curse、ImproveAnyTask、MESH-Harness、HarnessSecurity-Bench、HEAR Protocol），均已自注「摘要级/自报」。引用纪律（只落形态不引读数）在 devlog 正文执行得较好，但 THANKS 行内仍出现「已确证防护约半数为 opt-in：声明≠强制」这类转述半句读数的表述——与「不引读数」的纪律边缘摩擦。P2。

## 视角4：npm 用户

- **[视角4-1]** engine/umbrella/package.json / engine/audit/package.json / engine/openclaw-plugins/sofagent-audit/package.json——三个包 `"version": "1.5.7"` 未随 v1.5.8 开发完成 bump。devlog 头部声明「tag/npm/package_json 在发版时统一同步」（CHANGELOG.md:15 口径），属已登记的发版期动作，非缺陷；但 audit 包 description 本版改成了 28 规则而版本号还是 1.5.7——若有人在发版前从 git 安装（npm i github:...），拿到的是「版本号 1.5.7 + 28 规则描述」的混合态。P2（按项目口径属正常中间态，仅提示）。**待取证**（确认发版 SOP 阶段九 bump 批确实覆盖全部子包版本号）。
- **[视角4-2]** engine/audit/src/cli-quick.ts:571-583（BUG-39 修复）——仓库内直跑未构建二进制时给出「npm install && npm run build」指引并 `return 3`，是好的改善；但退出码 3 未在任何用户文档（README/HANDBOOK 的退出码表）中登记，脚本化用户对 3 的语义无从查询。P2。

无发现补充：install.sh 的 hook 版本对账修复（install.sh:723-736）+ `|| true` 兜底正是 npm 用户实际受益的坑修复，无进一步发现。

## 视角5：开源审查员

- **[视角5-1]** docs/changelog/v1.5/v1.5.8.md 第五章「涉及文件」表——`engine/evolve/src/__tests__/training-policy.test.ts` 出现**两行**：一行是本版改写的说明（组合覆盖三分支），一行是旧版原样残留（单测（默认不启用 / 命中折算 / 留痕 / 与准入门互补不互替））。同表同文件重复登记，devlog 勾选 39/39 的「落数表 13 项」自查未覆盖这种表内重复。P2（文档瑕疵，但 SSOT 项目里 devlog 是对账源，重复行会污染后续自动化对账）。
- **[视角5-2]** engine/orchestrator/src/instinct/index.ts:9——barrel 注释写「既有四件（extractor/scorer/evolver/failure-log）」，但同文件导出清单里**没有 evolver 与 failure-log 的再导出**（evolver 只在 orchestrator/src/index.ts:1031 前后单独导出）。注释与导出面不一致，读者会误以为 evolver 可从 ./instinct 子路径消费。P2。

无发现补充：CONTRIBUTING.md:187-190（新增提交者身份约定）公开声明「历史 11 条 author=test 提交与双身份并存属早期工具配置残留，不改写历史（冻结）」——透明处理合规自洽，记录在案，不构成问题。

## 视角6：用户旅程

- **[视角6-1]** engine/audit/src/cli-quick.ts:359-362——quick 输出尾部新增「ⓘ 装完整版（hook 自动审计 + 快照回滚）：sofagent audit --init」，与上一行既有「ⓘ 下一步：默认只跑 17 条规则…」形成两条连续 ⓘ 提示。一次性用户（npx 试跑）旅程里连续两条「下一步」指引，动作指向不同（--ruleset vs --init），完整版提示排在了规则说明之后但语义上更前置。P2（文案顺序微调即可）。
- **[视角6-2]** engine/evolve/src/promotion-policy.ts:150-154（judgeDemotion）——回退判定输出 `demote-skill`/`demote-inject`，但 PromotionVerdict 类型中 promote-train 带 `requiresHumanApproval: true` 而 demote 两态**无任何人审字段**：注释说「执行走既有 snapshot/restore」，意味着回退动作理论上可全自动执行（与「一切入池/晋级/安装经人审 gate」的硬边界单向不对称——降级无人审）。自动降级相对安全（保守方向），但与全文档反复强调的人审门一致性存在例外且未显式声明理由。P2。
- **[视角6-3]** devlog v1.5.8.md 头部（交付快照行）——「devlog 验收 39/39 勾选 · 落数表 13 项全落数」的可复核性差：落数表编号（#4/#5/#6…#12）散见 promotion-policy.ts 等源码注释，39 项勾选分布在五章，外部用户无脚本可一键复核这两个数字（对比测试数有 test-count.sh SSOT）。P2。

## 视角7：红队

- **[视角7-1]** engine/evolve/src/domain-verifier-registry.ts（全文件）——准入门的攻击面集中在三点：① judgeAdmission 的 registry 完全由调用方传入，无任何「传入前必须经 loadRegistry 校验」的强制（纯函数设计使 Agent 可以直接传自构 entries 绕过磁盘登记表）；② initializeRegistryProtected 在 @public 导出面且无调用方身份校验（见视角2-3）；③ loadRegistry 的只读位检查是空操作（见视角2-1）。三者叠加：一条 `import { judgeAdmission } from '@sofagent/evolve'` + 自构 registry 即可让任意域拿到 `action:'auto'` 判定。「判定者位于可写面之外」目前只是部署纪律而非代码强制。P1。**待取证**（需检查生产调用链是否强制走 loadRegistry→judgeAdmission 的绑定路径；若 evolve/src/auto-trigger 或 MCP 面有直传 registry 的调用点则此条升级为最高优先级）。
- **[视角7-2]** engine/orchestrator/src/instinct/examiner.ts:246-253（assessExamination）——考核执行器的两票（answerCheck/reproduction）是**注入回调**，本文件对两票的实现无任何约束（不校验回调是否真的执行了复现、是否与被考核系统隔离）；hard-boundary.test.ts 的 spy 断言只覆盖「导出全链零网络」，**不覆盖考核执行时两票注入器的来源**。若上层接线把 answerCheck 实现为恒 true 的 lambda（测试 hard-boundary.test.ts 恰好就是这么用的），verified 态即空转产出。devlog 声称「复现成功才 verified」，代码层只保证「注入的东西说成功」。P1。**待取证**（生产面有无真实考核执行器接线；若无，本版 verified 态只能由测试代码产生——则「考核器产出 verified」的闭环是测试态闭环而非生产态闭环）。
- **[视角7-3]** engine/orchestrator/src/instinct/store.ts:34-45（appendToPool）——instinct 池是 append-only JSONL 且无锁、无行级校验：同租户 Agent 可以灌入海量伪造 `verified:'verified', sourceTrace:'sha256:x'` 条目（sourceTrace 只是字符串字段，写入侧无对审计链的实时锚定校验），下游 exporter 的真实性门只检查 `!item.sourceTrace`（字符串非空即过）。防自证污染的「fail-closed」在实现层是「字段非空即信」。P1。**待取证**（sourceTrace 与审计链的锚定校验在哪一层发生；若目前无任何一层校验其指向真实轨迹，则真实性门形同虚设）。

## 视角8：数字侦探

- **[视角8-1]** CHANGELOG.md:103-105 与 devlog 交付快照——v1.5.7 行本批改为「acceptance 场景 401 全绿（断言 483/483）」，v1.5.8 交付快照写「12 道门禁全绿 · devlog 验收 39/39 · 落数表 13 项」。测试数链可对账：5842 + 94（新测试）= 5936 ≠ 5938，差 2（LIMITATIONS.md 显示审计核心 1537→1539 恰 +2，说明审计包另有 2 测试增量，账目自洽）。但「12 道门禁」的清单在任何已读来源中均未列出（devlog 截断段可能含有），数字不可复核。P2。**待取证**（12 道门禁的具体清单需从 devlog 完整文件或 release-gate 产物取证）。
- **[视角8-2]** README.en.md:404——工程可信度行 5842→5938 同步更新，check-test-count.sh 的场景数守卫也上移进默认主路径（本批改动）。但 README.en.md:404 仍保留旧口径例句「the `4805 → 4903` delta account」（历史版本说明，非当前数）——数字本身无错，只是例句引用的版本久远，新人会困惑为何举 v1.3 时代的账。P2。

无发现补充：check-test-count.sh:307-321（BUG-04 补充项）新增的「acceptance 场景 NNN 全绿」守卫与「冻结区（v1.5.6 及以前）不扫」声明核对自洽——CHANGELOG v1.5.7 行「acceptance 场景 401 全绿」符合新体例会被扫；v1.5.6 行「acceptance 479（场景 397…）」不含「场景 NNN 全绿」串不会被误扫。守卫逻辑无发现。

## 视角9：感知层

- **[视角9-1]** README.md:157（挂载档位表）——「标准挂载」行本次改为「内容为提交级 28 规则」，但紧邻的「薄挂载」行（WorkBuddy/Codex/Gemini CLI/Hermes）**未出现在本 diff 任何 hunk 中**——若该行仍残留「25 规则」时代措辞则档位表内部口径分裂（同表两行两种规则数口径）。本 diff 内无法直接证实薄挂载行现状。P1。**待取证**（读当前 README.md 薄挂载行全文，确认是否残留旧口径）。
- **[视角9-2]** docs/HANDBOOK.md:504 与 HANDBOOK.md:656——进化模块段从「连续胜出 + 非退化守卫才晋升」改为「晋升须过四道证据门槛」并与 devlog 对齐，单一口径动作到位。但同文件「审计规则」节的「A1-A11、A14-A24 + E1/E2/E4/E5/E6/E7」计数式写法，与 README「22 条 git-diff / 4 hybrid / 1 filesystem / 1 decision-log」的四档式是两种分档语言并存——读者需自行换算两种口径才能确认都等于 28。P2（两口径各有守卫锁，非错误，是认知负担）。
- **[视角9-3]** engine/audit/src/industry-overlay.ts:103——自动加载 overlay 的 reason 文案从「叠加 25 条默认规则」改为「叠加 17 条默认规则」。用户在日志里看到「17 条」与 README 大字「28 条」并存时，若不读 HANDBOOK 的 17 默认+11 扩展说明，第一感知是「为什么少了 11 条」。建议 reason 内附一句扩展层提示。P2。

## 视角10：文档一致性

- **[视角10-1]** docs/changelog/v1.5/v1.5.8.md 第三章交付表 vs 同章「涉及文件」表——交付表说「dataset-builder 新源：instinct 作为第五种数据源类型接入既有管道」，而同章涉及文件表按实测改为「旁挂适配器而非 builder 加第五种类型（dataset-builder.ts 零改动）」。同文档内两种架构叙事并存矛盾：一处宣称「第五种数据源类型接入」，另一处明确否定该形态——后续读者无法判断哪句是准。P1。**待取证**（核对 devlog 完整文件两段的最终措辞是否已统一）。
- **[视角10-2]** FDE/GUIDE.md:903-905 与 FDE/GUIDE.md:1123 段——「未标注行业 = 只跑 17 条默认规则」从 25 改 17 是本批修正；但同文件 1123 段「④⑤→28 条审计规则（编号 A1-A24 + E1-E7）」的「A1-A24」区间式写法把 11 条 A 类暗示成 24 条（A12/A13 已并入 A11 不存在），与前句「28 条」需读者自行脑内对账。P2。

无发现补充：跨文档数字同步（5842→5938 / 25→28 / 401 场景）覆盖 README 双语、HANDBOOK、LIMITATIONS、WIKI、DEVELOPMENT、API、VALIDATION（acceptance S165 扫描面同步扩到 8 文件），抽查 engine 源码注释 25→28 全批一致——文档一致性动作本身质量高。

## 视角11：代码审读者

- **[视角11-1]** engine/evolve/src/promotion-policy.ts:255-267（quotaCheckShim）——使用 CommonJS `require()` 于 ESM 工程（engine/umbrella package.json `"type": "module"`；evolve 包编译目标未在 diff 中体现），带 eslint-disable 注释硬压。ESM 下 `require` 未定义会直接 ReferenceError——除非编译产物是 CJS 或有 createRequire 兜底，diff 内未见。同函数还依赖 `globalThis.__sofagentQuotaCheck` 这个**无注册点的全局钩子**（全部已读来源中无赋值方）。P1。**待取证**（evolve 包编译产物格式与 __sofagentQuotaCheck 的赋值点；若生产从未设置该全局且包为 ESM，此函数在真实调用时抛错）。
- **[视角11-2]** engine/evolve/src/domain-verifier-registry.ts:166-184（detectStagnation）——停滞判定以 `window[0]` 为基线且**基线轮自身也参与比较**（差值恒 0 < 阈值恒成立），实际由后 N-1 轮主导判定，与注释「连续 N 轮无提升」语义有偏差；且基线取窗口首轮，首轮恰为低点则误报、中段冲高末段回落则漏报。逻辑可运行但语义不精确。P2。
- **[视角11-3]** engine/orchestrator/src/instinct/examiner.ts:238-241（decideSedimentation）——`isSimilar({ pattern: '' }, e)` 把候选 pattern 硬编码为空串传入相似度回调：相似度判定实际取决于回调实现如何处理空候选（若回调按编辑距离，空串与任何 pattern 的距离都是 pattern 长度——除非回调特判）。FOLD_INTO 的「语义并入」判定建立在传空候选的约定上，接口契约可疑。P2。**待取证**（生产 isSimilar 实现对空候选的行为）。

## 视角12：文件结构陌生人

- **[视角12-1]** engine/evolve/src/ 与 engine/orchestrator/src/instinct/ 的职责切分——进化准入/晋级/训练治理在 evolve 包，而 instinct 池（数据面）+ 出题考核器在 orchestrator 包。跨包消费靠 orchestrator package.json 新增 `./instinct` 子路径 exports（orchestrator/package.json:121-127）。陌生人视角：出题考核器（考核的是 instinct，属进化闭环）与晋级判据（evolve）分居两包，靠 devlog 章节叙述才能拼出完整闭环；代码目录不体现「章三/章四同闭环」。P2（结构可工作，认知成本记录在案）。

无发现补充：① engine/audit/src/rules/skill-safety-* → engine/audit/src/skill-safety/ 迁移（BUG-18）一致性完整——import 面（index.ts/public-api.ts/skill-scan.ts）、acceptance S293 锚、regression anchor 批全部同步，runner.ts 头注释含迁移说明；② playbook/acceptance-test.sh S165 扫描面扩到 8 文件属对账加严，本批未恶化单文件体量债（LIMITATIONS 已登记拆分债）。

## 视角13：技术编辑

- **[视角13-1]** docs/changelog/v1.5/v1.5.8.md（devlog）第一/二章——「涉及文件（预估）」表头仍是「预估」，但验收已全勾、文件已实测落地（涉及文件说明列含「实测」字样）——标题与内容状态矛盾（预估 vs 已交付）。发布面文档保留「预估」字样会让读者怀疑内容未核实。P2。
- **[视角13-2]** FDE/HUMAN-FACTORS.md（新文件 172 行）——新增文档质量高（九节+参考结构完整），但参考节 3 条外部书目直接内嵌电商长 URL（penguinrandomhouse/bloomsbury/lennysnewsletter），与仓库文档惯例（arXiv 短链/canonical 站点）不一致；且 devlog 定位章未提 HUMAN-FACTORS 的新增，读者从 changelog 无法发现这份新交付物。P2。**待取证**（确认 HUMAN-FACTORS 是否属本版正式交付面——若是，devlog 交付快照的「15 新源文件」只计 engine 源码，文档交付未入账）。

无发现补充：SECURITY.md:731-734「诚实报告」工程呼应句本批重写为区分「commit 级全局存储 / 运行时按 repo-hash 隔离」，与 LIMITATIONS §四存储口径抽查无矛盾。

## 视角14：对外形象分析师

- **[视角14-1]** README.en.md:416（新增 identity formula 行）——「The identity formula is settled as FDEing × S1A (S1A = S1M + Harness)」只见于英文 README 的 three-factor framing 段；中文 README.md 对应段未出现在本 diff 任何 hunk 中——若中文面缺位，双语形象主轴不对齐（英文有身份公式、中文没有）。P1。**待取证**（读当前 README.md 对应段与 docs/PHILOSOPHY.md 的 identity caliber 节，确认公式是否双语在位——PHILOSOPHY.md 在 diff 文件清单内但 hunk 内容未展开）。
- **[视角14-2]** CONTRIBUTING.md:185-190——Co-maintainer 诱因段之后新增「提交者身份约定」用 📌 引注形式公开内部身份治理细节（含历史 11 条 test 提交的坦白）。对外形象上是「诚实报告」价值观的正面示范；风险是该段语气偏内部治理（「本约定自登记起生效」类措辞）直接面向外部贡献者，语境错位（外部读者会疑惑「登记」指什么、在哪登记）。P2。

无发现补充：对外数字面（28 规则 / 104 tools / 5938 测试）本批把 README v1.5.7 章节标题的「⏳ 待发版」状态摘除、数字全部刷新且两口径声明与包数消歧保留完整——对外形象一致性维护到位。

## 视角15：外部开发者通读

- **[视角15-1]** engine/evolve/src/index.ts:62-148（新增导出面）——单次新增约 85 行导出：6 个模块的函数+类型全部平铺进根 barrel（judgeAdmission/judgePromotion/judgeEvidenceGates/… 30+ 新符号）。外部开发者从 `@sofagent/evolve` 根入口能拿到全部新 API，但推荐消费路径（先 loadRegistry 再 judge？）在导出面无任何说明——docs/API.md 的 diff 变更仅 31 行规则数措辞更新，未随导出面扩张补充新 API 文档。P2。**待取证**（API.md 是否另有专节覆盖 evolve 新 API——diff 中未见）。
- **[视角15-2]** engine/train/src/instinct-source.ts:1-30——文件头注释把「架构事实（devprompt 权威源例外已裁定）」写进代码注释，包含对既有文档（「既有四源按扩展名判定」说法）的更正声明。外部开发者视角：代码注释充当文档勘误载体，且直接引用内部流程词（devprompt/裁定）——可读性对内对外错位。P2。

无发现补充：「instinct 池 → 考核 verified → 导出 → 数据集 → TrainChannel」全链在代码层可走通（exporter→instinct-source→dataset-builder→buildDataset 契约字段均有测试断言），血缘三列（source_trace_id/instinct_id/confidence）随行完整——按 devlog 复现路径成立，链路设计自洽。

## 视角16：资深架构师

- **[视角16-1]** engine/evolve/src/promotion-policy.ts:10-14 与 engine/evolve/src/auto-trigger.ts:76-94——两处注释自曝三个未收口的接线债：① decision-log writer 默认 no-op（core 导出面缺口）；② quota 检测走 globalThis 钩子+require shim；③ 「写面留痕通道属 v1.5.9、本版先落读侧校验」（domain-verifier-registry 头注释）。本版交付的准入门/晋级门/台账三件中，**台账在生产态是空写、判定器与登记表的绑定靠约定、登记表防篡改强度弱**（综合视角2-1/2-3/11-1）。架构上这是「判定面先行、执行面欠账」的分版策略，devlog 有如实登记——但欠账均落在安全关键路径（审计留痕/预算/防篡改）上，版本叙事「已开发完成」强于架构实态。P1（建议发版前至少收口 writer 与 quota shim 两项）。
- **[视角16-2]** engine/orchestrator/src/instinct/store.ts:34-40 与 engine/evolve/src/eval-provenance.ts（对照）——同为「防投毒/防自证」防线，eval-provenance 为评测集设计了钉哈希+换代声明+污染自陈三层，而 instinct 池（同为训练数据源）只有 append-only JSONL + 非空字段校验。同一威胁模型（投毒训练面，devlog 引 arXiv:2609.17817 威胁实证）在两个数据资产上防护强度不对称。P1。**待取证**（是否登记于 v1.5.9+ 规划；devlog 截断段可能含有）。
- **[视角16-3]** tools/check/check-test-count.sh:1501-1511（场景守卫上移主路径）——把「有 clause 无 enforcement = defect」的治理哲学落进主门禁（此前仅 --scenarios-only 触发、pre-push --quiet 零阻断），CHANGELOG/ROADMAP 场景声称纳入对账——守卫左移方向正确。同时 emit_coverage_verbose 分母改为 PASS+FAIL+SCEN_PASS+SCEN_FAIL，覆盖率口径含义微变（场景守卫计入分母），对历史覆盖率序列是口径断点。P2（建议在脚本头注释登记口径变更时点）。

## 草稿层局限声明

- 本草稿基于 diff + changelog 文本理解，未跑命令未读全文件——「待取证」项必须经 fresh-eyes-driver 或人工复核后才可当结论。
- 来源偏差登记：① 降级 prompt 文件（.prompt.md）嵌有「截断」标记（原文 376826/19826 字符），本草稿以 /tmp/v158_review.diff 全量原文与仓库内旧版 devlog 补读对账，草稿层完整度高于截断嵌入件但低于「读全仓」层；② 仓库工作树中的 docs/changelog/v1.5/v1.5.8.md 是 v1.5.7 时点旧版（已排期/未勾选态），diff 内新版（已开发/全勾选态）才是本版交付态——本草稿一律以 diff 内新版为准。
- 统计口径（机器可复核：发现行以「- **[视角」开头，优先级取行内标记）：16 视角全覆盖；有效发现 **39 条**——**P0 0 条 / P1 13 条 / P2 26 条**；其中标注「**待取证」15 条**（视角1-3、2-1、4-1、7-1、7-2、7-3、8-1、9-1、10-1、11-1、11-3、13-2、14-1、15-1、16-2）。另有 8 处「无发现/正面确认」以节内补充行呈现，不计入发现数。
