<!-- 降级产物：LLM 调用失败（This operation was aborted）——把下面 prompt 粘贴给任意 AI session 执行；粘贴执行完即可删除本文件 -->

## System

你是 sofagent 项目的审查体系管理员。任务：把下列来源中的发现与交付，分类成 A/B/C 三类清单草稿，供人工审核后分发到四份审查文档。

分类规则（来自 releasing 阶段四步骤①）：
- A 类【新功能审查面】：本版本新交付带来的、以前不存在的检查需求（每个新功能至少一条）
- B 类【Bug 防回归】：本轮修过的 bug——每个修复一条防复发检查
- C 类【fresh-eyes 校准】：审查方法论的改进（新视角/校准视角/历史教训），归 fresh-eyes-review.md，不加检查项

输出格式（严格遵守）：
# A/B/C 三类清单草稿 v1.5.8

## A 类：新功能审查面
| # | 关键词 | 审查面一句话 | 建议落点 |
|---|--------|-------------|---------|
（每行：关键词用 grep 可命中的短语；落点=checklist/acceptance/check-version 之一）

## B 类：Bug 防回归
| # | Bug 摘要 | 防复发检查 | 建议落点 |
|---|----------|-----------|---------|

## C 类：fresh-eyes 校准
- （每条一行：校准方向 + 一句话理由）

## 无法归类（留给人工）
- （拿不准的条目放这里，说明为什么拿不准）

纪律：
- 只基于来源内容分类，不臆造来源里没有的发现
- 每条必须能定位回来源（括注来源名）
- 新功能 ≥1 条 A 类（零遗漏原则）；不确定是不是新功能的放「无法归类」

## User

当前版本：v1.5.8
已加载来源：fresh-eyes 报告、BugFix 清单、新功能交付清单
（跳过：复审报告——未提供）

### 来源：fresh-eyes 报告（/Users/kongfangxun/Desktop/fresh-eyes-draft-v1.5.8.md）

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


---

### 来源：BugFix 清单（/Users/kongfangxun/Desktop/v1.5.8-bugfix-report.md）

# sofagent v1.5.8 bugfix 清偿报告

> **执行方式**：software-company 专家团 SOP（主理人齐活林编排 → 工程师寇豆码施工 → QA 严过关独立复验 → 主理人终审清偿）
> **施工树**：worktree `main-70fb3a13`（分支 `workbuddy-baseline`，基线 `fabf4d057`，未动主工作树）
> **清偿范围**：任务书 40 项 BUG 全量处置（修复 38 项 / 登记转下一版 2 项）
> **交付态**：17 commits · 109 files changed (+623/−274) · 工作树干净 · **11 道门禁全绿** · 受影响包测试全绿（core 621 / audit 1539 / mcp 335）

---

## 一、执行摘要

| 维度 | 结果 |
|---|---|
| P1（16 项） | **全部修复**（BUG-01/02/03/04/05/07/08/09/10/11/12/13/23/24/25/33） |
| P2（24 项） | 修复 22 项；BUG-24 按任务书裁定「不移动 tag、由 v1.5.8 承载」处置；BUG-32（GitHub issues 社区面）**不在代码仓权限面内**，登记转维护者手动处理 |
| 新增机械门禁 | **5 道**：规则数五变体全仓断言 + 无条裸形态断言（check-storefront）· SOP 断言互校 A0（check-sop-integrity）· 英文压缩残形 lint ⑥（check-readme-parity）· 场景守卫接线默认主路径（check-test-count）· release 收尾终态断言（release-gate-orchestrator） |
| 负向探针留证 | 8 组红→绿双向（详见 §四） |
| QA 独立复验 | 4 项红全部溯源到本批提交，主理人已清偿并复验全绿 |

---

## 二、逐项清偿对照表（40 项）

