# 致谢

> sofagent 站在巨人肩膀上。以下每一个项目、文章和作者，都在 sofagent 的某个设计决策里留下了痕迹。
>
> v1.1.6 · 2026-07-13（UTC）· 孔放勋

<img src="assets/sofagent.png" alt="sofagent" width="160" />

- [基石](#基石)
- [生成伙伴](#生成伙伴)
- [关于作者](#关于作者)
- [哲学与理念](#哲学与理念)
- [工具与实现](#工具与实现)
- [社区与平台](#社区与平台)
- [外部研究与参考](#外部研究与参考)

---

## 基石

没有它，sofagent 一页都写不出来。

- **[OpenClaw](https://github.com/openclaw/openclaw)** by Peter Steinberger — 整个 sofagent 的基石。从上下文加载到 Hook 触发、从 Skill 注入到 Session 管理，整套体系都建立在 OpenClaw 的能力之上

---

## 生成伙伴

模型间 Loop 实验——多 session 内互改互审，直到所有模型都版本通过。随后新 session 重审，下一轮版本迭代开始。

- **[DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/)**（深度求索）
- **[GLM-5.2](https://z.ai/)**（智谱 AI）

---

## 关于作者

我叫孔放勋，一个只懂点前端代码的产品经理。

2026 年初我才开始用 OpenClaw，用了一段时间后攒了些想法，整理成了这份 Handbook。

为什么叫 sofagent？没什么深意——sofa + agent，合起来就是「沙发特工」。想表达的意思也简单：希望有一天能躺在沙发上，Agent 就把活干完了。

这不是什么「框架」或「方法论」，只是用大半年 OpenClaw 攒的笔记。

这个项目里的文件是模型间 Loop 实验的产物——多 session 内互改互审，直到所有模型都版本通过。参与的核心模型是 DeepSeek V4 Pro 和 GLM-5.2，详见 [致谢](#生成伙伴)。分享出来期待你也参与进来一起优化。

如果你也在折腾 OpenClaw，希望这个对你有用。

---

## 哲学与理念

影响了 sofagent "为什么这么设计" 的思考。

- **[Ralph Loop](https://ghuntley.com/loop/)** by Geoffrey Huntley —「Agent 失忆，文件不失忆」是 sofagent 的哲学基因。一行 bash 循环 + Stop Hook + 新鲜上下文每轮刷新，启发了审计方向：git diff 是无状态地面真相
- **[Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills)** — 4 条编码原则是 7 则铁律的根基。感谢 Karpathy
- **[Anthropic Skills](https://github.com/anthropics/skills)** — 官方 SKILL.md 格式规范，描述-实现分离和 Skill 索引卡片参考了它
- **[Loop Engineering](https://addyo.substack.com/p/loop-engineering)** by Addy Osmani — 1962 年 Peter Steinberger 的「prompts are out, loops are in」引爆 650 万次浏览，Osmani 正式命名。帮我理清了 Context → Harness → Loop 三层框架的关系。详见 §外部研究与参考
- **[OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)** — Harness 概念的系统化参考
- **[Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)** — 长时间运行 Agent 的有效治理思路
- **[Lost in the Middle](https://arxiv.org/abs/2307.03172)** — 模型对长文档中段注意力衰减的研究，500 字原则的理论源头
- **[Andrew Ng — Three Key Loops for Building Great Software](https://www.deeplearning.ai/the-batch/three-key-loops-for-building-great-software)** · DeepLearning.AI The Batch（2026-06-30）
  三层嵌套循环：Agentic Coding（分钟级）→ Developer Feedback（小时级）→ External Feedback（天-周级）。Ng 强调开发者留在中层循环的理由不是"品味（taste）"而是"上下文优势（context advantage）"——人脑中存储的用户画像、业务边界、竞品动态是 AI 短期无法获取的。sofagent 目前覆盖内层，中层 v1.0.1+，外层 v2.x。
- **[Thariq Shihipar — A Field Guide to Fable: Finding Your Unknowns](https://x.com/trq212/article/2073100352921215386)** · Anthropic Claude Code 团队（2026-07）
  四类未知框架（Known Knowns / Known Unknowns / Unknown Knowns / Unknown Unknowns）：用户给 Agent 下任务时的信息差。task-aware 两轮澄清覆盖前两类（显性需求 + 意识到的模糊），后两类（隐性默认 + 盲点）是扩展方向。核心洞察——模型够强时，瓶颈从"模型能不能做"变成"你能不能说清楚要什么"。

---

## 工具与实现

sofagent 直接使用或借鉴了它们的能力。

- **[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)** · Tencent Cloud (2026-06) · MIT — OpenClaw 原生记忆插件，零配置、开箱即用。4 层分层记忆（L0 对话→L1 事实→L2 场景→L3 画像）+ 双轨存储（SQLite+sqlite-vec 存事实、Markdown 存结构）+ 符号化压缩（Mermaid 图替冗长日志，Token 降 61%）。sofagent 以**弱依赖方式**集成——只读 persona.md 和 scene_blocks/ 的 Markdown 产物，不碰 SQLite、不调 HTTP API。TencentDB 卸了 sofagent 照样跑，只是少了用户画像来源
- **[Microsoft GraphRAG](https://github.com/microsoft/graphrag)** — knowledge/ 的 entities→relations→concepts→comparisons 四层结构本质是轻量级 GraphRAG。GraphRAG 四类必须场景（多维关联 / 全局总结 / 隐性关系 / 分散串联）验证了 sofagent 用 .md 文件当图节点、Agent 遍历替代图数据库查询的方向。混合路由最佳实践：简单事实用 grep，关联查询走遍历
- **[agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)**（Apache-2.0）— `ao compose` 一行命令搞定编排：意图识别 → 任务图生成 → 模板匹配 → 分配
- **[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)** — 215 个中文岗位模板，IDENTITY 层素材来源
- **[MiroFish](https://github.com/666ghj/MiroFish)** —「工具调用与最终答案严格分离」模式，启发了 sofagent 审计层的证据分层设计
- **[superpowers](https://github.com/obra/superpowers)** — Skill 作为 Harness 杠杆的思路，启发了 Skills 体系的设计
- **[best-of-agent-harnesses](https://github.com/RyanAlberts/best-of-agent-harnesses)** — 101+ 个 Harness 项目索引，让我了解这个领域已经有什么人在做什么事
- **[agent-skills](https://github.com/addyosmani/agent-skills)** by Addy Osmani — 24 个生产级工程 Skill，反合理化表（Anti-rationalization）设计——预判 Agent 跳过步骤的借口并逐一驳回——启发了 sofagent fde.md 的铁律反合理化表
- **[gstack](https://github.com/garrytan/gstack)** by Garry Tan (YC CEO) — 28 个 Skill + 7 个 Agent 角色的 AI 辅助软件开发系统。六层安全栈（分类器级 prompt injection 检测 / 密钥格式持续更新 / fail-closed 默认不信任）、原子文件写入模式、角色分解架构——为 sofagent 的 A2 密钥格式更新和多角色 agents/ 架构提供了实践参照
- **[Multica](https://github.com/multica-ai/multica)**（Source Available，4000+ commits）— 开源 Agent 团队协作平台，支持 14 种 Agent CLI。「自己不调 LLM，全推给下游子进程」的架构哲学与 sofagent 平台无关策略一致。Polymorphic Actor 模型和会话恢复机制为 v1.2.x 提供工程参考。详见 [ROADMAP v1.2.x](../ROADMAP.md#v12x--完整多设备协同规划中)

---

## 社区与平台

从这些社区汲取知识，不断打磨和进化 sofagent。

- **[ClawHub](https://clawhub.ai)** — 全球 Skills 社区，Skills 体系的外部来源
- **[/goal 命令](https://docs.anthropic.com/en/docs/claude-code/goal)** — Claude Code 的自主执行循环，启发了我加用户确认的设计
- **[OpenFDE](https://open-fde.com)**（2026-07）— FDE 开源社区，行业的系统化知识框架

---

## 外部研究与参考

以下工作为 sofagent 的架构设计提供了关键理论支撑和外部验证：

- **[Hugging Face — Don't Train the Model, Evolve the Harness](https://huggingface.co/spaces/joelniklaus/harness-optimization)** · Joel Niklaus (2026)
  实验证明：不改模型权重、仅优化外层 Harness，让 DeepSeek-v4-pro 在法律 Agent 基准中从 3.5% 提升至 80.1%，追平 Claude Sonnet 4.6，成本仅 1/7。这是 sofagent 存在理由的关键外部证据。

- **[Karpathy AutoResearch](https://github.com/karpathy/autoresearch)** · Andrej Karpathy (2026) · 9 万 GitHub Star
  630 行 Python 脚本让 AI Agent 在单 GPU 上跑 700 次自动实验，找出 20 项连 Karpathy 本人都忽略的代码改进。其 Loop Engineering 方法——约束文档 + 锁定评估脚本 + 自动循环——与 sofagent 的 fde.md + sofagent-audit + loop-check 高度对应。

- **[Bilevel Autoresearch](https://arxiv.org/abs/2603.23420)** · 双层循环论文
  在 AutoResearch 基础上进一步验证了双层循环（外层优化搜索逻辑、强制探索回避方向）可实现 5 倍性能提升。

- **[Codila — AutoResearch 五步方法论](https://x.com/0xCodila/status/2072329149520232639)**
  将 AutoResearch 浓缩为五步方法论——自动验证器 + 状态文件 + 停止条件。与 sofagent 的 fde.md + sofagent-audit + loop-exit 高度对应。

- **[Akshay Pachaar — The Anatomy of an Agent Harness](https://x.com/i/article/2040732084843782144)** · 前 Lightning AI 工程师
  将 Agent Harness 类比为 LLM 的操作系统，提出 12 个核心组件。sofagent 五层架构映射其中 8 个。

- **[Anthropic — A Global Workspace in Language Models](https://www.anthropic.com/research/global-workspace)**（2026-07）
  Claude 神经网络中自发涌现的内部思考空间（J-space）。实验证明模型在输出前就已形成未表达的判断——安全测试中可识别「这是测试」并改变行为。为 sofagent「审计必须外置、不可绕过」提供底层理论论证。详见 [ARCHITECTURE](./ARCHITECTURE.md#审计引擎)。

- **[Palantir AIP — Ontology 驱动的 Agent 架构](https://www.palantir.com/platforms/aip/)** · Palantir (2026)
  Palantir 未自研大模型，却实现远超行业的 Agent 可靠性。核心是 Ontology（本体论）——将数据+逻辑+动作+安全四合一的数字孪生操作层。其 Harness 定义与 sofagent 完全一致：「Ontology 是地图，Harness 是检查站。」

- **[微软 SkillOpt — Skill 自进化引擎](https://github.com/microsoft/SkillOpt)**（2026-07）
  使用类似神经网络训练的范式（Rollout→Reflect→Aggregate→Select→Update→Evaluate）自动优化 Agent Skill 文档。在 52 个评估单元中全部达到最佳，平均提升 20+ 分。为 sofagent v1.0.3 的 Skill 自进化闭环提供核心引擎。

- **[翁荔（Lilian Weng）— The Path to Recursively Self-Improving Harnesses](https://lilianweng.github.io/posts/2026-07-04-harness-rsl/)**（2026-07-04）
  前 OpenAI 安全研究副总裁。六层 Harness 优化框架（上下文工程 → Harness 代码优化 → 领域工作流设计 → 自我改进 → 进化搜索 → 与模型权重联合优化），为 sofagent 的 Harness 层定位提供行业理论验证。详见 [ARCHITECTURE](./ARCHITECTURE.md)。

- **[Anthropic — Managed Agents：解偶脑与手](https://www.anthropic.com/engineering/managed-agents)**（2026-04-08）
  四层编排架构（Agent 与沙盒解偶 → Coordinator 编排层 → Session 解偶层 → Session Store 记忆层）。核心论断：「Agent 领域为模型写的修补代码注定过时，模型的进化速度快于代码重构速度」。验证 sofagent 的 OpenClaw（连接+行动）+ DeepAgents（深度思考）分工。

- **[Anthropic — When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement)**（2026-06）
  内部数据披露：工程师人均代码产出达 2024 年 8 倍后，代码生成不再是瓶颈——**人工代码审查成为新堵点**（Amdahl 定律）。sofagent 把审查外置到 git diff 自动化，正是解这个瓶颈的方向。

- **[Deep Agent — LangChain 官方高级 Agent 框架](https://github.com/langchain-ai/deepagentsjs)**（2026）
  LangGraph 状态底座 + Harness Engineering 范式 + 子 Agent 委派 + 受控沙箱 + 长上下文管理 + HITL 四大特性，验证 sofagent v1.x 的技术选型。

- **[Google OKF — Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)** · Google Cloud Platform (2026)
  Markdown + YAML Frontmatter + Git 版本控制 + 人机可读的通用知识表示格式。生产者-消费者解耦、渐进式 index.md 导航、recipe+bundle 可复现模式——从 Google 内部独立验证了 sofagent knowledge/ 的「知识即文件系统」架构方向。

- **[Claude Code Agent Loop](https://docs.anthropic.com/en/docs/claude-code/how-claude-code-works)** · Anthropic (2026)
  三阶段循环（收集上下文→采取行动→验证结果）+ 三档工具权限 + 上下文自动压缩。三档权限与 sofagent 的 HITL 🟢🟡🔴 同构，循环机制与 sofagent 的编排引擎对应。Anthropic 官方表述："Claude Code serves as the agentic harness around Claude"——Harness 不是 sofagent 独创的概念，是行业共识。

- **[GBrain](https://github.com/garrytan/gbrain)** · Gary Tan / Y Combinator (2026-04)
  Karpathy LLM Wiki 思路的首个工业级落地——1.3 万+ 页 Markdown、Postgres + pgvector 混合搜索、夜间「梦境循环」自动整理记忆。架构同构：Compiled Truth（编译事实）+ Timeline（时间线）= sofagent 的 knowledge/ entities/concepts + think.md。

- **["Don't Do RAG" — Cache-Augmented Generation](https://arxiv.org/abs/2412.15605)** · WWW '25 (2025)
  CAG（编译式 RAG）的核心——按主题整合文档→去重去冲突→生成规整 Markdown→全量输入 LLM——与 sofagent knowledge/ 的「entities/concepts/comparisons 页面自动生成」完全同构。独立验证了「知识管理不需要向量数据库，干净 Markdown 就够了」的架构选择。

- **[Satya Nadella — No Priors x Latent Space at Microsoft Build](https://pod.wave.co/podcast/latent-space-the-ai-engineer-podcast/satya-nadella-no-priors-x-latent-space-crossover-special-at-microsoft-build)**（2026-06）
  微软 CEO Nadella 提出："Every company will have its own private eval. That may be the most important IP." 私有化评估体系 = 企业持续训练 Agent 过程中积累的反馈数据、评分标准、迭代轨迹。与 sofagent 的 FDE 交付物（Skill 定制 + scoring 反馈 + 知识库演变）完全对应——FDE 交付的不是工具，是企业培养 Agent 的评估闭环。

---
