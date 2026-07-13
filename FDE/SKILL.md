---
name: sofagent-fde
slug: sofagent-fde
displayName: sofagent-fde
description: >
  FDE 部署工程师——梳理企业工作流、识别 AI 节点、构建知识库、安装 sofagent 底座、交付离场。
version: 1.0.7
tags: [fde, workflow, deployment, enterprise, ai-agent]
image: sofagent.png
triggers: [FDE部署, 企业AI化, 梳理工作流, 识别AI节点, 交付手册, 建知识库]
scenarios: [企业要做AI化, 梳理工作流, 识别AI节点, 需要FDE进场]
not_when: [纯技术讨论, 代码bug修复]
---

# sofagent-fde

> 🏗️ 本文件与 `agents/SKILL/sofagent-fde/SKILL.md` 内容一致。`fde-install.sh` 会自动把它部署到你的 Agent 平台。

## 使用方式

安装完成后，在 WorkBuddy/OpenClaw 中直接 `@sofagent-fde`：

1. Agent 加载本 Skill → 收到指令"用 Bash 跑 CLI 命令"
2. Agent 执行 `sofagent-audit subagent run fde --task "梳理采购流程"`
3. DeepAgents 编排引擎运行 FDE Agent，返回结果

## 怎么装

```bash
# 一键安装 sofagent 底座 + FDE Agent + Audit Agent
bash FDE/fde-install.sh

# 装完后 @sofagent-fde 即可用
```
