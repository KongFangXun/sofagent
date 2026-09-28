# 架构印证全文（原 docs/VALIDATION.md §三 · doc-slim 批 2026-09-28 搬出）

> 原节：Ontology 翻译层 / Apache Ossie / Notification 事件驱动 / FORGE 节奏 / 五层骨架映射 / AOS 四大基础设施 / 脑力四阶段 / 综合对标 / 确定性执行底线 / 循环的边界 / Loop 四层 / 鲁棒性 / OLAF-I / Palantir 落地路径 / Palantir 双 MCP / Snowflake / 模型层判断 / 纳德拉学习循环（:492-679 区段）。正文处已收敛为判据句与回指，全文在此。

## 三、架构印证：行业框架独立复现 sofagent 的选择

> 本节把跨批行业研读中与 sofagent 架构**结构上对齐**的行业框架逐条印证——不是发明新架构，是验证已有架构选型的行业合理性。

### Ontology = 共同理解层 / 翻译层

Ontology 的本质是「**翻译而非统一**」——在多个异构 Agent / 系统之上建立共同参照系，让彼此能对话，同时保留各系统内部语境独立；它 ≠ 数据模型 / ≠ ER 图 / ≠ 知识图谱（知识图谱只能查不能操作，Ontology 还能在对象上**触发操作**）。核心关键词是「操作」而非「数据」。「本体 = 运行时语义层」——它是在 Agent 跑任务时实时提供「谁依赖谁、谁能看什么、能触发什么」的语义上下文，是介于模型与业务系统之间的**活的中间层**。

