# 致谢

> sofagent 站在巨人肩膀上。以下每一个项目、文章和作者，都在某个设计决策里留下了痕迹。

> v1.2.0 · 2026-07-25 · 孔放勋

<img src="assets/sofagent.png" alt="sofagent" width="160" />

---

## 基石

- **[OpenClaw](https://github.com/openclaw/openclaw)** · Peter Steinberger — 整个 sofagent 建立在它之上：上下文加载、Hook 触发、Skill 注入、Session 管理

## 生成伙伴

模型间 Loop 实验——多 session 内互改互审，直到所有模型都通过。随后新 session 重审，下一轮迭代开始。

- **[DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/)** · 深度求索
- **[GLM-5.2](https://z.ai/)** · 智谱 AI

---

## 思想之源

影响了 sofagent「为什么这么设计」的理论与实践。

### 哲学基因

- **[Ralph Loop](https://ghuntley.com/loop/)** · Geoffrey Huntley —「Agent 会失忆，文件不会」启发了审计方向：git diff 是无状态的地面真相
- **[Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills)** — 4 条编码原则是 7 则铁律的根基
- **[Anthropic Skills](https://github.com/anthropics/skills)** — 官方 SKILL.md 格式规范，描述-实现分离的参考

### Loop → Harness → Graph

- **[Loop Engineering](https://addyo.substack.com/p/loop-engineering)** · Addy Osmani — 正式命名了 Context → Harness → Loop 三层框架
- **[From Loop to Graph Engineering](https://engineering.zooz.com/intuitionmachine/from-loop-engineering-to-graph-engineering-d3ebeb08511c)** · Carlos E. Perez — 单闭环四类失效及 Graph 拓扑解法；核心洞察：拓扑不解决 grounding，没 Anchor 的 Graph 只是更贵的 Loop。sofagent 审计引擎即独立审计闭环。详见 [ARCHITECTURE §Graph Engineering](./ARCHITECTURE.md#graph-engineering-视角控制图--stategraph)
- **[OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)** — Harness 概念的系统化参考
- **[Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)** · Anthropic — 长时间运行 Agent 的有效治理

### 实验与证据

- **[Don't Train the Model, Evolve the Harness](https://huggingface.co/spaces/joelniklaus/harness-optimization)** · Joel Niklaus — 不改权重、仅优化 Harness，让 DeepSeek-v4-pro 从 3.5% 升至 80.1%。sofagent 存在理由的外部证据
- **[AutoResearch](https://github.com/karpathy/autoresearch)** · Andrej Karpathy — 约束文档 + 锁定评估脚本 + 自动循环，与 sofagent 的 fde.md + audit + loop 高度对应
- **[Bilevel Autoresearch](https://arxiv.org/abs/2603.23420)** — 双层循环论文，外层强制探索回避方向可实现 5 倍性能提升
- **[Lost in the Middle](https://arxiv.org/abs/2307.03172)** — 长文档中段注意力衰减，500 字原则的理论源头
- **[A Global Workspace in Language Models](https://www.anthropic.com/research/global-workspace)** · Anthropic — 模型输出前已形成未表达判断，为「审计必须外置」提供底层论证

### 编排与架构

- **[Managed Agents](https://www.anthropic.com/engineering/managed-agents)** · Anthropic — 四层编排架构，验证 OpenClaw（连接+行动）与 DeepAgents（深度思考）分工
- **[Deep Agents](https://github.com/langchain-ai/deepagentsjs)** · LangChain — LangGraph 状态底座 + Harness 范式 + HITL，验证 v1.x 技术选型
  > 注：sofagent v1.2.0 已从 deepagents 迁移至 LangGraph createReactAgent（详见 [FORGE/LESSONS.md](../FORGE/LESSONS.md)），但 deepagents 的 Harness 范式 + HITL 设计思想在 v1.x 阶段提供了重要的架构参考。
- **[Claude Code Agent Loop](https://docs.anthropic.com/en/docs/claude-code/how-claude-code-works)** · Anthropic — 三阶段循环 + 三档工具权限，与 sofagent HITL 🟢🟡🔴 同构
- **[Palantir AIP Ontology](https://www.palantir.com/platforms/aip/)** · Palantir — 数据+逻辑+动作+安全四合一的数字孪生层，Harness 定义与 sofagent 一致
- **[The Path to Recursively Self-Improving Harnesses](https://lilianweng.github.io/posts/2026-07-04-harness-rsl/)** · 翁荔（Lilian Weng）— 六层 Harness 优化框架
- **[The Anatomy of an Agent Harness](https://x.com/i/article/2040732084843782144)** · Akshay Pachaar — Harness 即 LLM 的操作系统，12 个核心组件
- **[Three Key Loops](https://www.deeplearning.ai/the-batch/three-key-loops-for-building-great-software)** · Andrew Ng — 分钟→小时→天-周三层嵌套循环；开发者留在循环的理由是上下文优势而非品味

### 认知与反馈

- **[A Field Guide to Fable](https://x.com/trq212/article/2073100352921215386)** · Thariq Shihipar — 四类未知框架；模型够强时瓶颈从「能不能做」变成「你能不能说清楚」
- **[When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement)** · Anthropic — 代码生成不再是瓶颈，人工审查成为新堵点；sofagent 把审查外置到 git diff
- **[SkillOpt](https://github.com/microsoft/SkillOpt)** · 微软 — Skill 自进化引擎，为 v1.0.3 闭环提供参考
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

这个项目里的文件是模型间 Loop 实验的产物——多 session 内互改互审，直到所有模型都通过。参与的核心模型详见 [生成伙伴](#生成伙伴)。分享出来期待你也参与进来一起优化。

如果你也在折腾 OpenClaw，希望这个对你有用。
