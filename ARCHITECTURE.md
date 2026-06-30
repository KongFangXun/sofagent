---
tags: [架构, Ralph循环, git-diff, 审计, OODA, 状态外化, prompt工程, 双引擎, 审计引擎]
---

# sofagent Architecture

> 一个只懂点前端代码的产品经理，在设计 Agent 纪律层时都想了些什么。这里只写设计决策、权衡取舍、已知局限，以及为什么故意不做某些事。各节按 Handbook 章节顺序排列，方便对照。
>
> > v0.98 · 2026-06-30 · 孔放勋

<img src="images/sofagent.png" alt="sofagent" width="300" />

---

## 一、为什么会有 sofagent

AI 工程方法一直在往前走：Prompt Engineering 解决「怎么对 AI 说话」，Context Engineering 解决「AI 应该知道什么」，Harness Engineering 解决「AI 在什么约束下跑」。

到了这一步，剩下一个没人管的问题：**谁来按回车？**

Agent 跑完任务后，谁来告诉它「下一个任务是什么」？谁来确认「上一个任务做对了吗」？谁来记录「这次踩了什么坑下次别踩」？

纪律层解决的就是这个问题——Agent 跑完任务之后，不是等着人验收，而是自己完成「拆解→执行→验证→复盘」的完整闭环。sofagent 不跑你的任务，它管跑你任务的 Agent。

> sofagent 的架构基因来自 Geoffrey Huntley 的 Ralph 循环——「Agent 失忆，文件不失忆」。Agent 的记忆长在文件系统（git diff / task/logs / SKILL.md），不长在 Agent 内部。审计层优先信任 git diff（硬证据），不信任 Agent 日志（软证据）。sofagent 是 Ralph 范式的纪律层实现。
>
> 2026 年 6 月，Loop Engineering 由 Addy Osmani 正式命名并在博客发表后，经 Peter Steinberger、Boris Cherny 等人在 X 上传播，迅速成为行业共识。Ralph 范式被列为 Loop Engineering 的前期基础——Huntley 一年前在博客里提的做法，现在成了全行业的方向。

> **三元原语的交叉验证**：Ralph Loop 和 Karpathy AutoResearch 完全独立地收敛到同一底层范式——**可编辑资产 → 单一衡量标准 → 定时循环迭代**。这是同一范式在工程（Ralph）和科研（Karpathy）的两种落地形态，构成 sofagent 三层加载链设计的外部交叉验证。
>
> ⚠️ v0.98 起，sofagent 的架构核心从 Ralph 循环转向双引擎（审计引擎 + 编排引擎）。Ralph 范式仍然是审计层设计的历史基因，但不再是产品架构的中心叙事。

> 🤔 「纪律层」不是什么新造的词——Palantir CEO 卡普在 2026 年 CNBC 三小时访谈中讲得很清楚：大模型本身不值钱，值钱的是「从模型到业务、到执行、到责任的全链路闭环」里的系统能力。AI 落地真正缺的不是更强的模型，是有人确保 Agent 按规矩干活、出错了能追溯、交付了能验货。sofagent 做的就是这个——Agent 的纪律层，不是 Agent 的替代品。

> 🧬 **硬层定义好，软层可进化。裁判碰不到，演化有人审。** 硬层（SKILL.md + fde.md）Agent 绝对不能碰；软层（scoring.md + think.md + orchestrator/）是数据不是代码，在客观验证信号下持续进化。

### 两层架构：地基 vs 引擎

> 💡 **与双引擎的关系**：下文所述「地基」（三层加载链）是双引擎共享的上下文层，「引擎」（编排）对应双引擎中的编排引擎。审计引擎（git diff 事后检查）不在本文描述范围内——详见 [DEVELOPMENT.md](./DEVELOPMENT.md) §八。

sofagent 分两层——地基轻、引擎重，这是有意为之：

| 层 | 是什么 | 何时激活 | 占用 |
|:--:|------|:--:|:--:|
| 地基 | 三层加载链（宪法+反思+fde）| 每个会话启动，永远在线 | 上下文预算的 2-3% |
| 引擎 | 任务编排（拆解+Loop+闭环）| 🔴 复杂任务才点火 | 额外 ~1% （首次） |

地基是整个会话的前提（宪法、反思、偏好常驻上下文），引擎是任务级别的工具（只在 🔴 复杂任务时激活）。

<a id="why-resident"></a>
如果加载链只在复杂任务时才激活：

