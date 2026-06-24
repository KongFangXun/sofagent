# Loop Engineering 深度研究笔记

> 2026-06-22 · 从 ARCHITECTURE.md 迁入（v0.91 瘦身）。本文记录 Addy Osmani Loop Engineering 框架对 sofagent 设计的影响，以及由此发现的设计盲区和改进方向。
>
> ARCHITECTURE 只回答"为什么这么设计"，本文回答"外部研究怎么印证、怎么指导改进"。

---

## 一、五大组件 + Memory 对照

Addy Osmani 的 Loop Engineering 框架定义了五大组件 + Memory。sofagent 的对应实现：

| Loop 组件 | 定义 | sofagent 对应 | 状态 |
|------|------|------|:----:|
| Automations | Agent 什么时候触发 | engine.md A 段场景检测 | ⚠️ 只有会话启动，无定时 |
| Connectors | 接入业务系统 | 明确不做（文件系统就是接口） | ✅ 设计决策 |
| Worktrees | 多 Agent 文件隔离 | git worktree | ✅ |
| Skills | 做事依据什么 SOP | SKILL.md 宪法 + rules.md | ✅ |
| Sub-agents | 运动员 ≠ 裁判 | Loop Agent 三节点 + session.spawn | ✅ |
| Memory | 如何不失忆 | think.md + task/logs | ✅ |

6 件覆盖 5 件。唯一缺的是定时触发（Automations 的 cron 级），LIMITATIONS 已标注——等 Agent 平台支持 schedule/cron。

---

## 二、三个设计盲区

来自 2026-06-22 Loop Engineering 系列研究笔记，进 ROADMAP v0.9x：

| 盲区 | 研究发现 | sofagent 现状 | 改进方向 |
|------|------|------|------|
| **多智能体必要性评估** | 单 AI vs 多智能体成本差 15 倍；多智能体内部架构不同再差 10 倍——最贵 vs 最便宜差 100 倍 | engine.md A3 只判断风险边界，没判断「真的需要多智能体吗」 | A3 前加前置判断 |
| **验证器姿态：反驳层** | Bun 迁移案例（75 万行 Zig→Rust，测试通过率 99.8%）核心是「假设你错了，你来自证」 | loop-check 是「检查对错」，不是「假设错误要求自证」 | 闭环模式强化为反驳层 |
| **成本可视化** | 多智能体仪表盘——每个 AI 调了几次、烧了多少 token、有没有卡死循环 | 数据在 task/logs 里但无展示层 | bash 脚本输出 token/循环/失败率汇总 |

---

## 三、检查标准不可篡改性

Loop Engineering 的第一原则是「执行者和检查者分离」（sofagent 用 session.spawn 实现）。**第二原则更深**：检查用的「尺子」本身不能被篡改——否则独立监考老师也会批出满分卷，因为标准答案已被学生偷偷改了。

> 「Agent 不在耍心眼，它只是在你给的规则里找最省力的那条路。你说目标是把 CI 跑绿，它就去找把 CI 跑绿的最短路径——删掉报错测试比排查调用链快得多。」

四个风险点对照 sofagent：

| 风险 | 笔记描述 | sofagent 对应 | 现有防御 |
|------|------|------|------|
| 改断言 | 开发者改旧断言匹配错误行为 | Agent 覆盖式写入 think.md（改写历史） | think.md 置信度渐进 + 30 天衰减 |
| 删测试 | 删失败测试比修 bug 便宜 | scoring/ 降分不如直接删记录 | scoring 只追加不删除（设计意图） |
| 跳规则 | 加 `lint-ignore` 绕过检查 | Agent 跳过闭合清单步骤 | 软约束，无 Hook 级硬拦截 |
| 降标准 | 覆盖率从 90% 降到 80% | LLM 自评给自己打高分 | verify-evidence.sh 查 exit code（硬门） |

**设计启示**：sofagent 的 verify-evidence.sh（bash 查 task/logs 里的 exit code）正是「用硬的东西做门」的方向——测试能过就是能过，不能过就是不能过，一段自信的文字说服不了它。v0.9x 的外部评估器要延续这个原则：**用确定性工具做门，别用另一个 Agent**。

---

## 四、Maker-Checker 上下文隔离

> 来源：Anthropic Managed Agents + Bun 迁移案例。评估者和生成者的上下文必须物理隔离——否则评估者会「看到」生成过程，不自觉地认同生成者的逻辑链。

**为什么上下文隔离比模型分离更重要**：即使换了不同模型做评审，如果评审者能看到执行者的完整上下文（对话历史、工具调用、中间产出），它会沿着执行者的推理路径走——「这个函数写法确实合理」不是因为合理，是因为评审者看到了推理过程。上下文隔离打破了这个路径依赖。

sofagent 的实现按平台分级：