| BUG | 优先级 | 处置 | 落点 |
|---|---|---|---|
| 01 规则数 25→28 全线 | P1 | ✅ 修复 | 五变体（25条/27条/24git-diff/20条/17+8）+ 无条裸形态（25规则/25 rules/25 discipline）**全仓清零**：文档 32 文件 + 代码注释 14 文件 + 插件门面 3 文件 + dashboard 4 处 + capabilities.json + 装置面文字（S228/1075 注记）。甄别保留：冻结区、测试夹具（dream-cycle shellcheck 语料、「25 条历史」非计数声明）、runner.ts「27 个源文件」（实测准确的文件数）、tool-registry:158（v1.5.2 历史沿革）、LEDGER 历史裁定 |
| 02 README 待发版残留 | P1 | ✅ 修复 | README.md:161 / README.en.md:208 标注删除，不补日期 |
| 03 配置面规则名清单 | P1 | ✅ 修复 | core 新增 `CURRENT_RULE_KEYS` SSOT（28 key，`shared/rule-constants.ts`）；config-template 注释与 config-loader knownKeys 均从其派生；**audit 侧互锁测试 2 例**（rule-metadata-snapshot，注册表↔清单不一致即红）；`@public` 导出面（index.ts + domain/shared.ts 双 barrel） |
| 04 acceptance 三值并存 | P1 | ✅ 修复 | CHANGELOG/ROADMAP 统一「场景 401 全绿（断言 483/483）」双口径；LIMITATIONS 396→401；**守卫扩面后抓出任务书漏列的第三处 396**（DEVELOPMENT.md:626）一并修复 |
| 05 证据分档不闭合 | P1 | ✅ 修复 | README.md:117 / ARCHITECTURE.md:697 / PHILOSOPHY.md:44 统一四档式「22 git-diff + 4 hybrid + 1 filesystem + 1 logs = 28」（代码 evidenceMode 实测分布为准）；ARCHITECTURE 保留 S120 三短语 |
| 06 归属表缺 E7 | P1→P2 表内 | ✅ 修复 | SECURITY.md 判定化归属表补 E7 行（能力拐杖/阈值纯函数留代码），28 行齐 |
| 07 门禁盲区（两处） | P1 | ✅ 修复+扩容 | S165 正则扩「N 条 <0-6字> 规则」+扫描面 3→8 文件；check-docs §7 去 head-1 全量比对 + 新增 audit 包/glama.json description 对账 |
| 08 场景守卫未接线 | P1 | ✅ 修复 | `run_scenario_guard` 上移进 check-test-count 默认主路径（quiet 兼容），pre-push `--quiet` 自动获得覆盖；扫描面扩入 CHANGELOG/ROADMAP acceptance 声称 |
| 09 glama.json 陈旧 | P1 | ✅ 修复 | 25→28 audit rules |
| 10 npm 包描述陈旧 | P1 | ✅ 修复 | engine/audit/package.json 25→28 discipline rules |
| 11 SOP 三文件互斥 | P1 | ✅ 修复 | 09-publish.md:521 改绝对口径（对齐 06/11）；**新增 A0 断言互校门禁**防复发 |
| 12 规划版文档陈旧 | P1 | ✅ 修复 | v1.6–v1.9 五处改「现行 SSOT 为 28 条」引用式表述 |
| 13 放宽缺负向探针 | P1 | ✅ 补做留证 | check-dev-prompt 三件探针：纠错语境✅绿 / 跨版新建✅绿 / 真错位✅红（`6e53f9d78` 的豁免行为验证无损） |
| 14 umbrella 24 口径 | P2 | ✅ 修复 | 24→22 git-diff |
| 15 README.en 缺 S1A | P2 | ✅ 修复 | 三因子段补「FDEing × S1A (S1A = S1M + Harness)」对译 |
| 16 冻结区链接+口径 | P2 | ✅ 修复 | 两处路径仅改层级（`../../../CONTRIBUTING.md`、`../../changelog/releasing/…`）；auto-converge:19 补指向修复例外并与既有例外段去重合并（同一事实一份） |
| 17 env 双轨弃用点 | P2 | ✅ 修复 | LIMITATIONS 补「SOFA_* legacy 别名」句 + ROADMAP 登记移除窗口 |
| 18 rules 目录混放 | P2 | ✅ 修复 | skill-safety 三件迁 `src/skill-safety/`（纯搬迁+import 调用方+门禁锚同步；audit 1539 / evolve 65 测试绿） |
| 19 根目录挂载入口 | P2 | ✅ 修复 | README 多平台挂载节补薄引用说明一行 |
| 20 署名关联 | P2 | ✅ 修复 | WIKI 文件地图补署名关联（QA 复验发现死链，已修正为 `../CONTRIBUTING.md`） |
| 21 dashboard 内联 style | P2 | ✅ 登记 | LIMITATIONS 巨型文件表补记 194/210（同 BUG-21 裁定不扩容不触发拆分） |
| 22 SECURITY 限定词 | P2 | ✅ 修复 | :733 commit 级全局存储前置改写 |
| 23 英文压缩损坏 | P1 | ✅ 修复 | 6 处还原为 every change（工程师交叉复核纠正了主理人初版 every exchange 误用词——历史原文与语义双重证据） |
| 24 tag 非终态 | P1 | ✅ 按裁定处置 | 不移动已发布 tag；16 个 post-tag commit 由 v1.5.8 承载；§三.6 终态断言保证下版起 tag 打在收尾树 |
| 25 release-gate 缺终态断言 | P1 | ✅ 修复 | orchestrator 收尾新增三条件（工作树干净 + tag==HEAD + 门禁真实退出码），不满足 exit 3 |
| 26 根目录 log 残留 | P2 | ✅ 修复 | FORGE judgment-only 预跑日志落点改 runDir（根治写入源）；主工作树既有残留文件由维护者删除（本施工树无此文件，代码侧已根治） |
| 27 devlog 文件名 | P2 | ✅ 修复 | data-product-rules.ts → rule-e5-data-product.ts |
| 28 WIKI 核对滞后 | P2 | ✅ 修复 | 核对至 v1.5.7 + 能力表补 E5/E6/E7 三行 |
| 29 CHANGELOG 缺口径 | P2 | ✅ 修复 | 双口径标注（并入 BUG-04） |
| 30 install.sh 体量 | P2 | ✅ 登记 | LIMITATIONS 巨型文件表补行（按裁定不拆分） |
| 31 openclaw 构建验证点 | P2 | ✅ 修复 | //build-scope 补 ClawHub 验证点完整说明（谁跑/怎么取证/记录在哪） |
| 32 issues 社区面 | P2 | 📋 转维护者 | GitHub issues 操作（关票/回应/badge）不在代码仓权限面——**建议维护者按任务书 §二.16 手动处理** |
| 33 lockfile 陈旧 | P1 | ✅ 修复 | npm install 重生成（workspace 内部 1.5.6→1.5.7 零残留，`npm ci --dry-run` 通过）+ 发版 SOP 步骤五新增第⑤步固化 |
| 34 双身份提交 | P2 | ✅ 修复 | CONTRIBUTING 补 user.name 约定 + WIKI 署名关联（历史不改——冻结） |
| 35 截图注退役 | P2 | ✅ 登记 | 随下次截图更新退役（本版不动，任务书裁定） |
| 36 quick 提示指引 | P2 | ✅ 修复 | 「9 条未检查」后补 `sofagent audit --init` 一行指引 |
| 37 CI 兜底分散 | P2 | ✅ 修复 | LIMITATIONS §三新增一站式段落（三防线合并 + 可照抄 YAML + 自托管示例指引） |
| 38 英文重复计数 | P2 | ✅ 并入 | BUG-05 四档式统一时收敛（英文首屏权威声明一处 + 引用） |
| 39 直跑无引导 | P2 | ✅ 修复 | cli-quick 入口前置 require.resolve 探测，未构建给 npm install && npm run build 指引（33/33 测试绿） |
| 40 门禁索引负担 | P2 | ✅ 修复 | tools/check/README.md 顶部新增「门禁→管哪个面」53 脚本一览表（棘轮台账同步登记 wall 1） |

---

## 三、新增机械防线（本轮最高价值交付）

| # | 门禁 | 位置 | 拦截面 | 负向探针 |
|---|---|---|---|---|
| 1 | 规则数五变体全仓断言 | check-storefront | 25条/27条/24git-diff/20条/17+8 任何变体复活即红 | VALIDATION 改回 25 → 红 → 还原 → 绿 ✅ |
| 2 | 无条裸形态断言 | check-storefront | 25规则/25 rules/25 discipline | 同上口径随批验证 ✅ |
| 3 | SOP 断言互校 A0 | check-sop-integrity | 同一动作的 contains 断言跨文件互斥（相对 vs 绝对链接） | 恢复 09 相对口径 → 红（实测当场抓到 BUG-11 现场）→ 还原 → 绿 ✅ |
| 4 | 英文压缩残形 lint ⑥ | check-readme-parity | etime/echange/emistake/eAgent 等 10 残形 | 注入 ☠ 探针行 → 红 → 还原 → 绿 ✅ |
| 5 | 场景守卫默认接线 | check-test-count | 场景数漂移在 pre-push 面前拦截（此前仅 --scenarios-only 可达） | LIMITATIONS 改 396 → 红（2 FAIL）→ 还原 → 绿 ✅ |
| 6 | release 收尾终态断言 | release-gate-orchestrator | 工作树脏 / tag≠HEAD / 门禁红 ⇒ exit 3 | 结构性断言（三条件各含独立判错分支）✅ |

