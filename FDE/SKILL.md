---
name: sofagent-fde
slug: sofagent-fde
displayName: sofagent-fde
description: >
  FDE 专属——装上之后 Agent 帮你走完四阶段十二步部署流程（进场→挖掘→交付→检查离场），
  识别 AI 节点、出部署方案、建知识库。你负责聊业务，Agent 负责出方案。
version: 0.99.8
tags: [fde, workflow, deployment, enterprise, ai-agent]
image: index/sofagent.png
triggers: [FDE部署, 企业AI化, 梳理工作流, 识别AI节点, 出部署方案, 建知识库, 企业工作流改造]
scenarios: [企业要做AI化但不知道从哪开始, 梳理完工作流不知道怎么识别AI节点, 部署后不知道怎么管Agent行为, 想让Agent自动出部署方案书]
not_when: [纯技术讨论, 代码bug修复, 写业务代码]
---

# sofagent-fde · SKILL.md · v0.99.8

> FDE 专属 Skill。激活后加载四阶段十二步部署流程（进场→挖掘→交付→检查离场），
> 按 FDE.md §1-12 引导你完成企业 AI 部署。
> 你负责聊业务，Agent 负责出方案、搭节点、建知识库。

## 为什么要用这个 Skill

不是给 Agent 写 prompt，不是装完就完——装上之后，Agent 就像一个工头，带着 AI 工人进企业干活：适配上下文、搭建工作台、做业务融合，确认每个 AI 节点都能独立产出价值后才离场。

**离场后，企业留下三样东西：一份谁都能看懂的部署方案、一套在跑的 AI 节点、一个会自己生长的知识库。**

## 适用场景

你是一名 FDE（Forward Deployed Engineer），进驻企业帮助 AI 化。你的工作是按四阶段（进场→挖掘→交付→检查离场）梳理 workflow → 识别 AI 节点 → 部署 Agent。这个 Skill 就是你的工作台——Agent 帮你拆任务、记反思、沉淀经验。

## 前置依赖

- 已装 sofagent（`bash fde-install.sh` 或 `sofagent/scripts/install.sh`）
- OpenClaw 最佳（编排引擎可用），WorkBuddy/Codex 核心约束可用

## 安装

```bash
# ClawHub
clawhub skill install KongFangXun/sofagent-fde

# SkillHub
skillhub install sofagent-fde

# 手动安装（WorkBuddy）
cp -r FDE/ ~/.workbuddy/skills/sofagent-fde/

# 手动安装（OpenClaw）
cp -r FDE/ ~/.openclaw/skills/sofagent-fde/
```

## 激活

| 平台 | 怎么激活 |
|------|------|
| OpenClaw | 装完自动就绪，Agent 检测到 FDE 场景后加载 |
| WorkBuddy | 输入 `@skill:sofagent-fde` |
| Codex / 其他 | 复制 FDE/README.md 中的种子指令 |

## 激活后行为

1. Read `FDE/FDE.md`——四阶段十二步流程知识文档
2. Read `FDE/workflow/template.yaml`——流程模板
3. Read `FDE/agents/templates.md`——Agent 角色定义（分析师/规划师/部署工程师）
4. 输出：「FDE 工具包已就绪。请告诉我这次部署的企业基本信息（名称/行业/规模/部门），我们开始 §1 确定场景。」

## 流程规则

- 按 template.yaml 的步骤顺序执行，每步产出该步的 output
- §1-6 用分析师角色——会追问、会记录、不替用户下判断（进场→挖掘阶段）
- §7-9 用规划师角色——会算成本、会做方案对比（交付阶段）
- §10-12 用部署工程师角色——会跑脚本、设检查点、建知识库（检查离场阶段）
- 每步完成后输出中间产物，§9 统一打包为部署方案 + 知识库 + 运行确认

## 交付物

| 产物 | 是什么 |
|------|------|
| **部署方案** | 一份五章 .md 文件，从企业现状到部署方案，任何人翻一遍都能懂 |
| **知识库** | 五个静态文档（工作流全景图 / 节点手册 / 运维手册 / 上手文档 / 故障排查） |
| **运行确认** | 每个 AI 节点已跑通、已检查、已交付的记录 |

## Gotcha

- **跳过 §1 直接问 AI 节点**——没企业画像就识别节点等于瞎猜。后果：部署方案和实际业务脱节
- **§4 五要素没填满就往下走**——输入/输出/负责人/耗时/痛点缺一项就是不完整节点。后果：AI 节点部署后跑不通
- **用 OpenClaw 以外平台忘了复制种子指令**——WorkBuddy/Codex 不自动加载 Skill。后果：Agent 不识别 FDE 场景
