# 致谢

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> sofagent 站在巨人肩膀上。以下每一个项目、文章和作者，都在某个设计决策里留下了痕迹。

> v1.5.3 · 2026-09-26（UTC）· ✅ 已发版 · 孔放勋

---

## 基石

- **[OpenClaw](https://github.com/openclaw/openclaw)** · Peter Steinberger — 四层加载链的 Hook 机制源自它：上下文加载、Hook 触发、Skill 注入、Session 管理

## 生成伙伴

模型间 Loop 实验——多 session 内互改互审，直到所有模型都通过。随后新 session 重审，下一轮迭代开始。

- **[DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/)** · 深度求索
- **[GLM-5.2](https://z.ai/)** · 智谱 AI

---

## 思想之源

影响了 sofagent「为什么这么设计」的理论与实践。

### 哲学基因

- **[Ralph Loop](https://ghuntley.com/loop/)** · Geoffrey Huntley —「Agent 会失忆，文件不会」启发了审计方向：git diff 是无状态的地面真相
- **[Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills)** — 4 条编码原则是 9 则铁律的根基
- **[Anthropic Skills](https://github.com/anthropics/skills)** — 官方 SKILL.md 格式规范，描述-实现分离的参考

### Loop → Harness → Graph

- **[Loop Engineering](https://addyo.substack.com/p/loop-engineering)** · Addy Osmani — 正式命名了 Context → Harness → Loop 三层框架
- **[From Loop to Graph Engineering](https://engineering.zooz.com/intuitionmachine/from-loop-engineering-to-graph-engineering-d3ebeb08511c)** · Carlos E. Perez — 单闭环四类失效及 Graph 拓扑解法；没 Anchor 的 Graph 只是更贵的 Loop。sofagent 审计模块即独立审计闭环
- **[OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)** — Harness 概念的系统化参考
- **[Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)** · Anthropic — 长时间运行 Agent 的有效治理
- **[What makes a harness a harness](https://arxiv.org/abs/2606.10106)**（arXiv:2606.10106，2026-06-08）· Sanderson Oliveira de Macedo（单作者）— **agent harness 的构成性定义**（necessary and sufficient conditions）＋**可操作的包含/排除检验**：先以概念分析重建术语谱系（horse's tack → classic test harness → ML evaluation harness → agent harness），把边界划在 agent framework / agent SDK / IDE plugin / eval harness / orchestrator 之外；再用**六个真实 harness**（Claude Code、Codex CLI、Aider、Cline、OpenHands、SWE-agent）与刻意的边界案例验证该检验「包括与排除一致」。**对本仓的价值**：本仓「Harness = 约束层」的口径此前是自述式的（[ARCHITECTURE · 术语表](./ARCHITECTURE.md)），此文为「什么算 harness」提供了**外部学术锚**——本仓是其一种实现形态，不是该定义的复述。**口径**：单作者概念分析（方法为带持久标识符的文献 + 官方文档等一手灰色文献，非实验）；第三方流传的「四条件」式概括**本仓不采转述版**，只认论文自身的定义与检验

### 实验与证据

- **[Don't Train the Model, Evolve the Harness](https://github.com/JoelNiklaus/harness-optimization)** · Joel Niklaus — 不改权重、仅优化 Harness，让 DeepSeek-v4-pro 从 63.4% 升至 80.1%（+16.7pp），实验数据见研究代码仓库。sofagent 存在理由的外部证据
- **[AutoResearch](https://github.com/karpathy/autoresearch)** · Andrej Karpathy — 约束文档 + 锁定评估脚本 + 自动循环，与 sofagent 的 fde.md + audit + loop 高度对应
- **[Bilevel Autoresearch](https://arxiv.org/abs/2603.23420)** — 双层循环论文，外层强制探索回避方向可实现 5 倍性能提升
- **[MetaRSI / RSI²: A Meta-Recursive Self-Improving System for Recursive Self-Improving Systems Themselves](https://arxiv.org/abs/2609.06396)**（arXiv:2609.06396，2026-09-06）+ **[RSI-Harness](https://github.com/CosmosMind-ai/RSI-Harness)**（其开源实现）· CosmosMind — 递归自我改进（RSI）的统一形式化：Data / Harness / Model 三算子共享一个闭环内核，其上再加改进调度器。sofagent 的 Meta-RSI 三算子对位、「**保护面必须独立于所有可写面**」这条架构判断、以及「验证差距是自进化的适用边界」都源自此处；v1.5.8 的 RSI 缺口对位（经验池接训练管道 / 进化准入判据 / 三层晋级 / 出题考核）即照它补差
- **[SoL-Pi](https://arxiv.org/abs/2609.20519)**（arXiv:2609.20519，2026-09-17）— **把 RSI 施于 harness 层**的活体样本：不更新权重，而是在约 500 个环境构成的搜索空间里让 agent 自动改进自己的 harness，最终四个机制存活下来（Action Fusion / ObservationPack / Evidence-Preserving Reducer / Online Context Compact）。**对本仓的价值是划边界而非学方法**：「自我改进的调度器」这一层正是本仓 RSI 定位**明确不做**的部分（本仓只做治理与审计层，见 [v1.5.8 准入门与晋级判据](./changelog/v1.5/v1.5.8.md)）——SoL-Pi 是「谁去做调度器」的第三方实例，本仓与之的关系是**被它调用与约束**，不是复现它。**读数（自报、本仓未复算）**：迁移到 51 个留出任务后 token 消耗降约 44.7%–49.0%、成本约降三分之一，同时保留 93.7%–94.3% 的原分数——只落方向与量级，不引其数字入对照表
- **[DeepSeek Elastic Compute (DSec)](https://arxiv.org/abs/2609.22978)**（arXiv:2609.22978，2026-09-19）· DeepSeek — 面向大规模 Agentic 训练的生产级沙盒基础设施：统一 SDK 暴露 FnCall / container / microVM / full-VM 四种后端，可独立版本化的分层镜像、按需加载、内存共享回收与 CPU 调度同 RL 框架协同设计。第 6 节「Build environments of Agents, by Agents, for Agents」给出部分闭环的 RSI 路径——Agent 自造执行环境、增量快照沉淀为下一批训练场。**对本仓最重的一条论断：自我改进卡住的从来不是 GPU，是环境供给。** 它与上一条 MetaRSI 互为上下句：三算子回答「改什么」，环境供给回答「在哪儿改、改得可不可信」——环境供给是 Data-RSI 的上游瓶颈，也是本仓「训练信号不可被环境伪造」这条默认前提的实证出处
- **[Grow the Harness, Not the Context](https://arxiv.org/abs/2609.26760)**（arXiv:2609.26760v2，2026-09-22）— 把**反复出现的控制决策从模型上下文搬进可复用可执行代码**：起点是「无策略骨架」（只暴露固定的模型与工具接口、不含任何解题控制器），靠函数级执行轨迹把失败定位到有界代码面，联合修复一个失败窗口，并以**成功优先的留出集闸门（success-first held-out gate）回滚会伤害既有能力的修复序列**。**对本仓最重的两条**：① 「held-out gate 回滚有害修复」是 [v1.5.8 晋级证据门槛](./changelog/v1.5/v1.5.8.md)「严格优于历史最佳才接受、持平即不接受」的**机制同构**，也是「留出集优先」的又一份独立实证；② 「把控制移出上下文、移进低成本代码」与 v1.6.0 §四「**纯函数型常数留代码、不判定化**」同源。**读数（自报、本仓未复算）**：在三个部署模型（4B–120B）上把 LLM 调用数与部署推理成本都显著压低，且小模型档位的优势最大——**只落方向与机制，不引其数字入本仓对照表**
- **[Harness-Zero](https://arxiv.org/abs/2609.24974)**（arXiv:2609.24974，2026-09-21）— **harness 蒸馏**：以领域/实例优化过的 harness 作训练期指导，经「agent-as-harness」（受优化 harness 指导的 agent 在**目标** harness 的动作空间里先修正学生回答再执行）把 harness 引导转成训练示范，微调后**专用 harness 可在部署期移除**。**对本仓的价值**：这是 [v1.5.8 晋级三层](./changelog/v1.5/v1.5.8.md)中**「微调摊销」那一层此前唯一缺外部实证的环节**——它正面回答了「凭什么信把能力蒸进权重比长期挂着 harness 更划算」。**读数（自报、本仓未复算）**：移除专用 harness 后基础模型任务成功率大幅上升，且**高于该 harness 仍挂着时的读数**，并能恢复基础模型本不具备的多数 harness 诱导行为（按行为模式统计）。**边界**：只作机制与层级归属参照，不引数字入对照表
- **[Lost in the Middle](https://arxiv.org/abs/2307.03172)** — 长文档中段注意力衰减，500 字原则的理论源头
- **[A Global Workspace in Language Models](https://www.anthropic.com/research/global-workspace)** · Anthropic — 模型输出前已形成未表达判断，为「审计必须外置」提供底层论证

- **[Claude Opus 5 / 上下文工程](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)** · Anthropic（Thariq Shihipar）— 指令从 800 词精简至 164 词后性能反升，宣告提示词工程时代终结。底层逻辑转向「上下文工程」——设计信息架构（什么该给 / 何时给）。与 sofagent「约束进代码层而非 prompt 层」判断同源。

### 编排与架构

- **[Managed Agents](https://www.anthropic.com/engineering/managed-agents)** · Anthropic — 四层编排架构，验证 OpenClaw（连接+行动）与 DeepAgents（深度思考）分工
- **[Deep Agents](https://github.com/langchain-ai/deepagentsjs)** · LangChain — LangGraph 状态底座 + Harness 范式 + HITL，验证 v1.x 技术选型（v1.2.0 已迁移至 LangGraph createReactAgent）
- **[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)** · DeepSeek — 「一切皆插件」开源 Agent 运行时（Cordis 微内核：模型/工具/沙箱/UI 全是插件，无特权内核），启发 v1.3.4 编排层与执行层分离（ExecutionBackend 接口，DSH 作为可选执行后端）；其事件即扩展点（会话/Agent/能力三事件域）与可撤销效应是 v1.4.0 反向插件 `@sofagent/cordis-plugin` 的协议基础
- **[Cordis](https://github.com/cordiverse/cordis)** + **[时空可组合性论文](https://github.com/cordiverse/paper)** · cordiverse — DSH 底层框架：时间可组合性（每次修改记录逆操作，卸载逆序恢复）+ 空间可组合性（依赖声明自动重协调）+ 事务式热重载——「自进化的难点是修改后的可恢复与可协调」为进化模块补上运行时视角
- **[Claude Code Agent Loop](https://docs.anthropic.com/en/docs/claude-code/how-claude-code-works)** · Anthropic — 三阶段循环 + 三档工具权限，与 sofagent HITL 🟢🟡🔴 同构
- **[Palantir AIP Ontology](https://www.palantir.com/platforms/aip/)** · Palantir — 数据+逻辑+动作+安全四合一的数字孪生层，Harness 定义与 sofagent 一致
- **The Path to Recursively Self-Improving Harnesses** · 翁荔（Lilian Weng）— 六层 Harness 优化框架（原 lilianweng.github.io/posts/2026-07-04-harness-rsl/ 链接已 404，保留文字引用不链死链）
- **[The Anatomy of an Agent Harness](https://x.com/i/article/2040732084843782144)** · Akshay Pachaar — Harness 即 LLM 的操作系统，12 个核心组件
- **[Three Key Loops](https://www.deeplearning.ai/the-batch/three-key-loops-for-building-great-software)** · Andrew Ng — 分钟→小时→天-周三层嵌套循环；开发者留在循环的理由是上下文优势而非品味
- **[OpenWorker](https://github.com/andrewyng/openworker)** · Andrew Ng 团队 — 开源桌面 AI 代理（**18.3k stars @2026-09-25 实测**，原记 7.3k 系早期快照；星数为时序量，引用须带时点；MIT）。四级权限模型（plan/interactive/auto/custom）和无人值守收件箱设计，为 FDE sustain 模式的 daemon 审批机制提供参考。"Ask for an outcome, not just an answer"的产品叙事与 sofagent「交付文档而非建议」同源
- **[aisuite](https://github.com/andrewyng/aisuite)** · Andrew Ng 团队 — OpenWorker 的底层引擎，`<provider>:<model>` 统一接口 + Agents API + tool policies。与 sofagent 的 OpenAI 兼容多供应商路由定位同向，国产模型覆盖面印证统一接口方向的行业共识
- **[DeerFlow](https://github.com/bytedance/deer-flow)** · 字节跳动 — 用 "super agent **harness**" 命名其运行时框架，印证了 Harness 作为 Agent 工程化品类的行业站住
- **[Omnigent](https://github.com/omnigent-ai/omnigent)** · Databricks 系 — 开源 meta-harness：策略强制在基础设施层而非 prompt。与 sofagent「约束进代码层」判断同源
- **[LiteLLM](https://github.com/BerriAI/litellm)** · BerriAI — 开源 LLM gateway，未来控制平面成本与路由层可站在上面
- **[bubblewrap](https://github.com/containers/bubblewrap)** · containers 项目 — OS 级沙箱原语，未来 SubAgent 沙箱可直接复用
- **[LangChain middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/custom)** · LangChain 1.0+ — wrapToolCall 是运行时审计的精确接入点
- **[EnkryptAI Secure MCP Gateway](https://mintlify.wiki/enkryptai/secure-mcp-gateway)** · EnkryptAI — 安全护栏 + audit_only 模式，可作运行时审计参考
- **[Agent Client Protocol (ACP)](https://github.com/Agent-Client-Protocol/spec)** — LSP 式开放协议，未来接入层可对齐而非自造
- **[DataFlow](https://github.com/OpenDCAI/DataFlow)** · 北京大学 DCAI — 独立用「Harness」命名 Agent 约束层，sofagent「Harness 品类」的第三方佐证
- **[ChatDemo](https://github.com/OpenFDEAI/ChatDemo)** · OpenFDEAI — 以 Forward Deployed Engineer 命名售前工作流，印证 FDE 术语同源
- **[PenguinHarness](https://github.com/Prism-Shadow/penguin-harness)** · Yaowei Zheng（LlamaFactory 作者）— 开源 Agent 自我进化平台（Apache-2.0），Benchmark 评测与工具审批四模式方法论为 v1.3.x 提供设计参考
- **[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)** · Prime Intellect — 开源 RLM 持续运行 Agent（MIT）。Continual Harness 的跨进程写保护与 RefinementEvent 证据记录，为 v1.3.3 进化链路可靠性提供设计参考
- **[Control the Harness, Control the Cost](https://arxiv.org/abs/2609.28919)**（arXiv:2609.28919，2026-09-24）· Arian Abbasi / Alan Aqrawi / Ted Kwartler — 企业视角的 harness 治理：harness「决定哪个模型回答、模型读到什么、prompt cache 怎么用、哪些 subagent 跑」，因此**它同时决定价目表上的费率与在什么费率上买了多少量**；多数企业不造 harness 而是向大厂采购（Claude Code / Codex 一类），**保留一个未调优 harness 的默认值，等于把成本与治理一并交出去**。**对本仓的价值**：本仓「约束层是成本与治理的实际控制点」这一命题此前只有方法论论证，此文提供了**采购与成本侧的外部论证**（与 [v1.5.8 晋级门槛「成本—收益分离」](./changelog/v1.5/v1.5.8.md) 同向）。**边界**：分析性论述，无可供本仓复算的读数
- **[Self-Healing Harness](https://arxiv.org/abs/2609.24130)**（arXiv:2609.24130，2026-09-21）— 把「agent 自我修改」形式化为**准入门控（admission control）**：agent 可以提议修改自身的操作指令，但**由外部的运行时闸门决定哪些修改得以持久化**（Detect → Notice → Heal → Validate 循环，围绕一个本身未被修改的 agent 运行）。**架构同构点（本批最重要的一条外部对位）**：这正是 [v1.5.8 准入门与晋级判据](./changelog/v1.5/v1.5.8.md) 的结构——**提议在内、门在外、持久化由门决定**，并与本仓「判定者须位于可写面之外」「保护面必须独立于所有可写面」两条架构判断同源。**边界**：只作结构对位与术语参照，不入对照表

### 判定与校准

决策模型（约束层底座，随本仓开源）的来源。这一节记录的不含已交付能力，而是一条判断的出处：**判定层的门槛不在模型架构，在判据数据集**。

- **[SalesRLAgent](https://arxiv.org/abs/2503.23303)**（arXiv:2503.23303，2025-03-30）· Nandakishor M — 把概率预测当作序列决策问题、用强化学习训练专用概率估计模型而非生成文本，「只出概率、不生成文本」的路线由此而来
- **[Confidence-Aware Routing for LLM Reliability Enhancement](https://arxiv.org/abs/2510.01237)**（arXiv:2510.01237，2025-09-23）· Nandakishor M — 统一置信度分数驱动四路径路由（本地生成 / 检索增强 / 更大模型 / 人工复核），与判定分层 L0 → L1 → L2 + 第三态同构
- **[DeepRAG: Building a Custom Hindi Embedding Model from Scratch](https://arxiv.org/abs/2503.08213)**（arXiv:2503.08213，2025-03-11）· Nandakishor M — 同作者从零自建 embedding 模型的实现参考
- **[Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)**（2026-09-15）· TypeSafe AI —「RLCD（Reinforcement Learning for Calibrated Decisions）」这一术语、System One 模型类与 Choice / Score / Noul 三原语的提出方；「校准优先于偏好」由这里来。**厂商侧迄今未披露损失函数、校准曲线与 ECE 数据（无论文）**；第三方黑盒实测已有 ECE ≈ 0.031 / MMLU-Pro 84.6%（1,200 条样本，独立测量、本仓未复算），另有公开复现报告其相对理想校准曲线仍略显过度自信（口径：厂商零披露的事实、第三方独立测量的数字、复现观察三者分列，不互为遮蔽）——本项目把 ECE 列为验收必测项，从这个空白处起步
- **[laya](https://huggingface.co/convaiinnovations/laya)**（Apache-2.0）· Nandakishor M / Convai Innovations — 非自回归判定模型的开源实现（ModernBERT 编码器 + option-marker 判定头 + 三原语 + 分桶温度校准），是本方案架构与代码量的直接参照，也是对照基线。**它的价值一半在反面**：模型卡自述零样本准确率 0.362，实测复现其动作头零样本下恒为 1、置信度恒高——「有判定头」不等于「有判定力」
- **[kev](https://github.com/jaredpalmer/kev)**（Apache-2.0；2026-09-20 首发）· Jared Palmer — Jev 接口的**架构型开源复刻**：Qwen3.5 基座 + rank-16 LoRA 适配器 + pointer head，单次前向读选项 logits 出概率、不生成文本；state 只编码一次，问句经 block-causal mask 隔离后打包进同一次前向。**利好**：全尺寸权重开源（0.8B / 4B / 9B）+ 训练代码 + 冻结评测集 + CI 齐备——是本仓「权重可下载的对照件须用本仓评测器同判据集自测」最直接可用的一件（9B 自报新来源准确率 0.852，与商业件的 0.857 只差半步，且 4B / 9B 的 bf16 权重能进 32 GB 单机）。**风险**：新来源上概率未校准（4B 档在 8.2% 的新来源题上给错答案 ≥0.9 概率），且**准确率收敛而校准未收敛**（9B 的 Brier 0.237 对商业件 0.211）；微调侵蚀基座（日期算术 0.72 对基座 0.82、MMLU 0.74 对商业件 0.90）；训练最长 384 state token 而服务允许 8192，长上下文未被训练覆盖。**边界**：复刻的是接口不是本体；其自述与商业件的对照**不受控**（对方训练数据未公开）——引用只可标注自报口径，不得当同口径数字
- **[Bespoke Nimble](https://github.com/bespokelabsai/nimble)**（Qwen3.5-9B 权重 + LoRA 适配器；仓库根无 LICENSE）· Bespoke Labs — 同期判定件，**只用 2,676 条对比式样本训 1 轮**即达参考标签一致率 90.12%（其闭源参照 93.21%）。**利好**：给出本仓数据集设计可直接借鉴的**对比式数据构造**——每对样本只翻转一个焦点事实、问句与无关证据固定不动，逼模型把「变化的事实」与「变化的判定」绑定，是「困难样本」的**主动生成法**而非被动采集。**风险**：仓库根无 LICENSE、全仓零 CI（测试写得再好，不进门禁就只是研究者自律）；schemas 必须扁平、无嵌套字段；评测仅是 324 例单一窄基准。**边界**：它证明的是「数据质量 > 参数量」——9B 也只到 90.12%，与商业件的差距不在架构而在判据数据（本节开头那条判断的实测依据）
- **Jev 接口复刻族（同期同题的四条岔路）** · Theodore Lee 等 — 作对照件候选与路线对照：**SemIf**（原 OpenJev，MIT；零训练 option-logit 基线——21 条二值判据 1.023 s / 零输出 token，对照生成 JSON 的 5.332 s / 111 token ＝ 5.21×）、**NanoJev**（训练链路最完整：Qwen3-0.6B + scalar head + Choice set-attention，带数据、训练、评测与 serving）、**Jevlike**（每选项查 context + 共享打分器，另有视觉选项打分例子）、**LocalJev**（把 typed questions 改写成提示让生成模型出 JSON——**不是 generation-free 复现**，只适合 API 兼容）。**边界**：这批仓库均在 Jev 发布后数日内出现，**Star 涨得快不等于技术已被验证**——纳入对照前须过准入鉴别（判据见 [v1.9.0 §五 对照纪律](./changelog/v1.9/v1.9.0.md)），任一判别缺即降为「接口参考」不作对照件。**仓名注（2026-09-24 取证）**：SemIf 与 OpenJev 双路径已合并为 `TheoLeeCJ/SemIf-OpenJev`（此后新增 temperature-calibration 贡献、EXL3 桥与 llamacpp CPU 后端）
- **[decider](https://github.com/Mapika/decider)**（Apache-2.0）· Mapika — Jev 模型类的**独立开源复现家族**（自述非 TypeSafe 背书）：Qwen3.5-2B/4B/35B-A3B 三档 + 0.8B 小档，单次前向出全问概率分布；`decider-2b` HF 下载 10 万+；**校准感知 RL 阶段已跑通**（2B v10 用 384 步校准感知 RL 把 belief 距精确律从 0.47 降到 0.22 nats；4b v2 硬档 ECE 0.288→0.071）；serving 端 wire 兼容 TypeSafe `/v1/systemone`。**利好**：是 [v1.8.0 §协议面观察](./changelog/v1.8/v1.8.0.md)已枚举端点中**校准工程最深的一件**——分桶温度、按 release 温度复算 ECE、v1/v2 权重分 Hub tag 保留，与 v1.7.0 校准章「统计量一致性 / 校准制品随行」同构可作活体正例。**风险**：全部读数为自报（两个第三方榜——JevBench / Decision Index——均「我们没跑、按其发布日期读取」）；回归集与 held-out 任务集口径自定。**边界**：引用一律写 PyPI 包名 `decider-ai`（裸名 `decider` 是 2026-06 上传的同名无关项目，勿混）
- **[CLM](https://github.com/Contrastive-LM/CLM)**（Apache-2.0）· Contrastive-LM（Jacky Kwok 团队）— **双塔对比式路线对照**（非 encoder+判定头同构）：state / action 双编码器 + InfoNCE 对比目标 + frozen Qwen3-8B + 约 75 MB 投影头；三阶段训练（60M Nemotron QA → 30M 合成难负例 → 1M agentic 轨迹）；`clm-serve` 兼容 `/v1/systemone` 并附低层 `/v1/rank`。**利好**：**公开 scaling-law 拟合**（test contrastive loss 对 compute / size / data，Notion 全文）——Stage 1 教师蒸馏的容量规划有现成拟合可读；动作侧 embedding 可缓存复用是结构性延迟杠杆。**风险**：8B 体量超本仓 0.3–0.5B 主推档；Linux+NV GPU 才能跑参考实现（无 CPU / Apple Silicon 路径）；全部读数自报（Terminal-Bench 2.1 87.6% / DeepSWE 81.6% 均 held-out 自报、未独立复现）。**边界**：双塔打分 ≠ 单塔读概率，准入五项中「question 真隔离」未验 ⇒ 只记**路线对照**，不入对照件池
- **[JevK5](https://github.com/allebee/jevk5)**（Apache-2.0）· allebee — TypeSafe Jev 的**独立开源替代**（自述不隶属 TypeSafe）：Qwen3.5-4B / 9B + 蒸馏 LoRA 合并权重（与 HF 同批开源），三原语齐备（`noul` / `choice` / `score`），`/v1/systemone` 兼容。**路线差异（决定其归类）**：readout 走 **SemIf 式「答案字母下一 token logit 的 softmax + 单温度」而非独立判定头**——概率确系直接 readout、无生成再解析（准入第 ④ 项过），但架构非 encoder + 判定头同构 ⇒ 只记**路线参考**、不入对照件池（[v1.9.0 §五](./changelog/v1.9/v1.9.0.md) 准入鉴别）。**利好**：其 v0.3 训练声明「只从**公开训练切分**做 replay」，是**数据集谱系声明**的正例（[v1.5.8 晋级证据门槛](./changelog/v1.5/v1.5.8.md) 同源纪律）；工程细节可借鉴——每个 padded 输入长度一张 CUDA graph，自报 H100 短判定 13 ms 对 eager ~70 ms。**风险**：公开横比**均来自第三方榜**（[jevbench](https://github.com/fstandhartinger/jevbench) 与 Jev Decision Index 两处，口径与版本各异 ⇒ 只并列不排名，**本仓未复算**）；自述英文单语（无中文路径）、单次 ≤16 选项、>16,384 token 直接拒收
- **[AutoJev-27B](https://github.com/denis-pplx/autojev)**（代码 MIT / 权重 Apache-2.0）· denis-pplx — **自述「由自主 agent 全程建成」的判定件**（研究、数据生成、训练、评估、部署全由 agent 执行，人只定目标与收窄范围——**对方自述、本仓未复算**；「首个 / 唯一」类序位主张本仓不采）⇒ 与 RSI 主线同题的**活体样本**（[v1.9.0 §五](./changelog/v1.9/v1.9.0.md) 单独登记）。判定面为 Qwen3.8-27B 全权重 SFT（73,000 样本 / 单卡 H200 / 286 步 / 交叉熵 + 独立标量温度校准），「每问一次前向出选项概率」+ `POST /v1/systemone` 兼容端点（`choice` / `noul` / `score` + 可选 base64 图像）。**利好**：其对照表**主动给出自家与 Jev 的 ECE / Brier 三列**（AutoJev 0.04282 / 0.22027，Jev 0.05274 / 0.25400）——证明「厂商旗舰件零披露」的空白是**主动披露**问题而非能力问题（[v1.7.0 ECE 硬线](./changelog/v1.7/v1.7.0.md) 据此限定主体）。**风险**：准入①不完整（自述「精确策展的训练语料**未随包发布**」）；27B 远超本仓 0.3–0.5B 主推档；HF 权重仓建仓于 2026-09-19T19:54Z（**同期最早的一件**），发布初期权重处私有态（现 HF 已公开，下载 329）——与 [JevK5](https://github.com/allebee/jevk5)（09-22T13:53Z）一道，使「NeoHorse-Jev 是首个全开放权重判定件」这一主张**不可成立**（[VALIDATION · 权重制品清单](./VALIDATION.md#system-one-决策模型判断与生成分离jev--2026-09)已按口径并列原值、不排名）。**边界**：只作路线与发布形态对照，不进对照表
- **[AgentJev](https://github.com/malevrigns/agent-jev)**（Apache-2.0；2026-09-21 建仓）· malevrigns — **「去 LM head」形态的正例**，与同批的反例成对使用（对照规则见 [v1.9.0 §五 对照纪律](./changelog/v1.9/v1.9.0.md)）。基座 Qwen3-0.6B **移除语言模型头**，每个候选在其末 token 读一次，再由一个**置换等变（permutation-equivariant）判定头**给整组选项打分——逐字「`model.safetensors` is the full module, backbone plus candidate head. It is **not a causal language model**, and `AutoModelForCausalLM` will not load it」。**判定面同构性**：非自回归（零 decode token）+ 概率直接 readout（每问一次 softmax）+ 公开权重（HF `aimeigaoshou/agent-jev`，Apache-2.0）+ 公开评测集（`LocalLLaMA/typed-decisions`）⇒ 准入面优于多数同期件。**路线差异（决定归类）**：底座是 **decoder-only（causal attention）去 LM head**，**不是 encoder + 判定头**——本仓在 encoder 侧，故只记**同族不同支**的路线对照，不入对照件池。**自曝边界（照录）**：「不同问句之间**尚不共享** state 缓存」（符合准入第③项方向）；候选共享前缀把宽候选负载 609.65 ms 降到 298.91 ms 而最大概率差 0.000508；上下文上限 2,048 token 且**超长直接拒收**（不静默截断）。**风险**：0.6B 略超本仓 0.3–0.5B 主推档；79.25% top-1 / 41.53 ms P50 等读数为**自报**、本仓未复算；训练数据未在 README 交代 ⇒ 准入第①项待验
- **[TensorFlow.js](https://github.com/tensorflow/tfjs)**（Apache-2.0）+ **[tfjs-models](https://github.com/tensorflow/tfjs-models)** · Google — **非判定件**，收录的是「后端抽象 + 分发形态」的十年工业先例（2026-09-26 研判）：① **一套 API、四种可切换后端**（WebGPU → WebGL → WASM → CPU，按硬件能力探测降级，`setBackend()` 一行切换、模型代码零改动，每后端独立 npm 包）——是 [v1.8.0 §三「实现路线不绑定」](./changelog/v1.8/v1.8.0.md)「契约由 DecisionChannel 保证、路线按硬件档启用」的**同构先例与成熟形态参照**（实现注册表 / 能力探测 / 优雅降级三件在该项目已跑十年）；② **模型即 npm 包 + CDN 托管权重**（tfjs-models 每模型独立 npm 包、unpkg 托管权重、版本独立管理）——对 MB 级判定头制品是 HF/ModelScope 之外的**第三条已验证分发通路**（v1.8.0 §五三层分发物的补充选项）；③ **「隐藏 tensor」API 哲学**（模型包只暴露领域语义接口、不暴露底层张量）——与「契约归约束层、实现由用户自带」同源，属被印证方不另记。**边界**：其模型族（mobilenet/toxicity 等）与判定底座无关，不收录、不入对照件池；训练侧（tfjs-layers）与「训练 Python、推理 Node」既定边界无关
- **[Verdict / rlcd-modernbert-151m](https://huggingface.co/heman10x/rlcd-modernbert-151m)**（Apache-2.0）· Heman10x-NGU — **「编码器 + 判定头」这一具体形态的最早可复算建仓时点：2026-09-17T16:25:31Z**（HF 模型仓 ObjectId 解析，独立实测），早于 autojev-27b（09-19T19:54Z）、JevK5（09-22T13:53Z）与 NeoHorse-Jev-4B（09-23T15:42Z）——**这是「序位类主张须给可复算时点」这条纪律的第一个跨形态实例**。形态：**ModernBERT 编码器 + GLiClass 判定头**（`pipeline_tag=text-classification`），151M 参数，HF 下载 19,449 / likes 32；其 GitHub 仓另含 Verdict 2.0（专用于类型化软件工作流）。**风险 / 边界**：全部读数为**自报**（77.10% acc / ECE 1.44% / ~20–25 ms）且含「beating TypeSafe Jev & Laya」这类**最值主张 ⇒ 按纪律标自称、本仓不采**；其 verdict2 权重自述「tracked via Git LFS pointers」而对应 HF 仓（`heman10x/openJev-verdict-2.0`）返回鉴权错＝**未取证**；151M 显著低于本仓 0.3–0.5B 主推档 ⇒ 只作**形态与建仓时点参照**，不入对照表
- **[jevbench](https://github.com/fstandhartinger/jevbench)**（MIT；Benchmark Heaven 自建）· fstandhartinger — 判定件品类的**独立第三方榜**（自述不隶属 TypeSafe、不受其背书），是本仓「公开横比只能来自非利益相关方」纪律的实物载体。**利好（口径设计可直接借鉴）**：四轴（概率校正后的 Intelligence / 校准 / 速度 / 成本）**等权调和平均**；**308 条「密封」题**与公开半集**分列报告**；公开与密封准确率差 **>25 个百分点即扣减**——其前言自陈「公开半集可被训练、也可被择优，故密封半集须随领域变化**持续演进**」（与 [v1.6.0 §五](./changelog/v1.6/v1.6.0.md)「集的两条纪律」及换代机制同源）。**风险 / 边界**：全部读数系**对方自建口径**，本仓**未复算**、不引其数字入对照表、不排名；名次随版本快速变动（同一对象在不同版本口径下名次可差数位）⇒ 引用必须带**榜的版本锚**，与 [v1.9.0 §五](./changelog/v1.9/v1.9.0.md)「对照数字须带对照系版本锚」同规
- **治理对照基准（2026-09-24 登记）** — 治理面「可被外部基准测」的两件套：① **[AgentGovBench](https://github.com/agentic-control-plane/agentgovbench)**（MIT）— 48 场景 / 8 类治理面（身份传播 / per-user 政策 / 委托溯源 / 作用域继承 / 限流级联 / 审计完整性 / fail-mode 纪律 / 跨租户隔离）映射 NIST AI RMF 1.0，7 runner；八类与本仓审计链 + ToolGate + 权限纪律结构同构。② **[ST-WebAgentBench](https://github.com/segev-shlomov/ST-WebAgentBench)**（Apache-2.0 · ICLR 2026）— 375 企业任务 × 3,057 政策实例 / 6 安全维度，**双正交轴（任务成功 × 政策合规）→ CuP（Completion under Policy）指标** + 三档难度消融。「政策合规与任务成功分开计量」与本仓「判定归判定、执行归执行」同向。两件均只作**外部对标口径**，本仓治理面不承诺跑分
- **官方标准面（2026-09-25 直取一手）** — 治理线此前只有经第三方基准间接引到的 NIST AI RMF 1.0（见上条 AgentGovBench），本批补齐 **NIST 自身的 agent 专门标准工作**：① **[AI Agent Standards Initiative](https://nist.gov/caisi/ai-agent-standards-initiative)**（CAISI，2026-02-17 启动）三支柱逐字——industry-led development of agent standards and U.S. leadership in international standards bodies / community-led open source protocol development and maintenance for agents / research in areas of AI agent security and identity；② **[RFI on AI Agent Security](https://nist.gov/news-events/news/2026/01/caisi-issues-request-information-about-securing-ai-agent-systems)**（docket **NIST-2025-0035**，2026-01 发布、03-09 截止）——范围**刻意收窄**：只覆盖能造成「persistent changes outside of the AI agent system itself」的 agent，**明确排除通用生成式 AI / 聊天机器人 / RAG**；关注面为间接提示注入、数据投毒、**specification gaming 与失准目标**，以及「constrain and monitor the extent of agent access in the deployment environment」；③ **NCCoE 概念文件**「Accelerating the Adoption of Software and AI Agent Identity and Authorization」（2026-02，意见期至 04-02）把 AI agent 定为**非人类身份**，给出**四功能域**——Identification（登记为非人类身份 + 工作负载证明）/ Authorisation（作用域按 agent × 工具 × 资源）/ **Delegation** / **Logging & transparency**（每次工具调用与资源动作须关联到 agent 身份**与委派它的那个人**）。另有 NIST AI 800-1《Practices for Automated Benchmark Evaluations of Language Models》草案（03-31 截止）可作评测口径参照；④ **AI 800-4《Challenges to the Monitoring of Deployed AI Systems》**（2026-03 发布；**两源口径不一致，逐源列值不取一**：nist.gov **出版页记 March 6, 2026**、同站新闻列表页记 **March 9, 2026**；DOI 10.6028/NIST.AI.800-4，本批一手直取）由 CAISI 汇总三场实务工作坊与一次文献综述，给出**已部署系统的六类监测**——Functionality（功能是否照常）/ Operational（基础设施服务是否保持一致）/ Human Factors（对人是否透明、输出是否高质量）/ Security（是否抗攻击与滥用）/ Compliance（是否合乎法律与政策）/ Large-Scale Impacts Monitoring（是否有广泛下游影响），并把挑战按「类别专属 / 跨类别」与「who / what / when / why / how」两组轴组织。**对本仓最重的一条**：原文把「监测与审计是什么关系」（What is the relationship between monitoring and auditing?）列为一等开放问题——本仓把审计外置到 git diff 正是这个问题的另一种答法，故这套分类可作本仓「部署后持续监测」面的**外部标准对位**；⑤ **AI 100-2e2025《Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations》**（**2025-03-24 发布**，一手确认，DOI 10.6028/NIST.AI.100-2e2025）——对抗性机器学习的四类攻击分类学（evasion / poisoning / privacy / abuse）与攻击者目标·能力·知识三维分类，是本仓「评测集谱系与防投毒」纪律的**标准侧术语出处**（[v1.5.8 §一](./changelog/v1.5/v1.5.8.md) 所引 arXiv:2609.17817 属该分类学的 poisoning 面实例）；⑥ **[Summary Analysis of Responses to the Request for Information Regarding Security Considerations for AI Agents](https://www.nist.gov/publications/summary-analysis-responses-request-information-regarding-security-considerations-ai)**（CAISI，**2026-05-18**；属 **NIST Trustworthy and Responsible AI 800-5**，报告号 **800-5**；作者 Riggs / Hamin / Perry / Edelman / Cihon；本批一手直取）——对上文第 ② 条所引 **NIST-2025-0035** RFI 的意见回复做汇总分析，把「产业界究竟怎么看 agent 安全」从**未被记录**变成**可查**；摘要给出两条共识方向：agent 带来**新型**安全威胁、且这些顾虑**本身构成采用障碍**；既有网络安全原则仍适用，但**须经改造**才能覆盖 agent 安全，评论者另指出政府可承担的角色（实施指南 / 促进信息共享 / 推动标准）。⚠️ **同页元数据另记 Updated 2026-04-28，早于署名发布日 ⇒ 两值并列不取一**
- **「主体两分」对位（NIST Delegation 域 vs 本仓身份命题 · 2026-09-25 辨析）** — 本仓对外表述是「AI 节点进组织架构、有独立账号、可被考核」（[VALIDATION · Org Graph](./VALIDATION.md) 与 [ARCHITECTURE · 轻量版 KYA](./ARCHITECTURE.md)）。NIST 的口径**不是另一件事，是同一件事的两层**，拆开读才不冲突：**身份层**（Identification / Authorisation）——agent 自己就是一个 principal（自有凭证、自有作用域、自有审计轨迹），此层与本仓**完全同向**（NIST 概念文件原话即 an independent principal with its own identity, task-bound rights and an audit trail；微软同期指引亦作 first-class principal）。**授权来源层**（Delegation）——NIST 明写两条本仓对外表述里**尚未显式化**的约束：① **双身份令牌**，令牌须同时携带「谁最终负责（human = subject）」与「谁在动作（agent = acting party）」，使委派链可回溯到责任人；② **委派权限通常应窄于被委派人类**（recommended control，非强制）。**本仓缺口判定**：不缺身份层，也不缺能力面——`AgentGovBench` 八类里本仓已登记的「**委托溯源**」与「**作用域继承**」正是这两条的对位维度，[VALIDATION](./VALIDATION.md) 亦已收编「权限随证据质量动态分配」（`arXiv:2606.29406`，与档位五态同题）；**缺的是把「委托溯源 / 作用域继承」从「对照基准的维度名」提升为本身份命题的一等表述，并把权限的「来源与上界」写进对外叙事**。对外只说「有独立账号」而不说「权限来自委派、且通常窄于委派者」，会把 agent 的权限读成**自生**的——这在治理叙事里是**被挑得出来的口径风险**。**处置**：不新增能力、不改设计；按「定性词单点持有」纪律，**该对位表述以本条为唯一持有处**，他处引用不复写
- **[Jev-Mem](https://arxiv.org/abs/2609.23986)**（arXiv:2609.23986，2026-09-21）· Dongming Jiang / Yi Li / Bingzhe Li — 用 **System One 控制面**替掉自回归 LLM 在 **agentic memory** 关键路径上的生成：三层分工（System-One 控制面 / 结构化多关系记忆面 / System-Two 推理面），System One 在**构建期**管记忆分型与关系组织，在**检索期**动态做查询路由、检索预算分配、图遍历、候选打分与**自适应停止**；System Two 只在复杂推理与答案合成时被调用。**对本仓最重的信号**：判定件的消费面此前是**判断 / 路由 / 闸门**三类，**「记忆控制」是第四类候选落点**——它给出可检验的命题：凡是「一次前向就能定的控制决策」，从生成模型手里搬进判定件都能同时省时省钱。**本仓处置**：**只登记来源与命题，不擅自扩版本面**——是否把「记忆控制」纳入判定件消费面属版本 scope，按「不做就移下一版」纪律留给人裁定。**边界（自报、本仓未复算）**：其评测集为既有公开长对话记忆基准，读数为自报；基座与判定件实现细节未公开
- **[jev-harness-lab](https://github.com/Aitejiu/jev-harness-lab)** · Aitejiu — 判定件在 **harness 内的可用面**的黑箱工程评测（自述跑遍多个公开数据集、数万次 API 调用）。**对本仓的价值在「能用 / 不能用」的边界划分，而非分数**：报告的同向结论包括——直接可用的面偏「窄判断」（注入检测、重排、意图分类、工具与技能路由、命令风险闸门），**不适用的面偏「跨步因果与对他人失败的预测」**（模型难度路由、轨迹失败归因均无信号）；并自陈**英文优先训练导致非英语显著掉分**、单次问句选项数有硬上限、state 与问句共享上下文预算、纯文本输入。**两条工程教训与本仓既有判据同向**：① 模糊语义判断上「**正交分解再交给代码组合**」优于单问句整体提问；② 多标签决策上「**先让 choice 竞争、再由 noul 验证**」优于一次问全（对应 [v1.6.0 §一 第 ④ 条硬判据「问句可分解性」](./changelog/v1.6/v1.6.0.md)）。🔴 **引用纪律**：该仓库**仓库根无 LICENSE**（实测 `license=null`，1★）⇒ 本仓**只作读数与方向参照，不作对照件、不引其数据入仓、不排名**，且**不抄其具体百分数**（与 [v1.9.0 §五「不利结论照录」](./changelog/v1.9/v1.9.0.md)对无许可横评的处置同规）
- **严格适当评分规则（strictly proper scoring rules）** · Gneiting & Raftery 等 — RLCD 数学正确性的真正依据：只有诚实报告校准概率才取到最大期望奖励。判定层奖励函数以该理论为准绳

### 认知与反馈

- **[A Field Guide to Fable](https://x.com/trq212/article/2073100352921215386)** · Thariq Shihipar — 四类未知框架；模型够强时瓶颈从「能不能做」变成「你能不能说清楚」
- **[When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement)** · Anthropic — 代码生成不再是瓶颈，人工审查成为新堵点；sofagent 把审查外置到 git diff
- **[SkillOpt](https://github.com/microsoft/SkillOpt)** · 微软 — Skill 自进化模块，为 v1.0.3 闭环提供参考（v1.4.8 起由自研 gate 验证器 `@sofagent/evolve` 替代，依赖已摘除）
- **[Satya Nadella at Microsoft Build](https://pod.wave.co/podcast/latent-space-the-ai-engineer-podcast/satya-nadella-no-priors-x-latent-space-crossover-special-at-microsoft-build)** · Satya Nadella —「Every company will have its own private eval」与 FDE 交付物对应

---

## 工具与实践

sofagent 直接使用或借鉴了它们的能力。

- **[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)** · Tencent Cloud — 4 层分层记忆，sofagent 以弱依赖方式集成（只读 Markdown 产物）
- **[Microsoft GraphRAG](https://github.com/microsoft/graphrag)** — knowledge/ 四层结构本质是轻量级 GraphRAG，验证用 .md 当图节点的方向
- **[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)** · Google — Markdown + YAML + Git 知识格式，独立验证 knowledge/ 方向
- **[Don't Do RAG](https://arxiv.org/abs/2412.15605)** · WWW '25 — CAG（编译式 RAG）验证「知识管理不需要向量数据库，干净 Markdown 就够了」
- **[agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)** — `ao compose` 一行命令搞定编排
- **[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)** — 215 个中文岗位模板，IDENTITY 层素材来源
- **[MiroFish](https://github.com/666ghj/MiroFish)** — 工具调用与答案分离，启发审计层证据分层
- **[superpowers](https://github.com/obra/superpowers)** — Skill 作为 Harness 杠杆
- **[best-of-agent-harnesses](https://github.com/RyanAlberts/best-of-agent-harnesses)** — 101+ Harness 项目索引
- **[agent-skills](https://github.com/addyosmani/agent-skills)** · Addy Osmani — 反合理化表设计，启发铁律反合理化表
- **[gstack](https://github.com/garrytan/gstack)** · Garry Tan — 六层安全栈 + 原子文件写入 + 角色分解架构
- **[Multica](https://github.com/multica-ai/multica)** —「自己不调 LLM，全推给子进程」与 sofagent 平台无关策略一致
- **[GBrain](https://github.com/garrytan/gbrain)** · Gary Tan — Karpathy LLM Wiki 的工业级落地，架构与 knowledge/ 同构
- **[skills](https://github.com/mattpocock/skills)** · Matt Pocock — 深模块设计受控词汇表（module / interface / depth / seam / leverage / locality + 删除测试）与设计熵勘测技能 `improve-codebase-architecture`（MIT）。项目内的深模块审查沿用它定义的受控词汇表，方法论本体不做转写

---

## 社区

- **[ClawHub](https://clawhub.ai)** — 全球 Skills 社区
- **[/goal 命令](https://docs.anthropic.com/en/docs/claude-code/goal)** · Claude Code — 自主执行循环，启发用户确认设计
- **[OpenFDE](https://open-fde.com)** — FDE 开源社区

---

## 关于作者

我叫孔放勋，一个只懂点前端代码的产品经理。

2026 年初开始用 OpenClaw，攒了些笔记，整理成了这份 Handbook。

为什么叫 sofagent？sofa + agent，合起来「沙发特工」——希望有一天能躺在沙发上，Agent 就把活干完了。

这个项目里的文件是模型间 Loop 实验的产物（见上方[生成伙伴](#生成伙伴)）。分享出来期待你也参与进来一起优化。

如果你也在折腾 OpenClaw，希望这个对你有用。
