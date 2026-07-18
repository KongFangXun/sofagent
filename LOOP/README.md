# LOOP — sofagent 自迭代工具包

> LOOP 是 sofagent 项目自己的开发编排工具——用 sofagent 的审计引擎和 Sub Agent 能力，自动执行 WorkBuddy 等外部平台编排好的开发任务。
>
> **这不是产品功能，是独立工具包。** 用户点开 LOOP/ → 安装 → 就能跑自迭代。

## 快速开始

```bash
# 1. 一键安装
bash LOOP/loop-install.sh

# 2. 设模型
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat  # 开发（便宜）
export SOFAGENT_LLM_REVIEWER=glm:glm-5.2             # 审查（贵）
export OPENAI_API_KEY=xxx
export LOOP_AUTO=1                                    # 全自动

# 3. 跑单任务
sofagent-orchestrator loop --task "在 README.md 第三行后加一条项目简介"
```

LOOP 自动流转：engineer 写代码 → audit 审计 → reviewer 审查 → IS_PASS 自动判定。

## 内置 Agent

| Skill | 角色 | 位置 |
|-------|------|------|
| `sofagent-engineer` | 软件工程师——写代码、修复 | `agents/SKILL/sofagent-engineer/SKILL.md` |
| `sofagent-reviewer` | 代码审查员——审查 + 自动门控 | `agents/SKILL/sofagent-reviewer/SKILL.md` |
| `sofagent-audit` | 合规审计员——A1-A19 规则检查 | `agents/SKILL/sofagent-audit/SKILL.md` |

## 怎么用 workflow 模式（高级）

编排层（WorkBuddy 等）产出 workflow.yml → LOOP 引擎外层循环逐个执行子任务。

```bash
# workflow 模式由 LOOP/src/workflow.ts 提供
# 需在 sofagent 底座基础上额外配置
```

详细文档见 `LOOP/LOOP.md`，快速入门见 `LOOP/quick-start.md`。

## 目录

```
LOOP/
  README.md                     ← 你在这里
  loop-install.sh               ← 一键安装
  SKILL.md                      ← Skill 定义
  quick-start.md                ← 快速入门
  LOOP.md                       ← 设计文档
  src/
    types.ts / workflow.ts      ← 运行时代码
```
