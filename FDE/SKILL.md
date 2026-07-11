---
name: sofagent-fde
slug: sofagent-fde
displayName: sofagent-fde
description: >
  FDE 专属——需要帮企业部署 AI 节点但不知道从哪入手。装上后 Agent 带你完成企业 AI 化全流程。
version: 1.0.3
tags: [fde, workflow, deployment, enterprise, ai-agent]
image: sofagent.png
triggers: [FDE部署, 企业AI化, 梳理工作流, 识别AI节点, 出交付手册, 建知识库, 企业工作流改造]
scenarios: [企业要做AI化但不知道从哪开始, 梳理完工作流不知道怎么识别AI节点, 部署后不知道怎么管Agent行为, 想让Agent自动出交付手册]
not_when: [纯技术讨论, 代码bug修复, 写业务代码]
---

# sofagent-fde · SKILL.md · v1.0.3

> FDE 专属 Skill。激活后加载四阶段十二步部署流程（进场→挖掘→交付→检查离场），
> 按 FDE.md §1-12 引导你完成企业 AI 部署。你负责聊业务，Agent 负责出方案、搭节点。

## 为什么要用

装上之后，Agent 就像一个工头，带着 AI 工人进企业干活：适配上下文、搭建工作台、做业务融合，确认每个 AI 节点都能独立产出价值后才离场。**离场后企业留下三样东西：一份谁都能看懂的交付手册、一套在跑的 AI 节点、一个会自己生长的 AI 知识库。**

## 适用场景

你是一名 FDE（Forward Deployed Engineer），进驻企业帮助 AI 化。你的工作是按四阶段十二步：梳理工作流 → 构建本体模型 → 识别节点与量化 → 部署方案 → 部署落地 → 检查离场。这个 Skill 就是你的工作台。

## 前置依赖

- 已装 sofagent（`bash fde-install.sh` 或 `sofagent/scripts/install.sh`）
- OpenClaw 最佳（编排引擎可用），WorkBuddy/Codex 核心约束可用

## 安装

```bash
# ClawHub / SkillHub
clawhub skill install KongFangXun/sofagent-fde   # 或 skillhub install sofagent-fde

# 手动安装（WorkBuddy / OpenClaw）
cp -r FDE/ ~/.workbuddy/skills/sofagent-fde/
cp -r FDE/ ~/.openclaw/skills/sofagent-fde/
```

## 激活

| 平台 | 怎么激活 |
|------|------|
| OpenClaw | 装完自动就绪，Agent 检测到 FDE 场景后加载 |
| WorkBuddy | 输入 `@skill:sofagent-fde` |
| Codex / 其他 | 复制 FDE/README.md 中的种子指令 |

## 激活后行为

1. Read `FDE/FDE.md`——四阶段十二步流程知识文档（**唯一知识源**，含角色定义 + 步骤详解）
2. Read `FDE/templates/`——交付物模板（企业画像 + 部署方案 + 工作流节点文档 + 企业 Skill）
3. 输出：「FDE 工具包已就绪。请告诉我这次部署的企业基本信息（名称/行业/规模/部门），我们开始 §1 确定场景。」

## 流程规则

按 FDE.md §1-12 顺序执行，每步产出对应 output，每阶段的角色定义详见 FDE.md 各阶段标题。每步完成后输出中间产物，§9 统一打包为交付手册 + AI 节点 + AI 知识库。

## 交付物（详见 FDE.md §9）

> 以下产物运行在 **sofagent 三层引擎**（约束底座 + 审计引擎 + 编排引擎）上，已在「前置依赖」安装。

| 产物 | 是什么 |
|------|------|
| **交付手册** | 企业画像 + 部署方案 + `fde.md` + `quick-start.md`（后两章安装包自带） |
| **AI 节点（三层实体）** | 文档层（`nodes/*.md`，人读+编排引擎读）+ Skill 层 + 运行层 |
| **AI 知识库** | AI 节点跑起来后自动积累（think.md / task/logs / scoring.md / orchestrator/） |

## Gotcha

- **跳过 §1 直接问 AI 节点**——没企业画像就识别节点等于瞎猜
- **§4 五要素没填满就往下走**——缺一项就是不完整节点，AI 节点部署后跑不通
- **用 OpenClaw 以外平台忘了复制种子指令**——WorkBuddy/Codex 不自动加载 Skill