| 平台 | 隔离方式 | 可靠性 |
|------|------|:----:|
| OpenClaw | session.spawn 独立子 Agent——看不到主 Agent 上下文，只读 task/logs 文件 | ✅ 工程隔离 |
| 非 OpenClaw | 主 Agent 重新 Read task/logs，以文件为评审主依据 | ⚠️ prompt 级，执行记忆仍在窗口 |

**Bun 案例的启示**：Bun 团队迁移 75 万行 Zig→Rust，99.8% 测试通过率的关键不是模型更强——是**评审者看不到生成过程**。每个文件 level review 时，评审者拿到的是最终产出（diff），不是推理历史。sofagent 的 session.spawn 路径实现的就是这个原则；非 OpenClaw 路径是妥协（执行记忆仍在窗口里，已知局限）。

---

## 五、反驳层设计（Bun 案例）

> 来源：Bun 迁移案例（75 万行 Zig→Rust，测试通过率 99.8%）。来自 Cloud Code 工作流研究笔记。

Bun 团队的核心实践不是「写完再审」，是**每一层都假设上一层是错的**：

1. **File-level 即时 review**——不是等全部写完再审查，是每完成一个文件立即由独立评审者审查。发现问题的成本和修复成本最低
2. **反驳姿态**——评审者不是「检查这写得对不对」，是「假设这写错了，找出错在哪」。这个姿态差异很关键——前者倾向于认可（确认偏误），后者倾向于证伪
3. **举证责任翻转**——评审者说「这里有风险」时，不是评审者要证明有风险，是**执行者要证明没有风险**。这翻转了默认假设

对 sofagent loop-check closure 模式的指导：当前 closure 是「检查对错」（做完后评九维分数）。Bun 案例指向「假设错误」模式——闭环时不是问「这次做得怎么样」，是问「这次最可能在哪出了问题，你怎么证明没有」。这是 v0.9x+ loop-check 反驳层强化的设计参考。

---

## 六、循环反噬风险：理解债与认知投降

> 前 4 篇 Loop Engineering 研究覆盖了循环的「前期搭建」和「中期运行」。第 5 篇补充了**后期反噬**——循环跑久了会出现两种系统性风险，它们不阻止你搭建循环，但会在 3-6 个月后侵蚀项目掌控力。

### 理解债循环（Comprehension Debt Loop）

循环交付代码越快，仓库内容和人类认知差距越大。AI 写的代码没人逐行读过，等出 bug 要调试时，发现全组没人理解这个系统。这不是普通的代码债——技术债还能重构，认知债只能重写。

> 「交付代码越快，仓库里的内容和你脑子里懂的内容差距就越大，哪天要调试全组没人读过的系统，成本高到难以想象。」

对 sofagent 的指导：think.md 是减债工具（每次任务记录决策和教训），但**减债不等于消债**——反思条目只记录 Agent 当时的理解，不等于人类真正理解了代码。需要补充定期人工 review 机制：think.md 累积 ≥10 条时提醒人类抽查，循环产出物（生成的代码/文档）每月人工抽检 ≥1 次。已进 ROADMAP v0.9x。

### 认知投降（Cognitive Surrender）

长期依赖循环后丧失独立判断能力。循环说"已验证通过"，你信了；循环说"架构应该这样改"，你改了。时间久了你不再判断循环的输出是否正确——你只是转发它的结论。

> 「时间久了，你懒得自己判断，循环说什么就是什么，完全丧失对项目的掌控权。」

对 sofagent 的指导：TDD 模式的「用户 Review 测试用例」环节是当前唯一的防线（只看中文注释确认需求，门槛低但保持参与）。但标准 SOP 没有这个环节。需要补充：高风险决策（架构变更 / 数据库迁移 / 安全相关 / 删除操作）强制人工确认 + 单任务循环深度设上限（最多 3 轮编排，超限强制人工介入）。已进 ROADMAP v0.9x。

### 两个风险的关系

理解债是"你不懂 AI 写的代码"，认知投降是"你不再判断 AI 写的代码对不对"。前者是知识层面的差距，后者是能力层面的退化。理解债可以通过 review 缩小，认知投降只能通过保持参与来预防——一旦退化了，很难恢复。

---

## 七、五层回拉映射

> 来源：Anthropic Cloud Code 工作流研究。Agent 跑偏不是随机事件——每次偏移都可追溯到某个心智阶段被跳过。

五个阶段构成完整心智回路：**意图 → 规划 → 执行 → 验证 → 反思**。sofagent 的治理工具按阶段映射：

| 心智阶段 | 被跳过时的后果 | sofagent 对应 |
|:--:|------|------|
| 意图 | 没搞清用户要什么就开始干 | task-aware §1.1 风险边界 + 两轮澄清 |
| 规划 | 没拆任务直接写代码 | A3 准入检查 + ComplexityScorer |
| 执行 | 不读文件就改、不验证就继续 | 铁律 #1 先读后写 + #3 验证再干 |
| 验证 | 测试没过假装过了 | closure 5 项 checklist + verify-evidence.sh |
| 反思 | 做完了不记教训 | think.md 反思区 + 记忆三规则 |

