# sofagent Limitations

> 诚实坦白：已知局限。这里不卖「企业级安全」或「军事级加密」——只写 sofagent 做不到什么、为什么做不到、等什么才能做到。
>
> v0.83 · 2026-06-22 · 孔放勋

---

<a id="known-limits"></a>

### 治理层自身在上下文里

sofagent 的核心机制是 MD 文件注入 Agent 上下文。这意味着：约束力 = Agent 的注意力 × 平台的加载可靠性。上下文窗口太小约束可能被截断；选择性忽略长文本（Lost in the Middle），中间铁律可能漏掉；约束机制依赖 Agent 配合——它必须"愿意读"。

我们选择了这个代价，因为它换来了：**零外部依赖、零进程管理、跨平台兼容、纯文本可审计**。

---

<a id="加载链步进脆弱性v060v062-验证结论"></a>

### 加载链步进脆弱性（v0.60→v0.62 验证结论）

**三层加载链在非 OpenClaw 平台上不可靠。** Agent 声称"跑了 sofagent"，实际可能只读了 1/3（宪法层被跳过）。

v0.62 的扁平化重构将宪法内联进 SKILL.md——第 1 层不再依赖 Agent Read，所有平台强制生效。但第 2、3 层（think.md + rules.md）仍靠 Agent 自觉，在 WorkBuddy / Codex / Hermes Agent / Claude Code 上存在"Agent 优先执行用户任务、跳过加载链"的行为。

实测数据：两轮 WorkBuddy 新会话测试，加载链命中率分别为 1/3 和 0/3。OpenClaw 侧通过内部 hook `sofagent-load-chain`（agent:bootstrap 事件）注入第 2、3 层，无此问题。

**用户侧缓解**：在复杂任务前加 `@skill:sofagent` 作为显式锚点，可提高 Agent 注意到约束的概率——但非强制保证。详见 HANDBOOK。根治需等各平台支持类似 Hook 机制。

---

<a id="复盘评分是-llm-自评评审者与执行者不分离"></a>

### 复盘评分是 LLM 自评：评审者与执行者不分离

闭环复盘的本质是让执行任务的同一个 Agent 对自己打分——评估者和被评估者是同一个人。上海 AI Lab 的 Self Harness 论文给出了方向性证据：**Agent 可以提议修改，但不能自己批准**。一旦自评，Agent 会收敛于「让验证变容易」而非「让结果变好」。

v0.62.2 起按平台分级处理，v0.63 进一步诚实化：

| 平台 | 实现方式 | 隔离级别 |
|------|------|------|
| OpenClaw | `session.spawn` 创建独立子 Agent，只传 task/logs 不传执行上下文 | 工程隔离，可类比引用 Self Harness 的方向性结论 |
| 非 OpenClaw | 主 Agent 重新 Read task/logs 作为评审主依据，执行记忆作辅助参考 | prompt 级约束，无机制保障，效果未实测——Agent 仍可能凭执行记忆污染评审 |

细节见 `loop-check.md` closure 模式。非 OpenClaw 路径不引用 Self Harness 的具体百分比数字——它没有工程隔离，引用会误导。

---

### Skill 自进化仍处于「经验记录」阶段

> ⚠️ 来自「Agent Skill 自进化机制深度研究」(2026-06-20)。

sofagent 的 `scoring/` + `think.md` 自进化机制当前处于**第一阶段：经验记录**。评分基于使用频率和单次任务表现——这正是学术界警告的「单次轨迹不可靠」问题：一次任务失败可能是环境异常或模型波动，不意 Skill 本身有问题。

三篇前沿论文描述了更高的阶段：

| 阶段 | 机制 | sofagent 现状 |
|------|------|------|
| **经验记录** | 记录单次成功/失败，调整评分 | ✅ 当前阶段 |
| **多轨迹归纳**（TRACE2SKILL） | 并行分析大量轨迹 → 提出补丁 → 合并去重 → 只留更通用的模式 | ❌ 缺：前 5 次冷启动保护仅缓冲，未真正归因 |
| **自验证闭环**（Evil Skill） | 多子 Agent 生成候选 Skill → 验证集 A/B 对比 → 只留表现更优的 | ❌ 缺：loop-check 是单次自评，无 A/B 对比 |
| **可训练参数**（Skill Opt） | 学习率约束编辑幅度 / 验证门控 / 负反馈缓冲 / 动量 | ❌ 缺：scoring 只是简单计数 |

**当前风险**：单次任务失败 → think.md 写教训 → scoring/ 降分 → 下次不用该 Skill。但这次失败可能只是模型波动——长期如此会把噪声写成规则。

**现有防御**：冷启动保护（前 5 次只记录不判断）+ LLM 自评权重 ×0.3。但这些只是缓冲层，不是解决方案。根治需要独立验证环（见 ROADMAP v0.9 验证门控 + v1.x 外部评估器）。