| 缺失的文件 | 后果 |
|------|------|
| think.md 反思区不在上下文 | Agent 不知道上次踩了什么坑，重复犯错 |
| fde.md 你的规则不在上下文 | 简单任务时你的偏好全部失效 |
| 只有 SKILL.md 底线 | 底线能用但行为规范丢失 |

治理底座必须永远在线，不管任务简单还是复杂。

<a id="fde-architecture"></a>
### 产品架构展望（五层）

最终形态是五层，每层独立验证，下层为上层的底座：

| 层 | 部署在哪 | 干什么 | 当前状态 |
|:--:|------|------|:--:|
| **纪律层** | Agent 上下文 | 纯 MD 文件（SKILL.md + think.md + fde.md），Agent 读即生效 | ✅ 已可用 |
| **执行层** | 用户设备 | daemon 常驻进程——跨 session 经验不丢失、定时清理 | ✅ v0.81 |
| **审计层** | git 仓库 | sofagent-audit——提交时审计 git diff，不依赖 Agent 运行时配合 | ✅ v0.92 |
| **MCP 推送层** | 设备 MCP server | 文件监听 + 主动推送——任务完成直接推到企业协作平台 | v1.0 规划 |
| **协同层** | 多设备 + 云端 | 多设备任务分发 + 联邦治理 | v2.x 规划 |

**这五层不是随便分的**——麦肯锡 2026 年 6 月的「AI-Native 时代新三角色」框架（Technologist/Scientist/Strategist）提供了一个结构类比：纪律层定义 Agent 行为的数据底座（T），反思闭环发现规律（S），编排层做决策（St）。后面的执行/审计/协同层是这三种能力在设备和企业级的延展。但不追求严格对应——五层是工程产物，不是理论模型。

每层跑通再加下一层——不推翻已验证的东西。

### AI 中台三难与 sofagent 五层对应

| AI 中台三难 | sofagent 对应层 | 怎么解 |
|------------|----------------|--------|
| 接入难 | 执行层 + MCP 推送层（规划中） | daemon 常驻 + MCP server 桥接企业平台 |
| 信任难 | 审计层 | git diff 确定性审计，exit code 可集成 CI |
| 沉淀难 | 纪律层（反思区 + task/logs） | 经验在文件系统，FDE 走了不带走 |

sofagent 不替代 AI 中台——它是 AI 中台里 Agent 治理那一层的纪律底座。模型层、编排层、基础设施层不在范围内。

<a id="audit-evidence-layering"></a>
### 审计层的证据分层：信任产出，不信任过程

审计层（sofagent-audit）的核心设计决策来自三个独立来源的收敛——Geoffrey Huntley 的 Ralph Loop「Agent 失忆，文件不失忆」哲学、MiroFish 开源项目的「工具调用与最终答案严格分离」模式，以及 Palantir 卡普的「99.9% 确定性刚需」二分法。三者指向同一个结论：**git diff 是最终答案（硬证据），Agent 日志是工具调用过程（软证据）。**

| 证据源 | 依赖 Agent 配合 | 可绕过 | 判定精确度 |
|------|:--:|:--:|:--:|
| git diff（硬证据）| ❌ 不依赖 | ❌ 不可绕过 | 高——改了什么、几个文件、改了多少行 |
| Agent 日志（软证据）| ✅ 需要 Agent 写入 | ✅ 可伪造 | 中——记录了过程，但真实性无法自证 |

**设计后果**：

1. `--silent` 模式（v0.94）只跑纯 git-diff 规则——任何 git 仓库都能跑，零依赖 Agent 配合。对应 MiroFish 的「只看最终答案」。
2. 完整模式同时跑两种证据，交叉对比差异——如果 silent 发现 full 漏了，说明 Agent 日志有问题。对应 MiroFish 的「双平台并行模拟」。
3. 新规则的优先级：先加 git-diff 规则（敏感文件 / 源码改测试没动 / 超大无注释），再给旧规则打日志回退补丁。

这层设计的底线：**审计工具在零 Agent 配合下仍然有判定能力。** Agent 日志让审计更精确，但没有日志审计不失效。

<a id="audit-ooda"></a>
#### OODA 审计决策环

审计层的判定逻辑映射 OODA 模型：

| OODA 阶段 | 审计对应 | sofagent 实现 |
|-----------|---------|--------------|
| Observe（观察） | 采集证据 | git diff 解析 + Agent 日志读取（可选） |
| Orient（定向） | 规则匹配 | A1-A11 规则逐条比对（A9 prompt injection、A10 供应链检测 v0.97 实现；A11 资源耗尽推迟到 daemon 运行时——git diff 检测不到） |
| Decide（决策） | 判定 exit code | PASS(0) / WARN(1) / FAIL(2) |
| Act（行动） | 输出结果 | 终端报告 + --ci 提醒 + --json 结构化输出 |