---

## 四、验证证据汇总

**门禁（11 道全绿，rc 实测）**：

```
check-version RC=0（138/138）· check-docs RC=0 · check-archaeology RC=0（零命中）
check-readme-parity RC=0 · check-dashboard RC=0（FAIL=0 九项）· check-guards RC=0
doc-discipline RC=0 · check-forms RC=0 · check-sop-integrity RC=0（A0 含）
check-storefront RC=0（rule-count + rule-count-bare 双绿）· scenarios RC=0（401 SSOT 全过）
```

**受影响包测试**：core 621 ✅ · audit 1539 ✅（含 BUG-03 互锁 2 例 + skill-safety 搬迁回归）· mcp 335 ✅ · evolve 65 ✅（工程师批跑）

**行为验证**：CLI version=1.5.7 ✅ · 敏感拦截链路（.env.production + 密钥 → A1/A2 红 + exit 2）QA 实跑 ✅ · README.en 残形零命中 ✅ · lockfile 旧版号零残留 + npm ci --dry-run ✅

**负向探针 8 组**：BUG-07（audit 包 25→红）· BUG-08（396→红）· §三.4（VALIDATION 25→红）· §三.5（相对口径→红）· §三.7（☠行→红）· BUG-13 三件（绿/绿/红）——全部还原后复绿。

---

## 五、QA 独立复验与本轮纠错记录

QA（严过关）零信任复验抓出 **4 项红**，全部溯源到本批提交，主理人已清偿：

| # | QA 发现 | 根因 | 清偿 |
|---|---|---|---|
| R1 | core 域 barrel 缺 CURRENT_RULE_KEYS 导出 | 主理人只改了主 index.ts，漏 domain/shared.ts | 双 barrel 补齐 + rebuild |
| R2 | WIKI 署名行 `./CONTRIBUTING.md` 死链 | 工程师 BUG-20 相对路径层级错 | 改 `../` |
| R3 | doc-ratchet 台账键错位（tools/README.md vs tools/check/README.md） | 工程师 BUG-40 新文件未入台账 | 键迁移 + 实测登记 wall 1 |
| R4 | auto-converge:19 例外段与裁定段重复且含日期考古 | 工程师与主理人各写一份 | 去重合并 + 去考古形态 |

另：QA 报的 check-forms「rc=2」系用 bash 误跑 .mjs 的假红（正确 node 跑法 RC=0）；主理人初版 BUG-23 用词（every exchange）被工程师以历史原文证据纠正为 every change——交叉复核机制本轮实际发挥了两次作用。

---

## 六、遗留事项（移交维护者）

1. **BUG-32 社区面**：GitHub issues 关票/回应 + README badge——需维护者在 GitHub 侧手动处理（代码仓无权限面）。
2. **主工作树 `acceptance-raw.log`**：写入源已根治（BUG-26），主树既有文件（130KB）请维护者删除（gitignore 已覆盖，直接 rm 即可）。
3. **v1.5.7 tag 落后 16 commit**：按裁定不动 tag；v1.5.8 发版时新 tag 由 §三.6 终态断言保证打在收尾树。
4. **merge 路径**：本施工树分支 `workbuddy-baseline`（17 commits 待并入 main）——建议维护者审查后以 fast-forward 或常规 merge 并入（并发 session 在主树仍有未提交改动，请协调窗口）。
5. **任务书「未确认事项」（§十）**：acceptance 全量实跑/HMAC 链复验/demo/install.sh 完整安装/CI 远端绿态仍未实测（四份审查的原始留白，非本轮范围）——若需收口请在 v1.5.8 发版窗口补跑。

---

## 七、提交清单（17 commits，按序）

```
d73ee15e7 fix(docs): 规则数口径 25→28 全线同步——五变体清零（BUG-01/05/06/12/27/28）
12e03f737 fix(engine+facade): 代码注释/插件描述/dashboard/外部门面规则数同步 25→28（BUG-01 变体核处 + BUG-09/10/14/23）
d12a7b208 fix(check): 场景守卫接线主路径 + 规则数门禁三面扩容（BUG-03/04/07/08 + §三.4）
435095dc1 fix(check+sop): SOP 断言互校 A0 + 英文压缩残形 lint + release 收尾终态断言 + quick 模式引导（BUG-11/24-25/36/39 + §三.5/§三.6/§三.7）
7f2c18222 fix(release): lockfile 重生成落发版 SOP 步骤五 + 提交陈旧 lockfile（BUG-33）
e907d2f8c fix(readme-en): BUG-23 用词还原 + BUG-15 补 S1A 身份公式——every change 回归历史原文
ecedb6fca fix(changelog+frozen): BUG-16 冻结区两处错层路径修复（仅路径）+ auto-converge 口径对齐维护者裁定
1324888c3 fix(forge): BUG-26 judgment-only 预跑日志落点改 runDir——根治仓库根 acceptance-raw.log 遗留
a7a7a0e43 refactor(audit): BUG-18 skill-safety 三件迁 src/skill-safety/——纯搬迁 + import 调用方与门禁锚同步
13ae9751c fix(readme+wiki): BUG-19 宿主挂载点薄引用说明 + BUG-20 文档署名关联 GitHub 账号 + BUG-34 CONTRIBUTING user.name 约定
72d47908c fix(security+limitations): BUG-22 commit 级日志限定词前置 + BUG-17 SOFA_* 弃用窗口登记 + BUG-21/30 巨型文件表 + BUG-37 企业 CI 兜底一站式段
54351a751 chore(check): BUG-31 build-scope 补 ClawHub 构建验证点 + BUG-40 tools/check/README.md 门禁一览表
02c81de5c fix(facade-claims): 无「条」形态「25 规则」家族 26 处清零（workflows/agent-shield/HOOK/cordis×7/openclaw×5/plugins.json/plugin-kit/ROLES/AGENTS/WIKI/VALIDATION）
e0249999b fix(residue+gate): BUG-01 四残留清偿 + B3 四档式换锚 + S165 子口径误红规避（runner 注释/快照头注释/governance 注释/SOP 概念键/literals 回填/ratchet 台账）
ae34267db fix(development): S165 子口径规避第二处——下钻说明改编号列举形态
139d706fa chore(check): storefront 规则数门禁补「无条」裸形态变体断言（BUG-01 家族收口）
2bc2c5318 fix(qa-clearance): QA 复验 4 红项清偿——域 barrel 补导出/死链修正/冻结区例外去考古/棘轮台账迁移
```

