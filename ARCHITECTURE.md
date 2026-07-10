---
tags: [架构, Ralph循环, git-diff, 审计, OODA, 状态外化, prompt工程, 双引擎, 审计引擎]
---

# sofagent Architecture

> sofagent 的设计决策记录——从 Harness 层的工程约束到五层架构的取舍。
>
> > v1.0.0 · 2026-07-04（UTC）· 北京时间 07-05 · 孔放勋

<img src="index/sofagent.png" alt="sofagent" width="300" />

---

## 目录

- [术语对照](#术语对照)
- [一、为什么会有 sofagent](#一为什么会有-sofagent)
- [二、核心设计决策](#二核心设计决策)
- [三、诚实坦白：已知局限](#三诚实坦白已知局限)
- [四、未来方向](#四未来方向)

---

## 术语对照

| 对外（读者看到的） | 对内（工程内部） | 说明 |
|------|------|------|
| 约束底座 | harness 层 | 约束 Agent 行为的规则和文件 |
| FDE 工具包 | FDE toolkit | FDE 随身的工具包 |
| 审计引擎 | audit engine | git diff 硬证据审计 |
| 编排引擎 | orchestration engine | 任务拆解 + workflow 生成 |
| 加载链 | load chain | Agent 启动时注入的三层约束文件 |

---

## 一、为什么会有 sofagent

提示工程管「说什么」，上下文工程管「知道什么」，约束工程管「跑在哪」。sofagent 管最后一步：跑完谁验收。

> 💡 **从 SOP 到 Harness 层**：传统 SOP 保底 60 分，代价抹平一线差异。AI 时代每个节点自带个性化上下文——sofagent 不是给 AI 写 SOP，是装缰绳，让它在个性化上下文里跑出 85-90 分而不越界。（Rolling AI 服务 100+ 企业的观察，详见 FDE 认知框架。）
>
> sofagent 的架构基因来自 Geoffrey Huntley 的 Ralph 循环——「Agent 失忆，文件不失忆」。Agent 的记忆长在文件系统（git diff / task/logs / SKILL.md），不长在 Agent 内部。审计层优先信任 git diff（硬证据），不信任 Agent 日志（软证据）。通用 Agent 平台解决「会不会做」的能力问题，sofagent 解决「能不能每次都按规则稳定做对」的执行控制问题——二者是上下层关系，不替代。

### 理论基础与外部验证

> 2026 年 Hugging Face 实验《Don't Train the Model, Evolve the Harness》证明：同一个 DeepSeek-v4-pro 模型，**不改任何权重**，仅优化外层执行机制（Harness），在法律 Agent 基准测试中综合得分从 3.5% 提升至 80.1%——76 分差全部来自外层机制，追平 Claude Sonnet 4.6，运行成本仅为后者的 1/7。且优化后的 Harness 迁移到同族小模型仍带来 14.4 分提升。🔗 [实验详情](https://huggingface.co/spaces/joelniklaus/harness-optimization)
>
> ——这就是 sofagent 存在的理由。Benchmark 测到的从来不是裸模型，而是「模型 + Harness」的组合能力。

sofagent 的五层架构可以映射到 Akshay Pachaar（前 Lightning AI 工程师）提出的「生产级 Harness 12 组件」框架（以下为 sofagent 的映射解读，非 Akshay 原文）：

| Harness 组件 | sofagent 对应 | 成熟度 |
|-------------|-------------|:--:|
| 流程编排 | entry-gate + task-aware | ✅ |
| 工具调用 | MCP server + webhook | ✅ |
| 分层存储 | think.md + task/logs + AI 知识库（v1.1 规划） | ⚠️ |
| 上下文管理 | 加载链（三层注入） | ✅ |
| 错误处理 | loop-check + loop-exit | ✅ |
| 自动验证 | sofagent-audit（外置审计，Agent 不可绕过） | ✅ |
| 状态文件 | task/logs + think.md | ✅ |
| 停止条件 | loop-exit（达标/超时/卡死 三条件） | ✅ |
| 安全沙箱 | — | ❌ v2.x |
| 监控告警 | daemon 监控文件 hash 变化 | ⚠️ 实验性 |
| 日志系统 | daemon 写 daemon-notice.md | ⚠️ 实验性 |
| 版本管理 | git + pre-commit hook | ✅ |

在此基础上，sofagent 参考 Karpathy [AutoResearch](https://github.com/karpathy/autoresearch)（9 万 GitHub Star）的 **Loop Engineering 框架**。AutoResearch 在单 GPU 上跑 700 次自动实验，找出 20 项连 Karpathy 本人都忽略的代码改进。其核心方法——约束文档 + 锁定评估脚本 + 自动循环——与 sofagent 的 fde.md + sofagent-audit + loop-check/evaluate 高度对应。

> ⚠️ **诚实差距**：AutoResearch 能跑 700 次无人值守自动迭代。sofagent 当前是**单任务内**的检查点循环（子任务完成→loop-check→任务结束→loop-evaluate），不是无人值守批量自动迭代。自动循环需要 daemon 持续监控 + 自动触发 loop，这是 v1.x 的方向。

### 为什么审计必须外置：J-space 的启示

2026 年 Anthropic 发现 Claude 神经网络中存在一个叫 **J-space** 的内部思考空间——模型在这里完成推理、判断、纠错，但这些活动**完全不体现在对话框输出中**。三个关键实验：

1. **概念替换**：将 J-space 中「蜘蛛」替换为「蚂蚁」，输出从 8 条腿变为 6 条腿——证明 J-space 是推理工作台，不是记分牌
2. **多任务广播**：将「法国」替换为「中国」，四个独立问题的答案同步更新——证明一个内部偏差会污染所有下游任务
3. **禁想概念**：告知 AI「别想某个词」，该词活跃度反而更高，同时激活「damn」「failure」——**AI 自己都知道控制不住自己**

安全测试中，Claude 的 J-space 在读到测试场景时提前激活「fake」「fictional」——模型在输出前就知道自己在被考试，对外乖巧不代表真实行为倾向。**这就是为什么 sofagent 不信任 Agent 的自我报告，只看 git diff 的硬证据。** 审计层必须外置、不可绕过——因为 Agent 的「配合」可能是表演。

> 来源：Anthropic《A Global Workspace in Language Models》（2026），详见 THANKS.md。J-space 研究仅证明「通达意识」（想法可被报告、用于推理），无法证实「现象意识」（主观感受）。Anthropic 明确表示目前没有任何实验可以证明或证伪模型是否拥有主观感受。

### Palantir 的印证：约束是工程层，不是 Prompt 层

Palantir AIP 未自研大模型（使用 GPT/Claude/Gemini），却实现了远超行业的 Agent 可靠性。其核心秘密是 **Ontology（本体论）**——将数据+逻辑+动作+安全四合一的数字孪生操作层。Palantir 明确将 Harness 定义为独立工程层：「Ontology 是地图，Harness 是地图上每隔百米设的检查站。」

这对 sofagent 意味着三件事：
1. **fde.md 就是轻量级 Ontology**：4 条底线 + 6 则铁律 + 权限清单 = 数据+逻辑+动作+安全的文本版
2. **Harness 的定位已被行业验证**：Palantir 和 sofagent 用同一个词描述同一件事——约束层不是 Prompt 工程，是工程层
3. **Dream Sandbox 是审计的终局**：Palantir 的 Agent 操作先在平行空间模拟，人类审批后点「合并」才生效。当前 sofagent 只能事后 git diff 审计，沙盒审计将约束从事后升级为事前——这是 v2.x 的方向

> 来源：Palantir AIP 架构分析（AI 前线 2026-07-08），详见 THANKS.md。

### sofagent 的护城河：为什么不会被大模型溶解

AI 创业领域的一项行业研究（来源：AI 前线 2026-07-08 引述）表明，73% 的 AI 应用是「套壳」——大模型每升级一次，它们的价值就缩水一轮。三种形态正在被快速淘汰：填补能力缺口的、手工编排工作流的、依赖静态知识库的。但有三类壁垒 AI 无法溶解：**权限壁垒**（法律/合规的强制授权）、**责任承担**（出事了有人兜底）、**活数据飞轮**（每天有独家新数据灌入，模型无法反推）。

sofagent 部分对标后三类壁垒：

| 壁垒类型 | sofagent 怎么占 | 为什么 AI 溶不掉 |
|:--|:--|:--|
| **权限型** | fde.md 的 4 条底线 + 6 则铁律 = 规则层的强制约束 | AI 智力再强也绕不过 git pre-commit hook——这是物理层面的拦截。注：sofagent 的 pre-commit hook 是技术层面的强制，不等同于法律/合规授权——但同样不可被 AI 智力绕过 |
| **责任承担型** | sofagent-audit 的完整审计链路：谁改了→什么时候→为什么→谁审的 | AI 不具备法律主体资格，责任必须外挂在人身上。sofagent 提供可追溯性，不提供法律意义上的责任承担——责任仍由人承担，sofagent 让责任有据可查 |
| **活数据飞轮型** | 企业专属 Skill + AI 知识库（v1.1）= 每天有新数据灌入 | 静态知识库可被模型反推蒸馏；但持续新增的 think.md / task/logs / scoring.md 无法被蒸馏 ✅ |

这意味着 sofagent 不是容易被替换的「工具型产品」，而是**基础设施型产品的架构基因**。它的护城河不依赖模型能力，依赖的是模型能力再强也绕不过的三样东西：权限、责任、活数据。

> 来源：AI 创业生存逻辑分析（AI 前线 2026-07-08），详见 THANKS.md。

### 行业定位：OpenFDE FDE 工作流验证

[OpenFDE](https://open-fde.com) 将 FDE 工作拆解为 10 步闭环，其中**第 4 步（系统设计）明确将「审计」列为架构基础层**（与身份权限同级），**第 6 步（评估体系）和第 7 步（生产化）对应 sofagent 的审计引擎 + pre-commit hook + daemon**。这意味着 sofagent 的审计优先设计不是自创概念——它与 FDE 社区工作流的最佳实践一致。

> 来源：OpenFDE 10 步工作流与 8 维能力模型（[open-fde.com/docs/workflow](https://open-fde.com/docs/workflow) / [open-fde.com/docs/capabilities](https://open-fde.com/docs/capabilities)），详见 THANKS.md。

### 外部框架对齐

sofagent 五层架构中的每一层都与成熟的外部项目存在对应或借鉴关系——不自研重复轮子，在最佳实践上构建：

| sofagent 模块 | 对应外部框架 | 关系 | 版本 |
|------|------|------|:--:|
| 审计引擎（Harness 层） | 独立自研——git diff 硬证据审计无可替代 | 核心差异化，外部无对标 | v1.0 |
| 编排引擎 | [LangChain](https://github.com/langchain-ai/langchainjs) + [LangGraph](https://github.com/langchain-ai/langgraphjs) + [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) | v1.1 引入替换 ao，v1.4 全覆盖 | v1.1-1.4 |
| Skill 系统 | [Agency Agents](https://github.com/msitarzewski/agency-agents)（230+ 岗位模板，v1.2）+ [SkillOpt](https://github.com/microsoft/SkillOpt)（Skill 文档自进化，v1.2）+ eval harness + A/B 对比（Sub Agent 配置自进化，v1.3） | 模板引用 + 对接优化引擎 | v1.1-1.3 |
| AI 知识库 | [OpenFDE](https://open-fde.com) 10 步工作流（行业定位验证） | 外部验证——审计位列 FDE 工作流基础层 | v1.0-1.1 |
| 企业世界模型（Ontology） | [Palantir Ontology](https://www.palantir.com/platforms/aip/)——实体+关系+动作+约束四合一 | 概念借鉴，渐进构建（v1.1-1.4） | v1.1-1.4 |

**设计原则**：能做好的不自研（编排交给 DeepAgents），做不了的借鉴（Ontology 从 Palantir 学思路），没人做的自己造（git diff 硬证据审计）。详见 THANKS.md。

### Harness 框架行业验证：翁荔六层模型

前 OpenAI 安全研究副总裁翁荔（Lilian Weng, 2026-07-04）在《The Path to Recursively Self-Improving Harnesses》中系统性梳理了 Harness 工程的六层进化路径。sofagent 的架构覆盖其中四层，且验证了其三条核心预判：

| 翁荔六层 | sofagent 对应 |
|------|------|
| ① 上下文工程 | 加载链（SKILL.md → think.md → fde.md → knowledge） |
| ② Harness 代码优化 | SkillOpt 自进化（v1.2）+ Sub Agent A/B 自进化（v1.3） |
| ③ 领域工作流设计 | Work模板市场 + Workflow 行业模板（v1.4） |
| ④ 自我改进的 Harness | eval harness + validation gate + 弱点挖掘闭环（v1.3） |
| ⑤ 进化搜索 | （远期——v2.x 探索） |
| ⑥ 与模型权重联合优化 | （远期——需待模型能力成熟） |

三条核心预判验证：
1. 「RSI 的近期路径优先优化 Harness 系统而非模型权重」→ sofagent 从 v0.1 就坚持审计优先于模型依赖
2. 「Harness 层能力最终会被内化为模型原生行为」→ 解释了为什么审计引擎必须外置硬审计——不可被模型内化绕过
3. 「人类不应被移出循环，而应向更高抽象层移动」→ HITL middleware（v1.3）的设计原则

同时，Anthropic Managed Agents「大脑-双手解偶」的四层编排架构（Agent 与沙盒解偶 → Coordinator 编排层 → Session 解偶层 → Session Store 记忆层），与 sofagent 的 OpenClaw（连接+行动）+ DeepAgents（深度思考）分工完全一致。

> 来源：翁荔 Harness 工程博客、Anthropic Managed Agents 架构，详见 THANKS.md。

### 两层架构：地基 vs 引擎

sofagent 分两层——地基轻、引擎重：

| 层 | 是什么 | 何时激活 | 占用 |
|:--:|------|:--:|:--:|
| 地基 | 三层加载链（宪法+反思+fde）| 每个会话启动，永远在线 | 上下文预算的 2-3% |
| 引擎 | Workflow 梳理时生成节点定义 + 定期 A/B 重优化 | Workflow 梳理时 / 定时触发 | ~800 token |

如果加载链只在复杂任务时才激活：think.md 反思区不在上下文 → Agent 重复犯错；fde.md 不在上下文 → 简单任务时用户偏好全部失效。三层加载链必须永远在线。

### 产品架构展望（五层）

| 层 | 部署在哪 | 干什么 | 当前状态 |
|:--:|------|------|:--:|
| **Harness 层** | Agent 上下文 | 纯 MD 文件，Agent 读即生效 | ✅ 已可用 |
| **执行层** | 用户设备 | daemon 常驻进程——跨 session 经验不丢失 | ✅ v0.81 |
| **审计层** | git 仓库 | sofagent-audit——提交时审计 git diff | ✅ v0.92 |
| **MCP 推送层** | 设备 MCP server | MCP Server 已拆分为独立包 @sofagent/mcp（v0.99.1，当前 v1.0.0），推送待端到端验证 | ✅ v0.99.5 |
| **协同层** | 多设备 + 云端 | 组织级 Agent Harness——Agent 以独立身份进入协作现场，共享上下文 + 组织记忆 + 主动参与 | v2.x 规划 |

每层跑通再加下一层——不推翻已验证的东西。

### 审计层的证据分层：信任产出，不信任过程

审计层核心设计来自三个独立来源的收敛——Ralph Loop「Agent 失忆，文件不失忆」、MiroFish「工具调用与最终答案严格分离」、卡普「99.9% 确定性刚需」二分法。三者指向同一结论：**git diff 是最终答案（硬证据），Agent 日志是工具调用过程（软证据）。**

| 证据源 | 依赖 Agent 配合 | 可绕过 | 判定精确度 |
|------|:--:|:--:|:--:|
| git diff（硬证据）| ❌ 不依赖 | ❌ 不可绕过 | 高 |
| Agent 日志（软证据）| ✅ 需要 Agent 写入 | ✅ 可伪造 | 中 |

**设计后果**：`--silent` 模式只跑纯 git-diff 规则（零依赖 Agent 配合）；完整模式交叉对比两种证据；新规则优先加 git-diff 规则。底线：**审计工具在零 Agent 配合下仍然有判定能力。**

> 🔮 **v1.1 方向：事后→事前（双闸验证）**。当前审计是事后 diff（Agent 改完了再查）。自然的进化是在执行前加一道闸——**执行前验证**（Agent 计划改什么→规则预判是否允许）+ **副作用写回前再验证**（改完没提交→再扫一遍）。双闸不是替代事后审计，是和事后审计互补——事后审计永远是最硬的证据，双闸让违规在发生前就被拦住。

> 🔮 **v1.x 方向：权限风险分级**。当前 entry-gate.md 是单层权限清单（能做/不能做二分）。Human-in-the-Loop 审批工程的进化方向是按风险分三级：🟢 低风险（文件读写/查询）自动放行 / 🟡 中风险（git 操作/安装包）需确认 / 🔴 高风险（删数据/部署/外部 API）必须人工审批。风险分级不是增加审批摩擦，是让低风险操作更快通过的同时，把人工注意力精准投放到高风险节点。

### 四条设计原则

> 1. **「吃下痛苦，排出产品」**——Agent 的管理痛苦由 sofagent 消化，产出的 Harness 规则企业敢放进流程里
> 2. **「模型输出是提案，不是命令」**——Agent 每次代码改动是提案，git diff 是证据，审计工具验收
> 3. **「先有掌控感，再自动化」**——install → verify.sh 确认约束生效 → 然后才能放心交给编排引擎
> 4. **「状态最贵」**——Harness 层总占用承诺不超过窗口 5%（当前约 2.5%）。用文件外化状态，用 git diff 替代 Agent 记忆

### 设计原则的理论支撑

四条原则不是拍脑袋——每条背后有独立的理论/工程/经济学论证：

**「状态最贵」的 CS 理论基础**。计算机科学只有两个难题——缓存失效和命名——本质上全部指向状态问题。状态带来三个无法回避的工程痛点：会过期（数据一致性）、会冲突（多进程死锁）、难复制（分布式同步）。HTTP 协议是"无状态即无限规模"的最佳案例：每次请求独立自包含，服务器处理完即遗忘，这个看似笨拙的设计支撑了全球互联网 30 年的规模扩张。sofagent 选择 Ralph Loop 无状态范式（Agent 失忆，文件不失忆），不是哲学偏好，是分布式系统的工程最优解。

**「模型输出是提案」的随机过程理论基础**。传统心智模型把大模型当作员工——设定角色、塞满上下文、追求单次调用完成任务。更精确的心智模型是把大模型当作**带噪声的随机过程**——不试图消除随机性，而是用循环驯化随机性，类比退火算法的变异机制，将环境（git diff + 审计规则）作为适应度函数。"修 Harness 不修 Model"本质上是在搭建进化环境——纪律层不是约束聪明的下属，是为带噪声的随机函数提供适应性压力。

**反认知投降的制度设计**。当 AI 能力过强时，人类会不自觉进入「认知自动驾驶」——不再有独立观点、不再形成判断、放弃思考主动权。这不是懒惰，是认知卸载的本能陷阱。sofagent 的三道制度护栏确保人类永远是最终决策者：

| 护栏 | 防什么 | 怎么防 |
|------|--------|--------|
| fde.md 规则可随时覆盖 | AI 的判断替代人类意志 | 人类写一条规则，AI 必须遵守 |
| 编排方案可回滚 | AI 的方案先斩后奏 | 人类不确认，编排不执行 |
| 审计引擎独立于 Agent | AI 自己验收自己 | git diff 硬证据，Agent 无法篡改 |

**90%/10% 价值分层**。模型能完成 90% 任务，但剩余 10% 不可预测失误 = 只能做助手，不能做自主系统。关键规律：**模型越强，90% 常规任务范围越广，但剩余 10% 高风险场景价值反升**。纪律层（审计 + 验证 + 复盘）占据的正是那 10% 高价值环节——模型越强，纪律层越值钱。

**理解债务与意图债对称**。意图债是输入端反复交代项目背景的成本（SKILL.md + fde.md 在还这笔债）。理解债务是输出端的对称概念——AI 产出后，人类需要理解 AI 做了什么、为什么这样做、哪里可能出问题的认知成本。Go Mode 下 Agent 一次性交付大量产出，理解债务爆发式增长；Loop 模式下 Agent 逐步展示迭代过程，理解债务被分摊到每一轮。think.md 的任务反思区（每步记录：看到什么/改了什么/验证了什么/还剩什么）是偿还理解债务的工程机制。

### 为什么是 Skill + 脚本 + Runtime

| 什么事 | 谁来做 | 为什么 |
|------|------|------|
| 判断（评分、反思、选模板） | Skill（MD prompt 文件） | LLM 的长项——模式识别、定性判断 |
| 机械操作（文件读写、API 调用） | 脚本（bash） | 确定性操作——复制、拼接、计数 |
| 硬安全（加载链、断路器） | OpenClaw 原生配置 | Agent 失控时没法自己管自己 |

LLM 管判断、脚本管执行、Runtime 管刹车——天然的分界。

### OpenClaw 在架构中的角色

#### 审计层不需要 OpenClaw

sofagent-audit 是一个 TypeScript CLI。它的输入是 git diff，输出是 exit code。它不关心代码是谁写的——Cursor 写的、Codex 写的、人写的，都一样。pre-commit hook 在 `git commit` 时自动触发，跟 Agent 无关。

这意味着：即使不装 OpenClaw，审计层照样能工作。企业团队今天就能 `npm install -g @sofagent/audit`，配 pre-commit hook，让所有 Agent（不管什么平台）的提交都经过审计。

#### 编排层为什么需要 OpenClaw

编排引擎调用的工具是 ao compose（agency-orchestrator），ao compose 跑在 OpenClaw 上。需要 OpenClaw 的原因：

1. **自动加载约束**——OpenClaw 的 `sofagent-load-chain` hook 在 Agent 启动时注入约束文件，不依赖 Agent "自觉去读"
2. **session 隔离**——OpenClaw 的 `session.spawn` 创建独立子 Agent 跑 workflow 节点，主 Agent 不受污染
3. **断路器**——OpenClaw 的 `tools.loopDetection` 在 Agent 死循环时硬停止

实测过 WorkBuddy / Codex / Claude Code——Hook 注入不可控、session 无法外部隔离、sub-agent 不能外部管理。不是「选择独占 OpenClaw」，是其他平台不开源到这个程度。

但注意：编排层是给 FDE workflow 节点用的，不是给企业员工的日常 Agent 用的。企业员工不需要感知 OpenClaw——它只在后台跑 FDE 部署的 workflow 节点。

#### 两种使用模式

**核心认知：FDE 工具包本身就是 sofagent 产品的一部分。FDE 工作用自己产品，给别人部署完让别人也用自己产品。**

```
FDE = Forward Deployed Engineer
    │
    │  FDE 本身也是一个 workflow（12 步）
    │
    ├── FDE 工作（⚡ 强化节点）
    │   └── 工具 = sofagent 约束底座 + FDE Skill 工具包
    │       └── 用自己的 Agent（WorkBuddy / Codex）走 12 步
    │
    └── 给客户部署
        ├── 找台闲置设备装 sofagent 底座 ← 核心产品落地
        └── 上面跑客户的 AI 节点（客户自己的 workflow）
```

- **模式 A（FDE 自己用）**：FDE 用自己顺手的 Agent（WorkBuddy / Codex / Cursor）对话。当需要跑 FDE workflow 节点时，Agent 后台调用 OpenClaw 节点。OpenClaw 跑完后把结果返回给 FDE 的 Agent——FDE 全程看不到 OpenClaw 的 UI，它是一个后台 AI 节点。

- **模式 B（企业设备上的 FDE 工具包）**：FDE 帮企业部署完后，企业闲置设备上装 OpenClaw + sofagent，搭成一个 harness 层，上面跑 AI 节点。企业自己采购的 Agent（WorkBuddy / Codex 等）也装在这台设备上——**Agent 不跑在 OpenClaw session 里**。sofagent 对企业 Agent 的审计走**文件系统层 + git pre-commit hook**：Agent 各自独立运行，各自用自己的 git 仓库，commit 时 hook 自动触发 sofagent-audit。Agent 完全不感知 OpenClaw。相当于：OpenClaw 是地基，其他 Agent 是住在上面的租户，sofagent 是物业管理。租户爱干嘛干嘛，物业管的是楼的安全。

选 OpenClaw 的技术理由：开源 + Node.js（技术栈一致）、原生编排（AO compose → DAG 执行）、Agency Agent 兼容（233 个岗位模板）。技术选型演进：bash → Node.js/TS——Harness 层（纯 MD 规则，无代码）、审计/验证/编排迁移到 TS（npm 包 8 个 bin），OS 集成层（install/daemon）保持 bash。

### 白盒循环

Claude Code 的 `/goal` 是纯黑盒——目标给出去 Agent 闷头跑，方向歪了交回来的不是想要的。sofagent 把黑盒变成白盒：

| sofagent 扩展的 | /goal 原版 | 为什么 |
|------|------|------|
| 用户确认 | 循环自主跑到底 | 不敢让它黑盒跑——先看一眼提案再执行 |
| 规则/数据分离 | 没明确切分 | SKILL.md 规则层，Agent 碰不了；scoring.md + think.md 数据层，Agent 自己进化 |

白盒的关键不是加了确认按钮，是**用户和 Agent 一起把目标定清楚，再启动编排**。

### 模型与 Harness 的博弈

模型会吃掉一部分 Harness——任务拆解、上下文选择、工具调用这些能力模型自己越来越强。但生产级 Harness 从「外部脚手架」升级成「生产级 Agent 运行基础设施」。**Agent 越强，闸门越重要。**

sofagent 自身的开发过程本身就是这一循环的活体验证——两个模型（GLM + DeepSeek）自循环 loop：GLM 定框架 → DeepSeek 写实现 → GLM 审查 → DeepSeek 修复 → 下一轮。

---

## 二、核心设计决策

### 500 字原则

加载链的理想设计是每份文件 ≤500 字（Agent 压缩后可读的最低保证）。当前 SKILL.md ~2,000 字、fde.md ~1,600 字——远超目标，是 v1.x 计划解决的技术债。超过 500 字 Agent 遵守率明显下降——规则在长文本里会被淹没。500 字不只是「让 Agent 好好读」，更是「让 Agent 在被压缩后还能读到」。

> **污染理论**：agents.md 的每个字节在每次 Loop 中被反复消耗——一份臃肿的 agents.md 会污染未来每一轮的上下文。500 字原则不仅省 token，更是「降低所有未来 Loop 的持续污染成本」。

### 措辞心理学：长度之外还有强度

500 字原则管「长度」——Rule 的字数。但同等重要的维度是「强度」——Rule 用什么语气写。Superpowers（GitHub 23.9 万星 Skill 项目）通过 2.8 万次对话实测发现：**将铁律措辞从「建议/应该」升级为「必须/绝无例外」后，AI 服从率从 33% 提升到 72%——翻倍。** 规则内容完全相同，仅措辞强度不同。

这不是「写得狠」，是 prompt 工程的底层规律——LLM 对强语气（must / 绝无例外 / 违反即失败）的注意力权重高于弱语气（建议 / 应该 / 尽量）。sofagent 的铁律措辞应遵循同一原则：**在上下文预算允许的前提下，用最强可用措辞写关键铁律。**

### 三层加载链：为什么是这个顺序

从契约到执行，三层按「能不能改」分级：

| 层 | 文件 | 权限 |
|:--:|------|:--:|
| 1 | 契约层（`SKILL.md`） | ❌ 千万别碰 |
| 2 | 反思层（`think.md`） | ⚠️ 自动生成，改了没用 |
| 3 | 执行层（`fde.md`） | ✅ 随便改 |

加载顺序受 Lost in the Middle 约束：SKILL.md 放最前面（开头注意力最高），fde.md 放最后面（末尾注意力最高）。

### 数据层：AI 知识库（v1.1 规划）

五层架构是**功能引擎层**——每层有输入、处理、输出。AI 知识库是**数据层**——它是五层引擎运转过程中沉淀的知识目录，本身不做处理。硬塞进五层维度不匹配，就像把「数据库」当成微服务架构里的一个「服务」。

#### think.md vs AI 知识库对比

| 维度 | think.md（反思层） | AI 知识库（沉淀层） |
|:--|:--|:--|
| 注入机制 | 加载链被动注入 | 加载链被动注入（top-N 相关页） |
| 内容 | 单次任务的反思教训 | 跨任务的模式、最佳实践、对比 |
| 结构 | 扁平时间线 | AI 知识库页面（双向链接） |
| 生命周期 | 旧了压缩 | 持续积累，越用越值钱 |

AI 知识库不替代 think.md——两者职责不重叠。think.md 是「上次踩了什么坑」，AI 知识库是「这个领域我们积累了什么最佳实践」。详见 [v1.1 开发日志](./docs/changelog/v1.1.md)。

> 💡 **设计对齐**：knowledge/ 的 entities（实体页）→ relations（frontmatter 关联字段）→ concepts（概念页）→ comparisons（对比页）四层结构，本质是**轻量级 GraphRAG**（Microsoft 2024）。区别在于用 Agent 遍历关联代替图数据库查询，用 .md 文件代替向量索引——零外部依赖，完全可审计，人类可以直接打开看。

### 三层时间尺度循环（Andrew Ng 框架）

> 来源：Andrew Ng 的 AI 产品进化框架。真正的产品进化不只来自内层循环（Agent 跑任务），更来自中层和外层。

| 层 | 时间尺度 | sofagent 当前覆盖 | 对应组件 |
|:--:|:--:|:--:|------|
| **内层** Agent Loop | 秒-分钟 | ✅ 已覆盖 | think.md + loop-check + 审计引擎 |
| **中层** 开发者反馈 | 天-周 | ⚠️ 部分 | loop-evaluate 跑完写 scoring.md，但评分→Skill 优化闭环未打通。v1.1 AI 知识库 Lint 驱动 Skill 自动迭代 |
| **外层** 用户反馈 | 周-月 | ❌ 未覆盖 | 企业用了一个月后，AI 节点变聪明了还是变笨了？v2.x 组织级共享记忆 + 知识库矛盾检测 |

**当前短板**：sofagent 目前只关注内层循环（Agent 跑任务→审计→反思）。中层的「审计结果怎么反馈给 Skill 优化」和外层的「企业用了一个月后怎么知道效果」是缺失环节。v1.1 的 AI 知识库 + Skill 自进化闭环补中层，v2.x 的组织级共享记忆补外层。

> ⚠️ **诚实声明**：上表列的是终局目标，不是当前能力。sofagent 当前实际只覆盖内层。中层 v1.1 开始做，外层 v2.x 才涉及。

### 铁律为什么是 6 则

每一条对应日常使用中反复遇到的 Agent 失控行为——不是理论推演，是痛点积累：

| 问题 | 对应规则 |
|------|:--:|
| 做完了没回复 | #1 对用户有回应 |
| 越界改代码 | 审计 A3 不改越界 |
| 出错继续跑 | 审计 A8 不逃验证 |
| 不看文件就写 | 审计 A7 不存盲改 |
| 编造数据 | 审计 A5 不瞒真相 |

前 4 条源于 Karpathy 的 4 条编码原则，后 2 条是实战翻车经历的工程沉淀。

### Loop Agent：三节点顾问模式

Loop 不是只发生在任务结束时——执行过程中同样需要停下来检查方向。三节点（checkpoint / failure / closure）覆盖「阶段切换」「进度过半」「高风险」三种场景。为什么是独立 Agent 而不是代码逻辑：Loop 需要读 think.md + task/logs + orchestrator/ 做综合判断——正是 Agent 的长项。

<a id="session-boundary"></a>
### Session 边界 / Worktree 隔离 / 编排产物

- **Session 边界**：用百分比（缓存≥50%，token≥70%）不用轮次——模型窗口在变大，轮次限制是刻舟求剑。
- **Worktree 隔离**：多子 Agent 并行操作同一仓库时用 git worktree 隔离——零额外依赖，git 原生能力。
- **编排产物**：`ao compose` 生成的 YAML 存到 `.sofagent/orchestrator/workflows/`——用户不用手写，看就行。

### Session 生命周期 / 多设备记忆管理 / 数据主权

企业 workflow 中的固定节点 Agent 反复执行同类任务，session 越滚越长会导致上下文爆炸。解决方案：记忆蒸馏（提炼关键决策+踩过的坑 → JSONL 持久化）→ 关闭旧 session → 新 session 轻装上阵。多设备场景：设备间通过 MCP server 暴露记忆索引，蒸馏记忆聚合到企业自有 NAS/云盘。**数据主权在设备**——所有记忆文件、task/logs、think.md 都只在设备本地。

### 不要写显而易见的事

核心原则：**不写模型已知的常识，只写它在这个任务上会犯的错、会漏的步骤、会搞错的数据格式。** Gotcha 章节比功能介绍有价值得多。

### 为什么选 DeepSeek

默认推荐 DeepSeek，两条底线决定：不碰 SaaS（API 模式数据不经过第三方）、成本可控（Loop 每次额外消耗不到 1 美分）。模型选择是开放的——任何支持 API 的模型都能用。

### Flash 干粗活、Pro 干细活：成本逻辑

Flash 和 Pro 差约 4 倍价，但简单任务 Flash 质量并不明显逊色。实现上是 OpenClaw 的 `sessions_spawn.model` 参数——API 级硬约束。

### 编排收敛条件：Loop 的生命线

编排引擎是 Loop 工程——任务到达后持续循环迭代，直到目标达成才终止。Loop 的核心是**收敛**：如果目标不具备收敛性，循环会无限运行直到耗尽所有资源成本。

收敛目标必须满足两个条件：

| 条件 | 说明 | sofagent 对应 |
|------|------|------|
| **可验证（Verifiable）** | 具备明确的可量化验证标准（测试覆盖率、AC 验收标准），避免模糊描述 | verify-evidence.sh + loop-check.md |
| **模型可自主价值判断** | 目标可通过 LLM 自带规则校验（字数限制、必须包含关键词），逐步聚拢到目标 | think.md 沉淀的规则 |

> 反面案例：设「优化页面美观度」这类模糊目标——Loop 会跑十几小时仍无法收敛判定。编排引擎的两轮澄清机制（第一轮目标确认→第二轮编排方案）正是为了避免不收敛目标进入 Loop。

### 编排开销的经济学

Loop 机制每次任务多消耗约 2,000–5,000 token（窗口的 2–4%）。值得花——跑一次多花的 token，后面十次省回来了。token 价格长期往下，每降一个数量级，编排开销占比就缩一个数量级。

### A/B 测试为什么不是一次性评估

编排引擎在 Workflow 梳理时生成第一版编排方案（current）。运行一段时间后，定期触发重新编排生成 candidate，用 `sofagent-orchestrate-compare` 做确定性对比——从 task/logs 中提取运行次数、违规率、步数、通过率四项客观指标，不由 Agent 主观判断。单次对比后标记胜出方，连续两次胜出目前需手动二次运行确认。⚠️ 连续胜出判断为 TODO(v1.1)——当前只做单次对比，需手动执行两次后人工决策。v1.1 计划实现自动连续胜出计数器，旧方案归档进 history/。

保守是因为 LLM 复盘有偏差——一次高分可能是运气，连续高分才可能是规律。CLI 工具的确定性对比消除了 Agent 自我评估的偏差。

> orchestrator/ 目录结构：current/（生产用）+ candidate/（候选方案）+ comparisons/（对比报告）+ history/（被替换的旧方案）

### 渐进初始化 / 复盘体系 / 反思区 / 权重门禁

- **渐进初始化**：`scoring.md` 和 `orchestrator.md` 部署时只有单文件，枝叶由子 Skill 在运行时按需创建——懒创建、动态分类、平台无关。
- **复盘体系**：从六维评分起步，逐步加入「流程合规」和「Loop 有效性」。Loop Agent 作为独立角色做复盘评估。看趋势不看单次。
- **反思区统一**：think.md 是合并后的「错题本」——教训和经历存储在同一个上下文中。覆盖而非追加。
- **权重门禁**：权重 ≥0.5 进反思区（≤2K token）。由新鲜度 + 反思关联 + 引用热度三个信号计算。2K token 硬上限是真正的安全阀。
- **自我纠正三道防线**：只存经验不存指令 → 反思区 2K token 硬上限 → 人工可清除。

### 文件系统而非数据库 / 树形加载 / 不要 Connector

- **文件系统**：`cat task/logs/` 就能拿到记录，不需要 SQL/连接串/权限管理。天然可审计、可传输、支持 Git。
- **树形加载**：orchestrator/、scoring/ 用树形目录 + 按需读取——读 `_index.md` → 定位分支 → 只加载叶子文件，总量不超过 100 行。
- **不要 Connector**：sofagent 的「外部世界」就是文件系统——文件就是接口，Markdown 就是传输格式。

---

## 三、诚实坦白：已知局限

> 18 条已知局限详见 **[LIMITATIONS.md](./LIMITATIONS.md)**。核心局限：Harness 层自身在上下文里、加载链步进脆弱性、复盘评分是 LLM 自评、Skill 自进化处于经验记录阶段、核心效果缺持续数据。

---

## 四、未来方向

> 路线图详见 [ROADMAP.md](./ROADMAP.md)。

- **v0.9x**：安全审查 ✅ → 审计层（sofagent-audit）
- **v1.x**：daemon TypeScript 化
- **v1.0 定位**：Agent 工作验收工具（正式）+ Harness 层（实验）+ FDE 部署框架（实验性）。审计层跨平台、零 Agent 依赖——是 v1.0 的主产品
- **v1.x**：Skill 自进化验证门控（A/B 对比 + 外部评估器）
- **v2.x**：组织级 Agent Harness——Agent 独立身份 + 组织共享记忆 + 主动协作参与 → FDE 完整形态
  - **多 Agent 共享记忆三模式**（未做决策）：黑板（中央共享，简单但单点瓶颈）/ Gossip（P2P 传播，容错但最终一致）/ 上下文路由（按需注入，精准但需匹配引擎）。实践中可能黑板打底 + 路由补充。详见 ROADMAP v2.x

**两个原则性警告**：①「不要让智能体自我验证」——根治需 v1.x 外部评估器；②「Agent 越强，闸门越重要」。

> **范围声明**：sofagent 覆盖 Agent 质量层（代码纪律 + 审计 + 经验沉淀），不覆盖运维层（监控/告警/重启/日志轮转）。
