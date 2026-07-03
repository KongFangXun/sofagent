---
tags: [架构, Ralph循环, git-diff, 审计, OODA, 状态外化, prompt工程, 双引擎, 审计引擎]
---

# sofagent Architecture

> sofagent 的设计决策记录——从 Harness 层的工程约束到五层架构的取舍。
>
> > v0.99.5 · 2026-07-01 · 孔放勋

<img src="images/sofagent.png" alt="sofagent" width="300" />

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
### 两层架构：地基 vs 引擎

sofagent 分两层——地基轻、引擎重：

| 层 | 是什么 | 何时激活 | 占用 |
|:--:|------|:--:|:--:|
| 地基 | 三层加载链（宪法+反思+fde）| 每个会话启动，永远在线 | 上下文预算的 2-3% |
| 引擎 | FDE 进场一次性生成 workflow + 定期 A/B 重优化 | FDE 部署时 / 定时触发 | ~800 token |

如果加载链只在复杂任务时才激活：think.md 反思区不在上下文 → Agent 重复犯错；fde.md 不在上下文 → 简单任务时用户偏好全部失效。三层加载链必须永远在线。

### 产品架构展望（五层）

| 层 | 部署在哪 | 干什么 | 当前状态 |
|:--:|------|------|:--:|
| **Harness 层** | Agent 上下文 | 纯 MD 文件，Agent 读即生效 | ✅ 已可用 |
| **执行层** | 用户设备 | daemon 常驻进程——跨 session 经验不丢失 | ✅ v0.81 |
| **审计层** | git 仓库 | sofagent-audit——提交时审计 git diff | ✅ v0.92 |
| **MCP 推送层** | 设备 MCP server | MCP Server 已拆分为独立包 @sofagent/mcp（v0.99.1，当前 v0.99.5），推送待端到端验证 | v0.99.4 MCP Server |✅ |
| **协同层** | 多设备 + 云端 | 组织级 Agent Harness——Agent 以独立身份进入协作现场，共享上下文 + 组织记忆 + 主动参与 | v2.x 规划 |

每层跑通再加下一层——不推翻已验证的东西。

### 审计层的证据分层：信任产出，不信任过程

审计层核心设计来自三个独立来源的收敛——Ralph Loop「Agent 失忆，文件不失忆」、MiroFish「工具调用与最终答案严格分离」、卡普「99.9% 确定性刚需」二分法。三者指向同一结论：**git diff 是最终答案（硬证据），Agent 日志是工具调用过程（软证据）。**

| 证据源 | 依赖 Agent 配合 | 可绕过 | 判定精确度 |
|------|:--:|:--:|:--:|
| git diff（硬证据）| ❌ 不依赖 | ❌ 不可绕过 | 高 |
| Agent 日志（软证据）| ✅ 需要 Agent 写入 | ✅ 可伪造 | 中 |

**设计后果**：`--silent` 模式只跑纯 git-diff 规则（零依赖 Agent 配合）；完整模式交叉对比两种证据；新规则优先加 git-diff 规则。底线：**审计工具在零 Agent 配合下仍然有判定能力。**

> 🔮 **v1.1 方向：事后→事前（双闸验证）**。当前审计是事后 diff（Agent 改完了再查）。自然的进化是在执行前加一道闸——**执行前验证**（Agent 计划改什么→规则预判是否允许）+ **副作用写回前再验证**（改完没提交→再扫一遍）。双闸不是替代事后审计，是和事后审计互补——事后审计永远是最硬的证据，双闸让违规在发��前就被拦住。

### 四条设计原则

> 1. **「吃下痛苦，排出产品」**——Agent 的管理痛苦由 sofagent 消化，产出的 Harness 规则企业敢放进流程里
> 2. **「模型输出是提案，不是命令」**——Agent 每次代码改动是提案，git diff 是证据，审计工具验收
> 3. **「先有掌控感，再自动化」**——install → verify.sh 确认约束生效 → 然后才能放心交给编排引擎
> 4. **「状态最贵」**——Harness 层总占用承诺不超过窗口 5%（当前约 2.5%）。用文件外化状态，用 git diff 替代 Agent 记忆

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

#### 编排层为什么需要 OpenClaw

编排引擎要做三件事，目前只有 OpenClaw 的 Hook + session 机制能做到：

1. **自动加载约束**——OpenClaw 的 `sofagent-load-chain` hook 在 Agent 启动时注入约束文件，不依赖 Agent "自觉去读"
2. **session 隔离**——OpenClaw 的 `session.spawn` 创建独立子 Agent 跑 workflow 节点，主 Agent 不受污染
3. **断路器**——OpenClaw 的 `tools.loopDetection` 在 Agent 死循环时硬停止

实测过 WorkBuddy / Codex / Claude Code——Hook 注入不可控、session 无法外部隔离、sub-agent 不能外部管理。不是「选择独占 OpenClaw」，是其他平台不开源到这个程度。