---

*报告生成：software-company 专家团（主理人 齐活林）· 2026-10-09 · 施工树 workbuddy-baseline @ 17 commits ahead of fabf4d057*


---

### 来源：新功能交付清单（docs/changelog/v1.5/v1.5.8.md）

# v1.5.8 开发日志 — 进化模块 · 准入门与数据面

> ✅ **已开发（2026-10-09 · 开发与基础自测完成，SOP 阶段二收口）。** 前置依赖：v1.3.5（instinct→skill 链——既有进化链）+ v1.4.8（成本 quota 事前门禁——进化循环纳入既有预算机制，不做第二套）+ 本版第一章（域验证器三档登记——考核器按域档位分流）+ v1.4.7（TrainChannel 标准接口——数据集构造的提交通道）
> 状态：已开发 · 原排期依据：**2026-09-20 地基期拆版（用户拍板颗粒度细化）：本版承接原 v1.5.5 第二章（进化准入判据）与第三章（三层晋级判据）——两章是进化的两面门（能不能自动进化 / 进化到哪一层），且域验证器三档是考核器分流的依据，故在合并后前置于旧 v1.5.15 的内容（该版内容已并入本版）** · 原依据链：2026-09-19 用户拍板 RSI 缺口裁定收编（Meta-RSI 研究对位发现六个自进化链路缺口，经马鞍 / 马场裁定）
> 状态（续）：已开发 · **2026-09-20 地基期拆版（用户拍板颗粒度细化）：本版承接原 v1.5.5 第一章（经验池接训练管道）与第四章（出题考核器）——两章是一个闭环的两端（导出器只收 `verified` 态 / 考核器产出 `verified` 态），内容零改写** · 原依据链：2026-09-19 用户拍板 RSI 缺口裁定收编（Data-RSI 断链打通——行业对位 Meta-RSI 归因→出题→考核三步） · **本版由旧 v1.5.14、旧 v1.5.15 撤并而来**
> 状态（三续）：已开发 · **2026-09-22 探索方向清仓（用户拍板「逐项裁定、排进 V2.0 前」）：RL 训练治理自探索方向迁入本版第五章——改判理由是版本边界纪律（属 V2.0 前进化/训练面治理能力，V2.0 后无承接窗口），且两块前置地基（v1.4.4 规则→reward 映射、v1.4.6 分布式执行面）已交付、本版又是训练通道版，时机亲和；非触发条件已满足**
> 交付快照（阶段二自测实测）：五章 15 新源文件 + 94 新测试 · 全量 **5938**/5938 绿（13 包 SSOT=test-count.sh）· 12 道门禁全绿 · devlog 验收 39/39 勾选 · 落数表 13 项全落数 · 测试数六处文档同步 5938。

## 定位


> ⚡ **进化模块 · 准入门与晋级判据**
>
> 📋 **文档连带（2026-09-26 反向核对预普查）**：准入门/晋级判据落地后失效的旧进化叙事三面——[LIMITATIONS](../../LIMITATIONS.md)「Skill 自动优化…尚未到自动改进阶段」段（补 v1.5.8 指针注，对齐 fde-activation-chain 先例）、[ARCHITECTURE](../../ARCHITECTURE.md) 五能力行与图题的「自动优化」表述（按准入门三档分流改写）、[HANDBOOK](../../HANDBOOK.md) 进化模块段 ab-test「连续胜出+非退化守卫才晋升」与新四道证据门槛对齐（单一口径）
——给进化装上两道门：**准入**（验证比生成便宜才自动进化——域验证器三档 `deterministic` / `model-judge` / `human-only` 分流，未登记 fail-closed 按最高档处理；判定者位于可写面之外；评测集钉哈希登记谱系 + 保护面安全套件独立硬阻断——防投毒基准后门化自改进循环）与**晋级**（注入租用 → skill 半持久 → 微调摊销——频次 × 存续期 × 验证态三输入纯函数给三态建议，promote-train 只提示人审，三层可逆可回退；晋级须过留出集优先 / 严格优于历史最佳 / 单变量可归因 / 校准不退化四道证据门槛）。退役修剪面（第三道门——「留下来的还值不值」）不占本版，登记于探索方向。

> ⚡ **进化模块 · 数据面与入池质检**——打通「经验池 → 数据集 → 训练通道」的 Data-RSI 断链：instinct 池按「高置信度 + 已考核」筛选导出为训练记录（带血缘锚点、来源真实性标记 `verified-trace`、租户隔离），而「已考核」由**出题考核器**供给（instinct 反向生成复现场景，答案校验 + 复现成功双成功才 `verified` 入池）。

> 🧪 **进化模块 · 训练期治理（自探索方向迁入）**——数据面和通道打通之后，还差一道**训练期**的合规判定：训练期间命中策略的轨迹按规则严重级折算惩罚权重、进 reward 判据并留痕（哪个规则集版本影响了哪批数据）。**边界**：本仓只做治理与信号，训练循环仍由模型层跑、经 TrainChannel 提交；训练期策略与准入门**互补不互替**。

---

## 一、进化准入判据（检验-生成差距 · 验证便宜的域才自动进化）


> **形态归属**：`[主干]`（判定·准入门）｜ **不可拔**（进化准入门是防「放养式自进化」的缰绳，拔掉它进化链失去安全边界）
>
> 📋 **研究收编**（行业综述定律）：自提升仅在「验证比生成便宜」的域成立——代码/数学有测试套件当免费验证器，开放式写作验证与生成同价、循环空转。对位 sofagent：空房间错误分流器已分「客观错误 vs 主观偏好」，本章把该判据从归因层上移到**准入层**——evolve/skill 晋升在启动前先判定目标域有没有廉价验证器。

### 交付

