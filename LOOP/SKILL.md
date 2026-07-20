---
name: sofagent-loop
slug: sofagent-loop
displayName: sofagent-loop
description: >
  自迭代开发循环——让 sofagent 用自己的 Agent 和审计引擎开发自己。装上后，一条 prompt 触发整套 LOOP：coding → audit → review → human。
version: 1.1.7
tags: [loop, agent, workflow, self-iteration, development, orchestration]
image: sofagent.png
triggers: [自迭代, 自动开发, 自动审查, LOOP, 自动化代码审查, 启动开发循环, 让Agent自己写代码]
scenarios: [想让 Agent 自动写代码并审查, 想让开发流程自动化, 想用多个 Agent 协作开发, 想让 sofagent 自己开发自己]
not_when: [纯技术讨论, 不需要代码审查的任务, 单次简单查询]
---

# sofagent-loop · SKILL.md · v1.1.7

> 自迭代开发循环 Skill。装上后，一条 prompt 触发整套 LOOP：sofagent-engineer（软件工程师）写代码 → sofagent-audit（合规审计员）硬证据审计 → sofagent-reviewer（代码审查员）语义审查 → IS_PASS 自动判定 → 下一轮。Agent 定义在 `agents/SKILL/`，编排文档在 `LOOP/LOOP.md`。

## 为什么要用

开发 sofagent 本身是一个复杂的多 Agent 协作场景。LOOP 把这些已有的工具（agents/SKILL/ 的 Agent 定义 + sofagent-audit + sofagent-reviewer）串联成自动化流程，让开发从"人驱动"变成"Agent 驱动 + 人监督"。

## 适用场景

你是 sofagent 的开发者或贡献者。你需要写代码、跑测试、提交、审查——这个循环每天重复几十次。LOOP 把这个循环自动化了：你只下任务，Agent 干活、审计、审查，你只看最后的审查报告。

也适用于任何想在自己的项目上跑自迭代开发循环的用户——修改 `agents/SKILL/sofagent-engineer/SKILL.md` 和 `agents/SKILL/sofagent-reviewer/SKILL.md` 来适配你的项目。

## 和 sofagent 主项目的关系

LOOP 不是 sofagent 的必装组件。装 sofagent 不会自动装 LOOP。如果你想用 LOOP：

- **装 sofagent** → 获得审计引擎、约束底座、编排引擎
- **装 FDE**（`fde-install.sh`）→ 获得企业部署工具包
- **装 LOOP**（`loop-install.sh`）→ 获得自迭代开发循环

三者独立安装，按需选用。

## 前置依赖

- 已装 sofagent（`sofagent/scripts/install.sh`）
- OpenClaw（sub-agent 通过 `session.spawn` 启动）
- 已装 FDE（可选——外层循环的 forward-deployed-engineer 需要 FDE 工具包）

## 安装

```bash
# ClawHub / SkillHub
clawhub skill install KongFangXun/sofagent-loop

# 手动安装（OpenClaw / WorkBuddy）
bash LOOP/loop-install.sh --platform openclaw
bash LOOP/loop-install.sh --platform workbuddy
```

装完看 [quick-start.md](./quick-start.md) 5 分钟跑通第一条 LOOP。

## 激活

| 平台 | 怎么激活 |
|------|------|
| OpenClaw | 装完自动就绪，Agent 检测到开发循环场景后加载 |
| WorkBuddy | 输入 `@skill:sofagent-loop` |
| 其他 | 复制 LOOP/README.md 中的一键触发指令 |

## 激活后行为

1. Read `LOOP/LOOP.md`——LOOP 的完整设计文档（内外层循环、防线、DeepAgentsJS 计划）
2. 读取 `agents/` 下的 Agent 定义（谁做什么、怎么做）
3. 输出：「LOOP 自迭代循环已就绪。告诉我任务，我来驱动开发循环。」

## 流程规则

按 `LOOP/LOOP.md` 定义的流程执行：任务 → minimal-change-engineer 写代码 → git commit → sofagent-audit 审计 → code-reviewer 审查 → 审查报告 → 人类确认 → 下一轮。

外层循环由 forward-deployed-engineer 定期执行：分析 think.md 趋势 → 优化 Agent 定义 → 触发 compliance-auditor 巡检 → 更新审查文档。

## 交付物

- **代码变更**：minimal-change-engineer 提交的代码
- **审查报告**：code-reviewer 产出的分级审查报告（🔴/🟡/💭）
- **反思记录**：think.md 中的任务反思
- **审计历史**：history.jsonl 中的审计记录

## Gotcha

- **不要跳过 sofagent-audit**——commit-msg hook 是硬证据审计，`--no-verify` 绕过会被检测到
- **不要把"顺便"写进代码**——minimal-change-engineer 必须遵守最小变更原则，范围外的改动记录到 think.md
- **审查报告要逐项处理**——🔴 阻断项不修复就继续下一轮 = 浪费
