# sofagent Architecture

> 一个完全不懂代码的产品经理，在设计 Agent 治理层时都想了些什么。
>
> 这份文档不教你怎么用 sofagent——那是 [Handbook](./HANDBOOK.md) 的事。这里只写设计决策、权衡取舍、已知局限，以及我们为什么故意不做某些事。
>
> 各节按 Handbook 章节顺序排列，方便两边对照着读。
>
> > v0.83 · 2026-06-22 · 孔放勋

<img src="images/sofagent.png" alt="sofagent" width="300" />

---

## 一、为什么会有 sofagent

AI 工程方法一直在往前走：

- **Prompt Engineering** 解决了「怎么对 AI 说话」——你把需求写成一段 prompt，它回你结果。
- **Context Engineering** 解决了「AI 应该知道什么」——你把规则、历史、偏好写成上下文文件，每次对话自动注入。
- **Harness Engineering** 解决了「AI 在什么约束下跑」——你在 AI 和世界之间放了一层安全壳。

到了这一步，剩下一个没人管的问题：**谁来按回车？**

三个概念的区分，用餐厅来类比最清楚：**Context Engineering 是菜谱**（规定用什么食材、什么火候），**Harness Engineering 是厨房管理制度**（食材检查、急救防护、灭火器），**Loop Engineering 是餐厅运营系统**（几点开门、工序排期、库存管理）。三个组件高度重叠——Skills、Sub-agent、Memory 在三层里都有——但交出的是不同级别的控制权。

Agent 跑完一个任务之后，谁来告诉它「下一个任务是什么」？谁来确认「上一个任务做对了吗」？谁来记录「这次踩了什么坑下次别踩」？

这就是 Loop Engineering 要解决的：不是写一个更好的 prompt，是设计一个自己会转的循环。Google Cloud AI 总监的定义说得最清楚：把亲自给 Agent 写 prompt 的你替换掉，转而去设计那个代替你做这件事的系统。

sofagent 就是这个系统——一个给 OpenClaw Agent 加的治理层。它不跑你的任务，它管跑你任务的 Agent。

为什么 sofagent 聚焦于上下文管理、控制流、错误恢复、反馈回路这四件事？这背后有一个关键区分：**补偿性工程 vs 系统性工程。**

- **补偿性工程**（Compensatory Engineering）：解决模型当前能力局限的补丁——比如为特定模型写绕过幻觉的 prompt、针对某版本 API 的兼容层。模型一升级，补丁就过期。保质期短。
- **系统性工程**（Systematic Engineering）：解决 Agent 运行中不随模型升级而消失的永久性挑战——上下文溢出（再多 token 也有上限）、控制流失控（再不限制就跑偏）、错误传导（一只 Agent 崩了连锁感染）、反馈缺失（做了对错都没人告诉它）。模型再强，这四个问题不会自动消失。

sofagent 选的是后者。不是因为前者不重要，是因为前者会被模型厂商自己解决，后者才是长期存在的结构性工程问题。这解释了为什么厚在治理、为什么铁律不随模型更新而改变、为什么聚焦于循环而非单次 prompt。

> 🧬 **硬层定义好，软层可进化。裁判碰不到，演化有人审。** 这二十个字是 sofagent 设计的总纲——来自循环工程（Loop Engineering）深度架构分析。硬层（SKILL.md + rules.md）定义「你是谁、要什么、什么算好」，Agent 绝对不能碰；软层（scoring.md + think.md + orchestrator/）是数据不是代码，在客观验证信号下持续进化，但每次修订必须可追溯、可审计。

加载链的本质是 Google Skill「模型行为控制器」理念的实现——不靠代码补丁，靠上下文注入的约束文件接管 Agent 行为。Google 的三种 Skill 模式在 sofagent 里各有对应：Reviewer（标准化审查）→ 铁律 #3「验证再继续」；Inversion（先问再做，三级响应：简单直接干→中等说一声→复杂才问）→ 任务感知复杂度分级；Pipeline（关卡验证）→ ao compose 确认 Gate。

设计上参考了 Anthropic Managed Agents 的四层架构：
- 解耦脑和手：模型规划决策，执行在独立沙盒
- 宠物变工具：Agent 是无状态 disposable worker，崩了就销毁（子 Agent 脏数据隔离）
- Agent ≠ Session：静态模板 vs 动态实例
- Loop > Prompt：设计循环让系统自己跑，不逐个写提示词
- 记忆是决策通道：核心不在存了多少，在历史→决策的转换效率

sofagent 把这些原则从公司内部系统搬到了开源项目里。

### 两层架构：地基 vs 引擎

sofagent 不是把所有东西堆在一起。它分两层：

| 层 | 是什么 | 何时激活 | 占用 |
|:--:|------|:--:|:--:|
| 地基 | 三层加载链（宪法+反思+规则）| 每个会话启动，永远在线 | ~3,000 token |
| 引擎 | 任务编排（拆解+Loop+闭环）| 🔴 复杂任务才点火 | ~800 token（首次） |

地基轻、引擎重——这是有意为之。如果地基也重，Agent 连简单对话都走不动。

**为什么分开**：地基是整个会话的前提（宪法、反思、偏好常驻上下文），引擎是任务级别的工具（只在 🔴 复杂任务时激活）。加载链从引擎拆到 SKILL.md 最前面，让 🟢🟡 简单任务也享受完整治理底座——简单任务时反思区不在上下文，Agent 不知道上次踩了什么坑，地基常驻解决了这个「治理盲区」。

SKILL.md 和 rules.md 还的是「意图债」——不用每次任务都重新交代项目背景、规则和已知坑点。

<a id="why-resident"></a>
如果加载链只在复杂任务时才激活，后果很清楚：

| 缺失的文件 | 后果 |
|------|------|
| think.md 反思区不在上下文 | Agent 不知道上次踩了什么坑，重复犯错 |
| rules.md 你的规则不在上下文 | 简单任务时你的偏好全部失效（回复风格、文件操作习惯…） |
| 只有 SKILL.md 底线 | 底线能用但行为规范丢失 |

这就是为什么地基不跟引擎走——治理底座必须永远在线，不管任务简单还是复杂。

### 产品架构展望（三层）

当前产品是两层（地基+引擎），最终形态是三层。每层独立验证，下层为上层的底座：