但注意：编排层是给 FDE workflow 节点用的，不是给企业员工的日常 Agent 用的。企业员工不需要感知 OpenClaw——它只在后台跑 FDE 部署的 workflow 节点。

#### 两种使用模式

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

sofagent 自身的开发过程本身就是这一循环的活体验证——两个模型（GLM + DeepSeek）自循环 loop：GLM 定框架 → DeepSeek 写实现 → GLM 审查 → DeepSeek 修复 → 下一轮。

---

## 二、核心设计决策

### 500 字原则

加载链的理想设计是每份文件 ≤500 字（Agent 压缩后可读的最低保证）。当前 SKILL.md ~2,000 字、fde.md ~1,700 字——远超目标，是 v1.x 计划解决的技术债。超过 500 字 Agent 遵守率明显下降——规则在长文本里会被淹没。500 字不只是「让 Agent 好好读」，更是「让 Agent 在被压缩后还能读到」。

> **污染理论**：agents.md 的每个字节在每次 Loop 中被反复消耗——一份臃肿的 agents.md 会污染未来每一轮的上下文。500 字原则不仅省 token，更是「降低所有未来 Loop 的持续污染成本」。

### 三层加载链：为什么是这个顺序

从契约到执行，三层按「能不能改」分级：

| 层 | 文件 | 权限 |
|:--:|------|:--:|
| 1 | 契约层（`SKILL.md`） | ❌ 千万别碰 |
| 2 | 反思层（`think.md`） | ⚠️ 自动生成，改了没用 |
| 3 | 执行层（`fde.md`） | ✅ 随便改 |

加载顺序受 Lost in the Middle 约束：SKILL.md 放最前面（开头注意力最高），fde.md 放最后面（末尾注意力最高）。

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

### 编排开销的经济学

Loop 机制每次任务多消耗约 2,000–5,000 token（窗口的 2–4%）。值得花——跑一次多花的 token，后面十次省回来了。token 价格长期往下，每降一个数量级，编排开销占比就缩一个数量级。

### A/B 测试为什么不是一次性评估

编排引擎在 FDE 进场时生成第一版 workflow（current）。运行一段时间后，定期触发重新编排生成 candidate，用 `sofagent-orchestrate-compare` 做确定性对比——从 task/logs 中提取运行次数、违规率、步数、通过率四项客观指标，不由 Agent 主观判断。单次对比后标记胜出方，连续两次胜出目前需手动二次运行确认。⚠️ 连续胜出判断为 TODO(v1.1)——当前只做单次对比，需手动执行两次后人工决策。v1.1 计划实现自动连续胜出计数器，旧方案归档进 history/。

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

> 路线图详见 [ROADMAP.md](./ROADMAP.md)。

- **v0.9x**：安全审查 ✅ → 审计层（sofagent-audit）
- **v1.x**：daemon TypeScript 化
- **v1.0 定位**：Agent 工作验收工具（正式）+ Harness 层（实验）+ FDE 部署框架（规划）。审计层跨平台、零 Agent 依赖——是 v1.0 的主产品
- **v1.x**：Skill 自进化验证门控（A/B 对比 + 外部评估器）
- **v2.x**：组织级 Agent Harness——Agent 独立身份 + 组织共享记忆 + 主动协作参与 → FDE 完整形态

**两个原则性警告**：①「不要让智能体自我验证」——根治需 v1.x 外部评估器；②「Agent 越强，闸门越重要」。

> **范围声明**：sofagent 覆盖 Agent 质量层（代码纪律 + 审计 + 经验沉淀），不覆盖运维层（监控/告警/重启/日志轮转）。

---

## 五、参考与致谢

| 来源 | 启发 |
|------|------|
| **OpenClaw** | 运行平台——加载链、Hook、Skill 系统、session 隔离 |
| **DeepSeek + GLM** | 模型引擎——所有文件由二者配合生成 |
| **Addy Osmani** | Loop Engineering 五大件架构 |
| **Anthropic** | Managed Agents 四层架构——核心设计哲学源头 |
| **agency-orchestrator** | `ao compose` 意图识别→任务图生成→模板匹配→分配 |
| **Andrej Karpathy** | 思考先行、简约至上——铁律在此基础上扩展 |
| **Geoffrey Huntley** | Ralph Loop——「Agent 失忆，文件不失忆」哲学 |
| **MiroFish** | 「工具调用与最终答案严格分离」模式 |
| **Nelson F. Liu et al.** | *Lost in the Middle*——500 字原则和加载链顺序的科学依据 |
| **AI 代码审查实验（146 PR × 4 AI Reviewer）** | 93.4% 问题仅被单一 AI 识别——多视角评估不是 nice to have |
| **Google Cloud Code 论文** | Agent 运行时 7 组件架构 |
| **Hirom 定律 + Lima 演化定律** | 「先读再用」「验证再干」「谨慎修改」的理论根基 |

---

> 这份设计文档是开放的。如果你觉得哪个设计决策有问题——开 Issue，直接说。