> sofagent 设计决策（本体数据 = GitHub 生长树）见 [ARCHITECTURE §三](./ARCHITECTURE.md#本体数据--github-生长树核心设计原则)

### 语义层交换标准：Apache Ossie

数据格式的标准化历史一再重演同一剧本：数据文件靠 Parquet 统一、表靠 Iceberg、目录靠 Iceberg REST + Polaris——每一轮都是「别去统一工具，去统一交换格式」。**Apache Ossie（incubating，2026-01 v0.1 发布、2026-07 进 Apache 孵化器）** 是把同一剧本应用到「业务语义本身」：一份厂商中性的 YAML/JSON 语义模型（指标 / 维度 / 实体 / 关系 / 业务规则 + `ai_context` 字段），让 BI、数据平台、Agent 共享同一套"业务定义真相源"，消除指标漂移与 Agent 幻觉式接地。

对 sofagent 的三点印证：
1. **语义层 ≠ 数据层，但必须可被执行**：Ossie 模型是声明式 YAML，本身不存数据、不查数据，只描述"营收怎么算、谁能看"——与权威归属「Backend as Source of Truth」完全一致：语义层只映射视图，不替代后端。
2. **AI-Ready Context 即运行时语义层**：Ossie 的 `ai_context` 字段显式给 LLM 喂"回答收入问题时只用已认证指标 / 同义词映射（营收=销售额）"——这正是「本体 = 运行时语义层」的工业级实例化：Agent 跑任务时实时拿到的语义上下文，由中立标准而非各家私有格式承载。
3. **Hub-and-Spoke 去中心化**：N 个平台经 Ossie 互转只需 2N 条路径（而非 N×(N-1)），系统从数据源头自读语义元数据、不维护点对点映射——与「协议 Adapter 封装、上层语义层不感知底层」同构，也呼应 sofagent「合的框架」定位（企业换 Agent 平台，约束与审计不动）。

> ⚠️ 克制说明：Ossie 仍是 2026 年初生标准（v0.1/v0.2.dev），sofagent 当前以自有 Ontology 层 + Ledger-Views-Policy 承载语义，**不引入 Ossie 依赖**；此处仅作"语义层交换协议"的演进参照记录，待其生态成熟再评估 Adapter 级对接。

> 📖 来源：Apache Ossie 官网 [ossie.apache.org](https://ossie.apache.org/)（2026-07 进 Apache 孵化器）

### Notification 事件驱动协作

多 Agent 经**事件总线 / Notification 接力**协作，而非直接点对点互相调用。这与「一条河事件总线」天然契合——River 是统一入口，节点之间通过 Workflow 拓扑的数据回流（事件）传递，不直接硬连调用路径。好处：调用路径不动态化，治理不失控（谁触发了谁、谁该被审计，始终在总线上可见）。

### 外层 FORGE 的节奏与护栏

Onyx 四阶段闭环（L1：可见性 → 仿真 → 执行 → 学习）与人类审批双模式（L2：高风险人工确认 / 常规受信自动执行）是 31 篇研读里外层 Loop 的两个关键印证——前者给出闭环叙事节奏，后者给出「按风险分级放行」的 human 节点策略。sofagent 对应落地：外层循环节奏 = SUSTAIN 巡检（`docs/guides/fde-activation-chain.md`）+ `releasing.md` 阶段十二（发版后 SOP 自进化）；human 节点分级 = 审计模块 critical/warning/crutch 分层 + 危险操作前人工批准钩子。

> 💡 **协议 Adapter 封装**：中间件应在底层封装 MCP / A2A / ACP 协议差异，上层语义层（Ontology / Action Type）不感知底层协议——对齐 sofagent「合的框架」定位：企业换 Agent 平台，约束与审计不动。

> 💡 **产品化视角（控制平面）**：上面「企业换 Agent 平台，约束与审计不动」就是产品化时**控制平面打法**的技术根——底层 Agent 智能随便换，治理与真相永远在 sofagent 一侧。产品化的完整展开（dashboard 只读视图 + MCP 作桥）见 [设计哲学 §六 产品化哲学](./PHILOSOPHY.md#产品化哲学控制平面与-mcp--dashboard)。

> 💡 **实现参考**：指令层用 Jinja2 变量槽渲染 `prompts/`（把企业规则注入为可填充模板）；校验层用 JSON Schema 三步校验（格式 → 完整性 → 约束）；经验法则——首次因 AI 格式问题排查超 1 小时，就该上校验层（把概率性输出收口到确定性 schema）。

### 行业五层骨架 → sofagent 三层架构映射

行业五层（配置/知识/指令/校验/编排）映射本仓三层（约束层/知识层/编排层）；关键同构=五层里仅指令层直接调 AI，本仓同样只有知识/指令承载概率性、校验编排全在确定性引擎。逐层映射表与消歧说明见归档。

> 📚 完整映射表：[归档](./archive/validation-digest/README.md)

### AI 原生操作系统（AOS）四大基础设施映射

2026-07 行业研判将「AI 原生操作系统」的核心竞争力归结为四大基础设施，而非更聪明的聊天窗口。sofagent 在五层工程谱系（Prompt→Context→Harness→Loop→Graph）中的对应与之逐层同构：

| AOS 基础设施 | 定义 | sofagent 落点 |
|---|---|---|
| 数据接口层 | Agent 连接企业库 / 个人 / IoT / 实时数据 | CloudBase / OpenClaw 集成（Gateway 只桥接、不替代）|
| 上下文理解层 | AI 理解数据背后的业务语义 / 规则 / 偏好 | Ontology（运行时语义层，翻译而非统一）|
| 权限管理系统 | 身份认证 · 权限控制 · 行为审计 · 安全边界 | 审计能力（git diff 硬证据）+ 约束层（约束注入链）+ entry-gate 风险分级 |
| Skill 生态 | 开发者输出专项 Skill（类比 App Store） | `/SKILL/` 统一入口 + 约束层（官方）/ 用户层分离 |

### 脑力自动化四阶段 ↔ sofagent 工程谱系映射

行业将「AI 对应脑力自动化」的演进概括为四阶段——提示词工程 → 上下文工程 → 驾驭工程 → 循环自动化。sofagent 在五层工程谱系中的对应恰好是这条主线的工程化落地：

| 脑力自动化阶段 | 含义 | sofagent 对应层 |
|---|---|---|
| 提示词工程 | 教会模型「怎么说」 | Prompt 层（SKILL.md / fde.md 指令载体）|
| 上下文工程 | 给模型「什么背景」 | Context 层（knowledge/ + Ontology 运行时语义）|
| 驾驭工程 | 约束模型「不能乱来」 | 约束层（约束注入链 + 审计 + 回溯，七步 Action 管线）|
| 循环自动化 | 让模型「自己跑闭环」 | Loop / Graph 层（编排模块 + 进化模块 + FORGE 外层循环）|

### 综合行业对标

> 完整行业对标（a16z 七法则 / Ontology Runtime 六组件 / 工具网关 / MoA 四层 / AI to B 三层基建 / 自主级别 L1-L3 / 贝恩控制面）统一见本文件 §一~§四及 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。

### 企业级 Agent 的确定性执行底线

企业落地 AI 的三条底线（零数据权限 / 全链路留痕 / 确定性执行）——与 sofagent 的「LLM 动脑指挥，Ontology 指路，确定性工具执行」分工完全同构：

| 底线 | 含义 | sofagent 落点 |
|------|------|--------------|
| **零数据权限** | LLM 不直接写 SQL / 连数据库，与原始数据隔离 | 零凭证沙箱 + v1.3.7 虚拟 key 边界注入——LLM 只按按钮，不碰数据 |
| **全链路留痕** | 每操作步骤有日志，可追踪可回溯可审计 | 审计模块（git diff 硬证据 + HMAC 链）+ 运行时审计 |
| **确定性执行** | 工具函数预先写好，参数固定，同样输入同样输出 | 工具审批四模式 + Ontology Action 七步管线——LLM 当翻译官，不当写逻辑的人 |

### 循环的边界：入场判据与升级判据

**Loop 是 Graph 的特例**（包含关系，非替代）。边界有两个方向——先判**该不该建**（入场判据），再判**该不该升**（升级判据）：

**入场判据——三适合条件**（任务同时满足三条才值得建 Loop，否则一次性 Agent 调用就够）：一、**重复发生**——同一任务会反复出现（fresh-eyes 审查每版发版都跑；只跑一次的一次性分析不建 Loop）；二、**完成标准清晰**——「做完」能被独立判定（exit 0 / 测试数对账 / verdict PASS；「把文档写好点」这类主观目标先定义 Rubric 或二元清单，定义不出来不建 Loop）；
三、**token 成本可扛**——单轮成本 × 预期轮数在预算内（FORGE 三层熔断 + [预算三维度声明](../FORGE/lessons/index.md)就是这条的工程化）。

单 Loop 有四种典型失败，sofagent 的审计节点（★Reality Anchor）逐一对应解法；当任务复杂度触及任一升级信号时，才从 Loop 升级到 Graph（满足其一才升级，否则 Loop 就够，避免过度设计）：

**单 Loop 四类失败 → sofagent 解法**：指标异化（优化解决率→流失率翻倍）→ audit 节点看 git diff 硬证据不信自报；目标僵化（Agent 不质疑目标本身）→ human_confirm 节点 + 危险操作前人工批准钩子；多目标冲突（两个 loop 打架）→ ★Reality Anchor guard edge 统一裁决；测量衰退（测试数据老化假象）→ audit 规则不可篡改 + acceptance-test 冻结验收标准。

**升级六信号 → sofagent 落点**：任务需交接（dag-runner 单任务 vs 并行编排波次）/ 需散出汇合（Send API 并行 + MergeQueue，v1.3.1）/ 每步不同模型工具（model-router 路由）/ 需显式可审计角色（StateGraph 四节点）/ 节点失败需隔离（git worktree，v1.2.3）/ 需独立 reviewer（audit + fresh-eyes）。
完整对照见 [FORGE §Graph Engineering 视角](./guides/loop-development.md#graph-engineering-视角控制图--stategraph)。

### Loop 四层循环：从 Agent Demo 到可交付 AI 产品

四层循环不是四个并列技术名词，而是**四个不同时间尺度的控制**——单 Agent Loop 只能算「会连续执行的 Demo」，四层打通才是可交付、可运行、可持续改进的 AI 产品：

| 循环层级 | 管什么 | 时间尺度 | 解决什么问题 |
|---------|-------|---------|-------------|
| **Agent Loop** | 一次行动 | 单次执行 | 模型自动调用工具、循环执行到自判完成 |
| **Fortification Loop** | 一次任务 | 单次交付 | 把「完成」的定义权从模型手里拿出来——Agent 输出 → 独立 Grader → 按预设 Rubric 验收（Rubric 定义不出来就不建 Loop，见上文[入场判据](#循环的边界入场判据与升级判据)第二条）→ 不通过打回重改 |
| **Event Driven Loop** | 持续业务 | 长期运行 | 事件自动触发 Agent，完成并验证后写回真实系统——处理任务排队/重复事件/并发冲突/失败重试/状态恢复 |
| **Hill Climbing Loop** | 系统进化 | 跨多次任务 | 收集大量运行 Trace → 分析系统性失败模式 → 修改 Harness（Prompt/工具/上下文/Memory/Grader）→ 提升整体表现 |

**对 sofagent 的四点印证**：

1. **Fortification Loop = 审计 + 验收的定位一句话**——「把什么叫做完成，从模型的自我判断变成可执行可追责的验收标准」正是 sofagent 审计模块 + `acceptance-test.sh` 冻结验收 + `define_acceptance` 机器可判定验收的定位（完成定义权的转移，完整论证见上文 [Verifier 才是瓶颈](#verifier-才是瓶颈)）。Fortification Loop 的价值不是让 Agent 多检查一遍，是完成定义权从模型转移到系统。
2. **Event Driven Loop = daemon + WAL 续跑**——事件驱动不是加个定时器：任务排队（daemon scheduler/cron 三档）、重复事件（幂等）、并发冲突（MergeQueue）、失败重试（退避 + 收敛）、状态恢复（checkpoint 续跑）——sofagent 异步长任务自治逐项对应。
3. **Hill Climbing Loop = 进化模块 + FORGE 自迭代**——「分析多次运行留下的 Trace，找到重复出现的问题，再修改产生这些问题的 Harness」：sofagent 进化模块（think.md 反思 + Dream Cycle 知识蒸馏 + evolve 优化）消费 audit/eval 轨迹；FORGE fresh-eyes-loop 本身就是一个 Hill Climbing Loop（常规 12 视角 / 全量 23 视角审查 → 修复 → 验证 → 系统改 harness）。
  **关键安全网：Hill Climbing ≠ 让 Agent 随意改自己的 Prompt 然后直接上线**——可靠改进仍需候选版本/离线评测/回归测试/人工审核/小流量验证/回滚，sofagent 的 release-gate-loop + check-version 门禁 + 快照回滚正是这套安全网。
4. **自动化不是把人移出循环，是重新安排人的位置**——人不再盯着 Agent 每一步，但在高责任节点保留判断权和否决权：敏感工具（转账/删数据/改数据库）前人工确认、业务取舍/价值判断时担任 Grader、结果发客户或写核心系统前审批、Harness 新版本部署前评审——**这正是 sofagent HITL 钩子 + 工具审批四模式 + 危险操作前人工批准钩子的设计哲学**。

### 循环系统的鲁棒性：四类故障与六要素

自主循环系统稳定运行需要六要素（自动化触发 / 隔离演练 / 安全边界 / 工具连接 / 角色分离 / 记忆分层）——sofagent 全部已有：pre/post hook = 激活链 + daemon cron；隔离演练 = git worktree；安全边界 = 工具审批 + HITL；工具连接 = MCP server；角色分离 = Explore/Code Agent 拆分；记忆分层 = v1.2.8 记忆分层 + 四层加载链。

四类故障模式与 Onboard Agent 收敛判据直接对应（L1 判定 crash/error/超时，L5 连续 PASS 判收敛 / 连续 FAIL 判发散）：

| 故障模式 | 表现 | sofagent 对应 |
|------|------|------|
| **空转** | 反复改几十次测试通不过 | Onboard L5 连续 FAIL 判发散 |
| **过拟合测试** | 单元测试全过，业务不能用 | Benchmark 评测 + 人工验收 |
| **上下文漂移** | 基于过期假设写代码 | Durable Execution L1 checkpoint 续跑 |
| **不安全自主** | AI 越权搞破坏 | 工具审批四模式 + 保守默认拒绝 |

> 💡 **核心定律**：「测试失败 = 最高质量的下一轮上下文」「仓库记得，即使模型不记得」——与「Agent 会失忆，文件不会」（Ralph Loop）同源：git diff 是无状态的地面真相，仓库是模型永远可以回读的外部记忆。

### OLAF-I 五块骨架：Ontology 的最小不可再分集

OLAF-I（Object/Link/Action/Function/Interface）= 数字孪生最小够用集，五块任意两块不可无损合并；sofagent 五能力同构（各自独立职责不可合并）。Palantir「Action 默认 staged 等人审」= human_confirm 同构。映射表与合并检验法见归档。

> 📚 全文与读数：[归档](./archive/validation-digest/README.md)——本节 2026-09-28 台账化压缩。

### Palantir 落地路径：Red Loop、KLM 范式与「能换模型的对象层」

> 📖 来源：Palantir 官方架构文档（AIP / Foundry / Apollo 三套集成平台）。官方事实，非转写。

- **Ontology = 可运行的业务契约，不是知识图谱**——官方原话「表达企业彼此关联的复杂**决定**，而不是数据」（决定二字官方斜体强调）；整合 Data + Logic + Action + Security 四维度；核心价值 = **定义业务里有什么、现在是什么状态、人和 Agent 分别可以做什么**（库存不足能不能发起调拨？采购金额超多少必须二次审批？排产修改后哪些下游对象要一起更新？）。**企业学习要点：对象定义必须和动作一起做**——只统一名词、不定义状态/变化/权限/写回，得到的是漂亮标签，不是生产级。
- **KLM 范式（不用什么智能都压在大模型上）**——一个决定可以同时调用业务规则、预测模型、优化器和 LLM function：缺料判断主要靠库存计算 + 约束优化，大模型只负责读供应商邮件、解释方案。**企业架构假设：从第一天就假设会同时用多个模型，并且随时能替换任何一个 → 把规则、动作、边界放在模型外边**。
- **Red Loop（真闭环）**——人和 Agent **走同一套接口、受同一套权限**，结果写回业务系统（不是把聊天记录塞回向量库，而是把决定和结果放回业务对象的历史）；**写回必备机制：幂等、回执、补偿、审计、人工接管**（同一条请求重试会不会扣两次库存？ERP 成功但 API 超时怎么对账？审批后供应商状态变了要不要重算？没有这些，所谓闭环就是 Demo）。
- **Apollo（交付层）**——管软件持续交付（版本怎么进云/本地/边缘/隔离环境、怎么灰度、出问题怎么回滚），**不管 GPU 和后训调度**；企业自检：Agent 的提示/工具/规则有没有版本？测试通过后用什么发布？模型换了要不要重考评测？升级失败能不能回退？
- **FDE = 容易被忽略的「非软件层」**——工程师嵌入客户现场一起建功能（从战区到工厂车间）；企业自检：「工程师去产线待着」即可复制，不靠采购。
- **6 个月路线图**——前 3 个月选一个高价值业务决定，接通最小数据链，做出**有人审批、能写回结果、可追踪**的 Action 闭环（验收不看模型多聪明，看业务有没有真的改变、错误能不能发现、失败能不能恢复）；后 3 个月加 Agent，按 KLM 接入至少两种可替换模型，建立真实业务测试集，记录调用轨迹/成本/结果，补齐发布/回滚/权限治理。
- **两个验收问题**——① 如果明天更换大模型，业务对象、规则、动作、权限和历史还能不能留下？（查 Ontology + KLM）② 这套东西能不能进我的隔离环境？升级失败能不能回滚？边缘节点断了还能不能跑？（查 Apollo + Rubrik）——**答不上来，你买到的可能只是一个更贵的 Demo**。

> 💡 **对 sofagent 的五点印证**：
>
> 1. **Ontology = 可运行业务契约**——与本体数据（Object Type + Property + Link Type + Action + 状态机，FDE/GUIDE 第三章）完全同构：「对象定义必须和动作一起做」正是本体数据的 Action 注册表 + validator 三态 + 生命周期（v1.3.1 / v1.3.7）。
> 2. **Red Loop 写回机制** = Durable Execution（checkpoint 续跑 + 副作用幂等，v1.3.1）+ WAL 三态恢复 / undo 三档 + HITL 审批 + 审计留痕——「幂等 / 回执 / 补偿 / 审计 / 人工接管」逐一有对应。
> 3. **KLM 范式** = 智能 / 控制分离（PHILOSOPHY §一理论锚点）+ 模型注册 / 灰度切换 / 路由决策可解释性——「把规则动作边界放在模型外边」正是约束层哲学。
> 4. **Apollo 交付层自检五问** = 版本同步机制 + `check-version` 门禁 + 快照回滚 + 模型换后重考评测（Benchmark）。
> 5. **两个验收问题** = 「编排层长期不换」（架构级取舍、非永久承诺：25 条 git diff 规则 + HMAC 链不依赖模型）+ 快照 `--revert` 一键回滚——「换模型对象还在不在」的答案就在约束层与模型解耦的设计里。

### Palantir 双 MCP 体系：把「改结构」和「改数据」拆成两条治理通道

> 📖 来源：[Palantir Foundation · Ontology MCP 样例架构](https://palantirfoundation.org/docs/foundry/ontology-mcp/sample-architecture)（官方文档，2026）+ 第三方评测交叉（chatforest.com，2026-07 口径）。官方事实，非转写。

Palantir 的 agent 接入面拆成两个 MCP server，**读写分离、各带治理门**：**Palantir MCP（PMCP，已 GA）**是平台开发面——70+ 工具覆盖本体 schema 的搜/查/改、代码仓 Git 操作、跨资源分支、数据集与血缘；**本体 schema 的任何修改必须走 proposal review 人工审批后才生效**。**Ontology MCP（OMCP，后至 GA）**是运行时业务面——object types 收敛为一个统一 SQL 查询工具；
**每个 action type 独立暴露为一个 MCP 工具**（agent 写数据只能调预定义 Action，不能直接 UPDATE 底表）；query functions 逐个成工具；AIP Logic / chatbot 可存为函数经 MCP 暴露（**agents as tools**，agent 产物成为别的 agent 的工具）。另发 Claude / OpenAI / Google 三家 Agent SDK 模板：不合并框架，共享 Ontology 资源 scope、认证、MCP 接口与发布流程，agent 发布后注册为异步函数由对象变更触发。

> 💡 **对 sofagent 的三点印证**：
>
> 1. **「agent 能改什么」与「agent 能做什么」被显式拆开**——schema 变更（PMCP + proposal 人工门）与数据变更（OMCP + 受控 Action）分走两套接口。sofagent 同构：约束注入（改 workflow / SKILL）走 SKILL.md 单一权威源 + git 提交审计，业务执行（改业务对象）走 workflow Action + human_confirm——两条通道也是分门的，且 sofagent 两条都落在 git 可审计面上。
> 2. **Action 逐工具暴露 = 审计粒度到单个业务动作**——OMCP 不把「写」收成一个大工具，而是每个 Action 一个工具，权限与审计天然按动作切分。这与「25 条 git diff 规则按变更类型切分」同构：粒度即治理面。
> 3. **agents as tools 与框架中立模板印证「沉淀即复用」**——agent 产物存为函数给别的 agent 用，对应 think.md → knowledge/ 的晋升机制；三家 SDK 模板共享本体接口、各留原生 loop，与「平台层不定义治理、只表达治理」的宿主无关哲学同向。

### Snowflake 自下而上本体路径：数仓巨头的 context 工厂

> 📖 来源：[Introducing Cortex Sense](https://www.snowflake.com/en/blog/enterprise-ai-agents-grounded-context/)（Snowflake 官方博客，2026-06）· [Incorporating Ontologies into Snowflake Cortex Agents](https://www.snowflake.com/en/blog/engineering/ontology-grounded-cortex-agents/)（Snowflake 工程博客，
>2026-05）+ Horizon Catalog / Semantic Views 官方产品文档与 FY2026 财报。benchmark 数字为官方口径。

Palantir 从业务对象出发「自顶向下」建本体，Snowflake 反向走「自下而上」：从数仓长出本体栈，四层演进——目录（Horizon Catalog，已 GA，底层捐给 Apache 基金会成 Polaris 顶级项目）→ 语义层（Semantic Views / Semantic Studio，已 GA）→ 图（Knowledge Graph：KG_NODE / KG_EDGE 两张表存数仓内，recursive CTE 遍历，已公开）→ 智能体接口（Cortex Sense：自动扫描全库构建全局 ontology 作 context substrate，私预）。
定位一句话：**把数仓改造成 agent 的 context 工厂**。关键数字（官方口径）：Cortex Sense 称治理 context 使 agent 回答复杂业务问题的准确率 47%→83%（对照：通用 coding agent 裸连数仓 23%）。

> 💡 **对 sofagent 的三点印证**：
>
> 1. **「本体 = 运行时 context 层」被多家独立复现**——Snowflake（自下而上）与 Palantir（自顶向下）、微软 Fabric（语义模型）路径相反、结论相同：本体是 agent 的 context substrate，不是文档柜。与上文「Ontology = 共同理解层」条目互为外部佐证。
> 2. **Action 语义缺失是反面印证**——Snowflake 对标 Palantir 时公认的最弱格：写操作仍走 ETL/SQL，Action 语义未沉淀到平台。context 巨头把「agent 知道什么」做成了商品，「agent 能做什么动作、谁审批、错了怎么办」这一格留白——恰是审计规则 + HITL 审批 + 审计链的主场。
> 3. **83% 不是终点，是判定面的起点**——六分之一的错误率且无不确定性标记（不弃权、不给校准概率），agent 敢答就答。context 治理解决「知道得对」，不解决「知道自己不知道」——后者正是判定面（校准概率 / 弃权）要补的位。

### 模型层判断：组合优于单一，本地模型可行

AI 从「程序」（单一模型）走向「协议」（多模型组合）是 Scaling Law 资源天花板的必然结果。两个对 sofagent 有直接影响的判断：

1. **智能密度提升**——小模型与大模型能力差距从 2 年缩到 1 年甚至半年。这印证 sofagent 分层模型架构的可行性（本地档执行 workflow + 本地管道档跑固定管道）：小模型够用时，本地推理的成本/隐私优势才真正成立。
2. **运行时动态路由**——推理框架自动化后，runtime 动态把请求路由到最优模型组合。与 sofagent model-router 同构（敏感度 × 复杂度路由：云端两档 / 本地两档 / 判定档 / 拦截出口）：public/internal 走云端，restricted/confidential 走本地，confidential 超复杂阻断。

> 💡 **self-recording improvement**：模型协作产生 trace → 用 trace 训练单模型 → 个体变强 → 增强协作边界。与 sofagent 进化能力同源：Dream Cycle 从 think.md 派生 knowledge/（Ledger→Views 单向），进化闭环用 Benchmark 分数驱动经验层优化——都是「把执行经验沉淀回个体」。