| 组件 | 能力 |
|------|------|
| **域验证器登记** | 技能/进化目标域声明其验证方式：`deterministic`（测试/编译/断言——廉价）/ `model-judge`（LLM 评分——有成本）/ `human-only`（开放式——必须 HITL）三档 |
| **准入判定** | evolve 晋升与 instinct 注入前按域档位分流：deterministic→全自动走 eval-gate；model-judge→评分 + 采样人审；human-only→强制 HITL，无自动晋升 |
| **fail-closed 语义** | 域未登记验证方式 ⇒ 按最高档（human-only）处理——宁可不进化，不盲目进化 |
| **进化成本门禁** | 进化循环（出题/考核/晋升/训练构造）纳入 v1.4.8 成本 quota 事前门禁——改进本身也烧钱（行业实证：循环又贵又慢是调度器改进的动因）；超预算按既有 WARN/HARD 双模式处置，不做第二套预算机制 |
| **收益停滞检测** | 连续 N 轮进化的 eval 提升低于阈值 ⇒ 停止自动进化并转人审（行业实证：改进存在边际效应递减）——**检测与提示，不自动决策该改什么**（那是调度器的活，本版不做）。**停环判据的极限面补强（2026-10-04 补）**：① [Harness Evolution as Learning](https://arxiv.org/abs/2609.36892) 把自进化 harness 形式化，给出**近似 / 泛化 / 优化三类极限**——「进步空间有上界」不靠经验阈值；② [Audit the Scaffold, Not the Checkpoint](https://arxiv.org/abs/2609.34924) 提出**平稳性二分**：递归自改进的收益应分别判 **scaffold（脚手架）** 与 **checkpoint（权重）** 两种平稳性。⇒ 本行「连续 N 轮无提升」的停环判定据此须**区分两类平稳**，防「权重到顶、脚手架仍有余量」被误判为整体停滞。**引用纪律**：均第三方单篇、本仓未复算，只落形态不引读数 |
| **保护面独立性** | 域验证器登记表与准入判定器必须位于**所有可写面之外**（Agent 改不到自己的考核标准）——保护面落在可写面上等于「被考核者自己出题、自己判卷」；登记表与判定逻辑的变更只能由人（FDE）发起并留痕（对齐 [v1.5.9 第一章](./v1.5.9.md) 写面留痕）；**自改进通道本身无权降低门的强度**——自改进只能加门、不能撤门，任何削弱准入门 / 晋级门强度的提案一律不准入。行业对位：Meta-RSI 要求保护面独立于 data / harness / model 三类写面——本章是「准入的判定者不可被准入对象修改」这一条的落地。**威胁面实证（2026-09）**：投毒基准可给自改进 agent 植入后门（arXiv:2609.17817）——三个自修改 coding agent 中其一被诱导自演化出「关闭 HTTPS 证书校验」并在干净留出任务上复发，且污染在改用干净基准后仍常存活（干净测试既测不出也清不掉）。四条控制与本仓强项面同构（审计链 / HITL / 版本控制回滚），但暴露**评测集谱系登记**这一缺项——「评测数据从哪来、谁能改、钉什么哈希」须与登记表同批立（见 §二 晋级证据门槛补强）。**机制同构补强（2026-09-28 登记）**：另有一件机器人 agent harness（[RegenHarness](https://arxiv.org/abs/2609.27612)，对方自报、本仓未复算）把同一结构**推得更远一格**——其递归自改进协议明写**修订 harness 配置既不更新在线模型权重、也不得削弱提交门**，且提交门**绑定身份与版本**（identity- and version-bound commit gate），版本化记忆另行区分「**已观察到的事实**」与「**已接受的任务进度**」。⇒ 两条同构来源：① 「自改进通道本身无权降低门的强度」（「被考核者不能改自己的考核标准」的加强形态）**已升格为本行硬要求 + 验收项**（见上文加粗句与本节验收标准）；② **原始观察与已接受结论分账存储**，是审计链「原始记录 vs 判定结论」分离的同构实现，**仍为可收紧的表述、本轮未升格**。**故障面实证（2026-10-04 补）**：[AgentBug-Smith](https://arxiv.org/abs/2609.37864) 从真实 agent 系统的运行记录**自动复现 harness 级缺陷**（把线上故障回放成可复现用例）。⇒ 与审计链同侧：本行管「保护面不可被改」，还须配**故障可复现**——不可复现的 harness 缺陷既无法归因、也无法证明修复有效。**引用纪律**：第三方单篇、本仓未复算，只落形态。来源登记见 [THANKS · 编排与架构](../../THANKS.md) |
| **评测集谱系与防投毒** | 自改进循环的自评基准即攻击面：投毒基准可诱导自修改 agent「自己演化出」削弱安全控制的指令（实测案例： poisoned 基准令 agent 自进化出关闭 HTTPS 证书校验的指令，且**换干净基准继续演化后污染仍存活**——干净测试既测不出也清不掉，[Roesner & Kohno](https://arxiv.org/abs/2609.17817)）。本章的对应防线：① 进化用评测集**钉哈希登记谱系**（来源/版本/谁可改）；② **评估与自改进分离**——保护面持有的安全套件独立于 evolve 分数，命中即硬阻断、不作为可权衡输入；③ 评测环境剥离答案键与隐藏测试（对齐 sandbox 零凭证纪律）。**外部独立表述（2026-09-25 登记）**：品类侧的独立第三方榜在其前言里自行声明——「公开半集**可被训练**也可被**择优**，因此密封的私有半集须**随领域变化持续演进**」，并据此设「公开集与密封集准确率差 **>25 个百分点即扣减**」的惩罚项。⇒ **冻结留出集 ≠ 永久干净**：纪律 ① 的完整形态须含**留出集的换代机制**（样本增补走新建集、并声明新旧集不可横比，与 [v1.6.0 §五](../v1.6/v1.6.0.md)「集的两条纪律」同源）——否则「钉了哈希的集」仍会被公开半集的选择压力慢慢污染。**机制前移（第三方同向实例）**：同一独立榜把污染从「事后扣分」前移为「**事前自陈**」——**S1 Bench** 把 `contamination` 做成**逐目标字段**（每个 target 逐条列出其读数所涉的公开集名，如 `boolq` / `paws` / `vitaminc-dev`；`data.json` 一手可取、本仓未复算），使污染从**事后核算项**变成**与读数一起被读到的输入** ⇒ 纪律 ③「剥离答案键」是防守方的事前动作、**逐目标自陈污染**是进攻面的事前暴露，两者同指「污染必须在读数之前显式化」 |

### 涉及文件（预估）

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/evolve/src/domain-verifier-registry.ts` | 新建 | 域档位登记 + 准入判定纯函数（登记表持久化载体落 {SOFAGENT_DATA}/protected/domain-verifiers.json——只读位 + 钉哈希；本仓可写面清单在文件头注释固化） |
| `engine/evolve/src/eval-provenance.ts` | 新建 | 评测集谱系登记（钉哈希登记 / 留出集换代 / 污染事前自陈三防线 + 答案键剥离投影 + 安全套件独立阻断） |
| `engine/evolve/src/__tests__/domain-verifier.test.ts` | 新建 | 三档分流 / fail-closed / 未登记默认最高档单测 |

### 验收标准

- [x] 域验证器三档登记可配置（deterministic/model-judge/human-only）
- [x] 准入判定按档位分流（human-only 域零自动晋升）
- [x] 未登记域 fail-closed 按 human-only 处理
- [x] 进化循环受成本 quota 门禁约束（超预算按 WARN/HARD 处置，无第二套预算）
- [x] 收益停滞可检测（连续 N 轮低于阈值转人审，只提示不自动改方向）
- [x] 域验证器登记表与准入判定器位于可写面之外（Agent 不可改，变更须人发起并留痕）
- [x] 自改进通道无权降低门强度（任何削弱准入门 / 晋级门强度的提案一律不准入；自改进只能加门、不能撤门）
- [x] 进化用评测集钉哈希登记谱系（来源/版本/变更权），保护面安全套件独立于 evolve 分数硬阻断，评测环境剥离答案键
- [x] `npm test` 全绿

---

## 二、三层晋级判据（注入租用 → skill 半持久 → 微调摊销 · 显式化）


> **形态归属**：`[主干]`（判定·晋级规则与台账）｜ L1 关档
>
> 📋 **研究收编**（两 substrate 成本模型）：context 更新「每次推理重付」（租用——注入即付 token），权重更新「一次付清」（摊销——训练一次推理免费），skill 介于两者（加载链常驻=半持久）。三条路已事实存在（instinct 注入 / evolve 晋升 / TrainChannel 微调），但没有显式晋级判据——何时从注入升 skill、从 skill 升微调，目前靠人拍。行业对照：Meta-RSI 的调度器先 Harness 后 Model（「先改便宜的，高频重要规则才内化」）。

### 交付

| 组件 | 能力 |
|------|------|
| **晋级判据纯函数** | 输入：条目注入频次 × 存续期 × 验证态（考核通过率/eval 分数）；输出：`keep-inject` / `promote-skill` / `promote-train` 三态建议 |
| **晋级台账** | 每次晋级判定落 decision-log（当前层→建议层 + 判据快照）——与 v1.4.5 skill-impact 台账同源扩展 |
| **人审门** | promote-train 建议**只提示不执行**（对齐「只提示不阻断」）——进 FDE 确认队列，确认后才走第一章管道 |
| **三层可逆（回退）** | 晋级的对偶面：任一上层验证失败（微调后 eval 退化 / skill 考核连续失败）⇒ 回退到下一层并留痕（微调→skill→注入）。**复用既有 snapshot/restore 语义，不新建回退机制**；回退判定与晋级判定同属本节纯函数（对称输出 `demote-train` / `demote-skill`），回退动作落 decision-log |
| **进化收益曲线** | 「做 1000 次任务后是否比第一次更强」的量化落地（PHILOSOPHY 既有承诺）：四指标可定义可量化可记录——**任务通过率趋势**（acceptance/ab-history 既有数据源）/ **错题本复发率**（同类失败重犯间隔）/ **skill 复用率**（调用次数 / 产生次数）/ **纠偏介入率**（人工干预频次趋势）。指标定义与记录属本章判定面（数据从既有台账取，不造新数据源）；曲线呈现挂 v1.5.0 治理 KPI 面板（复用六卡框架，不另做 UI 面） |
| **晋级证据门槛** | 晋级判定须同时满足四条证据纪律：① **以留出集（held-out）信号为准**——反馈集上的提升不计入晋级依据（行业实证：同一权重只换 harness，反馈集 +13.9 而留出集仅 +1.43，[HarnessDev](https://arxiv.org/abs/2609.01437)）；② **严格优于历史最佳**才接受，持平视为不接受——防迭代把既有改进抹掉（行业实证：24 个 run 仅 1/12 超基线，且继续训练会回退，[Aspire](https://arxiv.org/abs/2608.31111)）；③ **单变量归因**——一次晋级只归因一个变更面，多变量捆包 ⇒ 拆批（否则收益不可归因、回归不可定位）；④ **校准不得退化**——准确率与校准会**分离收敛**，故「严格优于」须**逐维判定**：准确率提升而校准（ECE / Brier）退化同样拒绝晋级（行业实证：9B 判定件准确率与商业件只差半步，Brier 反而更差 0.237 对 0.211；4B 档在 8.2% 的新来源题上给错答案 ≥0.9 概率）。**机制补强（行业两线实证）**：留出选择同时是对齐机制——在未显式优化作弊指标的前提下，纯留出集选择的自主改进运行把奖励作弊率从 55% 降至 32%、低于人类工程基线 7 个百分点（[AIDE²](https://arxiv.org/abs/2609.26457)：作弊解在隐藏评测上不稳，被选择器当作泛化噪声顺带筛掉）；而 evolve 集择优可整体反转——最强既有 harness 自进化法的产出移到未见任务后**比初始 harness 低 1.7 点**，且无复杂度惩罚项时 harness **单调膨胀**（[RRSI](https://arxiv.org/abs/2609.24972)：自进化三失败形态＝基准特化拟合 / 噪声追逐 / 复杂度累积；其「退火编辑预算」即「一次只归因一个变更面」的机制化；同文实测 evolve 集 +14.1 → 未见任务 +4.7——**约三分之二的 harness 进化增益不迁移到 held-out**，据此固化引用纪律：凡引用 harness / 自进化收益默认按 held-out 口径核，无 held-out 复算的自报数字只登记方向、不入对照表）。**基底定位（奖励作弊的三基底）**：作弊按优化基底分三类——**参数更新（weights）/ 输出间选择（selection）/ 持久化提示词（text）**，防御跨基底只有部分可迁移（[arXiv:2609.25848](https://arxiv.org/abs/2609.25848)）——本仓晋级门槛作用在 **text 基底**（skill/注入/判据均为持久化文本），该基底特有风险＝「内容可查但小改动的诱导行为难预判」，故④校准逐维判定与 §一 谱系钉哈希是 text 基底的针对性防线；同文收口句与本门槛同构——「可靠改进取决于控制可及的失效模式，并保留**独立于被优化分数**的任务质量证据」（即留出集优先的另一种表述）。**跨域基准补充（2026-10-01 登记）**：三基底的「作弊机会」形态已有跨域基准化产物——[CheatBench: Measuring Reward Gaming in AI Agents](https://arxiv.org/abs/2609.36308) 在数学研究 / 知识工作 / 编码 / 视觉等域**同时**布置「难题」与「作弊机会」，并把现实事故形态逐类点名（**访问未授权信息 / 规避监控 / 突破沙箱攻击外部系统**）。⇒ 本门槛的守备面**不止 text 基底的「小改动诱导」**：跨域存量作弊形态须一并作为对照清单输入；其「同域同时布置正题与作弊机会」的构造形态亦可供 [v1.6.0 §六](../v1.6/v1.6.0.md) 对抗类采集点借用。**引用纪律**：第三方基准设计，本仓未复算其读数，只取形态清单不取分数。**判据清单化（2026-09-30 登记）**：上述「混淆项 — 对照」结构已有公开清单化产物（[RSI Claim-Testing Checklist](https://github.com/sunghunkwag/recursive-self-improvement)，已在 `THANKS` 实验与证据节登记），其正面判据与本门槛同向——**「逐轮分数上升」必要而不充分，改进必须递归**（改进者本身要变，且变化后的改进者须产出比原版更好的改进）。四条与 v1.5.9 第四章收益归因对照组配套：那章管「净贡献是否有」，本章管「贡献是否可定位」。**生成侧补强（2026-10-02 补）**：[Certified Long-Horizon Code Agent Evolution via Validation-Gated Skill Optimization](https://arxiv.org/abs/2609.32990) 把长程代码 agent 的**技能优化置于验证闸门之下**——每轮演化须先过验证才被接受。⇒ 与本条**同侧且更靠生成端**：本条管「晋级要不要给」（门槛），该文补「**候选怎么产生**」（验证作生成侧的选择压），与 §一「验证便宜的域才自动进化」合成机制闭环。**引用纪律**：第三方单篇、本仓未复算，只落闸门形态，不引其读数。**安全跨代补强（2026-10-03 补）**：[Safety Must Survive Self-Improvement](https://arxiv.org/abs/2610.01073) 在**有状态授权任务**的受控试验台上研究 RSI **跨代**安全——固定 LLM 编辑器改可执行 agent 组件，**独立 traces** 逐代记录行为，把「不安全行为不得存活到下一代」与「失败后可恢复」拆成两个可分别观测的量。⇒ 与本行门槛**同侧、补齐「代际」维度**：本条管「这一代能不能晋级」，该文补「**上一代的不安全不得遗传、且失败态须可回退**」——与 §一「保护面独立性」行（自改进通道无权降低门强度）及审计链「原始记录 vs 判定结论」分离同构（其独立 traces 即留痕面）；同为第三方单篇、本仓未复算，只落代际安全与留痕形态，不引其读数 |
| **晋级三层的分层实证（2026-09-25 登记）** | 「注入租用 → skill 半持久 → 微调摊销」三层里，**最上层此前唯缺外部实证**，本轮补齐两件（均自报、本仓未复算，来源登记见 [THANKS · 实验与证据](../../THANKS.md)）：① **harness 蒸馏**（arXiv:2609.24974）——以优化过的 harness 作训练期指导、经 agent-as-harness 把引导转成训练示范，**微调后专用 harness 可在部署期移除**，且移除后基础模型任务成功率**反高于该 harness 仍挂着时的读数** ⇒ 正面回答了「凭什么信把能力蒸进权重比长期挂着 harness 更划算」，为「微调摊销」层给出机制与方向；② **留出集闸门回滚**（arXiv:2609.26760）——「**success-first held-out gate 回滚会伤害既有能力的修复序列**」是本章「严格优于历史最佳才接受 / 持平即不接受」的机制同构，同文并给出「把反复出现的控制决策从上下文搬进可复用代码」的路径（LLM 调用与部署推理成本方向性下降、小模型档位优势最大）⇒ 与 [v1.6.0 §四](../v1.6/v1.6.0.md)「纯函数型常数留代码、不判定化」同源。**边界**：两件均只作机制与层级归属参照，**不引其数字入本仓对照表**。**另两层各补一例（2026-10-02 补）**：② **skill 半持久层**——[R² Flow: Recursive Self-Improvement via Recursive Skill Evolution](https://arxiv.org/abs/2609.33867) 把 RSI 的载体放在**技能本身的递归演化**上 ⇒ 演化的单位不必是权重，**技能即递归改进的载体**；③ **注入租用层**——[Composing Task-specific Agent Harnesses at Test Time with Reusable Primitives](https://arxiv.org/abs/2609.38912) 主张 harness **不必预先整体定型**，可由**可复用原语在测试期按任务组装**（区别于预铺配置）。⇒ 本行三层**各有外部实证**（顶层原两件 + 本批两件）。**引用纪律**：两件均第三方单篇、本仓未复算，只落形态。**改进者本体两件（2026-10-03 补）**：① [Self-Evolving Harness on Multiple Tasks with the Agent as Its Own Optimizer](https://arxiv.org/abs/2609.38372) 把「**谁来做改进**」也纳入演化——既有自进化法多由一个挂在人设 harness 上的**独立 proposer** 改 solver 的 harness，该文让 **agent 自己当 optimizer**（去掉外置 proposer），且要求同一 harness 在**多任务**上成立；② [Learning Meta-Skills for Agent Harness Design in Test-Time AI4AI](https://arxiv.org/abs/2609.38143) 把「**设计 harness 的能力本身**」当作可学技能。⇒ 对本章的含义：三层晋级判据默认「改进者 ＝ 人 / 外置 proposer」，两件把**改进者本体**也列入可演化面——与 §二「保护面独立性」行（自改进通道无权降低门强度）**张力最直接**，故后续若评估「agent 自任优化器」，**门槛与留痕必须外置于该 agent 的可写面**，其「自改 harness」与「自改考核标准」的边界须显式落数。**自进化件簇（2026-10-04 补）**：同窗四件把 harness 演化推往不同侧面——[Turbo Harness](https://arxiv.org/abs/2609.40330)（**按实例自适应**调 harness）· [GUI-HARVEST](https://arxiv.org/abs/2610.00948)（GUI agent 以**证据驱动**演化 harness）· [Mixture of Self-Improving Branches](https://arxiv.org/abs/2609.37834)（自改分支**混合**）· [Video-RSI](https://arxiv.org/abs/2609.37950)（视频理解 agent 的**递归自改进**）——均属本行「harness 即演化载体」一族的延续（**并列登记、不排名**）。**引用纪律**：以上均第三方单篇、本仓未复算，只落形态 |

### 涉及文件（预估）

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/evolve/src/promotion-policy.ts` | 新建 | 晋级判据纯函数 + 台账写入 |
| `engine/evolve/src/__tests__/promotion-policy.test.ts` | 新建 | 频次×存续×验证三维判据 / 三态输出 / 人审门单测 |

### 验收标准

- [x] 晋级判据可计算（频次 × 存续期 × 验证态 → 三态建议）
- [x] 晋级判定落 decision-log（判据快照可追溯）
- [x] promote-train 只提示不自动执行（FDE 确认队列）
- [x] 三层可逆：上层验证失败可回退到下一层且留痕（复用既有 snapshot/restore，不新建机制）
- [x] 进化收益四指标可计算可记录（通过率趋势 / 复发率 / 复用率 / 介入率——数据从既有台账取）
- [x] 晋级以留出集信号为准（反馈集提升不计）+ 严格优于历史最佳才接受 + 单变量可归因（多变量捆包拒收）+ 校准不退化（逐维判定，准确率升而校准降同样拒收）
- [x] `npm test` 全绿

---

## 三、经验池接训练管道（instinct→数据集→TrainChannel · 打通 Data-RSI 断链）


> **形态归属**：`[主干]`（判定·数据入池资格与血缘锚点）**+ `[通道]` 成分**（数据集构造与通道提交的执行动作）｜ L1 关档
>
> 📋 **缺口实测（2026-09-19）**：`engine/train` 的数据接入链（`data-ingest.ts` 按扩展名判 CSV/XLSX/JSON/文本四源 → `dataset-builder.ts` 构造）只吃外部源，**不消费 instinct 池**——Data 面与 Model 面各自为政，一体机数据飞轮（session→分拣→脱敏→数据集→训练→灰度）在「数据集」一环断了内部供给。行业对位：Meta-RSI 的 Data-RSI 是「三算子的共同底料」，其产出同时喂 Harness-RSI 与 Model-RSI。**上游瓶颈补记**：环境供给（Agent 自造执行环境 → 增量快照 → 下一批训练场）是 Data-RSI 的上游——训练环境不可信则采集到的轨迹本身就是假的。「来源真实性标记」（本表）挡得住自述来源与合成来源，挡不住被环境伪造的轨迹；环境层的隔离与可验证是数据管线的前置条件（生产级沙盒基础设施的实证，[arXiv:2609.22978](https://arxiv.org/abs/2609.22978)）。

### 交付

| 组件 | 能力 |
|------|------|
| **instinct 池导出器** | 从 `{SOFAGENT_DATA}` instinct 存储（extractor 产物）筛选高置信度（≥ eval-gate 同源阈值）+ 已考核（本版第四章）条目，映射为训练记录（pattern→instruction，solution→output），血缘字段（来源轨迹 id / instinct id / 置信度）随行 |
| **来源真实性标记** | 导出器只收**经审计链锚定的真实运行轨迹**派生的 instinct（来源标记 `verified-trace` 与 Agent 自述/合成来源区分）——防自证污染：Agent 自己造的「成功经验」不得进训练数据（保护面在写面之外的直接推论；数据来源未标记 ⇒ 按不可信处理 fail-closed） |
| **租户隔离** | instinct 池与导出产物按 `enterpriseId` 分区（对齐 v1.4.7 多租户 `data/<tenant>/` 路径纪律）——一个企业的经验不得喂进另一个企业的训练数据（数据主权铁律）；跨租户导出默认禁止，显式配置才开且留痕 |
| **dataset-builder 新源** | `instinct` 源接入既有管道——实测形态为**旁挂适配器归一 IngestRecord**（见下方涉及文件表勘误），复用既有质量闸门与脱敏联动 |
| **TrainChannel 提交接线** | 构造的数据集可经既有 TrainChannel 接口提交（ssh 自管 VM 或托管 API），训练事件照常回流审计链 |
| **血缘锚点** | 数据集 manifest 记录「哪些 instinct 条目进了这个数据集」——训练产物（权重）可反向追溯至经验源头 |
| **经验面评估的硬边界（hooks 零外部调用 + 人审 gate 不自动执行）** | 经验评估的调用面收窄为**显式命令**：捕获/采集层（hooks 与后台捕获）**永不调用外部评估器**（含判定件与任何托管端点）——评估只在显式发起的评估命令里发生，dry-run 预览零网络请求。评估输入先投影再裁剪（有界脱敏投影，与 v1.8.0 判定件出站脱敏同纪律）。**评估结果只做排序与分类，不自动改写指令、不自动装技能、不自动执行动作**——一切入池/晋级/安装经人审 gate（生态记忆层同构：评估概率帮排序，不碰执行）。组织禁外部评估时，评估端点可指内部兼容实现或整体跳过，跳过不阻断捕获 |

### 涉及文件（预估）

| 文件 | 改动 | 说明 |
|------|------|------|
| `engine/orchestrator/src/instinct/store.ts` | 新建 | instinct 池持久化前置件（append-only JSONL + verified/sourceTrace/enterpriseId/traceId 四字段承载） |
| `engine/orchestrator/src/instinct/exporter.ts` | 新建 | instinct 池筛选导出（置信/考核/真实性/租户四道门 + 血缘字段） |
| `engine/orchestrator/src/instinct/index.ts` | 新建 | instinct 域 barrel（./instinct 子路径消费面） |
| `engine/train/src/instinct-source.ts` | 新建 | instinct 数据源适配器（归一到 IngestRecord，与 CSV/Excel/DB 同一下游——⚠️ 实测 dataset-builder 只吃已归一 IngestRecord[] 对来源无感、全仓无源类型枚举，故为旁挂适配器而非「builder 加第五种类型」；既有四源按扩展名判定的说法实为文件源子集形态） |

…（截断，原文 20831 字符）

请按系统指令输出 A/B/C 三类清单草稿。
