# 致谢

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> sofagent 站在巨人肩膀上。以下每一个项目、文章和作者，都在某个设计决策里留下了痕迹。

> v1.5.1 · 2026-09-22（UTC）· ✅ 已发版 · 孔放勋

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

### 实验与证据

- **[Don't Train the Model, Evolve the Harness](https://github.com/JoelNiklaus/harness-optimization)** · Joel Niklaus — 不改权重、仅优化 Harness，让 DeepSeek-v4-pro 从 63.4% 升至 80.1%（+16.7pp），实验数据见研究代码仓库。sofagent 存在理由的外部证据
- **[AutoResearch](https://github.com/karpathy/autoresearch)** · Andrej Karpathy — 约束文档 + 锁定评估脚本 + 自动循环，与 sofagent 的 fde.md + audit + loop 高度对应
- **[Bilevel Autoresearch](https://arxiv.org/abs/2603.23420)** — 双层循环论文，外层强制探索回避方向可实现 5 倍性能提升
- **[MetaRSI / RSI²: A Meta-Recursive Self-Improving System for Recursive Self-Improving Systems Themselves](https://arxiv.org/abs/2609.06396)**（arXiv:2609.06396，2026-09-06）+ **[RSI-Harness](https://github.com/CosmosMind-ai/RSI-Harness)**（其开源实现）· CosmosMind — 递归自我改进（RSI）的统一形式化：Data / Harness / Model 三算子共享一个闭环内核，其上再加改进调度器。sofagent 的 Meta-RSI 三算子对位、「**保护面必须独立于所有可写面**」这条架构判断、以及「验证差距是自进化的适用边界」都源自此处；v1.5.8 的 RSI 缺口对位（经验池接训练管道 / 进化准入判据 / 三层晋级 / 出题考核）即照它补差
- **[DeepSeek Elastic Compute (DSec)](https://arxiv.org/abs/2609.22978)**（arXiv:2609.22978，2026-09-19）· DeepSeek — 面向大规模 Agentic 训练的生产级沙盒基础设施：统一 SDK 暴露 FnCall / container / microVM / full-VM 四种后端，可独立版本化的分层镜像、按需加载、内存共享回收与 CPU 调度同 RL 框架协同设计。第 6 节「Build environments of Agents, by Agents, for Agents」给出部分闭环的 RSI 路径——Agent 自造执行环境、增量快照沉淀为下一批训练场。**对本仓最重的一条论断：自我改进卡住的从来不是 GPU，是环境供给。** 它与上一条 MetaRSI 互为上下句：三算子回答「改什么」，环境供给回答「在哪儿改、改得可不可信」——环境供给是 Data-RSI 的上游瓶颈，也是本仓「训练信号不可被环境伪造」这条默认前提的实证出处
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
- **[OpenWorker](https://github.com/andrewyng/openworker)** · Andrew Ng 团队 — 开源桌面 AI 代理（7.3k stars, MIT）。四级权限模型（plan/interactive/auto/custom）和无人值守收件箱设计，为 FDE sustain 模式的 daemon 审批机制提供参考。"Ask for an outcome, not just an answer"的产品叙事与 sofagent「交付文档而非建议」同源
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
- **[decider](https://github.com/Mapika/decider)**（Apache-2.0）· Mapika — Jev 模型类的**独立开源复现家族**（自述非 TypeSafe 背书）：Qwen3.5-2B/4B/35B-A3B 三档 + 0.8B 小档，单次前向出全问概率分布；`decider-2b` HF 下载 10 万+；**校准感知 RL 阶段已跑通**（2B v10 用 384 步校准感知 RL 把 belief 距精确律从 0.47 降到 0.22 nats；4b v2 硬档 ECE 0.288→0.071）；serving 端 wire 兼容 TypeSafe `/v1/systemone`。**利好**：是 [v1.8.0 §协议面观察](./changelog/v1.8/v1.8.0.md)三家里**校准工程最深的一件**——分桶温度、按 release 温度复算 ECE、v1/v2 权重分 Hub tag 保留，与 v1.7.0 校准章「统计量一致性 / 校准制品随行」同构可作活体正例。**风险**：全部读数为自报（两个第三方榜——JevBench / Decision Index——均「我们没跑、按其发布日期读取」）；回归集与 held-out 任务集口径自定。**边界**：引用一律写 PyPI 包名 `decider-ai`（裸名 `decider` 是 2026-06 上传的同名无关项目，勿混）
- **[CLM](https://github.com/Contrastive-LM/CLM)**（Apache-2.0）· Contrastive-LM（Jacky Kwok 团队）— **双塔对比式路线对照**（非 encoder+判定头同构）：state / action 双编码器 + InfoNCE 对比目标 + frozen Qwen3-8B + 约 75 MB 投影头；三阶段训练（60M Nemotron QA → 30M 合成难负例 → 1M agentic 轨迹）；`clm-serve` 兼容 `/v1/systemone` 并附低层 `/v1/rank`。**利好**：**公开 scaling-law 拟合**（test contrastive loss 对 compute / size / data，Notion 全文）——Stage 1 教师蒸馏的容量规划有现成拟合可读；动作侧 embedding 可缓存复用是结构性延迟杠杆。**风险**：8B 体量超本仓 0.3–0.5B 主推档；Linux+NV GPU 才能跑参考实现（无 CPU / Apple Silicon 路径）；全部读数自报（Terminal-Bench 2.1 87.6% / DeepSWE 81.6% 均 held-out 自报、未独立复现）。**边界**：双塔打分 ≠ 单塔读概率，准入五项中「question 真隔离」未验 ⇒ 只记**路线对照**，不入对照件池
- **治理对照基准（2026-09-24 登记）** — 治理面「可被外部基准测」的两件套：① **[AgentGovBench](https://github.com/agentic-control-plane/agentgovbench)**（MIT）— 48 场景 / 8 类治理面（身份传播 / per-user 政策 / 委托溯源 / 作用域继承 / 限流级联 / 审计完整性 / fail-mode 纪律 / 跨租户隔离）映射 NIST AI RMF 1.0，7 runner；八类与本仓审计链 + ToolGate + 权限纪律结构同构。② **[ST-WebAgentBench](https://github.com/segev-shlomov/ST-WebAgentBench)**（Apache-2.0 · ICLR 2026）— 375 企业任务 × 3,057 政策实例 / 6 安全维度，**双正交轴（任务成功 × 政策合规）→ CuP（Completion under Policy）指标** + 三档难度消融。「政策合规与任务成功分开计量」与本仓「判定归判定、执行归执行」同向。两件均只作**外部对标口径**，本仓治理面不承诺跑分
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
