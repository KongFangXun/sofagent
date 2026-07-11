# sofagent Agent 库

> 标准化 Agent 定义，遵循 [Agency Agents](https://github.com/jnMetaCode/agency-agents-zh) 格式规范（frontmatter + 结构化章节）和命名惯例（`{部门}-{角色}.md`）。
>
> 每个 Agent 是单个 `.md` 文件，可直接被 OpenAI/Anthropic/OpenClaw 等平台加载。转换为 OpenClaw 格式：`agency-agents-zh/scripts/convert.sh --tool openclaw`。

## Agent 列表

| Agent | 文件 | 模板来源 | 职责 |
|-------|------|------|------|
| 部署工程师 | `forward-deployed-engineer.md` | ⚠️ 自创（无对应模板） | FDE 部署 + LOOP 外层监督：监控健康度、优化 Agent 定义 |
| 合规审计员 | `security-compliance-auditor.md` | `security/security-compliance-auditor.md` + sofagent 定制 | Workflow 巡检 + LOOP 外层巡检：定期合规审计 |
| 最小变更工程师 | `engineering-minimal-change-engineer.md` | `engineering/engineering-minimal-change-engineer.md` + sofagent 约束层 | LOOP 执行者：读代码 + 写代码 + 跑测试 + git commit |
| 代码审查员 | `engineering-code-reviewer.md` | `engineering/engineering-code-reviewer.md` + sofagent 分工说明 | LOOP 审查者：语义审查 + 影响分析 + 铁律合规 |

> **设计原则**：能引用的不重写。三个 Agent 直接引用 Agency Agents 标准模板，只在文件中叠加 sofagent 专属约束。部署工程师是 sofagent 独有概念，无对应模板，需自创。

## 格式标准

遵循 Agency Agents 的前端格式：

```yaml
---
name: Agent 名称
description: 一句话描述
emoji: 🎯
color: blue
---
```

文件名遵循 `{部门}-{角色}.md` 惯例。如有基座模板，在文件头部标注引用关系 + sofagent 差异部分。

## 未来方向

- **Work模板市场**：集中管理的 Workflow 目录，从 Agent 库调用标准化 Agent
- **DeepAgentsJS 集成**：通过 `createDeepAgent()` API 将 Agent 作为 LangGraph 节点运行（见 `LOOP/loop.md`）

## 参考

- [LOOP/](../LOOP/) — 自迭代循环的实验编排
- [Agency Agents（中文版）](https://github.com/jnMetaCode/agency-agents-zh) — 230+ 岗位模板
- [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) — LangGraph Agent harness（v1.10.7）
