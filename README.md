# sofagent

> 🌐 [English abridged version →](README.en.md) | 🇨🇳 中文完整版

![Verify](https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-v0.99.8-16B8F3)](./CHANGELOG.md)
[![定位：Agent 审计工具](https://img.shields.io/badge/定位-Agent_审计工具-16B8F3)](#一句话定位)
[![核心：审计引擎](https://img.shields.io/badge/核心-审计引擎-16B8F3)](#一句话定位)
[![OpenClaw](https://img.shields.io/badge/🦞_引擎-OpenClaw-FF4D4D)](./LIMITATIONS.md#平台依赖)

<img src="index/sofagent.png" alt="sofagent" width="300" />

> sofa + agent = 沙发特工——希望有一天，我们能躺在沙发上，Agent 就把活干完了。
>
> **企业上 AI，先上缰绳再上路。** 中小企业和 OPC 的 FDE 工具包——约束底座管行为，审计引擎盯结果。不用请昂贵顾问，不用养 AI 团队，自己就能搭建 AI 节点。

> **License**：MIT。代码、文档、模板——随便用，保留版权声明就行。

---

## 一句话定位

给 AI Agent 装一个提交时审计官——不看 Agent 怎么说，只看 git diff 怎么变。11 条审计规则扫描每次代码变更，自动判定违规、生成反思。中小企业装完就能用，不用请顾问、不用写 prompt。

> **成熟度说明**：作者自用一个多月，审计引擎日常稳定（406 tests 全绿，5/5 靶向违规全部检出）。编排引擎能跑但未到「装上就能用」。如果你试了，告诉我什么场景、什么问题。

| 组件 | 做什么 | 怎么跑 |
|------|------|------|
| **审计引擎** | git diff → 11 条规则 → exit code | git pre-commit hook，不挑 Agent、不挑平台 |
| **约束底座** | MD 规则注入 Agent 上下文 | install.sh 装完自动加载 |
| **编排引擎**（实验性）| 拆任务 → 编排 → 执行 | ao compose（跑在 OpenClaw 上） |

审计引擎零 Agent 依赖——看的是已发生的 git diff。约束底座和审计引擎不需要 ao compose。编排引擎才需要（ao compose 跑在 OpenClaw 上）。

---

## Quick Start

> 需要 bash 4+ 和 git。OpenClaw 跑复杂任务另需 Node.js ≥18 + npm（详见 [HANDBOOK](./HANDBOOK.md)）。
> 📋 安装脚本做了什么？看 [SECURITY.md · install.sh 行为说明](./SECURITY.md#installsh-行为说明)。
>
> **平台支持**：macOS / Linux 全功能。Windows 为**实验性**（PowerShell 脚本功能覆盖不全，核心审计引擎可用但部分检查项缺失，详见 [LIMITATIONS](./LIMITATIONS.md#windows-支持是实验性的)）。
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

两种方式等效——verify 检查全 pass 即安装就绪。

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
    审计引擎（每次提交）                 编排引擎（FDE 部署 + 定期重测）
         │                                       │
         ├─ git diff 扫描                        ├─ FDE 部署：生成节点文档（nodes/*.md）
         ├─ 规则检查 A1-A11                      │       └─ Agent 读 .md → 注入 ao compose 拆任务
         │                                       │
         │                                       ├─ 生产运行：AI 节点按编排方案执行
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
| **编排引擎** | FDE 部署时生成节点定义 + 定期 A/B 重优化 | ✅ | FDE 部署时 / 定时触发 |

> 约束自己定，模板和 Skills 从社区取。已知局限见 [LIMITATIONS.md](./LIMITATIONS.md)。

---

## FDE：从工作流到 AI 节点

### 一个嵌套关系：自己人用 sofagent，客户也用 sofagent

FDE 工具包本身就是 sofagent 产品的一部分。整个逻辑是嵌套的：

```
我们公司 = 做 FDE 的公司
    │
    │  FDE 本身也是一个 workflow（12 步）
    │
    ├── FDE（⚡ 强化节点）
    │   └── 工具 = sofagent 约束底座 + FDE Skill 工具包
    │       └── 用自己的 Agent（WorkBuddy / Codex）走 12 步
    │
    └── 给客户部署
        ├── 找台闲置设备装 sofagent 底座 ← 核心产品落地
        └── 上面跑客户的 AI 节点（客户自己的 workflow）
```

**一句话：自己人办事用自己产品，给别人办完让别人用自己产品。产品的核心是底座。**

### 什么是 FDE

Forward Deployed Engineer（前向部署工程师）进驻企业后，做三件事：梳理工作流 → 识别 AI 可切入节点 → 部署 Agent。**部署的核心是装上 sofagent**——不只是一个 Skill，是三层引擎合起来的平台：

| 层 | 做什么 |
|----|--------|
| 约束底座 | fde.md 规则注入 Agent 上下文，管 Agent 行为 |
| 审计引擎 | git diff → 11 条规则 → exit code，盯每次变更 |
| 编排引擎（实验性）| ao compose 拆任务生成编排方案 |

三层装到设备上，你梳理的 AI 节点才有了纪律和审计。

**中小企业不需要请顾问——自己就能做 FDE。** 装上 [FDE 工具包](./FDE/)，Agent 带着你按四阶段十二步走完（进场→挖掘→交付→检查离场），然后找一台闲置设备（旧电脑、服务器、Nas 都行），把 sofagent 装上去——上面跑你梳理出来的 AI 节点：🔄 自动执行的跑在上面，⚡ 强化岗位的在你同事手边。从头到尾，不需要一个外部顾问。

### 离场后企业留下什么

| 产物 | 说明 |
|------|------|
| **一份交付手册** | 企业画像 + 部署方案 + `fde.md` + `quick-start.md`（后两章安装包自带） |
| **一套 AI 节点（三层实体）** | 每个节点：文档层（.md，人读+编排引擎读）+ Skill 层（企业专属 Skill）+ 运行层（在跑的 session） |
| **一个会自己生长的知识库** | AI 跑着跑着自动积累（think.md / task/logs / scoring.md / orchestrator/） |

> sofagent 不做 AI 中台——做 AI 中台里**约束 Agent 行为和审计的那一层**。

### 四步落地

1. **梳理工作流**——逐个岗位、逐段流程画出来
2. **识别 AI 节点**——标注哪些可以自动化（🔄）、哪些强化岗位（⚡）
3. **装上 sofagent**——找一台闲置设备，`install.sh` 一键部署三层引擎（核心步骤，没有这步前面全白做）
4. **自动跑业务**——AI 节点自己干活、自己汇报、自己复盘

> 完整四阶段十二步部署流程见 [FDE/FDE.md](./FDE/FDE.md)。FDE 可直接装 [sofagent-fde Skill](./FDE/SKILL.md)——Agent 自动走流程，不用手动记步骤。

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
