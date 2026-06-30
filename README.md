# sofagent

中文 | [English](README.en.md)

[![License](https://img.shields.io/badge/license-MIT-brightgreen)](./LICENSE)
![Verify](https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg)
![ShellCheck](https://github.com/KongFangXun/sofagent/actions/workflows/shellcheck.yml/badge.svg)
[![Version](https://img.shields.io/badge/version-v0.98-16B8F3)](./HANDBOOK.md)
[![Last Updated](https://img.shields.io/badge/last--updated-2026--06--30-16B8F3)](./README.md)
[![定位](https://img.shields.io/badge/定位-FDE部署底座-16B8F3)](#一句话定位)
[![OpenClaw](https://img.shields.io/badge/🦞优先-OpenClaw-FF4D4D)](./LIMITATIONS.md#平台依赖)
[![GitHub stars](https://img.shields.io/github/stars/KongFangXun/sofagent?style=flat&color=F1C40F&label=%F0%9F%8C%9FStarred)](https://github.com/KongFangXun/sofagent/stargazers)

<img src="images/sofagent.png" alt="sofagent" width="300" />

> sofa + agent = 沙发特工——希望有一天，我们能躺在沙发上，Agent 就把活干完了。

> **License**：MIT。代码、文档、模板——随便用，保留版权声明就行。

---

## 一句话定位

FDE 部署底座 —— 面向中小企业（SMB）和一人公司（OPC）。部署专家用标准化流程搭建 workflow AI 节点，实施后审计引擎 + 编排引擎托管，企业自己管得住、成本可核算、效果可量化。

> 💡 **为什么需要纪律层**：企业 AI 落地的核心矛盾，是将概率性的大模型装进必须可追踪、可控制、可问责的传统业务流程中。模型负责建议，系统负责验收，工具负责执行——这就是 sofagent 做的事。

> - ❌ 不是 AI 框架、不写 prompt
> - ❌ 不是 Skills 商店
> - ✅ 是一套**审计引擎 + FDE 部署底座**——git diff 审计兜底，OpenClaw 必装执行引擎（详见 [平台依赖](./LIMITATIONS.md#平台依赖)）

---

---

## Quick Start

> 需要 bash 4+ 和 git。OpenClaw 跑复杂任务另需 Node.js ≥18 + npm（详见 [HANDBOOK](./HANDBOOK.md)）。
> 📋 安装脚本做了什么？看 [SECURITY.md · install.sh 行为说明](./SECURITY.md#installsh-行为说明)。
### 快速体验（宪法层）

只想挂个纪律底线？装主产品即可——宪法层（4 底线 + 6 铁律）已内联到 SKILL.md 顶部。

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
bash sofagent/scripts/verify.sh    # 预期 9 类 24+ 检查全 pass
```

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
双引擎架构（审计引擎 + 编排引擎，think.md 交汇）

审计引擎（提交时）                 编排引擎（运行时）
    │                                  │
    ├─ git diff 扫描                   ├─ SKILL.md 加载（宪法内联）
    ├─ 规则检查 A1-A11                ├─ 复杂度预判
    ├─ 自动生成 think.md ─────┐        │   ├─ 🟢🟡 简单 → 直接处理
    │                         │        │   └─ 🔴 复杂 → 编排引擎点火
    │                         │        │         ├─ 智能拆解
    │                         │        │         └─ Loop 检查
    │                         │        └─ 闭环反思 → think.md ─┘
    └─────────────────────────┴────────┘
              think.md 是交汇点
         （审计引擎写 / 编排引擎读）
```

| 引擎 | 做什么 | 依赖 Agent |
|------|------|:--:|
| **审计引擎** | git diff → 规则检查 → 自动生成 think.md | ❌ 不依赖 |
| **编排引擎** | 复杂任务拆解 + Loop 检查 + 闭环反思 | ✅ 依赖 |

> 核心理念：**厚在治理，薄在复用。** 约束自己定，模板和 Skills 从社区取。

> 效果数据正在持续收集，详见 [evidence.md](./docs/evidence/evidence.md)。已知局限见 [LIMITATIONS.md](./LIMITATIONS.md)。

---

## FDE：从工作流到 AI 节点

### FDE 部署场景

Forward Deployed Engineer（前线部署工程师）进驻企业后，做三件事：梳理工作流 → 识别 AI 可切入节点 → 部署 Agent。但 FDE 离开后，谁来管这些 Agent？

sofagent 是 FDE 撤离后留在线上的纪律层——Agent 改了代码，你能看到改了什么；Agent 跳过验证，审计工具能发现。FDE 负责「AI 怎么部署到企业」，sofagent 负责「部署完后 Agent 按什么规矩跑」。

企业搭 AI 中台，卡在三件事上——sofagent 是纪律那一层的解法：

| AI 中台三难 | 卡在哪 | sofagent 怎么解 |
|------------|--------|---------------|
| **接入难** | 各系统 API 不统一，Agent 节点怎么接 | FDE 十步流程梳理工作流 + MCP 桥接平台 |
| **信任难** | Agent 改了代码/数据，老板凭什么信 | git diff 审计（确定性 exit code），不是 LLM 评分 |
| **沉淀难** | FDE 走了，经验跟着走了 | think.md 反思区 + task/logs 经验沉淀 |

> sofagent 不做 AI 中台——做 AI 中台里**纪律那一层**。模型管推理，平台管调度，sofagent 管纪律。

### 两步落地

**第一步：梳理 workflow。** 逐个岗位、逐段流程摸清楚，识别哪些节点能被 AI 接管（🔄 自动执行 / ⚡ 强化岗位 / 👤 暂时不动）。

**第二步：AI 节点上底座。** 每个 🔄 自动执行节点，利用企业**闲置设备**（旧电脑、空闲服务器）搭建 AI 节点——sofagent 提供纪律底座，Agent 自动执行任务并推送结果，不需要人盯着。

### 不只是开发者

不论是中小企业（SMB）还是一人公司（OPC），sofagent 对你同样有用。它提升的是公司自动化办公效率：梳理业务工作流，让 AI 节点接管重复任务，即使只有一人也能跑出以一当百的产出。

> 完整十步 FDE 部署流程见 [FDE.md](./FDE.md)

**提交时审计**：

```bash
# 任何 git 仓库都能跑，零依赖 Agent 配合
sofagent-audit --silent --diff HEAD~1..HEAD --task "迁移认证方案"
```

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

---

## 贡献与致谢

欢迎提 Issue 和 PR，尤其挑刺的那种。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。我们在寻找 Co-maintainer——熟悉 bash 兼容性、OpenClaw hook、安全审计或英文文档的人。

sofagent 站在 8 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

> 我叫孔放勋，一个只懂点前端代码的产品经理。所有设计决策来自大半年的真实使用经验。每个版本经独立模型评审，详见 [CHANGELOG](./CHANGELOG.md)。
