---
name: sofagent-fde
description: FDE 专属——装上之后 Agent 帮你走十步部署流程，识别 AI 节点、出方案书、建知识库。你负责聊业务，Agent 负责出方案。
version: 0.99
tags: [fde, workflow, deployment, enterprise, ai-agent]
---

# sofagent-fde · SKILL.md · v0.99

> FDE 专属 Skill。激活后加载十步部署流程，
> 按 FDE.md §一到§九 引导你完成企业 AI 部署。
> 你负责聊业务，Agent 负责出方案书、知识库、workflow。

## 适用场景

你是一名 FDE（Forward Deployed Engineer），进驻企业帮助 AI 化。你的工作是：梳理 workflow → 识别 AI 节点 → 部署 Agent。这个 Skill 就是你的工作台——Agent 帮你拆任务、记反思、沉淀经验。

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

1. Read `FDE/FDE.md`——十步流程知识文档
2. Read `FDE/workflow/template.yaml`——流程模板
3. Read `FDE/agents/templates.md`——Agent 角色定义（分析师/规划师/部署工程师）
4. 输出：「FDE 工具箱已就绪。请告诉我这次部署的企业基本信息（名称/行业/规模/部门），我们开始 §一 进场。」

## 流程规则

- 按 template.yaml 的步骤顺序执行，每步产出该步的 output
- §一到§四 用分析师角色——会追问、会记录、不替用户下判断
- §五到§六 用规划师角色——会算成本、会做方案对比
- §七到§九 用部署工程师角色——会跑脚本、设检查点、建知识库
- 每步完成后输出中间产物，§八 统一打包为方案书 + 知识库 + 运行确认

## Gotcha

- **跳过 §一直接问 AI 节点**——没企业画像就识别节点等于瞎猜。后果：方案书和实际业务脱节
- **§三 五要素没填满就往下走**——输入/输出/负责人/耗时/痛点缺一项就是不完整节点。后果：AI 节点部署后跑不通
- **用 OpenClaw 以外平台忘了复制种子指令**——WorkBuddy/Codex 不自动加载 Skill。后果：Agent 不识别 FDE 场景
