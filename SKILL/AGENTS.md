# sofagent Agent 库

> 📂 Sub Agent 定义集中在 [`agents/`](./agents/) 子目录，每个子目录含 `SKILL.md`（调用入口）+ `{role}.md`（角色定义）。下表列出 4 个预装 Sub Agent：

| Sub Agent | 目录 | 职责 |
|-----------|------|------|
| `@sofagent-audit` | [`agents/audit/`](./agents/audit/) | 合规审计员——Workflow 巡检、铁律覆盖验证、知识库健康度检查 |
| `@sofagent-engineer` | [`agents/engineer/`](./agents/engineer/) | 最小变更工程师——读代码 + 写代码 + 跑测试 + git commit |
| `@sofagent-fde` | [`SKILL.md`](./SKILL.md) | 前线部署工程师——梳理工作流、识别 AI 节点、构建知识库、交付离场 |
| `@sofagent-reviewer` | [`agents/reviewer/`](./agents/reviewer/) | 代码审查员——语义审查 + 影响分析 + 铁律合规 |

> v1.0.7 起（当前 v1.2.0），预装 Agent 为 Skill 格式。Skill 是调用入口——第三方 Agent 平台（WorkBuddy/Codex/OpenClaw 等）加载 Skill 后，通过 CLI 命令把任务交给 DeepAgents 编排引擎执行。

## Agent 列表

| Agent | Skill | CLI 命令 | 职责 |
|------|------|------|------|
| 部署工程师 | `@sofagent-fde` · `SKILL/SKILL.md` | `sofagent-orchestrator subagent run fde --task "..."` | 梳理工作流、识别 AI 节点、构建知识库、交付离场 |
| 合规审计员 | `@sofagent-audit` · `SKILL/agents/audit/SKILL.md` | `sofagent-orchestrator subagent run audit --task "..."` | Workflow 巡检、铁律覆盖验证、知识库健康度检查 |
| 最小变更工程师 | `engineering-minimal-change-engineer.md` | LOOP 内层循环自动调用 | 读代码 + 写代码 + 跑测试 + git commit |
| 代码审查员 | `engineering-code-reviewer.md` | LOOP 内层循环自动调用 | 语义审查 + 影响分析 + 铁律合规 |

---

## 如何使用（第三方 Agent 调用）

| 方式 | 场景 | 操作 |
|------|------|------|
| 装 Skill → @ | WorkBuddy/OpenClaw | `bash install.sh`（自动装），然后 `@sofagent-fde` |
| 复制 prompt | 不支持 Skill 的平台 | 把 SKILL.md 内容贴进 system prompt |
| CLI 直跑 | 任何终端 | `sofagent-orchestrator subagent run fde --task "..."` |

---

## 合规审计员的价值

审计员**不是后台常驻进程**——调用一次，执行一次，报告结果后就停止。

### 为什么它是必调 Agent？

所有 sofagent Agent 在完成任务后都会自动调用审计员。这不是"建议检查"——是**合规闸门**：

```
FDE agent 部署完成   ──→ 自动调用 @sofagent-audit  → 验证部署合规
LOOP engineer commit ──→ 自动调用 @sofagent-audit  → 验证变更合规
每次 git commit      ──→ commit-msg hook          → A1-A11、A14-A19 规则检查（0 token，纯正则引擎）
未来任何新 Agent      ──→ SKILL.md 内置审计引用    → 合规检查
```

**为什么不是让你手动想起来才跑**：你部署了 10 个 AI 节点，不会记得每个节点都跑一次审计。但每次部署如果不审计，一个 knowledge-domain 配置错误的节点可能让财务数据泄漏到全公司。审计员的价值不在"跑一次"——在于"每次变更自动跑，不给遗忘留空间"。

### 它给你什么？

| 场景 | 什么时候 @ 它 | 它给你什么 |
|------|------|------|
| **发版前** | 准备发布新版本时 | 全量合规扫描——铁律是否覆盖所有 AI 节点、Workflow 有没有漏洞、版本号对齐没有 |
| **事故后** | Agent 操作出了问题 | 根因分析——是约束没覆盖到，还是 Agent 绕过了审计，还是配置有漏洞 |
| **定期巡检** | 每周一次 | 知识库健康度报告——哪些 entity 死链了、think.md 反思质量趋势 |
| **新节点上线** | 新增 AI 节点后 | 检查新节点的 actions 声明是否完整、knowledge-domain 是否合理 |

**和 `sofagent-core doctor` 的区别**：doctor 告诉你"哪里坏了"（二进制 yes/no），审计员告诉你"为什么坏了 + 怎么修"（LLM 解释 + 修复建议）。

每次运行产生的报告写入 `.sofagent/` 下，FDE 定期读报告趋势做优化决策。

---

## Agent 格式

预装 Agent 分两类格式，目录结构不同：

**类型 A — Skill 格式（第三方平台调用入口）**：`SKILL/` 与 `SKILL/agents/audit/`，每个目录下有**两个文件**，分工明确：

| 文件 | 格式 | 作用 | 谁读 |
|------|------|------|------|
| `SKILL.md` | Skill 格式（frontmatter + 调用指令） | **调用入口**——告诉第三方 Agent 用 Bash 跑 `sofagent-orchestrator subagent run <name>` | 第三方 Agent 平台（WorkBuddy/Codex） |
| `{role}.md` | Agency Agents 格式（frontmatter + 结构化章节） | **角色定义**——Agent 的完整行为规范、工作流、原则 | DeepAgents 编排引擎 + 人类参考 |

**两者不是替代关系——是调用层和定义层分离。**
- SKILL.md = "怎么调这个 Agent"（一句话：跑 CLI 命令）
- {role}.md = "这个 Agent 是什么"（完整的角色说明书，100+ 行）

**类型 B — LOOP 内层角色（非 Skill）**：`engineering-minimal-change-engineer.md`、`engineering-code-reviewer.md` 直接由 LOOP 内层循环调度，单文件即完整角色定义，不对外暴露 Skill 入口、也没有对应 SKILL 目录。

### Skill 格式（调用入口）

```yaml
---
name: sofagent-fde
slug: sofagent-fde
version: 1.1.3
displayName: FDE 部署工程师
description: >
  前线部署工程师...
---
```

### Agency Agents 格式（角色定义）

```yaml
---
name: Agent 名称
description: 一句话描述
emoji: 🎯
color: blue
---
```

文件名遵循 `{部门}-{角色}.md` 惯例。用于 LOOP 内层循环自动调度。

---

## 参考

- [LOOP/](../LOOP/) — 自迭代循环的实验编排
- [Agency Agents（中文版）](https://github.com/jnMetaCode/agency-agents-zh) — 230+ 岗位模板
- [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) — LangGraph Agent harness
