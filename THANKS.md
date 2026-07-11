# 致谢

> sofagent 站在巨人肩膀上。以下每一个项目、文章和作者，都在 sofagent 的某个设计决策里留下了痕迹。
>
> v1.0.2 · 2026-07-11（UTC）

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

这个项目里的文件是模型间 Loop 实验的产物——多 session 内互改互审，直到所有模型都版本通过。参与的核心模型是 DeepSeek V4 Pro 和 GLM-5.2，详见 [致谢](./THANKS.md#生成伙伴)。分享出来期待你也参与进来一起优化。

如果你也在折腾 OpenClaw，希望这个对你有用。

---

## 哲学与理念

影响了 sofagent "为什么这么设计" 的思考。

- **[Ralph Loop](https://ghuntley.com/loop/)** by Geoffrey Huntley —「Agent 失忆，文件不失忆」是 sofagent 的哲学基因。一行 bash 循环 + Stop Hook + 新鲜上下文每轮刷新，启发了审计方向：git diff 是无状态地面真相
- **[Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills)** — 4 条编码原则是 7 则铁律的根基。感谢 Karpathy
- **[Anthropic Skills](https://github.com/anthropics/skills)** — 官方 SKILL.md 格式规范，描述-实现分离和 Skill 索引卡片参考了它
- **[Loop Engineering](https://addyo.substack.com/p/loop-engineering)** by Addy Osmani — 帮我理清了 Context → Harness → Loop 三层框架的关系
- **[OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)** — Harness 概念的系统化参考
- **[Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)** — 长时间运行 Agent 的有效治理思路
- **[Lost in the Middle](https://arxiv.org/abs/2307.03172)** — 模型对长文档中段注意力衰减的研究，500 字原则的理论源头

---

## 工具与实现

sofagent 直接使用或借鉴了它们的能力。

- **[agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)**（Apache-2.0）— `ao compose` 一行命令搞定编排：意图识别 → 任务图生成 → 模板匹配 → 分配
- **[agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)** — 215 个中文岗位模板，IDENTITY 层素材来源
- **[MiroFish](https://github.com/666ghj/MiroFish)** —「工具调用与最终答案严格分离」模式，启发了 sofagent 审计层的证据分层设计
- **[superpowers](https://github.com/obra/superpowers)** — Skill 作为 Harness 杠杆的思路，启发了 Skills 体系的设计
- **[best-of-agent-harnesses](https://github.com/RyanAlberts/best-of-agent-harnesses)** — 101+ 个 Harness 项目索引，让我了解这个领域已经有什么人在做什么事

---

## 社区与平台

sofagent 在这些社区里传播和生长。

- **[ClawHub](https://clawhub.ai)** — 全球 Skills 社区，Skills 体系的外部来源
- **[/goal 命令](https://docs.anthropic.com/en/docs/claude-code/goal)** — Claude Code 的自主执行循环，启发了我加用户确认的设计

---

## 外部研究与参考

以下工作为 sofagent 的架构设计提供了关键理论支撑和外部验证：

- **[Hugging Face — Don't Train the Model, Evolve the Harness](https://huggingface.co/spaces/joelniklaus/harness-optimization)** · Joel Niklaus (2026)
  实验证明：不改模型权重、仅优化外层 Harness，让 DeepSeek-v4-pro 在法律 Agent 基准中从 3.5% 提升至 80.1%，追平 Claude Sonnet 4.6，成本仅 1/7。这是 sofagent 存在理由的最强外部证据。

- **[Karpathy AutoResearch](https://github.com/karpathy/autoresearch)** · Andrej Karpathy (2026) · 9 万 GitHub Star
  630 行 Python 脚本让 AI Agent 在单 GPU 上跑 700 次自动实验，找出 20 项连 Karpathy 本人都忽略的代码改进。其 Loop Engineering 方法——约束文档 + 锁定评估脚本 + 自动循环——与 sofagent 的 fde.md + sofagent-audit + loop-check 高度对应。

- **[Bilevel Autoresearch](https://arxiv.org/abs/2603.23420)** · 双层循环论文
  在 AutoResearch 基础上进一步验证了双层循环（外层优化搜索逻辑、强制探索回避方向）可实现 5 倍性能提升。

- **[Codila — AutoResearch 五步方法论](https://x.com/0xCodila/status/2072329149520232639)**
  将 AutoResearch 浓缩为五步方法论——自动验证器 + 状态文件 + 停止条件。与 sofagent 的 fde.md + sofagent-audit + loop-exit 高度对应。

- **[Akshay Pachaar — The Anatomy of an Agent Harness](https://x.com/i/article/2040732084843782144)** · 前 Lightning AI 工程师
  将 Agent Harness 类比为 LLM 的操作系统，提出 12 个核心组件。sofagent 五层架构映射其中 8 个。

- **[Anthropic — A Global Workspace in Language Models](https://www.anthropic.com/research/global-workspace)**（2026-07）
  Claude 神经网络中自发涌现的内部思考空间（J-space）。实验证明模型在输出前就已形成未表达的判断——安全测试中可识别「这是测试」并改变行为。为 sofagent「审计必须外置、不可绕过」提供底层理论论证。详见 [ARCHITECTURE](./ARCHITECTURE.md#为什么审计必须外置j-space-的启示)。

- **[Palantir AIP — Ontology 驱动的 Agent 架构](https://www.palantir.com/platforms/aip/)** · Palantir (2026)
  Palantir 未自研大模型，却实现远超行业的 Agent 可靠性。核心是 Ontology（本体论）——将数据+逻辑+动作+安全四合一的数字孪生操作层。其 Harness 定义与 sofagent 完全一致：「Ontology 是地图，Harness 是检查站。」

- **[OpenFDE — FDE 知识库与社区](https://open-fde.com)**（2026-07）
  FDE 10 步工作流（[workflow](https://open-fde.com/docs/workflow)）与 8 维能力模型（[capabilities](https://open-fde.com/docs/capabilities)），为 sofagent 提供行业定位外部验证：第 4 步将审计列为架构基础层，第 6/7 步直接对应 sofagent 审计引擎与生产化工具链。

- **[OpenFDE Agent v0.1 — 原位学徒循环](https://github.com/Open-FDE/FDEAgent)**（2026-07-10）
  Apprentice Loop（OBSERVE → ELICIT → INDUCE → ACT → EVOLVE）+ Judgment Unit（判断单元）核心原语——WHEN/SIGNALS/DO/WHY/REVERSE + 渐进自主度（suggest → approve → auto）+ DEPLOY/ATTRIBUTION 双面架构。为 sofagent 的 think.md 结构化、HITL 渐进自主度、插件位开源基线设计提供参考。

- **[微软 SkillOpt — Skill 自进化引擎](https://github.com/microsoft/SkillOpt)**（2026-07）
  使用类似神经网络训练的范式（Rollout→Reflect→Aggregate→Select→Update→Evaluate）自动优化 Agent Skill 文档。在 52 个评估单元中全部达到最佳，平均提升 20+ 分。为 sofagent v1.0.3 的 Skill 自进化闭环提供核心引擎。

- **[翁荔（Lilian Weng）— The Path to Recursively Self-Improving Harnesses](https://lilianweng.github.io/posts/2026-07-04-harness-rsl/)**（2026-07-04）
  前 OpenAI 安全研究副总裁。六层 Harness 优化框架（上下文工程 → Harness 代码优化 → 领域工作流设计 → 自我改进 → 进化搜索 → 与模型权重联合优化），为 sofagent 的 Harness 层定位提供行业理论验证。详见 [ARCHITECTURE](./ARCHITECTURE.md#harness-框架行业验证翁荔六层模型)。

- **[Anthropic — Managed Agents：解偶脑与手](https://www.anthropic.com/engineering/managed-agents)**（2026-04-08）
  四层编排架构（Agent 与沙盒解偶 → Coordinator 编排层 → Session 解偶层 → Session Store 记忆层）。核心论断：「Agent 领域为模型写的修补代码注定过时，模型的进化速度快于代码重构速度」。验证 sofagent 的 OpenClaw（连接+行动）+ DeepAgents（深度思考）分工。

- **[Deep Agent — LangChain 官方高级 Agent 框架](https://github.com/langchain-ai/deepagentsjs)**（2026）
  LangGraph 状态底座 + Harness Engineering 范式 + 子 Agent 委派 + 受控沙箱 + 长上下文管理 + HITL 四大特性，验证 sofagent v1.x 的技术选型。

- **[人工审核对 AI 系统可靠性与责任边界的提升机制](https://get笔记/ai-hitl-reliability)**（2026-07-10）
  三层审核维度（语义与逻辑 / 合规与安全 / 质量与价值）+ 四类必须人工介入的高风险场景 + 置信度分级机制，为 v1.0.4 HITL middleware 的设计提供理论和数据依据。

---
