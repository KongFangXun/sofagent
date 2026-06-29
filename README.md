# sofagent

中文 | [English](README.en.md)

[![License](https://img.shields.io/badge/license-MIT-brightgreen)](./LICENSE)
![Verify](https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg)
![ShellCheck](https://github.com/KongFangXun/sofagent/actions/workflows/shellcheck.yml/badge.svg)
[![Version](https://img.shields.io/badge/version-0.96-16B8F3)](./HANDBOOK.md)
[![Last Updated](https://img.shields.io/badge/last--updated-2026--06--29-16B8F3)](./README.md)
[![定位](https://img.shields.io/badge/定位-AI中台纪律底座-16B8F3)](#一句话定位)
[![OpenClaw](https://img.shields.io/badge/🦞优先-OpenClaw-FF4D4D)](./LIMITATIONS.md#平台依赖)
[![GitHub stars](https://img.shields.io/github/stars/KongFangXun/sofagent?style=flat&color=F1C40F&label=%F0%9F%8C%9FStarred)](https://github.com/KongFangXun/sofagent/stargazers)

<img src="images/sofagent.png" alt="sofagent" width="300" />

> sofa + agent = 沙发特工——希望有一天，我们能躺在沙发上，Agent 就把活干完了。

> **License**：MIT。代码、文档、模板——随便用，保留版权声明就行。

---

## 一句话定位

**sofagent 是 AI 中台的纪律底座——接得进、信得过、留得住。**

给你的 Agent 配一个设备端纪律委员：不是让它更聪明，是让它**守规矩、留痕迹、能复盘**。4 底线 + 6 铁律约束行为，git diff 审计兜底验证，FDE 走了企业也能管住 Agent。

> - ❌ 不是 AI 框架、不写 prompt
> - ❌ 不是 Skills 商店
> - ✅ 是一套**跨平台纪律框架**——OpenClaw 完整生效，其他平台核心约束可用（详见 [平台差异](./LIMITATIONS.md#平台依赖)）

---

## 三个版本

| | **Lite** | **Full** | **FDE** |
|---|---|---|---|
| **装什么** | 4 底线 + 6 铁律（30 秒） | + 编排引擎 + 审计 + 反思记忆 | + 十步企业部署流程 |
| **适合谁** | 个人开发者、快速试用 | 研发团队、跑复杂任务 | 企业、FDE 工程师 |
| **平台** | 全平台（宪法层生效） | OpenClaw 完整，其他平台核心约束可用 | 企业闲置设备 |

> Lite 在任何平台都能用——OpenClaw 上全套生效，WorkBuddy / Cursor / Windsurf 等平台只有宪法层（4 底线 + 6 铁律），编排引擎和审计需要 OpenClaw hook 支持。不确定装哪个？先 Lite 30 秒试试。

---

## Quick Start

> 需要 bash 4+ 和 git。OpenClaw 跑复杂任务另需 Node.js ≥18 + npm（详见 [HANDBOOK](./HANDBOOK.md)）。

### 快速体验（Lite，30 秒）

Lite 版只装 4 底线 + 6 铁律——不装 daemon、编排引擎、审计工具。适合非 OpenClaw 平台和快速试用。

```bash
# ClawHub / SkillHub
clawhub skill install sofagent-lite
skillhub install sofagent-lite

# 或从仓库手动装
git clone https://github.com/KongFangXun/sofagent.git
sh sofagent/sofagent-lite/install.sh
```

### 完整安装（两步）

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
                     ├── 🔄 自动执行 → 闲置设备搭无人计算节点
                     └── ⚡ 强化岗位 → AI 领航员辅助人
```

### 节点内部怎么跑

```
三层加载链（常驻地基：宪法 → 反思区 → 你的规则）
          ↓
    复杂度预判 ─── 🟢🟡 简单 → 直接回答
                  🔴 复杂 → 编排引擎点火
                               │
                    智能拆解 → 批量执行 → Loop 检查
                                          │
                                     反思闭环 ★ → 下个任务从中学习
```

| 层 | 做什么 |
|----|------|
| **地基** | 三层加载链——宪法（4 底线 + 6 铁律）→ 反思区（自动错题本）→ 你的规则，整个会话期间永远在线 |
| **引擎** | 任务编排引擎——🔴 复杂任务时点火，智能拆解 + Loop 检查 + 闭环反思 |
| **进化** | 渐进减薄——同类任务根据历史成功率调整编排深度，跑崩了恢复完整编排 |

> 核心理念：**厚在治理，薄在复用。** 约束自己定，模板和 Skills 从社区取。

> 效果数据正在持续收集，详见 [EVIDENCE.md](./docs/EVIDENCE.md)。已知局限见 [LIMITATIONS.md](./LIMITATIONS.md)。

---

## FDE：从工作流到无人计算节点

企业搭 AI 中台，卡在三件事上——sofagent 是纪律那一层的解法：

| AI 中台三难 | 卡在哪 | sofagent 怎么解 |
|------------|--------|---------------|
| **接入难** | 各系统 API 不统一，Agent 节点怎么接 | FDE 十步流程梳理工作流 + MCP 桥接平台 |
| **信任难** | Agent 改了代码/数据，老板凭什么信 | git diff 审计（确定性 exit code），不是 LLM 评分 |
| **沉淀难** | FDE 走了，经验跟着走了 | think.md 反思区 + task/logs 经验沉淀 |

> sofagent 不做 AI 中台——做 AI 中台里**纪律那一层**。模型管推理，平台管调度，sofagent 管纪律。

### 两步落地

**第一步：梳理 workflow。** 逐个岗位、逐段流程摸清楚，识别哪些节点能被 AI 接管（🔄 自动执行 / ⚡ 强化岗位 / 👤 暂时不动）。

**第二步：AI 节点上底座。** 每个 🔄 自动执行节点，利用企业**闲置设备**（旧电脑、空闲服务器）搭建一个**自动无人小型计算节点**——sofagent 提供纪律底座，Agent 自动执行任务并推送结果，不需要人盯着。

### 不只是开发者

不论是中小企业（SMB）还是一人公司（OPC），sofagent 对你同样有用。它提升的是公司自动化办公效率：梳理业务工作流，让 AI 节点接管重复任务，即使只有一人也能跑出以一当百的产出。

> 完整十步 FDE 部署流程见 [sofagent-fde/SKILL.md](./sofagent-fde/SKILL.md)

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
| 企业落地三阶段指南 | [docs/team-deploy.md](./docs/team-deploy.md) |
| 实际效果数据 | [EVIDENCE.md](./docs/EVIDENCE.md) |
| 平台能力与已知局限 | [LIMITATIONS.md](./LIMITATIONS.md) |
| 版本路线图 | [ROADMAP.md](./ROADMAP.md) |

---

## 贡献与致谢

欢迎提 Issue 和 PR，尤其挑刺的那种。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。我们在寻找 Co-maintainer——熟悉 bash 兼容性、OpenClaw hook、安全审计或英文文档的人。

sofagent 站在 8 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

> 我叫孔放勋，一个只懂点前端代码的产品经理。所有设计决策来自大半年的真实使用经验。每个版本经独立模型评审，详见 [CHANGELOG](./CHANGELOG.md)。