---

### 定时触发做不到

Loop Engineering 的标志性场景是「每天早上 8 点自动扫 CI」。sofagent 目前只有「每次对话启动」这一种触发方式。OpenClaw 不支持 cron 级定时任务。

短期替代：Agent 任务闭环后自查 task/logs，上次执行某周期性任务已超过阈值时主动提醒用户。但不是真正的定时循环——依赖用户回应。

**等什么**：OpenClaw 或 WorkBuddy 支持 schedule/cron 触发。

---

### B1 数据初始化依赖 bash

SKILL.md B1 步用 bash heredoc 创建 `.sofagent/` 数据目录和核心文件。OpenClaw / WorkBuddy / macOS/Linux 默认有 bash，但 Windows 或受限沙盒环境可能没有。

降级路径已内置：bash 不可用时，Agent 降级为逐条 `mkdir` + 逐文件 Write 工具创建（SKILL.md B1 已标注）。需要 Agent 自觉识别平台并切换路径——没有 Hook 级硬切换。

---

### 中间检查点挂起

中间检查点设计：子 Agent 超标 → 暂停 → 主 Agent 三问评估（继续/停止/回滚）。「暂停」需要 OpenClaw `before_tool` Hook 拦截工具调用，当前不支持。

现阶段靠 `tools.loopDetection` 兜底——能检测死循环并硬停止，做不到「暂停→三问→继续」的精细控制。

防御体系设计参考了 Agent 死循环防御的**三层过滤网**模型：物理红线（步数限制→`globalCircuitBreakerThreshold`）→ 逻辑感知（ATM 重复检测→`genericRepeat`/`pingPong`）→ 人工兜底（任务挂起→中间检查点）。三层不是相互替代，是逐级兜底。

**等什么**：OpenClaw `before_tool` Hook。

> 📊 这个防护体系不是过度设计。Writer 2026 年初调查显示：35% 的公司无法有效关停失控的 Agent，97% 高管称已部署 AI Agent 但实际回报率仅 29%。sofagent 的三层过滤网每层都对应一种实际失控场景——要解决的是「用了 AI 之后谁来管、怎么管」。

---

### Skill 级动态 Hook 做不到

Anthropic 内部 Skill 支持按需注册动态安全护栏——比如生产环境操作前临时注册危险命令拦截器（`carfoo` 类 Hook），调试时限制文件修改范围（`freeze` 只允许改特定目录）。本质是让 Skill 不仅指导模型「怎么做」，还能在执行过程中**动态添加安全护栏**。

sofagent 目前没有这个能力：Hook 是 OpenClaw 配置层的静态设置，Skill 运行时无法动态注册。现阶段 Skill 的安全约束只能靠静态 rules.md + OpenClaw `tools.loopDetection` 兜底。

**等什么**：OpenClaw 支持 Skill 级动态 Hook，或者 sofagent 在 Skill 入口分发器层面实现自己的沙盒层。

---

### 不是分布式系统

sofagent 跑在单个 Agent 里——没有 agent-to-agent 通信，没有多实例协调，没有分布式状态管理。子 Agent 是 OpenClaw 的 session 隔离，不是真正的独立 Agent 进程。

需要 10 个 Agent 并行协作、共享状态、相互通信的场景——不适合。

---

### 不是多用户系统

sofagent 跑在单个 Agent 里，.sofagent/ 是单用户工作目录。如果多用户共享同一 .sofagent/（比如团队共享仓库），一个人的错误反思会通过 think.md 污染所有人的判断。这不是 bug——是单 Agent 设计和多用户使用之间的天然冲突。

多用户场景建议：每人独立 .sofagent/（每人独立工作目录），或等 v0.7x 的多用户方案。

---

### 数据明文存储

task/logs 和 think.md 以明文 Markdown 存储任务记录和反思摘要，可能含代码片段、API 响应、用户对话摘要。LLM 提炼反思时可能无意写入敏感信息。当前无加密、无脱敏、无数据保留策略。企业环境使用前需评估数据合规风险，或等待 v0.7x 企业级方案（见 Roadmap）。

---

### Skill 层 Slop：经验漂移

软层（scoring.md + think.md）在循环中持续自我修订，会引入一个隐蔽风险：**经验漂移**。某次任务偶然成功（比如网络抖动恰好恢复），Agent 可能把「先重启再部署」当成成功经验写进 think.md。这种迷信仪式不会立刻坏事，但会缓慢漂移——三个月后经验库里一半是不可复现的噪声。

sofagent 的应对：think.md 的置信度渐进（0.3→0.5→0.7）和 30 天无触发衰减，本身就是对迷信仪式的过滤器——靠单次巧合涨不到高置信度。但更根本的解法是定期审计——翻 task/logs 对照 think.md 的反思来源，把偶然成功标记剔除。这是人要做的事，自动化做不到。