| 层 | 部署在哪 | 干什么 | 当前状态 |
|:--:|------|------|:--:|
| **治理层** | Agent 上下文 | SKILL.md（宪法）、engine.md（编排）、think.md（反思）、rules.md（规则）——纯 MD 文件，Agent 读即生效 | ✅ 已可用 |
| **执行层** | 用户设备 | daemon 常驻进程——跨 session 经验不丢失、定时清理、Agent 启动提醒。不依赖任何 Agent 平台 | v0.8 开发中 |
| **协同层** | 局域网/内网 | router——多设备 Agent 能力画像匹配、任务分发、反思同步 | v2.x 规划中 |

为什么从 Skill 开始自底向上：先验证治理内容本身有效，再加 daemon 保证它跨 session 生效，最后用 router 让多设备像团队一样协同。每层跑通再加下一层——不推翻已验证的东西。

<a id="skill-runtime"></a>
### 为什么是 Skill + 脚本 + Runtime，不是纯 Skill 或纯代码

sofagent 的实现不堆在一层里。一条任务下来，三样东西各司其职：

| 什么事 | 谁来做 | 为什么 |
|------|------|------|
| 判断（评分、反思、选模板、拆任务） | Skill（MD prompt 文件） | 这些是 LLM 的长项——模式识别、定性判断、语义理解。写代码做不了 |
| 机械操作（文件读写、API 调用、npm 操作、curl 搜索） | 脚本（bash） | 这些是确定性操作——复制、拼接、curl、计数。Agent 不应该自己猜，脚本一条命令精确执行 |
| 硬安全（加载链、断路器、死循环检测） | OpenClaw 原生配置 | Agent 失控时没法自己管自己。必须在 Agent 外部兜底 |

不是把所有逻辑都写成 Skill（那样机械操作会依赖 LLM 的随机性），也不是全写成代码（那样语义判断会变成硬编码的 if-else）。三是天然的分界——LLM 管判断、脚本管执行、Runtime 管刹车。跨平台时核心约束（SKILL.md）不受影响，但脚本依赖 shell 环境。

<a id="white-box-loop"></a>
### 白盒循环：为什么不在 `/goal` 原版上直接跑

Claude Code 的 `/goal` 是 Loop Engineering 的雏形——设一个目标，Agent 自己拆任务、自己跑到底。但原版是纯粹的黑盒：目标给出去之后，Agent 闷头跑几分钟，方向歪了、交回来的不是我想要的。

所以在 `/goal` 之后加了一层——**把黑盒变成白盒**：

| 我加的 | /goal 原版 | 为什么 |
|------|------|------|
| 用户确认 | 循环自主跑到底 | 不懂代码的人不敢让它黑盒跑——先看一眼提案再执行 |
| 硬层/软层分离 | 没明确切分 | SKILL.md（契约层，宪法内联）是硬层，Agent 碰不了；scoring.md + think.md 是软层，Agent 自己进化 |

代价是每次编排多一次用户确认环节——但换来了「不懂代码的 PM 也敢用」。白盒的关键不是加了确认按钮，是**用户和 Agent 一起把目标定清楚，再启动编排**。

### 文档膨胀控制

