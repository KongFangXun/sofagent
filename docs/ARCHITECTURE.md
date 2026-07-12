---
tags: [架构, Ralph循环, git-diff, 审计, OODA, 状态外化, prompt工程, 双引擎, 审计引擎]
---

# sofagent Architecture

> sofagent 的设计决策记录——从 Harness 层的工程约束到五层架构的取舍。
>
> > v1.0.4 · 2026-07-11（UTC）· 孔放勋

<img src="sofagent.png" alt="sofagent" width="300" />

---

## 目录

- [术语对照](#术语对照)
- [一、为什么会有 sofagent](#一为什么会有-sofagent)
- [二、核心设计决策](#二核心设计决策)
- [三、诚实坦白：已知局限](#三诚实坦白已知局限)
- [四、未来方向](#四未来方向)

---

## 术语对照

| 对外（读者看到的） | 对内（工程内部） | 说明 |
|------|------|------|
| 约束底座 | harness 层 | 约束 Agent 行为的规则和文件 |
| FDE 工具包 | FDE toolkit | FDE 随身的工具包 |
| 审计引擎 | audit engine | git diff 硬证据审计 |
| 编排引擎 | orchestration engine | 任务拆解 + workflow 生成 |
| 加载链 | load chain | Agent 启动时注入的三层约束文件 |

---

## 一、为什么会有 sofagent

提示工程管「说什么」，上下文工程管「知道什么」，约束工程管「跑在哪」。sofagent 管最后一步：跑完谁验收。

> 💡 **从 SOP 到 Harness 层**：传统 SOP 保底 60 分，代价抹平一线差异。AI 时代每个节点自带个性化上下文——sofagent 不是给 AI 写 SOP，是装缰绳，让它在个性化上下文里跑出 85-90 分而不越界。（Rolling AI 服务 100+ 企业的观察，详见 FDE 认知框架。）
>
> sofagent 的架构基因来自 Geoffrey Huntley 的 Ralph 循环——「Agent 失忆，文件不失忆」。Agent 的记忆长在文件系统（git diff / task/logs / SKILL.md），不长在 Agent 内部。审计层优先信任 git diff（硬证据），不信任 Agent 日志（软证据）。通用 Agent 平台解决「会不会做」的能力问题，sofagent 解决「能不能每次都按规则稳定做对」的执行控制问题——二者是上下层关系，不替代。

### 理论基础与外部验证

> 💡 以下为核心理论支撑，完整引证列表见 [THANKS.md](./THANKS.md)。

> **Harness 的实验验证**：2026 年 Hugging Face 实验——同一 DeepSeek-v4-pro 不改权重，仅优化外层 Harness，法律 Agent 基准从 3.5%→80.1%，追平 Claude Sonnet 4.6，成本仅 1/7。Benchmark 测的从来不是裸模型，是「模型 + Harness」的组合能力。**对齐税**：模型同质化时代，Harness 层就是新的护城河。

> **三代演进——行业共识**：AI 应用技术分三代：提示工程（管「说什么」）→ 上下文工程（管「知道什么」）→ 驾驭工程（Harness，管「跑在哪」）。2026 年工业落地证据：LangChain benchmark 30→top5、Codex 7 人 100 万行——不改模型权重、靠 Harness 层实现。

> **Loop Engineering 的方法论验证**：Karpathy AutoResearch（9 万 Star）的约束文档 + 锁定评估脚本 + 自动循环——与 sofagent 的 fde.md + sofagent-audit + loop-check 对应。⚠️ AutoResearch 跑 700 次无人值守迭代，sofagent 当前是单任务内检查点循环。

### 为什么审计必须外置

Anthropic 发现 Claude 内部存在 **J-space**——AI 自己知道控制不住自己。所以 sofagent 不信任 Agent 自我报告，只看 git diff 硬证据。审计必须外置、不可绕过。

### 行业印证：Palantir 同构

Palantir AIP 未自研大模型，靠 **Ontology（本体）** 实现远超行业的 Agent 可靠性——定义实体→编织关联→赋予行动闭环。sofagent 完全对等：fde.md 定义实体，节点文档 frontmatter 编织关联，审计引擎写 think.md 赋予闭环。差别在于：Palantir 能直接操作 ERP 改库存（Write-back），sofagent 目前只能影响 Agent 上下文注入——v2.x 方向。详见 [FDE/FDE.md](../FDE/FDE.md)。

> **根本接触不到 > 被告知不能说**：Palantir 的防幻觉不是"告诉 Agent 守规矩"，而是未配置的 Agent 根本看不到。sofagent 的 A15 约束验证 + 审计外置遵循同一原则。

### 外部借鉴与生态对齐

- 编排引擎借鉴 LangChain + DeepAgentsJS，Skill 借鉴 Agency Agents + SkillOpt，Ontology 借鉴 Palantir AIP
- OpenFDE 将「审计」列为 FDE 基础层，sofagent 的审计优先设计符合社区最佳实践
- gstack（YC CEO）的七步工作流（Think→Reflect）与 sofagent 审计外置 + 反思闭环对应

### 两层架构：地基 vs 引擎

sofagent 分两层——地基轻、引擎重：

| 层 | 是什么 | 何时激活 | 占用 |
|:--:|------|:--:|:--:|
| 地基 | 三层加载链（宪法+反思+fde）| 每个会话启动，永远在线 | 上下文预算的 2-3% |
| 引擎 | Workflow 梳理时生成节点定义 + 定期 A/B 重优化 | Workflow 梳理时 / 定时触发 | ~800 token |

如果加载链只在复杂任务时才激活：think.md 反思区不在上下文 → Agent 重复犯错；fde.md 不在上下文 → 简单任务时用户偏好全部失效。三层加载链必须永远在线。

### 产品架构展望（五层）

| 层 | 部署在哪 | 干什么 | 当前状态 |
|:--:|------|------|:--:|
| **Harness 层** | Agent 上下文 | 纯 MD 文件，Agent 读即生效 | ✅ 已可用 |
| **执行层** | 用户设备 | daemon 常驻进程——跨 session 经验不丢失 | ✅ v0.81 |
| **审计层** | git 仓库 | sofagent-audit——提交时审计 git diff | ✅ v0.92 |
| **MCP 推送层** | 设备 MCP server | MCP Server 已拆分为独立包 @sofagent/mcp（v0.99.1，当前 v1.0.4），推送待端到端验证 | ✅ v0.99.5 |
| **协同层** | 多设备 + 云端 | 组织级 Agent Harness——Agent 以独立身份进入协作现场，共享上下文 + 组织记忆 + 主动参与 | v2.x 规划 |

每层跑通再加下一层——不推翻已验证的东西。

### 审计层的证据分层：信任产出，不信任过程

审计层核心设计来自三个独立来源的收敛——Ralph Loop「Agent 失忆，文件不失忆」、MiroFish「工具调用与最终答案严格分离」、卡普「99.9% 确定性刚需」二分法。三者指向同一结论：**git diff 是最终答案（硬证据），Agent 日志是工具调用过程（软证据）。**

| 证据源 | 依赖 Agent 配合 | 可绕过 | 判定精确度 |
|------|:--:|:--:|:--:|
| git diff（硬证据）| ❌ 不依赖 | ❌ 不可绕过 | 高 |
| Agent 日志（软证据）| ✅ 需要 Agent 写入 | ✅ 可伪造 | 中 |

**设计后果**：`--silent` 模式只跑纯 git-diff 规则（零依赖 Agent 配合）；完整模式交叉对比两种证据；新规则优先加 git-diff 规则。底线：**审计工具在零 Agent 配合下仍然有判定能力。**

> 🔮 **v1.0.1 方向：事后→事前（双闸验证）**。当前审计是事后 diff（Agent 改完了再查）。自然的进化是在执行前加一道闸——**执行前验证**（Agent 计划改什么→规则预判是否允许）+ **副作用写回前再验证**（改完没提交→再扫一遍）。双闸不是替代事后审计，是和事后审计互补——事后审计永远是最硬的证据，双闸让违规在发生前就被拦住。

> 🔮 **v1.x 方向：权限风险分级**。当前 entry-gate.md 是单层权限清单（能做/不能做二分）。Human-in-the-Loop 审批工程的进化方向是按风险分三级：🟢 低风险（文件读写/查询）自动放行 / 🟡 中风险（git 操作/安装包）需确认 / 🔴 高风险（删数据/部署/外部 API）必须人工审批。风险分级不是增加审批摩擦，是让低风险操作更快通过的同时，把人工注意力精准投放到高风险节点。

### 四条设计原则

> 1. **「吃下痛苦，排出产品」**——Agent 的管理痛苦由 sofagent 消化，产出的 Harness 规则企业敢放进流程里
> 2. **「模型输出是提案，不是命令」**——Agent 每次代码改动是提案，git diff 是证据，审计工具验收
> 3. **「先有掌控感，再自动化」**——install → verify.sh 确认约束生效 → 然后才能放心交给编排引擎
> 4. **「状态最贵」**——Harness 层总占用承诺不超过窗口 5%（当前约 2.5%）。用文件外化状态，用 git diff 替代 Agent 记忆

### 设计原则的理论支撑

四条原则不是拍脑袋——每条背后有独立的理论/工程/经济学论证：

**「状态最贵」的 CS 理论基础**。计算机科学只有两个难题——缓存失效和命名——本质上全部指向状态问题。状态带来三个无法回避的工程痛点：会过期（数据一致性）、会冲突（多进程死锁）、难复制（分布式同步）。HTTP 协议是"无状态即无限规模"的最佳案例：每次请求独立自包含，服务器处理完即遗忘，这个看似笨拙的设计支撑了全球互联网 30 年的规模扩张。sofagent 选择 Ralph Loop 无状态范式（Agent 失忆，文件不失忆），不是哲学偏好，是分布式系统的工程最优解。

**「模型输出是提案」的随机过程理论基础**。传统心智模型把大模型当作员工——设定角色、塞满上下文、追求单次调用完成任务。更精确的心智模型是把大模型当作带噪声的随机过程——不试图消除随机性，而是用循环驯化随机性。

类比退火算法的变异机制，将 git diff + 审计规则作为适应度函数。「修 Harness 不修 Model」本质上是在搭建进化环境——约束底座不是约束聪明的下属，是为带噪声的随机函数提供适应性压力。

**反认知投降的制度设计**。当 AI 能力过强时，人类会不自觉进入「认知自动驾驶」——不再有独立观点、不再形成判断、放弃思考主动权。这不是懒惰，是认知卸载的本能陷阱。sofagent 的三道制度护栏确保人类永远是最终决策者：

| 护栏 | 防什么 | 怎么防 |
|------|--------|--------|
| fde.md 规则可随时覆盖 | AI 的判断替代人类意志 | 人类写一条规则，AI 必须遵守 |
| 编排方案可回滚 | AI 的方案先斩后奏 | 人类不确认，编排不执行 |
| 审计引擎独立于 Agent | AI 自己验收自己 | git diff 硬证据，Agent 无法篡改 |

**90%/10% 价值分层**。模型能完成 90% 任务，但剩余 10% 不可预测失误 = 只能做助手，不能做自主系统。关键规律：**模型越强，90% 常规任务范围越广，但剩余 10% 高风险场景价值反升**。约束底座（审计 + 验证 + 复盘）占据的正是那 10% 高价值环节——模型越强，约束底座越值钱。

**理解债务与意图债对称**。意图债是输入端反复交代项目背景的成本（SKILL.md + fde.md 在还这笔债）。理解债务是输出端的对称概念——AI 产出后，人类需要理解 AI 做了什么、为什么这样做、哪里可能出问题的认知成本。Go Mode 下 Agent 一次性交付大量产出，理解债务爆发式增长；Loop 模式下 Agent 逐步展示迭代过程，理解债务被分摊到每一轮。think.md 的任务反思区（每步记录：看到什么/改了什么/验证了什么/还剩什么）是偿还理解债务的工程机制。工程定量参照：Anthropic 数据显示 AI 带来 4 倍代码量但仅 12% 价值增量，差值部分即理解债务的隐性成本。

### 为什么是 Skill + 脚本 + Runtime

| 什么事 | 谁来做 | 为什么 |
|------|------|------|
| 判断（评分、反思、选模板） | Skill（MD prompt 文件） | LLM 的长项——模式识别、定性判断 |
| 机械操作（文件读写、API 调用） | 脚本（bash） | 确定性操作——复制、拼接、计数 |
| 硬安全（加载链、断路器） | OpenClaw 原生配置 | Agent 失控时没法自己管自己 |

LLM 管判断、脚本管执行、Runtime 管刹车——天然的分界。

### OpenClaw 在架构中的角色

#### 审计层不需要 OpenClaw

sofagent-audit 是一个 TypeScript CLI。它的输入是 git diff，输出是 exit code。它不关心代码是谁写的——Cursor 写的、Codex 写的、人写的，都一样。pre-commit hook 在 `git commit` 时自动触发，跟 Agent 无关。

这意味着：即使不装 OpenClaw，审计层照样能工作。企业团队今天就能 `npm install -g @sofagent/audit`，配 pre-commit hook，让所有 Agent（不管什么平台）的提交都经过审计。

#### 编排层当前状态

编排引擎当前依赖 `ao compose`（agency-orchestrator）做任务拆解。`launcher.ts`（v1.0.4）作为 DeepAgents 的接入层已就绪——但当前仅是 optional wrapper（68 行），编排逻辑仍走 ao CLI。

**正在迁移**（[ROADMAP](./ROADMAP.md) v1.0.6-v1.0.7）：
1. v1.0.6：compose 从 ao CLI 迁到 DeepAgents，ao 降为 fallback
2. v1.0.7：ao 依赖移除，deepagents 提升为正式依赖，A/B 自动切换

迁移完成后，编排引擎不再绑定 OpenClaw——任何人用自己的 Agent 都能调用编排引擎。

> ⚠️ 之前的"v1.0.5 起 DeepAgents 原生解决"表述已在审查中修正——文档不跑在代码前面。

#### 两种使用模式

**核心认知：FDE 工具包本身就是 sofagent 产品的一部分。FDE 工作用自己产品，给别人部署完让别人也用自己产品。**

```
FDE = Forward Deployed Engineer
    │
    │  FDE 本身也是一个 workflow（12 步）
    │
    ├── FDE 工作（⚡ 强化节点）
    │   └── 工具 = sofagent 约束底座 + FDE Skill 工具包
    │       └── 用自己的 Agent（WorkBuddy / Codex）走 12 步
    │
    └── 给客户部署
        ├── 找台闲置设备装 sofagent 底座 ← 核心产品落地
        └── 上面跑客户的 AI 节点（客户自己的 workflow）
```

- **模式 A（FDE 自己用）**：FDE 用自己顺手的 Agent（WorkBuddy / Codex / Cursor）对话。当需要跑 FDE workflow 节点时，Agent 后台调用 OpenClaw 节点。OpenClaw 跑完后把结果返回给 FDE 的 Agent——FDE 全程看不到 OpenClaw 的 UI，它是一个后台 AI 节点。

- **模式 B（企业设备上的 FDE 工具包）**：FDE 帮企业部署完后，企业闲置设备上装 OpenClaw + sofagent，搭成一个 harness 层，上面跑 AI 节点。企业自己采购的 Agent（WorkBuddy / Codex 等）也装在这台设备上——**Agent 不跑在 OpenClaw session 里**。sofagent 对企业 Agent 的审计走**文件系统层 + git pre-commit hook**：Agent 各自独立运行，各自用自己的 git 仓库，commit 时 hook 自动触发 sofagent-audit。Agent 完全不感知 OpenClaw。相当于：OpenClaw 是地基，其他 Agent 是住在上面的租户，sofagent 是物业管理。租户爱干嘛干嘛，物业管的是楼的安全。

选 OpenClaw 的技术理由：开源 + Node.js（技术栈一致）、原生编排（AO compose → DAG 执行）、Agency Agent 兼容（233 个岗位模板）。技术选型演进：bash → Node.js/TS——Harness 层（纯 MD 规则，无代码）、审计/验证/编排迁移到 TS（npm 包 8 个 bin），OS 集成层（install/daemon）保持 bash。

### 白盒循环

Claude Code 的 `/goal` 是纯黑盒——目标给出去 Agent 闷头跑，方向歪了交回来的不是想要的。sofagent 把黑盒变成白盒：

| sofagent 扩展的 | /goal 原版 | 为什么 |
|------|------|------|
| 用户确认 | 循环自主跑到底 | 不敢让它黑盒跑——先看一眼提案再执行 |
| 规则/数据分离 | 没明确切分 | SKILL.md 规则层，Agent 碰不了；scoring.md + think.md 数据层，Agent 自己进化 |

白盒的关键不是加了确认按钮，是**用户和 Agent 一起把目标定清楚，再启动编排**。

### 模型与 Harness 的博弈

模型会吃掉一部分 Harness——任务拆解、上下文选择、工具调用这些能力模型自己越来越强。但生产级 Harness 从「外部脚手架」升级成「生产级 Agent 运行基础设施」。**Agent 越强，闸门越重要。**

---

## 二、核心设计决策

### 500 字原则

加载链的理想设计是每份文件 ≤500 字（Agent 压缩后可读的最低保证）。当前 SKILL.md ~2,000 字、fde.md ~1,600 字——远超目标，是 v1.x 计划解决的技术债。超过 500 字 Agent 遵守率明显下降——规则在长文本里会被淹没。500 字不只是「让 Agent 好好读」，更是「让 Agent 在被压缩后还能读到」。行业数据：上下文占用达窗口 60% 时模型性能开始衰减（Croco 51 万行代码泄露分析）——500 字原则的本质是在腐烂阈值之下运行。

> **污染理论**：agents.md 的每个字节在每次 Loop 中被反复消耗——一份臃肿的 agents.md 会污染未来每一轮的上下文。500 字原则不仅省 token，更是「降低所有未来 Loop 的持续污染成本」。

### 措辞心理学：长度之外还有强度

500 字原则管「长度」——Rule 的字数。但同等重要的维度是「强度」——Rule 用什么语气写。Superpowers（GitHub 23.9 万星 Skill 项目）通过 2.8 万次对话实测发现：**将铁律措辞从「建议/应该」升级为「必须/绝无例外」后，AI 服从率从 33% 提升到 72%——翻倍。** 规则内容完全相同，仅措辞强度不同。

这不是「写得狠」，是 prompt 工程的底层规律——LLM 对强语气（must / 绝无例外 / 违反即失败）的注意力权重高于弱语气（建议 / 应该 / 尽量）。sofagent 的铁律措辞应遵循同一原则：**在上下文预算允许的前提下，用最高强度可用措辞写关键铁律。**

长度和强度之外，还有第三个维度——**预判**。Addy Osmani 的 [agent-skills](https://github.com/addyosmani/agent-skills) 在每个规则下附「反合理化表」：列出 Agent 跳过步骤时的常见借口，逐一驳回。sofagent fde.md 采用了相同设计——铁律告诉 Agent「该做什么」，反合理化表告诉它「别找借口」。

### 三层加载链：为什么是这个顺序

从契约到执行，三层按「能不能改」分级：

| 层 | 文件 | 权限 |
|:--:|------|:--:|
| 1 | 契约层（`SKILL.md`） | ❌ 千万别碰 |
| 2 | 反思层（`think.md`） | ⚠️ 自动生成，改了没用 |
| 3 | 执行层（`fde.md`） | ✅ 随便改 |

加载顺序受 Lost in the Middle 约束：SKILL.md 放最前面（开头注意力最高），fde.md 放最后面（末尾注意力最高）。

### 数据层：AI 知识库（v1.0.1 实现）

五层架构是**功能引擎层**——每层有输入、处理、输出。AI 知识库是**数据层**——它是五层引擎运转过程中沉淀的知识目录，本身不做处理。硬塞进五层维度不匹配，就像把「数据库」当成微服务架构里的一个「服务」。

#### think.md vs AI 知识库对比

| 维度 | think.md（反思层） | AI 知识库（沉淀层） |
|:--|:--|:--|
| 注入机制 | 加载链被动注入 | 加载链被动注入（top-N 相关页） |
| 内容 | 单次任务的反思教训 | 跨任务的模式、最佳实践、对比 |
| 结构 | 扁平时间线 | AI 知识库页面（双向链接） |
| 生命周期 | 旧了压缩 | 持续积累，越用越值钱 |

AI 知识库不替代 think.md——两者职责不重叠。think.md 是「上次踩了什么坑」，AI 知识库是「这个领域我们积累了什么最佳实践」。详见 [v1.0.1 开发日志](./changelog/v1.0.1.md)。

### 生产者-消费者架构（v1.0.5 文档化）

knowledge/ 的数据流遵循生产者-消费者解耦模式（与 Google OKF 同构）：

| 角色 | 组件 | 职责 |
|------|------|------|
| **生产者** | daemon Ingest（task/logs 变化 → 触发知识提取） | 写入 knowledge/ 页面 |
| **生产者** | knowledge-maintain Skill（session 结束时的结构化总结） | 写入 entities/ concepts/ |
| **消费者** | 加载链第 4 层（knowledge/index.md → top-3 页摘要） | 注入上下文 |
| **消费者** | Agent 决策前查询（读 index.md → 找到相关页面 → 读详情） | 自主检索 |
| **Lint** | loop-evaluate（每周扫描：矛盾/过期/孤立页面） | 质量检查 |

生产者和消费者只通过 knowledge/ 目录交互——生产者不知道谁会读，消费者不知道谁写的。

> 💡 **设计对齐**：knowledge/ 的 entities（实体页）→ relations（frontmatter 关联字段）→ concepts（概念页）→ comparisons（对比页）四层结构，本质是**轻量级 GraphRAG**（Microsoft 2024）。区别在于用 Agent 遍历关联代替图数据库查询，用 .md 文件代替向量索引——零外部依赖，完全可审计，人类可以直接打开看。

> **核心原则——不可追溯即不可信任**：企业知识库最怕 AI 说了一句没人知道从哪来的话。只要不可追溯，业务就不信任。`.md` 文件 + git diff 审计确保每条知识都有来源、每次变更都有记录。

> **多重独立验证**：
> - **Google OKF**：同架构（Markdown + YAML Frontmatter + Git）+ 同数据流（生产者-消费者解耦）
> - **CAG（第 7 代 RAG，WWW '25）**：同方法——按主题整合→去重去冲突→规整 Markdown→全量输入 LLM
> - **Glean（Gary Tan / YC）**：工业数据——1.7 万页 Markdown、前 5 条召回 ~100%、比传统 RAG 提升 30%

> **进化方向——记忆分层金字塔（L0-L3）**：腾讯云开源的 TencentDB Agent Memory 提出了 4 层渐进蒸馏架构——L0 原始对话 → L1 原子事实 → L2 场景聚合 → L3 用户画像。每层向上压缩、向下可追溯。与 sofagent 的 think.md（L0）→ knowledge/entities（L1）→ knowledge/concepts（L2）→ 缺 L3 用户画像完全对应。未来方向：自动化 L1→L2→L3 提炼流水线 + SQLite 双轨存储（百万级事实用 DB 检索、千级结构用 MD 文件）。详见 [THANKS](./THANKS.md)。

### 三层时间尺度循环（Andrew Ng 框架）

> 来源：Andrew Ng 的 AI 产品进化框架。真正的产品进化不只来自内层循环（Agent 跑任务），更来自中层和外层。

| 层 | 时间尺度 | sofagent 当前覆盖 | 对应组件 |
|:--:|:--:|:--:|------|
| **内层** Agent Loop | 秒-分钟 | ✅ 已覆盖 | think.md + loop-check + 审计引擎 |
| **中层** 开发者反馈 | 天-周 | ⚠️ 部分 | loop-evaluate 跑完写 scoring.md，但评分→Skill 优化闭环未打通。v1.0.1 AI 知识库 Lint 驱动 Skill 自动迭代 |
| **外层** 用户反馈 | 周-月 | ❌ 未覆盖 | 企业用了一个月后，AI 节点变聪明了还是变笨了？v2.x 组织级共享记忆 + 知识库矛盾检测 |

**当前短板**：sofagent 目前只关注内层循环（Agent 跑任务→审计→反思）。中层的「审计结果怎么反馈给 Skill 优化」和外层的「企业用了一个月后怎么知道效果」是缺失环节。v1.0.1 的 AI 知识库 + Skill 自进化闭环补中层，v2.x 的组织级共享记忆补外层。

> 💡 **核心洞察**：Andrew Ng 提出「产品品味本质是上下文优势」——用户画像、业务边界、资源约束、竞品动态目前仍存储在人类认知中，AI 无法自主获取。因此开发者必须留在中层循环为系统补全关键上下文，而非试图跳过中层让 AI 直连用户。

> ⚠️ **诚实声明**：上表列的是终局目标，不是当前能力。sofagent 当前实际只覆盖内层。中层 v1.0.1 开始做，外层 v2.x 才涉及。

### 铁律为什么是 6 则

每一条对应日常使用中反复遇到的 Agent 失控行为——不是理论推演，是痛点积累：

| 问题 | 对应规则 |
|------|:--:|
| 做完了没回复 | #1 对用户有回应 |
| 越界改代码 | 审计 A3 不改越界 |
| 出错继续跑 | 审计 A8 不逃验证 |
| 不看文件就写 | 审计 A7 不存盲改 |
| 编造数据 | 审计 A5 不瞒真相 |

前 4 条源于 Karpathy 的 4 条编码原则，后 2 条是实战翻车经历的工程沉淀。

> **设计限制**：A14（知识库越权访问）是事后审计提醒（WARN 级），不是强制访问控制。它依赖 Agent 自行记录的 task/logs 来检测越权访问——如果 Agent 不写日志，A14 无法检测。企业级场景需要配合文件系统权限（如 OS 级别的目录隔离）实现真正的隔离。

### Loop Agent：三节点顾问模式

Loop 不是只发生在任务结束时——执行过程中同样需要停下来检查方向。三节点（checkpoint / failure / closure）覆盖「阶段切换」「进度过半」「高风险」三种场景。为什么是独立 Agent 而不是代码逻辑：Loop 需要读 think.md + task/logs + orchestrator/ 做综合判断——正是 Agent 的长项。

<a id="session-boundary"></a>
### Session 边界 / Worktree 隔离 / 编排产物

- **Session 边界**：用百分比（缓存≥50%，token≥70%）不用轮次——模型窗口在变大，轮次限制是刻舟求剑。
- **Worktree 隔离**：多子 Agent 并行操作同一仓库时用 git worktree 隔离——零额外依赖，git 原生能力。
- **编排产物**：`ao compose` 生成的 YAML 存到 `.sofagent/orchestrator/workflows/`——用户不用手写，看就行。

### Session 生命周期 / 多设备记忆管理 / 数据主权

企业 workflow 中的固定节点 Agent 反复执行同类任务，session 越滚越长会导致上下文爆炸。解决方案：记忆蒸馏（提炼关键决策+踩过的坑 → JSONL 持久化）→ 关闭旧 session → 新 session 轻装上阵。多设备场景：设备间通过 MCP server 暴露记忆索引，蒸馏记忆聚合到企业自有 NAS/云盘。**数据主权在设备**——所有记忆文件、task/logs、think.md 都只在设备本地。

### 不要写显而易见的事

核心原则：**不写模型已知的常识，只写它在这个任务上会犯的错、会漏的步骤、会搞错的数据格式。** Gotcha 章节比功能介绍有价值得多。

### 为什么选 DeepSeek

默认推荐 DeepSeek，两条底线决定：不碰 SaaS（API 模式数据不经过第三方）、成本可控（Loop 每次额外消耗不到 1 美分）。模型选择是开放的——任何支持 API 的模型都能用。

### Flash 干粗活、Pro 干细活：成本逻辑

Flash 和 Pro 差约 4 倍价，但简单任务 Flash 质量并不明显逊色。实现上是 OpenClaw 的 `sessions_spawn.model` 参数——API 级硬约束。

### 编排收敛条件：Loop 的生命线

编排引擎是 Loop 工程——任务到达后持续循环迭代，直到目标达成才终止。Loop 的核心是**收敛**：如果目标不具备收敛性，循环会无限运行直到耗尽所有资源成本。

收敛目标必须满足两个条件：

| 条件 | 说明 | sofagent 对应 |
|------|------|------|
| **可验证（Verifiable）** | 具备明确的可量化验证标准（测试覆盖率、AC 验收标准），避免模糊描述 | verify-evidence.sh + loop-check.md |
| **模型可自主价值判断** | 目标可通过 LLM 自带规则校验（字数限制、必须包含关键词），逐步聚拢到目标 | think.md 沉淀的规则 |

> 反面案例：设「优化页面美观度」这类模糊目标——Loop 会跑十几小时仍无法收敛判定。编排引擎的两轮澄清机制（第一轮目标确认→第二轮编排方案）正是为了避免不收敛目标进入 Loop。

> **Maker-Checker 分离是收敛的前提**：同一 Agent 自验的验证覆盖率仅 7-33%，但分离为独立审查 Agent 后提升至 73%。这不是 Agent 能力问题——是「裁判和运动员不能是同一个人」。sofagent 的审计引擎与编排引擎分离正是基于同一原则。

> **gstack 七步验证**：YC CEO Garry Tan 的 gstack（28 Skill + 7 Agent 角色）采用 Think→Plan→Build→Reveal→Test→Ship→Reflect 七步工作流，Reveal（独立审查 Agent 脱离原上下文校验）和 Reflect（经验沉淀到永久记忆库）与 sofagent 的审计外置 + think.md 反思完全对应。gstack 内置 `cloud.md` + `isos.md` 两份"宪法级"文件所有 Skill 运行前强制加载——等同于 sofagent 的 fde.md + 三层加载链。

### 编排开销的经济学

Loop 机制每次任务多消耗约 2,000–5,000 token（窗口的 2–4%）。值得花——跑一次多花的 token，后面十次省回来了。token 价格长期往下，每降一个数量级，编排开销占比就缩一个数量级。

### A/B 测试为什么不是一次性评估

编排引擎在 Workflow 梳理时生成第一版编排方案（current）。运行一段时间后，定期触发重新编排生成 candidate，用 `sofagent-orchestrate-compare` 做确定性对比——从 task/logs 中提取运行次数、违规率、步数、通过率四项客观指标，不由 Agent 主观判断。单次对比后标记胜出方，连续两次胜出目前需手动二次运行确认。⚠️ 连续胜出判断为 TODO(v1.0.1)——当前只做单次对比，需手动执行两次后人工决策。v1.0.1 计划实现自动连续胜出计数器，旧方案归档进 history/。

保守是因为 LLM 复盘有偏差——一次高分可能是运气，连续高分才可能是规律。CLI 工具的确定性对比消除了 Agent 自我评估的偏差。

> orchestrator/ 目录结构：current/（生产用）+ candidate/（候选方案）+ comparisons/（对比报告）+ history/（被替换的旧方案）

### 渐进初始化 / 复盘体系 / 反思区 / 权重门禁

- **渐进初始化**：`scoring.md` 和 `orchestrator.md` 部署时只有单文件，枝叶由子 Skill 在运行时按需创建——懒创建、动态分类、平台无关。
- **复盘体系**：从六维评分起步，逐步加入「流程合规」和「Loop 有效性」。Loop Agent 作为独立角色做复盘评估。看趋势不看单次。
- **反思区统一**：think.md 是合并后的「错题本」——教训和经历存储在同一个上下文中。覆盖而非追加。
- **权重门禁**：权重 ≥0.5 进反思区（≤2K token）。由新鲜度 + 反思关联 + 引用热度三个信号计算。2K token 硬上限是真正的安全阀。
- **自我纠正三道防线**：只存经验不存指令 → 反思区 2K token 硬上限 → 人工可清除。

### 文件系统而非数据库 / 树形加载 / 不要 Connector

- **文件系统**：`cat task/logs/` 就能拿到记录，不需要 SQL/连接串/权限管理。天然可审计、可传输、支持 Git。
- **树形加载**：orchestrator/、scoring/ 用树形目录 + 按需读取——读 `_index.md` → 定位分支 → 只加载叶子文件，总量不超过 100 行。
- **不要 Connector**：sofagent 的「外部世界」就是文件系统——文件就是接口，Markdown 就是传输格式。

---

## 三、诚实坦白：已知局限

> 18 条已知局限详见 **[LIMITATIONS.md](./LIMITATIONS.md)**。核心局限：Harness 层自身在上下文里、加载链步进脆弱性、复盘评分是 LLM 自评、Skill 自进化处于经验记录阶段、核心效果缺持续数据。

---

## 四、未来方向

> 路线图详见 [ROADMAP.md](../ROADMAP.md)。

- **v0.9x**：安全审查 ✅ → 审计层（sofagent-audit）
- **v1.x**：daemon TypeScript 化
- **v1.0 定位**：Agent 工作验收工具（正式）+ Harness 层（实验）+ FDE 部署框架（实验性）。审计层跨平台、零 Agent 依赖——是 v1.0 的主产品
- **v1.x**：Skill 自进化验证门控（A/B 对比 + 外部评估器）
- **v2.x**：组织级 Agent Harness——Agent 独立身份 + 组织共享记忆 + 主动协作参与 → FDE 完整形态
  - **多 Agent 共享记忆三模式**（未做决策）：黑板（中央共享，简单但单点瓶颈）/ Gossip（P2P 传播，容错但最终一致）/ 上下文路由（按需注入，精准但需匹配引擎）。实践中可能黑板打底 + 路由补充。详见 ROADMAP v2.x

**两个原则性警告**：①「不要让智能体自我验证」——根治需 v1.x 外部评估器；②「Agent 越强，闸门越重要」。

> **范围声明**：sofagent 覆盖 Agent 质量层（代码纪律 + 审计 + 经验沉淀），不覆盖运维层（监控/告警/重启/日志轮转）。