---

<a id="平台依赖"></a>

### 平台依赖

核心约束（SKILL.md（宪法内联）/ rules.md）是纯 Markdown，任何能读文件的平台都能加载。但自动触发、Skill 加载、脚本执行——取决于平台。install.sh 已做平台抽象（`--platform` 参数），自动探测并适配部署目标。

| 能力 | OpenClaw | WorkBuddy | Codex | Hermes Agent | Claude Code |
|------|:--:|:--:|:--:|:--:|:--:|
| 核心约束 | ✅ Hook注入 | ✅ SKILL加载 | ⚠️ 种子指令 | ⚠️ 种子指令 | ⚠️ 种子指令 |
| Skill 自启 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 加载链脚本 | ✅ 内部 hook（sofagent-load-chain） | ❌ 无Hook，C步Read替代 | ❌ | ❌ | ❌ |
| 断路器 | ✅ loopDetection | ❌ 平台自有 | ❌ | ❌ | ❌ |
| 脚本执行 | ✅ | ⚠️ bash可用 | ✅ | ✅ | ✅ |
| 定时触发 | ❌ | ❌ | ❌ | ❌ | ❌ |
| install.sh | ✅ 完整部署 | ✅ 自动跳过 | ⚠️ 仅宪法+种子 | ⚠️ 仅宪法+种子 | ⚠️ 仅宪法+种子 |

> 💡 加载链跨平台说明（v0.64 适配 OpenClaw 2026.6.x 内部 hook 架构）：
> - **第 1 层（SKILL.md 含宪法）**：所有平台由 skill 系统自动注入，强制生效
> - **第 2、3 层（think.md + rules.md）**：OpenClaw 由内部 hook `sofagent-load-chain`（agent:bootstrap 事件触发）注入；其他平台由 Agent 主动 Read
>
> 概念（三层约束按序注入）跨平台通用，机制（skill 注入 + Hook 兜底 vs 纯 skill 注入 + Agent Read）按平台分级。第 1 层全平台强制，第 2、3 层 OpenClaw 强制、其他平台君子协定。

---

### 软层闭合清单的执行率不是 100%

SKILL.md 的回复前闸门（⓪①②）和闭合清单（②→③→④→⑤→⑥）由 Agent 自觉执行——没有 Hook 级的硬拦截。在连续快速操作（如多文件批量修改）中，Agent 注意力可能跳过检查。

这不是设计缺陷，是软层治理的宿命：硬层管底线，软层（scoring.md + think.md + orchestrator）靠循环进化，但不能指望 100% 执行率。应对：
- **硬层兜底**：rules.md 中写一条「回复前必过闸门」的硬约束，利用 rules.md 在三层加载链中优先级最高的特性增加执行概率
- **结构加固**：将闸门从 §一 末尾提到入口流程 D 之后，增加 `⛔ 硬出口` 节（见 SKILL.md），利用 Lost in the Middle 效应——越靠前的指令 Agent 越不容易漏。v4.5 进一步拆为主 Skill + 五个子 Skill（engine/entry-gate/task-aware/task-closure/loop-check），每个 ≤90 行，Agent 不再迷路
- **人工审计**：定期翻 task/logs 检查闭合清单是否每次都被执行——这和 Skill 层 Slop 审计是同一个人工兜底策略

> 💡 **设计妥协：MD 强约束对标 Hook 机制**。sofagent 的三层闸门在概念上对标 Cloud/Agent 的 Hook 机制——回复前闸门 ⓪ = pre-tool-use（工具调用前检查），task-closure ②→⑤ = post-tool-use（任务结束后自动沉淀），闭环信号 = stop event（任务完成触发）。但受限于跨五平台兼容性（WorkBuddy/Codex/Hermes/Claude Code 不支持 Shell 级 Hook 拦截），这些只能通过 MD 强约束 + ⛔ 硬出口 + 兜底检查来模拟 Hook 行为。只有 OpenClaw 平台通过内部 hook `sofagent-load-chain`（2026.6.x）实现了真正的 Hook 级注入。

---

### 核心效果未实测

本项目核心宣称（越用越聪明、纪律性提升）已有 11 个实测 Case（含第三方，见 [docs/EVIDENCE.md](./docs/EVIDENCE.md)），但全部为一次性测试，缺乏持续使用 ≥1 周的样本和 A/B 对照数据。v0.75 首轮 benchmark 已跑（4/10 约束层 PASS），对比侧因单会话自测限制标记为「无法自测」——完整的带/不带对比数据仍待社区补充。

---

> 这份局限文档和 [设计文档](./ARCHITECTURE.md) 一样，是开放的。如果你发现了我们没列出来的局限——开 Issue，直接说。已知的坑不怕多，怕不知道。
