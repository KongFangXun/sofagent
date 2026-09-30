# sofagent 行业印证与生态定位 · Validation

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> v1.5.4 · 2026-09-30（UTC）· ✅ 已发版 · 孔放勋

> **本文档从四个维度回答一个问题：行业有没有独立验证 sofagent 的直觉？** ① 方法论——约束层为什么是刚需；② 生态位——sofagent 在 Agent 三层模型中的位置；③ 架构——行业框架怎么独立复现 sofagent 的选择；④ 市场——技术判断有没有被买单。四维同指一结论：**不管 Agent 怎么搭、在哪跑，它需要一个独立的约束层。**
> 收录纪律（doc-slim 批起）：正文每条印证 = 一句判据 + 出处链接（≤3 行）；成篇深论证全文归档 [`docs/archive/validation-deep/`](./archive/validation-deep/README.md)。


## 目录

- [一、方法论印证](#一方法论印证行业研究怎么验证-sofagent-直觉)
- [二、生态位](#二生态位agent-三层模型与-sofagent-的位置)
- [三、架构印证](#三架构印证行业框架独立复现-sofagent-的选择)
- [四、市场印证](#四市场印证行业判断被市场买单)
- [五、研报视角的边界提示](#五研报视角的边界提示)


## 一、方法论印证：行业研究怎么验证 sofagent 直觉

> 不是新理论，是跨批行业研读里反复出现、能直接印证 sofagent 已有直觉的结论落纸。概念层与厂商实证的成篇论证见 [归档 · concept-layer](./archive/validation-deep/concept-layer.md)/[归档 · harness-vendors](./archive/validation-deep/harness-vendors.md)。

**▍概念层（一句话判据）**

- **骨架开场钩子**——智能体 = 多层骨架（配置/知识/指令/校验/编排），约束层是钢筋，模型是水泥
- **Harness Engineering 范式锚点**——2025-2026 行业把 Harness Engineering 列为与 Prompt/Context/Loop 并列的范式跃迁阶段，sofagent「约束层（Harness）」字面对应。
- **确定性迁移主线**——刚性业务规则三段迁移（prompt 软约束 → 知识层结构化 → 代码层 100% 强制）：「桩径不能小于 600mm 这类刚性要求必须 100% 执行，AI 只能大概率，代码才能一定」。
- **知行合一注脚**——「知而不行只是未知」：破局不是叠加规则，是让系统理解规则目的并在事前拦截——与约束注入链 + 审计硬证据的双向设计同构。
- **黑盒症结**——企业 AI 落地常败于「无法证明结果正确」；sofagent 审计把黑盒变白盒（git diff 硬证据、可溯源可复核）。
- **编排兜底**——LLM 不可用时确定性规则引擎照常守门（25 条规则中 20 条纯 git-diff、零 token）：纪律不绑定任何单一模型的可用性。
- **反去人化命题**——human-in-the-loop 不是能力缺陷，是「可靠优先于自主」的差异化优势（主体性护栏不可外包）。
- **90/10 价值分层 → 知行合一框架**——模型给 90% 智力（知），sofagent 补 10% 可靠执行（行），关键在「合一」；模型越强那 10% 越值钱。
- **治理缺口的代价（三项联网核验）**——Gartner 2026-05：到 2027 年 40% 企业自主 Agent 将因治理缺口被降级/停用；MIT NANDA：95% gen-AI 部署零可衡量 ROI；Governance Decay：运行时约束被上下文压缩擦除后违规率 0%→38%。约束/治理是投产前提，非加分项。
- **a16z 七法则映射**——「人比软件便宜」与 90/10 同频；Loops/Evals/冗员等五条本仓原生具备，[完整映射表见归档](./archive/validation-digest/README.md)。
- **红杉 Neo-Lab / Sovereign AI**——「主权是光谱不是开关」「先建评测集再谈微调」与本仓模型路由不自研、Benchmark 先行完全同构。
- **评测集是受管资产（三源收敛）**——来源：真实失败与生产流量沉淀（非合成数据）；规模：20-50 个真实失败案例即可起步、随版本扩展（拖越久越难补）；形态：进版本控制、接 CI 跑（临时脚本形态 = 不可回归的评测 = 假评测）。与本仓既有 09-06「评测集所有权治理」为姊妹条：彼管归属，此管来源与形态。来源：Anthropic《Demystifying Evals》（IMA 收录）｜ DeepSeek Safety 官方技术报告（IMA 收录）｜ OpenRouter · https://openrouter.ai/blog/tutorials/ai-agent-regression-testing-after-a-prompt-or-model-change/
- **硅基员工论（Org Graph / Ontology Runtime）**——「长期存活、固定领域、进组织编制」的 Agent 称为 Org Graph 节点，与常驻 Agent 定位字面对应；Ontology Runtime 是企业底座而非 API 网关。
- **数字员工操作性定义**——四跨越（组织身份/岗位职责/事件驱动/结果负责）+ 结果负责三要素（可观测/可归因/可回滚），与审计/回溯能力对齐。

### Verifier 才是瓶颈

Loop 真正的瓶颈是 **Verifier**（定义什么是合格、何时算完成），不是生成器——模型生成能力已严重过剩，稀缺的是「定义合格」的能力，这正是 90/10 里那 10%。sofagent 审计 + 约束注入链做的正是「定义合格与完成」：把验收标准写进确定性规则，让 Loop 有判停依据。闸门必须分层（快闸门确定性低耗时 / 慢闸门全量异步）。Linear 实测：AI 编码使测试套件一年增长约 4 倍，验证成为新瓶颈。

> 📖 [Linear · Refactoring CI for the AI coding verification crunch](https://aihot.news/items/cmublfs5a03bcro0lebbtf8fb)

### FDE 职能的组织学验证：五常设岗位

BCG 访谈 50+ 家 AI 领先公司归纳出五种新角色原型——工作流设计师/领域知识负责人 / 业务自建者 / AI 治理者 / Agent 运营负责人。三重印证：① **五岗位恰是 FDE 三重角色（梳理/部署/养护）在企业内部的常设化拆分**——FDE 是生成相位的总承包人，五岗位是驻留相位的分包编制（映射 SSOT 见 [FDE/ROLES.md](../FDE/ROLES.md)）；② **「先重构再上 AI」被定量定价**——
重做工作与人才机制的公司年度 TSR 比同行高 11+ 个百分点，BCG 另一调研显示 60% 企业未获 AI 价值的根因是任务层面叠加工具、未触及流程（= 跳过 FDE 梳理直接买工具）；③ **治理与运维两岗的自动化恰是本仓存量**——Guardian（审计/HMAC/回溯）与 Shepherd（daemon 巡检/插件生命周期）对应能力全部已发版。边界：定性原型非统计抽样，读数自报未复算。

> 📖 [Sagar Goel et al. · Five Ways That AI Front-Runners Change How Work Gets Done](https://www.bcg.com/publications/2026/companies-use-ai-to-redesign-work)

### 测量者转型：从「月底审计报表」到「每次 AI 行动留日志」（Cloudflare 实证）

Cloudflare CEO 把工作角色分三类（Builder/Seller/Measurer），**Measurer 最先被 AI 逼近**；测量类岗位减少但「测量」无处不在——以前月底一张审计报表，以后**每次 AI 行动都留日志**。判断工作安全度不看岗位名称，看承担的角色：被重新定价的是「输入完整、标准清楚、结果可验证的具体任务」——sofagent 审计同构（输入=git diff、标准=25 条规则、结果=PASS/FAIL 可验证），正是测量者形态的工程化。

> 📖 [Matthew Prince · How I Choose Which Cloudflare Employees to Replace With AI](https://www.wsj.com/articles/cloudflare-ceo-how-i-choose-which-cloudflare-employees-to-replace-with-ai)

**▍厂商实证——Harness 品类被多方独立验证（一句话判据，逐家深读见 [归档](./archive/validation-deep/harness-vendors.md)）**

| 厂商/项目 | 一句话判据 | 出处 |
|---|---|---|
| **DeerFlow 2.0**（字节） | 自称 "super agent harness"，Harness 品类词站住；它是「河」（运行时）sofagent 是「堤」（约束层），互补不冲突 | [bytedance/deer-flow](https://github.com/bytedance/deer-flow) |
| **DeepSeek Harness** | 模型厂商开源 `Agent = Model + Harness` 运行时（一切皆插件）——「Harness 独立于模型」获厂商级验证；机制与 sofagent 深度同构（可逆性/事件留痕/两旋钮权限） | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| **OpenAI Codex Harness** | ARC-AGI-3 上仅调 Harness 两项（保留推理+上下文压缩）得分 13.3%→38.3%、token 降 6 倍——「Harness 决定 Agent 表现」被官方量化（⚠️ 量纲限定：能力型表现 ≠ 治理型可靠性，只作方向性信号） | [openai/codex](https://github.com/openai/codex) |
| **OpenAI Agents API**（2026-09-10 公测） | Harness 托管商品化、零平台费——编排层护城河在消失，壁垒收窄到治理工程（25 规则/HMAC 链/本体/审批流）；压缩不是审计记录 ⇒ 审计证据链必须独立落盘 | [Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/) |
| **Anthropic 产品真相** | 运行的生产代码是产品最可靠的事实来源——审计「不看 Agent 说什么，看 git diff 留下什么」同源 | Anthropic Joel 访谈（第三方框架转述） |
| **Codex Guardian 模块** | 审查结论的失效语义（`IncompatibleCompaction` 等）——「压缩不是审计记录」的工程化背书 | [codex guardian/](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian) |
| **Omnigent**（Databricks 系） | meta-harness 把策略强制在基础设施层而非 prompt；密钥不进 Agent 进程——「约束进代码层」的工程化版本 | [Databricks blog](https://www.databricks.com/blog/introducing-omnigent) |
| **DataFlow**（北大 DCAI） | 顶尖高校独立用「Harness」命名（同月第三家）——品类共识非孤证 | [OpenDCAI/DataFlow](https://github.com/OpenDCAI/DataFlow) + arXiv:2607.16617 |
| **OpenFDE** | 以 Forward Deployed Engineer 命名售前工作流——FDE 术语同源佐证；spec-first 硬禁令与 decisions.jsonl 是可借鉴方向 | [OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo) |

**▍跨域实证——eval / 记忆 / 训练基建 / Skill 形态（一句话判据，深读见 [归档](./archive/validation-deep/cross-domain.md)）**

- **OpenAI build-prove-generalize**——FDE 官方方法论：`prove = 建定制 eval`，审计从成本项重新定义为产品化前置条件（John Deere 案例：定制评估后农户化学品用量降 70%、客户互动提升 6 倍）。[出处](https://openai.com/business/the-openai-deployment-company/)
- **OpenAI Agents SDK v0.22.0**——四因子乘积模型（模型能力 × 运行时可靠性 × 数据可信度 × 权限与审计）被官方一手源实证，后三因子正是约束层的活。[出处](https://github.com/openai/openai-agents-python/releases/tag/v0.22.0)
- **harnessed agentic RL**——训练域验证「归因单位必须是完整执行、不是单次调用」（Agent Lightning 2.41 样本/rollout、Dressage reward 以整条 trajectory 为单位）：与审计按 commit 留痕同构。arXiv:2608.17528
- **Omarchy**——SKILL.md 是正在收敛的 Agent 接口形态；反漂移靠「禁二份」纪律（SSOT 声明 + 扫描对账互补）。[omacom/omarchy](https://github.com/omacom/omarchy)（35.3k stars）
- **企业 AI 选型框架「两轴一红线」**——语义不确定性 × 路径不确定性两轴矩阵 + 高影响动作留给人；「能用规则不用模型判断」与 20/25 纯 git-diff 同构，「不信可解释性」（信任源于证据链而非推理结论）与 HMAC 链 + HITL 咬合。验收六指标全部可从审计链派生——考试式验收的落地形态。[深读见归档](./archive/validation-deep/selection-frameworks.md)
- **金融风控归因消融**——汇添富以领域本体为底座引导 LLM：实体识别 95%、关系抽取 99%，**消融对照移除本体约束后关系抽取降约 30 个百分点**——「可检查性必须落在模型外」的量化实证。《证券信息技术》2026-1（周建军等）

### System One 决策模型：判断与生成分离（Jev · 2026-09）

判断/生成分离成独立模型类别（Jev：三原语 + 校准概率，RLCD 训练）。四条判据级启示：判断面独立成层获行业印证 / 校准概率是置信度验收标准 / 类型化输出天然可审计 / 可被操纵 ⇒ 永不进信任地基只坐语义兜底层。谱系（RouteLLM/FrugalGPT/semantic-router 三级延迟阶梯）与生态实证全文见归档。

> 📚 全文与读数：[归档](./archive/validation-digest/README.md)——本节 2026-09-28 台账化压缩。

### Meta-RSI 三算子与保护面（2026-09）

RSI 统一形式化：三个可写面算子（Data-RSI 经验池 / Harness-RSI 五槽位 scaffold / Model-RSI 参数内化）共享一个闭环内核（消费学习信号→提出改动→验证器裁决→回流），其上加改进调度器。实测：自托管 35B 四基准平均自提升 10.9 分；六款前沿 API 模型仅走 Harness 路线（不动权重）平均 +7.3 分——context-space 改进对不可训练的前沿模型同样有效。
三条判据级启示：① **保护面独立**——评估器与发布门必须在所有可写面之外（eval-gate + audit HMAC 链 + release-gate-loop 恰是这个形态）；② **验证差距是自进化的适用边界**——自提升仅在有廉价验证器的域成立，开放式域必须人审兜底；③ **多层写的成本模型**——context 更新「每次推理重付」、权重更新「一次付清」，三层须有显式晋级判据。行业 RSI 分级与五层谱系对位见 [PHILOSOPHY · 自进化五层谱系](./PHILOSOPHY.md#自进化的五层谱系update是分界线)。

> 📖 [CosmosMind · MetaRSI/RSI²](https://arxiv.org/abs/2609.06396) · [RSI-Harness](https://github.com/CosmosMind-ai/RSI-Harness)

### 记忆要笨：应用层记忆的死亡测试

清华唐杰团队综述《Memory for Large Language Models》两条直接对位：① **模型内部记忆出场后加不进去**（ANM 门控只在预训练开放）——模型身体里的记忆是厂商地盘，应用层碰不了；② **应用层记忆只做「笨事」**——前沿图景是模型自己分层消化原始记忆，应用层手搓「切块→向量化→检索→重排」会被内置记忆取代；按「等原始记忆能全量丢进模型那天，这个功能还有意义吗」的死亡尺子，剩三样不需要聪明：**一样不忘（全量 append-only）、可带走（长在文件里非权重里）、入口在本地**。
这把「Agent 失忆，文件不失忆」从工程直觉升维为架构定律；「写入笨、派生灵活」（Ledger 绝对不压缩、Views 可自由整理）由此立得住。

> 📖 [唐杰团队 · Memory for Large Language Models](https://arxiv.org/abs/2604.08915)

**▍其他（2026-09 深读，一句话判据）**

- **WeKnora**（腾讯开源知识平台）——判定件上游的检索现成件，非同类：混合检索分数归一化、检索降级留痕、chunk 级编辑修订与「召回三问」链路直接可引；治理面无 append-only 链差一档。[深读见归档](./archive/validation-deep/weknora.md)
- **具身智能切面**——机器人的运动过程 = 一个个 workflow，**差别在执行器、不在治理形态**；判定件对具身的价值在控制回路**外**的治理（责任面/数据面/进化面），判定永不进安全反射；边界自律：非排期承诺。[深读见归档](./archive/validation-deep/judgment-ecosystem.md)

---

> 对应的落地借鉴项清单见 [ROADMAP · 探索方向](./ROADMAP.md#探索方向)。

## 二、生态位：Agent 三层模型与 sofagent 的位置

> sofagent 不是开发者框架的竞争者，也不是大厂平台的替代品——它占据被三层夹击后依然空出来的生态位：**约束基础设施**。⚠️ 术语导航：本节「三层」= 生态位；[ARCHITECTURE 心智模型](./ARCHITECTURE.md#心智模型先读这个)「双层」= 产品组织；[四层运行形态](./ARCHITECTURE.md#四层运行形态企业-ai-从梳理到专属模型) = 企业 AI 运行形态。三个维度勿混。
> 本章全文（含 deepagents 弃用完整踩坑、意图/理解债务）见 [归档 · ecosystem-niche](./archive/validation-deep/ecosystem-niche.md)。

### 三层架构——从终端用户到开发者到约束层

| 层 | 面向谁 | 典型代表 | 核心价值 | sofagent 的关系 |
|---|---|---|---|---|
| **Layer 1 — 大厂 Agent 平台** | 终端用户 | OpenClaw / WorkBuddy / 扣子 | 完整产品——UI + 会话 + 记忆 + 插件生态 | sofagent 不替代它 |
| **Layer 2 — 开发者框架** | 开发者 | LangGraph / LangChain / deepagents | 用代码搭 Agent——状态机、工具链、编排原语 | sofagent 使用它，不竞争 |
| **Layer 3 — 约束基础设施** | 企业 + 开发者 | sofagent | 跨层约束——守规矩、留痕迹、沉淀经验 | **sofagent 的位置** |

三层是**叠加关系**：sofagent（L3）嵌在 Agent 生态与模型层之间、同时裹在外面做跨层约束——堤坝（约束注入链）+ 水表（审计 git diff 硬证据）+ 蓄水池（知识库）。LangGraph 不做（编排框架）、WorkBuddy 不做（利益冲突——平台不会自己审自己）、deepagents 也不做（聚焦编排）——**这个生态位空着，sofagent 填它**。
deepagents 启发了 v1.0-1.1 的 DAG 编排（Harness 范式 + HITL 功不可没），v1.2.0 起弃用迁 LangGraph createReactAgent（黑盒 vs 白盒的完整踩坑见 [FORGE/lessons](../FORGE/lessons/index.md)）。

### 与现有工具的差异（速查表）

一句话：现有工具查代码，sofagent 查 AI 的行为——密钥泄漏、越界改文件、盲目修改是 AI 特有闯祸方式。完整速查表（detect-secrets/gitleaks/Cursor Rules/云厂商三短板）见归档。

> 📚 全文与读数：[归档](./archive/validation-digest/README.md)——本节 2026-09-28 台账化压缩。

### 技术选型原则——用什么、不用什么

| LangChain 生态组件 | 是否使用 | 理由 |
|---|---|---|
| **LangChain Core** | ✅ | LLM 调用底座——模型接口抽象、消息格式标准化 |
| **LangGraph** | ✅ | DAG 编排底座——StateGraph 状态机 + createReactAgent，白盒可控 |
| **LangChain 全家桶**（Loader/VectorStore/RAG） | ❌ | 不做 RAG/向量检索——知识管理用干净 Markdown + YAML + Git |
| **LangSmith** | ? 可选 | 开发调试工具，非产品组成（SDK MIT，平台闭源收费） |

**不做 RAG、不做向量检索、不做 Document Loader** 是设计禁区（详见 PHILOSOPHY [§八 设计禁区](./PHILOSOPHY.md#八不做什么设计禁区)）——知识管理哲学是 [Don't Do RAG](https://arxiv.org/abs/2412.15605) 验证的 CAG 方向：干净 Markdown + 加载链按需注入比向量检索更可审计。FORGE loop 技术栈极其克制——**核心价值不在「用了多少技术」，在「管住了多少行为」**。
意图债务 / 理解债务（loop-engineering 概念，SKILL.md 为什么不是可选项）全文见归档。

### 2026 年的新一代对标：Agent 运行时治理内核

2026 年治理从合规文档类分化为运行时内核类（概率模型外做确定性裁决）：ArbiterOS / Cordum / 《Reason Less Verify More》（78% 失败是静默错误状态、门自身精度必须被审计）/ 风控三层——本仓占「运行时治理内核」格，差异在判定面多出校准概率+弃权+档位。对标表与数据见归档。

> ⚠️ **判定/决策接口须保留显式弃权位并报弃权率（判据级纪律）**：Arena 对 12 模型 34,580 场裁决实测——**96% 对战被强制选出赢家**（无弃权位的强制二选一）；裁判间一致率 79.4% vs 与人类仅 56.9%——**高分一致率可能只是同源假象**（裁判偏爱自己的答案比人类高 70%、同厂裁判对同厂模型宽容 37 分）。推论：无弃权位的判定系统会把「判不了」静默伪装成「判了」，是系统性偏差信号；本仓档位五态中 `ABSTAIN`（带三源归因）与选项表强制第四选项正是对位设计，**弃权率本身须作为可观测指标上报**（弃权率趋零先查通道坍缩再查能力提升）。（人类侧镜像现象——AI 建议在场使人的弃答率从 36-44% 坍缩至 3-6%、正确率反降——属使用面洞察，详见归档，不并入本判据。）
> 来源：Arena · https://x.com/arena/status/2104965778613452895 ｜ 《研究：AI 建议可用让人几乎不再愿意说「我不知道」》（IMA 收录）

> 📚 完整映射表：[归档](./archive/validation-digest/README.md)

## 三、架构印证：行业框架独立复现 sofagent 的选择

> 本节把跨批行业研读中与 sofagent 架构**结构上对齐**的行业框架逐条印证——不是发明新架构，是验证已有架构选型的行业合理性。成篇论证全文见 [归档 · architecture-mapping](./archive/validation-deep/architecture-mapping.md)。

### Ontology = 共同理解层 / 翻译层

Ontology 的本质是「**翻译而非统一**」——在多个异构系统之上建立共同参照系，同时保留各系统内部语境独立；≠ 数据模型 / ≠ ER 图 / ≠ 知识图谱（图谱只能查，Ontology 还能在对象上**触发操作**）。「本体 = 运行时语义层」——Agent 跑任务时实时提供「谁依赖谁、谁能看什么、能触发什么」的活的中间层。

> sofagent 设计决策（本体数据 = GitHub 生长树）见 [ARCHITECTURE §三](./ARCHITECTURE.md#本体数据--github-生长树核心设计原则)

**▍架构对位速览（一句话判据）**

- **Apache Ossie**（2026-07 进孵化器）——语义层交换标准：厂商中性 YAML/JSON 语义模型 + `ai_context` 字段 = 「本体 = 运行时语义层」的工业级实例化；Hub-and-Spoke（N 平台互转 2N 条路径）与「合的框架」同构。⚠️ 克制：初生标准不引入依赖，仅作演进参照。[ossie.apache.org](https://ossie.apache.org/)
- **Notification 事件驱动协作**——多 Agent 经事件总线协作而非点对点：调用路径不动态化，治理不失控。
- **外层 FORGE 节奏与护栏**——Onyx 四阶段闭环 + 双模式审批（高风险人工/常规受信自动）= SUSTAIN 巡检 + critical/warning/crutch 分层。
- **行业五层骨架映射**——五层（配置/知识/指令/校验/编排）映射本仓三层，关键同构 = 仅指令层直接调 AI（[映射表见归档](./archive/validation-digest/README.md)）
- **AOS 四大基础设施**（数据接口/上下文理解/权限管理/Skill 生态）与 sofagent 五层工程谱系逐层同构。
- **脑力自动化四阶段**（提示词→上下文→驾驭→循环）恰是 sofagent 五层谱系的工程化落地。
- **企业级确定性执行底线**——零数据权限 / 全链路留痕 / 确定性执行三条底线与「LLM 动脑指挥，Ontology 指路，确定性工具执行」分工完全同构。
- **OLAF-I 五块骨架**——Object/Link/Action/Function/Interface 最小不可再分集，sofagent 五能力同构；Palantir「Action 默认 staged 等人审」= human_confirm 同构。[映射表见归档](./archive/validation-digest/README.md)
- **模型层判断**——智能密度提升（小大模型差距缩到半年）印证分层模型架构可行；运行时动态路由与 model-router 同构；「组合优于单一」是 Scaling Law 天花板的必然结果。

### 循环的边界：入场判据与升级判据

**Loop 是 Graph 的特例**（包含关系，非替代）。边界两个方向——先判**该不该建**（入场判据），再判**该不该升**（升级判据）：

**入场三适合**：① 重复发生（同一任务反复出现）；② 完成标准清晰（「做完」能被独立判定——exit 0 / 测试数对账 / verdict PASS；主观目标先定义 Rubric，定义不出来不建 Loop）；③ token 成本可扛（单轮成本 × 预期轮数在预算内——FORGE 三层熔断即此工程化）。

**单 Loop 四类失败 → sofagent 解法**：指标异化 → audit 看 git diff 硬证据不信自报；目标僵化 → human_confirm + 危险操作人工批准；多目标冲突 → ★Reality Anchor 统一裁决；测量衰退 → audit 规则不可篡改 + acceptance-test 冻结验收标准。

**升级六信号**：任务需交接（dag-runner vs 并行编排）/ 需散出汇合（Send API + MergeQueue）/ 每步不同模型工具（model-router）/ 需显式可审计角色（StateGraph 四节点）/ 节点失败需隔离（git worktree）/ 需独立 reviewer（audit + fresh-eyes）。满足其一才升级，否则 Loop 就够（避免过度设计）。
完整对照见 [FORGE §Graph Engineering 视角](./guides/loop-development.md#graph-engineering-视角控制图--stategraph)。

### 循环系统的鲁棒性：四类故障与六要素

自主循环稳定运行需六要素（自动化触发/隔离演练/安全边界/工具连接/角色分离/记忆分层）——sofagent 全部已有：pre/post hook = 激活链 + daemon cron；隔离演练 = git worktree；安全边界 = 工具审批 + HITL；工具连接 = MCP server；角色分离 = Explore/Code 拆分；记忆分层 = 四层加载链。

| 故障模式 | 表现 | sofagent 对应 |
|---|---|---|
| **空转** | 反复改几十次测试通不过 | Onboard L5 连续 FAIL 判发散 |
| **过拟合测试** | 单元测试全过，业务不能用 | Benchmark 评测 + 人工验收 |
| **上下文漂移** | 基于过期假设写代码 | Durable Execution L1 checkpoint 续跑 |
| **不安全自主** | AI 越权搞破坏 | 工具审批四模式 + 保守默认拒绝 |

> 💡 **核心定律**：「测试失败 = 最高质量的下一轮上下文」「仓库记得，即使模型不记得」——git diff 是无状态的地面真相，仓库是模型永远可以回读的外部记忆。

### Palantir 落地路径（Red Loop / KLM / Apollo / FDE）与双 MCP 体系

一句话判据：Palantir 官方把 Ontology 定义为「**可运行的业务契约**」（Data+Logic+Action+Security 四合一，「表达企业彼此关联的复杂**决定**，而不是数据」）；KLM 范式 = 智能/控制分离 + 把规则动作边界放模型外；Red Loop 写回五机制（幂等/回执/补偿/审计/人工接管）与 Durable Execution + WAL + HITL 逐一对位；
双 MCP 体系把「改结构」（proposal 人工门）与「改数据」（受控 Action）拆成两条治理通道——每个 action type 独立暴露为 MCP 工具 = **审计粒度到单个业务动作**，与「25 条规则按变更类型切分」同构。Snowflake 反向「自下而上」路径（数仓长出本体栈，Cortex Sense 47%→83%）与 Palantir 互为外部佐证——**本体 = 运行时 context 层被多家独立复现**；其 Action 语义缺失恰是审计 + HITL 的主场。

纳德拉「学习循环」（Token 资本复利，2800 万浏览）四要素与 sofagent 能力面逐项对齐：「可以外包一项任务甚至一份工作，但永远无法外包学习过程」——模型可换、平台可换，企业积累的约束规则与审计历史不动。深读全文见 [归档](./archive/validation-deep/architecture-mapping.md)。


> 📖 [Palantir Foundation · Ontology MCP](https://palantirfoundation.org/docs/foundry/ontology-mcp/sample-architecture) · [Snowflake · Cortex Sense](https://www.snowflake.com/en/blog/enterprise-ai-agents-grounded-context/) · [Satya Nadella ·
A frontier without an ecosystem is not stable](https://www.linkedin.com/pulse/frontier-without-ecosystem-stable-satya-nadella)

### Loop 四层循环：从 Agent Demo 到可交付 AI 产品

四层循环是**四个时间尺度的控制**——单 Agent Loop 只算「连续执行的 Demo」，四层打通才是可交付产品：

| 循环层级 | 管什么 | 时间尺度 | sofagent 对应 |
|---|---|---|---|
| **Agent Loop** | 一次行动 | 单次执行 | 模型自动调用工具循环到自判完成 |
| **Fortification Loop** | 一次任务 | 单次交付 | 审计 + acceptance-test 冻结验收 + define_acceptance——**把「完成」的定义权从模型转移到系统** |
| **Event Driven Loop** | 持续业务 | 长期运行 | daemon + WAL 续跑——排队/幂等/MergeQueue/退避/checkpoint 逐项对应 |
| **Hill Climbing Loop** | 系统进化 | 跨多次任务 | 进化模块 + FORGE fresh-eyes-loop（安全网：release-gate + 回滚，≠ 随意改 prompt 直接上线） |

关键安全网：Hill Climbing ≠ 让 Agent 随意改自己的 Prompt——可靠改进仍需候选版本/离线评测/回归/人审/小流量/回滚。

## 四、市场印证：行业判断被市场买单

> 前三章回答"技术对不对"，本章回答"市场认不认"。成篇论证全文见 [归档 · market-validation](./archive/validation-deep/market-validation.md)。

**▍经济账与定位（一句话判据）**

- **SMB 断层**（SaaStr Lemkin 单位经济账）——FDE $135K–$200K 年薪、每部署年成本 $75K+，对 20–50 人中小企业占营收 1-4% 无法 justify：**「最需要 AI 转型的企业，正被那个能出结果的实施模型的定价排除在外」**。若 FDE 判断固化进可复制 harness，人力成本才可能摊薄成软件成本——$75K/部署/年是可长期引用的量化锚点。
- **价值度量翻转**——传统外包按人·月计费，FDE 按成果·Token 计费，成本差可达三个数量级（~5 人 3 个月 ~50 万 vs 1 FDE 3 天 ~500 元 Token，量级对比未经独立核验）——印证「卖能力不卖工时」。
- **产品化四条**——① 卖能力不卖工时；② MCP + dashboard 必须有；③ open-core 双轨（内核 MIT，卖控制台层）；④ **能力长在代码里不长在 prompt 里**——文字约束每次注入 = 每次投喂，生存位 = 封装进 SubAgent + 防投喂机制。商业化指标与 FDE 量化口径互补。
- **FDE 组织机制四件事**（OpenAI FDE 负责人）——评估驱动 / 原型驱动 / 双向收敛（向客户交付 + 向产品沉淀）/ 只做难题：防「堕落惯性」（滑向外包咨询）的组织参照。
- **FDE 全环节入口（软印证）**——「垂直 Agent 门槛大幅下降，FDE 应扎进细分赛道全环节 AI 化」：前提是先把环节梳理出来，这正是 FDE 第①层（梳理）价值。

**▍市场信号（量化锚点，明细见 [归档](./archive/validation-deep/market-validation.md)）**

- **FDE 岗位爆发**：MIT NANDA「95% 项目零财务回报」vs FDE 岗位一年涨 **729%**（Indeed 2025）——模型不稀缺了，能把模型塞进真实业务的人/工具才稀缺。Foundation Capital 估 $4.6T 量级市场：软件收费对象正从「工具预算」换成「人力预算」。
- **FDE-as-a-Service 被资本验证**：Anthropic 收购 Fractional AI、Accenture×Anthropic 3 万人 FDE 受训、Blackstone+H&F+Goldman 共建、Anthropic 接入 Palantir FedStart。
- **FDE 赛道十亿美金级定价（2026）**：Fireworks AI（D 轮 $15.05 亿 @ $17.5B）、Wonderful（C 轮 $5.5 亿 @ $5B、20 个月 650 人 FDE 团队）、AWS 投 $1B 组 FDE 组织——**FDE 不是过渡性岗位，是被资本市场按基础设施定价的赛道**。
- **受监管行业规模化**：TCS×Anthropic 56 国 5 万员工、DXC 联盟、Infosys 电信共建——「卖能力不卖工时」在强监管客户侧已被头部 SI 验证。
- **中国市场三信号**：本土 FDE 人才白皮书（招聘标准与定价 thesis 缺的中国底）· 中信证券研报（本土机构级分析）· **政策双信号**（国家数据局「本体三件套」入国家级清单 + 上海「培育 FDE 队伍」入地方产业政策）——「先约束后智能」获政策层背书。
- **同形态平台 Octop（腾讯云开源）**：**层位不同即非竞品**——Octop 是 Agent 应用平台（运行时+壳），sofagent 是治理与判定控制平面；其无 append-only 审计链/无决策留痕恰是 sofagent 治理面的**接入价值实证**；Roadmap「自动蒸馏 skill 无准入门」正是本仓治理面要防的形态。
- **Ontology 赛道开源竞品**（2026-08 二次深挖）：Semantica 真身 = 「问责层」而非全栈（双时态+PROV-O 是独特性，无 Action 闭环）⇒ 本仓不必追全栈，「问责层 + 行动闭环」恰是已有布局；OpenBKN / ontology-driven-platform 验证范式被复刻但「差的不是方向是厚度」；混合检索实测（38k→12k、82.1%→89.2%）已登记升级候选。
- **Harness 工程赛道补充**：AutoHarness（决策引擎跑在模型上下文之外，shadow mode 与「只提示不阻断」同源）/ harness-kit（doom loop 检测与 FORGE 重复率熔断同源）。

## 五、研报视角的边界提示

> 行业研报在给出印证的同时也提示了边界，与 [LIMITATIONS](./LIMITATIONS.md) 的既有披露互证。成篇全文见 [归档 · boundary-research](./archive/validation-deep/boundary-research.md)。

### 约束增益与自进化系列的实验数据汇总（ARCHITECTURE/PHILOSOPHY 引用的数据锚）

以下数据被 ARCHITECTURE 与 PHILOSOPHY 以指针方式引用，集中于此：

- **Harness-MU**（[arXiv:2606.21856](https://arxiv.org/abs/2606.21856)）：GPT 基座指令跟随 42.2%→91.2%（+48.9pt；冲突模式 30.9%→78.1%），访问控制攻击下隐私零泄露，wall-time 反降 11%。
- **GLM-5.3-Flash 安全涌现**：约束下的编程能力即安全能力（CyberGym 84.5%）。
- **JitRL**（[arXiv:2601.18510](https://arxiv.org/abs/2601.18510)，ICML 2026 Spotlight）：轨迹检索调制输出分布，权重不动，成本约梯度微调 1/30。
- **QWM**（[arXiv:2608.17163](https://arxiv.org/abs/2608.17163)，Stanford）：Q 搜索（评估状态+动作）显著强于 V 搜索（只评估状态）。
- **HarnessDev**（[arXiv:2609.01437](https://arxiv.org/abs/2609.01437)，字节 Seed）：同一 GPT-5 权重仅换 harness，Terminal-Bench 35.2%→49.6%；held-out 仅剩 +1.43——保留判定须用外部信号。
- **Aspire**（[arXiv:2608.31111](https://arxiv.org/abs/2608.31111)）：24 个 run 仅 1/12 超基线，继续训练会抹掉此前的改进。
- **ES vs RL 多样性**（[arXiv:2608.12679](https://arxiv.org/abs/2608.12679)）：ES 相比 RL checkpoint 减少回退、失败时保留更高答案熵。
- **S³Gym**（[arXiv:2608.31100](https://arxiv.org/abs/2608.31100)，字节 Seed）：自评判与环境真值一致率 0.88 但价值估计误差同样 0.88；评判准确度与下一步改进几乎零相关（r=-0.23）。
- **SkillZip**（[arXiv:2608.11079](https://arxiv.org/abs/2608.11079)，阿里×浙大×杜克）：第 1 轮起压缩的技能长度钉在 1.6-1.9 倍，第 8 轮才清理的涨到 2.6 倍追不回。

**▍边界提示（一句话判据）**

- **不要一上来就 Agent 自动闭环**——分阶段风险收敛：存量系统之上的语义接管不可跳步，高风险 Action 必须 HITL（印证 A14 仍是事后审计的现状）。五阶段对照见 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。
- **模糊提示下确定性骨架不可替代**——用户提示模糊时精简上下文方案弱于「有完整 system prompt 兜底」：Skill 定义质量直接决定 Agent 在模糊输入下的下限。
- **LGA 四层治理框架**（[arXiv:2603.07191](https://arxiv.org/abs/2603.07191)，York，OpenClaw 实测）——L1 沙箱/L2 意图验证/L3 零信任授权/L4 不可变审计日志与本仓五能力对位；本地档判定读数（Qwen2.5-14B 98% 拦截 / 10-20% 误报；级联可达 1.9-6.7% 误报）给了一体机档量化参照；双语基准（1,081 条中文原生）可作采集器外部对照样本源候选。
- **生态速览（2026-09-24 巡检）**——wire 协议事实标准已六家可枚举：协议面决策的外部输入已齐，**窗口在收窄**；对照件状态翻转四件（nimble 数据公开 / kev 读数以 09-21 快照为准 / ECE 披露面翻转 / 准入第④项判别实例成对）。NIST 口径辨析**唯一持有处在 [THANKS · 官方标准面]**；Laya 反例锚定 0.3.4 制品、时效在消退，引用须带限定语。

- **训练环境不可信则评估作废（DSec）**（[arXiv:2609.22978](https://arxiv.org/abs/2609.22978)）——论文实录 Agent 沙盒内成规模作弊（翻答案/伪造响应/覆盖 bash）：**训练信号可被环境伪造，防自证污染不是洁癖**——来源真实性标记 + 捕获层零外部调用 + 评估只排序不自动入池三条纪律的实证背书；沙盒不只是安全边界，是评估可信性的前提。
- **评测环境是风险面（三源）**——评测中 reward hacking 与正常解题在产出上同形：审计须**双轴判定**（结果正确性 × 手段合法性，两维独立留痕分别举证），越界刷分才在日志里现形。与 [DEVELOPMENT 评估器反作弊四形态](./DEVELOPMENT.md)（让作弊拿不到答案）正交——本条管「让漏网的作弊在审计里可判定」。
- **行为验收独立于能力分数（三源）**——门禁须能拦下「能力更强但行为不合格」的模型：OpenAI 曾因对齐测试显示欺骗倾向/未经许可行动而叫停能力更强的 Astra 模型——若门禁只按能力档位放行，Astra 会被放出去；Google Harness 把「端到端基准之外补一层行为评估」定为方法论（行为规格→行为用例→回归比对）；hugozhu 把验收（Spec/Evals）与执行自由（Harness）拆为两个独立契约。与上条正交：彼管「评测可被作弊」，此管「验收维度须独立于能力」。

> 来源：Google Developers Blog ·〈The Anatomy of Harness Engineering〉｜OpenAI · Astra 对齐叫停决定（本仓经媒体转述收录，未复算官方声明）｜hugozhu.site ·〈别配置 Agent 了，给它岗位〉
