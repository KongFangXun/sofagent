# 致谢

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> sofagent 站在巨人肩膀上。以下每个项目与作者，都在某个设计决策里留下痕迹。

> v1.5.5 · 2026-10-01（UTC）· ✅ 已发版 · 孔放勋
>
> 收录纪律：一条一行——名字 · 链接 · 启发（≤25 字）；全文分析见 [`archive/validation-deep/thanks-extended.md`](./archive/validation-deep/thanks-extended.md)。

## 目录

- [基石](#基石) · [生成伙伴](#生成伙伴) · [思想之源](#思想之源) · [工具与实践](#工具与实践) · [社区](#社区) · [关于作者](#关于作者)

## 基石

- **[OpenClaw](https://github.com/openclaw/openclaw)** · Peter Steinberger — 四层加载链 Hook 机制之源

## 生成伙伴

模型间 Loop 实验——多 session 内互改互审直到全通过，随后新 session 重审、下一轮迭代。

- **[DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/)** · 深度求索
- **[GLM-5.2](https://z.ai/)** · 智谱 AI


## 思想之源

影响了 sofagent「为什么这么设计」的理论与实践。分析段全文见[归档](./archive/validation-deep/thanks-extended.md)。

### 哲学基因

- **[Ralph Loop](https://ghuntley.com/loop/)** · Geoffrey Huntley —「Agent 会失忆，文件不会」：git diff 是地面真相
- **[Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills)** — 4 条编码原则是 9 则铁律的根基
- **[Anthropic Skills](https://github.com/anthropics/skills)** — 官方 SKILL.md 规范，描述-实现分离参考

### Loop → Harness → Graph

- **[Loop Engineering](https://addyo.substack.com/p/loop-engineering)** · Addy Osmani — 正式命名 Context→Harness→Loop 三层框架
- **[From Loop to Graph Engineering](https://engineering.zooz.com/intuitionmachine/from-loop-engineering-to-graph-engineering-d3ebeb08511c)** · Carlos E. Perez — 无 Anchor 的 Graph 只是更贵的 Loop
- **[OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)** — Harness 概念的系统化参考
- **[Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)** · Anthropic — 长时 Agent 的有效治理
- **[What makes a harness a harness](https://arxiv.org/abs/2606.10106)** · Sanderson Oliveira de Macedo — agent harness 的构成性定义与包含/排除检验

### 实验与证据

- **[Don't Train the Model, Evolve the Harness](https://github.com/JoelNiklaus/harness-optimization)** · Joel Niklaus — 不改权重仅优化 Harness：63.4%→80.1%
- **[AutoResearch](https://github.com/karpathy/autoresearch)** · Andrej Karpathy — 约束文档+锁定评估+自动循环
- **[Bilevel Autoresearch](https://arxiv.org/abs/2603.23420)** — 双层循环，外层强制探索 5 倍提升
- **[MetaRSI / RSI²](https://arxiv.org/abs/2609.06396)** + [RSI-Harness](https://github.com/CosmosMind-ai/RSI-Harness) · CosmosMind — RSI 三算子统一形式化
- **[SoL-Pi](https://arxiv.org/abs/2609.20519)** — RSI 施于 harness 层的活体样本
- **[DeepSeek Elastic Compute (DSec)](https://arxiv.org/abs/2609.22978)** · DeepSeek — 「自我改进卡住的从来不是 GPU，是环境供给」
- **[Grow the Harness, Not the Context](https://arxiv.org/abs/2609.26760)** — 控制决策从上下文搬进可复用代码
- **[Harness-Zero](https://arxiv.org/abs/2609.24974)** — harness 蒸馏：微调摊销层的外部实证
- **[HackProbe](https://arxiv.org/abs/2609.04665)** — RSI 监控器与 harness 无关：监控方在被测系统之外
- **[RSI Claim-Testing Checklist](https://github.com/sunghunkwag/recursive-self-improvement)** · Intelligence Research Project — RSI 主张检验清单：改进必须递归
- **[Calibrated Decision Models for Pentesting](https://arxiv.org/abs/2609.28940)** — 判定件在安全域的裁定落点
- **[JEVQA](https://arxiv.org/abs/2609.24395)** — 判定件跨域零样本替代实证（音视频域）
- **[Lost in the Middle](https://arxiv.org/abs/2307.03172)** — 长文档中段注意力衰减，500 字原则源头
- **[A Global Workspace in Language Models](https://www.anthropic.com/research/global-workspace)** · Anthropic — 「审计必须外置」的底层论证
- **[Claude 5 上下文工程](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)** · Anthropic — 上下文工程取代提示词工程

### 编排与架构

- **[Managed Agents](https://www.anthropic.com/engineering/managed-agents)** · Anthropic — 四层编排：连接+行动与深度思考分工
- **[Deep Agents](https://github.com/langchain-ai/deepagentsjs)** · LangChain — 验证 v1.x 技术选型（已迁 LangGraph）
- **[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)** · DeepSeek — 一切皆插件运行时；cordis-plugin 协议基础
- **[Cordis](https://github.com/cordiverse/cordis)** + [时空可组合性论文](https://github.com/cordiverse/paper) · cordiverse — 时间+空间可组合性，进化模块运行时视角
- **[Claude Code Agent Loop](https://docs.anthropic.com/en/docs/claude-code/how-claude-code-works)** · Anthropic — 三阶段循环+三档权限，与 HITL 🟢🟡🔴 同构
- **[Palantir AIP Ontology](https://www.palantir.com/platforms/aip/)** · Palantir — 数据+逻辑+动作+安全四合一数字孪生层
- **The Path to Recursively Self-Improving Harnesses** · 翁荔（Lilian Weng）— 六层 Harness 优化框架
- **[The Anatomy of an Agent Harness](https://x.com/i/article/2040732084843782144)** · Akshay Pachaar — Harness 即 LLM 的操作系统，12 核心组件
- **[Three Key Loops](https://www.deeplearning.ai/the-batch/three-key-loops-for-building-great-software)** · Andrew Ng — 分钟→小时→天三层嵌套循环
- **[OpenWorker](https://github.com/andrewyng/openworker)** · Andrew Ng 团队 — 四级权限模型；「Ask for an outcome, not just an answer」
- **[aisuite](https://github.com/andrewyng/aisuite)** · Andrew Ng 团队 — `<provider>:<model>` 统一接口
- **[DeerFlow](https://github.com/bytedance/deer-flow)** · 字节跳动 — "super agent harness" 命名印证品类
- **[Omnigent](https://github.com/omnigent-ai/omnigent)** · Databricks 系 — meta-harness：策略强制在基础设施层
- **[LiteLLM](https://github.com/BerriAI/litellm)** · BerriAI — 开源 LLM gateway
- **[bubblewrap](https://github.com/containers/bubblewrap)** · containers — OS 级沙箱原语
- **[LangChain middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/custom)** · LangChain — wrapToolCall：运行时审计精确接入点
- **[EnkryptAI Secure MCP Gateway](https://mintlify.wiki/enkryptai/secure-mcp-gateway)** · EnkryptAI — 安全护栏 + audit_only 模式
- **[Agent Client Protocol (ACP)](https://github.com/Agent-Client-Protocol/spec)** — LSP 式开放协议
- **[DataFlow](https://github.com/OpenDCAI/DataFlow)** · 北京大学 DCAI — 独立用「Harness」命名的第三方佐证
- **[ChatDemo](https://github.com/OpenFDEAI/ChatDemo)** · OpenFDEAI — FDE 术语同源
- **[PenguinHarness](https://github.com/Prism-Shadow/penguin-harness)** · Yaowei Zheng — Benchmark 与工具审批四模式参考
- **[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)** · Prime Intellect — 跨进程写保护与 RefinementEvent 证据记录
- **[Control the Harness, Control the Cost](https://arxiv.org/abs/2609.28919)** — 未调优 harness 默认值 = 成本与治理一并交出去
- **[Self-Healing Harness](https://arxiv.org/abs/2609.24130)** — 准入门控：提议在内、门在外、持久化由门决定
- **[RegenHarness](https://arxiv.org/abs/2609.27612)** — evidence-gated RSI；改进无权降低门强度

### 判定与校准

决策模型来源。判定层门槛不在模型架构，**在判据数据集**——判定件深读（对照件池谱系）见[归档](./archive/validation-deep/judgment-ecosystem.md)。

- **[SalesRLAgent](https://arxiv.org/abs/2503.23303)** · Nandakishor M — 概率预测当序列决策训练，「只出概率不生成」之源
- **[Confidence-Aware Routing](https://arxiv.org/abs/2510.01237)** · Nandakishor M — 统一置信度驱动四路径路由，与 L0/L1/L2+第三态同构
- **[DeepRAG](https://arxiv.org/abs/2503.08213)** · Nandakishor M — 从零自建 embedding 模型参考
- **[System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)** · TypeSafe AI — RLCD、三原语提出方；「校准优先于偏好」
- **[laya](https://huggingface.co/convaiinnovations/laya)** · Convai Innovations — 非自回归判定件参照+对照基线；@2026-09-30 v0.3.22
- **[kev](https://github.com/jaredpalmer/kev)** · Jared Palmer — Jev 架构型开源复刻（0.8B/4B/9B 全尺寸）
- **[Bespoke Nimble](https://github.com/bespokelabsai/nimble)** · Bespoke Labs — 2,676 条对比式样本构造法（「数据质量 > 参数量」）
- **Jev 接口复刻族**（SemIf / NanoJev / Jevlike / LocalJev / JEV-mini）— 对照件候选与路线对照
- **[decider](https://github.com/Mapika/decider)** · Mapika — 校准工程最深的复现家族（ECE 0.288→0.071）；@2026-09-30 1.8.1
- **[CLM](https://github.com/Contrastive-LM/CLM)** · Contrastive-LM — 双塔对比式路线对照（公开 scaling-law 拟合）
- **[JevK5](https://github.com/allebee/jevk5)** · allebee — 独立开源替代；蒸馏 LoRA 合并权重同批开源
- **[OpenThai-SystemOne](https://github.com/iapp-technology/openthai-systemone)** · iApp — 泰/英双语 0.8B，契约兼容成本品类默认
- **[AutoJev-27B](https://github.com/denis-pplx/autojev)** · denis-pplx —「自主 agent 全程建成」活体样本；披露 ECE 三列
- **[RSI-Jev](https://github.com/Shanghua-Gao/RSI-Jev)** · Shanghua Gao — RSI 循环直接造判定件；v4.0-VL 读图（自报）
- **[AgentJev](https://github.com/malevrigns/agent-jev)** · malevrigns —「去 LM head」形态正例（置换等变判定头）
- **[TensorFlow.js](https://github.com/tensorflow/tfjs)** + [tfjs-models](https://github.com/tensorflow/tfjs-models) · Google — 一套 API 四后端+模型即 npm 包的十年先例
- **[Verdict / rlcd-modernbert-151m](https://huggingface.co/heman10x/rlcd-modernbert-151m)** · Heman10x-NGU —「编码器+判定头」最早可复算建仓时点（2026-09-17）
- **[jevbench](https://github.com/fstandhartinger/jevbench)** · fstandhartinger — 判定件独立第三方榜；@2026-09-29 榜首 Imajev-4B
- **[AgentGovBench](https://github.com/agentic-control-plane/agentgovbench)** + **[ST-WebAgentBench](https://github.com/segev-shlomov/ST-WebAgentBench)** — 治理对照基准两件套（CuP 双轴指标）
- **[NIST 官方标准面](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative)**（CAISSI 三支柱 + RFI + NCCoE 四功能域 + AI 800 系列）— agent = 非人类身份 principal；双身份令牌
- **[Jev-Mem](https://arxiv.org/abs/2609.23986)** — System One 控制面管 agentic memory
- **[jev-harness-lab](https://github.com/Aitejiu/jev-harness-lab)** · Aitejiu — 判定件 harness 内可用面黑箱评测
- **[JevAdvBench](https://arxiv.org/abs/2609.31142)** — 判定件对抗基准（被攻击决策对干净决策打分）
- **[LAVOIR](https://arxiv.org/abs/2609.30706)** — 判定件「该问什么」扩展（VOI 槽位；已开源）
- **严格适当评分规则** · Gneiting & Raftery 等 — RLCD 数学正确性依据：诚实报告校准概率才取最大期望奖励
- **[Sys1Cal-v1](https://arxiv.org/abs/2609.35342)** — 判定件概率**数值含义**专用数据集（全变差距离评分）
- **[PACT](https://arxiv.org/abs/2609.35865)** — 单 token 判定的**校准感知训练**：四项免新标注训练项
- **[Your-LM-Is-Already-a-Decision-Model](https://github.com/ntlm1686/Your-language-model-is-already-a-decision-model)** · ntlm1686 — **训练必要性对照**：未微调 9B 与 Jev 互有胜负（自测）

### 认知与反馈

- **[A Field Guide to Fable](https://x.com/trq212/article/2073100352921215386)** · Thariq Shihipar — 四类未知框架；瓶颈从「能不能做」变「你能不能说清楚」
- **[When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement)** · Anthropic — 代码生成不再是瓶颈，人工审查成新堵点
- **[SkillOpt](https://github.com/microsoft/SkillOpt)** · 微软 — Skill 自进化参考（现由自研 gate 验证器替代）
- **[Satya Nadella at Microsoft Build](https://pod.wave.co/podcast/latent-space-the-ai-engineer-podcast/satya-nadella-no-priors-x-latent-space-crossover-special-at-microsoft-build)** · Satya Nadella —「Every company will have its own private eval」


## 工具与实践

sofagent 直接使用或借鉴了它们的能力。

- **[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)** · Tencent Cloud — 4 层分层记忆（弱依赖只读集成）
- **[Microsoft GraphRAG](https://github.com/microsoft/graphrag)** — knowledge/ 四层结构 = 轻量 GraphRAG
- **[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)** · Google — Markdown+YAML+Git 知识格式
- **[Don't Do RAG](https://arxiv.org/abs/2412.15605)** · WWW '25 — CAG 验证「干净 Markdown 就够了」
- **[agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)** — `ao compose` 一行编排
- **[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)** — 215 个中文岗位模板
- **[MiroFish](https://github.com/666ghj/MiroFish)** — 工具调用与答案分离，启发证据分层
- **[superpowers](https://github.com/obra/superpowers)** — Skill 作为 Harness 杠杆
- **[best-of-agent-harnesses](https://github.com/RyanAlberts/best-of-agent-harnesses)** — 101+ Harness 项目索引
- **[agent-skills](https://github.com/addyosmani/agent-skills)** · Addy Osmani — 反合理化表设计
- **[gstack](https://github.com/garrytan/gstack)** · Garry Tan — 六层安全栈+原子写入+角色分解
- **[Multica](https://github.com/multica-ai/multica)** —「自己不调 LLM 全推子进程」
- **[GBrain](https://github.com/garrytan/gbrain)** · Gary Tan — LLM Wiki 工业级落地，与 knowledge/ 同构
- **[skills](https://github.com/mattpocock/skills)** · Matt Pocock — 深模块受控词汇表与设计熵勘测


## 社区

- **[ClawHub](https://clawhub.ai)** — 全球 Skills 社区
- **[/goal 命令](https://docs.anthropic.com/en/docs/claude-code/goal)** · Claude Code — 自主执行循环，启发用户确认设计
- **[OpenFDE](https://open-fde.com)** — FDE 开源社区


## 关于作者

我叫孔放勋，一个只懂点前端代码的产品经理。2026 年初开始用 OpenClaw，攒了些笔记，整理成了这份 Handbook。为什么叫 sofagent？sofa + agent，合起来「沙发特工」——希望有一天能躺在沙发上，Agent 就把活干完了。这个项目里的文件是模型间 Loop 实验的产物（见上方[生成伙伴](#生成伙伴)），分享出来期待你也参与进来一起优化。