这对应 Loop Engineering 的「Human in/on/out of the loop」：PASS = out of the loop（放行），WARN = on the loop（提醒但不阻断），FAIL = in the loop（必须人工介入）。

<a id="design-principles"></a>
### 四条设计原则

来自 FDE Agent Harness、Loop Engineering、MCP 扩展架构三篇行业笔记（2026-06）：

1. **「吃下痛苦，排出产品」**（Palantir CTO 卡普）<br>
   Agent 的管理痛苦——过程不可信、结果不可审计、经验不沉淀——由 sofagent 消化，产出企业敢放进流程里的纪律层。不把这些痛苦原样还给用户。

2. **「模型输出是提案，不是命令」**（FDE Agent Harness 笔记）<br>
   Agent 的每次代码改动是一份**提案**，git diff 是**证据**，审计工具对照铁律**验收**，不合格的提案**拒收**。这跟 MiroFish 的「工具调用与最终答案分离」是同一个设计基因。

3. **「先有掌控感，再自动化」**（Harness 设计笔记）<br>
   install → verify.sh 确认约束生效 → 用户拥有了对 Agent 行为的掌控感 → 然后才能放心把任务交给编排引擎。这条原则解释了为什么 sofagent 的安装流程必须包含 verify 步骤——不是技术需要，是心理需要。

4. **「状态最贵」**（Ralph Loop 哲学）<br>
   Agent 的上下文窗口是有限预算，不是无限文件夹。纪律层总占用承诺不超过窗口的 5%（当前约 2.5%）。每多塞一段不必要的上下文，就少一段留给任务的空间。sofagent 的三层加载链 + 编排引擎都是在「最少上下文占用量」约束下设计的——用文件外化状态，用 git diff 替代 Agent 记忆。

<a id="skill-runtime"></a>
### 为什么是 Skill + 脚本 + Runtime，不是纯 Skill 或纯代码

一条任务下来，三样东西各司其职：

| 什么事 | 谁来做 | 为什么 |
|------|------|------|
| 判断（评分、反思、选模板、拆任务） | Skill（MD prompt 文件） | LLM 的长项——模式识别、定性判断、语义理解 |
| 机械操作（文件读写、API 调用） | 脚本（bash） | 确定性操作——复制、拼接、curl、计数 |
| 硬安全（加载链、断路器、死循环检测） | OpenClaw 原生配置 | Agent 失控时没法自己管自己，必须在外部兜底 |

LLM 管判断、脚本管执行、Runtime 管刹车——天然的分界。

> **编排引擎 v0.97 拆出**：编排引擎（engine.md / task-aware.md / loop-check.md）从 sofagent 核心拆出，定位为 FDE 部署场景专用——个人开发者不需要编排，只装纪律层就够了。entry-gate.md + task-closure.md 留在核心（所有平台需要的轻量检查）。编排深度从四级简化为两档拆解（拆 vs. 不拆）——FDE 场景下 workflow 节点粒度已确定，不需要渐进减薄。

> sofagent 的编排引擎（entry-gate → task-aware → task-closure 三道闸门）对应 Addy Osmani 在 Loop Engineering 中提出的「Go Mode」——当任务满足触发条件时，从「人工确认每一步」切换到「Agent 自主循环 + 检查点兜底」。sofagent 的 Go Mode 触发条件更保守：仅 🔴 复杂任务才点火，不像 Loop Engineering 原版那样对中等复杂度也自动启动。

### 为什么 OpenClaw 是唯一底座

选 OpenClaw 三个理由：开源 + Node.js（技术栈一致，深度集成）、原生编排（AO compose 拆解 → DAG 执行）、Agency Agent 兼容（同一开发者，233 个岗位模板直接对接）。

设备上安装 OpenClaw 后，任意 Agent（WorkBuddy、Claude Code、用户自选）都能被作为 sub agent 调度。固定 workflow 节点只需首次 AO compose 编排 + Agency Agent 注入模板，之后每次开启新 session 复用即可。

#### 技术选型演进：bash → Node.js/TypeScript

bash 在纪律层阶段是对的（零依赖、透明、exit code 判断），但到了设备/审计/协同层是错的工具。纪律层保持 bash，执行层/审计层/协同层迁移到 Node.js/TypeScript——提供类型安全，避免 JSON 状态文件和 git diff 解析时的运行时错误。触发条件：bash 脚本数 > 20 或同一脚本重构次数 > 3。

