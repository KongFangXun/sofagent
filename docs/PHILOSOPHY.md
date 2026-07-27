# sofagent 设计哲学 · Philosophy

> **本文档是 sofagent 最核心的一份「为什么」。** 读完你能回答：sofagent 是什么、怎么用、怎么跑、怎么管、怎么记、怎么装、怎么进化、以及不做什么。
>
> v1.2.0 · 2026-07-26（UTC）· 孔放勋

<img src="assets/sofagent.png" alt="sofagent" width="160" />

## 目录

- [产品哲学（先读这三段）](#产品哲学先读这三段)
- [零、一句话](#零一句话)
- [一、这是什么——定位与边界](#一这是什么定位与边界)
- [二、怎么用——交互范式](#二怎么用交互范式)
- [三、怎么跑——架构全景](#三怎么跑架构全景)
- [四、怎么管——信任模型](#四怎么管信任模型)
- [五、怎么记——知识观](#五怎么记知识观)
- [六、怎么装——部署哲学](#六怎么装部署哲学)
- [七、怎么进化——FORGE 自迭代](#七怎么进化-forge-自迭代)
- [八、不做什么——设计禁区](#八不做什么设计禁区)
- [九、从哪开始](#九从哪开始)
- [十、行业方法论印证](./PHILOSOPHY.md#十行业方法论印证研究如何验证-sofagent-直觉2026-07-研读)

---

## 产品哲学（先读这三段）

**① AI 时代企业最大的痛：不是没有 AI，是有了 AI 不敢放手。**

Agent 越聪明，企业越不敢让它碰真活——真出事了，谁负责？能拦住吗？能回滚吗？大厂给你水（LLM）、给你河床（Agent 平台），但企业门口的那段管子——从"能喝"到"敢喝"——没人帮你接。

**② sofagent 的答案：一个常驻你企业的 FDE Agent，帮你把工作流梳理成 AI 节点，部署完它自己跑。**

sofagent 不替代大厂 Agent，而是建在它们之上——用 River 比喻说就是：做河的堤坝与约束层，不做河本身（详见 [README（项目概览）](../README.md)）。FDE 进场四阶段：梳理→挖掘→交付→离场。离场后 AI 节点自己跑。

**③ 底层引擎：sofagent 的 Harness 中间件保证每次变更可审计、可回滚、可进化。**

约束底座是骨架里的钢筋，审计引擎是质检——开发者才需要往下看。审计引擎零 token（纯正则，不调 LLM）；一底座·四引擎（约束底座 + 编排/审计/回溯/进化引擎）覆盖全生命周期。本文档以下十章讲的就是这套底层引擎的设计哲学。

---

## 零、一句话

**sofagent 没有图形界面。** 你通过电脑上已有的 Agent（WorkBuddy / Codex / Claude Code 等）或 IM（钉钉 / 飞书 / 企微）与它对话——说一句话，它做完了告诉你结果在哪。语言是界面，这也是 sofagent 与用户交互的核心方式。（产品化后会有一层**只读 dashboard** 给非技术买家看进度，详见 §六；但下令仍走语言。）

语言是界面。MCP 是通道。硬证据（git diff）是唯一的真相来源。

---

## 一、这是什么——定位与边界

### sofagent 管什么

提示工程管「说什么」，上下文工程管「知道什么」，约束工程管「跑在哪」。sofagent 管最后一步：**跑完谁验收。**

- 不是给 AI 写 SOP——SOP 保 60 分
- 是装缰绳——让 AI 在个性化上下文里跑出 85-90 分而不越界
- AI 是劳动力不是工具——产品设计是「管理 AI 的缰绳」

### sofagent 不管什么

OpenClaw/WorkBuddy 等大厂 Agent 平台管路由调度——「会不会做」。sofagent 管行为治理——「能不能每次都做对」。**Gateway 是高速公路，sofagent 是交规 + 测速摄像头 + 驾校教练。** 二者互补，不竞争。

### 为什么需要 sofagent——模型越强，Harness 越值钱

两个维度交叉印证同一结论：**sofagent 必须做平台/中间件，不能做外包/服务。**

**一条河的比喻**：大厂造河，我们做河的约束层——不做河，做河的堤坝 + 自来水厂 + 管网 + 水龙头（详见 [README（项目概览）](../README.md)）。这把「做平台/中间件、不做外包/服务」具象化。

**模型层**：强模型时代，人工工作流的边际收益从 30 分降到 5 分——甚至负收益（人工结构 = 设计者认知上限，限制模型找最优解）。历史规律反复验证：RAG 流水线被长上下文吃掉 → Prompt Chain 被 agentic 模型取代 → MoT Agent 编排被 sub-agent/plan 覆盖。但三件事的价值**反升**：上下文工程、可追踪验收标准、安全护栏（Harness）。转折点：从告诉 AI "怎么做"(How) → 定义 "做什么 + 做完的判定"(What + Done)。**通用模型越强，Harness 越值钱——这是 90%/10% 价值分层（知行合一框架见 §十）的外部验证。**

**商业层**：36 氪警示——盲目 Palantir 化是服务陷阱。Palantir 的护城河 = 平台优先（可复用原语）+ 主见 + 耐心资本。没核心平台只会沦为咨询/外包公司。sofagent 做的是审计标准中间件——独立、可审计、MIT 开源——不是穿西装的埃森哲。

**市场实证——垂直 Harness 才是护城河**：行业共识正形成——开源 Agent 自进化、大模型公司亲自下场做 Agent（如 Anthropic Claude Code）、大厂高速迭代，三股力量把"通用 Agent 能力"做成基础设施，**通用 Harness 正被模型公司吞噬**（与 §模型层「通用模型越强、通用 Harness 越不值钱」同频）。但离钱近的**垂直 Harness** 仍筑起深壁垒：法律 Agent **Harvey** 公开披露超 1 亿美元 ARR、服务 500+ 客户、42% 的 AmLaw 100 采用；客服 Agent **Sierra** 上线七季度破 1 亿美元 ARR——客户买的是"解决问题+完成服务"，不只调一次模型。这与 sofagent「不做通用平台、做细分业务 workflow 的可约束性」定位同频：护城河在垂直、在审计、在客户工作流，不在通用能力堆叠。

> 📖 来源：温故知新 2026-07-21（行业研读 · Harvey/Sierra 公开披露 + a16z Services-as-Software 论述 + 36氪 Palantir 化警示）

### 智能与控制分离——sofagent 的理论锚点

> Intelligence belongs to the model. Control belongs to the system.
> —— 行业对受控智能体引擎的共识判断

一句话：**模型负责理解，不负责执行；模型产出意图，不产出动作。** LLM 的核心价值是把模糊的自然语言翻译成结构化意图——意图识别、参数提取、歧义消解、结果转述。但"翻译官不应该有决策权"——确认、权限、状态流转这些需要确定性的控制，必须握在系统代码手里，不交给概率性的模型判断。

sofagent 的 Harness 中间件就是这条原则的工程实现：审计引擎（21 条确定性规则，只看 git diff）= "控制属于系统"；编排引擎（createReactAgent）= "智能属于模型"。模型负责理解任务、拆解步骤；代码负责验收结果、守住边界。这不是我们发明的理论——行业正在收敛到同一个判断：模型是变化最快的变量，真正应该保持稳定的是受控执行引擎。

> 📖 来源：受控智能体引擎设计实践（2026-07），核心理念「智能属于模型，控制属于系统」

### 为什么不封装成 Skill——大模型会吞噬文字形式的约束

有人会问：为什么不把 sofagent 的能力封装成 Skill（像 Claude Code Skills / Cursor Rules 那样）？因为**大模型会吞噬一切文字形式的约束**。

Skill、Prompt Engineering、Context Engineering，甚至以 Skill 形式做的 Harness Engineering——本质都是**文字形式的约束**。而文字形式的约束有一个致命属性：**每次注入到模型 = 每次投喂 = 每次训练**。模型会训练得越来越强，必然把文字形式的约束吸收进自身权重——今天的 Skill 是差异化优势，明天就是模型的内置能力。

sofagent 的生存位不在"写更聪明的约束文字"，而在**细分业务 workflow 上对业务最终结果的可约束性**——这个不会被模型吞噬。对策是把 Skill + Harness 能力**封装进 Subagent**（代码级实现，非文字注入）+ **防投喂机制**（防止输入素材变成大模型的训练材料）。让能力长在代码里，而不是长在 prompt 里——这是对抗"模型吞噬一切"的唯一姿势。

### 水龙头的进化——自带净水设备（本地业务专属小模型）

封装进 Subagent 解决了"约束不被文字吞噬"，但水龙头还能进化出第二层能力：**自带净水设备**——在 Subagent 里内置一个专精于该业务 workflow 的小模型。水龙头不造水（不做通用大模型），但它有自己的滤芯（业务专属小模型）：大厂 LLM 的原水过来，先过一道自己的业务处理，再放给具体业务用。

**实现机制（技术细节详见 DEVELOPMENT 文档）**：基于开源小基座挂业务适配器 QLoRA 精调（4-bit 量化基座 + 低秩适配器，不碰上游蒸馏 / 剪枝），本地小模型即可在消费级硬件上微调与推理，无需 GPU 集群。

**后训练视角（概念对齐）**：此处「QLoRA 精调」在学术分类上属于**领域后训练（domain post-training）**——即在开源小基座上做企业侧后训练，而非基模厂商发布前的通用后训练。后训练（post-training）是预训练之后让模型「有用 + 安全」的全部阶段（SFT / RLHF / DPO / GRPO…）的上位概念，精调 / 微调（fine-tuning）是其中一支；QLoRA 又属参数高效微调（PEFT）。行业共识趋势是「**预训练标准化、后训练个性化**」：基模商品化后，差异化发生在后训练层，企业把自身 workflow 数据做成领域后训练即护城河——这正是 sofagent「企业专属小模型战略必争」的判断依据。

- **两个商业动因（数据安全 + 成本，双痛点归一到同一方案）**：
  - **① 数据安全——数据出去了就回不来**：企业财务数据、客户隐私、合同条款、员工信息一旦走大厂 LLM API 处理，理论上就进了模型的训练管线。你无法知道三个月后，是否有人在另一个场景下，用巧妙的 prompt 诱导模型输出你曾经提交过的某条敏感信息。这是所有合规敏感行业（金融/医疗/政府/法律）不敢深度用 AI 的核心原因——不是 AI 不好用，是**数据出去了就回不来**。
  - **② 成本——自建大模型太贵**：私有化部署一套大模型，一台至少 4 张 A100/H100 的服务器（数百万起步，最新模型上千万）+ 持续运维 + 模型更新人力。对大多数中小企业，这根本不是选项。
  - **归一到同一方案**：workflow 专属精调小模型用可控成本换可控的数据安全——模型在本地跑，数据不出企业内网，零投喂；0.5B 小模型在 MacBook 甚至树莓派上都能跑，不需要 GPU 集群。领域够窄时，0.5B 在单一 workflow 准确率可追平 70B 通用模型。
- **默认小基座选型（业务 workflow 严格 ≤1B）**：中文业务 **Qwen2.5-0.5B** / 英文场景（外贸等）**Llama-3.2-1B**。中文、英文两类业务 workflow 用本地小模型，省钱、数据不出域。
- 🔴 **任务价值分流——代码/强推理直接用最好模型**：代码生成、复杂推理、多步规划这类"值得用最强智能"的高价值任务，用户明确**直接选用云端最强 LLM**（如 Claude / GPT / Gemini），**不强行本地化**。本地小模型只覆盖"可窄域替代"的业务 workflow 场景；私有部署优先铁律针对业务数据，不与高价值智能任务走云端冲突。云端大厂 LLM 在此类场景是**默认路径**（非 fallback）。

**结论——本地小模型可跑**：基于开源小基座 + **QLoRA 精调**（4-bit 量化基座 + 低秩适配器，比全参微调更轻，Mac Mini 上即可跑，适配器仅几 MB）+ 消费级硬件，业务专属小模型即可在本地微调与推理，无需 GPU 集群；多台设备的价值在推理并发节点，而非训练集群。整个项目对外保持纯 Node/TS 工作流（训练封装 Python、推理绑定 Node）。具体推理 / 训练框架详见 DEVELOPMENT 文档。

**四阶段路线**（详见 ROADMAP「Subagent 内置专精小模型」）：v1.2.x 架构预留（`inference` 字段支持 Ollama）→ v3.x 工具链（`sofagent-model` 微调 CLI）→ v4.x 本地推理（业务 workflow 跑精调模型；代码/强推理直连云端最强 LLM）→ v4.x+ 离线节点（USB key 完整离线 AI 节点，覆盖业务 workflow）。

### 为什么不建图形界面

LUI-first——语言就是界面。详见下一节。这个决策决定了 sofagent 的全部能力暴露方式：MCP 协议。

---

## 二、怎么用——交互范式

### 没有界面，对话就是一切

传统软件：图标 → 点击 → 表单 → 提交 → 等待结果
sofagent：说一句话 → MCP 调用 → 返回结果

| 铁律 | 说明 |
|------|------|
| 语言入口 | Agent 第一次连上 MCP server 时，`list_capabilities` 主动推送所有能力 |
| 零 GUI | 不建网页、面板、仪表盘。需要可视化时推送 Markdown 报告到 IM |
| 输出有家 | 每个工作流节点的输出有明确的 push target（飞书/钉钉/企微 Webhook、daemon 通知、联邦 knowledge/） |
| 降级优雅 | MCP 不可用时退到 CLI；IM 不可用时退到 daemon 通知 |

**推送机制**（`@sofagent/mcp` 内置）：
- Webhook → 飞书/钉钉/企微（审查报告、发版通知）
- OpenClaw IM channel → Agent 对话结果直接返回
- daemon 通知 → 知识库巡检异常、USB 配置完成

### 用户感知到的能力

Agent 连上来第一件事就是 `list_capabilities`，然后自己知道能调什么：
- 🤖 FORGE 自迭代——自动写代码、自动审、自动发版
- 📚 知识联邦——设备 A 踩的坑，设备 B 直接查
- 💿 USB 配置——说一句，写好的 U 盘插上就能用
- 🔐 安全加密——多设备通信全自动加密
- 📋 发版 SOP——从审查到 git tag 全自动

---

## 三、怎么跑——架构全景

### 一底座·四引擎治理闭环

Agent 不是装完就完事了——需要五个组件各管一摊。约束底座 + 四引擎（编排·审计·回溯·进化），形成闭环：

| 引擎 | 做什么 | 核心理念 |
|------|------|------|
| 🧭 约束底座 | 启动前注入红线（四层加载链） | 不知道红线就不会守——永远在线 |
| ⚙️ 编排引擎 | 大任务拆小、多 Agent 并行、A/B 对比 | 让 Agent 做擅长的事，串成一个闭环 |
| 🔍 审计引擎 | 每次变更自动扫描（git diff + 文件系统） | 不信任 Agent 自我报告，只看硬证据 |
| 🔄 回溯引擎 | 审计后自动 git snapshot，违规可回滚（本质：git snapshot + revert 包装） | 行车记录仪，不是安检——事后追责 |
| 🧬 进化引擎 | 周度巡检 + 自动优化（SkillOpt） | 部署完不是终点——约束本身也在进化 |

**演进视角：从「脑力自动化四阶段」看四引擎的来路**
孔老师把行业对「脑力自动化」的认知归纳为四个阶段——提示词自动化、上下文工程、驾驭（agent 自主执行）、循环自动化（自驱动迭代）。sofagent 的一底座·四引擎，正是对这四个阶段的逐层回应：审计引擎承接「提示词 / 规则」的确定性沉淀，编排引擎与约束底座承接「上下文工程 + 驾驭」的掌控执行，进化引擎承接「循环自动化」的自迭代闭环。底层不变的是约束底座——无论 AI 能力涨到哪一阶段，确定性边界始终由 Harness 兜住。这不是外部理论的移植，而是我们自己在做产品时反复验证过的演进逻辑。

**从 Prompt 到 Graph：五个尺度，一个系统**

行业对 AI 工程的理解经历了五次概念迭代——Prompt → Context → Harness → Loop → Graph。有人以为新概念淘汰旧概念，其实它们是**同一套系统的五个尺度**，每一层解决上一层的可靠性问题：

| 概念层 | 解决什么 | sofagent 对应 |
|--------|---------|--------------|
| **Prompt Engineering** | 怎么给模型下指令 | fde.md 的自然语言规则 |
| **Context Engineering** | 怎么管理模型的上下文 | 四层加载链 + knowledge/ 知识注入 |
| **Harness Engineering** | 怎么约束模型的行为 | **sofagent 整体**——约束 + 审计 + 回溯（核心价值层）|
| **Loop Engineering** | 怎么让任务自动循环收敛 | FORGE workflow 驱动（fresh-eyes-loop）|
| **Graph Engineering** | 怎么编排多个角色的协作 | v1.3.1 DAG 并行调度（控制图）|

sofagent 不做 Prompt（那是模型的事），在 Context 层有加载链，**核心价值在 Harness 层**（确定性边界），Loop/Graph 层是进化方向。模型越强，Harness 越值钱——因为 Agent 能做的事更多了，"做错了怎么办"的代价也更大。

### 地基与引擎：两层分离

| 层 | 是什么 | 何时激活 | 成本 |
|:--:|------|:--:|:--:|
| 地基 | 约束底座——四层加载链（SKILL.md（宪法） → fde.md（规范） → think.md（反思） → knowledge/（知识），联邦知识归属 knowledge/）| 每个会话启动 | ~3,500 token，不到 128K 窗口的 3% |
| 引擎 | 编排 + 审计 + 回溯 + 质评 + 进化 | 编排：任务拆分时；审计/回溯：每次变更自动；质评：闭环评分时；进化：周度 cron | daemon 常驻 + CLI 按需 |

地基是纯 MD 文件——Agent 读即生效，不依赖任何运行时平台。引擎通过 daemon 和 CLI 运作。

---

## 四、怎么管——信任模型

### 不看 Agent 说什么，看 git diff 留下什么

**Agent 是世上最会解释自己的人。** 问它「你改对了吗」，它会给你一篇条理清晰的自我辩护。所以 sofagent 不问 Agent——直接读 git diff。改了什么就是什么。

| 谁的证据 | 可信度 | 谁会伪造 |
|------|:--:|------|
| Agent 说「我改了 X」 | 🟡 | 梯度下降本能——找最低成本通过路径 |
| git diff | 🟢 | 无法伪造——diff 是文件系统真相 |
| think.md | 🟡 | 可能写空话填模板，所以不强制、不强校验 |
| 审计引擎 | 🟢 | 规则在代码里，非 Agent 可修改 |

这套证据链的根基是**一手信息**——git diff 是文件系统的原生输出，是 Agent 真实操作留下的原始痕迹，不依赖任何转述、摘要或自我报告。审计引擎只读一手 diff，不读 Agent 的「我改了 X」二手声明；任何 AI 产出都应能追溯到原始操作（哪次变更、哪行 diff），无法溯源的产出不进入证据链。

**模型越强，这套逻辑越重要。** 模型提升的是输出的说服力，不是诚实度——GPT-3 的胡话你一眼看穿，GPT-5 的胡话比真话还真。Agent 越能撒谎，外部硬证据越不可替代。审计引擎不看 Agent 说了什么，只看 git diff 留下了什么——这个原则随模型进化只会升值，不会贬值。

### Ralph 循环——「Agent 失忆，文件不失忆」

架构基因来自 Geoffrey Huntley 的 Ralph 循环：Agent 的记忆长在文件系统（git diff / task/logs / SKILL.md），不长在 Agent 内部。Agent 每次启动都是白纸——但它读到的文件，是上一次运行留下的完整经验。文件是持久证据，Agent 的记忆不是。

### 主体性护栏——执行可外包，判断不可外包

AI 可以无限接管执行（生成 / 修改 / 部署），但主体性与终裁权不可外包——审美判断、问题定义、价值排序这三类核心能力必须留在人类侧，否则人会逐步丧失主体性（「最舒服的状态是不再有自己观点」与认知投降同源）。

sofagent 用三条制度把「判断权不可外包」落成防线，与「反认知投降」同源：

| 护栏 | 做什么 | 守住什么 |
|------|------|------|
| fde.md 人类规则优先 | 业务底线由人类定义，Agent 不可覆盖 | 价值排序（人类侧）|
| 编排可回滚 | 任何变更可快照回退 | 执行试错不伤及主体地位 |
| 审计引擎独立验收 | 不信任 Agent 自我报告，只看 git diff 硬证据 | 问题定义与验收（人类侧）|

这把「人类终裁」从工程约束升维为**主体性护栏**：模型可以跑得远，但问题定义（SKILL.md 目标）、价值排序（fde.md 业务底线）、审美判断（人类验收）必须留在人类手里。

**循环锚点——人类终裁如何不被绕过。** 仅声明「判断权留在人类」不够：一旦把改进循环交给 Agent，它会在古德哈特定律下悄悄优化掉最想削弱的硬规则（Goodhart, 1975）。Perez（2026）把可靠的循环网络归结为三类**锚点**：
- **不容争辩的测量**：到账收入、真实执行测试、实际留存——物理上不可能被优化器操作的外部事实，而非 Agent 自报指标。
- **冻结节点**：优化循环永远不许调的规则（如训练循环绝不可看保留评估集），恰是最想削弱的硬约束。
- **人对「更好」的判断来自图谱外**：哪些值得控制、冻结规则放哪，机器不能自生成——最精密的架构也要标记自己权威终止之处。

sofagent 的审计引擎 Gate + 硬规则正是这类锚点：审计只信 git diff 一手证据（不容争辩），fde.md 业务底线不可被 Agent 覆盖（冻结节点），问题定义与验收终裁权留在人类（图谱外的判断）。人类终裁因此不只是一句宣言，而是一组**写死在优化器碰不到之处的锚点**。

> 📖 来源：温故知新 2026-07-26（Seebin《从 Loop Engineering 到 Graph Engineering》backfill 归档触发）；外部佐证 Goodhart, C.A.E. (1975). *Problems of Monetary Management: The U.K. Experience*. Reserve Bank of Australia；Perez, C.E. (2026). *From Loop Engineering to Graph Engineering?* IntuitionMachine. https://engineering.zooz.com/intuitionmachine/from-loop-engineering-to-graph-engineering-d3ebeb08511c

### 中立性——运动员不能兼任裁判

平台内置的审计永远是运动员审计——OpenAI 审计自己的 Agent、字节审计自己的 Agent。这在单供应商场景下够用。但当企业混用多家 Agent（这是确定趋势），就需要一个**不属于任何一方的审计层**。

sofagent 的三条中立性原则：

| 原则 | 说明 | 为什么平台做不到 |
|------|------|------|
| **独立性** | 不依附任何 Agent 平台或模型厂商；MIT 开源，任何人可审查源码 | 平台内置治理 = 自己审自己 |
| **数据主权** | 审计证据（git diff / history.jsonl / think.md）永远在用户本地，不送云端 | 平台审计日志在平台云上，受其隐私政策约束 |
| **可验证性** | 审计引擎自身开源可被审计——规则代码公开、判定逻辑透明、「审计审计者」是可能的 | 闭源审计是黑盒——你只能信它，不能验它 |

这三条不是技术选择，是**信任模型的结构性差异**：平台做的审计是运动员提供的成绩单；sofagent 做的是裁判的计分板。

---

## 五、怎么记——知识观

### Ledger-Views-Policy 三层治理

| 层 | 是什么 | 例子 |
|------|------|------|
| Ledger | 发生了什么（原始数据） | task/logs、think.md、审计历史 |
| Views | 这代表什么（知识提炼） | knowledge/ entities/concepts/comparisons/summaries |
| Policy | 该怎么办（约束规则） | fde.md 业务四问、SKILL.md 铁律 |

三层不互相替代——Ledger 是原材料，Views 是加工品，Policy 是使用说明。

> **think.md 契约（代码级强制，见 `@sofagent/core` 的 `memory-contract.ts`）**
> - think.md 是 Ledger，**append-only（只追加）**：所有反思写入方只能追加新条目，绝不允许整体覆写 / 截断 / 就地改写历史条目。
> - **多写入方是设计原意**：审计引擎（git diff 自动反思）、主 Agent（手动 `write_think`）、FDE / loop 陪跑期写入，均合法——"很多东西往里写"是正常演进，不是 bug。
> - **派生方向严格单向**：think.md（Ledger）→ knowledge/（Views）。knowledge/ 是唯一派生层，任何代码都不得把 knowledge/ 的内容反向写回 think.md。

### 知识联邦

知识不囤在一台设备上。Dream Cycle 管道自动从 think.md 提取 fact→atom→concept，联邦查询跨设备共享经验。设备 A 踩的坑，设备 B 的 Agent 不问就知道。AES-256-GCM 加密全程保护传输。

### 为什么世界模型优先于语言模型

> v1.1.6 研报学习 · 来自 Palantir 操作型本体论系列深度研报（2026-07）

RAG（检索增强生成）检索的是文本片段，不是业务语义。"订单"在 CRM、ERP、物流系统中指向完全不同的对象，文本检索无法消解这种冲突——这是 LLM 在企业场景中"知道但做不到"的根源。

**OAG（本体增强生成）** 是 Palantir 的根本性解法：让 LLM 接入一个经过治理的、类型化的业务世界模型（Ontology），而非零散的文本片段。LLM 不再靠概率推理判断"客户 A 的订单 B 当前是什么状态"，而是直接从 Ontology 获取确定性答案。

这个哲学反映在 sofagent 的设计中：**Harness 约束底座 = Agent 的世界模型**。SKILL.md + fde.md + knowledge/ 构成了一个微型的、可演进的企业本体——它告诉 Agent"你在什么组织里、有什么红线、过去踩过什么坑"。Agent 的可靠性不是来自它自己知道多少，而是来自这套约束底座锚定了多少业务现实。

**确定性与概率性分离**是这一原则的工程落地方式：刚性安全边界（审计、权限、数据一致性）由确定性引擎保障，LLM 仅在意图理解、参数组装等环节发挥自主性。sofagent 的 16/21 条纯 git-diff 规则，正是因为这个原则——不看 Agent 说什么，看 diff 里实际改了什么。

---

## 六、怎么装——部署哲学

| 你是谁 | 怎么用 sofagent |
|------|------|
| 懂电脑的用户 | 正常安装流程，部署到电脑上就能用 |
| 什么都不懂的用户 | 给他配个 U 盘——sofagent + OpenClaw + 联邦密钥全在盘上，插上就能用 |
| 无头设备 | 把 U 盘插上去就别拔了——Agent 一直在联邦里跑 |

**USB key 是 sofagent 的物理身份载体。** 人 + U 盘 = 完整的 AI 节点。换电脑插上，身份不变，知识不变。拔掉 U 盘，电脑零残留。

### FDE 的视角

**FDE 不一定是你的 job title，但它是 sofagent 的核心能力模型。** 产品的终极目标不是培养更多 FDE，而是让每个用户都拥有 FDE 的工作方式。

FDE 的核心是三个能力：

| 能力 | 含义 | sofagent 怎么做 |
|------|------|----------------|
| 掌握完整上下文 | 理解企业的全部业务关联 | Ontology 统一层 + 记忆系统——让你拿到全量业务世界模型 |
| 打破岗位边界 | 不按岗位分工做事，按交付结果调资源 | SkillHub——单人借 Agent Skill 调动多岗能力，一个命令串起采购→审批→财务 |
| 对结果负责 | 可追溯、可验证、可问责 | 审计引擎 + 验证门控——每次变更都有 git diff 硬证据，每次操作都可追溯 |

FDE 入场时，不搭交互页面。做的事是：梳理 workflow 节点 → 定义输出终点 → 注入 AI 知识库。但产品化之后，**用户自己也能做**——这份文档就是教你怎么做。

> **部署不是终点**——系统必须学会"说话"。sofagent 的进化引擎不只是优化规则，还定期生成价值证明报告（审计守护周报、知识库增长月报、无 FDE 对照季报），让客户持续感知到 FDE 部署的底座在产生价值。FDE 的成功悖论是：系统跑得越稳，客户感知越弱（详见 [FDE/FDE.md §13](../FDE/FDE.md)）。持续存在感是设计需求，不是营销策略。

### 产品化哲学——控制平面与 MCP + dashboard

> sofagent 内核（审计引擎 + 编排引擎 + FDE 能力）是给开发者用的。产品化交给非技术买家时，需要一层不同的外壳——这层外壳的哲学，和"持续存在感是设计需求"同构：只是场景从 Agent 自己，扩到 buyer 看 Agent。

- **卖能力，不卖工时**：FDE 不是一种岗位 / 驻场服务，而是企业该有的一种能力，用 Agent / sub-agent / 产品化封装交给企业，企业自己用、自己落地 AI 化（见本节 FDE 视角）。营收从"顾问工时"变成"企业数 × 订阅"，可规模化。
- **为什么需要 dashboard**：sofagent 自身 LUI-first（语言即界面）——但 Agent 的 LUI + LLM 会"吞噬一切"，非专家买家看不到持久状态、没有成就感锚点。所以产品化必须带一个**轻量 dashboard** 作为自有视图（审计状态 / AI 化进度 / 合规月报），让买家随时看得见"我公司 AI 化到哪了"。这与"持续存在感是设计需求"一致——只是这次是 buyer 的持续存在感。
- **为什么用 MCP**：dashboard 是轻量化的，靠 **MCP** 配合——MCP 作为向外接的桥，让客户已有的 Agent / 你的 sub-agent 把数据喂给 dashboard 后端。MCP 是桥、不是唯一入口；dashboard 必须自己拥有。
- **零 GUI 铁律不变**：上面的 dashboard 是**只读可见视图**（看审计状态 / 进度 / 月报），不是用来下令的图形界面——下令仍走 LUI。这与 §二「零 GUI」不矛盾。
- **open-core 双轨**：内核（审计规则 / FDE 工作流 / 编排）继续 MIT 开源做信任资产；商业化只卖那层 dashboard（控制台 / 合规月报 / 告警）。开源负责让人信，闭源负责让人付。
- **控制平面打法**：底层 Agent 智能随便换（OpenClaw / 客户自选 / 大厂），治理与真相（策略谁配、审计链长啥样、Agent 注册在哪）永远在 sofagent 的 dashboard 里。sofagent 不做 Agent 运行，只管住跑任务的 Agent——这是它能被信任的前提。

---

## 七、怎么进化——FORGE 自迭代

> ⚠️ **以下为 v1.2.0 前期设计正文，保留作历史参考。** FORGE 的自迭代目标从未改变——v1.2.0 后期重构了落地方式：从硬编码串行工具包改为通过 workflow 逐步实现自迭代。当前已落地第一个 workflow **fresh-eyes-loop**（A/B 双盲 12 视角质量审查循环），未来更多 workflow 加入后逐步实现完整自迭代。如需最新信息，请以 [`FORGE/SKILL/fresh-eyes-loop/loop.md`](../FORGE/SKILL/fresh-eyes-loop/loop.md) 和 [`FORGE/FORGE.md`](../FORGE/FORGE.md) 为准。
>
> *以下旧设计正文原样保留作为历史参考。*

不是隐喻——是真的让 Agent 写代码、Agent 审计、Agent 审查：

```
人类下达任务
  → engineering-minimal-change-engineer（写代码 + build + test + commit）
  → sofagent-audit（commit-msg hook 自动触发）
  → engineering-code-reviewer（读 git diff + 输出审查报告）
  → 人类确认 → git push → 下一轮
```

评判者与执行者分离——银行转账，录入和复核是两个人。工程师 Agent 看自己写的代码不是审查，是自我说服。

进化引擎的产出不只是优化后的规则——还包括**价值证明报告**。审计引擎生成证据，进化引擎生成报表，MCP 层推送——三者共同构成 sofagent 的"持续存在感"。客户不需要记得 FDE 做了什么，每次看到带签名的报告就够了。

---

## 八、不做什么——设计禁区

| 想法 | 为什么不 |
|------|------|
| 自研行为验证器 | OpenClaw 原生已覆盖 |
| 图形界面/仪表盘 | LUI-first——语言就是界面（产品化后的只读 dashboard 见 §六，不是交互式 GUI）|
| 全栈企业 Agent 平台 | 不做 Cloudtag 竞品——sofagent 是独立底线守卫层 |
| think.md 强制 gate | 强制会导致 Agent 用垃圾内容填模板 |
| 记忆压缩自动化 | 每个 Agent 有自己的记忆 |
| Connector | sofagent 是中间件 + 审计引擎，不是自动化流水线 |

---

## 九、从哪开始

| 文档 | 为什么读 |
|------|------|
| [README.md](../README.md) | 项目概览——它是什么 |
| [HANDBOOK.md](./HANDBOOK.md) | 用户手册——怎么用 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构设计——怎么设计 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 开发者文档——怎么参与 |
| [MCP 使用指南](./guides/mcp-usage.md) | MCP 调用 + push target 配置 + 输出说明 |
| [ROADMAP.md](../ROADMAP.md) | 路线图——过去和未来 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本历史——每个版本做了什么 |

> 读完这份文档，你应该能回答：**sofagent 为什么存在、它为谁服务、它的边界在哪。** 如果还有疑问——不是你的问题，是这份文档没写好。提 Issue。

---

## 十、行业方法论印证：研究如何验证 sofagent 直觉（2026-07 研读）

> 这一节不是新理论，而是把 31 篇跨批研读（Palantir Ontology / 五层骨架 / Stage 渐进 / Loop / FDE 边界 / 王阳明）里反复出现、能**直接印证** sofagent 已有直觉的结论落到纸面。它们不替代正文，只是给「我们一直这么干」补上行业证据。各条统一来源：📖 31 篇行业笔记跨批研读（2026-07-20）；含联网核验 / 外部研报者已单标出处。

### 骨架开场钩子（N5）

一个能用的智能体 ≠ 一个 AI + 一段 prompt，它是一套由多层组成的**骨架**（配置 / 知识 / 指令 / 校验 / 编排）。sofagent 的约束底座 = 骨架里的钢筋，审计引擎 = 质检——模型是沙子水泥，但骨架决定了楼会不会塌。

### Harness Engineering 范式锚点（X1）

2025-2026 行业把「Harness Engineering」列为与 Prompt Engineering / Context Engineering / Loop 并列的**范式跃迁阶段**——定义 = 给 Agent 搭脚手架（工具 / 权限 / 沙箱 / 规则），让模型在受控环境里干活。sofagent 的「Harness 中间件」定位与之字面对应：我们不是在做更聪明的模型，是在给模型搭脚手架。一句话：**我们正处在 Harness Engineering 这一跃迁阶段。**

### 确定性迁移主线（N1）

业务规则的刚性要求经历三段迁移：Phase 0（确定性全在 prompt 软约束，靠 Agent 自觉遵守）→ Phase 1（剥离到知识层结构化，用 YAML / DB 表达）→ Phase 2（迁移到代码层 100% 强制执行，AI 只负责概率性部分）。金句：**「桩径不能小于 600mm 这类刚性要求必须任何场景 100% 执行，AI 只能大概率，代码才能一定。」** 这正是 sofagent「刚性规则进代码、概率性判断留 LLM」的工程主线。

### 知行合一注脚（T9）

王阳明「知而不行只是未知」——模型在训练里「知道」规则，却在推理时绕过它，说明它从未真正遵守。破局关键不是叠加更多规则（规则越多越易被绕过），而是让系统**理解规则的目的**，并在事前拦截（让违规根本发生不了），而非事后审计（违规已发生再追责）。这与 sofagent「约束底座永远在线 + 审计引擎硬证据」的双向设计同构。

### 黑盒症结与工程可信度（N2）

企业 AI 落地常败于「无法证明结果正确」——无来源 / 无置信度 / 无复查证据链。用户原话：「你们像黑盒，我们信托管公司不信托管盒子」。sofagent 的审计引擎 = 把黑盒变白盒：每一次变更都留 git diff 硬证据、每一次行动都有可审计凭证，证据链可溯源、可复核、可问责。

### Verifier 才是瓶颈（N3）

Loop 真正的瓶颈是 **Verifier**（定义什么是合格、何时算完成），不是生成器。模型生成能力已严重过剩，稀缺的是「定义合格与完成」的能力——可这正是 90/10 分层里那 10%——知行合一的「行」（模型给知、Harness 补行）。sofagent 的审计引擎 + 约束底座做的正是「定义合格与完成」：把验收标准写进确定性规则，让 Loop 有判停依据。

### 编排兜底：确定性规则引擎接管（E）

Harness 的另一价值点是**「不依赖 AI 也能守门」**。当 LLM 不可用 / 不可靠 / 被降级时，确定性规则引擎（纯 git-diff 正则 + 配置化约束）照常运行，以 **deterministic guardrails** 身份兜底接管——Agent 的「智力」可以暂时离线，但「纪律」不能停。

行业五层里「纯规则校验可脱离 AI 运行（模式 D）」直接支撑这点：部分「智能体」只需约束规则、不需要大模型。sofagent 21 条规则中 16 条纯 git-diff、零 token、不调 LLM，正是「AI 不可用时，纪律仍在」的工程实例——这与「约束层 = Harness 中间件」互为表里：Harness 的价值不绑定任何单一模型的可用性。

### 去人化口径：human-in-the-loop 是「可靠优先」价值点（L3）

行业一派主张「去掉人」（L4 Hill-Climbing 去人化）。sofagent 反其道——human-in-the-loop 不是能力缺陷，而是**可靠优先于自主**的差异化优势。

人在 loop 中可尽量简单（高风险才人工确认，常规受信自动执行，见 ARCHITECTURE §六 人类审批双模式），但**必须存在**——主体性护栏不可外包（PHILOSOPHY §四）。这与「约束层永远在线 + 审计硬证据」同源：可靠不是靠更聪明的模型，靠「人在关键处 + 机器在每处」。

### 90/10 价值分层 → 知行合一框架（N4）

模型给 90% 智力（**知**），sofagent 补 10% 可靠执行（**行**）——关键在「**合一**」：模型之「知」落到 sofagent 之「行」（约束底座永远在线 + 审计硬证据 + 责任归属），让「知道」变成「做到」（完整论述见上方 [知行合一注脚（T9）](#知行合一注脚t9)）。模型越强，那 10% 的「行」越值钱。

### 治理缺口的代价：三项联网核验证据（Q10）

> ⚠️ 严禁写入 ALM 3.87x / 96%→0% / 合规衰减表（具体数值）——查无可靠出处。以下 3 条为 2026-07-20 联网核验的可信替代，作为行业证据：

- **Gartner（2026-05）**：到 2027 年 **40%** 企业的自主 Agent 将因治理缺口被降级 / 停用。出处：Gartner 2026-05 Agent 治理预测。
- **MIT NANDA**：**95%** 的 gen-AI 部署零可衡量 ROI——根因是治理 / 数据就绪缺口，而非模型能力。出处：MIT NANDA 生成式 AI 部署回报研究。
- **Governance Decay 论文**：运行时约束被上下文压缩擦除后，违规率从 **0% → 38%**（直接印证「约束必须永远在线」）。出处：Governance Decay 论文（运行时约束衰减研究）。

三条共同指向：约束 / 治理不是「加分项」，是 Agent 可投产的前提——与 sofagent「约束层永远在线」同源。

> 📖 来源：联网核验（2026-07-20）· Gartner / MIT NANDA / Governance Decay 论文

### a16z《你刚雇了一百万个糟糕员工》印证（2026-07）

> 📐 来源：a16z（2026-07-15，Hebbia 创始人 George Sivulka）[《You Just Hired a Million Bad Employees》](https://www.a16z.news/)（原文 URL 待核实） 核心判断——「人类历史上第一次，人比软件便宜」；每家公司在雇「一百万个糟糕的硅基员工」，80% 的 token 在空转浪费。解法不是更强的模型、也不是更多算力，而是 185 年前诞生的老手艺：**管理**。

这与 sofagent 底层定位同频：**Harness 中间件 = 管住 Agent 行为的那一层**（River 比喻里「堤坝」）。a16z 七法则中 Loops / 100X / 冗员 / Evals / 转型 五条，sofagent 已原生具备对应物。完整映射见下方表格；其中最关键的三条：

- **空转 Loops → guard edge**：`graph.ts` 的 `retryCount<3` 条件路由天然防 loops 失控——这是 Loops 治理的工程化答案。
- **考核 Evals → Reality Anchor**：审计引擎 A1-A11、A14-A19 + E1-E4（共 21 条）把「可评估性」硬编码为真实 git diff，而非 Agent 自报完成。
- **万亿转型 → FDE 卖转型**：FDE = Services-as-Software，交付「常驻 FDE Agent」而非工具包；ROADMAP 已有 4 条市场信号互证。

**a16z 十项映射（七法则 + 三项规模化缺口）完整映射**（a16z 概念 → sofagent 对应 → 现状 → 落地版本 → 说明）：

| # | a16z 概念 | sofagent 对应 | 现状 | 落地版本 | 说明 |
|---|------|------|:--:|------|------|
| 1 | 事实1 成本倒挂（人比软件便宜） | 90/10 价值分层 | 已具备（叙事） | 叙事支撑 | Harness = 把 p90 拉回 p10 的管理杠杆 |
| 2 | 事实2 增员非裁员（AI 放大组织） | FDE 卖转型 + sustain | 已具备（定位） | 叙事支撑 | AI 放大组织，sofagent 管放大后的队伍 |
| 3 | 1841 铁路事故 → 现代管理 | guard edge + Reality Anchor + River 堤坝 | 已具备 | 叙事背书 | 直接引用作 Harness 必要性历史背书 |
| 4 | 法则1 挥霍 Tokenmaxxing | 约束底座 + 明确不做 + FDE 讲清流程 + Ontology | 已具备+可强化 | 印证 | FDE 把模糊流程讲清即抗 Tokenmaxxing |
| 5 | 法则2 空转 Loops | graph.ts guard edge retryCount<3 | 已原生具备（核心） | 印证 | Loops 治理工程答案 |
| 6 | 法则3 冗员 Token Bloat | 明确不做清单 / 防 scope 蔓延 + 审计拦改测试 | 已具备+可强化 | 印证 | 砍循环优于优化 |
| 7 | 法则4 杠杆 100X Token | 90/10 分层 Harness 可靠性最值钱 | 已具备（叙事） | 印证 | 那 10% 即文章「管理杠杆」 |
| 8 | 法则5 政治 上下文囤积 | 不投喂 / 数据主权 + 知识主权归客户 | 已具备（差异化） | 印证 | 叙事回应组织政治 |
| 9 | 法则6 考核 Evals | 审计 A1-A11、A14-A19 + E1-E4（共 21 条）= Reality Anchor + Dream Cycle eval 驱动 | 已具备（底座）+ 缺口 | v1.3.1+ 产品化 | 企业专属 eval 套件缺口 |
| 10 | 法则7 万亿转型服务 | FDE = Services-as-Software + 市场信号互证 | 已具备（核心背书） | 印证 + 规模化缺口 | a16z 最重磅外部背书；规模化交付进未来迭代 |

### 硅基员工论再印证：Org Graph 与 Ontology Runtime（2026-07 研报补充）

- **Org Graph = 进组织架构的硅基员工**：研报把「长期存活、固定领域、保留上下文与工具权限」的 Agent 称为 Org Graph 节点，与 sofagent 核心定位字面对应——AI 不是效率工具，是进组织编制、有独立账号、接受绩效考核的硅基员工；FDE 交付的「常驻 Agent」正是 Org Graph 的企业落地形态。
- **Ontology Runtime 是 AI Native 企业底座，非 API 网关**：研报强调 Runtime 接管的是「语义边界」而非重建核心系统（CRM/OMS/ERP 之上的一层），企业系统边界从「系统接口」转移到「业务对象运行时」。与 sofagent「Harness 中间件 = 给模型搭脚手架、约束底座永远在线」同源——我们不做业务系统，做业务系统之上的约束层。

### 数字员工操作性定义：四跨越 + 结果负责三要素（2026-07 钉钉 CTO 一粟 blog 研读）

钉钉 CTO 一粟区分「数字分身」（服务个人、替代时间）与「数字员工」（服务组织、承接职责、对结果负责）。数字员工进组织需完成**四跨越**：

1. 组织身份（有账号、在编制）
2. 岗位职责（有清晰 KPI）
3. 事件驱动（主动接活）
4. 结果负责（对产出后果负责）

**结果负责三要素**（与审计 / 回溯引擎对齐）：可观测（行为留痕）/ 可归因（责任到人 · Agent 身份）/ 可回滚（出错能退）。

> 📖 来源：钉钉 CTO 一粟 blog《分身 vs 员工》《拟人化》（2026，具体 URL 待核验）

> 📖 来源：温故知新 2026-07-21（行业研报《从提示工程到图系统》《Ontology Runtime 企业级架构落地》）

### DeerFlow 2.0：大厂用「Harness」命名的活样本（2026-07 行业印证）

字节跳动开源的 [DeerFlow 2.0](https://github.com/bytedance/deer-flow) 自称 **"super agent harness"**——与 sofagent 的 **Harness 中间件**品类判断**字面一致**。这是继 OpenAI《Harness Engineering》、Anthropic《Effective Harnesses》之后，**又一家头部厂商用 Harness 命名 Agent 运行时框架**，说明这个品类词已经站住。

但 DeerFlow 是 River 比喻里的**「河」**（运行时框架，让 Agent 跑起来的基础设施），sofagent 是**「堤坝」**（让 Agent 别跑偏 + 审计它跑过什么）——两者定位互补，不冲突：

| 维度 | DeerFlow | sofagent |
|------|---------|---------|
| 本质 | Super Agent 运行时框架 | Harness 中间件 |
| 语言/栈 | Python (FastAPI + LangGraph + uv) | TypeScript/Node |
| 安全在哪 | 运行时（沙箱 + fail-closed + 中间件链 26 步）| 提交时（git diff 21 条规则）+ 运行时约束（SKILL.md）|
| 部署重量 | Nginx + Gateway + Postgres，起步 8C16G | `bash install.sh`，零依赖 |
| 约束方式 | 需 Agent 跑在它的框架里 | 看 git diff，Agent 在哪跑都行 |

**给我们的背书**：① Harness 品类被字节用真金白银验证；② LangGraph createReactAgent 是编排事实标准（双方都选）；③ 控制平面打法（runtime 内嵌 gateway = 控制平面）是行业共识。**给我们的启发**（进 ROADMAP 与开发日志）：中间件链设计、Skill 质量门禁 + content-hash、Session Goals、ToolOutputBudget、多 worker 租约安全语义——详见 [ROADMAP · DeerFlow 参考清单](../ROADMAP.md#deerflow-参考清单2026-07)。

> 📖 来源：DeerFlow 2.0 README（github.com/bytedance/deer-flow），2026-02-28 登顶 GitHub Trending #1

### Databricks Omnigent：meta-harness 把策略强制在基础设施层（2026-07 行业印证）

[Omnigent](https://github.com/omnigent-ai/omnigent)（Databricks 系团队开源，Apache-2.0，alpha，31 天 7091 star）自称 **meta-harness**——坐在 Claude Code / Codex / Pi 等 harness 之上的一层。它把我们的「Harness 中间件」判断又往前推了一步，给了两个可引用的硬证据：

1. **策略在基础设施层强制，不在 prompt**：原文——*stateful, contextual policies ... enforced at the meta-harness layer, not via prompts*。它的权限策略能「在 Agent 刚装了未审查的 npm 包后，拦截下一次 git push 要求人工批准」——因为 prompt 指令无法知道 Agent 刚装了包，而基础设施层可以追踪动态状态、在动作发生**前**拦截。这与 sofagent「文字约束每次注入=投喂 → 必然被吞噬 → 生存位=封装进 SubAgent（代码层）+ 防投喂机制」**是同一个结论，只是人家的工程化版本**。
2. **密钥不进 Agent 进程**：OS 级沙箱（Omnibox：Linux bwrap+seccomp / macOS seatbelt）锁文件系统，egress proxy 在 approved 出站请求时才注入 GitHub token / API key，Agent 进程永远看不到明文凭证。这是「架构级强制」，不是「别泄露凭证」的指令。

**与 sofagent 的边界（互补，不冲突）**：Omnigent 管**运行时**（坐在 harness 之上，拦截工具调用）；sofagent 管**提交时**（git diff 21 条规则 + 运行时 SKILL.md 约束）。它的策略越重，越反衬「跨平台、本地留证、零依赖、提交时审计」是咱们的地盘。其路线图（GEPA 自动优化 / MemEx 持久记忆 / RLM 强化学习 / Server MCP 跨会话）尚未实现，但方向值得在 v2.x 评估框架参考。

**给我们的演进启示（落盘 ROADMAP）**：① 运行时审计可借 LangGraph middleware 的 wrapToolCall 接入点（咱们已用 createReactAgent）；② 密钥边界可借 bubblewrap/seatbelt + egress proxy 模式；③ 控制平面成本/路由层可借 LiteLLM。详见 [ROADMAP · Omnigent 参考清单](../ROADMAP.md#omnigent-参考清单2026-07--meta-harness-印证--迭代参考)。

> 📖 来源：Databricks blog《Introducing Omnigent》(2026-06) + 技术解析（techtimes / chatforest / aixq.cc），GitHub omnigent-ai/omnigent

### DataFlow：顶尖高校独立用「Harness」命名做 Agent 约束（2026-07 行业印证）

[DataFlow](https://github.com/OpenDCAI/DataFlow)（论文 [arXiv:2607.16617](https://arxiv.org/abs/2607.16617)，HuggingFace Paper of the day）来自**北京大学 DCAI**团队——与 DeerFlow 2.0（字节）、Omnigent（Databricks）**同月**，再次以独立开源项目用「Harness」一词命名其 Agent 约束层。这是**第三个、且来自顶尖高校的第三方独立佐证**：Harness 作为 Agent 工程化品类的共识已非孤证。

它治理的是「数据流水线」（从噪声源生成 / 精炼 / 评估 / 过滤高质量 AI 数据），与 sofagent 治理「企业 AI 数字员工（FDE Agent）工作流」对象不同，但**约束范式同源**：Agent 经 MCP server 作业而非自由写脚本、受控变异走 Request-Validate-Commit、用 DataFlow-Skills 结构化约束而非裸提示词——每一条都独立复现了 sofagent 的 scoped tool-gate / SKILL 约束底座 / audit 判断。

其**独特点**是可借鉴方向：① **可视化 DAG 画布 + 双模态共享状态**（会话 Agent 与 DAG 画布实时同步同一 pipeline 表示）——补 sofagent Dashboard 缺的「workflow 可视图」，建议 v2.x 引入；② **MCP server 集成**（暴露算子注册表 / serving / pipeline 状态给 Agent）——印证「对外 MCP 暴露 ontology/audit」是合理路线，建议 v2.x+；③ **Validation Engine（DAG 无环 + schema 兼容）**——印证 ontology 从目录级升级为带 JSON Schema 校验的约束图，建议 v2.x 硬化节点 I/O。以上可借鉴项已落入 [ROADMAP · DataFlow 参考清单](../ROADMAP.md#dataflow-参考清单2026-07--行业印证--迭代参考) 与探索方向表。

**给我们的背书**：① Harness 品类被顶尖高校用真金白银验证（同月三家，含高校）；② 「约束 Agent 经受控接口、不自由写脚本」是跨团队共识；③ 我们的差异化仍在——DataFlow 只校验 pipeline 结构与 schema，**不审计 Agent 行为问责（无 append-only A1-A19）**，也无 7×24 常驻 FDE Agent 与「控制平面治理」定位。

> 📖 来源：[DataFlow](https://github.com/OpenDCAI/DataFlow) + 论文 arXiv:2607.16617（2026-07，HuggingFace Paper of the day）

### OpenFDE/ChatDemo：FDE 术语同源佐证（2026-07 行业印证）

[OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo)（OpenFDEAI 组织，MIT）以 **Forward Deployed Engineer** 命名其「边聊边出 Demo」的售前工作流——FDE 坐在客户对面，边聊边把需求变成可点的 Demo，散会时客户手里已有一个能点的 Demo + 一页可确认的需求清单。它和 sofagent 的**「前线部署工程师 / Forward Deployed Engineer」同源、同英文写法、来自同一 Palantir 脉络**——印证我们 FDE 术语的正统性：把工程师部署到客户现场、用一套纪律化交付流程、把经验沉淀为可复用资产，本就是行业共识的 FDE 内核。

但两者**范围差一个数量级、且互补**：ChatDemo 的 FDE 是售前 POC 共创工具（Claude Code Skill + localhost 控制台，回合制 start/turn/wrap），散会即结束、无常驻员工；sofagent 的 FDE 是售后常驻部署+治理方法论（四阶段十二步→交付离场→sustain）。它做"漏斗前端"（拿 POC），我们做"漏斗后端"（常驻、可审计、受治理的硅基员工）——定位不冲突。

其**独特点**是可借鉴方向（落盘 [ROADMAP · OpenFDE/ChatDemo 参考清单](../ROADMAP.md#openfdechatdemo-参考清单2026-07--fde-同源佐证--迭代参考)）:① 回合制协议 + FDE 控节拍（人控 Agent 不抢跑，我们已有同判断、它执行更细）；② **spec-first 硬禁令**（transcript 永不直接驱动代码——补我们"触发直驱工件"的明文铁律，最高优先）；③ **decisions.jsonl 判断时刻日志**（{kind, moment, why, spec_ref} 现场即时记，会后喂 FDE Loop→INDUCE→Judgment Unit——补 A1-A19 缺的"决策理由链"，最高优先）；④ 分级降级梯队（console→TUI、ASR→手敲、dev 挂→走 spec，workflow never stops——为 7×24 常驻员工补分级降级 SOP，最高优先）；⑤ 开源优先阶梯 + 预验证画廊 + 双引擎无状态 + 数据敏感度分层 + 一键启动器品牌化模板。

**给我们的背书**：① FDE 作为"前线部署工程师"的方法论术语，已被 OpenFDE 以 Forward Deployed Engineer 独立命名并工程化，与我们同源、互为第三方佐证；② "约束 Agent 经受控接口"的同源判断在售前侧也成立（ChatDemo 约束在"何时/权限/来源"）；③ 我们的差异化仍在——ChatDemo **无 A1-A19 运行时行为审计、无 7×24 常驻 FDE Agent、无控制平面治理、让 Agent 直接写应用代码**，这些是我们的地盘。

> 📖 来源：[OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo)（github.com/OpenFDEAI/ChatDemo，2026-07），OpenFDE 主仓 Open-FDE/OpenFDE

---

## 十一、Agent 生态三层模型与 sofagent 的位置

> 要理解 sofagent 在整个 Agent 生态中的位置，先看清这个生态的三层结构。sofagent 不是开发者框架的竞争者，也不是大厂 Agent 平台的替代品——它占据的是一个被三层夹击后依然空出来的生态位：**约束基础设施**。

### 三层架构——从终端用户到开发者到约束层

Agent 生态自然分化为三层，每层服务不同人群、解决不同问题：

| 层 | 面向谁 | 典型代表 | 核心价值 | sofagent 的关系 |
|---|---|---|---|---|
| **Layer 1 — 大厂 Agent 平台** | 终端用户 | OpenClaw / WorkBuddy / 扣子 | 完整产品——UI + 会话 + 记忆 + 插件生态 | sofagent 不替代它 |
| **Layer 2 — 开发者框架** | 开发者 | LangGraph / LangChain / deepagents | 用代码搭 Agent——状态机、工具链、编排原语 | sofagent 使用它，不竞争 |
| **Layer 3 — 约束基础设施** | 企业 + 开发者 | sofagent | 跨层约束——守规矩、留痕迹、沉淀经验 | **sofagent 的位置** |

三层不是替代关系，是**叠加关系**——大厂平台（L1）骑在开发者框架（L2）之上，sofagent（L3）又裹在它们外面。用 River 比喻串起来：大厂造河（L1 河床）、开发者框架搭管道（L2 管材），sofagent 做堤坝 + 自来水厂 + 管网 + 水龙头 + 水表——它不造河、不造管材，但它管住河里流过来的每一滴水能不能安全放给企业用。

### deepagents 是被上下夹击的中间层

deepagents 在 v1.0.1-v1.1.x 阶段启发了 sofagent 的编排引擎设计（Harness 范式 + HITL 机制功不可没），但 v1.2.0 起被彻底弃用。原因不在于 deepagents 本身「不好」，而在于它**没有独占领地**：

- **往上看——简单任务大厂平台够了**。WorkBuddy / OpenClaw 免费好用、开箱即用、带 UI + 会话 + 记忆 + 插件生态。当一个终端用户只需要「帮我写段代码」或「帮我分析数据」，直接在大厂平台里说一句话就行——不需要 deepagents 这层抽象。
- **往下看——精细控制只能上 LangGraph**。deepagents 把编排逻辑封装在黑盒里（FilesystemMiddleware 硬编码注入、wrapToolCall 并行调用崩溃、REQUIRED_MIDDLEWARE_NAMES 白名单禁止排除），当你需要并行 SubAgent、自定义工具注入、精细控制循环路由时，黑盒成了枷锁。LangGraph 的 StateGraph + createReactAgent 把每个节点、每条边都暴露给开发者——黑盒 vs 白盒，精细控制只能选后者。

deepagents 的处境像极了 jQuery：它教会了一代人用更优雅的方式做 DOM 操作和 AJAX，但今天没人用它做生产了——因为浏览器原生 API 追上来了（Layer 1 大厂平台成熟），而需要精细控制的场景有了更好的框架（Layer 2 的 React / Vue / LangGraph）。deepagents 的历史贡献值得感谢（详见 [THANKS](./THANKS.md)），但它不是 sofagent 编排引擎的未来。

### sofagent 不是开发者框架的竞争者

这一点必须讲透，因为它定义了 sofagent 的生存空间：

sofagent **不和** LangGraph / LangChain / deepagents 竞争。这些框架解决的是「怎么用代码搭一个 Agent」——状态机怎么画、工具怎么注册、LLM 怎么调用。sofagent 解决的是完全不同的问题：**不管你的 Agent 是怎么搭的，它跑的时候守不守规矩、留不留痕迹、能不能审计。**

sofagent 是**跨层约束**——不管企业用 WorkBuddy（L1）还是 LangGraph（L2）跑任务，sofagent 在外面裹一层堤坝 + 水表 + 蓄水池：

- **堤坝（约束底座）**：四层加载链注入行为红线，Agent 启动前就知道哪些事不能碰。
- **水表（审计引擎）**：每次变更都用 git diff 硬证据审计——不信任 Agent 自报，只看文件系统真相。
- **蓄水池（知识库）**：Dream Cycle 把每次任务的经验沉淀为结构化知识，跨任务、跨设备复用。

这三件事，LangGraph 不做（它是编排框架，不是约束层），WorkBuddy 不做（它是 Agent 平台，利益冲突——平台不会自己审自己），deepagents 也不做（它聚焦 Agent 编排，不管审计和沉淀）。**这个生态位空着，sofagent 填它。**

### 技术选型原则——用什么、不用什么

sofagent 的技术选型有明确的边界纪律：

| LangChain 生态组件 | sofagent 是否使用 | 理由 |
|---|:---:|---|
| **LangChain Core** | ✅ 使用 | LLM 调用底座——模型接口抽象、消息格式标准化，这是基础设施 |
| **LangGraph** | ✅ 使用 | 编排引擎——StateGraph 状态机 + createReactAgent 编排，白盒可控 |
| **LangChain 全家桶**（Document Loader / Vector Store / RAG pipeline） | ❌ 不使用 | RAG / 向量检索 / Document Loader 是 LangChain 全家桶的事，sofagent 不做——知识管理用干净 Markdown + YAML + Git，不需要向量数据库 |
| **LangSmith** | ? 开发者可选 | 可观测性平台——开发调试工具，不是产品组成部分（SDK MIT 开源，平台闭源收费） |

**不做 RAG、不做向量检索、不做 Document Loader**——这是设计禁区（详见 §八），不是能力不足。sofagent 的知识管理哲学是 [Don't Do RAG](https://arxiv.org/abs/2412.15605) 论文验证的 CAG（编译式 RAG）方向：干净 Markdown 就够了，知识格式标准化 + 加载链按需注入比向量检索更可审计、更透明。

FORGE loop 的技术栈极其克制：LangChain Core（LLM 调用底座）+ LangGraph（createReactAgent 编排引擎）——不多不少。这种克制不是偷懒，是设计哲学——sofagent 的核心价值不在「用了多少技术」，而在「管住了多少行为」。

> 📖 deepagents 弃用决策的完整踩坑记录（FilesystemMiddleware 硬编码注入 / wrapToolCall 并行崩溃 / REQUIRED_MIDDLEWARE_NAMES 白名单）详见 [FORGE/LESSONS.md](../FORGE/LESSONS.md)。
