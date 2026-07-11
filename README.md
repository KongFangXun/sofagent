# sofagent

> 🌐 [English abridged version →](README.en.md) | 🇨🇳 中文完整版

![Verify](https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-v1.0.2-16B8F3)](./CHANGELOG.md)
[![定位：Agent 审计工具](https://img.shields.io/badge/定位-Agent_审计工具-16B8F3)](#一句话定位)
[![核心：审计引擎](https://img.shields.io/badge/核心-审计引擎-16B8F3)](#一句话定位)
[![OpenClaw](https://img.shields.io/badge/🦞_引擎-OpenClaw-FF4D4D)](./ARCHITECTURE.md#两层架构地基-vs-引擎)

<img src="index/sofagent.png" alt="sofagent" width="300" />

> sofa + agent = 沙发特工——希望有一天，我们能躺在沙发上，Agent 就把活干完了。
>
> **企业上 AI，先上缰绳再上路。** 中小企业（SMB）和一人公司（OPC）的 FDE（Forward Deployed Engineer）工具包——约束底座管行为，审计引擎盯结果。不用请昂贵顾问，不用养 AI 团队，自己就能搭建 AI 节点。

> **License**：MIT。代码、文档、模板——随便用，保留版权声明就行。

---

## 一句话定位

给 AI Agent 装一个提交时审计官——看 git diff 硬证据判定违规，不依赖 Agent 自我报告。16 条审计规则（11 默认 + 5 扩展）扫描每次代码变更，自动判定违规、生成反思。中小企业装完就能用，不用请顾问、不用写 prompt。

> **和 detect-secrets 有什么区别**？detect-secrets 是通用密钥扫描器，sofagent A1/A2 是 Agent 场景定制——不仅检测密钥，还关联 A3 越界上下文（为什么这个文件被改了？）和 A7/A8 流程合规（改之前读了没？改之后测了没？）。

> ⚠️ **Klarna 教训**：瑞典金融科技公司 Klarna 裁掉 700 人用 AI 替代，一年后被迫召回——不是因为 AI 不能干活，是因为责任悬空了。sofagent 做的就是「让责任不悬空」。→ [详见 FDE](./FDE/FDE.md#附录企业-ai-成熟度三级台阶)

> 🔬 **为什么相信 Harness 有用**？Hugging Face 实验：同一模型不改权重，仅优化外层 Harness，得分从 3.5%→80.1%。→ [详见 ARCHITECTURE](./ARCHITECTURE.md#理论基础与外部验证)

> **成熟度**：审计引擎是核心，日常稳定（核心逻辑 418 tests 全绿——diff-parser / config-loader / rules A1-A14 / reporter / log-checker；daemon / MCP / install.sh 依赖手动验证 + verify.sh 48 项环境检查，详见 LIMITATIONS。5/5 靶向违规全部检出（作者自测，非独立验证），3 名外部用户验证）。编排引擎需要 OpenClaw 环境，能跑但还在打磨。

| 组件 | 做什么 | 怎么跑 |
|------|------|------|
| **审计引擎** | git diff → 16 条规则（11 默认 + 5 扩展）→ exit code | git pre-commit hook，不挑 Agent、不挑平台 |
| **约束底座** | MD 规则注入 Agent 上下文 | install.sh 装完自动加载 |
| **编排引擎**（实验性）| 拆任务 → 编排 → 执行 | ao compose（跑在 OpenClaw 上） |

审计引擎零 Agent 依赖——A1/A2/A9-A11 是纯 git-diff 规则（不依赖 Agent 日志），A3/A7/A8 依赖 Agent 日志（软证据）。`--silent` 模式只跑纯 diff 规则。约束底座和审计引擎不需要 ao compose。编排引擎才需要（ao compose 跑在 OpenClaw 上）。

---

## Quick Start

```bash
npm install -g @sofagent/audit && sofagent-audit --init
```

> 需要 bash + git。完整安装（含编排引擎）需 OpenClaw 环境。详见 [HANDBOOK · 安装](./HANDBOOK.md#场景一装完第一件事)。从 v0.99.x 升级？重跑 `npm install -g @sofagent/audit`，配置兼容无需改动。安装脚本做了什么？[SECURITY.md](./SECURITY.md#installsh-行为说明)。平台支持：macOS / Linux 全功能，Windows 实验性。

## 怎么工作

两层架构——**地基常驻，引擎按需点火**。企业梳理工作流 → 识别 AI 节点，详细用法见 [HANDBOOK](./HANDBOOK.md)。

### 节点内部怎么跑

```
    审计引擎（每次提交）                 编排引擎（Workflow 梳理 + 定期重测）
         │                                       │
         ├─ git diff 扫描                        ├─ Workflow 梳理：生成节点文档（nodes/*.md）
         ├─ 规则检查 A1-A14                      │       └─ Agent 读 .md → 注入 ao compose 拆任务
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

> 完整五层架构（Harness → 执行 → 审计 → MCP → 协同）详见 [ARCHITECTURE](./ARCHITECTURE.md)。已知局限见 [LIMITATIONS.md](./LIMITATIONS.md)。

---

## FDE：从工作流到 AI 节点

### 一个嵌套关系：FDE 工作用 sofagent，客户部署后也用 sofagent

FDE 工具包本身就是 sofagent 产品的一部分。整个逻辑是嵌套的：

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

**一句话：FDE 工作用自己产品，给别人部署完让别人也用自己产品。产品的核心是底座。**

> FDE（Forward Deployed Engineer）进驻企业走四阶段十二步：梳理工作流 → 构建本体模型 → 识别节点与量化 → 部署落地。完整流程见 [FDE/FDE.md](./FDE/FDE.md)，直接装 [sofagent-fde Skill](./FDE/SKILL.md) 让 Agent 带着走。中小企业不需要请顾问——自己就能做。

---

## 延伸阅读

| 你想了解 | 看哪里 |
|---------|--------|
| 怎么装、怎么用、什么是铁律 | [HANDBOOK.md](./HANDBOOK.md) |
| 为什么这么设计、已知局限 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 铁律为什么是 7 则 + 知行合一 | [ARCHITECTURE.md](./ARCHITECTURE.md#行业印证palantir--不可溶解的护城河) |
| AI 知识库怎么工作 | [ARCHITECTURE.md](./ARCHITECTURE.md#数据层ai-知识库v101-实现) |
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
> **项目维护模型声明**：sofagent 的代码由 AI 模型（DeepSeek V4 Pro / GLM-5.2）编写，作者做产品决策和终审。每个版本经独立模型评审。我们在寻找 Co-maintainer——详情见 [CHANGELOG](./CHANGELOG.md)。