<a id="white-box-loop"></a>
### 白盒循环：为什么不在 `/goal` 原版上直接跑

Claude Code 的 `/goal` 是纯黑盒——目标给出去后 Agent 闷头跑，方向歪了交回来的不是想要的。sofagent 把黑盒变成白盒。MOI 自动化项目（2026 年 6 月落地）的架构证实了这个方向是对的：云端只负责规划、Codex 在隔离 work tree 中实现、主工作区只在用户确认后才被修改——权责分离、有纪律的代码生成。sofagent 的 entry-gate → task-aware → task-closure 三道闸门遵循了同样的「规划/执行/审核」三层隔离设计。

| 我加的 | /goal 原版 | 为什么 |
|------|------|------|
| 用户确认 | 循环自主跑到底 | 只懂点前端代码的人不敢让它黑盒跑——先看一眼提案再执行 |
| 硬层/软层分离 | 没明确切分 | SKILL.md 是硬层，Agent 碰不了；scoring.md + think.md 是软层，Agent 自己进化 |

白盒的关键不是加了确认按钮，是**用户和 Agent 一起把目标定清楚，再启动编排**。

### 文档膨胀控制

四份核心文档有硬性行数上限：Handbook ≤500 行 / Developer ≤600 行 / Design ≤600 行 / README ≤250 行。新增章节前必须先删一段旧内容——"加了就得减一点"。文档膨胀会让 Agent 上下文变重，也会让用户读不下去。

### 模型与 Harness 的博弈

模型会吃掉一部分 Harness——任务拆解、上下文选择、工具调用，这些能力模型自己越来越强。但生产级 Harness 从「外部脚手架」升级成「生产级 Agent 运行的底座」。模型决定能想到哪步，Harness 决定能不能把事情做完。Agent 越强，闸门越重要。

> sofagent 自身的开发过程就是 Ralph 循环的活体验证——两个模型（GLM + DeepSeek）自循环 loop：GLM 定框架 → DeepSeek 写实现 → GLM 审查 → DeepSeek 修复 → 下一轮。10 天 17 个版本，在传统软件工程里是灾难信号，在 AI Loop 语境下恰恰是产品价值的证据。

---

## 二、核心设计决策

> 一个只懂点前端代码的人做的设计决策——有疑问直接开 Issue，我大概率说不过你。

<a id="500-char"></a>
### 500 字原则（[Handbook §一](./HANDBOOK.md#一厚在治理薄在复用)）

加载链里的每份文档——SKILL.md、fde.md——都有一个硬上限：500 字以内。超过 500 字 Agent 遵守率明显下降——规则在长文本里会被淹没，Agent 只挑它「看到」的几条遵守。加载链确保每层文件都落在模型的「开头注意力区」内——最后加载的（fde.md）优先级最高。

> 💡 500 字原则和「文件系统而非数据库」是同一枚硬币的两面——都是把信息密度做到极致。Google Cloud Code 指令管理指南从另一角度验证了这点：开头不仅是注意力优先区，也是上下文压缩时的保留区——压缩后这 500 字大概率还在，其他内容可能被裁。所以 500 字不只是「让 Agent 好好读」，更是「让 Agent 在被压缩后还能读到」。

> **污染理论**：agents.md 的每个字节在每次 Loop 中被反复消耗——一份臃肿的 agents.md 会污染未来每一轮的上下文。500 字原则不仅省 token，更是「降低所有未来 Loop 的持续污染成本」。agents.md 是出厂说明书，不是流水账。

### 三层加载链：为什么是这个顺序（[Handbook §二](./HANDBOOK.md#二三层加载链)）

从契约到执行，三层按「能不能改」分级：

| 层 | 文件 | 权限 |
|:--:|------|:--:|
| 1 | 契约层（`SKILL.md`（宪法内联）） | ❌ 千万别碰 |
| 2 | 反思层（`think.md`） | ⚠️ 自动生成，改了没用 |
| 3 | 执行层（`fde.md`） | ✅ 随便改 |

加载顺序受 Lost in the Middle 约束：SKILL.md 放最前面（开头注意力最高），fde.md 放最后面（末尾注意力最高）。技术实现用 OpenClaw hook 架构——声明式注册 `sofagent-load-chain` 监听 `agent:bootstrap` 事件。

### 铁律为什么是 6 则（[Handbook §三](./HANDBOOK.md#三底线与铁律)）

每一条对应日常使用中反复遇到的 Agent 失控行为——不是理论推演，是痛点积累。v0.95 将 4 条有 git diff 痕迹的铁律移至审计层（A3/A5/A7/A8），铁律只保留纯行为准则：

