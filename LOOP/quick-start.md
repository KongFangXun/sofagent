# LOOP 快速入门 · 5 分钟把自迭代跑起来

> 你已经装了 sofagent 底座和 LOOP Skill。这篇文章告诉你第一条 workflow 怎么跑起来。

---

## 第一步：确认安装

```bash
# 确认 sofagent 底座已装
sofagent-audit --version   # 应输出 v1.1.4 或更高

# 没用？装一下
bash LOOP/loop-install.sh
```

## 第二步：准备 workflow

LOOP 的编排智能来自外部平台（WorkBuddy 等）。你在 WorkBuddy 的软件开发团队里做完 PRD → 架构设计，拿到任务列表，写成 `workflow.yml`：

```yaml
workflow:
  name: "示例：新增一条审计规则"
  nodes:
    - id: T1
      task: "在 rules/ 下新建 rule-a20.ts，定义 checkRuleA20"
    - id: T2
      task: "在 rules/index.ts 中注册 A20"
      depends_on: [T1]
    - id: T3
      task: "在 runner.ts 中调整优先级"
      depends_on: [T2]
```

## 第三步：设模型 + 跑

```bash
# 设模型（重要！）
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat  # 开发（便宜）
export SOFAGENT_LLM_REVIEWER=glm:glm-5.2             # 审查（贵）
export OPENAI_API_KEY=xxx
export LOOP_AUTO=1                                    # 全自动，不弹 y/n

# 跑
sofagent-orchestrator loop --task "你的任务描述"
```

LOOP 自动流转：engineer 写代码 → audit 审计 → reviewer 审查 → IS_PASS → 完成 / IS_PASS:NO → 回 engineer 修复。

## 怎么用 workflow 模式

Workflow 模式是 LOOP 的高级用法——外部编排平台产出 workflow.yml → LOOP 外层循环逐个执行子任务。这个功能由 `LOOP/src/workflow.ts` 提供，需要在 sofagent 底座的基础上额外配置。

```
编排层（WorkBuddy）产出 workflow.yml
  → LOOP 引擎逐个执行子任务
    → engineer(audit → reviewer) → ✅/❌
    → 下一个子任务...
```

## 内置 Agent

LOOP 带有 4 个内置 Agent Skill，装在 `agents/SKILL/` 下：

| Skill | 角色 | 模型建议 |
|-------|------|---------|
| `sofagent-engineer` | 软件工程师——写代码、修复、build/test | 便宜模型（DeepSeek） |
| `sofagent-reviewer` | 代码审查员——审查 + IS_PASS 判定 | 贵模型（GLM-5.2） |
| `sofagent-audit` | 合规审计员——A1-A19 规则检查 | 本地 |
| `sofagent-fde` | 前线部署工程师——Workflow 优化 | 本地 |

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `sofagent-orchestrator` 未找到 | sofagent 底座没装 | `bash LOOP/loop-install.sh` |
| engineer 不干活 | 没设 `SOFAGENT_LLM_ENGINEER` | 设 env var |
| reviewer 每轮都驳回 | 审查标准太严 | 改 `agents/SKILL/sofagent-reviewer/SKILL.md` 的判定标准 |
| LOOP_AUTO=0 时卡住 | 需要人工按 y/n | 设 `LOOP_AUTO=1` 或手动确认 |
