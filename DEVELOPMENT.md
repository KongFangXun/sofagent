# sofagent Development

> 给开发者的内部机制文档。普通用户看 [Handbook](./HANDBOOK.md)，设计决策看 [Architecture](./ARCHITECTURE.md)。
>
> 这里讲 sofagent 内部怎么跑——Skill 结构、编排引擎、反思闭环、数据架构。
>
> v0.83 · 2026-06-22 · 孔放勋

<img src="images/sofagent.png" alt="sofagent" width="300" />

---

## 速览

| 你想做什么 | 看哪章 |
|------|------|
| 理解 Skill 结构 | [工作原理](#一工作原理) |
| 理解编排机制 | [编排哲学](#二编排哲学) |
| 理解模型选择 | [模型最优选择](#三模型最优选择) |
| 理解模板与验证 | [模板与验证](#四模板与验证) |
| 理解自进化机制 | [自进化机制](#五自进化机制) |
| 理解反思闭环 | [反思工程](#六反思工程) |
| 理解数据文件 | [数据文件架构](#七数据文件架构) |

---

## 一、工作原理

> 本章内容：1 主 Skill + 5 子 Skill = 6 个 .md —— 怎么协同、靠什么执行

### sofagent Skill 工作原理

### Skill 文件结构

Skill 不只是 Markdown 文件和一段提示词。根据 Anthropic Cloud Code 团队的实践定义，Skill 是一个**完整的工作环境**——包含入口分发器、子 Skill、脚本、资源配置，本质是把模型的泛化能力推进到稳定完成某类特定工作的能力。sofagent 的框架就是这个定义的工程实现。

**1 主 Skill（`SKILL.md`）+ 5 子 Skill（engine/entry-gate/task-aware/task-closure/loop-check）= 6 个 .md（按需加载）**

用户只安装 `SKILL.md`（主入口）。每次对话开始时自动加载，A0 预判复杂度——🔴 复杂任务确认后加载 `engine.md` 走完整入口流程（平台检测→安装→加载链→种子指令），🟢🟡 简单/中等任务跳过 engine.md 直接走 task-aware 闸门。子 Skill 按场景按需加载——每个只管一件事，每个 ≤90 行，Agent 不会迷路。

| 文件 | 何时加载 | 干什么 | 位置 |
|------|------|------|------|
| engine | 🔴 复杂任务确认后 | 入口引擎：平台检测→安装→加载链→种子指令，后接 Skill 检索 + ao compose | `engine.md` |
| entry-gate | 入口流程结束后 | 硬出口检查：加载链确认 + 能力注册。入境闸门不开，不接任何任务 | `entry-gate.md` |
| task-aware | 收到任何用户任务时 | 每任务闸门：边界→语义→健康度→判级→澄清。含硬信号规则 + 检查点触发规则（子任务间/60%预算/重大操作前） | `task-aware.md` |
| task-closure | 闭环信号出现时 | 离境闸门：调 Loop Agent（closure 模式）→ 反思/评分/A/B/汇报 | `task-closure.md` |
| loop-check | 检查点 / 失败 / 闭环 | 顾问 Agent（角色隔离）：读数据→做判断→给建议。三节点调起（checkpoint/failure/closure） | `loop-check.md` |

> 三层闸门 + 一条回环：入境（初始化证明）→ 每任务（启动前确认）→ Loop（执行中检查+失败诊断）→ 离境（完成后沉淀）。四个全走才能保证 `.sofagent/` 数据层被激活。

```
SKILL.md 启动
  ├─ 三层加载链（SKILL.md + think.md + rules.md）← 内部 hook sofagent-load-chain 注入（OpenClaw）/ Agent 主动 Read（其他平台）
  ├─ A0 判级
  │   ├─ 🟢🟡 简单/中等 → task-aware 直接处理
  │   └─ 🔴 复杂 → engine.md 点火
  │         ├─ 平台检测 + 初始化 ← install.sh / verify.sh
  │         └─ ao compose 拆任务 ← task-orchestrate.sh 包装
  │               ├─ ClawHub 搜 Skills
  │               └─ 分配子 Agent
  ├─ loop-check 检查点（子任务间 / 60% 预算 / 重大操作前）
  ├─ loop-check 失败诊断（可自愈重试 / 不可→汇报）
  └─ task-closure 收口
        └─ loop-check closure 模式
              ├─ 反思 → think.md ─┐
              ├─ 评分 → scoring/    ├─ task-record.sh 写入
              ├─ A/B 对比 → orchestrator/ ─┘
              └─ 口头汇报
```

安装方式：把 `SKILL.md` 放到 Skills 目录（OpenClaw 一般在 `~/.openclaw/skills/`），一条命令搞定。OpenClaw 通过 Hook 在 session 启动时自动加载 Skill。WorkBuddy、Codex、Hermes Agent、Claude Code 通过种子指令自启——详见 [Handbook §五](./HANDBOOK.md#五安装与跨平台)。

主 Agent 的日常：接活 → 看 `scoring.md`（谁靠谱）→ 看 think.md 反思区（上次踩了什么坑）→ 看 `orchestrator/`（有没有最优配置）→ 干完记入 `task/logs/`。数据流向总结见 [Developer §七](#七数据文件架构)。

### 实现方式

为什么判断交给 Skill、机械操作交给脚本、硬安全交给 OpenClaw 原生配置——三分架构的设计推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#skill-runtime)。

<a id="脚本与文件结构速查"></a>
### 脚本与文件结构速查

> 从 Handbook §五 移入的 Developer 级参考内容——普通用户不需要看，开发者改 Skill / 脚本时查这里。

**`sofagent/` 目录结构**（4 个子目录 + 6 个 Skill .md 文件 = 1 主 Skill + 5 子 Skill）：

- `rules.md`（1 个文件）：执行层，你的运行规范。v0.62：宪法已内联进 SKILL.md。v0.73：从 constitution/ 扁平化到根目录
- `data/`（5 个文件）：数据模板 think.md、orchestrator.md、task.md、scoring.md、IDENTITY.md
- `scripts/`（5 个脚本）：install.sh、verify.sh、uninstall.sh、task-record.sh、task-orchestrate.sh
- `hooks/sofagent-load-chain/`（2 个文件）：HOOK.md + handler.ts（OpenClaw 2026.6.x 内部 hook，agent:bootstrap 事件注入第 2、3 层）
- Skill 文件（6 个 .md）：SKILL.md（主入口）、engine.md（入口引擎）、entry-gate.md（入境闸门）、task-aware.md（每任务闸门）、task-closure.md（离境闸门）、loop-check.md（循环顾问）

**配套脚本速查**：

| 脚本 | 干什么 | 什么时候跑 | 手动示例 |
|------|------|------|------|
| `install.sh` | 多平台一键安装（7 步） | 你手动跑 | `bash install.sh --platform openclaw` |
| `uninstall.sh` | 删约束文件，保留 `.sofagent/` 用户数据 | 你手动跑 | `bash uninstall.sh --platform openclaw` |
| `verify.sh` | 装后验证 9 类 24+ 检查项 | 安装完自动跑，也可手动 | `bash verify.sh --json`（CI/CD） |
| `load-chain.sh` | ~~已废弃~~（v0.64 删除，改用 `hooks/sofagent-load-chain/` 内部 hook） | — | — |
| `task-orchestrate.sh` | 包装 ao compose：worktree 隔离 + 约束注入 + 成本汇总 + 清理 | engine.md 拆任务后自动调用 | 不手动跑 |
| `task-record.sh` | 收集任务数据 → 拼 Markdown → 追加到 task/logs/ | 闭环时自动调用 | 不手动跑 |

> 💡 前三个是用户侧工具（装/卸/验），后三个是运行时脚本（Agent 自动调，你不需要手动跑）。**设计原则**：确定性操作脚本化——去重、格式校验、文件清理这类即刻运算，脚本比 Agent 更快更省更可靠。Agent 只负责判断和执行，代码做稳定工具，Markdown 保存状态。

**跨平台自启：种子指令**

五大平台都有自己的 Native 记忆文件，系统保证每轮自动注入。WorkBuddy / OpenClaw 上 Agent 首次初始化时自动写入种子指令；Codex / Hermes Agent / Claude Code 需要你手动在文件末尾贴一行。

种子指令内容：
> 每次对话开始，读取 `SKILL.md` 并执行其中的入口流程。如果数据文件（`.sofagent/`）不存在，先执行初始化。

手动平台贴到对应文件末尾：Codex → `AGENTS.md` | Hermes Agent → `SOUL.md` | Claude Code → `~/.claude/CLAUDE.md` 或项目根 `CLAUDE.md`。搞一次永久生效。


---


## 二、编排哲学

> 负责的子 Skill：`engine.md` 点火 ao compose 拆任务 → `loop-check.md` 设检查点 + 失败诊断 → `task-closure.md` 闭环收口。

这套编排同时吸收了 Harness 和 Loop 两种思路——约束层保证基本安全（`SKILL.md`（宪法内联）），编排层往自我进化方向走（orchestrator/ + A/B 对比）。目标在 [Developer §一](#一工作原理) 定稿了，这一章解决后续问题：循环怎么启动、怎么跑、怎么收口。

> Loop Engineering 的概念已在 [Developer §一](#一工作原理) 介绍过，这里只做工程映射——sofagent 的编排就是「目标→验证→决策→交接」四环节的实现：**目标**（/goal + 两轮澄清 [Developer §一](#一工作原理)）→ **验证**（铁律 #3 + skill-iterate + 中间检查点 [Handbook §三](./HANDBOOK.md#三底线与铁律)/[Developer §三](#三模型最优选择)/[Developer §五](#五自进化机制)）→ **决策**（ao compose + 编排深度晋级/回滚 本章）→ **交接**（闭环反思→ think.md 反思区 + task/logs [Developer §六](#六反思工程)/[Developer §七](#七数据文件架构)）。

> Agent 循环不新鲜——React 范式 2023 年就有了。Loop 和 React 的本质区别不在「转圈」而在「收敛」，详见 [ARCHITECTURE.md](./ARCHITECTURE.md#一为什么会有-sofagent)。下面这三个难题，sofagent 自有解法：

| Loop 难题 | sofagent 怎么解的 | 在哪 |
|------|------|------|
| 什么时候停？ | Session 边界（缓存/Token 双阈值自动提醒）+ 中间检查点（步数/重试/Token超标暂停） | 本章 + [Developer §五](#五自进化机制) |
| 失败了怎么办？ | 任务闭环：反思→think.md 反思归因→下次自动避开。不是简单重试，是带反思的重试 | 本章 |
| 状态怎么管？ | task/logs 水源 + think.md 反思区 + orchestrator/ 决策沉淀 | [Developer §六](#六反思工程) + [Developer §七](#七数据文件架构) |

### Session 边界

主 Agent 监控两个指标，任一超限提醒用户新开会话：

| 指标 | 阈值 |
|------|------|
| 缓存占用 | ≥50% |
| Token 总量 | ≥模型上限的 70% |

超限后，task-aware 做语义确认 → 提醒用户→ 用户确认 → 反思 → 写入 think.md「会话交接」摘要 → 提示 /new。Agent 不能自己 /new，只能建议。

用百分比不用轮次——模型窗口在变大，轮次限制是刻舟求剑。完整推理见 ARCHITECTURE.md session-boundary。

> 子 Agent 不参与这套机制——脏数据隔离，上下文溢出说明编排拆得不够细。

### 编排（Orchestration）：ao compose + /goal + 用户确认

编排用了 [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)（Apache-2.0）的 `ao compose`——意图识别、任务图生成、模板匹配、分配这四步它都做了。模型选择不在 ao compose 的范围内，我另外补。

全套流程是：/goal 触发两轮澄清（[Developer §一](#一工作原理)）→ 目标定稿 → ao compose 拆任务 → 生成提案 → 用户确认 → Loop 执行：

```
用户一句话（/goal）
  → 两轮澄清（[Developer §一](#一工作原理)）：目标确认 → 方案预览 → 定稿
  → ao compose 拆成任务图（怎么干）
  → 生成任务提案（Skill、模型、成本全透明）
  → 用户确认（看一下，不满意就改）
  → 确认后，Loop 启动——Agent 按提案自动跑循环
```

**/goal 触发澄清，澄清定目标，ao compose 拆任务，用户批方案，Loop 跑执行。** 和 `/goal` 原版（黑盒自主循环）的区别已经在 [Developer §一](#一工作原理) 讲清楚了——这里只讲怎么跑。

### ao compose 生成了什么

运行 `ao compose` 会在 `.sofagent/orchestrator/workflows/` 生成一份 YAML——角色匹配、任务拆分、依赖关系、输入输出都在里面。文件名和内容都直接可读，不需要任何工具就能打开。跑 `ao run workflow.yaml` 按这份说明书执行。

> ⚠️ YAML 只管编排，不含 sofagent 的 Skill 注入——Skill 约束由 `task-orchestrate.sh` 在执行前注入。AO 负责「怎么拆」，sofagent 负责「按什么规矩跑」。

### 主 Agent 和子 Agent

整个体系里有两种 Agent：

| 类型 | 干什么 | 举个例子 |
|------|------|------|
| **主 Agent**（Orchestrator） | 拆任务、派活、收尾（反思/评分/A/B） | 你跟它说「帮我分析数据」，它负责拆成子任务、分给合适的子 Agent、最后汇总结果 |
| **子 Agent**（Sub-agent） | 干具体的活 | 主 Agent 派给它「清洗数据」这个子任务，它就专门干这一件事 |

主 Agent 不干具体活——它的工作是**派活和收尾**。子 Agent 才是真正干活的，但子 Agent 是主 Agent 临时创建出来的，干完就销毁。

编排的前置条件：目标经过两轮澄清定稿（[Handbook §四](./HANDBOOK.md#四任务目标制定)）。没收敛就继续澄清，不硬进编排。

### 编排深度：渐进减薄

> 设计权衡（四级编排深度、滑动窗口回滚的取舍）见 [Design §二 四级编排深度](./ARCHITECTURE.md#四级编排深度)。本章只讲怎么操作。

同类任务跑顺了就少做步骤，跑崩了就加回来。分四级，每级有明确的晋级和回滚条件：

| 深度 | 晋级条件 | 做什么 | 确认模式 | 回滚条件 |
|:--:|------|------|:--:|------|
| 四级·完整编排 | 新任务 / 失败率回升 | ao compose 全程：意图→任务图→模板→分配→注入→聚合 | 用户确认 | — |
| 三级·模板复用 | 同类任务连续 3 次跑通（失败率 = 0%） | 跳过意图识别和任务图，直接用沉淀模板 + ao compose 分配 | 用户确认 | 失败率 > 20%* |
| 二级·轻量调度 | 候选模板沉淀后（使用 ≥7 次，败率 < 20%） | 固定角色阵容 + pinnedRoles，只跑分配和注入 | 自动执行，事后通知 | 连续 2 次未达预期 |
| 一级·自主执行 | 任务模板稳定 10 次以上（失败率 = 0%） | 用户一句话直接分派，跳过编排层 | 无需确认 | 用户主动干预或失败 |

> \* 失败率均按最近 5 次同类任务的滑动窗口计算，详见下文「失败率怎么算」。

> 📎 pinnedRoles = 锁定的角色阵容，同一类任务复用同一组 Agent 角色，不用每次重新匹配。

> 💬 **实际案例**：「数据分析报表」第一次跑是完整编排（用户确认每个子任务），连续 3 次跑通后自动跳到模板复用（用户只看方案），跑满 10 次零失败后 Agent 直接接活回来报告结果——你只说一句「出报表」。

放手的前提是可回滚——每一级都在 `task/logs/` 和 `orchestrator/` 里留了痕迹。减薄不是全局的，是对这个任务类型减薄。

**失败率怎么算**：每次任务闭环后，主 Agent 自评任务结果——如果任一子任务**未完成 / 任务偏差 / 用户中途纠正**，记为 1 次失败。**滑动窗口**：取最近 5 次同类任务，失败数 / 5 = 失败率。

**怎么标 #badcase**：在 think.md 反思区的对应日摘要末尾加 `#badcase` 即可，例如：`今天做了数据分析报表。Skill A 超时 3 次。#badcase`。主 Agent 下次反思时会读取这个标签并计入失败率。用户也可以随时删除标签来撤销标注。不需要改其他文件，不需要执行任何命令——就加 8 个字符。

### 主 Agent 工作流

```
用户一句话
  │
  ▼
两轮澄清（详见 [Developer §一](#一工作原理)）
  ├─ 第一轮：目标确认（苏格拉底式提问）
  ├─ 第二轮：编排方案（ao compose 直接出方案）
  │
  ▼
ao compose 生成任务提案（AO 做四步）
  ├─ 意图识别：你要做什么
  ├─ 任务拆分：拆成几个子任务
  ├─ 模板匹配：每个子任务谁来干
  └─ 分配：pinnedRoles 锁阵容
  │
  ▼
sofagent 补上 ao compose 不做的
  ├─ Skill 选择：每个子任务用什么技能
  ├─ 模型选择：Flash 还是 Pro（详见 [Developer §三](#三模型最优选择)）
  └─ 成本预估：大约多少 token、大概多少钱
  │
  ▼
┌─────────────────────────────┐
│  任务提案展示给用户            │
│  ✅ 确认 → 继续               │
│  🔄 修改 → 调整后再确认        │
└─────────────────────────────┘
  │
  ▼
执行
  ├─ ao compose 分配（pinnedRoles 锁阵容）
  ├─ Harness 注入 sofagent/铁律/反思
  ├─ 子 Agent 并行干活
  ├─ 主 Agent 聚合结果
  └─ 闭环（反思→评分→A/B→汇报）
```

两轮澄清见 [Handbook §四](./HANDBOOK.md#四任务目标制定)，编排深度见本章下节，闭环反思见 [Developer §五](#五自进化机制)。

### 子 Agent（Sub-agent）：脏数据隔离

```
创建 → 执行 → 反思 → 存储 → 上传 → 销毁
```

无状态、无持久化身份、无历史包袱。子 Agent 执行期间产生的日志、报错等「脏数据」仅存在于子 Agent 上下文，执行完毕后隔离销毁，不影响主 Agent 稳定性。有价值信息在销毁前已通过反思转移。如果反思质量不够好——最后 3 轮原始对话在 Session Store（OpenClaw 自动保存的对话记录）暂存 7 天作为兜底，可以回溯。7 天后自动清理。

> 💡 Loop Engineering 强调**执行和审核必须分离**——「写的人和查的人分开，挑刺才客观」。sofagent 的职责分离：**子 Agent 负责干活**（生成器），**skill-iterate 负责评分**（独立评估器——角色分离让执行者不自评，非独立进程，详见 [Developer §五](#五自进化机制) 工程边界），**orchestrator/ 中间检查点负责决策**（继续/停止/回滚）。干活的不能说「我做完了」——那是评估器的事。

多个子 Agent 并行时，如果它们操作同一个代码仓库，用 Worktrees（工作树隔离）解决文件冲突。为什么要用 git worktree 而不是其他方式、什么场景触发、谁负责做什么，见 [ARCHITECTURE.md](./ARCHITECTURE.md#worktree-isolation)。

> 📎 子 Agent 执行过程中有中间检查点机制——步数/重试/token 任一超标即暂停，由主 Agent 三问评估是否继续。详见 [Developer §五](#五自进化机制)。

### 任务闭环：反思 → 评分 → A/B → 汇报

子 Agent 销毁后，主 Agent 触发四步闭环（底层由 Loop Agent 收口，详见 [Developer §三](#三模型最优选择)），所有闭环数据由 `task-record.sh` 写入：
② 反思 → think.md | ③ 评分 → scoring.md | ④ A/B 对比 → orchestrator/ | ⑤ 口头汇报（不可跳过）。

四步通过「影响链」互相关联——踩的坑和哪个 Skill 表现不好之间的关联，主 Agent 在 think.md 记一笔下次自动避开。详见 [Developer §五](#五自进化机制)。


### 外部 Skill 来源

岗位模板和 Skills 从开源社区获取，sofagent 只负责「发现」和「加载」，不做内容生产。

| 源 | 拿来做什么 |
|------|------|
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 215 个中文岗位模板，IDENTITY 层素材来源 |
| [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) | 编排引擎——`ao compose` 一行命令完成意图识别→任务图生成→模板匹配→分配（详见 [Developer §二](#二编排哲学)） |
| [ClawHub](https://clawhub.ai) | 全球 Skills 社区，与 OpenClaw 互通 |

### 外部 Skill 获取

engine.md 在 ao compose 拆完任务后从 ClawHub 搜索并集成。四步：发现（ClawHub API）→ 初筛（社区评分 < 3.0 过滤）→ 分配（按信任等级）→ 闭环后自动升降级。

信任等级四档（已验证/试用中/未验证/不推荐）的完整规则见 [ARCHITECTURE.md](./ARCHITECTURE.md#trust-levels)。

> 💡 Skill 选择由主 Agent 自己完成：读 scoring/、做语义匹配、选评分最高且最匹配的——这是 LLM 的长项，不需要额外工具。当前 Skill < 100 直接匹配足够；超 100 后走两阶段（关键词召回 top-20 → LLM 重排），这是远期工程预留。


### Skill 描述分离

每个 Skill 自带一张「索引卡片」——写清名称、触发场景、什么时候不该用。Agent 先读卡片做匹配，命中后才加载完整实现。这套格式不是 sofagent 定的，是社区惯例——ClawHub 上的 Skill 都这么写。

| 部分 | 用途 |
|------|------|
| Skill 索引卡片（≤500 字符） | 快速匹配——Agent 扫描结构化字段决定用哪个 |
| 完整实现（无限制） | 命中后按需加载到子 Agent 上下文 |

> 💡 卡片不是 sofagent 生成的，是 Skill 作者自己写的。sofagent 只负责读卡、匹配、决定用哪个。

---

## 三、模型最优选择

> 负责的子 Skill：`engine.md` 分配模型——Flash 干粗活、Pro 干细活。

### 为什么选 DeepSeek

sofagent 默认用 DeepSeek——性价比：Flash/Pro 两档差 4 倍价，Flash 干粗活、Pro 干细活，最划算的组合。且 API 模式数据不经过第三方平台。完整选型逻辑见 [ARCHITECTURE.md](./ARCHITECTURE.md#deepseek-choice)。

### Flash vs Pro 分配

| 任务类型 | 例子 | 用什么模型 | 解释 |
|------|------|------|------|
| 简单任务 | "帮我查一下今天北京天气" | Flash，便宜够用 | 速度快、成本低，处理简单查询完全够用 |
| 中等任务 | "写一篇公众号文章，主题是 AI" | Flash 管查资料，Pro 管写文章 | 中等任务可以混用——查资料用 Flash，写作用 Pro |
| 复杂任务 | "分析过去三个月数据，做报表发我" | Pro 为主，4-6 个子任务混合调度 | 多步推理、数据分析、可视化，需要 Pro 保证质量 |

简单任务用 Flash、复杂任务用 Pro——决策就一句话。

每次分配模型前，主 Agent 会先检查 token 余额——预估消耗超了就提醒，不会一声不吭把额度跑光。

### 怎么实现的

模型选择不是靠 Agent 自觉——是靠 OpenClaw 的 `sessions_spawn.model` 参数。主 Agent 创建子 Agent 时直接传模型名进去，OpenClaw 按参数执行。传了就生效，是 API 级别的硬约束。

具体流程：

```
ao compose 拆完任务
  → 主 Agent 先查 rules.md：你有没有写模型偏好？
  → 有 → 按你写的来（rules.md 优先级最高）
  → 没有 → 查 orchestrator/：这个任务类型有没有最优模型？
  → 有 → 直接用缓存的配置
  → 没有 → 按默认策略（简单 Flash / 复杂 Pro）
  → 创建子 Agent 时，sessions_spawn.model 传入模型名
  → OpenClaw 返回 resolvedModel，确认已生效 ✅
```

三层优先级：**rules.md（你写的）> orchestrator/（A/B 测出来的）> 系统默认（Flash/Pro 策略）**。你的规则永远排第一。

不需要额外脚本，不需要 Runtime 代码——OpenClaw 原生支持这个参数，SKILL.md 只是告诉主 Agent 按什么顺序查配置、用哪个。

### 你也可以用自己的模型

不用 DeepSeek？有两条路：

**简单方式**：在 `rules.md` 里写一行模型偏好（模板见 [Developer §七](#七数据文件架构) rules.md 模板）。主 Agent 每次先读 rules.md，看到你的偏好就直接用，跳过后面所有步骤。适合「我就想全局换一个模型」。

**精细方式**：改 `orchestrator/` 叶子文件里的「最优模型」字段（详见 [Developer §七](#七数据文件架构) orchestrator/ 示例）。适合「数据分析用 Claude，写代码继续用 DeepSeek」这种按任务类型分模型的需求。

两种方式都不需要改代码。整套编排逻辑不变——什么任务用什么档位是策略，策略不绑定具体模型。

编排的开销经济学（一次多花 3%，十次省回来）的完整推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#token-economics)。

---


## 四、模板与验证

> 负责的子 Skill：`loop-check` closure 模式 — A/B 对比 → 沉淀最优模板 → 写入 orchestrator/

### 任务模板

把表现最好的拆分方式记录下来就成了任务模板。它和岗位模板是两回事：岗位模板（`IDENTITY.md`）来自 agency-agents——定义「谁能干什么」；任务模板（`orchestrator/`）是 A/B 测出来的——记录「这件事怎么拆最优」。一个是招聘要求，一个是作战计划。

一个任务模板记录四样东西：子任务怎么拆、每个子任务交给谁、用什么 Skills、子任务之间的依赖关系。下次同类任务直接用模板，不用重新编排。

### 谁来实现

| 产物 | 谁写的 | 怎么写的 |
|------|------|------|
| `orchestrator/{任务}.md` | `loop-check` closure 模式 | 闭环时读 task/logs/ 同类任务记录 → A/B 对比 → 胜出模板写入 |
| `scoring/{skill}.md` | `loop-check` closure 模式 | 闭环时评分 → 写入对应 Skill 叶子，含使用次数、评分、备注 |
| `task/logs/` | 主 Agent | 每次执行自动生成，只追加不修改 |
| `IDENTITY.md` | 来自 `agency-agents-zh` | ao compose 拆任务时按角色自动分配，不在 sofagent 项目内 |

### A/B 测试

这套系统里没有单独的「A/B 测试模式」——它就是日常跑任务时自然发生的。同一类任务做了几次，每次换着花样编排，结果都记在 task/logs/ 里。闭环时对比——谁更快、谁更省、谁更好——最优的写入 orchestrator/。

规则：
- 不主动创造对照组——就靠日常任务自然积累
- 同一类任务才比——「数据分析」不和「写代码」比
- 连续 2 次胜出才标记候选模板，再跑 2 次稳定才正式沉淀
- 模板可被替换——有更好的拆法冒出来，比一轮，赢了就换

局限：样本量小（最少 7 次才沉淀）、LLM 有随机性、不同难度方差大。模板沉淀后标「待确认」。完整推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#a-b-test)。

每次闭环评分时，loop-check closure 模式会把本次踩的坑追加到 `scoring/{skill}.md` 的「踩过的坑」字段，Agent 下次加载 Skill 时先扫一眼——提前知道哪里摔过。

---


## 五、自进化机制

> 负责的子 Skill：`loop-check` + `task-closure` — 反思 → 评分 → A/B → 写入 orchestrator/

前面四章讲了编排（[Handbook §四](./HANDBOOK.md#四任务目标制定)）、Skills（[Developer §三](#三模型最优选择)）、A/B 测试（[Developer §四](#四模板与验证)）、记忆（[Developer §六](#六反思工程)）。单独看每个都说得通——但问题是，它们各跑各的，没有互相反馈。

这一章要解决的问题：**怎么让这四样东西串起来，互相反馈。**

### 复盘：四路反馈

闭环后从四个角度反馈：① 编排对不对 → orchestrator/ | ② Skills 选得对不对 → scoring.md | ③ A/B 有没有新结论 → orchestrator/ | ④ 模型选得值不值 → orchestrator/ 成本对比。四路汇总到 orchestrator/，下次同类任务直接用最优配置。

### 复盘自评每次任务闭环后，主 Agent 切换到 Loop Agent 视角，从八个生产力维度评估整套编排（另有第九维「判断力」独立计分，见下）：

> ⚠️ 工程边界：Loop Agent 不是独立进程或独立模型调用，是主 Agent 切换 prompt 以顾问身份输出建议。"独立复盘"指角色隔离，不是工程隔离。评分是 LLM 自评，无客观基准，结果仅供横向对比参考。详见 [LIMITATIONS.md](./LIMITATIONS.md#known-limits)。

八维评分维度：① 编排准确性（子任务粒度/依赖是否跑通）② Skill 匹配度（Skill 是否合适）③ 模型经济性（成本 vs 质量）④ 执行流畅度（有无卡顿/重试/超时）⑤ 结果完整性（用户要的做全了没）⑥ 复用潜力（同类任务通用性）⑦ 流程合规（是否跳步/绕过检查点）⑧ Loop 有效性（检查点是否起作用：5=提前发现/3=漏但修复/1=误报浪费）。另有第九维「判断力」（弃权率/拒绝高风险任务）与前八维分开计分——不放在同一个总分里，「你很能跑」和「你很会判断什么不该跑」是两件事。见 [loop-check.md](./sofagent/loop-check.md) 第九维定义。

复盘加权算出总分，分比上次高 → 覆盖 orchestrator/ 为最优配置。分比上次低 → 不动，标「待验证」。

这和 Loop Engineering 的「造/验分离」是同一个原则——做任务的子 Agent 不给自己复盘，由 Loop Agent 来做复盘评估。

> 💡 复盘简化版——每次闭环只需要回答三问：**用对了吗**（流程合规）？**更好了吗**（复盘总分↑）？**Loop 起作用了吗**（检查点提前发现问题 or 事后才发现）？

### 中间检查点

复盘是任务闭环后的总评。Loop 跑的过程中也有三个检查点

**触发条件**（任一触发即暂停）：
- 步数超过 `orchestrator/` 里该任务类型的历史平均步数 × 2（首次执行取叶子文件的 `首次预估步数` 字段，未配置时默认 50 步。跑满 3 次后 loop-check closure 模式自动用实际平均值校准该字段）
- 同一工具连续失败或重试达到 3 次
- token 消耗超过该子任务预算的 1.5 倍

**暂停后做什么**：主 Agent 把子任务当前进展拉出来，用 Flash 模型快速问三个问题——① 当前进展和目标还对齐吗？② 继续跑有希望完成吗？③ 需要用户介入吗？三个全「是」→ 继续执行，重置计数；任一「否」→ 写入 task/logs/ 标 `#checkpoint`，通知用户决定。处理逻辑记入 orchestrator/ 的 `checkpoint` 字段，跑多了之后同任务类型的阈值自动校准。

**实现分工**：

| 做什么 | 谁来做 | 为什么 |
|------|------|------|
| 监控步数/重试/token 是否超标 | OpenClaw `tools.loopDetection`（原生配置） | 必须实时计数，Skill 做不到 |
| 超标后暂停子 Agent、通知主 Agent | `globalCircuitBreakerThreshold` 触发熔断 | 同上，外部刹车 |
| 三问评估（Flash 模型判断） | Skill（SKILL.md 中 check 逻辑） | LLM 判断是 Skill 的长项 |
| 写入 task/logs/ 标 #checkpoint | task-record.sh（脚本） | 确定性机械操作 |
| 更新 orchestrator/ 阈值 | loop-check closure 模式 | 需要对比历史数据判断是否校准 |

### orchestrator/ 怎么决策

orchestrator/ 就是迭代的中枢。它不记原始数据，只记最优结论：

```
任务来了 → 主 Agent 先查 orchestrator/
  → 有同类任务的最优配置？直接用，跳过编排探索
  → 没记录？走 ao compose 生成新方案
  → 任务结束 → 对比本次和最优配置
    → 本次更好 → 覆盖
    → 本次更差 → 不动
```

它和 think.md 反思区的区别：think.md 反思区记「上次做了什么、踩了什么坑」，orchestrator/ 记「这类任务怎么配最优」。一个是经验日记，一个是决策手册。

### 复盘——不让做事的给自己打分

每次任务闭环后，主 Agent 切换到 Loop Agent 视角完成 ③④——角色隔离让执行者不给自己打分（非工程隔离，详见 [LIMITATIONS.md](./LIMITATIONS.md#known-limits)）。代价：每次闭环多消耗 ~3,000-5,000 token，中等以上任务占比不到 10%；简单任务（🟢）直接跳过 ③④。

> LLM 的评分本身有波动——同一组配置跑两次可能差 1 分。应对：看趋势不看单次、淘汰门槛设高（连续 3 次 <3.0 才降级）、人工可覆盖。完整讨论见 [LIMITATIONS.md](./LIMITATIONS.md#known-limits)。

### 冷启动怎么办

新 Skill 装上、新任务类型出现——没有历史数据对照。前 5 次只记录不做判断，第 6 次起进入看趋势模式。完整推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#cold-start)。

### 评审者与执行者分离

闭环评分的评审者分离按平台分级实现——OpenClaw 用 `session.spawn` 工程隔离（可类比引用 Self Harness 的方向性结论）；非 OpenClaw 是 prompt 级约束（无机制保障，效果未实测，不引用具体数字）。

> 完整实现细节与诚实声明见 `loop-check.md` closure 模式 §平台分级评审；设计权衡见 [LIMITATIONS.md「复盘评分是 LLM 自评」](./LIMITATIONS.md#复盘评分是-llm-自评评审者与执行者不分离)。

以上是 sofagent 跑起来之后的自我进化逻辑——从 Skills 评分到编排模板，全自动迭代。但在一切开始之前得先把它装上——接下来讲怎么装、在不同平台上怎么跑。

---

## 六、反思工程

> 负责的子 Skill：`loop-check` closure 模式 → 反问「有什么值得记住的」→ 写入 `think.md` 反思区。

### 每次任务结束，自问一句

任务闭环时（用户确认完成、/new、/reset），主 Agent 自问：「这次有什么值得记住的？」

有 → 写一条 ≤200 字的日摘要到 `think.md` 反思区。没有 → 跳过。简单直接。

> 💡 **核心度量**：一个记忆条目的价值 = 它在未来任务中被检索并有效辅助决策的次数。不是「存了多少」，是「用了几次」。

### 反思什么

前面几章的产出汇到这里——编排产生了 task/logs，模型选择决定了成本，Skills 产出了使用记录，A/B 测试产出了最优拆法。反思把这些汇总提炼。

| 来源 | 提取什么 | 写不写 |
|------|------|:--:|
| task/logs 当天文件 | 做了什么任务、拆了几个子任务、结果如何 | ✅ 必写 |
| think.md 新增反思 | 反思标题 + 标签 + 置信度 | ✅ 有则写 |
| scoring.md 使用记录 | 哪个 Skill 使用次数变化、社区评分更新 | ✅ 有变化则写 |
| orchestrator/ 新决策 | 最优拆法或配置变化 | 🔶 有变化则写 |

每条摘要末尾带来源标记（`← task/logs/YYYY-MM-DD.md`），怀疑有误时按路径翻原始记录。

日摘要的压缩原则：保留「变化」、省略「正常」、合并「重复」、标记「失效」。旧事实被新事实替代时，不直接覆盖——标 `[已失效] → 新事实 | 原因`，保留替代关系方便回退。

### 反思区 / 归档区 + 智能权重

反思写入 `think.md` 后，不是全部进加载链。中间加一层筛选：只把权重 ≥0.5 的摘要放进反思区（≤2K token），其余丢进归档区。权重计算逻辑详见 [ARCHITECTURE.md](./ARCHITECTURE.md#weight-gate)。

```
think.md
├─ ## 反思区（进加载链，≤2K token）
│  ├─ 最近 3 天的日摘要
│  ├─ 权重 ≥0.5 的历史摘要
│  └─ 当前项目上下文、用户偏好
│
└─ ## 归档区（不进加载链，Agent 按需查询）
   ├─ 历史日摘要
   └─ 历史摘要（权重 <0.5 或 超过 90 天）
```

每条摘要带一个权重标签，由 LLM 根据三个信号估算（新鲜度 + 反思关联 + 引用热度）。权重集中管理：≥0.5 进反思区，<0.5 进归档区。算法细节见 [ARCHITECTURE.md](./ARCHITECTURE.md#weight-gate)。

> ⚠️ 权重计算由 LLM 执行，同一组数据跑两次可能有 0.1 偏差。反思区的 ≤2K token 硬上限才是真正的安全阀。
> ⚠️ 反思分三种来源标记：[LLM自评]（纯模型判断，权重 ×0.3）/ [已验证]（有客观证据）/ [用户确认]（用户明确确认）。防止不准的自评通过 think.md 自我强化。详见 [Design §三](./ARCHITECTURE.md#反思自评的自噬风险)。

权重 <0.3 且超过 90 天的自动清理，不再占反思空间。已归档的记忆 30 天内不做二次评估——避免反复横跳浪费 token。

### think.md 反思区的自我纠正

三道防线：只存经验不存指令 → 反思区 2K token 硬上限 → 人工可清除。写入前扫指令性关键词（应该/必须/不要/禁止/切忌/务必/严禁/应当/请/一定要），命中 ≥3 处提醒拆到 rules.md。不自拒写、不自动改——最终判断交用户。完整防线详解见 [ARCHITECTURE.md](./ARCHITECTURE.md#self-correct)。

### 审计：从记忆回溯到原始证据

如果怀疑 think.md 反思区有错误，不用猜——每条反思都带了来源标记，沿着标记翻回原始 task/logs 就能确认。三层审计链：

```
反思区 → 归档区 → task/logs 原始账本
（答案）   （历史）   （证据：只追加、不可改）
```

task/logs 是水源，只追加不修改，永远可以回溯。不需要额外的审计工具——文件目录结构本身就是审计路径。

---


## 七、数据文件架构

你可以在 `.sofagent/` 下看到这些数据文件——部分存原始记录，部分存提炼结论，每次任务闭环后更新。按初始化依赖排列：

| 文件 | 干什么 | 加载 | 初始化时机 | 模板 |
|------|------|:--:|------|------|
| `think.md` | 反思摘要，每次会话加载，≤2K token | 全文 | 首次加载 | [模板](sofagent/data/think.md) |
| `rules.md` | 你的运行规范（含项目目标、验收标准、风险边界、停止条件），优先级最高 | 全文 | 安装时部署 | [模板](sofagent/rules.md) |
| `task/plans/` | 任务计划 | 日期文件名 | 第二轮澄清时 | [模板](sofagent/data/task.md) |
| `task/logs/` | 执行日志 | 日期目录树 | 首次闭环后 | [模板](sofagent/data/task.md) |
| `scoring/` | Skill 评分记录 | 树形 | 首次任务后 | [模板](sofagent/data/scoring.md) |
| `orchestrator/` | 最优拆法决策 | 树形 | 同类任务 ≥3 次 | [模板](sofagent/data/orchestrator.md) |
| `orchestrator/workflows/` | ao compose 生成的 YAML | 按任务名平铺 | 每次 ao compose | — |

### 数据流向总结

```
每次任务闭环
  │
  ├─→ think.md 反思区  ← 提炼反思摘要
  ├─→ scoring/        ← 更新 Skill 评分
  ├─→ orchestrator/   ← A/B 对比后覆写最优拆法
  └─→ task/logs/      ← 原始执行记录（只追加）
```

> 💡 task/logs 是所有数据的源头。think.md（反思）、scoring.md（技能目录）、orchestrator/（作战手册）从中各自提炼结论，think.md 反思区汇总反思后的经验。

树形加载的设计逻辑见 [ARCHITECTURE.md](./ARCHITECTURE.md#tree-loading)。

---

### 维护规则

> ⚠️ 本手册是 `sofagent/` 目录下所有模板文件的**唯一事实来源**。以下规则确保模板与手册永不脱节：

1. **手册变更 → 同步模板**：每次 Handbook 内容更新（特别是 [Handbook §二](./HANDBOOK.md#二三层加载链) 加载链、[Handbook §三](./HANDBOOK.md#三底线与铁律) 铁律、[Developer §七](#七数据文件架构) 数据文件架构）后，必须逐份审查 `sofagent/` 下的全部模板文件（`SKILL.md`（宪法内联）、`rules.md`、`think.md`、`task.md`、`orchestrator.md`、`scoring.md`），确保与手册描述一致
   > 📎 `SKILL.md`、`entry-gate.md`、`task-aware.md`、`task-closure.md` 不在此列——它们是程序文件（入口 + 子 Skill），不属于模板文件范畴。
2. **模板格式变更 → 反向更新手册**：如果模板的结构或内容需要调整，先在 `sofagent/` 改好，再反向更新手册中对应的示例/描述
3. **sofagent/ 文件是用户的第一触点**：它们是 `install.sh` 复制到用户 `~/.openclaw/` 的目标文件。手册是说明书，sofagent/ 是产品——说明书写错了用户可能不会发现，产品文件错了用户会直接踩坑
4. **每次发版前跑一遍对照检查**：打开 [Handbook §二](./HANDBOOK.md#二三层加载链) 的 3 层表格和 [Developer §七](#七数据文件架构) 的模板示例，逐行对照 sofagent/ 下的全部 6 个模板文件

> 📎 一句话：**手册改了，模板必须跟着改。反过来也一样。**

> 💡 v0.7x 企业合规三件套（日志脱敏 / 数据保留 / 审计日志）的系统设计详见 [docs/system_design.md](./docs/system_design.md)——含 sanitize 脱敏链、cleanup 清理逻辑、audit 审计流的完整架构说明。

### sofagent 四层记忆模型（对照 Agent 记忆机制设计指南）

> 来源：「Agent 记忆机制设计指南」(2026-06-20)。核心判断："记什么比存多少更重要"。

四层映射：当前窗口（平台 session）→ 近期摘要（`think.md` 反思区 ≤2K token）→ 用户档案（`rules.md` `key: value`）→ 历史事件（`task/logs/` + `orchestrator/`）。三层原则：① 写入——记稳定模式/重复错误/用户确认的偏好，不记单次异常和 LLM 推测；② 更新——冲突时检测→合并或覆盖，非简单追加；③ 遗忘——`cleanup.sh` 定时清理，缺低价值自动压缩。

**已知局限**：think.md 当前为追加模式，不具备冲突检测和合并能力——3 条矛盾反思可并存。规划版本 v0.9。

---