| 问题 | 表现 | 对应规则 |
|------|------|:--:|
| 做完了没回复 | 子任务跑完了但没告诉用户 | #1 对用户有回应 |
| 越界改代码 | 改了不在任务范围内的文件 | 审计 A3 不改越界 |
| 出错继续跑 | 构建失败后 Agent 假装没看见继续下一步 | 审计 A8 不逃验证 |
| 不看文件就写 | 没读项目代码就开始改，越改越乱 | 审计 A7 不存盲改 |
| 编造数据 | 不知道就编，被揭穿才承认 | 审计 A5 不瞒真相 |

前 4 条源于 Andrej Karpathy 的 [4 条编码原则](https://github.com/multica-ai/andrej-karpathy-skills)，后 2 条是实战翻车经历的工程沉淀。`fde.md` 是你可以自己改的，`SKILL.md`（宪法内联）是写死的——铁律兜底，rules 定制。

### 编排引擎：两档拆解（[Developer §二](./DEVELOPMENT.md#二编排哲学)）

> v0.97 编排引擎从核心拆出：四级编排深度（完整编排 → 模板复用 → 轻量调度 → 自主执行）→ 两档拆解（拆 vs. 不拆）。FDE 场景下 workflow 节点粒度已由 FDE 梳理确定，不需要渐进减薄。编排引擎（engage.md）定位为 FDE 专用能力——个人开发者直接跳过。

### Loop Agent：三节点顾问模式（[Developer §二](./DEVELOPMENT.md#二编排哲学)）

Loop 不是只发生在任务结束时——执行过程中（子任务间、预算过半、重大操作前）同样需要停下来检查方向。

**设计**：一个 Agent，三种模式（checkpoint / failure / closure），五个触发点。三节点覆盖了「阶段切换」「进度过半」「高风险」三种场景——不多不少。

**为什么是独立 Agent 而不是代码逻辑**：Loop 需要读 think.md（反思数据）+ task/logs（历史数据）+ orchestrator/（最优配置）做综合判断——这正是 Agent 的长项（语义理解、模式识别），不是脚本的长项。

**跨平台**：主 Agent 主动暂停调用——不依赖 Hook、不依赖代码拦截。全平台通用。

<a id="session-boundary"></a>
### Session 边界：为什么用百分比而不是轮次

主 Agent 持续监控两个指标：缓存占用 ≥50%，或 token 总量 ≥ 模型上限的 70%。任一超限即提醒用户新开会话。

为什么用百分比？因为模型上下文窗口在持续变大——百分比跟着硬件走，轮次限制是刻舟求剑。

**子 Agent 不参与这套机制。** 子 Agent 作用域窄（单子任务），设计上就是一个任务跑到销毁。如果子任务大到导致子 Agent 上下文溢出——那是编排拆得不够细。

<a id="worktree-isolation"></a>
### 子 Agent 并行时的文件隔离：为什么是 git worktree

多个子 Agent 并行操作同一代码仓库时，文件冲突是真问题。解决方式是 Worktrees：ao compose 拆任务时判断是否涉及同一仓库 → 涉及的话为每个子 Agent 创建独立 checkout → 完成后清理。

Worktree 不是全局默认——只在共享仓库场景下触发。选 git worktree 因为 sofagent 已经依赖 git，worktree 是 git 的原生能力，零额外依赖。

### ao compose 编排产物的位置

`ao compose` 生成的 YAML 存到 `.sofagent/orchestrator/workflows/`——定义角色、任务分解、依赖关系。**用户不用手写，看就行。**

### Session 生命周期：为什么需要关闭重开

企业 workflow 中的固定节点 Agent 会反复执行同类任务，session 越滚越长会导致上下文爆炸和记忆混乱。解决方案：每次任务完成（或每 N 小时）触发记忆蒸馏——提炼关键决策 + 踩过的坑 → MCP server 持久化为结构化记忆（JSONL）→ 关闭旧 session → 新 session 通过 MCP 读到蒸馏记忆，轻装上阵。

这和 think.md + loop-check 一脉相承，区别是：强制触发（不是 Agent 自觉）、结构化存储（不是自然语言 MD）、主动注入（不是新 session 自己读）。

> 🔒 **数据主权在设备**：所有记忆文件、task/logs、think.md 都只在设备本地 `.sofagent/` 目录，不经过云端。企业决策者最关心的问题——「Agent 处理的数据去哪了」——答案是哪也没去，就在这台设备上。这和 sofagent-dev 的 Task Board 产品层不同：Task Board 展示结果需要云端，但原始数据和记忆永远在本地。

### 多设备记忆管理：从单设备到企业知识库

一台设备跑久了，积累的记忆和 task/logs 是散落在本地的。多台设备一起跑，问题变成：怎么让「A 设备的 bug fix 经验被 B 设备的 Agent 读到」？

**第一阶段（v2.x 早期）**：设备间记忆索引——每台设备通过 MCP server 暴露 `sofagent_list_memories` 接口，只给元数据不传原始数据。**第二阶段（v2.x）**：企业 Agent 知识库——蒸馏记忆同步到企业自有 NAS/云盘，由专职「知识库管理员 Agent」自动分类、去重、建索引。知识库底层检索引擎推荐 [Graphify](https://github.com/safishamsi/graphify)——基于 tree-sitter AST 的轻量知识图谱，原生支持 OpenClaw，比向量检索 RAG 方案更适合 SMB 场景。

> 💡 不把数据存到 sofagent 的服务器。企业信不过开源项目的数据库——但信自己的 NAS 和企业云盘。sofagent 做连接器和查询层，存储永远在企业自己指定的地方。

索引卡片——每张卡 5 个字段、控制在 500 字符以内。主文件只告诉模型「这里有什么」，需要时再引导读取完整实现。先扫卡片再决定加载，五要素对应渐进式披露三阶段。

### 不要写显而易见的事：Skill 写作的第一原则

核心原则：**不写模型已知的常识，只写它在这个任务上会犯的错、会漏的步骤、会搞错的数据格式。** Gotcha 章节（记录最常踩的坑）比功能介绍有价值得多——这和 think.md 同源：用反思驱动，不用常识灌水。

### 自然传播→收编：sofagent 信任机制的治理哲学

**不靠中心团队强管质量，靠自然使用筛选质量。** 门槛设高是因为 LLM 评分有波动——连续 3 次才可能是真材实料。

<a id="deepseek-choice"></a>
### 为什么选 DeepSeek（[Developer §三](./DEVELOPMENT.md#三模型最优选择)）

默认推荐 DeepSeek，两条底线决定：

- **不碰 SaaS**：如果模型提供商能看到你的 task/logs、fde.md、think.md——那 sofagent 就是透明的。DeepSeek API 模式数据不经过第三方
- **成本可控**：Loop 机制每次任务额外消耗 2,000–5,000 token，API 按 token 付费每次不到 1 美分；SaaS 按 seat 付费成本不可控

模型选择是开放的——任何支持 API 的模型都能用。

### Flash 干粗活、Pro 干细活：模型分级的成本逻辑（[Developer §三](./DEVELOPMENT.md#三模型最优选择)）

Flash 和 Pro 差约 4 倍价，但简单任务 Flash 质量并不明显逊色。模型选择不是能力问题，是经济学问题。具体实现上是 OpenClaw 的 `sessions_spawn.model` 参数——API 级硬约束，不是「Agent 自觉」。

<a id="token-economics"></a>
### 编排开销的经济学：一次多花 3%，十次省回来

Loop 机制每次任务比裸跑多消耗约 2,000–5,000 token（约占 128K 窗口的 2–4%）。值得花——这些 token 用于沉淀最优拆法、记住踩过的坑。跑一次多花的 token，后面十次省回来了。token 价格长期往下，每降一个数量级，编排开销的占比就缩一个数量级。

<a id="a-b-test"></a>
### A/B 测试为什么不是一次性评估

sofagent 的 A/B 测试是 4 步渐进沉淀：同一类任务做 3 次以上 → 某种拆法连续 2 次复盘最高 → 标记为候选模板 → 再跑 2 次依然稳定 → 正式沉淀进 orchestrator/。保守是因为 LLM 复盘有偏差——一次高分可能是运气，连续高分才可能是规律。

### 渐进初始化：为什么模板是单文件而非预建目录树

`scoring.md` 和 `orchestrator.md` 的模板描述了完整的树形目录结构，但部署时只有一个单文件——不是遗漏，是设计。

**两段式初始化**：安装脚本只创建根 `_index.md`，之后的枝叶由子 Skill 在运行时按需创建。理由：①懒创建（不预建空目录）；②动态分类（语义聚类决定分类名）；③平台无关（只描述格式协议）。

> 💡 这和「文件系统而非数据库」是同一个原则：不给 Agent 预建它可能用不到的结构。

### 复盘体系（[Developer §五](./DEVELOPMENT.md#五自进化机制)）

从六维评分起步，逐步加入「流程合规」和「Loop 有效性」两个维度。Loop Agent 在 closure 模式下作为独立角色做复盘评估——执行和治理分离。不跑 RL 训练，靠独立角色 + 复盘 + 冷启动保护做决策，零训练成本。

### LLM 复盘的信任边界（[Developer §五](./DEVELOPMENT.md#五自进化机制)）

复盘、权重计算、技能评估——全部由独立角色执行。同一组数据跑两次分数可能差出 0.1 到 1 分，但相比主 Agent 自评，排除了编排者的确认偏误。不追求「精确评分」，追求「趋势正确」——看最近 5 次的走向，而非单次绝对值。

<a id="cold-start"></a>
### 冷启动保护：没跑够不妄下结论

新 Skill 装上、新任务类型出现——没有历史数据对照。前 5 次只记录，不做任何判断。第 6 次起进入正常「看趋势」模式。样本不够时，LLM 的评分波动会被放大成错误决策——冷启动是给随机性加缓冲。

<a id="think-zone"></a>
### 反思区统一（[Developer §六](./DEVELOPMENT.md#六反思工程)）

think.md 是合并后的「错题本」——教训和经历存储在同一个上下文中。同一个坑踩了 5 次，反思区里只有一条记录，置信度从 0.3 涨到 0.7。更新模式是覆盖而非追加——从「记流水账」转为「提炼关键反思」。

<a id="weight-gate"></a>
### 活跃区权重门禁（[Developer §六](./DEVELOPMENT.md#六反思工程)）

只把权重 ≥0.5 的摘要放进反思区（≤2K token），其余丢进归档区。权重由三个信号计算：新鲜度（+0.3）、反思关联（+0.3）、引用热度（+0.1）。门禁 0.5 意味着一条记忆必须有至少两个信号支撑才能进反思区。真正的安全阀不是权重计算，是反思区的 2K token 硬上限。

<a id="self-correct"></a>
### 记忆自我纠正三道防线（[Developer §六](./DEVELOPMENT.md#六反思工程)）

think.md 既是产出（任务闭环后写入），又是加载链输入（下次启动读到）。写入出错会有连锁影响。三道防线：

**第一道：只存经验，不存指令。** 只记「上次做了什么、踩了什么坑」，不记「你应该怎么做」。写入前扫描指令性关键词 ≥3 处时提醒拆分到 fde.md。

**第二道：反思区 2K token 硬上限。** 即使反思评分出错，2K token 封顶，影响范围有限。

**第三道：人工可清除。** 发现 Agent 行为异常时，第一步查 think.md 删掉可疑条目。

sofagent 的失效标记机制（`[已失效] → 新事实 | 原因`）保留版本链不覆盖。**更短的精准上下文 > 更长的冗余上下文**。

### 不要 Connector（[Developer §七](./DEVELOPMENT.md#七数据文件架构)）

sofagent 是 Agent 纪律层，不是软件工程自动化流水线。它的「外部世界」就是文件系统——task/logs、scoring/、orchestrator/、think.md。这些 Markdown 文件已经构成完整的可审计闭环。文件就是接口，Markdown 就是传输格式。

### 文件系统而非数据库（[Developer §七](./DEVELOPMENT.md#七数据文件架构)）

Agent 纪律层最核心的数据是 task/logs——每次任务跑完后一小段 Markdown 摘要。选文件系统的三个原因：

- **无额外依赖**：`cat task/logs/2026-06-15.md` 就能拿到记录，不需要 SQL/连接串/权限管理
- **天然可审计**：`ls task/logs/` 就是审计入口，怀疑做错了决策打开文件看一眼
- **天然可传输**：`cat` → 推送，完事

额外好处：天然支持 Git——`git diff task/logs/` 看变化，`git log` 追溯决策时间。记忆架构按三层设计：task/logs 是原始账本（只追加不修改），think.md 反思区是提炼视图，权重门禁是控制策略。

<a id="tree-loading"></a>
### 树形加载：为什么是树而不是平铺

orchestrator/、scoring/ 这些目录可能有几百条记录——全读到上下文里不现实。数据文件用**树形目录 + 按需读取**：读 `_index.md` → 定位分支 → 只加载叶子文件，总量不超过 100 行。

语义聚类是动态的——今天叫「研发」明天叫「工程」都不影响。树形天然支持渐进式披露：先看目录再决定读哪页。

---

<a id="known-limits"></a>

## 三、诚实坦白：已知局限

> 17 条已知局限详见 **[LIMITATIONS.md](./LIMITATIONS.md)**。核心局限：纪律层自身在上下文里（约束力 = Agent 注意力 × 平台加载可靠性）、加载链步进脆弱性（非 OpenClaw 平台可能跳过）、复盘评分是 LLM 自评（评审者与执行者不分离）、Skill 自进化处于经验记录阶段、核心效果缺持续数据。

> 💡 其他文档引用已知局限时，统一指向 `LIMITATIONS.md` 对应锚点，不在各自文档里重复摘抄——改一处，全局生效。

---

## 四、未来方向

> 仅供后续版本设计参考。路线图详见 [ROADMAP.md](./ROADMAP.md)。

### 版本路线速览

- **v0.9x**：安全审查 ✅ → 审计层（sofagent-audit）→ daemon TypeScript 化
- **v1.0 定位**：Agent 工作验收工具（正式）+ Agent 纪律层（实验——v0.97+v0.98 两次共 200 次实验，方法缺陷无法结论，已作废）+ FDE 部署框架（规划）。审计层跨平台、零 Agent 依赖、有独立技术价值——是 v1.0 的主产品
- **v1.x**：Skill 自进化验证门控（A/B 对比 + 外部评估器）→ 设备固件
- **v2.x**：多设备协同层 / 信号共享网络 → FDE 完整形态

**两个原则性警告**（贯穿所有版本）：①「不要让智能体自我验证」——根治需 v1.x 外部评估器；②「Agent 越强，闸门越重要」——不可因模型能力提升而拆除控制机制。

**设计原则**：sofagent 是 FDE 场景的纪律底座，不是 FDE 引擎。两者是工具和工具箱的关系——工具箱不替你干活，但保证工具不会伤手。

> **范围声明**：sofagent 是 FDE 的**纪律底座**，不是**运维底座**。覆盖 FDE 问题空间约 20%（Agent 质量层：代码纪律 + 审计 + 经验沉淀），运维层（监控/告警/重启/日志轮转，约 80%）不在范围内。

---

## 五、参考与致谢

sofagent 站在这些人和作品的基础上：

| 来源 | 启发 |
|------|------|
| **OpenClaw** | 运行平台——加载链、Hook、Skill 系统、session 隔离 |
| **DeepSeek + GLM** | 模型引擎——所有文件由二者配合生成 |
| **Addy Osmani** | Loop Engineering 五大件架构、语义化停止条件 |
| **Anthropic** | Managed Agents 四层架构——核心设计哲学源头 |
| **agency-orchestrator** | `ao compose` 意图识别→任务图生成→模板匹配→分配 |
| **Andrej Karpathy** | 思考先行、简约至上、精准修改、目标驱动——铁律在此基础上扩展 |
| **Geoffrey Huntley** | Ralph Loop——「Agent 失忆，文件不失忆」哲学。一行 bash 循环 + Stop Hook + 确定性完成承诺，启发 sofagent 审计层核心设计：git diff 无状态证据优于 Agent 日志有状态证据。详见 [§审计层的证据分层](#audit-evidence-layering)。原帖 [ghuntley.com/loop](https://ghuntley.com/loop) |
| **MiroFish** |「工具调用与最终答案严格分离」模式——ReportAgent 的治理机制启发了 sofagent 审计层的证据分层：git diff = 最终答案，Agent 日志 = 工具调用过程 |
| **Nelson F. Liu et al.** | *Lost in the Middle*——500 字原则和加载链顺序的科学依据 |
| **AI 代码审查实验（146 PR × 4 AI Reviewer）** | 93.4% 的问题仅被单一 AI 工具识别，0% 被所有工具共同识别——多视角评估不是「nice to have」，是「must have」。验证 sofagent loop-check + scoring + 人类审查三层设计 |
| **Google Cloud Code 论文** | Agent 运行时 7 组件架构（entry → context → loop → permission → state）。核心结论：loop 不是产品——Harness 的可控性、可恢复性、可审计性才是上生产的决定因素 |
| **Hirom 定律 + Lima 演化定律** | 系统所有可观察行为都会被依赖 + 不加控制则复杂度持续增长。验证 sofagent 「先读再用」「验证再干」「谨慎修改」三条铁律的理论根基 |

> 更多外部研究引用（MAGMA、SkillOpt、Google Skill 模式、多智能体成本研究等）详见 [DEVELOPMENT.md](./DEVELOPMENT.md) 对应章节。

---

> 这份设计文档和 Handbook 一样，是开放的。如果你觉得哪个设计决策有问题，或者发现了我们没考虑到的局限——开 Issue，直接说。设计文档不应该是作者一个人的独白。
