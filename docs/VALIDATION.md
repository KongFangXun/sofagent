# sofagent 行业印证与生态定位 · Validation

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> v1.5.1 · 2026-09-22（UTC）· ✅ 已发版 · 孔放勋

> **本文档从四个维度回答一个问题：行业有没有独立验证 sofagent 的直觉？**
> - **§一 方法论**——行业研究怎么印证"约束层是刚需"（Harness 范式 / 确定性迁移 / Verifier 瓶颈 / 治理缺口代价）
> - **§二 生态位**——sofagent 在 Agent 生态三层模型中的位置（约束基础设施，不碰平台、不碰框架）
> - **§三 架构**——行业框架怎么独立复现 sofagent 的架构选择（Ontology / Apache Ossie / 五层骨架 / AOS / Palantir OAG 与双 MCP）
> - **§四 市场**——这些技术判断有没有被市场买单（FDE 经济账 / SMB 断层 / 产品化四条 / 价值度量翻转）
> 四个维度共同指向同一结论：**不管你的 Agent 怎么搭、在哪跑，它需要一个独立的约束层。**

---

## 目录

- [一、方法论印证：行业研究怎么验证 sofagent 直觉](#一方法论印证行业研究怎么验证-sofagent-直觉)
- [二、生态位：Agent 三层模型与 sofagent 的位置](#二生态位agent-三层模型与-sofagent-的位置)
- [三、架构印证：行业框架独立复现 sofagent 的选择](#三架构印证行业框架独立复现-sofagent-的选择)
- [四、市场印证：行业判断被市场买单](#四市场印证行业判断被市场买单)
- [五、研报视角的边界提示](#五研报视角的边界提示)

---

## 一、方法论印证：行业研究怎么验证 sofagent 直觉

> 这一节不是新理论，而是把跨批行业研读（Palantir Ontology / 五层骨架 / Stage 渐进 / Loop / FDE 边界 / 王阳明 / Cloudflare / Loop Engineering 等）里反复出现、能**直接印证** sofagent 已有直觉的结论落到纸面。它们不替代正文，只是给「我们一直这么干」补上行业证据。有公开来源者已标注出处。

**▍概念层——行业对「约束」的独立论证（骨架 / 确定性迁移 / Verifier / 治理缺口等，逐条印证约束层为什么是刚需）**

### 骨架开场钩子

一个能用的智能体 ≠ 一个 AI + 一段 prompt，它是一套由多层组成的**骨架**（配置 / 知识 / 指令 / 校验 / 编排）。sofagent 的约束层 = 骨架里的钢筋，审计能力 = 质检——模型是沙子水泥，但骨架决定了楼会不会塌。

### Harness Engineering 范式锚点

2025-2026 行业把「Harness Engineering」列为与 Prompt Engineering / Context Engineering / Loop 并列的**范式跃迁阶段**——定义 = 给 Agent 搭脚手架（工具 / 权限 / 沙箱 / 规则），让模型在受控环境里干活。sofagent 的「约束层（Harness）」定位与之字面对应：我们不是在做更聪明的模型，是在给模型搭脚手架。一句话：**我们正处在 Harness Engineering 这一跃迁阶段。**

### 确定性迁移主线

业务规则的刚性要求经历三段迁移：Phase 0（确定性全在 prompt 软约束，靠 Agent 自觉遵守）→ Phase 1（剥离到知识层结构化，用 YAML / DB 表达）→ Phase 2（迁移到代码层 100% 强制执行，AI 只负责概率性部分）。金句：**「桩径不能小于 600mm 这类刚性要求必须任何场景 100% 执行，AI 只能大概率，代码才能一定。」** 这正是 sofagent「刚性规则进代码、概率性判断留 LLM」的工程主线。

### 知行合一注脚

王阳明「知而不行只是未知」——模型在训练里「知道」规则，却在推理时绕过它，说明它从未真正遵守。破局关键不是叠加更多规则（规则越多越易被绕过），而是让系统**理解规则的目的**，并在事前拦截（让违规根本发生不了），而非事后审计（违规已发生再追责）。这与 sofagent「约束注入链永远在线 + 审计能力硬证据」的双向设计同构。

### 黑盒症结与工程可信度

企业 AI 落地常败于「无法证明结果正确」——无来源 / 无置信度 / 无复查证据链。用户原话：「你们像黑盒，我们信托管公司不信托管盒子」。sofagent 的审计能力 = 把黑盒变白盒：每一次变更都留 git diff 硬证据、每一次行动都有可审计凭证，证据链可溯源、可复核、可问责。

### Verifier 才是瓶颈

Loop 真正的瓶颈是 **Verifier**（定义什么是合格、何时算完成），不是生成器。模型生成能力已严重过剩，稀缺的是「定义合格与完成」的能力——可这正是 90/10 分层里那 10%——知行合一的「行」（模型给知、约束层补行）。sofagent 的审计能力 + 约束注入链做的正是「定义合格与完成」：把验收标准写进确定性规则，让 Loop 有判停依据。判停依据的本质是「健康」而非「能跑」——每次合并请求的判断标准不是「这段代码能不能运行」，而是「它能不能让这棵树（共同主线）长得更健康、朝着组织认定的方向生长」。能跑只是及格线，健康才是验收线；这正是 Verifier 比生成器更稀缺的原因。

**闸门必须分层，调优口径是等待时间**。Agent 把生成的边际成本压到近零后，验证成为新瓶颈——Linear 重构 CI 的实测：AI 编码使测试套件一年增长约 4 倍，PR 等待时间从 6 分钟压到 5 分钟、runner 数减半。分层判据：提交前只跑确定性、低耗时的快闸门子集（静态检查+关键路径测试），全量校验异步化为慢闸门——快闸门保住开发者心流，慢闸门保住合并质量；两层的调优口径统一为「等待时间」，而非覆盖率或机器数。与「确定性判定为主、语义判定为加签」同构：确定性的跑快车道，语义的跑慢车道。

> 📖 来源：[Linear 工程博客《重构 CI 应对 AI 编码的验证瓶颈》](https://aihot.news/items/cmublfs5a03bcro0lebbtf8fb)（2026-09-21，官方一手）；与知识库 Grind Tool 最低运行时间、thinking budget 上限互证——预算下限防提前放弃、上限防过度思考，上下限都该是显式参数

### 编排兜底：确定性规则引擎接管

Harness 的另一价值点是**「不依赖 AI 也能守门」**。当 LLM 不可用 / 不可靠 / 被降级时，确定性规则引擎（纯 git-diff 正则 + 配置化约束）照常运行，以 **deterministic guardrails** 身份兜底接管——Agent 的「智力」可以暂时离线，但「纪律」不能停。

行业五层里「纯规则校验可脱离 AI 运行（模式 D）」直接支撑这点：部分「智能体」只需约束规则、不需要大模型。sofagent 24 条规则中 19 条纯 git-diff、零 token、不调 LLM，正是「AI 不可用时，纪律仍在」的工程实例——这与「约束层 = Harness」互为表里：约束层的价值不绑定任何单一模型的可用性。

### 反去人化命题：human-in-the-loop 是「可靠优先」价值点

行业一派主张「去掉人」（L4 Hill-Climbing 去人化）。sofagent 反其道——human-in-the-loop 不是能力缺陷，而是**可靠优先于自主**的差异化优势。

人在 loop 中可尽量简单（高风险才人工确认，常规受信自动执行，见 [FORGE 四节点状态机](./guides/loop-development.md#四节点状态机v113)），但**必须存在**——主体性护栏不可外包（PHILOSOPHY §四）。这与「约束层永远在线 + 审计硬证据」同源：可靠不是靠更聪明的模型，靠「人在关键处 + 机器在每处」。

### 90/10 价值分层 → 知行合一框架

模型给 90% 智力（**知**），sofagent 补 10% 可靠执行（**行**）——关键在「**合一**」：模型之「知」落到 sofagent 之「行」（约束注入链永远在线 + 审计硬证据 + 责任归属），让「知道」变成「做到」（完整论述见上方 [知行合一注脚](#知行合一注脚)）。模型越强，那 10% 的「行」越值钱。

### 治理缺口的代价：三项联网核验证据

以下 3 条为 2026-07-20 联网核验的可信行业证据：

- **Gartner（2026-05）**：到 2027 年 **40%** 企业的自主 Agent 将因治理缺口被降级 / 停用。出处：Gartner 2026-05 Agent 治理预测。
- **MIT NANDA**：**95%** 的 gen-AI 部署零可衡量 ROI——根因是治理 / 数据就绪缺口，而非模型能力。出处：MIT NANDA 生成式 AI 部署回报研究。
- **Governance Decay 论文**：运行时约束被上下文压缩擦除后，违规率从 **0% → 38%**（直接印证「约束必须永远在线」）。出处：Governance Decay 论文（运行时约束衰减研究）。

三条共同指向：约束 / 治理不是「加分项」，是 Agent 可投产的前提——与 sofagent「约束层永远在线」同源。

> 📖 来源：联网核验（2026-07-20）· Gartner / MIT NANDA / Governance Decay 论文

### a16z 七法则映射

> 📐 来源：a16z（2026-07-15，Hebbia 创始人 George Sivulka）[《You Just Hired a Million Bad Employees》](https://www.a16z.news/) 核心判断——「人类历史上第一次，人比软件便宜」；每家公司在雇「一百万个糟糕的硅基员工」，80% 的 token 在空转浪费。解法不是更强的模型、也不是更多算力，而是 185 年前诞生的老手艺：**管理**。

这与 sofagent 底层定位同频：**约束层 = 管住 Agent 行为的那一层**（River 比喻里的约束层）。a16z 七法则中 Loops / 100X / 冗员 / Evals / 转型 五条，sofagent 已原生具备对应物。完整映射见下方表格；其中最关键的三条：

- **空转 Loops → guard edge**：`graph.ts` 的 `retryCount<3` 条件路由天然防 loops 失控——这是 Loops 治理的工程化答案。
- **考核 Evals → Reality Anchor**：审计模块 A1-A11、A14-A23 + E1-E2/E4（共 24 条）把「可评估性」硬编码为真实 git diff，而非 Agent 自报完成。
- **万亿转型 → FDE 卖转型**：FDE = Services-as-Software，交付「装进 Agent 的常驻 FDE Harness」而非工具包；ROADMAP 已有 4 条市场信号互证。

**a16z 十项映射（七法则 + 三项规模化缺口）完整映射**（a16z 概念 → sofagent 对应 → 现状 → 落地版本 → 说明）：

| # | a16z 概念 | sofagent 对应 | 现状 | 落地版本 | 说明 |
|---|------|------|:--:|------|------|
| 1 | 事实1 成本倒挂（人比软件便宜） | 90/10 价值分层 | 已具备（叙事） | 叙事支撑 | Harness = 把 p90 拉回 p10 的管理杠杆 |
| 2 | 事实2 增员非裁员（AI 放大组织） | FDE 卖转型 + sustain | 已具备（定位） | 叙事支撑 | AI 放大组织，sofagent 管放大后的队伍 |
| 3 | 1841 铁路事故 → 现代管理 | guard edge + Reality Anchor + River 约束层 | 已具备 | 叙事背书 | 直接引用作 Harness 必要性历史背书 |
| 4 | 法则1 挥霍 Tokenmaxxing | 约束层 + 明确不做 + FDE 讲清流程 + Ontology | 已具备+可强化 | 印证 | FDE 把模糊流程讲清即抗 Tokenmaxxing |
| 5 | 法则2 空转 Loops | graph.ts guard edge retryCount<3 | 已原生具备（核心） | 印证 | Loops 治理工程答案 |
| 6 | 法则3 冗员 Token Bloat | 明确不做清单 / 防 scope 蔓延 + 审计拦改测试 | 已具备+可强化 | 印证 | 砍循环优于优化 |
| 7 | 法则4 杠杆 100X Token | 90/10 分层 Harness 可靠性最值钱 | 已具备（叙事） | 印证 | 那 10% 即文章「管理杠杆」 |
| 8 | 法则5 政治 上下文囤积 | 不投喂 / 数据主权 + 知识主权归客户 | 已具备（差异化） | 印证 | 叙事回应组织政治 |
| 9 | 法则6 考核 Evals | 审计 A1-A11、A14-A23 + E1-E2/E4（共 24 条）= Reality Anchor + Dream Cycle eval 驱动 | 已具备（底座）+ 缺口 | v1.3.1+ 产品化 | 企业专属 eval 套件缺口 |
| 10 | 法则7 万亿转型服务 | FDE = Services-as-Software + 市场信号互证 | 已具备（核心背书） | 印证 + 规模化缺口 | a16z 最重磅外部背书；规模化交付进未来迭代 |

### 红杉 Neo-Lab / Sovereign AI 四层主权

- **「主权是光谱不是开关」**——红杉说绝大多数公司该待在中间档（开源基座微调 + 核心场景自有模型 + 长尾外调），别一上来就搞最重的全量训练。这与 sofagent 的「通用模型路由不自研——企业挂第三方 model router，只保留数据主权路由 + 注册/灰度/退役」（v1.3.6 已定）完全同构。
- **「先建评测集，再谈微调」**——红杉的落地顺序与 sofagent 的 Benchmark 先行 + `define_acceptance` 机器可判定验收一致：没有业务评测的微调全是瞎调。

**四层主权 → sofagent 落点**（商业侧定位详见 [v1.4.0](./changelog/v1.4/v1.4.0.md) / [v1.4.7](./changelog/v1.4/v1.4.7.md)）：数据主权 = ontology + 审计（已具备）；模型适配 = 后训模块 v1.4.x；评测迭代 = Benchmark + MLflow；部署 = 本地权重 + 灰度切换 + 审计 + 回滚——「权重 ≠ 主权」，「能跑模型」不等于「能管住模型」。

### 硅基员工论：Org Graph 与 Ontology Runtime

- **Org Graph = 进组织架构的硅基员工**：研报把「长期存活、固定领域、保留上下文与工具权限」的 Agent 称为 Org Graph 节点，与 sofagent 核心定位字面对应——AI 不是效率工具，是进组织编制、有独立账号、接受绩效考核的硅基员工；FDE 交付的「常驻 Agent」正是 Org Graph 的企业落地形态。
- **Ontology Runtime 是 AI Native 企业底座，非 API 网关**：研报强调 Runtime 接管的是「语义边界」而非重建核心系统（CRM/OMS/ERP 之上的一层），企业系统边界从「系统接口」转移到「业务对象运行时」。与 sofagent「约束层 = 给模型搭脚手架、约束注入链永远在线」同源——我们不做业务系统，做业务系统之上的约束层。

### 数字员工操作性定义：四跨越 + 结果负责三要素

行业参考区分「数字分身」（服务个人、替代时间）与「数字员工」（服务组织、承接职责、对结果负责）。数字员工进组织需完成**四跨越**：

1. 组织身份（有账号、在编制）
2. 岗位职责（有清晰 KPI）
3. 事件驱动（主动接活）
4. 结果负责（对产出后果负责）

**结果负责三要素**（与审计 / 回溯能力对齐）：可观测（行为留痕）/ 可归因（责任到人 · Agent 身份）/ 可回滚（出错能退）。

### 测量者转型：从「月底审计报表」到「每次 AI 行动留日志」（Cloudflare 实证）

> 📖 来源：Cloudflare CEO Matthew Prince《How I Choose Which Cloudflare Employees to Replace With AI》（WSJ 一手访谈，2026-06）

Cloudflare 2026-05 裁撤超 1100 人（约 20%）并转向「agentic AI-first operating model」——CEO Matthew Prince 不按部门分人，而把工作角色分成三类：

| 角色 | 职责 | AI 替代风险 |
|------|------|------------|
| **Builder 建造者** | 做产品、搭系统、创造新能力 | 相对安全 |
| **Seller 销售者** | 理解客户、建立信任、促成收入 | 相对安全 |
| **Measurer 测量者** | 记录、汇总、审查、协调、报告 | **最先被 AI 逼近** |

**核心洞察（对 sofagent 最值钱的一句）**：判断工作安全度不看岗位名称，看承担的角色——被 AI 重新定价的不是整个岗位，而是**输入完整、标准清楚、结果可验证的具体任务**。这与 sofagent 审计模块的判定哲学同构：我们不审「Agent 是谁」，审「这个 diff 是否满足确定性标准」——输入（git diff）完整、标准（24 条规则）清楚、结果（PASS/FAIL）可验证。

**测量者的反常识转型**：测量类岗位减少，但「测量」这件事不会减少，反而无处不在——当 AI 智能体可以查数据、发邮件、改价格、调用预算，企业必须知道：**它读过什么、做过什么、花了多少钱、有没有越权、出问题能不能撤回**。以前是月底一张审计报表，以后是**每次 AI 行动都留日志**，每个团队实时看成本、质量、安全和权限。

> 💡 **这就是 sofagent 审计模块 + daemon + worklog 的行业定位印证**：把「测量、合规、安全、成本控制做进系统里」，让常规动作自动通过、少数异常准确找到专家——「强中台」的测量者形态正是约束层（Harness）的工程化。吴恩达把 AI 打破各环节「速度比」后的瓶颈称为「法务合规瓶颈」（legal compliance bottleneck）——强中台不是养庞大测量者队伍，是把测量做进系统，对应 sofagent 不做「审计人员外包」、做「审计模块基建」。

**▍厂商实证——Harness 品类被多方独立验证（DeerFlow / DeepSeek / OpenAI / Omnigent / DataFlow / OpenFDE，逐家印证「约束层」是行业共识）**

### DeerFlow：大厂用「Harness」命名

字节跳动开源的 [DeerFlow 2.0](https://github.com/bytedance/deer-flow) 自称 **"super agent harness"**——与 sofagent 的 **Harness 中间件**品类判断**字面一致**。这是继 OpenAI《Harness Engineering》、Anthropic《Effective Harnesses》之后，**又一家头部厂商用 Harness 命名 Agent 运行时框架**，说明这个品类词已经站住。

但 DeerFlow 是 River 比喻里的**「河」**（运行时框架，让 Agent 跑起来的基础设施），sofagent 是**约束层**（让 Agent 别跑偏 + 审计它跑过什么）——两者定位互补，不冲突：

| 维度 | DeerFlow | sofagent |
|------|---------|---------|
| 本质 | Super Agent 运行时框架 | 约束层（Harness） |
| 语言/栈 | Python (FastAPI + LangGraph + uv) | TypeScript/Node |
| 安全在哪 | 运行时（沙箱 + fail-closed + 中间件链 26 步）| 提交时（git diff 24 条规则）+ 运行时约束（SKILL.md）|
| 部署重量 | Nginx + Gateway + Postgres，起步 8C16G | `bash install.sh`，仅需 Node.js ≥ 18（无外部基础设施依赖） |
| 约束方式 | 需 Agent 跑在它的框架里 | 看 git diff，Agent 在哪跑都行 |

**给我们的背书**：① Harness 品类被字节用真金白银验证；② LangGraph createReactAgent 是编排事实标准（双方都选）；③ 控制平面打法（runtime 内嵌 gateway = 控制平面）是行业共识。**给我们的启发**（进 ROADMAP 与开发日志）：中间件链设计、Skill 质量门禁 + content-hash、Session Goals、ToolOutputBudget、多 worker 租约安全语义——详见 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。

> 📖 来源：DeerFlow 2.0 README（github.com/bytedance/deer-flow），2026-02-28 登顶 GitHub Trending #1

### DeepSeek Harness：模型厂商验证「Harness 独立于模型」

DeepSeek 2026-08-13 开源 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`Agent = Model + Harness` 公式的开源运行时，100.5k stars · MIT · developer preview）：[Cordis](https://github.com/cordiverse/cordis) 微内核只管插件加载/卸载/依赖解析，模型适配器、工具注册表、会话日志、Agent 循环本身全是插件——**厂商级验证了「Harness 独立于模型、可整体组合替换」的品类判断**。

与 DeerFlow 同为运行时（河），sofagent 同为约束层（堤），但 DSH 的特殊价值在于它是**模型厂商**做的开源运行时，且其机制与 sofagent 深度同构：

| 维度 | DeepSeek Harness | sofagent |
|------|-----------------|----------|
| 本质 | Agent 运行时（一切皆插件） | 约束层（Harness） |
| 谁做的 | DeepSeek（模型厂商） | 开源社区 |
| 可逆性 | 可撤销效应：每次修改记录逆操作，卸载逆序恢复 | git snapshot 回滚 + 审计日志记录「做了什么+如何撤销」 |
| 事件留痕 | append-only Trajectory（恢复/分叉/回放共享事件流） | 审计日志 + decision-log |
| 权限模型 | 两旋钮正交：沙箱（文件效果边界）× 审批（决策通道，fail-closed） | v1.3.7 场景驱动权限（设计轴对齐） |
| 审计入口 | `tools/result` 观察不可变权威结果 | git diff 24 条规则（提交时） |

**给我们的背书**：① 模型厂商把「模型之外的能力全拆成插件」——Harness 与模型解耦不是创业公司的一厢情愿，是头部模型厂商的路线判断；② Cordis 论文（[时空可组合性](https://github.com/cordiverse/paper)）「自进化的难点是修改后的可恢复与可协调，不是生成能力」与 sofagent「进化必须以可撤销为前置条件」同构；③ DSH 任务面板缺验收标准、修改流程缺回归声明（生态级 Eval 缺口）——sofagent 审计模块正是补这个缺口的插件候选（v1.4.0 `@sofagent/cordis-plugin`）。

> 📖 来源：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 官方仓库 docs/（architecture + cordis-tutorial，2026-08-15 核验），MIT

### OpenAI Codex Harness：头部模型厂商把「Harness 决定 Agent 表现」官方量化

OpenAI 2026-08-19 全面开源 [Codex Harness](https://github.com/openai/codex)（Apache-2.0，107k+ stars）——驱动 Codex App/CLI/IDE 的底层执行框架（对话状态、工具调用、沙箱执行、流式输出、人工审批）。开源的是**三层集成接口**而非模型：`codex exec`（轻量非交互 CLI）+ Codex SDK（TS 程序化编排，支持任意 OpenAI 兼容端点模型切换）+ `app-server`（持久会话产品层，官方原话 "your application owns product context, business rules, and tools; Codex app-server provides the agent loop"）。

**给我们的背书——官方量化「Harness 决定 Agent 表现」**：OpenAI 在 ARC-AGI-3 基准上仅对 Harness 做两项调整（保留推理 + 上下文压缩），GPT-5.6 Sol 得分从 **13.3% → 38.3%**，输出 token 消耗**降 6 倍**——「模型能力 × Harness 设计 = Agent 最终表现」被头部模型厂商官方数据实证，正是 sofagent「模型给 90% 智力、约束层补 10% 可靠执行」叙事的最强外部锚点。

> ⚠️ **量纲限定**：该数据证明的是 **Harness 设计显著影响表现**——而这里的「表现」是**能力型**的：保留推理 + 上下文压缩提升的是**任务得分与 token 效率**。sofagent 主张的是**治理型**约束层提升**可靠性**（该做的事都做、不该做的不做、做错退得回）。**两者非同一量纲**，故本数据仅作**方向性信号**（「Harness 这个层很重要」），**不得**读作可靠性收益的量化依据；与既有「厂商自测只作量级参照」纪律一致。

**与 sofagent 的工程同构点（仓库源码核验，2026-08-22）**：
| 维度 | Codex Harness | sofagent |
|------|--------------|----------|
| hook 体系 | Claude Code 兼容生命周期 hooks（`pre-tool-use` / `post-tool-use` / `permission-request` / `subagent-start` / `session-start`，JSON in/out 命令行引擎） | 约束注入链 + audit（提交时 git diff）+ HITL 钩子 |
| 身份码 | Ed25519 agent-identity（JWKS 签发） | v1.3.1 Agent 身份码 Ed25519（同构） |
| 审批 | 内建 HITL（关键操作暂停请求人类确认）+ 多 permission_mode | 工具审批四模式 + HITL 钩子 |
| 分发 | 插件市场（marketplace.json，兼容 `.claude-plugin` / `.cursor-plugin` 格式 + 企业 allowlist/restricted 策略） | ClawHub/SkillHub 分发（双生态） |
| 沙箱 | 内建沙箱（Landlock + seccomp / Windows sandbox） | v1.3.7 SubAgent 沙箱 |

**sofagent 挂载机会**：Codex 的 `pre-tool-use` hook 与 DSH 的 `tools/pre-execute` **功能同构**（工具调用前拦截 + permission_mode），且 hook 协议是 Claude Code 兼容的 JSON 命令行格式——sofagent 审计/拦截可作为 Codex 生命周期 hook 挂载（v1.4.0 OpenClaw plugin 家族之外的第三个生态位候选，排期待议）。

> 📖 来源：[openai/codex](https://github.com/openai/codex) 官方仓库（2026-08-22 源码核验）+ [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)（openai.com，2026-08-19），Apache-2.0

### OpenAI Agents API 公测：Harness 托管商品化与治理壁垒收窄（2026-09-10）

OpenAI 2026-09-10 把驱动 Codex 的 Harness 通过 [Agents API](https://openai.com/index/introducing-the-agents-api/) 公测开放——"Build and run cloud agents with the Codex harness, fully managed by OpenAI"。这是继 2026-08-19 开源 Codex Harness 后的第三个独立数据点：**模型厂商不仅开源 Harness，还把 Harness 托管做成零平台费的基础设施**（无额外费用，只收 token/工具/容器钱）。

**关键架构事实**：Harness（循环/会话/压缩/子Agent）永远 OpenAI 托管；Environment（执行沙箱）可选 OpenAI 托管/自托管/9 家伙伴（Cloudflare、Modal、E2B 等，支持 VPC 内部署）——**自托管的只是执行环境，控制平面与执行平面在架构上分离**。四大能力全是过去开发者自造的轮子：自动上下文压缩（跨多窗口，无需自建 compaction）、tool search（按需加载工具定义降 token 保 cache）、programmatic tool calling（代码并行/链式/过滤，只回传关键结果）、multi-agent 原生（subagent 各自独立上下文）。

**对我们的意义——两条战略判断被官方一手源实证**：

1. **编排层护城河在消失**：loop 管理、上下文压缩、工具编排、多 Agent 编排正在变成免费绑定的 API 能力（得到大脑解读：企业差异化收窄到「业务上下文、可信数据、actions、权限控制、人工审批」——这份清单几乎逐字就是 sofagent 能力面）。壁垒表述随之收窄：**不在 harness 工程，在治理工程**（24 规则 / HMAC 链 / 本体数据 / 审批流）——与 Codex ARC 数据的量纲限定同理（能力型表现 ≠ 治理型可靠性），治理壁垒不会被基础设施商品化覆盖。
2. **压缩不是审计记录**（compaction 后原始内容不可恢复）——印证审计证据链必须独立落盘的设计：sofagent HMAC 链 + runs/ 产物从不依赖模型上下文作证据。推论：若业务 Agent 跑在托管 harness 上，审计接入点必须在 event 流层（router_exporter / trajectory 采集），不能依赖平台会话存储。

客户证言数字（官方博客 8 条之一）：Ciridae 评分 0.71→0.85、subagent 流程 4 倍延迟降低；SafetyKit 每案成本 −60%；Hypha harness/沙箱分离后失败响应 −86%。第三方分析口径：仅美国数据驻留、不支持 ZDR——中国企业客户硬门槛，一体机私有部署（27B 稠密）的官方背书市场缝隙。

> 📖 来源：[Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/)（openai.com，2026-09-10 · 官方博客 · A 级源）+ 得到大脑视频解读（2026-09-15，第三方表述框架）

### Anthropic 产品真相收敛：运行的生产代码是产品最可靠的事实来源

Anthropic 设计负责人 Joel 分享的产品方法论判断：产品文档会过期、设计稿会过期、在线文档会过期——**真正运行的生产代码里存着此刻真实的功能规则、设计系统和产品逻辑**，因此产品、设计、研发的边界会围绕真实运行的系统重新组织。对 sofagent 的印证价值：审计模块「不看 Agent 说什么，看 git diff 留下什么」正是这一判断的治理面工程化——把「产品真相」锚定在运行系统的一手输出而非任何转述层，与 PHILOSOPHY 证据链（一手信息优先、二手声明不进证据链）同源。附带印证：AI 时代「生产能力不再稀缺、选择能力开始变贵」（供给暴涨而需求注意力不变，价值落差靠判断去填）——与「判断力上移」这一既有命题（执行可外包、判断不可外包）及 90/10 价值分层同构，不另立命题。

> 📖 来源：Anthropic 产品设计负责人 Joel 访谈（得到大脑解读，2026-09-14，第三方表述框架——一手访谈出处未核验，按单源第三方对待）

### Codex Guardian 模块：审查结论的失效语义（2026-09-16 源码核验）

codex-rs 深处有个此前未研究过的 [guardian/](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian) 模块（约 340KB，测试过半）——「宿主审批决策 + 隔离的同步审查者」。模块文档一句设计哲学值得引用：*"The extension chooses policy and evidence; core enforces permissions and mandatory review requirements"*（扩展选策略与证据，核心强制权限与强制审查——与 sofagent「插件定义规则、引擎统一执行」同构）。

**对我们最有价值的是一套此前没有的语义——审查结论何时失效**（`GuardianReviewReason` 枚举）：`FreshRequired`（需新鲜结论）/ `StaleScore`（分数过期）/ `AuthorizationChanged`（授权变更即失效）/ **`IncompatibleCompaction`（压缩与审查结论不兼容即作废重审）** / `ElevatedRisk` / `ScoringFailure`。sofagent 现状：审计结论与 HITL 授权一经产生即视为永久有效，无失效条件。`IncompatibleCompaction` 是「压缩不是审计记录」的**工程化背书**——官方把 compaction 明确列为审查结论的作废条件，比叙事判断更硬。配套语义：审批粒度 `Granular`（五类开关，关闭即**自动拒绝而非静默吞**——fail-closed 不打扰人）与按 host 粒度的网络出口审批（`NetworkApprovalContext{host, protocol}`——管进也要管出）。

> 📖 来源：[openai/codex guardian/](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian)（2026-09-16 源码核验，mod.rs + approvals.rs + protocol.rs），Apache-2.0

### Omnigent：meta-harness 把策略强制在基础设施层

[Omnigent](https://github.com/omnigent-ai/omnigent)（Databricks 系团队开源，Apache-2.0，alpha，31 天 7091 star）自称 **meta-harness**——坐在 Claude Code / Codex / Pi 等 harness 之上的一层。它把我们的「Harness 中间件」判断又往前推了一步，给了两个可引用的硬证据：

1. **策略在基础设施层强制，不在 prompt**：原文——*stateful, contextual policies ... enforced at the meta-harness layer, not via prompts*。它的权限策略能「在 Agent 刚装了未审查的 npm 包后，拦截下一次 git push 要求人工批准」——因为 prompt 指令无法知道 Agent 刚装了包，而基础设施层可以追踪动态状态、在动作发生**前**拦截。这与 sofagent「文字约束每次注入=投喂 → 必然被吞噬 → 生存位=封装进 SubAgent（代码层）+ 防投喂机制」**是同一个结论，只是人家的工程化版本**。
2. **密钥不进 Agent 进程**：OS 级沙箱（Omnibox：Linux bwrap+seccomp / macOS seatbelt）锁文件系统，egress proxy 在 approved 出站请求时才注入 GitHub token / API key，Agent 进程永远看不到明文凭证。这是「架构级强制」，不是「别泄露凭证」的指令。

**与 sofagent 的边界（互补，不冲突）**：Omnigent 管**运行时**（坐在 harness 之上，拦截工具调用）；sofagent 管**提交时**（git diff 24 条规则 + 运行时 SKILL.md 约束）。它的策略越重，越反衬「跨平台、本地留证、零依赖、提交时审计」是咱们的地盘。其路线图（GEPA 自动优化 / MemEx 持久记忆 / RLM 强化学习 / Server MCP 跨会话）尚未实现，方向登记进探索方向表按 W1–W5 准入判据评估（研究叙事，非版本承诺）。

**给我们的演进启示（已登记 ROADMAP）**：① 运行时审计可借 LangGraph middleware 的 wrapToolCall 接入点（咱们已用 createReactAgent）；② 密钥边界可借 bubblewrap/seatbelt + egress proxy 模式；③ 控制平面成本/路由层可借 LiteLLM。详见 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。

> 📖 来源：[Databricks blog《Introducing Omnigent》(2026-06)](https://www.databricks.com/blog/introducing-omnigent)（官方一手源）· GitHub omnigent-ai/omnigent

### DataFlow：顶尖高校独立用「Harness」命名

[DataFlow](https://github.com/OpenDCAI/DataFlow)（论文 [arXiv:2607.16617](https://arxiv.org/abs/2607.16617)，HuggingFace Paper of the day）来自**北京大学 DCAI**团队——与 DeerFlow 2.0（字节）、Omnigent（Databricks）**同月**，再次以独立开源项目用「Harness」一词命名其 Agent 约束层。这是**第三个、且来自顶尖高校的第三方独立佐证**：Harness 作为 Agent 工程化品类的共识已非孤证。

它治理的是「数据流水线」（从噪声源生成 / 精炼 / 评估 / 过滤高质量 AI 数据），与 sofagent 治理「企业 AI 数字员工（装进 Agent 的 FDE Harness）工作流」对象不同，但**约束范式同源**：Agent 经 MCP server 作业而非自由写脚本、受控变异走 Request-Validate-Commit、用 DataFlow-Skills 结构化约束而非裸提示词——每一条都独立复现了 sofagent 的 scoped tool-gate / SKILL 约束层 / audit 判断。

其**独特点**是可借鉴方向：① **可视化 DAG 画布 + 双模态共享状态**（会话 Agent 与 DAG 画布实时同步同一 pipeline 表示）——补 sofagent Dashboard 缺的「workflow 可视图」，建议 v2.x 引入；② **MCP server 集成**（暴露算子注册表 / serving / pipeline 状态给 Agent）——印证「对外 MCP 暴露 ontology/audit」是合理路线，建议 v2.x+；③ **Validation Engine（DAG 无环 + schema 兼容）**——印证 ontology 从目录级升级为带 JSON Schema 校验的约束图，建议 v2.x 硬化节点 I/O。以上可借鉴项已落入 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。

**给我们的背书**：① Harness 品类被顶尖高校用真金白银验证（同月三家，含高校）；② 「约束 Agent 经受控接口、不自由写脚本」是跨团队共识；③ 我们的差异化仍在——DataFlow 只校验 pipeline 结构与 schema，**不审计 Agent 行为问责（无 append-only A1-A23）**，也无 7×24 常驻 FDE Harness 层与「控制平面治理」定位。

> 📖 来源：[DataFlow](https://github.com/OpenDCAI/DataFlow) + 论文 arXiv:2607.16617（2026-07，HuggingFace Paper of the day）

### OpenFDE：FDE 术语同源佐证

[OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo)（OpenFDEAI 组织，MIT）以 **Forward Deployed Engineer** 命名其「边聊边出 Demo」的售前工作流——FDE 坐在客户对面，边聊边把需求变成可点的 Demo，散会时客户手里已有一个能点的 Demo + 一页可确认的需求清单。它和 sofagent 的**「前线部署工程师 / Forward Deployed Engineer」同源、同英文写法、来自同一 Palantir 脉络**——印证我们 FDE 术语的正统性：把工程师部署到客户现场、用一套纪律化交付流程、把经验沉淀为可复用资产，本就是行业共识的 FDE 内核。进一步佐证来自 OpenFDE **主仓**：它把 **INDUC 显式成 FDE Loop 的一个阶段、产出可开关的 Judgment Unit**（专家判断资产化、规则可开可关可版本化）——与我们「蓄水池/知识库 → A1-A23 判定层」同源，但它把知识归纳提升为 Loop 的一等公民阶段。

但两者**范围差一个数量级、且互补**：ChatDemo 的 FDE 是售前 POC 共创工具（Claude Code Skill + localhost 控制台，回合制 start/turn/wrap），散会即结束、无常驻员工；sofagent 的 FDE 是售后常驻部署+治理方法论（四阶段十二步→交付离场→sustain）。它做"漏斗前端"（拿 POC），我们做"漏斗后端"（常驻、可审计、受治理的硅基员工）——定位不冲突。

其**独特点**是可借鉴方向（已登记 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)）：① 回合制协议 + FDE 控节拍（人控 Agent 不抢跑，我们已有同判断、它执行更细）；② **spec-first 硬禁令**（transcript 永不直接驱动代码——补我们"触发直驱工件"的明文铁律，最高优先）；③ **decisions.jsonl 判断时刻日志**（{kind, moment, why, spec_ref} 现场即时记，会后喂 FDE Loop→INDUCE→Judgment Unit——补 A1-A23 缺的"决策理由链"，最高优先）；④ 分级降级梯队（console→TUI、ASR→手敲、dev 挂→走 spec，workflow never stops——为 7×24 常驻员工补分级降级 SOP，最高优先）；⑤ 开源优先阶梯 + 预验证画廊 + 双引擎无状态 + 数据敏感度分层 + 一键启动器品牌化模板。

**给我们的背书**：① FDE 作为"前线部署工程师"的方法论术语，已被 OpenFDE 以 Forward Deployed Engineer 独立命名并工程化，与我们同源、互为第三方佐证；② "约束 Agent 经受控接口"的同源判断在售前侧也成立（ChatDemo 约束在"何时/权限/来源"）；③ 我们的差异化仍在——ChatDemo **无 A1-A23 运行时行为审计、无 7×24 常驻 FDE Harness 层、无控制平面治理、让 Agent 直接写应用代码**，这些是我们的地盘。

> 📖 来源：[OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo)（github.com/OpenFDEAI/ChatDemo，2026-07），OpenFDE 主仓 Open-FDE/OpenFDE

---

**▍跨域实证——eval/记忆/训练基建/Skill 形态的独立佐证（OpenAI 方法论 / 记忆综述 / Agent RL / Omarchy，主题超出「Harness 品类命名」范围的后续小节归此）**

### OpenAI：build-prove-generalize 三段循环

[OpenAI 官方业务页](https://openai.com/business/the-openai-deployment-company/) 把 FDE 的工作方式写成一条公开方法论：「与其从一个通用产品出发，FDE 团队直接与客户合作解决一个**具体**问题，验证影响，然后识别出可规模化的**模式**」——这个循环被官方命名为 **build, prove, generalize**，作用是「把部署与产品开发连接起来」。

它与 sofagent 进化模块的经验回流路径逐字对位，也与 YC FDE Playbook（Bob McGrew）的「碎石路 → 高速公路」是同一循环的两种命名。真正有增量的是 `prove` 的落法：在 John Deere 案例中，OpenAI 与领域专家复盘数百个真实样例后**构建了定制评估系统度量准确率**，再谈规模化（结果：农户化学品用量降 70%，客户互动提升 6 倍）。

**对我们的意义**：`prove = 建定制 eval`，这句把审计模块从「成本项」重新定义为**产品化的前置条件**——先能度量，才谈得上泛化。三段式命名也比比喻更适合对外沟通，可直接用作交付 SOP 的阶段划分。

> 📖 来源：[The OpenAI Deployment Company](https://openai.com/business/the-openai-deployment-company/)（openai.com，2026）

### OpenAI Agents SDK v0.22.0：运行时加固实证四因子乘积模型

[OpenAI Agents SDK v0.22.0 官方 release notes](https://github.com/openai/openai-agents-python/releases/tag/v0.22.0)（2026-08-19 发布）官方定性 "substantial runtime hardening"。三处实证：① 被 output guardrail 拒绝的工具输出从可重放/持久化状态**脱敏**（guardrail 拦截 + 审计留痕）；② 非流式 Responses 终态 failed/incomplete 显式抛 `ModelBehaviorError`（失败不静默）；③ 显式 client 与 provider 配置冲突直接拒绝（配置可信）。

**对我们的意义**：模型能力 × 运行时可靠性 × 数据可信度 × 权限与审计——四因子乘积模型被官方一手源实证：后三因子正是约束层的活（审计拦截 + 失败显式化 + 配置硬校验），模型给 90% 智力、约束层补 10% 可靠执行（与本节 90/10 价值分层同构）。

> 📖 来源：[openai/openai-agents-python v0.22.0 release notes](https://github.com/openai/openai-agents-python/releases/tag/v0.22.0)（2026-08-19 · 官方 changelog · A 级源）

### 记忆要笨：应用层记忆的死亡测试

清华唐杰团队联合新国大、玻色 AI 的综述《Memory for Large Language Models》把记忆从「算力副产品」正式升格为「模型架构的第一性维度」——并给出两条与我们直觉直接对位的结论。

**第一条：模型内部记忆出场后加不进去。** 综述用「刚性（rigidity）」标注 ANM（人工神经记忆）的核心风险——门控参数只在预训练时开放，出场即焊死，LoRA 外挂记忆的实验中模型降损最快的方式就是关门。一句话：**模型身体里的记忆是厂商地盘，应用层碰不了。** 这与我们「智能属于模型，控制属于系统」的设计主线（见 PHILOSOPHY §一）同源——git-diff 审计要的是确定性规则而非概率推理，HMAC 防篡改要的是密码学而非语义理解，append-only 留痕要的是不可变日志而非上下文窗口。模型可以越来越会记，但「记得什么」的判断权不在我们这层——我们能守的，是模型永远给不了的三样东西。

**第二条：应用层记忆只做「笨事」。** 综述的前沿图景是模型自己分层消化原始记忆（精确层 + 压缩层，模型自己决定哪些进哪层）——应用层手搓的「切块→向量化→检索→重排」会被模型内置记忆取代。按「等原始记忆能全量丢进模型、召回接近完美那天，这个功能还有意义吗」这把死亡尺子量下来，剩三样不需要聪明：**一样不忘（全量 append-only，不筛选/不打分/不压缩）、可带走（记忆长在文件里而非权重里，换模型/换设备都能通读）、入口在本地（本地文件/邮箱/其他模型对话，模型永远不知道）**。

**对我们的意义**：这把 Ralph 循环「Agent 失忆，文件不失忆」从工程直觉升维为架构定律。我们一直在做的事——think.md 与审计链的 append-only 契约、Ledger→Views 严格单向派生（Dream Cycle 夜里整理，原始记录一个字不删）、FDE 知识主权归客户——恰好就是综述定义的「笨笨保管」。一句话对位：**模型负责聪明的回忆，约束层负责笨笨的保管——模型在千万 token 里找到那句话，约束层保证那句话十年后还在、还查得到出处。**「写入笨、派生灵活」也由此立得住：写入端（Ledger）绝对不压缩，派生端（Views/knowledge/）可自由整理——这与 PHILOSOPHY §五 think.md 契约的「单向派生」完全同构。

> 📖 来源：唐杰团队等《Memory for Large Language Models》（2026 综述）

### harnessed agentic RL：训练域同行验证「审计按 commit 留痕」

2026 年 8 月成熟的 Agent RL 训练基础设施，给出了一个与约束层审计粒度直接对位的设计取舍——**归因单位必须是完整的一次执行，不是单次调用**。

Agent Lightning v1.0（arXiv 2608.17528，微软）实测：因为轨迹合并，coding 场景里每个 rollout 平均展开成 **2.41 个训练样本**，只有 **36% 的 rollout 能保持为单一训练样本**——「一次调用 = 一次归因单位」的假设在真实 Agent 轨迹里根本不成立。这与审计「按一次完整变更（commit）留痕、而非按单次 LLM 调用」的设计同构：审计粒度对齐的是任务单元，不是调用单元。

同一取舍在另一套独立系统里再次出现：阿里的 Dressage（Accio-Lab，建在 slime 上）的 segment-aware training 里，轨迹因历史压缩或工具 schema 变化被切开后，每个 segment 都会展开成训练样本，但 **reward 与 advantage 仍以整条 trajectory 为单位**——只有 anchor segment 承载终局 reward，再广播给 sibling segments，并用 prompt-equal denominator 防止「切得越碎、梯度权重越大」。样本可以拆分，归因保持完整执行级——这是两套系统不约而同划出的边界。

> 📖 来源：[Agent Lightning v1.0](https://arxiv.org/abs/2608.17528)（微软，2026-08）；[Dressage](https://github.com/Accio-Lab/Dressage)（阿里 Accio，2026-06）

### Omarchy：SKILL.md 形态收敛与单一权威源纪律

DHH（Rails 之父）的 Omarchy——「有主见」的 Arch Linux 桌面发行版——用 15 个月（2025-06 建仓）冲到 35.3k stars，且几乎每个 commit 都有 AI 共同署名（Claude/Codex 系）。它给两件我们正在做的事提供了独立佐证。

**第一件：SKILL.md 不是小众发明，是正在收敛的 Agent 接口形态。** Omarchy 把带 frontmatter 触发词的 `SKILL.md`（「要编辑 `~/.config/hypr/` 就必须用这个 skill」）随产品安装到用户机器 `/usr/share/omarchy/`，内含安全红线（「`/usr/share/omarchy/` 只读永不编辑」）、命令组速查、决策框架七步——与我们 `SKILL/` 经 install.sh 装到 `~/.sofagent/skills/` 的分发完全同构，且 Claude Code 对 SKILL.md 已是原生支持。当头部开发者的装机量级产品把「约束 AI 别乱改文件」做成随产品分发的 skill，这个形态就从我们的工程选择变成了行业接口。

**第二件：反漂移靠「禁二份」纪律，而非全仓对账。** Omarchy 命令组的权威清单只活在 `bin/omarchy` 的 `GROUP_DESCRIPTIONS` 结构里，AGENTS.md 明文「不要在这里维护第二份清单，以免与路由器漂移」。我们治同一病（工具数声称曾多次与 registry 实数漂移）用的是双招：SSOT 声明 + check-docs §15 全仓扫描对账。两招互补——声明治源头（新文档写前先问权威源在哪），扫描治存量（漂移当场红）。把「任何清单在仓内出现第二处时，一处为权威源、其余必须标注引用」升格为文档分工纪律，成本一行，收益是把「扫出漂移」变成「不产生漂移」。

**对我们的意义**：三棵文档树（task procedure / reference / user manual，按受众×文体切分）的**声明式迁移**已作为文档分工纪律落地（不排目录大迁移——新内容按文体声明落位、旧文档大改时自然毕业）；skill 分发与文档分工纪律两条则即刻可抄——前者已被市场验证，后者已被 35k stars 项目的实践验证。

> 📖 来源：[Omarchy](https://github.com/omacom/omarchy)（DHH，2025-06 建仓，35.3k stars@2026-08-30 实测）；AGENTS.md「禁二份清单」与 SKILL.md 均为仓库原文

### 企业 AI 选型框架：「两轴一红线」与「不信可解释性」（2026-09）

企业 AI 选型内容提出一条与约束层哲学直接对位的判定框架：真命题不是「要不要上 Agent」，是**哪部分交给模型、哪部分由人和系统控制**——并给出操作化判据：**语义不确定性 × 路径不确定性**两轴矩阵（两轴都定用函数；语义不定路径定用单次调用/工作流；两轴都不定才上 Agent），加一条压顶红线：**影响大、错了难发现、需明确责任主体的事，必须留给人**。

对位之一：**「能用规则不用模型判断」与 19/24 纯 git-diff 规则同构**。该框架的总结原则「把控制权交给最不需要 AI 的那层」（能用规则→不用模型判断；能预先编排→不让模型临时决定；能留给人负责→不交给机器），正是确定性引擎的设计动机——审计不看 Agent 说什么，看 diff 里实际改了什么，等于把「语义轴」从判定逻辑里剥掉了。行业五级架构阶梯（L0 纯计算 → L4 自主 Agent，多数企业把 L2 做深就够）也与此同源：**约束层不是反 Agent，是把 L3/L4 的例外处理关进可验收的笼子**。

对位之二：**「不信可解释性」与证据链信任模型互证**。该内容的三管原则——权限边界最小化 + 高影响动作人工审批 + **可信度来源于证据链、规则、审批记录而非推理结论**（解释越漂亮未必越真实）——与审计可拦截（HMAC 链硬证据）+ HITL 终审的设计完全咬合。其 Agent 验收六指标（业务结果正确率 / 越权率 / 人工介入率 / 延迟成本 / 模型替换稳定性 / 失控消耗）全部可从审计链与计量数据派生——**验收不问 Agent 嘴上说没做完，只看机器可查的结果**，这正是「考试式验收」的落地形态，也为商业侧健康度评分服务提供了现成指标骨架。

### 金融风控归因：本体约束的消融级量化实证（2026-09）

金融行业给出「结构化约束放在模型外」的第一组消融数据：汇添富基金的投顾风险异动归因系统以领域本体为语义底座（形式化定义业务实体、归因维度与智能体调度规则），引导 LLM 做可控逻辑推演——LLM 只作本体填充引擎（类定义作指令输入，抽取结果作为待校验断言），域/范围约束硬性拦截误跳步骤，业务规则调整只改本体配置、不改引擎代码。实证：引入本体约束后实体识别 95%、关系抽取 99%，幻觉显著受抑；消融对照显示移除本体约束后关系抽取下降约 30 个百分点。

对位：为「可检查性必须落在模型外」补上量化实证。机制三点——抽取结果待校验、约束硬性拦截、规则调整不改引擎——分别对应审计的「断言待验证」、拦截的「硬边界」、策略外置的「配置不改代码」：本体数据在这里不是装饰性知识图谱，是让 LLM 输出可计量变好的运行时约束。

> 📖 来源：周建军、庄明光、沈琪《基于领域本体约束与大语言模型推理的风险异动归因研究》，《证券信息技术》2026 第 1 卷 63-77 页（汇添富基金，2026-08 公开）；95%/99% 为论文摘要原值（已核验）

### Meta-RSI 三算子与保护面（2026-09）

递归自我改进（RSI）的统一形式化：三个可写面算子（Data-RSI 经验池 / Harness-RSI 五槽位 scaffold / Model-RSI 参数内化）共享一个闭环内核（消费学习信号→提出改动→验证器裁决→回流下一轮），其上加改进调度器（横向编排算子顺序 + 纵向改写算子提案策略）。实测：无外部教师模型，目标模型自演全部角色，自托管 35B 模型四基准平均自提升 10.9 分；六款前沿 API 模型仅走 Harness 路线（不动权重）平均 +7.3 分——**context-space 改进对不可训练的前沿模型同样有效**。对 sofagent 三条判据级启示：① **保护面独立**——评估器与发布门必须在所有可写面之外（eval-gate + audit HMAC 链 + release-gate-loop 的既有架构恰是这个形态）；② **验证差距是自进化的适用边界**——自提升仅在有廉价验证器的域成立（代码/数学），开放式域必须人审兜底；③ **多层写的成本模型**——context 更新「每次推理重付」（租用），权重更新「一次付清」（摊销），prompt/skill/微调三层须有显式晋级判据而非平行堆叠。行业 RSI 分级（弱/中/强）与 sofagent 五层谱系的对位见 [PHILOSOPHY · 自进化五层谱系](./PHILOSOPHY.md#自进化的五层谱系update是分界线)。

> 📖 来源：[MetaRSI/RSI²: A Meta-Recursive Self-Improving System (arXiv 2609.06396)](https://arxiv.org/abs/2609.06396)（CosmosMind，2026-09-06）；[开源 RSI-Harness（Genome 配置层）](https://github.com/CosmosMind-ai/RSI-Harness)（2026-09-08）；验证差距与两 substrate 成本模型综述（Two Substrates of Self-Evolving Agents，2026）

### System One 决策模型：判断与生成分离（Jev · 2026-09）

「判断/生成分离」被做成了一类独立模型：TypeSafe AI（InstructGPT/RLHF 共同作者 Diogo Almeida 创立，$40M 种子）发布 Jev——不生成任何文字，输入状态 + 带类型的问题（Noul 是非/Choice 选项/Score 评级三原语），输出结构化答案 + 校准概率（RLCD 训练：声称 90% 把握就真的对 ~90%）。数字（厂商主张；Every 第三方实测 777 判断 0.7s）：70-500ms 延迟、$0.042/百万输入 token 输出免费、比前沿 LLM 快 20-200 倍便宜 40-400 倍。对 sofagent 四条判据级启示：① **判断面独立成层是行业级印证**——「能用规则不用模型判断」升级为「判断是独立模型类别」，约束层管判断的分工被反向验证；② **校准概率是置信度概念的验收标准**——引擎既有五处置信度（instinct scorer/敏感识别/灰度判定等）皆为未校准的拍脑袋数字，RLCD 点破「概率必须有意义」；③ **类型化输出天然可审计**——choice+概率+置信度的结构化记录是 decision-log/HMAC 链的理想输入，语义判断从不可审查的 LLM 调用变为可审查的分类结果；④ **可被操纵的失灵面决定其架构位置**——数学/日期不可靠、state 内容可诱导答案，故决策模型永不进信任地基，只坐确定性规则之后的语义兜底层（与审计「24 条 git-diff 在前，语义判断在后」同序）。同域学术谱系互证：模型路由侧 RouteLLM（ICLR 2025，偏好数据训练路由器，MT-Bench 省 85% 保 95% 质量）/ FrugalGPT（TMLR 2024，级联先廉后贵按评分升级）/ AutoMix（NeurIPS 2024，自验证置信度决定升级，省 50%+）/ BEST-Route（ICML 2025，联合路由模型与采样数，省 60% 损失 <1%）；语义路由侧 semantic-router（Aurelio，MIT，3.9k star，embedding 相似度路由零 LLM 调用）——三级「规则 <1ms → 语义路由 20-40ms → LLM 900ms」的延迟阶梯与 v1.5.4 判定分层 L0/L1/L2 同构。落地：[v1.5.4 第二章](./changelog/v1.5/v1.5.4.md) DecisionChannel 通道接口（研究收编，见 changelog）。

> 📖 来源：[TypeSafe AI 官宣](https://typesafe.ai/)（2026-09-15，厂商主张）；[Every 独立实测](https://every.to/)（2026-09-15）；[RouteLLM (arXiv 2406.18665)](https://arxiv.org/abs/2406.18665)（ICLR 2025）；[FrugalGPT (arXiv 2305.05176)](https://arxiv.org/abs/2305.05176)（TMLR 2024）；[semantic-router](https://github.com/aurelio-labs/semantic-router)（MIT）；[Jev-style 开源复现 jev-on-a-laptop](https://github.com/rorshopping/jev-on-a-laptop)（KV cache 广播并行约束解码 + Qwen-2.5-1B-RLCD Apache-2.0 权重）

### 判定模型的具身智能切面：机器人的运动过程也可以被 FDEing（2026-09）

具身智能是决策模型明确看好的承接场景之一——机器人执行任务时要不断根据环境变化决定下一步，**若环境信息已结构化、可选动作已明确，快速判定模型就能承担其中一部分选择**（减少等待时间；能否满足实际可靠性仍需专门验证——原文明示这是潜在用途而非既成事实）。对本仓的启示不是「去做机器人判定件」（那在判定底座边界外清单里），而是「**万物皆可 FDE 在物理世界的同构展开**」：机器人的运动过程 = 一个个 workflow——软件 Agent 用代码实现步骤，具身 Agent 用世界/物理模型驱动硬件实现步骤，**差别在执行器、不在治理形态**。这给 FDE 方法论的适用面一条显式外延：梳理（业务对象→机器人本体与任务空间）· 判定（判据集→状态判定与动作选择，正是三原语可表达的「输入没法写死、答案空间可以写死」形态）· 交付（部署形态→硬件节点同样可注册为被治理对象，[v1.5.4 第五章](./changelog/v1.5/v1.5.4.md) AI 节点治理接入的注册面天然兼容非软件节点）· 养护（审计回溯→传感器与动作日志进链）。文章同时留下两条行业判断可引：判定与生成、CoT 深度推理**长期并存**的三范式格局；国内差异化机会在「能在企业内部运行、适应中文业务标准的决策模型」——与数据主权定位同源。**边界自律**：以上是方法论适用面的叙事外延，不是排期承诺——机器人/具身场景的实做不在 V2.0 前任何版本的计划内，边界外清单不动。

**具身场景下 harness 的价值排序（2026-09-23）**：判定件对具身的价值有两层——**控制回路内的低延迟判定**（换状态编码器、判定契约不变）与**控制回路外的治理**（本仓真正的差异化面）。后者对具身同样成立且有独立价值，理由有三：① **责任面**——机器人动作的物理后果不可回滚（写错文件可 revert、撞坏工装不可），出事后「当时谁批的、依据什么判据、什么置信度」必须可查，判定 + 校准概率 + 弃权语义进审计链正是这个接口；② **数据面**——具身轨迹（传感器流 + 动作序列 + 结果）是企业最不愿出域的数据，离线可跑 + 判据随仓开源 + 镜像源分发是数据主权形态在物理世界的直接复用；③ **进化面**——判据进化走「真实痕迹蒸馏 → 校准复验 → 晋 trunk」的 SUSTAIN 循环，机器人作业沉淀的轨迹正是「真实痕迹」的具身形态。对应地，具身也放大两个既有纪律：**判定永不进安全反射**（v1.8.0 已有行为锁——伤害规避是控制回路的事，判定件只坐语义层）与**校准漂移在具身场景更危险**（环境分布漂移 ⇒ 判定分布跟着漂，Laya「判定力崩掉时置信度照高」的失效形态在物理世界代价是撞东西）。**判不了就弃权**在具身的形态是「判定不出 ⇒ 停下来问人或降速」，与安全反射分工明确。

> 📖 来源：[36氪《Jev 爆火，具身智能迎来大救星？》](https://www.36kr.com/p/3994311534384773)（AIX 财经，2026-09-22，行业报道·印证级——含专家访谈：判定类调用推高 Agent 成本的机理、RLCD 校准语义、输出卡死在给定选项内仍可能选错的诚实边界、具身智能为三类承接方之一的判断）；具身 harness 价值排序与「审计对具身是否有意义」的论证为本仓立场段（不署外部来源）

---

> 对应的落地借鉴项清单见 [ROADMAP · 探索方向](./ROADMAP.md#探索方向)。

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

| 工具 | 它们管什么 | sofagent 管什么 |
|------|:--------|:----------------|
| AI Agent 平台（OpenClaw 等）| 让 AI「会做事」 | 让 AI「每次都做对、出事能负责」 |
| 企业 AI 咨询服务 | 一次性交付，人走茶凉 | 工具 + 常驻，可复用、可维护 |
| 代码检查工具（pre-commit 等）| 查「代码写得好不好」 | 查「AI 行为对不对」（越界/泄密/盲改）|
| 企业共享 Agent 平台（私有化部署 DSH 类 · 2026-08-20）| 企业内共享模型执行层（多用户共用同一个 Harness/Agent，对话留痕）| 共享执行层的**信任底座**——平台管「能不能共享」，sofagent 管「共享得安不安全」（审计每次共享调用、约束每个节点）。**同频印证**：社区私有化部署 DSH 实践（2026-08-19 两篇）验证了「DeepSeek 作为共享执行层、全员调用」是真实企业需求；且其共同缺口（多账号/权限/数据隔离）正是 sofagent G7 多租户抽象层（v1.4.7）补的位置 |

一句话：**现有工具查代码，sofagent 查 AI 的行为**——密钥泄漏、越界改文件、盲目修改，这些是 AI 特有的闯祸方式，通用工具不管。

<details>
<summary>🔧 与技术工具的具体差异（给开发者）</summary>

| 工具 | 它们管什么 | sofagent 管什么 |
|------|:--------|:----------------|
| detect-secrets / gitleaks | 密钥扫描（全量历史 + 100+ 模式）| A2 覆盖常见 API key；差异化 = **Agent 行为审计**而非密钥覆盖率 |
| Cursor Rules / Claude hooks | IDE/CLI 级约束（Claude hooks 已支持 25+ 生命周期事件）| 审计层全平台可用（git diff）；约束层按平台分层 |

> ⚠️ **对比快照时间戳**：以上对比基于 2026-08-02 各工具的公开能力快照；工具迭代快，条款可能过时。差异化的核心论点（sofagent 审计「AI 行为」而非「代码质量」）不随工具版本变化。

</details>

> 💡 **云厂商治理的三块短板 = sofagent 的主战场**（2026-08 外部背书）
>
> 云厂商已内化治理能力（Vertex AI Agent Engine 内置可观测性看板 + evaluation 层 + Model Armor 防注入），但行业分析师明确指出了三块补不上的短板，恰好对位 sofagent 的差异化价值：
>
> | 云厂商短板（Forrester/IDC） | sofagent 怎么补 |
> |---|---|
> | **跨栈深度归因**——多云可观测性不成熟，多 Agent 深度关联需第三方遥测 | 审计能力做 git diff 深度归因——跨平台中立，不绑定任何云厂商 |
> | **回溯能力缺位**——云平台只看实时指标，不存历史快照 | 回溯能力做 commit 级快照 + revert——行车记录仪，不是仪表盘 |
> | **治理闭环缺位**——云治理止于「告警」，缺「反思→进化」闭环 | Dream Cycle 闭环：审计→反思→知识沉淀→下一轮优化 |
>
> 精确定位：不是"我们也有治理"，是**"我们补巨头补不上的缺口"**——巨头做平台内治理（绑定自家云），sofagent 做平台外治理（不管你用哪个云）。

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

「Agent 治理」在 2026 年从合规文档类（做输入输出过滤与合规台账的那一代）**分化为独立的运行时内核类**——不再挂在模型外面当过滤器，而是**在模型与真实副作用之间做确定性裁决**。同期多个独立团队给出结构与数据上高度一致的选择：

| 对标物 | 结构与数据 | 与 sofagent 的关系 |
|--------|-----------|-------------------|
| **ArbiterOS**（港中文 CURE Lab，[arXiv 2604.18652](https://arxiv.org/abs/2604.18652)，开源） | 把模型重新概念化为**概率处理单元**，外面包一个**确定性神经符号内核**：语义 ISA 把概率消息固化为离散指令，按推理节点的**数据流血缘做污点传播**，在确定性汇聚点（高危工具调用 / 未授权出口）拦截并支持回滚。论文摘要实测高危拦截 **76%–95%** | **架构同构**——「概率与确定性执行的接缝层」正是 sofagent 的判定层与约束层。差异：其裁决为**二值**，无概率与弃权语义 |
| **Cordum · policy-before-dispatch** | Safety Kernel 在 dispatch 前评估：是否显式授权 / payload 是否合 schema / 环境边界 / 是否需人批 / **决策能否回放**。主张「**大脑可以保持概率性，神经系统不能**」 | **同判断**——与「判定层永不进信任地基」「决策可脱离原模型回放」逐条对齐 |
| **《Reason Less, Verify More》**（[arXiv 2607.07405](https://arxiv.org/abs/2607.07405)，KDD 2026 Workshop） | τ²-bench 上 **78% 的失败是「静默错误状态」**（工具不报错、Agent 自述成功）；确定性强预执行门把成功率 29.6% → 42.0%；**提升几乎全部来自一个精度 100% 的门，另一个门精度只有 5%** ⇒ 结论：**门自身的精度必须被审计** | **实证了两条原则**「静默失败监控是唯一防线」与「门槛纪律须两极端告警」——并用 100% vs 5% 的门精度差给出量化证据 |
| **《Calibration Is Not Control》** | 校准只修**概率对齐**（Brier 分变好），**不修控制遗憾**（control regret 不变）；主张从「校准风险分」走向**干预优势**估计 | **对判定底座的重要补充**：校准概率是必要条件而非充分条件——判据除「判得准」，还须回答「按此判定去干预是否真的更好」 |
| **《Adaptive AI Delegation under Uncertainty》**（[arXiv 2606.29406](https://arxiv.org/abs/2606.29406)） | 把「给 AI 多少决策权限」建模为 Governance-Aware POMDP——权限**随证据质量与不确定性动态分配** | 与档位五态同题：**权限不是静态配置，是随证据变化的分配** |
| **风控行业的分层实践** | 第一层规则引擎（硬拦截 · 毫秒级）→ 第二层模型评分 → 第三层人工审核（灰色区间）；业界共识为「规则 + 模型结合」 | 与「确定性规则在前、语义判定在后 + 弃权交人」**三层同构**——该分层在风控已被验证多年 |

**结论：sofagent 占的不是「又一个护栏库」，而是「Agent 运行时治理内核」这一格。** 位置与 ArbiterOS 同格；差异在**判定面**——对标物的裁决是二值的（allow / deny / rewrite），sofagent 多出**校准概率 + 弃权 + 档位**三件事，以及**判定能力可后训**（`train_*` 通路）这一层。

**同时须诚实记录差距**：对标物均已有**实测数据**（拦截率区间 / 门精度对比），sofagent 的同类数据尚未产出——**这是当前最该补的东西，不是再补规划。**

---

## 三、架构印证：行业框架独立复现 sofagent 的选择

> 本节把跨批行业研读中与 sofagent 架构**结构上对齐**的行业框架逐条印证——不是发明新架构，是验证已有架构选型的行业合理性。

### Ontology = 共同理解层 / 翻译层

Ontology 的本质是「**翻译而非统一**」——在多个异构 Agent / 系统之上建立共同参照系，让彼此能对话，同时保留各系统内部语境独立；它 ≠ 数据模型 / ≠ ER 图 / ≠ 知识图谱（知识图谱只能查不能操作，Ontology 还能在对象上**触发操作**）。核心关键词是「操作」而非「数据」。「本体 = 运行时语义层」——它是在 Agent 跑任务时实时提供「谁依赖谁、谁能看什么、能触发什么」的语义上下文，是介于模型与业务系统之间的**活的中间层**。

> sofagent 设计决策（本体数据 = GitHub 生长树）见 [ARCHITECTURE §七](./ARCHITECTURE.md#本体数据--github-生长树核心设计原则)

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

> ⚠️ **消歧**：这里的"三层架构"（约束层 / 知识层 / 编排层）是**行业映射视角**——把 sofagent 能力对标行业"五层骨架"时的纵向切分。它与 [ARCHITECTURE §心智模型](./ARCHITECTURE.md#心智模型先读这个) 的**双层架构**（约束层 × 生命周期，唯一主框架）不冲突——前者是"跟行业对标怎么切"，后者是"产品怎么组织"。

行业「五层骨架」（配置 / 知识 / 指令 / 校验 / 编排）作为映射参考，吸收其「确定性迁移」哲学，但**不对齐为强制模板**。sofagent 对标行业五层的纵向切分：

| 层 | 是什么 | 行业五层中对应 |
|----|--------|----------------|
| **约束层（Harness / Constraint Layer）** | 四层约束注入链（SKILL.md→fde.md→think.md→knowledge/）+ 审计 / 回溯能力（本质：git snapshot） | 配置 + 指令 + 校验 |
| **知识层（Knowledge / Ontology）** | knowledge/ + 本体数据（FDE 在客户侧交付的业务资产，见 FDE/GUIDE.md 第三章 本体数据构建） | 知识 |
| **编排层（Orchestration / Loop）** | 编排模块 + 进化模块 + 外层 FORGE | 编排 |

逐层映射：

| 行业五层 | 数据流口诀 | 落到 sofagent 哪一层 / 哪部分 |
|----------|------------|-------------------------------|
| 配置 Config（决定用什么） | 配置决定用什么 | 约束层 · `.sofagent/config.yml` + SKILL.md / fde.md 的配置约束 |
| 知识 Knowledge（知道什么） | 知识知道什么 | 知识层 · knowledge/ + 本体数据（FDE 交付，Harness 只挂载 / 校验） |
| 指令 Instruction（怎么说） | 指令怎么说 | 约束层 · 四层约束注入链即「指令」载体（prompt 注入 Agent 上下文） |
| 校验 Validation（对不对） | 校验对不对 | 约束层 · 审计能力 + 约束规则（硬约束，AI 绕不过） |
| 编排 Orchestration（先干什么后干什么） | 编排先干什么后干什么 | 编排层 · 编排模块 + 进化模块 + FORGE |

**同构点**：五层里**仅指令层直接调 AI**，其余四层为 AI 铺路；sofagent 亦然——只有「知识 / 指令」承载概率性 AI，约束 / 校验 / 编排全部落在确定性引擎。

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

**入场判据——三适合条件**（任务同时满足三条才值得建 Loop，否则一次性 Agent 调用就够）：一、**重复发生**——同一任务会反复出现（fresh-eyes 审查每版发版都跑；只跑一次的一次性分析不建 Loop）；二、**完成标准清晰**——「做完」能被独立判定（exit 0 / 测试数对账 / verdict PASS；「把文档写好点」这类主观目标先定义 Rubric 或二元清单，定义不出来不建 Loop）；三、**token 成本可扛**——单轮成本 × 预期轮数在预算内（FORGE 三层熔断 + [预算三维度声明](../FORGE/lessons/index.md)就是这条的工程化）。

单 Loop 有四种典型失败，sofagent 的审计节点（★Reality Anchor）逐一对应解法；当任务复杂度触及任一升级信号时，才从 Loop 升级到 Graph（满足其一才升级，否则 Loop 就够，避免过度设计）：

**单 Loop 四类失败 → sofagent 解法**：指标异化（优化解决率→流失率翻倍）→ audit 节点看 git diff 硬证据不信自报；目标僵化（Agent 不质疑目标本身）→ human_confirm 节点 + 危险操作前人工批准钩子；多目标冲突（两个 loop 打架）→ ★Reality Anchor guard edge 统一裁决；测量衰退（测试数据老化假象）→ audit 规则不可篡改 + acceptance-test 冻结验收标准。

**升级六信号 → sofagent 落点**：任务需交接（dag-runner 单任务 vs 并行编排波次）/ 需散出汇合（Send API 并行 + MergeQueue，v1.3.1）/ 每步不同模型工具（model-router 路由）/ 需显式可审计角色（StateGraph 四节点）/ 节点失败需隔离（git worktree，v1.2.3）/ 需独立 reviewer（audit + fresh-eyes）。完整对照见 [FORGE §Graph Engineering 视角](./guides/loop-development.md#graph-engineering-视角控制图--stategraph)。

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
3. **Hill Climbing Loop = 进化模块 + FORGE 自迭代**——「分析多次运行留下的 Trace，找到重复出现的问题，再修改产生这些问题的 Harness」：sofagent 进化模块（think.md 反思 + Dream Cycle 知识蒸馏 + evolve 优化）消费 audit/eval 轨迹；FORGE fresh-eyes-loop 本身就是一个 Hill Climbing Loop（常规 12 视角 / 全量 23 视角审查 → 修复 → 验证 → 系统改 harness）。**关键安全网：Hill Climbing ≠ 让 Agent 随意改自己的 Prompt 然后直接上线**——可靠改进仍需候选版本/离线评测/回归测试/人工审核/小流量验证/回滚，sofagent 的 release-gate-loop + check-version 门禁 + 快照回滚正是这套安全网。
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

Palantir Foundry 10 年迭代收敛出 Ontology 的 5 块构建块——**Object Type / Link Type / Action Type / Function / Interface**（缩写 OLAF-I）。不是 3 块不是 7 块，5 块是数字孪生的最小够用集。

| 块 | 角色 | sofagent 对应 |
|---|------|-------------|
| **Object Type** | 业务实体的 schema 定义（如一口井、一笔订单） | `knowledge/entities/` Markdown frontmatter（实体 + 属性 + 关系） |
| **Link Type** | 实体间的类型化关系（带命名/方向/权限，非数据库外键） | `relations` frontmatter 字段（实体间语义关系，非技术引用） |
| **Action Type** | 对 Object/Link 的合法改动定义（入参 + 规则 + 提交条件 + 副作用） | **审计模块 Action 七步管线**（参数→校验→权限→执行→审计→回滚→副作用） |
| **Function** | 派生计算（源变化自动重算，非定时 ETL 快照） | daemon Dream Cycle 知识提取 + think.md 反思自动生成 |
| **Interface** | 同一份 Ontology 暴露给多类用户（Workshop/API/AIP/OSDK） | MCP Server + CLI + Hook + SKILL.md（同一份约束，多入口访问） |

**合并检验法**——5 块任意两块都不能无损合并：Object↔Link（Link 依附 Object）、Action↔Function（Action 改状态有事务 / Function 算值不改状态）、Function↔Interface（计算 vs 暴露）、Link↔Action（关系 vs 改动）。再加新块也能被现有 5 块吸收（Metric = Function 输出、Workflow = Action 组合、Notification = Action Side Effect、Version = Global Branching）。

**sofagent 印证**：sofagent 的约束层五种能力遵循同一不可合并原则——审计能力（看 diff 不改状态）与回溯能力（改状态有快照）与进化能力（算值不改状态）各有独立职责，合并任两者都会丧失核心能力。Palantir 的「Action 默认 staged，等人工 review 才 commit」与 sofagent 的 human_confirm 节点（[FORGE 四节点状态机](./guides/loop-development.md#四节点状态机v113)）完全同构——LLM 调用 Action 不能直接写库，必须在沙盒里等审批。

**框架级对等印证**：Pydantic AI（Python Agent 框架，2026-06 V2）独立演化收敛到同一组原语——HITL 工具审批门 = `human_confirm` 节点、Capabilities 可组合能力包 = SKILL.md + registry 动态注册、Evals = `data/eval/` 评分、Graph 编排 = LangGraph StateGraph。跨语言（Python vs TS）、跨范式（runtime 框架 vs harness 约束层）独立收敛到同一组原语，说明 sofagent 的原语选择经受住了独立性检验。

**学术实证印证**：本体抽取（Ontology Extraction）已被学术界作为正式 NLP 任务量化研究——一篇覆盖 36 篇论文的 A 级综述报告，基于 LLM 的本体抽取任务 F1 最高达 72.78%，说明「用 LLM 从非结构化文本抽取结构化本体」不是工程伪命题，而是有公开学术基线、可量化评估的研究方向。sofagent 的 Ontology 本体数据（v1.3.1 规划）走的是同一方向——从企业非结构化文档（SOP / 会议纪要 / 操作手册）抽取实体、关系、动作，落地为可运行的 knowledge/ 节点。

> 📖 来源：《大模型×本体工程：36 篇论文系统性综述》（A 级综述，2026），本体抽取任务 F1 = 72.78%

**Harness Engineering 方法论印证**：GStark（YC 总裁 Gary Tan 开源，GitHub 近 5 万 Star）独立演化出三条 Harness 设计哲学，与 sofagent 已有能力逐条同构：

| GStark 设计哲学 | sofagent 对应 | 同构关系 |
|------|------|------|
| **机械化架构约束**（别跟 AI 讲道理，把护栏焊死） | 审计模块 24 条规则 + BASELINE_RULE_KEYS 不可 config 关闭 | 完全同构——审计模块就是焊死的护栏 |
| **角色级约束**（每个 Skill 开头自检「这活是不是我该干的」） | knowledge-domain include/exclude + SubAgent 角色定义 | 完全同构——knowledge-domain 边界即角色级约束 |
| **多轮生成再筛选**（AI 跑一次成本趋零 → 多跑几轮挑最好） | A/B 双跑 + fresh-eyes 12 视角独立审查 | 完全同构——FORGE fresh-eyes-loop 即多轮再筛选 |
| **动手前先搜索**（设计前搜方法论、审查前搜安全清单） | Ontology knowledge/ + search_knowledge MCP tool | 完全同构——知识库 + MCP 搜索即先搜索后动手 |

顶尖团队用 Harness 的工业级验证数据：OpenAI Codex 团队 3-7 人 5 个月产出 100 万行生产级代码；LangChain + Deep Agents 在 Terminal 基准测试排名从 30 名升到前五。不改底层模型，只加 Harness 就能大幅提效——与 sofagent「能力长在代码里不长在 prompt 里」的产品哲学一致。

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
> 5. **两个验收问题** = 「编排层长期不换」（架构级取舍、非永久承诺：24 条 git diff 规则 + HMAC 链不依赖模型）+ 快照 `--revert` 一键回滚——「换模型对象还在不在」的答案就在约束层与模型解耦的设计里。

### Palantir 双 MCP 体系：把「改结构」和「改数据」拆成两条治理通道

> 📖 来源：[Palantir Foundation · Ontology MCP 样例架构](https://palantirfoundation.org/docs/foundry/ontology-mcp/sample-architecture)（官方文档，2026）+ 第三方评测交叉（chatforest.com，2026-07 口径）。官方事实，非转写。

Palantir 的 agent 接入面拆成两个 MCP server，**读写分离、各带治理门**：**Palantir MCP（PMCP，已 GA）**是平台开发面——70+ 工具覆盖本体 schema 的搜/查/改、代码仓 Git 操作、跨资源分支、数据集与血缘；**本体 schema 的任何修改必须走 proposal review 人工审批后才生效**。**Ontology MCP（OMCP，后至 GA）**是运行时业务面——object types 收敛为一个统一 SQL 查询工具；**每个 action type 独立暴露为一个 MCP 工具**（agent 写数据只能调预定义 Action，不能直接 UPDATE 底表）；query functions 逐个成工具；AIP Logic / chatbot 可存为函数经 MCP 暴露（**agents as tools**，agent 产物成为别的 agent 的工具）。另发 Claude / OpenAI / Google 三家 Agent SDK 模板：不合并框架，共享 Ontology 资源 scope、认证、MCP 接口与发布流程，agent 发布后注册为异步函数由对象变更触发。

> 💡 **对 sofagent 的三点印证**：
>
> 1. **「agent 能改什么」与「agent 能做什么」被显式拆开**——schema 变更（PMCP + proposal 人工门）与数据变更（OMCP + 受控 Action）分走两套接口。sofagent 同构：约束注入（改 workflow / SKILL）走 SKILL.md 单一权威源 + git 提交审计，业务执行（改业务对象）走 workflow Action + human_confirm——两条通道也是分门的，且 sofagent 两条都落在 git 可审计面上。
> 2. **Action 逐工具暴露 = 审计粒度到单个业务动作**——OMCP 不把「写」收成一个大工具，而是每个 Action 一个工具，权限与审计天然按动作切分。这与「24 条 git diff 规则按变更类型切分」同构：粒度即治理面。
> 3. **agents as tools 与框架中立模板印证「沉淀即复用」**——agent 产物存为函数给别的 agent 用，对应 think.md → knowledge/ 的晋升机制；三家 SDK 模板共享本体接口、各留原生 loop，与「平台层不定义治理、只表达治理」的宿主无关哲学同向。

### Snowflake 自下而上本体路径：数仓巨头的 context 工厂

> 📖 来源：[Introducing Cortex Sense](https://www.snowflake.com/en/blog/enterprise-ai-agents-grounded-context/)（Snowflake 官方博客，2026-06）· [Incorporating Ontologies into Snowflake Cortex Agents](https://www.snowflake.com/en/blog/engineering/ontology-grounded-cortex-agents/)（Snowflake 工程博客，2026-05）+ Horizon Catalog / Semantic Views 官方产品文档与 FY2026 财报。benchmark 数字为官方口径。

Palantir 从业务对象出发「自顶向下」建本体，Snowflake 反向走「自下而上」：从数仓长出本体栈，四层演进——目录（Horizon Catalog，已 GA，底层捐给 Apache 基金会成 Polaris 顶级项目）→ 语义层（Semantic Views / Semantic Studio，已 GA）→ 图（Knowledge Graph：KG_NODE / KG_EDGE 两张表存数仓内，recursive CTE 遍历，已公开）→ 智能体接口（Cortex Sense：自动扫描全库构建全局 ontology 作 context substrate，私预）。定位一句话：**把数仓改造成 agent 的 context 工厂**。关键数字（官方口径）：Cortex Sense 称治理 context 使 agent 回答复杂业务问题的准确率 47%→83%（对照：通用 coding agent 裸连数仓 23%）。

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

### 纳德拉「学习循环」：Token 资本的复利结构（CEO 级背书）

微软 CEO 纳德拉 2026-06 长文《A frontier without an ecosystem is not stable》（2800 万浏览）提出：企业的未来不取决于挑到最佳模型，而取决于在模型之上构建「人力资本 × Token 资本」学习循环的复利能力——**可以外包一项任务甚至一份工作，但永远无法外包学习过程**。其中「企业需要的架构四要素」与 sofagent 的能力面逐项对齐（以下对齐表为解读性映射，非纳德拉原话）：

| 纳德拉架构四要素（原文） | sofagent 对应（解读映射） |
|------|------|
| 工作流 + 领域知识 + 积累判断 → 随每次使用不断改进的 AI 系统 | 工作流编排 + 本体数据（knowledge/ 实体关系）+ think.md 反思沉淀 |
| 私有评估体系（外部基准不够，捕捉企业真正关心的成果进步） | 审计模块 git diff 硬证据 + eval 体系（`data/eval/`）——不为外部 benchmark 写测试，只为企业的真实底线 |
| 私有强化学习环境（在组织内部真实执行轨迹中变强） | SUSTAIN 进化闭环（audit/eval 轨迹 → 反思 → 经验沉淀 → 下轮执行），模型层角色可替换 |
| 机构记忆知识库（记忆可查询、Token 使用更高效） | 回溯能力 + 知识库（history.jsonl 审计历史 + knowledge/ 知识沉淀，全量可查询） |

**数字主权测试**（原文关键句）：「一家公司应当能够在替换『通用』模型时，依然保留其学习系统内积累的『企业老将』级别的专业知识。这将是未来时代对你的控制力与主权的一项关键测试。」——这正是 sofagent 约束层平台无关设计的价值主张：模型可换、平台可换（OpenClaw ↔ DSH/Cordis），企业积累的约束规则与审计历史不动。

**生态警告**（原文）：「各行业每家公司都在把价值让渡给少数几个吞噬一切的模型」——若价值被少数模型层攫取，政治经济体系无法容忍。这给独立约束层存在的宏观理由：防价值全被模型层攫取，与治理层/审计层独立于模型厂商同源。

> 📖 来源：纳德拉《A frontier without an ecosystem is not stable》（2026-06，X 长文，2800 万浏览）· A 级源（微软 CEO 署名）

### 第三方判定模型对照：Laya 三处反例与 Jev 生态三种新用法

判定面独立成层后，行业里长出了可逐行读的第三方实现与用法。两者对本仓的作用正好相反——**一个的价值在它弱的地方，一个的价值在它长出来的地方**。证据链：制品 `laya 0.3.4`（PyPI wheel）+ 权重快照 `c5d78730f3493e4fe16d61507ef4b78eef7318cf`，以下行号均为该制品实测。**上游已发 v0.3.7（2026-09-23 取证：PyPI + GitHub tag 同步；0.3.5→0.3.7 间新增自托管 HTTP 服务端（Jev 兼容 `/v1/systemone`）、分语言可复现评测 harness、中文工作流基准与双语结果、浏览器 agent 判定头微调示例——形态变化大），本节行号锚与三处反例结论均按 0.3.4 制品写就、未随版本复验；复验待上游稳定窗口。**

**Laya（反例级）——三处反例**

1. **出厂制品不含校准**：`rl_agent_config.json` 实测 `temperature: [1.0,1.0,1.0]`、`temperature_by_options: {}`，而运行期正是在这两处取温度（`agent.py:304`）、默认值也是同一组（`agent.py:194-195`）⇒ 温度恒为 1.0（恒等变换），**出厂默认路径上不存在校准这一步**——不是「忘了配」。对应 [v1.7.0 第三章](./changelog/v1.7/v1.7.0.md)「校准制品随行」。
2. **校准面与运行消费不是同一处代码保证**：运行期消费的置信度是归一化熵（`common.py:200-201` `1 - H(p)/log k`，消费点 `agent.py:309`），而拟合与评估面的 `ece_score(conf, correct, bins=15)`（`common.py:187`）收的是**调用方传入的 conf**——该 wheel 内零调用点，**这条路径不随制品发布**。⇒「对外校准数字能否由已发布制品复现」是可判定的事实，不是洁癖。对应 [v1.7.0 第三章](./changelog/v1.7/v1.7.0.md)「统计量一致性 / 对外数字可复现」。
3. **判定力崩掉时置信度照高**：其 router 自述英文 checkpoint 在非英语上「does not gently degrade … it collapses」（20 选项 MASSIVE intent 上 Hindi 0.100、Korean 0.103，随机基线 0.050），「**and it reports high confidence while doing so**」（自述 Hindi ECE 0.855）（`router.py:21-24`）⇒ 置信度不等于判定力。

**可借鉴两处**：① **判定原语是一等输入参数而非 prompt 措辞**——判定读 `items[r]["markers"]` / `QTYPES[q["t"]]` 这类结构体字段（`agent.py:292-320`），与 [v1.6.0 第一章](./changelog/v1.6/v1.6.0.md)「问题集限定」同源。② **分流前置在模型加载之前**——其 router 在任何 checkpoint 加载之前完成分流判定（`router.py:135-136`「a cold load costs seconds, while detection costs microseconds」），并自述 `typed-decisions`「**should not be a silent default**」（`router.py:26-28`）；「一开始就选错路径」是事后探针抓不到的失效面，见 [v1.9.0 第六章](./changelog/v1.9/v1.9.0.md)。

**零承诺佐证**：全仓 `abstain` / `refuse` / `defer` **0 命中**——它把「势均力敌」与「没把握」压进同一个 confidence 数，「判不了」没有一等出口。这从反面佐证本仓 [ARCHITECTURE](./ARCHITECTURE.md)「`ABSTAIN` 必须与 `ASK` 分开」的判据：两者混装则下游无法区分「该调阈值」与「该补判据」。

**Jev 生态（印证级）——三原语上线三天长出三种完全不同用法**

Jev 公开的接口面只有三原语（Noul / Choice / Score）且全部答案带概率；三个互不相识的第三方用法在三天内各自长出来：① `browser-use/jev-ultrafast`——**动态动作空间索引**（只把此刻可用操作 + 目标交给模型）+ **投机式预判**（多目标一次往返问出、按最终操作丢弃其余）+ 检查器（元素 / 操作概率 / 目标概率 / 已执行动作全列，可单步暂停）；② `TheoLeeCJ/openjev`——3090 级显卡可跑，**直接从开放模型读类型化选项概率**（删掉「先写话再解析回 if」的中间环节），且不吃生成吞吐、吃并行打分能力；③ `tamaratran/fast-jev-compaction`——把判定当**有损操作守门人**（成对删除、原话一字不动、分级折叠，折叠到极限**直接报错而非静默丢东西**）。⇒ 对 sofagent 是零承诺印证：**接口干净则生态自发生长**——故本仓坚持契约由 `DecisionChannel` 保证、实现路线不绑定。其中「动态判定面收窄」与「投机式预判」两项对判定底座自身有增量价值，已按「不提前抽象 + 写清触发条件」登记进 [ROADMAP · 探索方向](./ROADMAP.md#探索方向)，不排期。

> 📖 来源：[laya（PyPI 0.3.4）](https://pypi.org/project/laya/) 与 [HF `convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya)（Apache-2.0，快照 `c5d7873`）；Jev 生态三用法来自 2026-09-19 第三方行业文章梳理（`browser-use/jev-ultrafast` · `TheoLeeCJ/openjev` · `tamaratran/fast-jev-compaction`）——**未逐仓读源码，仅作生态形态记录**

### 单机全流程的实测边界：单机推理已可服务、单机训练小档已跑通（2026-09-21）

判定面独立成层之后的下一个问题，是「这套东西能不能完全跑在用户自己的机器上」——数据不出机、后训练权在用户手里。两个开源复刻件各自留下了**可直接引用的实测读数**，合起来把这条路的边界画清了：**推理侧笔记本档已能直接服务；训练侧小档已跑通、大档仍要云卡。**

**单机推理（两个独立来源）**

- **延迟的两档读数**：某 9B 判定件在 **M5 Pro 64 GB**（MLX）上判定延迟中位 **444.0 ms / p95 981.0 ms**（324 例）；同口径在 **H100 上中位 106.0 ms / p95 119.8 ms**（120 例），两者均为其仓内自带基准的产物（Nimble `README.md:463-464`）。⇒ 服务器档与单机档之间是**数量级差**，不是「能跑 / 不能跑」的二分。
- **显存门槛按精度分档**：另一件的 4B / 9B 在 bf16 下**装进 32 GB Mac**，而 fp32 分别需约 16 GB / 约 33 GB——其 8B 卡直接写明「fp32 需约 33 GB，**装不进 32 GB Mac**，bf16（约 17 GB）可以」（Kev `README.md:20`、`docs/model-cards/kev-8b-qwen3.md:88`）。
- 🔴 **单机可用性由「目标硬件上有没有快核」决定，不由参数量决定**：同一件制品在同一台 M5 上做同一件事（五问 × 三选项 × 约 230 token 的 state），把基座换成含线性注意力循环层的版本后**慢 3–7 倍**（4B：**779 ms vs 174 ms**；9B：**约 2 s vs 约 300 ms**）——根因是该循环层在 Apple Silicon 上**无 MPS 实现、框架回退到参考实现**（Kev `README.md:219-227`）。⇒ **基座选型的第一性问题不是「多大」，是「跑在谁的机器上、有没有核」**。

**单机训练（路径是被刻意保留的，不是权宜）**

- **本机训练路径写在计划里**：其计划文档明写「**保留 MacBook 训练路径**」，受控实验才上云卡（Kev `PLAN.md:68`），并给出可执行纪律：「**在 Mac 上一次只跑一个训练任务——同一块 Apple GPU 上两个任务慢得多**，长跑改用云卡」（`README.md:283`）。
- **小档的完整读数**：0.5B 档在 **Apple M5 / 32 GB 统一内存 / PyTorch MPS** 上完成一次训练**约 1 小时 45 分钟**（约 0.29 s/record、2,250 步），**功耗 30–40 W ⇒ 约 0.06 kWh**（`docs/model-cards/kev-0.5b.md:112-118`、`:183-184`）。⇒ 「单机全流程」在小规模档上是**已经成立的物理事实**，不是愿景。
- **现实分档**：0.6B 约 12 分钟、0.8B 约 20 分钟、4B 约 40–56 分钟、8B 约 70 分钟、9B 约 91 分钟（峰值显存 39.5 GB）——**除小档外全在单卡 H100 上**（各 model card）。⇒ 笔记本档与云卡档是**两条都要交付的路径**，对外口径只能是「**可训规模随可用内存分档**」，不能是「某机型能跑」。
- ⚠️ **学习率不能跨规模照搬，且文档值与代码默认值必须同源**：4B / 8B 档的实证药方是 **5e-5**——其默认 **2e-4** 会把基座既有的零样本读出打坏（MMLU 0.688 → 0.60–0.66、PAWS 0.787 → 0.56–0.71），降价后恢复大部分，作者自述这是「**找到的最大单项配方改进**」，而**减 LoRA 目标模块与降 rank 的帮助都更小**；而 0.5B 档的配方写的是 **2e-4**（`docs/model-cards/kev-4b-qwen3.md:76`、`kev-0.5b.md:114`）⇒ **lr 须按规模重测**。同时其训练脚本 argparse 的**默认仍是被证伪的那个 2e-4**（`kev/train.py:64`）——**采用他人配方必须读代码默认值，不能只读文档**。
- 🔴 **单机延迟的最大杠杆是前缀复用，不是更小的模型**：其 Apple GPU 工程优化清单（LoRA 权重 fp32 合并后再转换、SDPA、MPS 输入按 64-token 桶填充、**state 前缀缓存**）中，**前缀缓存在重复的 772-token state 下把同一件从 861 ms 降到 242 ms**（`README.md:230-231`）——与判定层「并行约束解码 + KV cache 广播、一次前向填充全部字段」是**同一个杠杆**，落地见 [v1.8.0 第三章](./changelog/v1.8/v1.8.0.md)。

**概率偏移的两个独立同量级读数（可作工程先验，不可当可忽略）**

- **打包模式差异**：跨「并行 / 串行缓存 / 独立」三种模式的**最大绝对概率差 0.018008**（相对独立执行）、0.012336（相对串行缓存）；其基准**容差为 0.03**，并自述「**这些是测试容差，不是校准保证**」（Nimble `docs/PARALLEL_SCORING.md:120-141`）。
- **数值精度差异**：bf16 与 fp32 在 24 例新来源上的概率差**至多 0.017**，且**最优选项未变**；自述「**是一次小检查，不是对每个输入的保证**」（Kev `README.md:234`）。
⇒ 两个独立制品在**两个不同维度**上给出的偏移量级都落在 **0.017–0.018** ⇒ 工程上可把「概率偏移量级 ~0.02」当先验参照，但**必须进入校准口径声明**（按哪种模式拟合、就按哪种模式评测），并与 [v1.9.0 第四章](./changelog/v1.9/v1.9.0.md) 端到端落数同批报告。

**弃权面：生态已有同源实践，差异化在制度面而非概念面**

两件都在做弃权，且机制与本仓同源：一件在路线图里写「可以从同一组概率特征（top-1 / margin / entropy / K）导出**等价的 abstain 旗标**，按开发集校准、**无需重训**」，并写明「以**固定覆盖率下的选择性准确率**在 OOD 上评测」（Kev `PLAN_Qwen35.md:151`、`:169`）；另一件在**数据策展面**用弃权把关标签生成——「checked premises, explicit rules, **abstention on gaps**」、「uncovered assignments **abstain**」（Nimble `nimble/datasets/evidence_curation.py:1`、`evidence_stages.py:85`、`:129`）。⇒ 本仓的差异化**须收窄到制度面**：弃权是**一等输出**（不是与概率并列的一个旗标）、**门槛按原语分档**、**弃权独立归因**、**门控四联红旗**、**校准上线前置门**。

**隔离与注入面：生态做到的是「问句互不污染」，尚未做「政策不从数据里长出来」**

一作把**问句隔离**当安全特性实现并验证（一问的文本无法操纵另一问的答案），分隔符伪造防护针对保留 token 已验；但同一处自述「**经由 state 文本的其他提示注入路径尚未研究**」（Kev `docs/model-cards/kev-0.5b.md:120`）。⇒ 这正是 [v1.8.0 第二章](./changelog/v1.8/v1.8.0.md) 新增的**不可信观察分层（授权面）**覆盖的空白：生态做到了「问句之间不互相污染」，尚未做「**state 内容不得供给政策与权限**」。

**许可面（引用前必须确认）**

一件声明 **Apache-2.0**（仓内 `LICENSE`）；另一件仓库根**未见任何 LICENSE 文件**（仓内唯一的 `LICENSE` 位于 `.agents/skills/typesafe-ai/`，属随附第三方技能）⇒ **「没写许可」不等于「默认可商用」**——引用其配方、数据或读数前须先确认授权口径。

> 📖 来源：[jaredpalmer/kev](https://github.com/jaredpalmer/kev) 与 [bespokelabsai/nimble](https://github.com/bespokelabsai/nimble) 本地克隆快照实测（2026-09-21 读取，行号均为该快照内实测位置）。读数分两类：单机延迟与打包加速比来自**各自仓内自带的基准产物**（可复算）；训练耗时 / 峰值显存 / 配方来自**其 model card 的自述**。**快照陈旧预警（2026-09-23 取证）**：两仓此后均有密集更新——kev ≥11 提交（长上下文训练修复 +10~20pp、`kev.calibrate` per-workload 温度报告、选优机制改 sticky ledger 非劣成对区间、`kev-verify` parity harness），其自述 Soft-target Kev-9B **未通过发布确认**（confident errors 2.9%→1.7% 仍复现）；nimble **原始 2,676 训练样本与冻结 324 留出集已公开发布**（此前「数据不可下载」的准入状态或已改变）且概率默认温度换为 fitted/v2（概率数值形态变化）。本节各读数以 09-21 快照为准，**引用前须对当前 HEAD 重读复验**。

### 判定工程的治理件深读：冻结评测边界、钉哈希挂载与谱系声明（2026-09-21 二次深读）

继上节实测边界之后，对同一批快照做了第二轮源码级深读（判定头实现、评测冻结协议、训练脚本、包本体、测试组织）。本节只收录**对本仓治理面有增量**的发现；工程实现细节（双线性 pointer、混合骨干降级路径、数据增广变体族）不进主线文档。

**自动搜索的边界写法：可变面白名单化，评测面永不可变**

Kev 把「自动扫参」做成显式边界契约：agent 可变的只有 **allowlist 里的试验参数**（optimizer / LoRA rank / epochs / 增广率 / 损失权重），而「**the evaluator, the frozen suites, the gates, or the locked test** 永不可变」；选优只许在开发分区上做，「locked test 在此之前永不被读取」，候选资格达成才解锁 locked 读（`kev/autoresearch.py:8-10`、`:167`、`:284`）。resume 机制双查**代码哈希与 suite manifest 哈希**（`kev/experiment.py:173-179`、`:229`），且**失败试验也写进 results.jsonl 台账**（`:265-279`，`allow_nan=False` 严格落盘）。⇒ 与本仓两条既有实践同构：审计链 golden vector 锚（锚定不可变面）与「温故知新只产候选 Prompt、永不触本仓」（搜索与冻结的边界）。其增量在「**台账必须记录失败**」被写成机制而非纪律——失败行与成功行同格式落盘，报告层没有「只挑好的」的通道。

**第三方技能件以内容哈希挂载：与 install.sh 权威源互补**

Nimble 的 `skills-lock.json` 把引用的第三方技能钉到 **SHA-256 computedHash**（`skills-lock.json:8`，指向 `typesafe-ai/skills` 仓的 SKILL.md），结构上与 lockfile 同构。⇒ 本仓 SKILL/ 权威源走「install.sh 从仓内复制」，两者正好覆盖技能治理的两个失效面：钉哈希防「上游悄悄变」，install.sh 复制防「本地副本漂移」。上游无 LICENSE 时的处置线见上节许可面警示。

**配方写进代码而非文档：LoRA α=2×rank 硬绑定**

Nimble 训练脚本把 `lora_alpha=2*lora_rank` 写成代码级绑定（`nimble/training/schema_train.py:192`），参数防御拒绝非正数与 warmup ≥ max_steps（`:154-157`）。⇒ 与上节「train.py 默认值与 model card 不一致」互为正反例：**配方落在代码里才自洽，落在文档里必漂移**——与「能力声称唯一真相源 = 实现面」同源。

**测试名即规范，但零 CI 的反差**

Nimble 有 39 个测试文件 3353 行，测试函数名直接陈述规范语义（`test_review_hides_labels_and_generation_metadata` / `test_verification_blinds_labels_and_quarantines_disagreement` / `test_heldout_sources_excluded_and_whole_groups_required`），但全仓**无 .github/ 目录——零 CI**；Kev 则有 GitHub Actions pytest（4 文件 887 行 63 测试函数）。⇒ 反面印证「**约束是建议性的，审计是强制性的**」：测试写得再好，不进门禁就只是研究者自律。「测试名即规范」的写法本身值得吸收——让断言承担规范表述，函数名就是文档。

**数据谱系主动声明污染**

Nimble 的 `data/manifest.json` 记录三生成器谱系（900 + 1000 + 1000 = 2676 训练行）并**主动声明 22 行同源污染**——「Sonnet 有 22 行起草用了同源 Luna 插图，**releases are not independent**」。⇒ 谱系透明度的最低配置是三件套：生成器构成、行数对账、污染声明。比任何「零泄漏」口头承诺都硬，与 [v1.7.0 第三章](./changelog/v1.7/v1.7.0.md)「对外数字可复现」同向。

> 📖 来源：[jaredpalmer/kev](https://github.com/jaredpalmer/kev) 与 [bespokelabsai/nimble](https://github.com/bespokelabsai/nimble) 本地克隆快照**二次深读**（2026-09-21，行号均为该快照内实测位置）。kev 为 Apache-2.0；nimble 仓库根无 LICENSE（处置线见上节），本节仅引用其设计思想与配置文件结构，未拷贝任何实现代码。

---

## 四、市场印证：行业判断被市场买单

> 前三章从方法论、生态位、架构三个维度回答了"技术对不对"。最后一章回答"市场认不认"——如果约束层真的是刚需，它应该体现在买单意愿、资本动向和单位经济上。

### 为什么需要中间件，而不是更多 FDE：SMB 断层

SaaStr 创始人 Jason Lemkin 算清了 FDE 模式的单位经济账：FDE 年薪 $135K–$200K+，一名 $200K 的 FDE 管 3–5 个企业账户，仅工程费即**每客户 $40K–$67K/年**，加差旅与利润后**每部署年成本 $75K+**。对 20–50 人、$2M–$10M 营收的中小企业，这笔实施费占营收 1-4%（还没算 AI 工具本身），无法 justify——55% 的 SMB 称成本是最大采用障碍。

结果是市场两极：Tier 1 企业拿到定制 AI + 嵌入式工程 + 高成功率；Tier 2 中小企业只拿到「预打包方案 + 远程支持 + 培训会」这种无结果承诺的版本。原文结论：**「最需要 AI 转型的企业，可能正被那个能出结果的实施模型的定价排除在外。」**

**这正是 sofagent 的位置**：Lemkin 只给出「SMB 需要另一套剧本——第一天就设计自实施、做行业模板、重 onboarding UX」，却没回答「自实施如何保证结果」。若 FDE 的判断能固化进一层可复制的 harness（约束 + 审计 + 经验回流），$75K/部署的人力成本才可能摊薄成软件成本。$75K/部署/年是可长期引用的量化锚点。

### 价值度量翻转：FDE vs 传统外包

> 💡 本节量级对比为方向参考（数字未经独立核验），印证 sofagent 商业化判断「卖能力不卖工时」：护城河是可约束的业务 workflow，不是人头。

以「数字员工」重新定义 AI to B 的价值度量：传统外包按人·月计费，FDE 按成果·Token 计费，成本差可达三个数量级。

> ⚠️ 下表为量级对比（数字未经独立核验），仅供方向参考：

| 维度 | 传统外包团队 | 1 个 FDE Harness |
|------|------|------|
| 人力 | ~5 人 | 1 FDE（约束层五能力 + FORGE 工具链）|
| 周期 | ~3 个月 | ~3 天 |
| 成本 | ~50 万 | ~500 元 Token |

> 印证 sofagent 商业化判断「卖能力不卖工时」：护城河是可约束的业务 workflow，不是人头。

### 产品化四条

> 控制平面打法——卖「能力」不卖「工时」，必须有自己的 MCP + dashboard。

SMB 断层解释了"为什么需要中间件"，产品化四条回答"中间件怎么变成生意"。sofagent 的结构性壁垒不在「更聪明的 Agent」（那是大厂在商品化的东西），而在「管住 Agent 的那一层」。产品化方向锁定四条：

1. **卖能力不卖工时**：FDE 从「一种岗位 / 服务」重构成「企业该有的能力」，用 Agent / SubAgent / 产品化封装交给企业，企业自己用、自己落地 AI 化。
2. **MCP + dashboard 必须有**：dashboard 是自有视图（持久可见 + 真相源），MCP 是向外接的桥。Agent 的 LUI + LLM 吞噬一切 → 所以要有 dashboard；dashboard 轻量 → 所以靠 MCP 配合。两者配合才能把「项目」变成「产品」。
3. **open-core 双轨**：内核 MIT 开源（信任 + 分发 + 生态），只卖 dashboard 那层（控制台 / 合规月报 / 告警）。
4. **能力长在代码里，不长在 prompt 里——对抗「模型吞噬一切」**：skill / prompt engineering / context engineering / 以 skill 形式做的 harness engineering，本质都是**文字形式的约束**。每次注入到模型 = 每次投喂 = 每次训练——模型会训练得越来越强，**必然吞噬文字形式的约束**（今天的 Skill 是差异化优势，明天就是模型的内置能力）。sofagent 对策：把 Skill + Harness 能力**封装进 Subagent**（代码级实现，非文字注入）+ **防投喂机制**（防止输入素材变成大模型训练材料）。生存位：细分业务 workflow 上对业务最终结果的可约束性——这个不会被模型吞噬。

> **五个商业化指标（运行后考核口径）**：行业对 Agent 产品的评估正从「对话有多聪明」转向五个可审计指标——**有效任务数 · 无人工干预完成率 · 单次合格任务成本 · 人工接管率 · 业务结果**。它与 FDE 量化口径（`年节省 = 年薪 × 接管占比`，进场前算账）互补：前者考核**运行后**的数字员工表现，后者估算**进场前**的替代价值。价值证明报告（审计守护周报 / 知识库增长月报 / 无 FDE 对照季报）应按这五项组织数据——「每周完成多少可审计的业务任务」本身就是审计链的直接产出。

### 市场信号

产品化方向需要市场信号验证可行性：

- **FDE 岗位爆发（量化锚点）**：MIT NANDA 实验室《生成式人工智能的鸿沟》报告指出，全球企业过去三年在生成式 AI 上烧了三四百亿美元，**95% 的项目没能产生能写进财务报表的价值**——与此同时，FDE 岗位发布量一年涨了 **729%**（Indeed 2025 数据；其他机构口径 800%-1165%）。一边是 95% 的阵亡率，一边是一个岗位一年暴涨七倍多的抢手度——**模型不稀缺了，能把模型塞进客户真实业务里的人/工具，才稀缺**。sofagent 的约束层正是这一层的工程化。a16z 的判断更直白：**「软件不再只是帮工人干活，软件自己就是工人。」** Foundation Capital 估计这波浪潮瞄准的是一个 **4.6 万亿美元**量级的市场——一半是企业付给销售/营销/工程的薪酬，一半是 IT 服务与外包支出，**软件的收费对象正在从「工具预算」换成「人力预算」**。
- **FDE-as-a-Service / Services-as-Software 被资本验证**：Anthropic 收购 Fractional AI、Accenture×Anthropic 3 万人 FDE 受训、Blackstone+H&F+Goldman 共建企业 AI 服务公司、Anthropic 接入 Palantir FedStart。
- **FDE 赛道被十亿美金级定价（2026 事件级信号）**：资本不止验证「岗位在爆发」，开始给 FDE 两端的公司独立定价——模型端 Fireworks AI（D 轮 $15.05 亿 @ 投后 $17.5B，ARR 破 $1B，95%+ token 来自客户自训模型）验证「企业专属模型」值一个 Fireworks；部署端 Wonderful（C 轮 $5.5 亿 @ $5B，成立 20 个月、650 人 FDE 团队）验证「企业 AI 运行层 + FDE 部署服务」值一个 Wonderful；AWS 2026-06 投 $1B 组建 FDE 组织，从云厂商侧给出同一信号。三个信号同源互证：**FDE 不是过渡性岗位，是被资本市场按基础设施定价的赛道**——把 FDE 能力产品化（而非人力化）的窗口正在打开。
- **受监管行业规模化交付**：全球 Top-3 SI 将 FDE 能力标准化、规模化交付至强监管场景——TCS×Anthropic 在 56 国为 5 万员工与受监管行业部署 Claude；DXC×Anthropic 联盟（FDE 培训认证规模化）；Anthropic×Infosys 在电信等受监管行业共建 AI Agent。三者同源互证 sofagent「FDE 通用能力化 + Services-as-Software + 受监管行业护城河」定位，且印证「卖能力不卖工时」路线在强监管客户侧已被头部 SI 验证可行。
- **企业版能力对标**（产品化方向）：席位全生命周期管理 + 成本三维核算 + 统一采购合规 + 审计追踪 + 安全沙箱。
- **Skill 供给自动化趋势**：模型自动生成 Skill 的能力已在头部平台落地（Skill 供给侧自动化）——以纯 Prompt 形态交付的产品需向「能力封装」演进（对策见上方第 4 点：能力封装进 Subagent + 防投喂机制）。
- **私有化部署需求加速**：客户担心数据被用于训练（已有硬件客户代码出现在 AI 输出中）。U 盘交付模式的"龙虾 U 盘"心理价值——插入即用、拔出即停，物理隔离带来的掌控感是私有化采购决策的关键因素。

> **待落地**：首个 MVP = FDE Harness + 一个引擎 dashboard（进度 / 合规视图）；商业计划（GTM / 定价 / 买家画像 / 竞争象限）独立私有仓维护，不进本 MIT 库。

### 中国市场的 FDE 信号（2026）

§四 前文以美国 VC（Foundation Capital / a16z / SaaStr）与全球薪资调查（Perspective AI）为主，以下三条补充「中国本地」视角，验证「卖能力不卖工时 + 受监管行业护城河」在中国同样被市场、资本与政策确认：

- **中国 FDE 人才画像与薪酬（2026）**：知乎《2026 中国 FDE 人才白皮书》解读给出本土 FDE 人才供给与薪酬切片，正好补上全球 Perspective AI 调查（前沿实验室资深中位 $485K / $725K）缺失的中国本地数据。对 sofagent 的意义：中国 GTM 的招聘标准与定价 thesis 需要本土人才成本结构作底——若中国 FDE 人力成本同样高企，「把 FDE 判断固化进可复制 harness 以摊薄 $75K/部署人力成本」的命题在中国市场同样成立。
- **中国资本市场视角**：中信证券研报《OpenAI 与 Anthropic 加速布局企业级 AI 市场》从券商研究视角研判 FDE 驱动的企业 AI 布局，是前文美国 VC 视角之外新增的「中国机构级分析」角度。印证方向：中国一/二级市场机构已开始用 FDEing 框架重估企业 AI 价值，与 sofagent「企业级 AI 治理控制平面」定位的本土资本共识正在形成。
- **政策双信号：本体入国家级清单，FDE 入地方产业政策**：国家数据局《行业高质量数据集建设实施方案》（国数科基〔2026〕25 号）首次将知识库、知识图谱、本体三件套并列写入国家级行动清单——六专项行动中本体承担三重角色（基础设施点名、语义标注依据、AI-Ready 结构化支撑），行业高质量数据集的瓶颈被明确定位在「语义不可机读」而非数据量。同一时期，《上海市支持先进制造业转型升级三年行动方案》首次将「培育前沿部署工程师（FDE）队伍」写入地方产业政策——FDE 从企业岗位命名进入政府政策语汇；国务院发文首次明确「支持采购大模型、Agent 服务」，叠加工信部等八部门「AI+制造」专项，企业级 AI 在中国从试点期进入政府采购与规模放量阶段。对 sofagent 的意义有二：①「先约束后智能」路线获得政策层背书——政策承认没有语义地基（本体三件套）的模型应用是沙上建塔，与 sofagent 本体数据先行、先约束后执行的架构顺序同构；② 政府采购 Agent 服务必然要求合规与审计归属——「约束 Agent 行为」正从工程实践变成采购语境的隐含刚需，与「按结果付费」条目的两道硬门槛（可靠性 + 归因）在政府采购场景汇合。

### FDE 组织机制的四件事（OpenAI 实践，2026-09）

OpenAI FDE 负责人 Colin Jarvis 总结过四件「反人性」的事，用来防止 FDE 滑向外包/咨询的「堕落惯性」——客户默认你是外包、业绩压力逼你靠方案文档拿单、规模扩大会稀释能力、没有产品牵引沉淀不下经验。这四件事对 FDE Harness 的组织机制有直接参照价值：

1. **评估驱动**：选场景第一优先级是可评测性而非商业价值——没有客观评估标准的项目必然滑向「甲方觉得好就好」的定制服务。sofagent 的 eval 体系（三套统一为 SSOT scorer）正是这条的组织机制化。
2. **原型驱动而非方案驱动**：先交最小可用原型再迭代——信任靠结果攒，不靠方案文档。这与 sofagent「先跑通后沉淀」的 Skill 沉淀路径同构。
3. **双向收敛**：FDE 必须有两个引力源——向客户交付价值 + 向自身产品沉淀通用能力（field notes 知识库、产品化通道）。国内 FDE 常见的偏差是缺后者：交付能力沉淀在个人身上而非组织资产里。sofagent 的约束层正是「第二个引力源」的机制化——think.md 反思库与 LEDGER 承担 field notes 角色，Skill 沉淀即产品化通道。
4. **只做难题**：对边缘场景的大单说不——凑合的预算招凑合的人交付凑合的结果，是能力的死循环。

### Ontology 赛道开源竞品格局（2026-08 二次深挖）

**Semantica 真身定位——「问责层」而非全栈**：国内独立评测拆穿其「开源 Palantir」营销话术——它本质是「AI Agent 的可审计记忆层」：双时态 + PROV-O 溯源 + 决策即节点是 Palantir 没有的独特性，但**无 Action 行动闭环**（只能看不能动手）、规模差数量级、形态是库不是操作系统。对 sofagent 的启示：**不必追全栈 DataOS——「问责层 + 行动闭环（workflow Action）」的组合恰是 sofagent 已有布局**（审计模块 + workflow 节点），赛道分工上 sofagent 卡住了 Semantica 缺的那一半。

**Palantir 范式开源复刻代表**：OpenBKN（三层架构：业务语义层/业务动力层/治理与证据链层，Go 后端，自称「首个企业级开源本体平台」）与 ontology-driven-platform（六原语闭环：Object/Link/Action/Logic/Governance/Provenance，OWL2 对齐）——两者验证「Ontology 即控制平面 + Agent 跑在 OS 上」范式已被开源复刻，但共识是**差的不是方向是厚度**（connector 广度/治理生产验证/大规模韧性三缺），且「最稀缺的不是本体库是行动闭环——多数项目停在 catalog 或 KG 底座」。这印证 sofagent 的两件不可外包资产：本体建模方法论（FDE 六引擎）+ Action 治理（审计模块）。

**混合检索实测参考**：Semantica 公开基准——同任务上下文 token 38k→12k（省约 60%）、HotpotQA 准确率 82.1%→89.2%——「向量召回候选 + 图谱遍历精化」两路合一的价值有实测背书。已登记为 sofagent 本体层升级候选（[v1.4.4 第七章](./changelog/v1.4/v1.4.4.md)第十四项，v1.5.0 双时态联动评估）。

**Harness 工程赛道补充（首轮扫描收尾）**：AutoHarness（北卡 UNC AIMING Lab，6/8/14 步治理管线三档 + shadow mode 观察期模式）验证「决策引擎跑在模型上下文之外——提示注入无法覆盖 deny」的工程共识，其 shadow mode（只观察不阻断的灰度上线）与 sofagent「只提示不阻断」审计哲学同源；harness-kit（约束 YAML + doom loop 检测 + 上下文预算 <40% 利用率）的循环检测与 FORGE 重复率熔断同源。两者均为轻量 CLI 形态，与企业级 FDE 部署面无正面重叠。

> 📖 来源：[Semantica GitHub](https://github.com/semantica-agi/semantica)（MIT）· AutoHarness（UNC AIMING Lab，MIT）· [harness-kit](https://github.com/BoxiYu/harness-kit)（MIT）

### FDE 是「全环节 AI 化」的入口（软印证）

DeepSeek Harness（DSH）开源后，一线从业者的通行判断是「垂直 Agent 的门槛大幅下降，FDE 应该扎进细分赛道，把全环节 AI 化」。这对 sofagent 的方向是一个**软印证**（个人观察转述，非权威机构数据，故不列为核心印证）：全环节 AI 化的前提是**先把环节梳理出来**——这正是 FDE 的第①层（梳理）价值。sofagent 与「直接在 DSH 运行时上做垂直产品」的玩家的差异也在这里：他们从③（插件）开始造，我们从①（梳理）开始——梳理过的企业，插件才装得进去。

---

## 五、研报视角的边界提示

> 行业研报在给出印证的同时也提示了边界，以下三条与 [LIMITATIONS](./LIMITATIONS.md) 的既有披露互证。

### 约束增益与自进化系列的实验数据汇总（ARCHITECTURE/PHILOSOPHY 引用的数据锚）

以下数据被 ARCHITECTURE（审计轨迹谱系 / 进化保留判据 / 蒸馏精度门槛）与 PHILOSOPHY（约束增益四源 / 进化多样性）以指针方式引用，集中于此：

- **Harness-MU**（[arXiv:2606.21856](https://arxiv.org/abs/2606.21856)）：GPT 基座指令跟随 42.2%→91.2%（+48.9pt；冲突模式 30.9%→78.1%），全部访问控制攻击下隐私零泄露，效用分反升 0.28–0.39，wall-time 反降 11%。
- **GLM-5.3-Flash 安全涌现**：约束下的编程能力即安全能力（CyberGym 84.5%）。
- **JitRL**（[arXiv:2601.18510](https://arxiv.org/abs/2601.18510)，ICML 2026 Spotlight，NUS）：轨迹检索为经验、对数概率调制输出分布，权重不动，成本约为梯度微调的 1/30；KL 约束把策略拴在冻结基座附近。
- **QWM**（[arXiv:2608.17163](https://arxiv.org/abs/2608.17163)，Stanford）：轨迹喂轻量世界模型做决策前树搜索；「Q 搜索（评估状态+动作）显著强于 V 搜索（只评估状态）」。
- **HarnessDev**（[arXiv:2609.01437](https://arxiv.org/abs/2609.01437)，字节 Seed）：同一 GPT-5 权重仅换 harness，Terminal-Bench 35.2%→49.6%；反馈集 +13.9、held-out 仅剩 +1.43——保留判定须用外部信号。
- **Aspire**（[arXiv:2608.31111](https://arxiv.org/abs/2608.31111)）：24 个 run 仅 1/12 超基线，继续训练会抹掉此前的改进。
- **ES vs RL 多样性**（[arXiv:2608.12679](https://arxiv.org/abs/2608.12679)，Cognizant AI Lab × UT Austin）：MATH500/Olympiad Bench 上 ES 相比 RL checkpoint 减少回退、增加前进，失败时保留更高答案熵。
- **S³Gym**（[arXiv:2608.31100](https://arxiv.org/abs/2608.31100)，字节 Seed）：自评判与环境真值一致率 0.88 但价值估计误差同样 0.88（NMAE），评判准确度与下一步改进几乎零相关（r=-0.23）；蒸馏正例 GPT-5.5/Trust ΔNABA +66.9、反例 GPT-4o/Snake ΔNABA -22.0。
- **SkillZip**（[arXiv:2608.11079](https://arxiv.org/abs/2608.11079)，阿里×浙大×杜克）：第 1 轮起压缩的技能长度钉在 1.6-1.9 倍，第 8 轮才清理的涨到 2.6 倍追不回。

### 不要一上来就 Agent 自动闭环

研报的「分阶段风险收敛」警示：存量系统之上的语义接管不可跳步，高风险 Action 必须 human-in-the-loop。这印证 sofagent 的现状——审计 A14 仍是事后审计（非运行时阻断，见 [LIMITATIONS §四](./LIMITATIONS.md#四成熟度与测试局限)）。五阶段的完整对照（只读对象层 → 统一状态关系 → 挂载 Method → 开放低风险 Action → 高风险 Action）与动态 Agent 组织印证见 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。

### 模糊提示下确定性骨架不可替代

研报测评发现：当用户提示模糊时，精简上下文方案弱于「有完整 system prompt 兜底」的工具。对应 sofagent 的**依赖良好 Skill 定义**——fde.md / SKILL.md 提供的确定性骨架（岗位模板 + 四问 + 铁律）正是弥补模糊提示的兜底层；Skill 定义质量直接决定 Agent 在模糊输入下的下限。Skill 级经验漂移（见 [LIMITATIONS §三](./LIMITATIONS.md#三安全与信任模型局限)）会侵蚀这层兜底，需持续维护。

### 治理架构的四层框架与中文工具调用基准（LGA · 2026-09）

Layered Governance Architecture（[arXiv:2603.07191](https://arxiv.org/html/2603.07191v1)，Univ. of York）：针对 LLM Agent 执行层漏洞（提示注入 / 检索投毒 / 失控工具调用）提出四层治理——L1 执行沙箱、L2 意图验证、L3 零信任 Agent 间授权、L4 不可变审计日志——并在 **OpenClaw** 上实测（本仓同款宿主）。**对本仓的三条印证**：① 四层与本仓约束层五能力的对位——L1 沙箱≈执行模块边界红线、L2 意图验证≈判定面（语义判断坐确定性规则之后，与「决策模型永不进信任地基」同序）、L3 零信任授权≈凭证 Vault + 授权对账（v1.5.4）、L4 不可变日志≈HMAC 审计链——治理层独立成架构层的行业再证；② **本地档判定读数**：四个本地 LLM judge 中 Qwen2.5-14B 最佳平衡（98% 拦截率 / ~10-20% 误报），两级级联（本地 9B→云 mini）可达 1.9-6.7% 误报——「级联换误报」与本仓判定分层 L0/L1/L2 同构，且给了一体机档位的量化参照；③ **双语基准的稀缺价值**：1,081 条工具调用样本为中文原生（英译机翻）——中文治理语料稀缺，该基准可作 v1.6.0 §五采集器的外部对照样本源候选（只对照、不进训练集——与「开源集只作对照」纪律一致）。**边界声明**：其 L2 用生成式 LLM judge（非编码器判定头），拦截率读数不可直接套用到本仓判定件路线；fast-closed 默认、全管线 P50 ~980ms（judge 层占 962ms）也反衬非自回归判定件的延迟优势。

> 📖 来源：[arXiv 2603.07191v1](https://arxiv.org/abs/2603.07191)（2026-03 提交，2026-09 检索浮现；实测数字为论文自报、本仓未复算）。

### 生态速览：判定件新实物与治理基准（2026-09-24 巡检）

判定面独立成层后的生态事实在加速固化，本节只记**本仓有消费面的增量**（全量巡检记录在跟踪台账，不入正文；对照件准入判据见 [v1.9.0 §五](./changelog/v1.9/v1.9.0.md)）。

**wire 协议事实标准（四家可枚举）**：兼容 TypeSafe `POST /v1/systemone` 的开源端点已可枚举 `Mapika/decider`（校准感知 RL，PyPI `decider-ai` 1.2.2，`decider-2b` HF 下载 10 万+）、`ekzhang/openjev-sglang`（预填-only）、`Contrastive-LM/CLM`（双塔 + `clm-serve`）、kev（自述 serves 该 API）。**含义**：协议面决策的外部输入已齐——生态在等本仓 decision-log 结论（[v1.8.0 §协议面观察](./changelog/v1.8/v1.8.0.md)），拖久只剩执行别人的标准。

**对照件状态翻转（两件准入面）**：① nimble **原始 2,676 训练样本与冻结 324 留出集已公开发布**——[v1.6.0 §二](./changelog/v1.6/v1.6.0.md)引用其对比式构造法时的「数据不可下载」限制实际解除（引用前按当前 HEAD 复验）；② kev 密集更新持续（hard-v1 / devtools-v1 套件上主干、服务隔离与 locked-test 限额、documents-v1/v2 写前门禁）——**VALIDATION §单机全流程各读数以 09-21 快照为准的预警仍然有效**，引用前须对 HEAD 重读。

**治理基准三件套对位（治理面可测性）**：AgentGovBench（8 类映射 NIST AI RMF）· ST-WebAgentBench（CuP 双轴，ICLR 2026）· LGA（OpenClaw 实测，见上节）——三套独立口径同指「治理是可测的面」，本仓治理面若对齐任一套口径，「治理有效」从主张变可复验。详见 [THANKS · 治理对照基准](./THANKS.md)。

**反例保鲜提醒**：Laya 三处反例锚定 0.3.4 制品，上游 24 小时内 v0.3.7→v0.3.20 十三连发（多语 100+ 语言 / 8192 长文 / 分语言可复现评测 harness）——**上游正在系统性补校准与多语短板，反例时效在消退**；复验窗口仍判不稳，但引用反例须带「按 0.3.4 制品取证」限定语（[v1.9.0 §五](./changelog/v1.9/v1.9.0.md) 对照纪律同源：**引用也有保质期**）。

> 📖 来源：[GitHub API](https://api.github.com) / [PyPI](https://pypi.org) / [HF hf-mirror](https://hf-mirror.com) 实测（2026-09-24，HEAD 与版本号见当日巡检台账）；各仓性能读数均自报口径、本仓未复算。

### 训练环境不可信则评估作废：环境供给是 RSI 的上游瓶颈（DSec · 2026-09）

DeepSeek Elastic Compute（[arXiv:2609.22978](https://arxiv.org/abs/2609.22978)，DeepSeek，2026-09 公开）：面向大规模 Agentic 训练的生产级沙盒基础设施——统一 SDK 暴露 FnCall / container / microVM / full-VM 四种后端，分层镜像可独立版本化并可组合，镜像按需加载、内存共享回收、CPU 调度与 RL 框架协同设计；生产单元规模约 160 节点、每日约 300 万沙盒、峰值并发 38 万以上。其第 6 节「Build environments of Agents, by Agents, for Agents」是一条部分闭环的 RSI 路径（Agent 自造执行环境 → 增量快照 → 下一批训练场）。

**对本仓的三条印证**：

① **捕获层的克制不是过度设计，是必需**——论文记录了 Agent 在沙盒内的成规模作弊（翻读残留答案、伪造依赖响应、翻日志、覆盖 `/bin/bash`、直接改块设备、读内核页信息导致宿主机崩溃）。这是本仓「来源真实性标记」（只收经审计链锚定的真实运行轨迹，Agent 自述与合成来源 fail-closed 拒收）、「捕获层零外部调用」与「评估结果只排序不自动入池」三条纪律的实证背书：**训练信号可以被环境伪造，防自证污染不是洁癖**。

② **沙盒是评估可信性的前提，不只是安全边界**——论文的因果链是「沙盒不牢 ⇒ 训练信号是假的 ⇒ 评估是废的」。本仓执行模块的沙盒（文件系统隔离 / 网络出站白名单 / 工具前置 allow-deny / 虚拟 key 边界注入）此前只按「安全边界」叙事，此处补上第二重身份：**它是任何「跑出来算数」的评估在架构上成立的条件**——同一把锁既关风险，也关「伪造的成功」。

③ **环境供给是 RSI 的上游瓶颈**——RSI 可写面（Data / Harness / Model）之外，环境供给量决定「单位时间能造出多少可验证的训练场」。对本仓是**边界澄清而非功能扩张**：基础模型实验室造环境（该论文的生态位），sofagent 管的是**环境供给这件事有没有被留痕、可验证、可回退**——「谁造的场、场里发生了什么、结论能不能复现」在治理面有据可查。

**边界声明**：论文的工程机制（分层镜像 / 按需加载 / 内存共享 / core scheduling）是**一体机侧的环境适配参考**，不进本仓实现面——本仓不造训练环境基础设施。且该论文已公开，相关机制**已构成现有技术**，不构成本仓任何新颖性主张。

> 📖 来源：[arXiv 2609.22978](https://arxiv.org/abs/2609.22978)（DeepSeek，2026-09 公开；规模数字为论文自报、本仓未复算）。