**设计启示**：sofagent 的每个治理工具对应一个心智阶段的"回拉"——Agent 跳过了某个阶段，对应工具把它拉回来。不是每个任务都需要走全五步（简单任务跳规划和反思是正常的），但**每次跑偏都对应某个阶段被跳过**——这就是 debug 的切入点。

---

## 八、管道与闸门

> 来源：Anthropic Managed Agents 架构。循环不是一条直线——是「管道」加「闸门」的交替结构。

sofagent 的编排流程按管道-闸门模型理解：

```
[管道] 意图理解 → [闸门] 准入检查 → [管道] 任务拆解 → [闸门] 用户确认
→ [管道] 并行执行 → [闸门] 检查点暂停 → [管道] 结果聚合 → [闸门] 闭环验证
```

| 概念 | 定义 | sofagent 对应 |
|:--:|------|------|
| **管道**（Pipeline） | 信息流转通道——Agent 在其中自主工作，产出流转到下一环节 | engine.md 拆解、ao compose 分配、子 Agent 执行 |
| **闸门**（Gate） | 强制检查点——管道流到这里必须停下来验证，通过才继续 | A3 准入检查、checkpoint 暂停、closure 5 项 checklist |

**关键区别**：管道内的 Agent 有自主权（怎么拆、怎么写都行），闸门处没有自主权（必须显式输出 PASS/REJECT，不能跳过）。sofagent 的设计原则是**管道尽量宽（给 Agent 自由）+ 闸门尽量硬（检查不可绕过）**。

---

## 九、外部研究印证

sofagent 的核心设计选择，在独立研究中得到了方向性印证：

| 我们的设计 | 外部验证（定性） | 来源 |
|------|------|------|
| 结构化备忘录式记忆（think.md + task/logs + 文件系统）| "结构化行为回溯备忘录 + 精准 Tag 路由 + SQL，搞定 95% 以上场景。真正落地的记忆系统应该是极其清爽的。" | Agent 全局记忆系统设计批判 |
| 宪法内联 + 子 Skill 按需加载的分层架构 | Skill Reducer 实证（55,315 样本分析）：26.4% 技能完全缺失描述、10.7% 技能在强模型下已过时。分层架构后 Token 降低 39~48%，质量 +2.8%——直接支撑 sofagent「厚在治理、薄在复用」不走臃肿 Skill 路线。"结构感知是技能压缩的关键。" | Skill Reducer（港科大/清华/浙工大） |
| 闭环反思 + Loop Agent | Self Harness 四层模型（执行→留痕→提案→晋升验证），在 Terminal Bench 2.0 上分离评审后通过率显著提升。"Agent 可以提议修改，但不能自己批准。" | Self Harness（上海 AI Lab） |

> ⚠️ **诚实声明**：以上为各研究在自己实验条件下的定性结论。Self Harness / Skill Reducer 的具体百分比数字是它们在各自实验集上的结果，不代表 sofagent 能达到相同效果——sofagent 的 OpenClaw 路径有工程隔离（session.spawn），可类比引用；非 OpenClaw 路径只有 prompt 级约束，不引用具体数字。

这些不是我们引用外部研究来证明自己正确——而是两个完全独立的团队，从不同起点出发，得出了方向重叠的结论。

---

## 参考链接

| 来源 | 启发 | 链接 |
|------|------|------|
| **Addy Osmani** | Loop Engineering 五大件架构、语义化停止条件、三盆冷水 | [Loop Engineering 原文](https://addyo.substack.com/p/loop-engineering) |
| **Anthropic** | Managed Agents 四层架构——管道与闸门、Maker-Checker 隔离 | [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) |
| **Google Cloud AI Research / UIUC · SkillOS** | 执行与治理分离的技能治理框架 | [arXiv 2605.06614](https://arxiv.org/abs/2605.06614) |
| **MAGMA 多图谱记忆架构** | 四维正交图谱、消融实验证明多维度记忆分离的必要性 | [arXiv 2601.03236](https://arxiv.org/abs/2601.03236) |
| **Microsoft Research · SkillOpt** | Skill 文档当模型「外部状态」训练的方法论 | [arXiv 2605.23904](https://arxiv.org/abs/2605.23904) |
| **徐远哲 · Ledger-Views-Policy** | Agent Memory 架构最小形态 | [Agent Memory 架构思考](https://xuyuanzhe.github.io/blog/2026/agent-memory-architecture/) |
| **多智能体成本研究** | 单 AI vs 多智能体成本差 15 倍 | [虎嗅：多智能体 AI 系统成本控制深度解析](https://www.huxiu.com/article/4868924.html) |