sofagent 的四份核心文档有硬性行数上限：Handbook ≤500 行 / Developer ≤600 行 / Design ≤600 行 / README ≤250 行。新增章节前必须先删一段旧内容——不是"加一点就好"，是"加了就得减一点"。文档膨胀会让 Agent 上下文变重，也会让用户读不下去。这条原则和 500 字原则（[§二](#500-char)）同源——都是把信息密度做到极致。

### 外部研究印证（2026-06-19 / 2026-06-22 更新）

sofagent 的核心设计选择，在独立研究中得到了方向性印证：

| 我们的设计 | 外部验证（定性） | 来源 |
|------|------|------|
| 结构化备忘录式记忆（think.md + task/logs + 文件系统）| "结构化行为回溯备忘录 + 精准 Tag 路由 + SQL，搞定 95% 以上场景。真正落地的记忆系统应该是极其清爽的。" | Agent 全局记忆系统设计批判 |
| 宪法内联 + 子 Skill 按需加载的分层架构 | Skill Reducer 实证：核心规则仅占技能一小部分，分层架构能显著降低 token 占用、保持质量。"结构感知是技能压缩的关键。" | Skill Reducer（港科大/清华/浙工大） |
| 闭环反思 + Loop Agent | Self Harness 四层模型（执行→留痕→提案→晋升验证），在 Terminal Bench 2.0 上分离评审后通过率显著提升。"Agent 可以提议修改，但不能自己批准。" | Self Harness（上海 AI Lab） |

> ⚠️ **诚实声明**：以上为各研究在自己实验条件下的定性结论。Self Harness / Skill Reducer 的具体百分比数字是它们在各自实验集上的结果，不代表 sofagent 能达到相同效果——sofagent 的 OpenClaw 路径有工程隔离（session.spawn），可类比引用；非 OpenClaw 路径只有 prompt 级约束，不引用具体数字。Self Harness / Skill Reducer 的论文链接待补（致谢表其他引用均有 arXiv 号，这两篇暂缺，欢迎补充）。

这些不是我们引用外部研究来证明自己正确——而是两个完全独立的团队，从不同起点出发，得出了方向重叠的结论。

#### Loop Engineering 五大组件 + Memory 对照（2026-06-22）

Addy Osmani 的 Loop Engineering 框架定义了五大组件 + Memory。sofagent 的对应实现：

| Loop 组件 | 定义 | sofagent 对应 | 状态 |
|------|------|------|:----:|
| Automations | Agent 什么时候触发 | engine.md A 段场景检测 | ⚠️ 只有会话启动，无定时 |
| Connectors | 接入业务系统 | 明确不做（文件系统就是接口） | ✅ 设计决策 |
| Worktrees | 多 Agent 文件隔离 | git worktree（见 §二） | ✅ |
| Skills | 做事依据什么 SOP | SKILL.md 宪法 + rules.md | ✅ |
| Sub-agents | 运动员 ≠ 裁判 | Loop Agent 三节点 + session.spawn | ✅ |
| Memory | 如何不失忆 | think.md + task/logs | ✅ |

6 件覆盖 5 件。唯一缺的是定时触发（Automations 的 cron 级），LIMITATIONS 已标注——等 Agent 平台支持 schedule/cron。

**三个设计盲区**（来自 2026-06-22 Loop Engineering 系列研究笔记，进 ROADMAP v0.9）：

| 盲区 | 研究发现 | sofagent 现状 | 改进方向 |
|------|------|------|------|
| **多智能体必要性评估** | 单 AI vs 多智能体成本差 15 倍；多智能体内部架构不同再差 10 倍——最贵 vs 最便宜差 100 倍 | engine.md A3 只判断风险边界，没判断「真的需要多智能体吗」 | A3 前加前置判断 |
| **验证器姿态：反驳层** | Bun 迁移案例（75 万行 Zig→Rust，测试通过率 99.8%）核心是「假设你错了，你来自证」 | loop-check 是「检查对错」，不是「假设错误要求自证」 | 闭环模式强化为反驳层 |
| **成本可视化** | 多智能体仪表盘——每个 AI 调了几次、烧了多少 token、有没有卡死循环 | 数据在 task/logs 里但无展示层 | bash 脚本输出 token/循环/失败率汇总 |

#### 检查标准不可篡改性：门不仅要独立，还要焊死（2026-06-22）

Loop Engineering 的第一原则是「执行者和检查者分离」（sofagent 用 session.spawn 实现）。**第二原则更深**：检查用的「尺子」本身不能被篡改——否则独立监考老师也会批出满分卷，因为标准答案已被学生偷偷改了。

> 「Agent 不在耍心眼，它只是在你给的规则里找最省力的那条路。你说目标是把 CI 跑绿，它就去找把 CI 跑绿的最短路径——删掉报错测试比排查调用链快得多。」

四个风险点对照 sofagent：

| 风险 | 笔记描述 | sofagent 对应 | 现有防御 |
|------|------|------|------|
| 改断言 | 开发者改旧断言匹配错误行为 | Agent 覆盖式写入 think.md（改写历史） | think.md 置信度渐进 + 30 天衰减 |
| 删测试 | 删失败测试比修 bug 便宜 | scoring/ 降分不如直接删记录 | scoring 只追加不删除（设计意图） |
| 跳规则 | 加 `lint-ignore` 绕过检查 | Agent 跳过闭合清单步骤 | 软约束，无 Hook 级硬拦截 |
| 降标准 | 覆盖率从 90% 降到 80% | LLM 自评给自己打高分 | verify-evidence.sh 查 exit code（硬门） |

**设计启示**：sofagent 的 verify-evidence.sh（bash 查 task/logs 里的 exit code）正是「用硬的东西做门」的方向——测试能过就是能过，不能过就是不能过，一段自信的文字说服不了它。v0.9 的外部评估器要延续这个原则：**用确定性工具做门，别用另一个 Agent**。

#### 循环反噬风险：理解债与认知投降（2026-06-22）

> 前 4 篇 Loop Engineering 研究覆盖了循环的「前期搭建」（5 组件框架、TDD 节奏）和「中期运行」（对抗性验证、检查标准不可篡改）。第 5 篇补充了**后期反噬**——循环跑久了会出现两种系统性风险，它们不阻止你搭建循环，但会在 3-6 个月后侵蚀项目掌控力。

**理解债循环**（Comprehension Debt Loop）：循环交付代码越快，仓库内容和人类认知差距越大。AI 写的代码没人逐行读过，等出 bug 要调试时，发现全组没人理解这个系统。这不是普通的代码债——技术债还能重构，认知债只能重写。

> 笔记原文：「交付代码越快，仓库里的内容和你脑子里懂的内容差距就越大，哪天要调试全组没人读过的系统，成本高到难以想象。」

对 sofagent 的指导：think.md 是减债工具（每次任务记录决策和教训），但**减债不等于消债**——反思条目只记录 Agent 当时的理解，不等于人类真正理解了代码。需要补充定期人工 review 机制：think.md 累积 ≥10 条时提醒人类抽查，循环产出物（生成的代码/文档）每月人工抽检 ≥1 次。已进 ROADMAP v0.9。

**认知投降**（Cognitive Surrender）：长期依赖循环后丧失独立判断能力。循环说"已验证通过"，你信了；循环说"架构应该这样改"，你改了。时间久了你不再判断循环的输出是否正确——你只是转发它的结论。

> 笔记原文：「时间久了，你懒得自己判断，循环说什么就是什么，完全丧失对项目的掌控权。」

对 sofagent 的指导：TDD 模式的「用户 Review 测试用例」环节是当前唯一的防线（只看中文注释确认需求，门槛低但保持参与）。但标准 SOP 没有这个环节。需要补充：高风险决策（架构变更 / 数据库迁移 / 安全相关 / 删除操作）强制人工确认 + 单任务循环深度设上限（最多 3 轮编排，超限强制人工介入）。已进 ROADMAP v0.9。

**两个风险的关系**：理解债是"你不懂 AI 写的代码"，认知投降是"你不再判断 AI 写的代码对不对"。前者是知识层面的差距，后者是能力层面的退化。理解债可以通过 review 缩小，认知投降只能通过保持参与来预防——一旦退化了，很难恢复。

---

## 二、核心设计决策

> 一个不懂代码的人做的设计决策——有疑问直接开 Issue，我大概率说不过你。

<a id="500-char"></a>
### 500 字原则（[Handbook §一](./HANDBOOK.md#一厚在治理薄在复用)）

加载链里的每份文档——SKILL.md、rules.md——都有一个硬上限：500 字以内。

这个数字来自使用经验而非精确实验，逻辑却很清楚：超过 500 字，Agent 的遵守率明显下降——规则在长文本里会被淹没，Agent 只挑它「看到」的几条遵守，漏掉后面的。

可交付 AI 系统的工程实践里另一个反常识发现强化了这个判断：**提供全部 Skills 时准确率 77%，完全不提供时反而 97%。** 不是 Skill 写得不好，是太多 Skill 挤占了上下文、干扰了模型判断。指导和原则优于堆砌规则。

加载链确保每层文件都落在模型的「开头注意力区」内——最后加载的（rules.md）优先级最高。如果你把 rules.md 写成 2000 字的说明书，最终只有前 500 字会被认真对待。

> 💡 500 字原则和「文件系统而非数据库」是同一枚硬币的两面——都是把信息密度做到极致。文件系统的 Markdown 天然强迫你写短，数据库的富文本反而纵容堆砌。

这个设计背后有研究支撑——Liu et al. 的 *Lost in the Middle*（2023）证明了 LLM 对输入上下文开头和末尾的信息识别率最高，中间部分显著衰减。sofagent 的加载链顺序不是拍脑袋定的，是跟着注意力曲线走的。

### 三层加载链：为什么是这个顺序（[Handbook §二](./HANDBOOK.md#二三层加载链)）

从契约到执行，三层按「能不能改」分级：

| 层 | 文件 | 权限 |
|:--:|------|:--:|
| 1 | 契约层（`SKILL.md`（宪法内联）） | ❌ 千万别碰 |
| 2 | 反思层（`think.md`） | ⚠️ 自动生成，改了没用 |
| 3 | 执行层（`rules.md`） | ✅ 随便改 |

设计逻辑：契约层是 Agent 的身份和铁律，不能动。反思层是循环中自动生成的错题本，改了也会被覆盖。执行层是你的规则，写了就生效。越往下越自由。

加载顺序受 Lost in the Middle 约束：SKILL.md 放最前面（开头注意力最高），rules.md 放最后面（末尾注意力最高）。中间的 think.md 是参考信息，不是硬约束。

技术实现用的是 OpenClaw 2026.6.x 的内部 hook 架构——声明式注册 `sofagent-load-chain`（HOOK.md + handler.ts）到 `~/.openclaw/hooks/`，监听 `agent:bootstrap` 事件，在 Agent 启动时把 think.md（第 2 层）和 rules.md（第 3 层）注入 bootstrap 文件列表。第 1 层宪法由 skill 系统自动注入，hook 不重复。旧版 `load-chain.sh`（config.json.before_prompt_build shell hook）在 2026.6.x 已失效，v0.64 起删除。

### 铁律为什么是 10 则（[Handbook §三](./HANDBOOK.md#三底线与铁律)）

每一条对应我日常使用 OpenClaw 时反复遇到的 Agent 失控行为——不是理论推演，是大半年的痛点积累：

| 问题 | 表现 | 对应的铁律 |
|------|------|:--:|
| 做完了没回复 | 子任务跑完了但没告诉用户 | #2 对用户有回应 |
| 出错继续跑 | 构建失败后 Agent 假装没看见继续下一步 | #3 验证再继续 |
| 不看文件就写 | 没读项目代码就开始改，越改越乱 | #1 先读再用 |
| 编造数据 | 不知道就编，被揭穿才承认 | #10 如实汇报 |

这 10 则源于 Andrej Karpathy 的 [4 条编码原则](https://github.com/multica-ai/andrej-karpathy-skills)（思考先行、简约至上、精准修改、目标驱动）。前 4 条是 Karpathy 的，后 6 条是我从自己的翻车经历里加的。不是学术框架，是实战反思的工程沉淀。

为什么叫「铁律」不叫「建议」或「指南」：`rules.md` 是你可以自己改的，`SKILL.md`（宪法内联） 是写死的——改了就没意义了。铁律兜底，rules 定制。铁律管住最常翻车的 10 种情况，你的 rules 只管你自己的特殊场景。这是「厚在治理」的核心——底线在那摆着，你不用每次重新立规矩。

### 四级编排深度（[Developer §二](./DEVELOPMENT.md#二编排哲学)）

编排越深，Agent 自主权越大——但也越容易失控。sofagent 的四级深度（完整编排 → 模板复用 → 轻量调度 → 自主执行）每一级都有明确的晋级和回滚条件。

为什么是四级？多一级太细、自主权差异感受不到，少一级太粗、放手太快容易失控。四级刚好覆盖了从「第一次跑这种任务」到「跑了 10 次以上闭着眼睛都知道怎么拆」的完整信任建立过程。

关键是回滚——每一级的放手都不是单向的，失败率回升就退回上一级，没有「一旦放手就收不回来」的设计。回滚用滑动窗口失败率（最近 5 次）而非连续失败次数：偶然失败不应触发回滚，趋势恶化才应该。

### Loop Agent：三节点顾问模式（[Developer §二](./DEVELOPMENT.md#二编排哲学)）

为什么用一个独立子 Agent 而不是在 task-closure 中内嵌逻辑？因为 Loop 不是只发生在任务结束时——执行过程中（子任务间、预算过半、重大操作前）同样需要停下来检查方向。

**设计**：
- 一个 Agent，三种模式（checkpoint / failure / closure），五个触发点
- 子任务间 + 60% 预算 + 重大操作前 = 三个主动暂停点
- 失败时自动诊断，闭环时统一收口

**为什么不设更多节点**：三节点覆盖了「阶段切换」「进度过半」「高风险」三种场景——不多不少。每次调用消耗 500-1000 token，两个节点就够大多数场景。

**为什么是独立 Agent 而不是代码逻辑**：因为 Loop 需要读 think.md（反思数据）+ task/logs（历史数据）+ orchestrator/（最优配置）做综合判断——这正是 Agent 的长项（语义理解、模式识别），不是脚本的长项。

**跨平台**：主 Agent 主动暂停调用——不依赖 Hook、不依赖代码拦截。OpenClaw / WorkBuddy / Codex / Hermes Agent / Claude Code 全平台通用。

<a id="session-boundary"></a>
### Session 边界：为什么用百分比而不是轮次

编排跑久了，上下文会满。主 Agent 持续监控两个指标：缓存占用 ≥50%，或 token 总量 ≥ 模型上限的 70%。任一超限即提醒用户「当前上下文比较长了，要不要开新会话？」

为什么用百分比？因为模型上下文窗口在持续变大——你今天 128K 能聊 30 轮，明年 256K 可能 60 轮才该切。百分比跟着硬件走，轮次限制是刻舟求剑。30% 的余量留给新 session 的加载链 + Skill + 任务本身。

**子 Agent 不参与这套机制。** 子 Agent 作用域窄（单子任务），设计上就是一个任务跑到销毁。如果子任务大到导致子 Agent 上下文溢出——那是编排拆得不够细，问题出在 ao compose 的任务拆分上。中间检查点已提供兜底。不搞子级反思、不拆分重开——子 Agent 脏数据隔离，别往它的短生命周期里塞复杂逻辑。

<a id="worktree-isolation"></a>
### 子 Agent 并行时的文件隔离：为什么是 git worktree

多个子 Agent 并行时，如果它们操作同一个代码仓库，文件冲突就是真问题。解决方式是 Worktrees（工作树隔离）：ao compose 拆任务时判断两个子任务是否涉及同一仓库 → 涉及的话，为每个子 Agent 创建独立 checkout → 子 Agent 在各自分支上改，谁也碰不到谁 → 完成后清理干净。

不涉及同一仓库的并行任务（比如一个写文档、一个查数据），直接用 session 隔离就够了。Worktree 不是全局默认——只在共享仓库场景下触发。为什么选 git worktree 而不是其他隔离方式？因为 sofagent 已经依赖 git（task/logs 可追溯），worktree 是 git 的原生能力，零额外依赖。

### ao compose 编排产物的位置

`ao compose` 生成的 YAML 编排文件存到 `.sofagent/orchestrator/workflows/`。这份 YAML 是 ao compose 和 Agent 之间的「合同」——定义了角色、任务分解、依赖关系和输入输出。跑 `ao run workflow.yaml` 时，ao compose 按这份合同调起子 Agent 执行。**YAML 是 ao compose 自己写出来的，用户不用手写的——看就行。**

ao compose 自带的 `agency-agents-zh`（215 个岗位）随 `npm install` 安装，不在项目里重复存储。

### 渐进式披露：索引卡片不是路由机制，是上下文策略

sofagent 的索引卡片——每张卡 5 个字段、控制在 500 字符以内——不是偶然。Anthropic 内部验证了同一个策略：主文件只告诉模型「这里有什么」，需要时再引导它读取完整实现。

三个好处：
- **省上下文**：Agent 不会一上来就被完整 Skill 淹没，先扫卡片再决定要不要加载
- **结构清晰**：卡片是目录，实现是正文，触发精准——不该管的 Skill 完全不占注意力
- **结构化表达**：sofagent 五要素（`description` + `triggers` + `scenarios` + `not_when` + 来源路径）恰好对应渐进式披露的三个阶段——叫模型知道（triggers + scenarios）、叫模型判断（not_when）、叫模型找到（来源路径）

### 不要写显而易见的事：Skill 写作的第一原则

sofagent 不内置 Skill 写作模板——不同任务需要的写作方式完全不同。但 Anthropic 内部有一条写作原则，和 sofagent 的「厚在治理，薄在复用」高度共鸣：**不写模型已知的常识，只写它在这个任务上会犯的错、会漏的步骤、会搞错的数据格式。**

一个 Skill 的信号强度不取决于「覆盖了多少」，而取决于「过滤掉了多少模型原本就知道的东西」。Gotcha 章节——记录过去最常踩的坑——比功能介绍有价值得多。这和 think.md 是同源设计：用反思驱动，不用常识灌水。

### 自然传播→收编：sofagent 信任机制的治理哲学

sofagent 的 Skill 信任等级（已验证 / 试用中 / 未验证 / 不推荐）和 Anthropic 内部的 Skill 治理模式是同一哲学的不同工程实现。

Anthropic 的做法：先让 Skill 在沙盒和 Slack 里自然传播，产生真实吸引力（attraction）后，再通过 PR 收编进插件市场——「先让价值跑出来，再正式收编」。sofagent 的做法：新 Skill 标 ⚠️ 进提案让用户确认，用 3 次以上且评分 ≥ 4.0 自动升级为已验证。

**两者共同的原则：不靠中心团队强管质量，靠自然使用筛选质量。** 区别在于 sofagent 目前跳过了「自然传播」阶段——Skill 直接从 ClawHub（全球 Skills 社区，OpenClaw 生态的 Skill 发现平台）进入四步集成流程。如果 ClawHub 未来支持「用户私下试用的非公开 Skill 区」，可以考虑加上这个传播→收编的环节。非中心化强管的逻辑不是不管，是先让价值自己证明自己。

<a id="trust-levels"></a>
Skill 信任等级的具体规则：

| 等级 | 条件 | 能接什么 |
|------|------|------|
| ✅ 已验证 | 你的评分 ≥ 4.0，使用 ≥ 3 次 | 任何子任务 |
| 🔶 试用中 | 社区评分 ≥ 4.0，还没用够 3 次 | 非关键子任务 |
| ⚠️ 未验证 | 社区评分 3.0–4.0，没用过 | 标 ⚠️ 放进提案，用户确认后再分配 |
| ❌ 不推荐 | 社区评分 < 3.0 | 过滤掉，不分配 |

升级/降级规则：每次闭环后 `skill-iterate` 自动评分 → 连续 3 次 ≥ 4.0 自动升级；连续 3 次 < 3.0 降回试用。门槛设这么高是因为 LLM 评分本身有波动——一次高分可能是运气，连续 3 次才可能是真材实料。

<a id="deepseek-choice"></a>
### 为什么选 DeepSeek（[Developer §三](./DEVELOPMENT.md#三模型最优选择)）

sofagent 默认推荐 DeepSeek。不是技术偏好，是两条底线决定的：

**第一，不碰 SaaS。** 如果模型提供商能看到你的 task/logs、你的 rules.md、你的 think.md（反思区）——那 sofagent 就不是治理层，是透明的。DeepSeek 提供 API 模式，数据不经过第三方平台。

**第二，成本可控。** 编排、反思、评分——这套 Loop 机制每次任务额外消耗 2,000–5,000 token。用 SaaS 按 seat 付费的话，成本不可控；用 DeepSeek API 按 token 付费，每次任务额外成本不到 1 美分。

模型选择是开放的——任何支持 API 的模型都能用。[Developer §三](./DEVELOPMENT.md#三模型最优选择) 提供了切换指南。

OpenSquilla 的基准测试给出了一组值得参考的数字：合理路由下相同任务成本可降至 1/9（$0.688 vs $6.233），质量持平（0.9251 vs 0.9255）。这不是说 DeepSeek 一定最便宜——是说不把模型当唯一 SKU、按任务分级的策略本身就能大幅压成本。

### Flash 干粗活、Pro 干细活：模型分级的成本逻辑（[Developer §三](./DEVELOPMENT.md#三模型最优选择)）

sofagent 不是绑死 DeepSeek 的——只是默认推荐。真正的设计决策是 **为什么不全部用最好的模型**。

Flash 和 Pro 差约 4 倍价，但查资料、写草稿这些简单任务，Flash 质量并不明显逊色。只有多步推理、数据分析才需要上 Pro。模型选择不是能力问题，是经济学问题：用 Pro 跑所有任务是浪费，用 Flash 跑复杂任务是省小钱吃大亏。

具体实现上，不是 Agent 主观判断——是 OpenClaw 的 `sessions_spawn.model` 参数，主 Agent 创建子 Agent 时一行参数搞定。模型分级不是「Agent 自觉」，是 API 级硬约束。

<a id="token-economics"></a>
### 编排开销的经济学：一次多花 3%，十次省回来

加了 orchestrator/ 和反思这套 Loop 机制之后，每次任务会比裸跑多消耗约 2,000–5,000 token——ao compose 拆任务、树形加载、闭环反思，加起来约占 128K 窗口的 2–4%。

为什么值得？因为这些额外的 token 花在了「让下一次跑得更好」上——沉淀最优拆法、记住踩过的坑、自动调整 Skill 信任等级。跑一次多花的 token，后面十次省回来了。

更关键的是 token 价格的长期趋势——2024 年初 GPT-4 API 还贵得让人犹豫，到 2025–2026 年同等能力的模型价格已降了几个数量级。趋势往下，就该按趋势设计，而不是按今天的价格缩手缩脚。每降一个数量级，编排开销的占比就缩一个数量级——成本顾虑会越来越小。

<a id="a-b-test"></a>
### A/B 测试为什么不是一次性评估

sofagent 的 A/B 测试不是「跑两次选更好的」——是 4 步渐进沉淀：同一类任务做 3 次以上 → 某种拆法连续 2 次复盘最高 → 标记为候选模板 → 再跑 2 次依然稳定 → 正式沉淀进 orchestrator/。

为什么这么保守？因为 LLM 的复盘本身有偏差（见下文「LLM 复盘的信任边界」）。一次高分可能是运气，连续高分才可能是规律。4 步中的每一步都在用增量证据对抗随机波动。这不是慢——是对 LLM 评估不确定性加的缓冲层。

模板不是焊死的。如果有新的拆分方式冒出来分数更高，就和现有模板再比一轮——赢了就替换。A/B 是持续进行的进化机制，不是一次性决策。

### 渐进初始化：为什么模板是单文件而非预建目录树

`scoring.md` 和 `orchestrator.md` 的模板描述了完整的树形目录结构（`研发/代码生成/skill-a.md`…），但部署时只有一个单文件——不是遗漏，是设计。

**两段式初始化**：安装脚本只创建根 `_index.md`（`scoring/_index.md`、`orchestrator/_index.md`），之后的枝叶由子 Skill 在运行时按需创建——`skill-iterate` 写 `scoring/{分类}/{skill}.md`，闭环流程（task-closure + loop-check）写 `orchestrator/{分类}/{任务}.md`。

三个理由：
1. **懒创建**：Agent 可能只用「研发」分类，不会预建 30 个空目录
2. **动态分类**：分类名由语义聚类决定，不绑死预设树——今天叫「研发」明天叫「工程」都不影响
3. **平台无关**：模板文件只描述格式协议，不要求平台预装目录结构。读不了目录树的平台（如纯 Web 版）一样能用——它需要的是「当创建叶子时用这个格式」，不是一棵现成的树

> 💡 这和「文件系统而非数据库」是同一个原则的延伸：不给 Agent 预建它可能用不到的结构。种子只需要描述格式，枝叶让运行时自己长。

### 复盘体系（[Developer §五](./DEVELOPMENT.md#五自进化机制)）

最早的 sofagent 只有六维评分。第七个维度「流程合规」是后来加上的——不是碰巧答对，是真的走了你要的流程。第八个维度「Loop 有效性」是 v4.5 加的——检查点到底帮上忙了还是只在浪费注意力。

sofagent 的 Loop Agent（闭环模式对标 skill-iterate）的复盘体系——执行和治理分离，Loop Agent 在 closure 模式下作为独立角色做复盘评估。区别在于 sofagent 不跑 RL 训练，而是靠独立角色 + 复盘 + 冷启动保护来做决策——没那么精确，但零训练成本。

还有一个隐含维度值得记录：**设计意图达成度**——Skill 的 `description` 和入口是不是写错了。Anthropic 内部发现触发量低常常不是需求少，而是 `description` 描述有误。sofagent 的 `skill-iterate` 目前只做正向评分（用了几次、打了几分），不做反向校验。**可补一条：Skill 连续 30 天零触发且评分 < 4.0 → 主动提醒审查 `description`。**

### LLM 复盘的信任边界（[Developer §五](./DEVELOPMENT.md#五自进化机制)）

复盘、权重计算、技能评估——这些判断全部由独立角色执行。同一组数据跑两次，分数可能差出 0.1 到 1 分，但相比主 Agent 自评，排除了编排者的确认偏误。

不追求「精确评分」，追求「趋势正确」。应对策略：

- **不看单次绝对值，看趋势**（最近 5 次的走向）
- **冷启动保护**——前 5 次只记录不做判断，第 6 次起进入正常「看趋势」模式
- **人工可覆盖**——你觉得评错了，直接改 orchestrator/ 里的记录

这些不是技术问题——是 LLM 评估的宿命。我们能做的是加足够的缓冲让偏差不酿成错误决策。

<a id="cold-start"></a>
### 冷启动保护：没跑够不妄下结论

新 Skill 装上、新任务类型出现——没有历史数据对照。前 5 次只记录，不做任何判断。第 5 次之后取综合分平均作为观察基线，第 6 次起进入正常「看趋势」模式。不是因为前 5 次的数据不可靠——是因为样本不够时，LLM 的评分波动会被放大成错误决策。冷启动不是保守，是给随机性加缓冲。

<a id="think-zone"></a>
### 反思区统一（[Developer §六](./DEVELOPMENT.md#六反思工程)）

sofagent 将教训和记忆合并为一个文件：think.md（反思区）。统一后，Agent 的错题和经历存储在同一个上下文中——降低了认知负担，避免了跨文件检索的 token 开销。

think.md（反思区）是「错题本」——同一个坑踩了 5 次，反思区里只有一条记录，置信度从 0.3 涨到 0.7。更新模式是覆盖而非追加——核心关注点从「记流水账」转为「提炼关键反思」。

<a id="weight-gate"></a>
### 活跃区权重门禁（[Developer §六](./DEVELOPMENT.md#六反思工程)）

反思产生的日摘要不是全进加载链的。中间加了一层筛选：只把权重 ≥0.5 的摘要放进反思区（≤2K token），其余丢进归档区。权重 <0.3 且超过 90 天的自动清理。

权重由三个信号自动计算：新鲜度（最近 7 天内使用过 +0.3）、反思关联（与 think.md 中某条教训有关 +0.3）、引用热度（近 5 次任务中被引用过 +0.1）。最高 0.7，门禁 0.5——意味着一条记忆必须有至少两个信号支撑才能进反思区。

设定这些数值的原则：不是追求精确，是追求「即使 LLM 算偏了 ±0.1，门禁依然有效」的安全边际。真正的安全阀不是权重计算，是反思区的 2K token 硬上限。

已归档的记忆在 30 天内不做二次评估——避免同一条记忆在反思区和归档区之间反复横跳，浪费 token。

<a id="self-correct"></a>
### 记忆自我纠正三道防线（[Developer §六](./DEVELOPMENT.md#六反思工程)）

think.md（反思区）既是产出（任务闭环后写入），又是加载链输入（下次启动读到）。写入出错会有连锁影响。三道防线：

**第一道：只存经验，不存指令。** think.md（反思区）只记「上次做了什么、踩了什么坑」，不记「你应该怎么做」。这条靠 LLM 自觉，工程上无法 100% 验证，所以加了一个自检——写入前扫描待写入内容，命中「应该/必须/不要/禁止/切忌」等指令性关键词 ≥3 处时提醒用户拆分到 rules.md。

**第二道：反思区 2K token 硬上限。** 即使反思评分出错、不良记忆涌入反思区——2K token 封顶，影响范围有限。不会出现一条错误记忆污染整个加载链。

**第三道：人工可清除。** 发现 Agent 行为异常时，第一步查 think.md（反思区），删掉可疑条目——相当于「清除坏记忆」，下次写入时那条记忆就没了。

sofagent 的失效标记机制（`[已失效] → 新事实 | 原因`，保留版本链不覆盖）直接来自这个设计。数据说话：79K token 的完整历史准确率 73.2%，筛选后的 9.6K token 准确率反而 83.6%——**更短的精准上下文 > 更长的冗余上下文**。这就是 sofagent 坚持反思区 ≤2K token 而不是全量加载的科学依据。

MAGMA（多图谱记忆架构，将记忆拆成语义/时间/因果/实体四个正交维度分别管理）的消融实验提供了另一个角度的验证：去掉时间维度，准确率跌 0.647；去掉因果维度，跌 0.644；去掉自适应策略，跌 0.637。**把记忆拆成多个独立维度分别管理，不是直觉，是实验验证过的工程必要。** sofagent 的 think.md（反思区，教训/因果 + 经验/语义）、task/logs（时间线）、orchestrator（实体/配置），恰好对应了这些维度的工程实现。

### 不要 Connector（[Developer §七](./DEVELOPMENT.md#七数据文件架构)）

Loop Engineering 的五大件之一是 Connector——连接外部系统（Jira、CI、监控等）。Osmani 举的例子是每天早上扫 CI → 开 Issue → 派 Agent 修 → 开 PR。

但 sofagent 是 Agent 治理层，不是软件工程自动化流水线。它的「外部世界」就是文件系统——task/logs、scoring/、orchestrator/、think.md（反思区）。这些 Markdown 文件已经构成完整的可审计闭环。

如果未来需要推到外部平台，写个脚本自动读最新 task/logs 推送就行。不建接口规范——文件就是接口，Markdown 就是传输格式。

### 文件系统而非数据库（[Developer §七](./DEVELOPMENT.md#七数据文件架构)）

Agent 治理层最核心的数据是 task/logs——每次任务跑完后一小段 Markdown 摘要。日积月累，每月几十条。

数据库听起来更专业，但选了文件系统。三个原因：

**无额外依赖。** `cat task/logs/2026-06-15.md` 就能拿到昨天的全部记录。数据库需要 SQL 能力、连接串、权限管理——每个环节都是出错点。

**天然可审计。** 怀疑 Agent 做错了决策？打开 task/logs 昨天的文件看一眼。不需要查 SQL、不需要连数据库客户端。`ls task/logs/` 就是审计入口。

**天然可传输。** 需要推到外部平台？`cat` → 推送，完事。数据库需要导出、转换、格式化。

额外好处：文件系统天然支持 Git。`git diff task/logs/` 看变化，`git log task/logs/` 追溯决策时间。

这套设计参考了生产级 Agent Memory 架构中的 **Ledger-Views-Policy 三件套**（原始记录→提炼视图→筛选策略的三层架构）：task/logs 就是 Ledger（原始账本，只追加不修改），think.md 反思区就是 Views（提炼视图），权重门禁和归档规则就是 Policy（控制策略）。三个层次各司其职——原始数据→提炼视图→策略筛选，每一步都可审计、可回退。

<a id="tree-loading"></a>
### 树形加载：为什么是树而不是平铺

约束文件（SKILL.md 等）几百字，全文加载没问题。但 orchestrator/、scoring/ 这些目录可能有几百条记录——全读到上下文里不现实。

所以数据文件用的是**树形目录 + 按需读取**：Agent 接到任务 → 读 `_index.md`（几十行，目录而已）→ 定位到具体分支 → 只加载那一个叶子文件（十几行）。整棵树可能有几百条记录，每次进上下文的只有目录 + 一个配置，总量不超过 100 行。

为什么不直接用平铺 + 索引？因为语义聚类是动态的——今天叫「研发」明天叫「工程」都不影响。树形天然支持渐进式披露：先看目录再决定读哪页，而不是把整本书塞进脑子里。task/logs/ 本身就是日期目录树，天然符合。think.md 单文件够用，保持不动。

这和「文件系统而非数据库」是同一个原则的延伸：文件是树，不是砖墙——你要的是找一片叶子，不是把整座森林搬进屋里。

---

<a id="known-limits"></a>

## 三、诚实坦白：已知局限

> 本节已独立为 **[LIMITATIONS.md](./LIMITATIONS.md)**——17 条已知局限、每条的「等什么」条件、平台分级能力表，全部在那里。
>
> 这里只留摘要，方便你判断要不要点过去看全文：

| 局限 | 一句话 | 等什么 |
|------|------|------|
| 治理层自身在上下文里 | 约束力 = Agent 注意力 × 平台加载可靠性 | 架构宿命，不可解 |
| [加载链步进脆弱性](./LIMITATIONS.md#加载链步进脆弱性v060v062-验证结论) | 非 OpenClaw 平台 Agent 可能跳过加载链 | 各平台支持 Hook 机制 |
| [复盘评分是 LLM 自评](./LIMITATIONS.md#复盘评分是-llm-自评评审者与执行者不分离) | 非 OpenClaw 平台评审者与执行者不分离 | v0.9 外部评估器 |
| Skill 自进化处于经验记录阶段 | 单次轨迹不可靠，会把噪声写成规则 | v0.9 验证门控 + v1.x 外部评估器 |
| 定时触发做不到 | 只有「每次对话启动」一种触发方式 | 平台支持 cron |
| B1 初始化依赖 bash | Windows / 受限沙盒可能没有 bash | Agent 自觉降级，无硬切换 |
| 中间检查点挂起 | 「暂停」需要 before_tool Hook | OpenClaw before_tool Hook |
| Skill 级动态 Hook 做不到 | Skill 运行时无法注册安全护栏 | OpenClaw 支持动态 Hook |
| 不是分布式系统 | 没有 agent-to-agent 通信 | v2.x router |
| 不是多用户系统 | 共享 .sofagent/ 会交叉污染经验 | v0.9 多用户隔离 |
| 数据明文存储 | task/logs / think.md 无加密 | v0.9 age 加密 |
| Skill 层 Slop（经验漂移） | 偶然成功会被当成经验 | 人工定期审计 |
| [平台依赖](./LIMITATIONS.md#平台依赖) | 自动触发 / Skill 加载 / 脚本执行因平台而异 | 各平台能力对齐 |
| 软层闭合清单执行率 ≠ 100% | Agent 可能跳过闸门检查 | 软层治理宿命，人工审计兜底 |
| [核心效果缺持续数据](./LIMITATIONS.md#核心效果未实测) | 11 Case 全是一次性测试，无持续使用 / A/B 对照 | 社区补持续使用 + A/B |

> 💡 其他文档引用已知局限时，统一指向 `LIMITATIONS.md` 对应锚点，不在各自文档里重复摘抄——改一处，全局生效。

---

## 五、行业研究启发与未来方向

> 以下方向来自 2026-06-20 行业研究笔记的学习总结，仅供后续版本设计参考。

本节内容（Loop Engineering 三道闸门对照、记忆系统三套规则、循环工程核心公式、存储策略对照等 ~200 行研究笔记）已拆分到独立文档：

**→ [docs/research/industry-insights.md](./docs/research/industry-insights.md)**

**核心方向速览**（详见独立文档）：
- **v0.8**：防雪崩说明 / Diagnosing Box 四维度排查 / 检查点定义 / daemon 定位升级（session 外触发器）
- **v0.9**：rules.md 升级为 Agent 运行规范 / 权限边界字段 / think.md 多重置信度标记 / 记忆系统三套规则
- **v1.x**：Skill 自进化验证门控（A/B 对比 + 外部评估器）
- **v2.x**：三种协作模式（主管/流水线/委员会）/ 信号共享网络

**两个原则性警告**（贯穿所有版本）：①「不要让智能体自我验证」——根治需 v1.x 外部评估器；②「Agent 越强，闸门越重要」——不可因模型能力提升而拆除控制机制。

---

## 六、参考与致谢

sofagent 站在这些人和作品的基础上：

| 来源 | 启发 | 链接 |
|------|------|------|
| **OpenClaw** | 运行平台——加载链、Hook、Skill 系统、session 隔离 | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **DeepSeek + GLM** | 模型引擎——本项目所有文件由 DeepSeek V4 Pro 和 GLM-5.2 配合生成 | [deepseek.com](https://deepseek.com) · [z.ai](https://z.ai) |
| **Addy Osmani** | Loop Engineering 五大件架构、语义化停止条件、三盆冷水 | [Loop Engineering 原文](https://addyo.substack.com/p/loop-engineering) |
| **Anthropic** | Managed Agents 四层架构（解耦脑和手、disposable worker、Agent≠Session、Loop>Prompt）——sofagent 核心设计哲学的源头 | [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) |
| **Codex / Claude Code** | 五层上下文压缩策略、决策冻结、增量笔记 | [codex.ai](https://codex.ai) |
| **循环工程深度解析** | 硬层/软层模型、Good Heart 陷阱、Skill 层 Slop、20 字设计总纲「硬层定义好，软层可进化。裁判碰不到，演化有人审」 | — |
| **agency-orchestrator** | `ao compose` 意图识别→任务图生成→模板匹配→分配（Apache-2.0） | [github.com/jnMetaCode/agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) |
| **Google Cloud AI Research / UIUC · SkillOS** | 执行与治理分离的技能治理框架——skill-iterate 的架构参照。执行器干活、治理器管技能库全生命周期 | [arXiv 2605.06614](https://arxiv.org/abs/2605.06614) |
| **MAGMA 多图谱记忆架构** | 四维正交图谱（语义/时间/因果/实体）、消融实验证明多维度记忆分离的必要性——sofagent 反思区统合（think.md）的实验级验证 | [arXiv 2601.03236](https://arxiv.org/abs/2601.03236) |
| **Google Skill 模式** | Tool Wrapper / Generator / Reviewer / Inversion / Pipeline 五种设计模式——Reviewer/Inversion/Pipeline 与 sofagent 铁律 #3「验证再继续」、task-aware 复杂度分级、ao compose 确认 Gate 形成映射 | [Google Cloud Tech](https://x.com/GoogleCloudTech/article/2033953579824758855) |
| **Andrej Karpathy** | 思考先行、简约至上、精准修改、目标驱动——铁律在此基础上扩展 | [4 条编码原则](https://github.com/multica-ai/andrej-karpathy-skills) |
| **Nelson F. Liu et al.** | *Lost in the Middle*（2023）——LLM 对长上下文中间段注意力衰减的研究，500 字原则和加载链顺序的科学依据 | [arXiv 2307.03172](https://arxiv.org/abs/2307.03172) |
| **Matt Pocock** | 调试方法论——输入/环境/工具/模型四维度系统性排查（Diagnosing Box），loop-check 验收闸的排查框架 | [github.com/mattpocock/skills](https://github.com/mattpocock/skills) |
| **徐远哲 · Ledger-Views-Policy 三件套** | Agent Memory 架构最小形态：Raw Ledger（权威账本）+ Derived Views（派生视图）+ Policy（控制策略）——sofagent 记忆架构（task/logs + think.md + 权重门禁）的理论参照 | [Agent Memory 架构思考](https://xuyuanzhe.github.io/blog/2026/agent-memory-architecture/) |
| **Microsoft Research · SkillOpt** | 把 Skill 文档当模型「外部状态」训练的方法论——rollout → reflect → edit → gate 四步循环。文本学习率 + Held-out Gate + 拒绝缓冲区三原则启发 sofagent v0.9 Skill 自进化（纯 MD + scoring 实现，不引入代码依赖） | [arXiv 2605.23904](https://arxiv.org/abs/2605.23904) |
| **Addy Osmani · Loop Engineering** | Loop Engineering 五大组件架构（Automations / Connectors / Worktrees / Skills / Sub-agents + Memory）、语义化停止条件、三盆冷水——sofagent 六件覆盖五件的对照参照 | [Loop Engineering 原文](https://addyo.substack.com/p/loop-engineering) |
| **多智能体成本研究** | 单 AI vs 多智能体成本差 15 倍，多智能体内部架构差异再差 10 倍——成本差 100 倍的底层逻辑。启发 v0.9 多智能体必要性评估 | [虎嗅：多智能体 AI 系统成本控制深度解析](https://www.huxiu.com/article/4868924.html) |

---

> 这份设计文档和 Handbook 一样，是开放的。如果你觉得哪个设计决策有问题，或者发现了我们没考虑到的局限——开 Issue，直接说。设计文档不应该是作者一个人的独白。
