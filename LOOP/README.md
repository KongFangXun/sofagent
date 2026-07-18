# LOOP — sofagent 开发工具

> LOOP 是 sofagent 项目自己的开发编排工具——用 sofagent 的审计引擎和 Sub Agent 能力，自动执行 WorkBuddy 等外部平台编排好的开发任务。
>
> **这不是产品功能，是服务于 sofagent 项目自身开发流程的工具。**

## 快速开始

```bash
# 1. 设模型
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-v4-pro  # 开发（便宜）
export SOFAGENT_LLM_REVIEWER=glm:glm-5.2             # 审查（贵）
export OPENAI_API_KEY=xxx
export LOOP_AUTO=1                                    # 全自动

# 2. 跑
sofagent-orchestrator loop --workflow templates/workflow-example.yml
```

## 怎么用

### 1. 编排阶段（在 WorkBuddy 里完成）
在 WorkBuddy 的软件开发团队中完成 PRD → 架构设计，让架构师产出任务列表。

### 2. 写成 workflow YAML
把架构师产出的任务列表写成 `workflow.yml`（参考 `templates/workflow-example.yml`）。

### 3. 执行
```bash
sofagent-orchestrator loop --workflow your-workflow.yml
```

LOOP 会逐个执行子任务，每个子任务走 engineer→audit→reviewer 闭环。审查不通过会自动回 engineer 修复。

## 目录

```
LOOP/
  README.md                     ← 你在这里
  templates/
    workflow-example.yml        ← 参考模板
```

## 代码在哪

运行时代码在 `sofagent/orchestrator/src/LOOP/`——这是开发工具，不是产品的功能模块。
