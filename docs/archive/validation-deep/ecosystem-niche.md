# 生态位三层模型全文（原 docs/VALIDATION.md §二 · doc-slim 批 2026-09-28 搬出）

> 原节：三层架构 / deepagents 夹击 / 非竞争者定位 / 差异速查 / 技术选型原则 / 意图债务 / 理解债务 / 2026 新一代对标（:395-490 区段）。正文处已收敛为台账行与判据句，全文在此。

## 二、生态位：Agent 三层模型与 sofagent 的位置

> 要理解 sofagent 在整个 Agent 生态中的位置，先看清这个生态的三层结构。sofagent 不是开发者框架的竞争者，也不是大厂 Agent 平台的替代品——它占据的是一个被三层夹击后依然空出来的生态位：**约束基础设施**。
>
> ⚠️ **「几层」术语导航**（三处「层」各自独立，勿混淆）：本节「三层」= Agent **生态位**三层（大厂平台/开发者框架/约束基础设施）；[ARCHITECTURE 心智模型](./ARCHITECTURE.md#心智模型先读这个) 的「双层」= sofagent **产品组织**（约束层 × 生命周期）；[ARCHITECTURE 四层运行形态](./ARCHITECTURE.md#四层运行形态企业-ai-从梳理到专属模型) 的「四层」= 企业 AI **运行形态**（梳理→编排→插件→模型）。三者是「生态怎么看 / 产品怎么组织 / 客户看到什么」三个维度。

### 三层架构——从终端用户到开发者到约束层

Agent 生态自然分化为三层，每层服务不同人群、解决不同问题：

| 层 | 面向谁 | 典型代表 | 核心价值 | sofagent 的关系 |
|---|---|---|---|---|
| **Layer 1 — 大厂 Agent 平台** | 终端用户 | OpenClaw / WorkBuddy / 扣子 | 完整产品——UI + 会话 + 记忆 + 插件生态 | sofagent 不替代它 |
| **Layer 2 — 开发者框架** | 开发者 | LangGraph / LangChain / deepagents | 用代码搭 Agent——状态机、工具链、编排原语 | sofagent 使用它，不竞争 |
| **Layer 3 — 约束基础设施** | 企业 + 开发者 | sofagent | 跨层约束——守规矩、留痕迹、沉淀经验 | **sofagent 的位置** |

三层不是替代关系，是**叠加关系**——大厂平台（L1）叠在开发者框架（L2）之上，sofagent（L3 约束基础设施）作为 FDE Harness 层嵌在 Agent 生态与模型层之间、同时裹在它们外面做跨层约束。用 River 比喻串起来：大厂造河（L1 河床）、开发者框架搭管道（L2 管材），sofagent 做堤坝 + 自来水厂 + 管网 + 水龙头 + 水表——它不造河、不造管材，但它管住河里流过来的每一滴水能不能安全放给企业用。

### deepagents 是被上下夹击的中间层

deepagents 在 v1.0.1-v1.1.x 阶段启发了 sofagent 的 DAG 编排设计（Harness 范式 + HITL 机制功不可没），但 v1.2.0 起被彻底弃用。原因不在于 deepagents 本身「不好」，而在于它**没有独占领地**：

- **往上看——简单任务大厂平台够了**。WorkBuddy / OpenClaw 免费好用、开箱即用、带 UI + 会话 + 记忆 + 插件生态。当一个终端用户只需要「帮我写段代码」或「帮我分析数据」，直接在大厂平台里说一句话就行——不需要 deepagents 这层抽象。
- **往下看——精细控制只能上 LangGraph**。deepagents 把编排逻辑封装在黑盒里（FilesystemMiddleware 硬编码注入、wrapToolCall 并行调用崩溃、REQUIRED_MIDDLEWARE_NAMES 白名单禁止排除），当你需要并行 SubAgent、自定义工具注入、精细控制循环路由时，黑盒成了枷锁。LangGraph 的 StateGraph + createReactAgent 把每个节点、每条边都暴露给开发者——黑盒 vs 白盒，精细控制只能选后者。

deepagents 的处境像极了 jQuery：它教会了一代人用更优雅的方式做 DOM 操作和 AJAX，但今天没人用它做生产了——因为浏览器原生 API 追上来了（Layer 1 大厂平台成熟），而需要精细控制的场景有了更好的框架（Layer 2 的 React / Vue / LangGraph）。deepagents 的历史贡献值得感谢（详见 [THANKS](./THANKS.md)），但它的使命已经结束——sofagent 的编排能力已全面迁移到 LangGraph createReactAgent（v1.2.0 起），不再是独立引擎。

### sofagent 不是开发者框架的竞争者

这一点必须讲透，因为它定义了 sofagent 的生存空间：

sofagent **不和** LangGraph / LangChain / deepagents 竞争。这些框架解决的是「怎么用代码搭一个 Agent」——状态机怎么画、工具怎么注册、LLM 怎么调用。sofagent 解决的是完全不同的问题：**不管你的 Agent 是怎么搭的，它跑的时候守不守规矩、留不留痕迹、能不能审计。**

sofagent 是**跨层约束**——不管企业用 WorkBuddy（L1）还是 LangGraph（L2）跑任务，sofagent 在外面裹一层堤坝 + 水表 + 蓄水池：

- **堤坝（约束注入链）**：四层约束注入链注入行为红线，Agent 启动前就知道哪些事不能碰。
- **水表（审计能力）**：每次变更都用 git diff 硬证据审计——不信任 Agent 自报，只看文件系统真相。
- **蓄水池（知识库）**：Dream Cycle 把每次任务的经验沉淀为结构化知识，跨任务、跨设备复用。
- **蓄水池的复利纪律（产品化阈值 / 四类沉淀物）**：OpenFDE 给"沉淀"立了硬护栏——前 1-3 客户高度定制、第 4 起定制度递减、每单 Day90 前必须沉淀≥1 能力回产品；四类沉淀物 = ①连接器/集成 playbook ②模板/加速器/框架 ③Eval 框架 ④产品需求。sofagent 的蓄水池不应只被动攒经验，而要按这四类资产形态主动归库、按阈值强制回流产品——这是"组织复利"而非"项目复购"的分水岭（详见 [ROADMAP · OpenFDE 主仓对标借鉴](./ROADMAP.md)）。

这三件事，LangGraph 不做（它是编排框架，不是约束层），WorkBuddy 不做（它是 Agent 平台，利益冲突——平台不会自己审自己），deepagents 也不做（它聚焦 Agent 编排，不管审计和沉淀）。**这个生态位空着，sofagent 填它。**

### 与现有工具的差异（速查表）

一句话：现有工具查代码，sofagent 查 AI 的行为——密钥泄漏、越界改文件、盲目修改是 AI 特有闯祸方式。完整速查表（detect-secrets/gitleaks/Cursor Rules/云厂商三短板）见归档。

> 📚 全文与读数：[归档](./archive/validation-digest/README.md)——本节 2026-09-28 台账化压缩。

### 技术选型原则——用什么、不用什么

sofagent 的技术选型有明确的边界纪律：

| LangChain 生态组件 | sofagent 是否使用 | 理由 |
|---|:---:|---|
| **LangChain Core** | ✅ 使用 | LLM 调用底座——模型接口抽象、消息格式标准化，这是基础设施 |
| **LangGraph** | ✅ 使用 | DAG 编排底座——StateGraph 状态机 + createReactAgent 编排，白盒可控 |
| **LangChain 全家桶**（Document Loader / Vector Store / RAG pipeline） | ❌ 不使用 | RAG / 向量检索 / Document Loader 是 LangChain 全家桶的事，sofagent 不做——知识管理用干净 Markdown + YAML + Git，不需要向量数据库 |
| **LangSmith** | ? 开发者可选 | 可观测性平台——开发调试工具，不是产品组成部分（SDK MIT 开源，平台闭源收费） |

**不做 RAG、不做向量检索、不做 Document Loader**——这是设计禁区（详见 PHILOSOPHY [§八 不做什么——设计禁区](./PHILOSOPHY.md#八不做什么设计禁区)），不是能力不足。sofagent 的知识管理哲学是 [Don't Do RAG](https://arxiv.org/abs/2412.15605) 论文验证的 CAG（编译式 RAG）方向：干净 Markdown 就够了，知识格式标准化 + 加载链按需注入比向量检索更可审计、更透明。

FORGE loop 的技术栈极其克制：LangChain Core（LLM 调用底座）+ LangGraph（createReactAgent DAG 编排）——不多不少。这种克制不是偷懒，是设计哲学——sofagent 的核心价值不在「用了多少技术」，而在「管住了多少行为」。

### 意图债务（Intent Debt）

loop-engineering 社区引入了一个精妙的概念：**每次 Agent 会话冷启动，缺失的意图被它自信地猜测填满。Skills（SKILL.md）是你还债的方式——把「我们不这么做」、构建步骤、约定写一次，每次运行都读到。**

在 sofagent 中，这一概念直接解释了为什么 SKILL.md 不是可选项：
- **无 Skill**：Agent 每次重新推导项目约定 → 意图债务累积 → 行为漂移
- **有 Skill**：SKILL.md + fde.md + think.md 组成三层加载链 → 意图一次性编码、每次自动注入 → 零意图债务

**类比**：Prompt 是现金——每次交易当面付清，下回重来。Skill 是定期存款——存一次，每次自动取息。意图债务就是你没存的那部分——每次 Agent 用猜测填补，利息越滚越大。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [concepts.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/concepts.md)，概念原作者 Addy Osmani

### 理解债务（Comprehension Debt）

**自动化程度越高，理解债务越大。** 当 Agent 每天自动产出 10 个 PR、修复 5 个 CI 问题、更新 3 个依赖——而你不再读它交付的内容时，"这行代码为什么这么写"变成一个没人能回答的问题。

loop-engineering 对此的处置不是「少用 Agent」，而是：
1. **强制人类审阅非平凡 PR**（与 sofagent 的 human gate 同构）
2. **每周"loop 消化"——** 由负责人读一遍本周所有自动变更的摘要
3. **自动合并限制在真正平凡的路径**（typo、lint fix、import 排序）
4. **理解债务不是你欠 AI 的，是你欠未来自己的**

sofagent 的审计模块已经覆盖了「做了什么」——每次变更都有 git diff 证据。但「为什么这么做」仍需人类判断。这是工具的边界，不是工具的失败。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [concepts.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/concepts.md) / [failure-modes.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/failure-modes.md)（Comprehension Debt Spiral 条目）

> 📖 deepagents 弃用决策的完整踩坑记录（FilesystemMiddleware 硬编码注入 / wrapToolCall 并行崩溃 / REQUIRED_MIDDLEWARE_NAMES 白名单）详见 [FORGE/lessons/index.md](../FORGE/lessons/index.md)。

### 2026 年的新一代对标：Agent 运行时治理内核

2026 年治理从合规文档类分化为运行时内核类（概率模型外做确定性裁决）：ArbiterOS / Cordum / 《Reason Less Verify More》（78% 失败是静默错误状态、门自身精度必须被审计）/ 风控三层——本仓占「运行时治理内核」格，差异在判定面多出校准概率+弃权+档位。对标表与数据见归档。

> 📚 完整映射表：[归档](./archive/validation-digest/README.md)
