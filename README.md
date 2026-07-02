# sofagent

> 🌐 [English abridged version →](README.en.md) | 🇨🇳 中文完整版

![Verify](https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-v0.99.3-16B8F3)](./CHANGELOG.md)
[![定位：FDE工具包](https://img.shields.io/badge/定位-FDE工具包-16B8F3)](#一句话定位)
[![核心：约束底座 + 审计引擎](https://img.shields.io/badge/核心-约束底座_+_审计引擎-16B8F3)](#一句话定位)
[![OpenClaw](https://img.shields.io/badge/🦞_引擎-OpenClaw-FF4D4D)](./LIMITATIONS.md#平台依赖)

<img src="images/sofagent.png" alt="sofagent" width="300" />

> sofa + agent = 沙发特工——希望有一天，我们能躺在沙发上，Agent 就把活干完了。

> **License**：MIT。代码、文档、模板——随便用，保留版权声明就行。

---

## 一句话定位

面向中小企业（SMB）和一人公司（OPC）的开源 FDE 工具包——约束底座管 Agent 行为，审计引擎盯代码变更。不用请顾问、不用写 prompt，装完就能跑。自己就能梳理 workflow、搭建 AI 节点。

> **成熟度说明**：sofagent 是我自己开发、从一开始就是开源的。每个版本更新我就立刻换上新版在自己公司里用，已经持续一个多月了。FDE 工具包在我的公司已经用上——审计引擎（sofagent-audit）日常使用稳定可靠，406 个自动化测试全绿，编排引擎也没问题——但还没有打磨到「别人装上就能跑」的程度。如果你愿意试，我很想知道你在什么场景下用、遇到了什么问题。

> **90/10 法则**：不要和 AI 模型竞争它们已经擅长的 90%（代码生成）。真正的价值在没人敢跳过的 10%——验证、审计、问责。AI 模型越强，这 10% 就越值钱。sofagent 做这 10%。

> 💡 **为什么需要 sofagent**：企业 AI 落地的核心矛盾，是将概率性的大模型装进必须可追踪、可控制、可问责的传统业务流程中。模型负责建议，系统负责验收，工具负责执行——这就是 sofagent 做的事。

> - ❌ 不是 AI 框架、不写 prompt
> - ❌ 不是 Skills 商店
> - ✅ 是 **FDE 工具包：约束底座 + 审计引擎**——git diff 审计兜底。OpenClaw 做后台 harness 层（你用自己的 Agent 对话，OpenClaw 在后台管约束+审计）
>
> **FDE 做什么**：就像工头带着一群 AI 员工进企业上岗——适配上下文、搭建工作台、确保每个 AI 节点能独立产出价值后才能离开。sofagent 是这个过程的工具包，提供三样东西：
>
> | 工具 | 做什么 | 一句话 |
> |------|------|------|
> | **约束底座** | 给每个 AI 节点装上缰绳——4 底线 + 6 铁律，不让它越界 | 装缰绳 |
> | **审计引擎** | 每次 AI 改完代码自动审计，git diff 硬证据，不依赖 AI 自觉 | 查作业 |
> | **编排引擎** | FDE 识别出 AI 节点后，拆成可执行任务链，定期 A/B 重优化 | 拆任务 |
>
> > 💡 行业共识：Rolling AI（服务 100+ 企业 4 年的 AI 咨询公司）指出，AI 落地中技术占比不超过 1/3，真正的挑战是组织变革和业务适配。sofagent 解决的是技术侧的那 1/3——让 FDE 不用操心 Agent 会不会跑偏。详见 [FDE/FDE.md](./FDE/FDE.md)。

### 怎么跑

三件工具怎么跑、依赖什么：

| 工具 | 怎么跑 | 依赖 |
|------|------|------|
| **约束底座** | 纯 MD 规则文件，Agent 启动时自动读到上下文里 | 无——装了就行 |
| **审计引擎** | npm 全局安装，挂载 git pre-commit hook，每次提交自动跑 | git 仓库，不挑 Agent、不挑平台 |
| **编排引擎** | FDE 部署的 workflow AI 节点，自动拆任务、记反思、管 think.md | OpenClaw（装在闲置设备上，后台跑 FDE 节点，不是你的日常 Agent） |

OpenClaw 不是你要"用"的东西——它装在设备上，在后台跑 FDE 的 workflow 节点。你和你的团队用什么 Agent 写代码、提代码，跟 OpenClaw 无关。约束底座和审计引擎不需要 OpenClaw。sofagent-audit 通过 pre-commit hook 审计所有 Agent 的产出，不管是谁写的。

> 两种使用模式的完整说明见 [LIMITATIONS.md §平台依赖](./LIMITATIONS.md#平台依赖)。

---

## Quick Start

> 需要 bash 4+ 和 git。OpenClaw 跑复杂任务另需 Node.js ≥18 + npm（详见 [HANDBOOK](./HANDBOOK.md)）。
> 📋 安装脚本做了什么？看 [SECURITY.md · install.sh 行为说明](./SECURITY.md#installsh-行为说明)。
### 快速体验

只想加 Agent 行为约束？把 4 底线 + 6 铁律复制进你的 Agent 设置就行，不需要装整个 sofagent。

```bash
# ClawHub / SkillHub
clawhub skill install KongFangXun/sofagent
skillhub install sofagent

# 或从仓库手动装
git clone https://github.com/KongFangXun/sofagent.git
bash sofagent/scripts/install.sh
```

### 完整安装

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent && bash sofagent/scripts/install.sh
```

> 有 ClawHub CLI 也可以：`clawhub skill install KongFangXun/sofagent`

### 30 秒 smoke test

```bash
# Skill 用户（通过 install.sh 安装）
bash sofagent/scripts/verify.sh

# CLI 用户（通过 npm 安装）
npm install -g @sofagent/audit && sofagent-verify
```

两种方式等效——50 项检查全 pass 即安装就绪。

### 跑第一个任务

打开你的 Agent 客户端，试一个需要多步拆解的任务：

```
/goal 帮我分析这个项目的代码质量，生成改进建议报告
```

跑完看结果：

```bash
ls .sofagent/task/logs/       # 按年-月分目录的执行日志
cat .sofagent/think.md        # Agent 自动提炼的反思摘要
```

> OpenClaw 上全自动；其他平台部分能力需手动触发。详见 [LIMITATIONS.md](./LIMITATIONS.md#平台依赖)。

**跑通了？** [HANDBOOK](./HANDBOOK.md) 教你怎么调，[DEVELOPMENT](./DEVELOPMENT.md) 讲内部怎么跑。

---

## 怎么工作

两层架构——**地基常驻，引擎按需点火**。

### 企业怎么用

```
梳理企业工作流 → 识别 AI 节点
                     ├── 🔄 自动执行 → 闲置设备搭建 AI 节点
                     └── ⚡ 强化岗位 → AI 领航员辅助人
```

### 节点内部怎么跑

```
    审计引擎（每次提交）                 编排引擎（FDE 进场 + 定期重测）
         │                                       │
         ├─ git diff 扫描                        ├─ FDE 进场：一次性生成 workflow.yaml
         ├─ 规则检查 A1-A11                      │       └─ 智能拆解 → 生成编排方案
         │                                       │
         │                                       ├─ 生产运行：AI 节点按 workflow 执行
         │                                       │       ├─ 🔄 自动执行
         │                                       │       └─ ⚡ AI 领航员辅助
         │                                       │
         │                                       ├─ 定期 A/B 重测（每 N 个 session）
         │                                       │       ├─ 编排引擎重出一版新方案
         │                                       │       └─ sofagent-orchestrate-compare 对比
         │                                       │              ├─ 新方案胜出 → promote
         │                                       │              └─ 旧方案更好 → 保留
         │                                       │
         └────────────── think.md ─────────────────────┘
              （审计引擎写 / 编排引擎读 / A/B 结果写入 orchestrator/）
```

| 引擎 | 做什么 | 依赖 Agent | 触发方式 |
|------|------|:--:|------|
| **审计引擎** | git diff → 规则检查 → 自动生成 think.md | ❌ | 每次 git commit |
| **编排引擎** | FDE 进场一次性生成 workflow + 定期 A/B 重优化 | ✅ | FDE 部署时 / 定时触发 |

> 约束自己定，模板和 Skills 从社区取。已知局限见 [LIMITATIONS.md](./LIMITATIONS.md)。

---

## FDE：从工作流到 AI 节点

Forward Deployed Engineer（前向部署工程师）进驻企业后，做三件事：梳理工作流 → 识别 AI 可切入节点 → 部署 Agent。sofagent 是部署后约束 Agent 行为的那一层——Agent 改了代码你能看到，跳过验证审计能发现，think.md 持续沉淀反思。

**中小企业不需要请顾问——自己就能做 FDE。** 装上 FDE 工具包，Agent 带着你按十步流程走完梳理和识别，然后找一台闲置设备（旧电脑、服务器、Nas 都行），把 sofagent 装上去——这台闲置设备上跑的是 sofagent 的 harness 层——约束底座管着 Agent 行为，审计引擎盯着代码变更。之上是你梳理出来的一个个 AI 节点：🔄 自动执行的跑在上面，⚡ 辅助员工的在你同事手边。从头到尾，不需要一个外部顾问。

企业搭 AI 中台，真正难的是部署后的事——谁盯着 Agent 不乱改代码、谁保证产出质量、谁把经验留下来。sofagent 做这三件：

| 问题 | sofagent 怎么解 |
|------|------|
| Agent 改了什么你不知道 | git diff 审计（确定性 exit code），一次 commit 全查完 |
| Agent 产出质量参差不齐 | think.md 反思 + Loop 检查闭环，越用越校准 |
| FDE 走了经验跟着走了 | task/logs 执行日志 + daemon 持续监控 |

> sofagent 不做 AI 中台——做 AI 中台里**约束 Agent 行为和审计的那一层**。

### 两步落地

1. **梳理 workflow**——逐个岗位、逐段流程识别 AI 可接管的节点（🔄 自动执行 / ⚡ 强化 / 👤 暂不动）
2. **AI 节点部署**——利用企业闲置设备搭建 AI 节点，sofagent 帮你管住 Agent 行为 + 审计每次变更

> 完整十步部署流程见 [FDE/FDE.md](./FDE/FDE.md)。FDE 可直接装 [sofagent-fde Skill](./FDE/SKILL.md)——Agent 自动走流程，不用手动记步骤。

不论是中小企业（SMB）还是一人公司（OPC），让 AI 节点接管重复任务，即使只有一人也能跑出以一当百的产出。

---

## 延伸阅读

| 你想了解 | 看哪里 |
|---------|--------|
| 怎么装、怎么用、什么是铁律 | [HANDBOOK.md](./HANDBOOK.md) |
| 为什么这么设计、已知局限 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Skill 怎么协同、编排怎么跑 | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| 企业落地三阶段指南 | [docs/guides/team-deploy.md](./docs/guides/team-deploy.md) |
| 实际效果数据 | [evidence.md](./docs/evidence/evidence.md) |
| 平台能力与已知局限 | [LIMITATIONS.md](./LIMITATIONS.md) |
| 版本路线图 | [ROADMAP.md](./ROADMAP.md) |
| 版本历史 | [CHANGELOG.md](./CHANGELOG.md) |
| 项目反思 | [THINK.md](./THINK.md) |
| 贡献指南 | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| GitHub Action 审计集成 | [docs/guides/github-action.md](./docs/guides/github-action.md) |
| FDE 工具包 | [FDE/](./FDE/) |
| 安全声明 | [SECURITY.md](./SECURITY.md) |
| 社区与数据 | [COMMUNITY.md](./COMMUNITY.md) |
| 行为准则 | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| 致谢 | [THANKS.md](./THANKS.md) |

---

## 贡献与致谢

欢迎提 Issue 和 PR，尤其挑刺的那种。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。我们在寻找 Co-maintainer——熟悉 bash 兼容性、OpenClaw hook、安全审计或英文文档的人。

sofagent 站在 8 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

> 我叫孔放勋，一个只懂点前端代码的产品经理。
>
> **项目维护模型声明**：sofagent 的代码由 AI 模型（DeepSeek V4 Pro / GLM-5.2）生成，作者做产品决策和终审。这意味着 bug 修复依赖 AI 模型可用性——如果模型停止服务，项目失去修复能力。这是比单人维护更深层的结构性风险。
>
> 每个版本经独立模型评审，详见 [CHANGELOG](./CHANGELOG.md)。我们在寻找 Co-maintainer。
