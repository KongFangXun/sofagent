# sofagent Handbook

> **sofagent 是一个 FDE Agent——进场梳理你的工作流、部署 AI 节点、离场后 7×24 自己跑。** 装完之后，你在自己的 Agent（WorkBuddy / Codex / Claude Code）里说一句话，它就帮你干活——审计每次变更、沉淀每次经验、越用越好。下面从装到用到查问题，全流程走一遍。
>
> v1.3.7 · 2026-08-18（UTC）· 孔放勋

<img src="assets/sofagent.png" alt="sofagent" width="160" />

- [阅读指南](#阅读指南)
- [5 分钟速览](#5-分钟速览)
- [FDE Agent 能替你干什么](#fde-agent-能替你干什么)
- [心智模型：约束层与生命周期](#心智模型约束层与生命周期)
- [落地：装好就能派活](#落地装好就能派活)
- [运行：每次变更都被管住](#运行每次变更都被管住)
- [进化：知识自动沉淀](#进化知识自动沉淀)
- [常驻：长期自跑与持续优化](#常驻长期自跑与持续优化)
- [排查与自定义](#排查与自定义)
- [相关技术栈](#相关技术栈)
- [致谢](#致谢)
- [彩蛋](#彩蛋)

---

## 阅读指南

| 你是谁 | 先读哪 |
|------|------|
| 刚装上 | 落地 → 运行 |
| 日常干活 | 运行 → 排查与自定义 |
| 想改规矩 | 排查与自定义（改写 fde.md） |
| FDE 部署 / 持续优化 | 落地 → 常驻（完整方法论见 [FDE/GUIDE.md](../FDE/GUIDE.md)） |
| 想理解内部机制 | [开发文档](./DEVELOPMENT.md) |
| 想理解设计哲学 | [架构文档](./ARCHITECTURE.md) |
| 想理解为什么这么做 | [设计哲学](./PHILOSOPHY.md)（**强烈推荐，读 5 分钟**） |

> 📁 **项目文件导航**：根目录 6 个 .md 文件各司其职——[README.md](../README.md)（项目概览）、[README.en.md](../README.en.md)（英文概览）、[CHANGELOG.md](../CHANGELOG.md)（版本索引）、[SECURITY.md](../SECURITY.md)（安全策略）、[CONTRIBUTING.md](../CONTRIBUTING.md)（贡献指南）、[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)（行为准则）。[ROADMAP.md](./ROADMAP.md)（路线图）和 [LIMITATIONS.md](./LIMITATIONS.md)（已知局限）在 `docs/` 下。

---

## 5 分钟速览

| 你想知道的 | 一句话 | 详见 |
|------|------|------|
| 这是什么 | sofagent——一个 FDE Agent，进场梳理工作流、部署 AI 节点、离场后 7×24 自己跑 | [FDE Agent 能替你干什么](#fde-agent-能替你干什么) |
| 怎么装 | `bash install.sh`（企业设备安装器，装底座 + Agent Skill）· `bash install.sh --base-only`（仅底座） | [落地：装好就能派活](#落地装好就能派活) |
| 怎么用 | 装完直接派任务，复杂任务自动拆解 | [运行：每次变更都被管住](#运行每次变更都被管住) |
| AI 节点怎么跑 | 开发者：git commit 自动审计。非开发者：v1.0.8+ daemon 监控文件变更自动审计 | [落地：装好就能派活](#落地装好就能派活) |
| AI 知识库 | `data/knowledge/` 目录，跨任务积累最佳实践，加载链被动注入 | [进化：知识自动沉淀](#进化知识自动沉淀) |
| 交付后怎么自动跑 | 🔗 激活链（v1.2.5+）：读交付物 → 注册 SubAgent → 编排 → 带审批和审计地自动跑 | [常驻：长期自跑与持续优化](#常驻长期自跑与持续优化) |
| AI 成熟度 | 三级台阶（替换→增强→重构），FDE 帮企业从第二级跨到第三级——不只装 AI，还装上责任机制 | [FDE/GUIDE.md](../FDE/GUIDE.md#19-企业-ai-成熟度三级台阶) |
| 已知局限 | 核心效果见 [evidence.md](./evidence/evidence.md)；复盘 LLM 自评；明文存储 | [LIMITATIONS.md](./LIMITATIONS.md) |

---

## FDE Agent 能替你干什么

> 这一节先讲「价值」，再讲「怎么用」。sofagent 不是一个工具包，而是一个**能进场、能部署、能离场常驻的 Agent**——它替企业把大模型变成 7×24 自动执行的 AI 节点。完整能力矩阵见 [ARCHITECTURE · 能力与状态总览](./ARCHITECTURE.md#能力与状态总览)。

**已经能替你干的事（v1.3.7 已交付）**：

- **进场梳理 → 部署 AI 节点 → 离场常驻**：FDE 帮你盘清工作流、识别可自动化环节、把重复业务变成自动跑的 Agent，离场后 7×24 自己巡检、自己优化。
- **每次变更都被管住**：24 条规则硬证据审计，密钥泄漏 / 越界编辑 / 注入攻击 / 盲改当场拦截；出事一键回滚到任意安全状态。
- **知识自动长出来**：Dream Cycle 把每次任务沉淀成企业知识库 + Ontology 本体，越用越懂你的业务。
- **平台无关、即挂即用**：骑在你自选的大厂 Agent（Claude Code / Codex / WorkBuddy / 扣子 / OpenClaw）之上，不替代模型，只补「可靠执行」。（Cursor 社区验证中）
- **能带走、能协同**：USB 一键烧录（插上即用、拔掉零残留）；多设备加密联邦互查；内置 `@sofagent-fde` + `@sofagent-audit` 双 Agent。
- **🔗 激活链（v1.2.5+ 已实现 Phase 1-4）**：FDE 诊断交付后，ontology + workflow.yml + skills/ 不再是一堆静态文件躺在磁盘上——激活链自动读交付物 → 注册企业 SubAgent → 编排成 LangGraph 工作流 → 带人工审批（HITL）和审计地自动跑。从"交给企业一堆文档"变成"交给企业一个会自己跑的系统"。Phase 4（SUSTAIN）已于 v1.3.0 交付。详见 [激活链设计文档](./guides/fde-activation-chain.md)。
- **🧠 v1.3.1 新增**：Ontology 运行时层（执行前校验）· 并行编排（波次并发 + MergeQueue）· Agent 身份码（Ed25519）· Benchmark 评测 · 工具审批四模式 · LLM 调用级 Trace · Durable Execution（checkpoint 续跑）· 国标对齐 GB/T 48000.3-2026。详见 [v1.3.1 开发日志](./changelog/v1.3/v1.3.1.md)。
- **🏪 v1.3.4**：组织能力市场——Skill/Agent/流程可发布、可搜索、可调用、可评分、可退役；SkillScan 安全扫描双触发。
- **🧬 v1.3.5 新增**：自进化与运维闭环 MCP 化——A/B 实验（`run_ab_test`）与晋升决策（`promote_ab`，强制人审）、审计快照查询与恢复（`snapshot_list` / `snapshot_restore`，恢复强制人审）全部可从任意 MCP 宿主调用（当年 48→52 tools）；instinct→skill 自动进化（经验自动聚合成可复用 skill）；FDE 运维五件（陪跑期/进场记忆/节点注册表/审计问卷 7 行业）；DSH MCP 互通；四份独立审查 38 项加固。详见 [v1.3.5 开发日志](./changelog/v1.3/v1.3.5.md)。
- **🔌 v1.3.6 新增**：引擎接口外化完整版（模型层接入前置）——模型生成的 workflow / ontology 可经标准接口进入约束层：`workflow_submit`（含 merge_criteria/approver 审阅协议字段）/ `ontology_import` / `model_register`+`model_switch`+`model_unregister`（模型灰度全流程审计）/ `harness.wrap` 托管 SDK / `train_budget` 训练预算控制 / `define_acceptance`+`check_acceptance` 机器可判定验收（52→60 tools）；可靠性五件：FORGE worktree 隔离、双闸验证（postToolCall 副作用复查）、Agent 疲劳度检测、分级降级梯队、decisions.jsonl 完整版。详见 [v1.3.6 开发日志](./changelog/v1.3/v1.3.6.md)。
- **🏰 v1.3.7 新增**：SubAgent 完整沙箱（虚拟文件系统 / 网络出站白名单 / 工具调用中介 / 虚拟 key / 独立进程 / 真·实时 A-B 双跑——企业 SubAgent 在隔离环境里干活，写入先进虚拟层审批后落盘）；场景驱动权限（身份→场景→风险→放行/deny/人审，每步留痕）；AgentShield 五类扫描（MCP 画像 / Hook 注入 / 配置审查 / 密钥增强 / Shadow AI 发现——揪出未注册的影子 agent）；行业 overlay 四套（金融/医疗/政务/AI 自动加载额外约束）；断路器行为监控（连败熔断 + 失控隔离）；ontology 生命周期（branch/trunk + 审阅门 + OKF 三件套）。详见 [v1.3.7 开发日志](./changelog/v1.3/v1.3.7.md)。

**现在还干不了的事（已排期，暂无代码）**：本地推理小模型、主 Agent 运行时策略强制（SubAgent 侧沙箱 v1.3.7 已交付，主 Agent 侧留 v1.3.9）——路线见 [ROADMAP](./ROADMAP.md)。

---

## 心智模型：约束层与生命周期

把 sofagent 想成**骑在你选好的大模型之上的一层约束**——不自己造模型，只把每次执行管得可靠、可审计。

借一条河来记：

- **大厂 LLM = 原水**：90% 的智力来自它，sofagent 不自己造水。
- **大厂 Agent 平台 = 河床**：统一入口（Claude Code / Codex / WorkBuddy / OpenClaw），sofagent 不做河床。
- **sofagent 引擎 = 堤坝 + 自来水厂 + 管网 + 水龙头（5 项核心已实现）+ 水表（审计已实现，终端 Dashboard v1.2.3 已落地）**：
  - 🧱 **堤坝（约束底座）**——四层加载链，把行为底线焊死在每次对话里
  - 🏭 **自来水厂（沙箱安全）**——让原水变「直饮水」，危险操作隔离在沙箱
  - 🔧 **管网（审计引擎）**——每次变更过 24 条规则审查
  - 🚰 **水龙头（业务 Sub Agent）**——具体干活的节点，随业务接不同的「水龙头」
  - 📊 **水表（审计）**——每次变更看得见、可回滚（终端 Dashboard v1.2.3 已落地）

落到代码就是 **约束层 × 生命周期** 双层架构：

| 层 | 是什么 | 一句话 | 状态 |
|:--:|------|------|:--:|
| **层 1 · 约束层（Harness）** | 约束层四种能力（注入 · 审计 / 回溯 / 进化） | 怎么保证每次执行都做对 | ✅ 已交付 |
| **层 2 · 生命周期（五阶段）** | 诊断 → 激活 → 编排 → 执行 → 持续（激活链四阶段 = 激活→编排→执行→持续 ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN，为五阶段中后四环） | 企业 AI 从诊断到自运转怎么走 | 🔗 Phase 1-4 已交付 |

**层 1 · 约束层（约束层四种能力）**：

| 角色 | 引擎 | 管什么 | 触发方式 |
|------|------|------|------|
| 🧱 底座 | **约束底座**（harness） | 四层加载链注入规则，Agent 启动即生效 | 平台 Hook（OpenClaw / WorkBuddy）/ Sub Agent 自加载 |
| 🔍 引擎① | **审计引擎**（audit） | git diff → 24 条规则硬扫描，违规当场拦 | git commit / daemon 文件变更 |
| 🔄 引擎② | **回溯引擎**（core） | 审计后自动快照，出事一键回滚 | 审计完成后自动 |
| ⚙️ 内部工具 | **FORGE 工具链**（orchestrator） | LOOP 流水线（项目自迭代用，非对外引擎） | CLI compose tool |
| 🧬 引擎③ | **进化引擎**（think.md 反思 + Dream Cycle 知识回灌 + skillopt Skill 优化；eval/ab-test 为评估支撑；由 daemon 定时驱动） | 知识沉淀 + 反思 + 自优化，越用越好 | daemon cron / 手动触发 |

**层 2 · 生命周期（激活链，v1.2.5+ Phase 1-4 已交付）**：

| 环 | 阶段 | 做什么 |
|:--:|------|--------|
| ① | **诊断**（FDE 四阶段） | 梳理工作流、判定 AI 节点、交付三层实体（✅ 已交付） |
| ② | **激活** ACTIVATE（v1.2.5） | 读交付物 → 注册企业 SubAgent |
| ③ | **编排** ORCHESTRATE（v1.2.6-7） | 多 Agent → StateGraph 工作流 |
| ④ | **执行** EXECUTE（v1.2.8-9） | DAG 运行 + 人工审批（HITL）+ 审计集成 |
| ⑤ | **持续** SUSTAIN（v1.3.0） | 反思 + 回灌，喂下一轮诊断 |

> 约束层（注入）＋ 审计 / 回溯 / 进化 ＝ 全生命周期**可审计、可回滚、可进化**。激活链在此基础上让企业 AI 从"诊断完交付一堆文档"走向"自运转"。FORGE 自迭代工具链是项目内部开发工具。完整设计见 [ARCHITECTURE · 双层架构](./ARCHITECTURE.md#双层架构约束层与生命周期主框架) 和 [激活链设计文档](./guides/fde-activation-chain.md)。

---

## 落地：装好就能派活

> 💬 **sofagent 没有界面。** 装完之后，你不会看到任何窗口或网页。你通过你的 Agent（WorkBuddy / Codex / Claude Code）和 sofagent 对话——说一句话，它做完了告诉你结果在哪。语言就是界面，MCP 就是入口。详见 [设计哲学](./PHILOSOPHY.md)。

> 📊 **部署后你会自动收到这些**：每周审计守护报告（拦截了多少次违规）、每月知识库增长报告（AI 掌握了多少实体）、每季度无 FDE 对照报告（裸模型 vs sofagent 回答对比）、扩容预警。这些是 sofagent 持续存在感的证明——由引擎自动生成推送，不需要人工干预。详见 [FDE/GUIDE.md §5.9 离场](../FDE/GUIDE.md#59-离场五大能力)。

### 两种装法（v1.2.0）

**全量安装**（`bash install.sh`）：底座 + 编排 + FDE + daemon，企业驻场部署用。**底座 only**（`install.sh --base-only`）：仅审计 + 回溯核心引擎，开发者 CI 集成用。详见 [ARCHITECTURE §安装包边界](./ARCHITECTURE.md#安装包边界与部署架构v132-定位校准)。

### 安装

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent && bash install.sh
```

> 只想加 Agent 行为约束？不需要装整个 sofagent——把 4 底线 + 7 铁律复制进你的 Agent 设置就行，详见 [README](../README.md)。

**前置依赖**：

| 依赖 | 版本 | 为什么 | 检查 |
|------|------|------|------|
| bash | ≥4 | install.sh / task-record.sh | `bash --version` |
| git | 任意 | clone + task/logs 追溯 | `git --version` |
| node | ≥18 | 编排引擎 + 审计 CLI | `node --version` |
| npm | ≥9 | 安装 @langchain/langgraph（编排引擎） | `npm --version` |

> 只用宪法层约束（不跑编排引擎/审计）可不带 node/npm。

| 平台 | install.sh 行为 |
|------|------|
| `openclaw` | 完整部署——宪法 + Hook + 配套脚本 + 断路器 → `~/.openclaw/` |
| `workbuddy` | 部署 SKILL.md → `~/.workbuddy/skills/sofagent/` |
| `claude` | 部署宪法 + 输出种子指令（手动粘贴到 CLAUDE.md） |
| `codex` | 部署宪法 + 输出种子指令（手动粘贴到 AGENTS.md） |
| `hermes` | 部署宪法 + 输出种子指令（手动粘贴到 SOUL.md） |

#### 安装常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `sofagent-audit: Node.js 未找到` | Node.js 未安装或版本过低 | 安装 Node.js ≥18：`node --version` 确认 |
| commit 时没有审计输出 | commit-msg hook 未安装 | `sofagent-audit --init` 或 `sofagent-audit --install-hook` |
| 首次 commit 提示「无需审计」 | 全新仓库首次提交没有前一个版本可对比 | 正常——下次 commit 起审计自动生效 |
| Windows 上部分检查缺失 | Windows 为实验性支持 | 核心审计引擎可用，PowerShell 脚本覆盖不全，详见 [LIMITATIONS](./LIMITATIONS.md#windows-支持是实验性的) |
| hook 装了但静默跳过 | Node.js 或 sofagent-audit 缺失时 hook 旧版会静默跳过 | v1.0 hook 含无声失败保护，会 exit 1 + 提示；旧 hook 跑 `--init` 更新 |
| `sofagent-audit --doctor` 报 config 缺失 | 未跑过 `--init` | 跑 `sofagent-audit --init` 生成 config.yml，或用默认配置（默认 17 条（A1–A11 + A18–A23）全启用，扩展 7 条（A14–A17 + E1/E2/E4）需开启，全量 24 条） |

### 验证装好了

```bash
bash engine/scripts/verify.sh    # 跑 verify 检查，通过即装好可用（--json 可进 CI）
# 或 npm 安装后直接用
sofagent-verify                     # 同样跑 verify 检查
```

> ⚠️ 不要靠 Agent 回复验证——SKILL.md 闸门要求初始化过程不输出给用户。只信验证脚本的输出。

### 安装后的目录

```
你的项目根目录（$PWD）               Agent 平台用户目录
├── .sofagent/          ← 数据目录    ~/.openclaw/ 或 ~/.workbuddy/
│   ├── think.md                     ├── skills/sofagent/   ← Skill 文件
│   └── task/logs/                   └── scripts/           ← 部署脚本
```

`.sofagent/` 建在**你的项目根目录**，不是 sofagent 仓库目录。

### 跨平台能力差异

支持 Hook 注入的平台（OpenClaw / WorkBuddy 等）获得完整能力（Hook 自动注入 + 断路器 + 编排引擎）。其他平台核心约束生效，编排引擎降级。详见 [开发文档 §一](./DEVELOPMENT.md#脚本与文件结构速查)。

---

## 运行：每次变更都被管住

> 这一幕讲「上岗干活」——常驻 Agent 怎么被管住，不会乱来、不会盲改、出事能回滚。**这一幕最长，因为它覆盖你每天都会碰到的全部机制**：从加载链、铁律，到提交审计与 CI。

### 四层加载链（v1.0.1）

每次对话启动时先加载 4 层常驻地基：

| 层 | 文件 | 干什么 | 能改吗 |
|:--:|------|------|:--:|
| 1 | `SKILL.md`（宪法内联） | 4 底线 + 7 铁律 | ❌ |
| 2 | `fde.md` | 你的运行规范，优先级最高 | ✅ 随便改 |
| 3 | `think.md` | 反思摘要（≤2K token） | ⚠️ 改了没用。→ [反思工程](./DEVELOPMENT.md#六反思工程) |
| 4 | `knowledge/index.md` | AI 知识库目录，被动注入 top-3 页摘要 | ⚠️ daemon 自动维护 |

> 地基约 3,500 token，不到 128K 窗口的 3%。支持 Hook 的平台（OpenClaw / WorkBuddy）自动注入 2-4 层，其他平台 Agent 主动 Read。详见 [ARCHITECTURE 地基与引擎](./ARCHITECTURE.md#地基与引擎)。

### 4 条底线 + 7 则行为铁律

**底线**：
1. 不泄露隐私
2. 不执行危险操作
3. 不生成有害内容
4. 不冒充人类身份

**铁律**：

| # | 铁律 | 一句话 | 做错时的表现 |
|:--:|------|------|------|
| 0 | 知行合一 | 说和做一致，声称必有证据 | 说读了文件实际没读 |
| 1 | 目标驱动 | 回到原始意图，不跑偏 | 做着做着跑偏了 |
| 2 | 全局视角 | 先找现有代码和工具，不重复造轮子 | 有现成库不用自己写 |
| 3 | 成本意识 | 批量处理，简短回答 | 100 个文件一个一个改 |
| 4 | 存疑即问 | 列出两种以上理解让用户选，不猜 | 猜用户意思全猜错 |
| 5 | 不藏错误 | 报错、在哪、试了什么，不许吞错 | 报错静默跳过 |
| 6 | 有始有终 | 任务完成主动收工，不确定时问用户 | 子任务跑完了没告诉用户 |

> 「验证」不是自说自话——是跑测试、跑 lint、API 返回码、文件 diff。

### 任务目标制定

> 负责的子 Skill：`task-aware.md`。强模型时代，告诉 Agent **要什么**比告诉它**怎么做**更重要。

Agent 先判断任务复杂度：

| 级别 | 特征 | Agent 行为 |
|:--:|------|------|
| 🟢 简单 | 单步指令，说得明确 | 直接干活 |
| 🟡 中等 | 多步但方向清楚 | 先干，说一句「中间需要随时叫我」 |
| 🔴 复杂 | 模糊、多模块 | 问「需要拆解吗？」→ 用户同意才启动 |

只有 🔴 复杂任务进入两轮澄清：

```
第一轮 · 目标确认
  Agent 追问缺失信息（数据范围/产出形式/受众/时间限制）
  → 用户回答

第二轮 · 编排方案
  Agent 跑 LangGraph createReactAgent compose → 输出方案：「拆成 N 个子任务、预估 token/成本。可行？」
  → 用户确认 → 执行
  → 用户不认可 → 指哪改哪，重生成方案
  → 说不清楚 → 回到第一轮
```

**两轮封顶**：两轮后仍不认可，请用户重新描述。开放式提问，不替用户做假设。详见 [DEVELOPMENT §二](./DEVELOPMENT.md#二编排哲学)。

### 能力边界

| ✅ 能做 | ❌ 做不了 |
|------|------|
| 数据：分析、报表、图表、格式转换 | 物理世界：动手操作 |
| 文字：撰写、翻译、校对、摘要 | 图像视频：剪辑、特效 |
| 代码：生成、审查、测试、重构 | 人际：面对面沟通 |
| 检索：搜集、整理、对比研究 | 系统 GUI：鼠标点击 |

超出边界直接说「做不了」，但给替代方向。

### 渐进信任与判断层

用户与 Agent 的信任应逐级释放：**观察**（只汇报不动作）→ **建议**（给方案等你批）→ **代执行**（授权后自主跑）。

**判断层必须 human-in-loop**：选人 / 品（品味）/ 股（重大利益）三类决策 AI 改执行不改判断——品味不可替代，重大利益不快不准。

**对抗防护**：Prompt 注入 / 上下文投毒 / Agent 链式攻击——已有 8 层纵深防御（见 [SECURITY.md](../SECURITY.md)），此处补行业参考「判断层不下沉」原则：执行可下放，判断权永留人。

**「从 70 分开始」采用原则**：不要等 Agent 到 100 分再用。新员工第一周不让他独立做架构决策，先让他做确定性高的事——Agent 同理。能力上限不是采用门槛，行为模式才是。

| 谁 | 负责什么 | 典型事项 |
|----|---------|---------|
| Agent | 确定性工作（做对约 70 分，做错立刻可发现）| 格式转换 / 数据清洗 / 代码生成 / 日志分析 / 定时播报 |
| 人 | 判断与决策（不可下放）| 方案选型 / 优先级 / 异常处理 / 对外沟通 |

> 「70 分的 Agent + 30 分的人类判断，比 100 分的人类单独干更快、更稳。」数字员工与聊天机器人的区别不在能力上限、在行为模式——主动做该做的事、知道什么不该做；70 分原则即行为模式落地：确定性范围内主动，不确定性边界处上报。

#### 岗位准入判定：一个岗位能否交给数字员工

不是所有岗位都适合交给数字员工。在派活之前，用以下五个问题做准入判定：

| # | 判定问题 | 放心交给 Agent 的信号 | 该留给人的信号 |
|---|---------|---------------------|---------------|
| 1 | 这个岗位的"做对了"能量化吗？ | 有明确的验收标准（格式、数值、规则） | 好不好看品味，没有标准答案 |
| 2 | 做错了能回滚吗？ | 变更有 git 快照、退得回 | 不可逆操作（发邮件、拨付款） |
| 3 | 输入输出结构化吗？ | 数据进、数据出（报表、转换、校验） | 模糊输入（情绪、语境、人际） |
| 4 | 频率够高、值得自动化吗？ | 每天/每周重复 | 一年做一次，手动更划算 |
| 5 | 判断权能剥离吗？ | 执行步骤明确，判断规则可编码 | 每次都要人做情境判断 |

**判定规则**：5 问中 ≥4 个落在"放心交给 Agent"列 → 全自动派活；3 个 → Agent 做、人审；≤2 个 → 不交给 Agent。这与「渐进信任」的观察→建议→代执行三级释放呼应——准入判定决定能不能进代执行层。

> 这五问是 FDE 进场时识别 AI 节点的岗位级过滤器，与 FDE/GUIDE.md 的三级台阶（企业 AI 成熟度）、五要素深挖（节点级分析）互补——三级台阶判断企业准备好了没有，五问判断具体岗位准备好了没有。

### 提交后自动审计

Agent 改完代码 commit 了——`sofagent-audit` 扫描 git diff 对照 24 条审计规则（17 默认启用：A1-A11 + A18-A23；7 扩展 opt-in：A14-A17 + E1/E2/E4）逐条判定：

```bash
cd engine/audit && npm ci && npm run build
node dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
```

exit code：0 = 通过 / 1 = 有警告 / 2 = 有违规。零 Agent 依赖——看的是已发生的 git diff。

> 审计规则的完整实现（绿灯路径检测、架构漂移检测、状态账本）见 [DEVELOPMENT §八 提交时审计](./DEVELOPMENT.md#八提交时审计--文件系统审计)。

### daemon 后台进程

安装时可选择安装 daemon（轻量后台进程，macOS launchd / Linux systemd）。daemon 做两件事：① 每 30 秒检查 `think.md`/`fde.md` hash 变化写入 `daemon-health.json`；② v1.0.8+ 监控文件变更自动跑审计。commit 审计由 commit-msg hook 负责（见上方）。

审计结果按严重级别处理：

| 结果 | 用户看到什么 | 自动动作 |
|------|------------|---------|
| ✅ PASS | 静默 | 自动快照存档 |
| ⚠️ WARN | daemon-health.json 告警 + 可选 Webhook | 存档 + 标记 |
| ❌ FAIL | Webhook 推送 + 终端标红 | 存档 + 建议回滚 |

```bash
sofagent-audit --history              # 查看审计快照
sofagent-audit --revert <sha>         # 回滚到某次审计前
```

Webhook 在 `.sofagent/config.yml` 配置，不配也能用。详见 [ARCHITECTURE 回溯引擎](./ARCHITECTURE.md#回溯能力自研同构-git-引擎--对外叙事一键回滚)。

### 终端 Dashboard：一眼看清 AI 在干什么

`sofagent-dashboard` 把 daemon 收集的状态变成三个核心面板——不用翻日志，一眼看清：

```bash
sofagent-dashboard           # 看当前状态
sofagent-dashboard --watch   # 实时刷新（看护审查时用）
sofagent-dashboard --full    # 展开：编排控制图 + FORGE 审查进度 + 最近文件变更
```

| 面板 | 看什么 | 数据来源 |
|------|--------|---------|
| **数据去哪了**（数据主权） | 敏感数据有没有偷偷发给云端？ | 4 维审计日志（模型/操作/流向/任务） |
| **AI 犯规了吗**（规则审计） | AI 有没有越权改文件、存数据？ | 审计引擎 24 条规则结果 |
| **任务跑到哪了**（工作状态） | 后台 daemon 和 sub-agent 是活的还是挂了？ | daemon-health.json |

> 前置依赖：需要 `jq`（`brew install jq` / `apt install jq`）。`--full` 追加编排控制图（Org Graph + Work Graph）、FORGE 审查进度、最近文件变更三个扩展面板。FORGE 是 sofagent 项目的内部开发工具链（非对外引擎），企业用户可忽略 FORGE 审查进度面板。

### CI 集成

在 GitHub Actions 中自动运行审计（静默模式 + CI 严格模式）：

```yaml
# .github/workflows/sofagent-audit.yml
name: sofagent-audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 2
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
      - run: bash install.sh
      - run: sofagent-audit --diff HEAD --silent --ci
```

#### 模式对照表

| 模式 | 标志 | 说明 | 退出码 |
|------|------|------|:--:|
| 默认 | *(无)* | 全部规则（含 Agent 日志） | 0/1/2 |
| 静默 | `--silent` | 只跑 git-diff 规则（零 Agent 依赖） | 0/1/2 |
| 严格 | `--strict` | 任何警告都 exit 2 | 0/2 |
| CI | `--ci` | = `--silent`（CI 友好输出，无交互提示） | 0/1/2 |

模式可叠加——CI 流水线需零容忍时用 `--diff HEAD --ci --strict`（v1.0.5 起 `--ci` 不再隐含 `--strict`）。

---

## 进化：知识自动沉淀

> 这一幕讲「长本事」——常驻 Agent 怎么把每次任务变成企业资产，越用越懂你的业务。以下功能 daemon 自动运行，装完即生效，你不需要做任何配置。完整能力矩阵见 [ARCHITECTURE · 能力与状态总览](./ARCHITECTURE.md#能力与状态总览)；下表只列「装完即自动生效」的新能力。

### 近期版本新功能速览

| 功能 | 版本 | 一句话 | 详见 |
|------|:--:|------|------|
| Dream Cycle | v1.1.7 | knowledge/ 自动沉淀——daemon 6 阶段 pipeline 从 task/logs 提取知识，不再靠散点脚本 | [FDE/GUIDE.md §5.6 经验怎么沉淀](../FDE/GUIDE.md#56-经验怎么沉淀) |
| sensitivity 分级 | v1.1.7 | 每条知识带 public/internal/restricted 分级，缺省 internal——restricted 在联邦查询中不外发 | [FDE/GUIDE.md §5.7 数据主权](../FDE/GUIDE.md#57-数据主权审计为什么重要) |
| knowledge status | v1.1.7 | `sofagent-daemon knowledge status` 一条命令看知识全貌（Dream Cycle 周报 + 健康度 + sensitivity 计数） | [FDE/GUIDE.md §5.6 经验怎么沉淀](../FDE/GUIDE.md#56-经验怎么沉淀) |
| 安全联邦 | v1.1.8 | 两台配对设备互查 knowledge/，AES-256-GCM 全链路加密 + sensitivity 双重过滤 | [FDE/GUIDE.md §5.7 数据主权](../FDE/GUIDE.md#57-数据主权审计为什么重要) |
| Prompt 注入防护 | v1.1.8 | 8 层纵深防御——外部内容包裹 + 脱敏 + 知识可信分级 | [SECURITY.md](../SECURITY.md) |
| USB 一键烧录 | v1.1.8 | workflow 烧进 U 盘 → 发给员工 → 插上即用，拔掉零残留 | [常驻：长期自跑与持续优化](#常驻长期自跑与持续优化) |
| A/B 自动调度 | v1.1.9 | daemon 后台跑探索-利用——当前方案攒数据 → 自动切候选方案对比 → 赢家自动 promote | [ARCHITECTURE 编排引擎](./ARCHITECTURE.md) |

### 知识怎么长出来

- **Dream Cycle**：daemon 周期性扫描 `task/logs/`，按 6 阶段 pipeline 抽取可复用经验，写入 `data/knowledge/`，并自动生成 Ontology 实体 / 关系 / 约束。
- **Ontology 本体**：企业世界模型——实体 + 关系 + 动作 + 约束，三层 YAML 自动生长，让 Agent 越用越懂你的业务语境。
- **sensitivity 分级**：每条知识带 public / internal / restricted 分级，restricted 在跨设备联邦查询中默认不外发。

> 知识库不是数据库，是会「长」的资产。完整治理机制见 [FDE/GUIDE.md §5.6 经验怎么沉淀](../FDE/GUIDE.md#56-经验怎么沉淀)。

### 进化引擎（越用越好）

进化引擎 = eval（三维评分：精确匹配 / 语义相似 / 规则合规）+ ab-test（current vs candidate 并行对比，连续胜出 + 非退化守卫才晋升）+ skillopt（复用审计规则做安全审查与集成优化）+ think（基于 diff + 审计结果自动生成反思条目，append-only）。

> 📖 **多设备同步**：v1.1.0 起支持轻量多设备——经验共享（knowledge/ + think.md）跨设备同步。4 种方案（iCloud / NAS / Dropbox / git submodule）见 [多设备同步指南](./guides/multi-device-sync.md)。

### 在 DSH 中使用 sofagent（v1.3.5 · MCP 互通）

sofagent 本身就是一个 MCP server（stdio 传输，bin `sofagent-mcp`，v1.3.6 起 60 个 tool）。DSH（DeepSeek Harness）用户不需要等 v1.4.0 的 cordis-plugin——用官方 `@deepseek-ai/dsh-mcp-client` 桥接插件挂上 `sofagent-mcp`，**今天就能在 DSH 会话里调用 sofagent 的全部能力**：审计查询、知识库检索、A/B 实验（`run_ab_test`）、快照时间线（`snapshot_list`）等。

#### 配置方法

在 DSH 的 `cordis.yml`（插件挂载配置，通常在 `~/.dsh/` 或 profile 目录下）加一条 mcp-client 条目，stdio 传输直连 sofagent-mcp：

```yaml
- id: mcp-sofagent
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: sofagent
    transport: stdio
    command: npx
    args: ['-y', '@sofagent/mcp']
    env: {}                      # 可选：注入 SOFAGENT_HOME 等环境变量
    toolCallTimeoutMs: 120000    # 可选：run_ab_test 等长任务建议放宽（默认 60000）
```

> 字段名以 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6`（2026-08-15 npm 实测拉包核对 `lib/types/index.d.ts` 的 `StdioConfig`）为准——`transport` / `serverName` / `command` / `args` / `env` / `cwd` / `toolCallTimeoutMs` / `failOnStartupError` / `reconnect`。DSH 尚处 developer preview（rc），后续版本字段可能变化，以 [DSH 官方仓库](https://github.com/deepseek-ai/deepseek-harness) config 文档为最终依据。

挂载后 DSH 侧的模型看到的 tool 名形如 `mcp__sofagent__snapshot_list`（`mcp__<serverName>__<原始名>` 命名契约——与 Claude Code / Codex 同款），60 个 tool 全部可见，与 DSH 原生 tool 走完全相同的执行管道（权限策略、timeout、compaction 行为一致）。

**两种 command 写法按部署形态选**：

| 部署形态 | command / args | 说明 |
|---------|---------------|------|
| npm 安装（v1.3.5 发版后） | `npx -y @sofagent/mcp` | 最简——首次会拉包，需能访问 npm registry；`@sofagent/mcp@^1.3.5` 起 bin 为 `sofagent-mcp` |
| monorepo 本地 / 内网 | `node /path/to/sofagent/engine/mcp/dist/mcp-server.js` | 开发/内网环境——dist 需先 `npm run build`（workspace 根目录执行）；也可 `npm i -g /path/to/engine/mcp` 后 command 直接写 `sofagent-mcp` |

> ⚠️ **command 必须是 `node`，`.js` 路径放 args**——本地 dist 直用场景若把 command 写成 `.js` 文件路径，部分客户端（如 MCP Inspector）会 `spawn EACCES`（dist 文件无 +x 位；npm 安装的 bin 由 npm 自动加执行位，无此问题）。冒烟实测：`command: node` + `args: [<dist路径>]` 稳定通过。

#### 安全边界（🔴 必读）

互通只是新通道，不是新权限模型——sofagent 的安全语义在 DSH 通道下**完全不降级**：

- **破坏性 tool 强制人审**：`promote_ab`（A/B 晋升）和 `snapshot_restore`（快照恢复）要求显式 `human_confirmed: true` 参数——不确认就只返回决策依据挂起，绝不执行。DSH 的模型无法绕过这道门（语义在 sofagent 服务端实现，与调用方无关）
- **只读 tool 即开即用**：`snapshot_list` / `run_audit` / `search_knowledge` 等查询类无副作用
- **进程控制不开放**：daemon start/stop 类操作不暴露为 MCP tool（changelog 安全边界第 2 条）

#### 验证状态

> ⚠️ **本节配置示例的验证口径**：字段结构已对照 `@deepseek-ai/dsh-mcp-client@0.1.0-rc.6` 的类型定义与官方 README 核对（2026-08-15），但**尚未经 DSH 真实连接端到端验证**——DSH 本体处于 developer preview（rc），安装面与 profile 结构仍在变动。v1.3.5 发布前将以 MCP Inspector（`npx @modelcontextprotocol/inspector`）做 stdio 通道等价冒烟（60 tools 可见 + 只读 tool 调用 + 破坏性 tool 未确认时挂起）；DSH 直连验证待 DSH 正式版后补做。若你基于本节配置实操遇到字段不匹配，请以 DSH 报错信息与官方文档为准并[提 issue](https://github.com/KongFangXun/sofagent/issues)反馈。

---

## 常驻：长期自跑与持续优化

> 这一幕讲「离场常驻」——FDE 梳理完 workflow 后，AI 节点怎么 7×24 自己跑、自己优化，人不用盯着。**完整方法论（四阶段十二步 + 模板 + 上手）见 [FDE/GUIDE.md](../FDE/GUIDE.md) 与 [FDE/README.md](../FDE/README.md)**，这里只讲结果和你能直接敲的命令。

### 部署：装上 sofagent

没有 sofagent，梳理的 workflow 就是一份 PPT。引擎装到设备上，AI 节点才有纪律和审计。完整引擎对照表与部署步骤见 [FDE/GUIDE.md §5.3 部署流程](../FDE/GUIDE.md#53-部署流程人怎么看懂)。

> 📋 **部署文档导航**：sofagent 的部署文档按场景分散在三处，各归各位，按需选读：
>
> | 文档 | 定位 | 给谁 |
> |------|------|------|
> | **本文档（HANDBOOK）** | 操作手册——部署规模参考、资源消耗、数据存储、USB 烧录、持续维护 | 所有人（先看这个） |
> | [guides/enterprise-deploy.md](./guides/enterprise-deploy.md) | 单机详细部署——企业设备安装全流程、config 配置、daemon 常驻 | 企业 IT / FDE 驻场 |
> | [guides/team-deploy.md](./guides/team-deploy.md) | 团队批量部署——多台机器批量安装、统一 config 分发 | 企业 IT（20 台+ 规模） |
> | [guides/multi-device-sync.md](./guides/multi-device-sync.md) | 多设备联邦同步——knowledge/ + think.md 跨设备共享（iCloud / NAS / Dropbox / git submodule） | 多设备协同用户 |

### 部署规模参考（企业 IT）

| 部署规模 | 并发 Agent | CPU | 内存 | 磁盘 | 适用场景 |
|---------|:---:|:---:|:---:|:---:|---------|
| 个人 / 小团队 | 1-3 | 1 核 | 512 MB | 500 MB | 单人开发，git commit hook 审计 |
| 中型团队 | 5-10 | 2 核 | 1 GB | 2 GB | 多人协作，daemon 常驻 + webhook 推送 |
| 企业级 | 10+ | 4 核 | 2 GB | 5 GB+ | 多仓库联邦，A/B 审查 + 知识库 + Dashboard |

> **资源消耗说明**：
> - **磁盘**：`~/.sofagent/data/`（审计历史 + 快照 + 知识库，日均 ~5 MB/仓库）
> - **内存**：daemon 常驻进程（~50 MB）+ Node.js 运行时（~200 MB/并发 Agent）
> - **网络**：仅 LLM API 出站，无入站端口需求

⚠️ **数据存储说明**：当前版本将审计数据以 Markdown 明文存储在 `~/.sofagent/data/`。内置加密（age）已排 v1.3.8。生产环境使用前建议将 `~/.sofagent/` 放在加密卷中。详见 [SECURITY.md](../SECURITY.md)。

> ⚠️ **被审计仓库会生成 `.sofagent/` 隐藏目录**：sofagent 审计时会在被审计的 git 仓库根目录创建 `.sofagent/` 隐藏目录，存放审计快照（`.git-shadow/`）、运行时审计日志、dashboard 缓存等。该目录**已默认加入 `.gitignore`**，不会进入 git 提交，但 `ls -a` 可以看到。企业 IT 看到 `.sofagent/` 无需紧张——这是运行时产物，**可安全删除**（重新审计会自动重建，不影响功能）。

**节点类型选择**：自动运行节点（需 OpenClaw 或其他企业级平台全栈）vs 个人增强节点（WorkBuddy / Codex，无需平台全栈）。完整对照表见 [ARCHITECTURE 双节点架构](./ARCHITECTURE.md#双节点架构)。

### USB 烧录：三种部署场景全覆盖（v1.1.8+ / v1.2.0 叙事收口）

**三种场景，一种方式**——sofagent 用 USB key 覆盖全部部署需求：

| 场景 | 用户 | 方式 |
|------|------|------|
| 装电脑 | 技术人员 | 正常安装流程，部署到电脑上就能用 |
| U 盘 | 普通员工 | sofagent + 联邦密钥 + knowledge 全在盘上，插上即用 |
| 无头设备 | 服务器/工控机 | U 盘插上别拔，Agent 一直在联邦里跑 |

**企业叙事**：「买 U 盘 → 下载 sofagent → 写盘 → 发给员工」——FDE 梳理好 workflow 节点后，一条命令烧录完整运行时到 U 盘。员工拿到 U 盘，插上任何电脑双击就能跑，不需要安装、不需要配对、不需要专业知识。

FDE 梳理好 workflow 节点后，可以一键烧录到 U 盘——员工拿到插上就能用：

```bash
sofagent-daemon create-usb-key \
  --role "财务审计节点" \
  --target /Volumes/SOFAGENT \
  --platform macos   # 或 linux / win
```

U 盘包含：Node.js 便携版 + sofagent 引擎 + knowledge/ 加密落盘 + 启动脚本 + HMAC 防篡改签名。员工双击 `start.command`/`.sh`/`.bat` → 验签 → 内存解密 → daemon 启动 → 联邦在线。拔掉零残留。完整部署场景与烧录命令见 [SKILL/agents/fde/SKILL.md §USB 烧录](../SKILL/agents/fde/SKILL.md)。

> 💡 跟你的 Agent 说"帮我烧一个 XX 节点的 U 盘"也行——Agent 会通过 FDE Skill 触发 `create-usb-key`。

### 离场后：企业留下什么 + 谁来管

| 产物 | 说明 |
|------|------|
| **交付手册** | 企业画像 + 部署方案 + 运行规范 + 上手文档 |
| **AI 节点** | 文档层（.md）+ Skill 层（企业专属）+ 运行层（在跑的 session） |
| **AI 知识库** | `data/knowledge/` — daemon 自动 Ingest，零手动维护 |
| **私有化评估体系** | data/eval/ + Skill 迭代历史 + 知识库演变轨迹 |
| **USB key**（v1.1.8+） | 烧录好的 U 盘——插上即用，换电脑身份不变 |

FDE 离场后，两个内置 Agent 接手持续运维：合规审计员 `@sofagent-audit`（向下看——防退化）与 FDE 部署工程师 `@sofagent-fde`（向上看——推动进化），职责对照（双 Agent 定义详见 [ARCHITECTURE §双 Agent 定义](./ARCHITECTURE.md#agent-基础设施层v108)）。

```bash
sofagent-audit subagent run fde --mode sustain --task "巡检所有节点"
@sofagent-fde sustain     # WorkBuddy 中直接 @
```

审计 Agent 管"刹车是不是还在"，FDE Agent 管"能不能换更好的轮胎"。两者合在一起，企业的 AI 节点不需要人盯着。

> sofagent 不做 AI 中台——做 AI 中台里**约束 Agent 行为和审计的那一层**。sofagent 本质上是一款 FDE Agent：对外你用的是品牌名 sofagent（它正是一款 FDE Agent 在帮你干活），对内是 sofagent 引擎（Harness 中间件）在跑。

### 🔗 激活链：从"交付文档"到"自动运转"（v1.2.5+ Phase 1-3 已交付）

> **当前的断裂带**：FDE 离场后留下交付手册、节点 .md、workflow.yml、Skill 文件——这些都是静态文件，企业 IT 拿到后还得手动搭运行环境、手动配编排、手动接审批。

激活链解决的就是这个断裂带——**让交付物自己变成可运行的系统**：

| 阶段 | 做什么 | 什么时候 |
|------|--------|---------|
| ACTIVATE 激活 | 读交付物（ontology + workflow.yml + skills/）→ 写 `.sofagent/subagents/*.yml` → 注册企业 SubAgent | v1.2.5 |
| ORCHESTRATE 编排 | 把多个企业 Agent 串联成 LangGraph StateGraph 工作流 | v1.2.6-v1.2.7 |
| EXECUTE 执行 | DAG 运行 + 人工审批节点（HITL）+ 每步审计集成 + 异常兜底 | v1.2.8-v1.2.9 |
| SUSTAIN 闭环 | 全链路验证 + wrapToolCall 联动（执行→审计→反思→进化完整循环） | v1.3.0 |

> 简单说：现在 FDE 离场后你拿到的是"图纸"，激活链完成后你拿到的是"按图纸自动造好且自己跑着的工厂"。详见 [激活链设计文档](./guides/fde-activation-chain.md)。

---

## 排查与自定义

### 排查问题

| 问题 | 怎么办 |
|------|------|
| Agent 不遵守铁律 | 检查文件位置；关键规则写 fde.md；非 Hook 平台手动 `@skill:sofagent` |
| think.md 出现错误记忆 | 直接编辑删掉；对照 task/logs 核实。→ [反思工程 三道防线](./DEVELOPMENT.md#六反思工程) |
| 编排结果不稳定 | 同类任务跑够 3 次用模板；没模板时少拆子任务 |
| Agent 卡住不动 | 断路器保护——任务拆得不够细，拆小点再跑。→ [自进化 检查点](./DEVELOPMENT.md#五自进化机制) |
| 评分越来越不准 | 翻 task/logs 对照 think.md，清理低置信度旧条目 |
| 什么不该让 Agent 做 | 确定性操作（去重/格式校验/文件清理）用脚本 |

> 更多见 [LIMITATIONS.md](./LIMITATIONS.md)。

### Osmani 三盆冷水

| 冷水 | 意思 | sofagent 的应对 |
|------|------|------|
| 验证责任不可替代 | Agent 说「做完了」是声明不是证明 | 审计 A8 要求可观测证据（测试通过/lint/API 200） |
| 理解债 | AI 替你写的代码越多，理解鸿沟越大（理解债） | task/logs 只追加不修改，永远可回溯；think.md 每步记录决策日志 |
| 认知投降 | 最舒服的状态是不再有自己观点 | fde.md 随时加规则覆盖；编排可回滚；审计独立于 Agent |

> 💡 **反认知投降的三道护栏**：fde.md 规则覆盖（保留人类话语权）、编排可回滚（保留人类否决权）、审计引擎独立于 Agent（保留人类验收权）。这不是技术特性，是制度设计——确保人类永远是最终决策者。详见 [ARCHITECTURE 设计原则](./ARCHITECTURE.md#设计原则) 和 [反认知投降](./ARCHITECTURE.md#反认知投降的制度设计)。

> "Build a Loop, but build it like an engineer who plans to keep being one." — Osmani。Loop 不是造完就不用管的自动化流水线，是工程师持续维护的工程系统。

### 改写 fde.md

`fde.md` 是你的运行规范，优先级最高。写什么就生效什么。`fde.md` 当前约 1,800 字。≤500 字预算原则适用于代码注释和提交信息等短文本，fde.md 作为企业红线文档不受此限。v1.x 计划精简。

模板在 `SKILL/harness/fde-template.md`。常用配置：
- 模型偏好（`深度思考优先` / `速度优先`）
- 输出风格（`回复控制在 200 字以内` / `优先用中文`）
- 项目规则（`不要生成 .md 文件` / `改代码前先确认`）

> 💡 **短词锚定技巧**：提炼一个专属短词（如 `vertical slice`）替代整段行为规范（如「不要一次性写完整功能，先做小范围验证，早点拿反馈」），反复在 fde.md 中强化该词。验证标准：观察 Agent 输出中是否主动提及该短词——若出现则说明行为已被成功引导。注意：短词在团队内必须绝对统一，不可随意替换不同表述。（来源：Matt Pocock 的 Agent Skill 构建方法论）

### 审计规则

当前共 24 条审计规则（A1-A11、A14-A23 + E1-E2/E4），源码在 `engine/audit/src/rules/`。每条规则独立，新增只需写函数 + 注册一行。详见 [DEVELOPMENT §八](./DEVELOPMENT.md#八提交时审计--文件系统审计)。

### 概念速查

上述术语（Harness 中间件、约束层 × 生命周期双层架构、约束层四种能力（注入·审计·回溯·进化）、激活链四阶段（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN）、FORGE 内部工具链、铁律、审计规则、Skill、think.md、daemon、Agent 平台（OpenClaw / WorkBuddy 等）、FDE 等）已在上方各幕详述，此处仅作速查索引。加载链正典顺序：**SKILL.md（宪法）→ fde.md（规范）→ think.md（反思）→ knowledge/（知识）**。核心 = **约束层（约束层四能力）× 生命周期（诊断→激活→编排→执行→持续）**。完整概念见 [README](../README.md) 和 [ARCHITECTURE](./ARCHITECTURE.md)。

---

## 相关技术栈

sofagent 不是孤立的——它构建于以下成熟项目之上，各司其职：

| 技术 | 在 sofagent 中的角色 | 引入版本 |
|------|------|:--:|
| [LangChain](https://github.com/langchain-ai/langchainjs) + [LangGraph](https://github.com/langchain-ai/langgraphjs) | 编排引擎——状态图、条件路由、HITL、持久化 | v1.0.1 |
| [@langchain/langgraph](https://github.com/langchain-ai/langgraph) | Sub Agent 系统（createReactAgent）——FDE Sub Agent + Audit Sub Agent | v1.0.1（v1.2.0 从 deepagents 迁移） |
| [Agency Agents](https://github.com/msitarzewski/agency-agents) | 230+ 岗位模板——Sub Agent 角色定义 | v1.0.3 |
| [微软 SkillOpt](https://github.com/microsoft/SkillOpt) | Skill 自进化引擎——训练→验证→替换 | v1.0.3 |
| [OpenFDE](https://open-fde.com) | 行业定位验证——10 步工作流 + 8 维能力模型 | v1.0 |
| [Palantir Ontology](https://www.palantir.com/platforms/aip/) | 企业世界模型——实体+关系+动作+约束 | v1.0.1-v1.0.5 |

## 致谢

sofagent 站在 6 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

## 彩蛋

不想装整套 sofagent，只想先给自己的 Agent 加一层「行为底线」？把下面这段直接丢给你的 Agent（Claude Code / Codex / WorkBuddy / OpenClaw 都行）：

```
请按 sofagent 的约束底座约束自己：
1. 遵守 4 底线——不泄露隐私、不执行危险操作、不生成有害内容、不冒充人类；
2. 遵守 7 铁律——知行合一、目标驱动、全局视角、成本意识、存疑即问、不藏错误、有始有终；
3. 每步先验证再继续，报错大声说，不确定就问我；
4. 任务完成主动收工，别假装做完了。
最后用三句话告诉我：你现在能替我干啥、干不了啥、我还要手动做啥。
```

要完整能力（审计每次变更 + 知识自动沉淀 + 7×24 常驻），回到开头 `bash install.sh`。

---

## 分阶段上线（L1→L2→L3）

FDE 部署不是「装完就全自动」。loop-engineering 社区建立了一套渐进信任模型，适用于所有 Agent 编排场景：

| 级别 | 含义 | 第一周策略 | 触发升级条件 |
|---|---|---|---|
| **L1 — 报告期** | 仅观察、仅报告、不动手 | 审计只读模式，FDE 节点提建议不自动执行 | 连续 5 个工作日无错误报告 |
| **L2 — 辅助期** | 可提议修复，需人工确认 | 低风险路径（docs/config/format）可自动 PR，其他需人工 gate | 2 周无回滚 / 无误操作 |
| **L3 — 自助期** | 经 allowlist 验证后处理低风险操作 | 全自动执行 + 审计告警兜底 | 持续满足 denylist + budget + gates |

**核心原则**：自动化程度越高，需要的工程判断越强。L1 是必修课——在让 Agent 动手之前，先学会读它写的报告。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [loop-design-checklist.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/loop-design-checklist.md)

## FDE 部署反模式

loop-engineering 社区总结了 10 个生产反模式，以下 4 个直接适用于 FDE 部署：

| # | 反模式 | 为什么失败 | FDE 对应措施 |
|---|---|---|---|
| 1 | 同一 Agent 既实现又验证 | 确认偏差，弱测试被橡皮图章通过 | FDE 验证节点必须用独立 Agent 会话 |
| 2 | 无尝试上限 | 无限修复循环，token 烧穿 | 硬上限 3 次 → 升级人类 |
| 4 | L3 之前没有 L1 质量 | 第一天就自动 PR，理解债务爆炸 | 强制 L1 观察期 |
| 7 | 无 kill switch | 周末告警疲劳、预算超支 | `loop-pause-all` 标签或 `STATE.md` 标志位 |

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [anti-patterns.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/anti-patterns.md)

> 大半年 Agent 平台实战笔记（OpenClaw / WorkBuddy / Claude Code / Codex）。如有更好的用法，欢迎开 Issue。
>
> *v1.3.8，2026 年 8 月 6 日*
