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

## 给三类人

| 你是谁 | 怎么用 sofagent |
|--------|---------------|
| **企业老板** | 不用看——FDE 交付方案书和运行报告，你只看结果 |
| **FDE / 企业 IT** | 十步标准化部署，装纪律底座 + 审计工具 |
| **开发者** | 30 秒 Lite 装宪法层，或完整安装跑编排引擎 |

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

| 层 | 做什么 |
|----|------|
| **地基** | 三层加载链——宪法（4 底线 + 6 铁律）→ 反思区（自动错题本）→ 你的规则，整个会话期间永远在线 |
| **引擎** | 任务编排引擎——🔴 复杂任务时点火，智能拆解 + Loop 检查 + 闭环反思 |
| **进化** | 渐进减薄——同类任务根据历史成功率调整编排深度，跑崩了恢复完整编排 |

> 核心理念：**厚在治理，薄在复用。** 约束自己定，模板和 Skills 从社区取。

```
三层加载链（常驻地基：宪法 → 反思区 → 你的规则）
          ↓
    复杂度预判 ─── ✅⚠️ 简单 → 直接回答
                  🔴 复杂 → 编排引擎点火
                               │
                    智能拆解 → 批量执行 → Loop 检查
                                          │
                                     反思闭环 ★ → 下个任务从中学习
```

> 效果数据正在持续收集，详见 [EVIDENCE.md](./docs/EVIDENCE.md)。已知局限见 [LIMITATIONS.md](./LIMITATIONS.md)。

---

## FDE 场景 + AI 中台

企业搭 AI 中台，卡在三件事上——sofagent 是纪律那一层的解法：

| AI 中台三难 | 卡在哪 | sofagent 怎么解 |
|------------|--------|---------------|
| **接入难** | 各系统 API 不统一，Agent 节点怎么接 | FDE 十步流程梳理工作流 + MCP 桥接平台 |
| **信任难** | Agent 改了代码/数据，老板凭什么信 | git diff 审计（确定性 exit code），不是 LLM 评分 |
| **沉淀难** | FDE 走了，经验跟着走了 | think.md 反思区 + task/logs 经验沉淀 |

> sofagent 不做 AI 中台——做 AI 中台里**纪律那一层**。模型管推理，平台管调度，sofagent 管纪律。

**FDE 十步部署**：[sofagent-fde/SKILL.md](./sofagent-fde/SKILL.md) —— 带着 Agent 进驻企业，十步跑通落地，走了企业也能管住 Agent。

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

**致谢**：[OpenClaw](https://github.com/openclaw/openclaw)（基石）· [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) + [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)（编排引擎 + 中文岗位库）· [Ralph Loop](https://ghuntley.com/loop/)（「Agent 失忆，文件不失忆」哲学基因）· [MiroFish](https://github.com/666ghj/MiroFish)（审计证据分层启发）· [DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/) + [GLM-5.2](https://z.ai/)（文档生成）· [Anthropic Skills](https://github.com/anthropics/skills)（SKILL.md 格式源头）

> 我叫孔放勋，一个只懂点前端代码的产品经理。所有设计决策来自大半年的真实使用经验。每个版本经独立模型评审，详见 [CHANGELOG](./CHANGELOG.md)。
